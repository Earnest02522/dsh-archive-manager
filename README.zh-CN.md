# dsh-archive-manager（归档会话管理插件）

[English](README.md) | [简体中文](README.zh-CN.md)

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 提供**归档会话管理**的插件：
在侧边栏底部新增入口，弹出面板**按工作区归类**列出所有已归档的会话，支持
**恢复（单条 / 批量）**，以及**打开对话文件夹**（在文件管理器里定位该会话的原始日志目录）。

> **新版内置能力说明（DSH 0.2.x）。** 新版 DSH 已自带“归档会话”操作、归档过滤（`default` / `show` / `only`）、
> 置顶（pin）以及原生 `unarchiveSession` API。本插件不重复造这些轮子，而是补齐它们没有做的：
>
> - **批量恢复**：“恢复全部”按钮一次调用恢复所有归档会话，而不是逐条点击。
> - **打开会话转录文件夹**：定位该会话 `session.jsonl*` 日志所在目录——官方内置的“reveal”打开的是**工作区**目录，不是会话日志目录。
> - **一键归档总览**：按工作区分组显示并带数量统计。
> - **兼容 DSH 0.1.x**：0.1.x 既没有归档过滤也没有 unarchive API，本插件为其补齐这些能力。
>
> 浏览器端做了跨版本防御：DSH 0.2 移除了客户端 `sessions.open`，因此面板不会假设它存在——
> 没有 opener 时降级提示“已恢复，请在侧边栏打开”。

## 功能

- **查看（按工作区分组）**：点击侧边栏底部的“归档”按钮，弹出面板；归档会话按所属工作区（Workspace）分组显示（没有归属的归入“未分组”），每行展示标题、短 id 与最后更新时间。
- **恢复**：一键把会话从归档集合中移除并持久化，会话立刻回到侧边栏原位。
- **批量恢复**：「恢复全部」一次性恢复所有归档会话（通过插件的 `unarchiveMany` 端点；不可用时自动逐条回退）。
- **恢复并打开**：恢复后尝试打开会话；在 DSH 0.2（已移除客户端 `sessions.open`）上则恢复并提示你从侧边栏打开。
- **打开对话文件夹**：在系统文件管理器（Windows 资源管理器 / macOS Finder / Linux xdg-open）中打开该会话的转录（transcript）目录（存放 `session.jsonl*` 日志的文件夹），方便你查看或备份原始日志。
- **安全**：浏览器端代码做了全面防御——不调用插槽未保证提供的 hooks、任何一步失败都不会让整个界面崩溃、远程挂载失败时降级为只读面板；并规避了 inject/自挂载的死锁（`archiveManager` 命名空间由本 bundle 自己挂载，因此用 `ctx.get(...)` 动态获取，**刻意不写进 `inject`**）。
- **零构建**：纯手写 JS，无需编译；通过官方 `dsh plugin add` 命令或仓库自带脚本安装。
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

- **DSH 0.2.x（桌面版）**——v0.5.0 的主要适配目标：优先调用原生 `workspaceRegistry.unarchiveSession()`；读取 0.2 的 `sessionPersistence.list()` 快照结构（`{ header, revision, sizeBytes }`）与 `stat(id)`；兼容已移除的客户端 `sessions.open`。
- **DSH 0.1.x（web）**——完整支持：回退为通过 registry 操作队列从 `archivedSessionIds` 移除，并接受旧版裸 header 的 `list()` 结构；已在 `0.1.1-rc.2` 上端到端验证。
- 附 Windows 安装/卸载脚本（资源管理器打开目录）；插件本身跨平台（macOS Finder / Linux xdg-open）

## 安装

### 官方 CLI —— npx 方式（推荐，无需全局安装）

```powershell
npx --yes @deepseek-ai/dsh plugin --profile desktop add https://github.com/Earnest02522/dsh-archive-manager.git
```

桌面版的 profile 名是 `desktop`；旧版 web 安装请用 `--profile web`。

`npx --yes @deepseek-ai/dsh` 直接从 npx 缓存运行官方 CLI，**无需全局安装**——大多数机器没有把 `dsh` 加入 `PATH`。

### 或：全局安装后用 `dsh`

如果你希望（或已经）全局安装 CLI：

```powershell
npm install -g @deepseek-ai/dsh
dsh plugin --profile desktop add https://github.com/Earnest02522/dsh-archive-manager.git
```

两种方式等价；下文命令使用 npx 形式。

本包声明了 `dsh.bundle` 清单，所以 `plugin add` 子命令会**同时完成依赖安装和 loader 注册**——无需手动编辑 patch 文件。本地检出也可以用文件路径：

```powershell
npx --yes @deepseek-ai/dsh plugin --profile desktop add "file:D:\path\to\dsh-archive-manager"
```

> 安装后：重启 DSH（或等待 patch HMR 重新组合配置），然后强制刷新浏览器（`Ctrl+Shift+R`）。
> 非 web profile：把命令中的 `web` 换成例如 `headless`。

### Windows 安装脚本（旧方式）

打开 PowerShell，**先 `cd` 进入仓库目录**，再运行脚本：

```powershell
cd <仓库路径>              # 例如 cd D:\dsh-archive-manager
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

仓库在任意位置 `<repo>` 时：

```powershell
powershell -ExecutionPolicy Bypass -File <repo>\scripts\install.ps1
# 非默认 profile：
powershell -ExecutionPolicy Bypass -File <repo>\scripts\install.ps1 -ProfileName desktop
```

脚本会自动识别 profile（0.2.x 为 `desktop`，0.1.x 为 `web`）和插件目录
（`<profile>/node_modules`，回退到共享的 `profiles/node_modules`），把插件复制进去，并在
profile 的 `cordis.patch.yml` 中启用（会先备份原 patch 文件）。若条目已存在则为无操作。

> 安装后：重启 DSH（或等待 patch HMR 重新组合配置），然后强制刷新浏览器（`Ctrl+Shift+R`）。

### Linux / macOS 安装脚本

仓库同样附带 bash 安装脚本（自动识别逻辑相同）：

```bash
cd <仓库路径>              # 例如 cd ~/dsh-archive-manager
bash scripts/install.sh
# 非默认 profile / scoped 包名：
bash scripts/install.sh web "@earnest020522/dsh-archive-manager"
```

脚本优先使用 `$DSH_HOME`，否则 `~/.dsh`，并自动处理空模板 `[]` 的 patch 文件。

### 手动安装

1. 把整个仓库文件夹复制到
   `%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-archive-manager`
   （DSH 0.2.x；0.1.x 则用共享目录
   `%USERPROFILE%\.dsh\profiles\node_modules\dsh-archive-manager`）。
2. 编辑 `%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml`，在末尾追加：

   ```yaml
   - insert:
       - id: dsh-archive-manager
         name: dsh-archive-manager
   ```

3. 重启 DSH（或等待 patch HMR 重新组合配置），然后强制刷新浏览器（`Ctrl+Shift+R`）。

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
npx --yes @deepseek-ai/dsh plugin --profile desktop remove dsh-archive-manager
# 若已全局安装，等价写法：
#   dsh plugin --profile desktop remove dsh-archive-manager
```

然后重启 DSH。旧方式备用：运行
`powershell -ExecutionPolicy Bypass -File .\scripts\uninstall.ps1`；
或手动删除 profile 的 `cordis.patch.yml` 中 `dsh-archive-manager` 条目，
再删除 `%USERPROFILE%\.dsh\profiles\node_modules\dsh-archive-manager`。

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
