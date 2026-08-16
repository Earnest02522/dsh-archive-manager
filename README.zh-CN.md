# dsh-archive-manager（归档会话管理插件）

[English](README.md) | [简体中文](README.zh-CN.md)

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 提供**归档会话管理**的插件：
在侧边栏底部新增入口，弹出面板**按工作区归类**列出所有已归档的会话，支持
**查看（打开）**、**恢复（取消归档）**，以及**打开对话文件夹**（在文件管理器里定位该会话的原始日志目录）。

> **背景。** DSH 自带“归档会话”功能（把会话 id 加入全局 `archivedSessionIds` 集合，从侧边栏隐藏），
> 但**没有提供查看归档列表的界面，也没有任何取消归档（unarchive）的 API**——
> 官方 `dsh-client-ui-workspace` 的 README 明确把“no viewing or unarchive surface”列为已知缺口。
> 同时，DSH 的会话日志（`session.jsonl*`）**永远不会被删除**（持久化层没有删除接口），
> 所以“恢复”的本质就是：把这个会话 id 从归档集合里移除。
> 本插件以标准 cordis 插件的形式实现这件事，**不改动任何 DSH 核心代码**。

## 功能

- **查看（按工作区分组）**：点击侧边栏底部的“归档”按钮，弹出面板；归档会话按所属工作区（Workspace）分组显示（没有归属的归入“未分组”），每行展示标题、短 id 与最后更新时间。
- **恢复**：一键把会话从归档集合中移除并持久化，会话立刻回到侧边栏原位。
- **打开**：一键“恢复 + 打开”（归档中的会话无法保持打开状态，所以打开前会自动先恢复）。
- **打开对话文件夹**：在系统文件管理器（Windows 资源管理器 / macOS Finder / Linux xdg-open）中打开该会话的转录（transcript）目录（存放 `session.jsonl*` 日志的文件夹），方便你查看或备份原始日志。
- **安全**：浏览器端代码做了全面防御——不调用插槽未保证提供的 hooks、任何一步失败都不会让整个界面崩溃、远程挂载失败时降级为只读面板；并规避了 inject/自挂载的死锁（`archiveManager` 命名空间由本 bundle 自己挂载，因此用 `ctx.get(...)` 动态获取，**刻意不写进 `inject`**）。
- **零构建**：纯手写 JS，复制即用，无需编译。
- **中英双语**：根据浏览器语言自动切换界面文案。

## 为什么没有“删除”功能（插件也刻意不做）

**DSH 本身不支持删除会话**（设计如此），本插件严格遵守这条边界：

1. **持久化层没有删除接口。** DSH 把每个会话存成 `~/.dsh/sessions/...` 下的**只追加** JSONL 日志。
   `dsh-session-persistence-jsonl` 的 README 明确写道：*“日志在 root 下累积，直到外部移除（seam 无删除接口）”*。
   任何 DSH 代码——包括本插件——都不会 unlink 会话日志文件。
2. **“归档”是软隐藏，不是删除。** 自带的“归档会话”只是把会话 id 加入 `archivedSessionIds`；
   日志、工作区记账席位、会话数据全部原样保留。这正是“恢复”可行的原因。
3. **清理会话是带外操作。** 如果你确实想删掉某个转录，受支持的方式是：停止 DSH 后，
   手动删除 `~/.dsh/sessions/--<项目>--/<会话id>/` 目录（sqlite 搜索索引会在下次扫描时自动把它清掉）。
   本插件反过来给你一个**打开对话文件夹**按钮，让你快速、安全地找到那个目录。

一句话：**查看与恢复是可逆、安全的操作；物理删除被刻意排除在范围之外**——
一个破坏性的“删除”按钮会与存储设计（只追加日志、可重建索引）冲突，还可能静默销毁本插件无法恢复的数据。

## 原理

| 层 | 做什么 |
|---|---|
| 宿主插件（`src/index.js`） | 注册根级 Typert Remote 服务 `ctx.archiveManager`，两个端点：`archiveManager/unarchive`（通过 `ctx.workspaceRegistry` 自己的串行操作队列 `enqueueOperation`/`requireState`/`setState` 把会话 id 从 `archivedSessionIds` 移除并返回新集合）与 `archiveManager/openSessionFolder`（通过 `ctx.sessionPersistence` 定位会话转录文件，并在系统文件管理器中打开其目录）。 |
| 浏览器插件（`src/client.js`） | 用 `ctx.remote.$mount` 挂载匹配的严格描述符，然后在 `sidebar.footer.action` 插槽注册按钮 + 面板。面板读取 `workspaces.list`（items + archivedSessionIds）与 `sessions.list`（都是响应式 store），按工作区记账把归档 id 分组，恢复调 `archiveManager/unarchive`，打开调 `sessions.open(id)`，文件夹按钮调 `archiveManager/openSessionFolder`。 |

