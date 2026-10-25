# dsh-archive-manager（归档会话管理插件）

[English](README.md) | [简体中文](README.zh-CN.md)

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 提供**归档会话管理**的插件：
在侧边栏底部新增入口，弹出面板**按工作区归类**列出所有已归档会话，可搜索，支持
**单条恢复 / 全部恢复**、**恢复并打开**，以及**定位会话的工作目录**。

> **新版内置能力说明（DSH 0.2.x）。** 新版 DSH 已自带“归档会话”操作、归档过滤（`default` / `show` / `only`）、
> 置顶（pin）以及原生归档 API。本插件不重复造这些轮子，而是补齐它们没有做的：
>
> - **归档总览**：一个面板列出**全部**归档会话，按工作区分组并带数量统计。
> - **批量恢复**：「恢复全部」一次性清空归档，而不是在侧边栏逐条取消归档。
> - **搜索**：按标题、会话 id 或工作目录过滤归档。
> - **恢复并打开**：恢复后直接把会话切到主视图。
> - **定位工作目录**：在文件管理器中打开该会话所属的项目目录。

## 功能

- **归档总览（按工作区分组）**：点击侧边栏底部（`sidebar.footer.action` 插槽）的按钮弹出面板。
  每个归档会话显示在其所属工作区标题下（没有工作区认领的归入「未分组」），按更新时间倒序，
  每行展示标题、短会话 id、相对时间与工作目录。
- **恢复**：调用 DSH 自带的 `workspaces.unarchiveSession(...)`，因此侧边栏、工作区记账与持久化层保持一致。
- **全部恢复**：依次恢复所有归档会话（以及当前搜索命中的会话），部分失败会汇总提示而不会中断。
- **恢复并打开**：恢复后通过 `uiWorkspace` 服务把会话切到主视图（该服务不存在时自动跳过）。
- **定位工作目录**：通过 `session/openWorkspacePath { action: "reveal" }` 让宿主在系统文件管理器中打开会话的 `cwd`。
- **键鼠友好**：`Esc` 关闭面板；标题栏可拖动；上下左右四边与四角共八个方向可缩放；几何位置被限制在视口内；触屏设备上操作按钮常显。
- **中英双语**：优先使用 DSH 的 locale，其次跟随浏览器语言。
- **纯客户端、零构建**：没有宿主服务、没有 Typert 远程方法、没有编译步骤；源码即 ESM，另加一个模块加载器格式的浏览器 bundle。

## 为什么现在改成「纯客户端」插件

0.5.x 及更早的版本在宿主侧注册了一个根级 Typert Remote 服务 `ctx.archiveManager`，浏览器端用
`ctx.remote.$mount(...)` 挂载手写描述符。DSH 0.2 会严格校验外部贡献的描述符
（`validateContribution` → `requireStrictInputs`，且命名空间不能与内置 `remote.*` 服务冲突），
而归档本身也已成为 `workspaces` 客户端服务的一等能力——自定义远程方法既脆弱又多余。

v0.6.0 只保留必须自定义的部分（界面），其余全部复用 DSH 已有服务：

| 层 | 做什么 |
|---|---|
| 宿主插件（`src/index.js`） | `export function apply() {}`——刻意留空：不注册服务、不声明 inject、除注册 bundle 外不打任何补丁。 |
| 浏览器插件（`src/client.js`） | 在 `sidebar.footer.action` 插槽注册条目。以响应式快照 store 读取 `workspaces.list`（`{ items, archivedSessionIds, pinnedSessionIds, … }`）与 `sessions.list`（`{ ids, byId, … }`），按工作区记账把归档 id 分组；恢复走 `workspaces.unarchiveSession(id)`，打开走 `uiWorkspace.openSession(id)`，定位目录走 `remote.session.openWorkspacePath({ path, action: "reveal" })`。 |

不修改任何 DSH 源码。插件由标准加载器（profile 的 `cordis.patch.yml` / `dsh.profile.bundles`）发现，
浏览器端由客户端模块加载器发现（`dsh.client.platform = "web"`）。

## 兼容性

- **DSH 0.2.1-rc.3 及更新版本（桌面版）**——已针对 `@deepseek-ai/dsh-desktop-runtime 0.2.1-rc.3` 验证：
  bundle 能被正常下发、插槽注册成功、面板可基于真实的 `workspaces` / `sessions` / `remote.session` 服务渲染。
- **不再支持 DSH 0.1.x**：插件依赖 `workspaces` 客户端服务（归档快照 + `unarchiveSession`）与
  `session/openWorkspacePath` 端点，二者都是 0.2 线才引入的。
- 与平台无关：目录定位交由宿主完成，Explorer / Finder / xdg-open 均可。

## 安装

### 官方 CLI —— npx（推荐，无需全局安装）

```powershell
npx --yes @deepseek-ai/dsh plugin --profile desktop add https://github.com/Earnest02522/dsh-archive-manager.git
```

桌面版 profile 是 `desktop`；`dsh web` 安装则用 `--profile web`。

`npx --yes @deepseek-ai/dsh` 直接从 npx 缓存运行官方 CLI，**不需要全局安装**——大多数机器上 `dsh` 并不在 `PATH` 里。

> 安装前 desktop profile 必须已存在：先打开一次 DeepSeek Harness 桌面版，然后在运行命令前完全退出它。

### 或者：全局安装后直接 `dsh`

```powershell
npm install -g @deepseek-ai/dsh
dsh plugin --profile desktop add https://github.com/Earnest02522/dsh-archive-manager.git
```

两种方式等价。本包声明了 `dsh.bundle` 清单，`plugin add` 会安装依赖**并**自动写入加载器条目，无需手工改 patch。
本地目录同样可以：

```powershell
npx --yes @deepseek-ai/dsh plugin --profile desktop add "file:D:\path\to\dsh-archive-manager"
```

> 安装后重启 DSH（或等 patch HMR 重新组装配置），然后硬刷新浏览器（`Ctrl+Shift+R`）。

### Windows 安装脚本（旧方式，作为兜底）

先在 PowerShell 中 `cd` 到仓库目录，再执行：

```powershell
cd <path-to-repo>          # 例如 cd D:\dsh-archive-manager
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

也可以在任意位置指定仓库路径：

```powershell
powershell -ExecutionPolicy Bypass -File <repo>\scripts\install.ps1
# 非默认 profile：
powershell -ExecutionPolicy Bypass -File <repo>\scripts\install.ps1 -ProfileName desktop
```

脚本会自动识别 profile（`desktop` → `web` → 唯一存在的那个），把插件复制到 `<profile>/node_modules`，
并在该 profile 的 `cordis.patch.yml` 中启用它（改动前会生成带时间戳的备份）。若条目已存在则不动。

### Linux / macOS 安装脚本

仓库同时提供自动识别的 bash 安装脚本：

```bash
cd <path-to-repo>          # 例如 cd ~/dsh-archive-manager
bash scripts/install.sh
# 非默认 profile / 带 scope 的包名：
bash scripts/install.sh web "@earnest020522/dsh-archive-manager"
```

脚本优先使用 `$DSH_HOME`，否则用 `~/.dsh`，并自动处理空的 `[]` patch 模板。

### 手动安装

1. 把本目录复制到 `%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-archive-manager`
   （或加入所用 profile 的 `dsh.profile.bundles` 列表）。
2. 编辑 `%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml`，追加：

   ```yaml
   - insert:
       - id: dsh-archive-manager
         name: dsh-archive-manager
   ```

3. 重启 DSH，然后硬刷新浏览器（`Ctrl+Shift+R`）。

### 验证

- 侧边栏底部（设置按钮旁）出现**归档 / Archive** 按钮。
- 点击后：归档会话按工作区分组显示，带搜索、行内操作与底部计数。
- 打开 DSH 开发者工具，页面预加载列表中应出现 `plugins/??dsh-archive-manager/client.js`，且模块加载无报错。

## 卸载

```powershell
npx --yes @deepseek-ai/dsh plugin --profile desktop remove dsh-archive-manager
# 全局安装时等价于：
#   dsh plugin --profile desktop remove dsh-archive-manager
```

然后重启 DSH。兜底方式：执行
`powershell -ExecutionPolicy Bypass -File .\scripts\uninstall.ps1`，或手动删除 profile 的
`cordis.patch.yml` 中的 `dsh-archive-manager` 条目以及 `<profile>/node_modules/dsh-archive-manager`。

## 开发

无需构建：`src/index.js` 是（空的）宿主插件，`src/client.js` 是模块加载器格式的浏览器 bundle。检查：

```powershell
node --check src/index.js
node --check src/client.js
npm test
```

`npm test` 运行 `test/client.test.mjs`：一个零依赖的手写迷你 React 运行时，
桩掉 `window.__ModuleLoader__` / `document` / `navigator`，把插件 apply 到伪造的 `ctx` 上，断言 69 项行为：
加载契约、插槽注册（`name` / `id` / `order` / `locale`）、中文回退翻译、分组（3 个工作区 → 3 组）、
搜索过滤、单条恢复（服务调用 + toast + 响应式移除行）、恢复并打开、批量恢复、定位目录的请求体、
缺少 `unarchiveSession` 时的降级模式、空归档与窄侧边栏渲染、拖动/缩放的几何计算，以及 `Esc` 关闭。

测试只依赖本插件源码，不会接触任何 DSH 安装。

## 为什么没有“删除”功能（插件也刻意不做）

**DSH 本身不支持删除会话**（设计如此），本插件严格遵守这条边界：

1. **持久化层没有删除接口。** DSH 把每个会话存成 `~/.dsh/sessions/...` 下的**只追加** JSONL 日志。
   `dsh-session-persistence-jsonl` 的 README 明确写道：*“日志在 root 下累积，直到外部移除（seam 无删除接口）”*。
   任何 DSH 代码——包括本插件——都不会 unlink 会话日志文件。
2. **“归档”是软隐藏，不是删除。** 自带的“归档会话”只是把会话 id 加入 `archivedSessionIds`；
   日志、工作区记账席位、会话数据全部原样保留。这正是“恢复”可行的原因。
3. **清理会话是带外操作。** 如果你确实想删掉某个转录，受支持的方式是：停止 DSH 后，
   手动删除 `~/.dsh/sessions/--<项目>--/<会话id>/` 目录（搜索索引会在下次扫描时自动把它清掉）。
   「定位工作目录」按钮可以帮你快速到达会话所属的项目目录。

一句话：**查看与恢复是可逆、安全的操作；物理删除被刻意排除在范围之外**——
一个破坏性的“删除”按钮会与存储设计（只追加日志、可重建索引）冲突，还可能静默销毁本插件无法恢复的数据。

## 已知限制

- **刻意不做“删除”**——见上。
- **定位目标是工作目录**，不是转录目录：DSH 0.2 不再向客户端插件暴露会话日志路径，
  旧的“打开对话文件夹”因此改为定位 `session.cwd`。
- 面板在恢复后是乐观更新；权威的 `archivedSessionIds` 会在下一次工作区基线（重连 / 列表刷新）时重新同步。
- 若会话的 agent 仍在运行，宿主会拒绝恢复（`workspace/session-active`），面板以错误 toast 提示。

## 许可证

MIT