不修改任何 DSH 源码。插件由标准加载器（profile 的 `cordis.patch.yml`）发现，
浏览器端由客户端模块加载器发现（`dsh.client.platform = "web"`）。

## 兼容性

- DeepSeek Harness `0.1.0-rc.x`（已在 `0.1.0-rc.6` 的 web profile 上验证）
- 附 Windows 安装/卸载脚本（资源管理器打开目录）；插件本身跨平台（macOS Finder / Linux xdg-open）

## 安装

### 一键安装命令（Windows）

打开 PowerShell，**先 `cd` 进入仓库目录**，再运行脚本：

```powershell
cd <仓库路径>              # 例如 cd D:\dsh-archive-manager
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

仓库在任意位置 `<repo>` 时：

```powershell
powershell -ExecutionPolicy Bypass -File <repo>\scripts\install.ps1
# 非默认 profile：
powershell -ExecutionPolicy Bypass -File <repo>\scripts\install.ps1 -ProfileName headless
```

脚本会把插件复制到 `%USERPROFILE%\.dsh\profiles\node_modules\dsh-archive-manager`，
并在 `%USERPROFILE%\.dsh\profiles\web\cordis.patch.yml` 中启用它（会先备份原 patch 文件）。
若条目已存在则为无操作。

> 安装后：重启 DSH（或等待 patch HMR 重新组合配置），然后强制刷新浏览器（`Ctrl+Shift+R`）。

### 手动安装

1. 把整个仓库文件夹复制到
   `%USERPROFILE%\.dsh\profiles\node_modules\dsh-archive-manager`
   （该目录是 loader 的共享解析根，没有就创建）。
2. 编辑 `%USERPROFILE%\.dsh\profiles\web\cordis.patch.yml`，在末尾追加：

   ```yaml
   - insert:
       - id: dsh-archive-manager
         name: dsh-archive-manager
   ```

3. 重启 DSH（或等待 patch HMR 重新组合配置），然后强制刷新浏览器（`Ctrl+Shift+R`）。

### 官方 CLI 方式（只装依赖，仍需手动 patch）

```powershell
dsh plugin --profile web add "file:<repo>"
```

`dsh plugin` 转发给 pnpm，且只会自动激活声明了 `dsh.bundle` 的包；本 UI 插件没有该声明，
所以只会作为普通依赖安装——仍需要上面的第 2 步（`cordis.patch.yml` insert）。

### 验证是否生效

- 侧边栏底部（设置按钮旁边）出现 **归档 / Archive** 按钮。
- 点击后弹出面板，归档会话按工作区分组显示，每行有 **打开**、**恢复** 与文件夹图标按钮。
- 也可以直接探测宿主端点：

  ```
  POST /api/archiveManager/unarchive
  {"type":"client-request","rpcId":"x","method":"archiveManager/unarchive",
   "payload":{"args":{"request":{"sessionId":"<归档会话id>"}}}}

  POST /api/archiveManager/openSessionFolder
  {"type":"client-request","rpcId":"x","method":"archiveManager/openSessionFolder",
   "payload":{"args":{"request":{"sessionId":"<归档会话id>"}}}}
  ```

## 卸载

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\uninstall.ps1
```

或手动：删除 `cordis.patch.yml` 中的 `dsh-archive-manager` 条目，
删除 `%USERPROFILE%\.dsh\profiles\node_modules\dsh-archive-manager`，然后重启 DSH。

## 开发

无需构建：`src/index.js` 是宿主插件，`src/client.js` 是浏览器 bundle（模块加载器格式）。
快速检查语法：

```powershell
node --check src/index.js
node --check src/client.js
```

宿主逻辑冒烟测试（真实 cordis `Context` + 桩 registry/persistence）：

```js
import { Context } from '@deepseek-ai/cordis';
import { apply } from './src/index.js';
const ctx = new Context();
let archived = ['a', 'b'];
ctx.provide('workspaceRegistry', {
  enqueueOperation(op) { return Promise.resolve().then(op); },
  requireState() { return { archivedSessionIds: archived }; },
  async setState(s) { archived = s.archivedSessionIds; },
  get archivedSessionIds() { return archived; },
});
const svc = apply(ctx);
console.log(await svc.unarchive({ sessionId: 'b' })); // { archivedSessionIds: ['a'] }
```

## 已知限制

- **刻意不做“删除”**：见上文《为什么没有“删除”功能》。
- 面板在恢复后做乐观更新；权威的 `archivedSessionIds` 会在下一次 workspace 基线（重连/列表刷新）时重新同步。
- `openSessionFolder` 打开的是**转录目录**（`~/.dsh/sessions/...` 下），不是项目工作区目录。
- 手动删除会话日志文件不在本插件职责内；对未知 id，端点会原样返回集合（幂等）。

## 许可证

MIT
