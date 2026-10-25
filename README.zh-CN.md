# dsh-archive-manager（归档会话管理插件）

[English](README.md) | [简体中文](README.zh-CN.md)

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 提供**归档会话管理**的插件：
在侧边栏底部新增入口，弹出面板**按工作区归类**列出所有已归档会话，可搜索，支持
**单条恢复 / 全部恢复**、**恢复并打开**、**定位会话的工作目录**，以及**永久删除**。

> **新版内置能力说明（DSH 0.2.x）。** 新版 DSH 已自带“归档会话”操作、归档过滤（`default` / `show` / `only`）、
> 置顶（pin）以及原生归档 API。本插件不重复造这些轮子，而是补齐它们没有做的：
>
> - **归档总览**：一个面板列出**全部**归档会话，按工作区分组并带数量统计。
> - **批量恢复**：「恢复全部」一次性清空归档，而不是在侧边栏逐条取消归档。
> - **搜索**：按标题、会话 id 或工作目录过滤归档。
> - **恢复并打开**：恢复后直接把会话切到主视图。
> - **永久删除**：在行内二次确认后，从磁盘上删除该归档会话。
> - **定位工作目录**：在文件管理器中打开该会话所属的项目目录。

## 功能

- **归档总览（按工作区分组）**：点击侧边栏底部（`sidebar.footer.action` 插槽）的按钮弹出面板。
  每个归档会话显示在其所属工作区标题下（没有工作区认领的归入「未分组」），按更新时间倒序，
  每行展示标题、短会话 id、相对时间与工作目录。
- **恢复**：调用 DSH 自带的 `workspaces.unarchiveSession(...)`，因此侧边栏、工作区记账与持久化层保持一致。
- **全部恢复**：依次恢复所有归档会话（以及当前搜索命中的会话），部分失败会汇总提示而不会中断。
- **恢复并打开**：恢复后通过 `uiWorkspace` 服务把会话切到主视图（该服务不存在时自动跳过）。
- **定位工作目录**：通过 `session/openWorkspacePath { action: "reveal" }` 让宿主在系统文件管理器中打开会话的 `cwd`。
- **永久删除**：唯一的破坏性操作，需在行内点一次「删除？」确认。宿主编排：先查会话是否有正在运行的任务，
  再经 `sessionPersistence.stat` / `locate` 定位日志并 unlinking，随后从 `archivedSessionIds` 移除、
  从各工作区摘除该 id，并广播 `api-session/removed`，侧边栏无需重启即消失。运行中的会话会被拒绝（`session-active`）。
- **键鼠友好**：`Esc` 关闭面板；标题栏可拖动；上下左右四边与四角共八个方向可缩放；几何位置被限制在视口内；触屏设备上操作按钮常显。
- **中英双语**：优先使用 DSH 的 locale，其次跟随浏览器语言。
- **客户端界面 + 一个宿主远程方法**：面板本身是直接下发的 ESM（无构建步骤）；唯一需要写文件的破坏性操作交给一个小宿主服务，而不是让页面绕过沙箱。

## 为什么大部分逻辑仍在客户端

0.5.x 及更早的版本在宿主侧注册了一个根级 Typert Remote 服务 `ctx.archiveManager`，浏览器端用
`ctx.remote.$mount(...)` 挂载手写描述符。这套做法在 DSH 0.2 上无法工作：外部贡献的描述符会被严格校验
（`validateContribution` → `requireStrictInputs`，且命名空间不能与内置 `remote.*` 服务冲突），
而归档本身也已成为 `workspaces` 客户端服务的一等能力——可逆的操作完全没必要自定义远程方法。

删除恰好是 DSH **没有**提供的能力：`sessionController` 没有删除端点，`workspace-files` 只读，
浏览器也碰不到 `~/.dsh/sessions/...`。所以 0.7.0 只新增一个宿主远程方法：

| 层 | 做什么 |
|---|---|
| 宿主插件（`src/index.js`） | `ArchiveManagerService extends TypertRemoteService`（服务键 / 命名空间 `archiveManager`），仅暴露 `deleteSession(request)`：检查是否仍在运行 → 通过 `sessionPersistence.stat` + `locate` 定位日志 → unlink → 从 `archivedSessionIds` 移除 → 从所有工作区 `detachSession` → 广播 `api-session/removed`。方法返回结果值（`{ deleted: true, … }` 或 `{ deleted: false, reason }`），不靠抛异常表达“预期内拒绝”。 |
| 浏览器插件（`src/client.js`） | 在 `sidebar.footer.action` 插槽注册条目。以响应式快照 store 读取 `workspaces.list`（`{ items, archivedSessionIds, pinnedSessionIds, … }`）与 `sessions.list`（`{ ids, byId, … }`），按工作区记账把归档 id 分组；恢复走 `workspaces.unarchiveSession(id)`，打开走 `uiWorkspace.openSession(id)`，定位目录走 `remote.session.openWorkspacePath({ path, action: "reveal" })`，删除走挂载后的 `remote.archiveManager.deleteSession({ sessionId })`。挂载失败时面板照常渲染，仅删除按钮提示「不可用」。 |

不修改任何 DSH 源码。插件由标准加载器（profile 的 `cordis.patch.yml` / `dsh.profile.bundles`）发现，
浏览器端由客户端模块加载器发现（`dsh.client.platform = "web"`）。

## 兼容性

- **DSH 0.2.1-rc.3 及更新版本（桌面版）**——已针对 `@deepseek-ai/dsh-desktop-runtime 0.2.1-rc.3` 验证：
  宿主服务注册成功、`archiveManager/deleteSession` 端点在真实网关上可用、bundle 能被正常下发、
  插槽注册成功、面板可基于真实的 `workspaces` / `sessions` / `remote.session` 服务渲染。
- **版本门禁**：清单声明 `engines.dsh`（`>=0.2.1-0 <1.0.0`），这是 DSH 0.2 唯一评估的兼容条件。
  旧版本改用 `@deepseek-ai/dsh-*` 的 peer 依赖范围，而 semver 的预发布规则会让 `0.2.1-rc.3`
  不满足 `>=0.1.0-rc.6`——这正是 0.5.x 被判定为“与当前桌面版不兼容”的原因。
- **不再支持 DSH 0.1.x**：插件依赖 `workspaces` 客户端服务（归档快照 + `unarchiveSession`）、
  `session/openWorkspacePath` 端点，以及 0.2 线的 `TypertRemoteService` / `@Remote` 宿主 API。
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
- 鼠标悬停某行：垃圾桶图标即「删除」；点一次出现行内确认，确认后提示「已删除 / Deleted」。
  运行中的会话会被拒绝，删除成功后该行会自动消失。
- 宿主半可用时 `archiveManager/deleteSession` 才会应答；宿主半缺失只会禁用垃圾桶图标，其余功能正常。
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

无需构建：`src/index.js` 是宿主插件（一个远程方法），`src/client.js` 是模块加载器格式的浏览器 bundle。检查：

```powershell
node --check src/index.js
node --check src/client.js
node test/client.test.mjs
```

`node test/client.test.mjs` 运行一个零依赖的手写迷你 React 运行时，
桩掉 `window.__ModuleLoader__` / `document` / `navigator`，把插件 apply 到伪造的 `ctx` 上，断言 111 项行为：
加载契约、插槽注册（`name` / `id` / `order` / `locale`）、中文回退翻译、分组（3 个工作区 → 3 组）、
搜索过滤、单条恢复（服务调用 + toast + 响应式移除行）、恢复并打开、批量恢复、定位目录的请求体、
删除的二次确认流程（确认前一条都不删、描述符带上网关要求的 strict codec、挂载结果复用、删除后再同步一次归档快照）、
会话仍在运行时拒绝删除、缺少 `unarchiveSession` 或没有远程网关时的降级模式、空归档与窄侧边栏渲染、
拖动/缩放的几何计算、`Esc` 关闭，以及对两侧源码的静态断言
（浏览器端只 require `react`、不再给旧端点手写 `$mount` 描述符、不直接 `unlink`；
宿主端只 import `node:fs/promises` 与 Typert 协议、只删单个文件而非整棵目录）。

测试只依赖本插件源码，不会接触任何 DSH 安装。

## 删除是怎么做的（代价是什么）

“删除”**不是**归档操作——归档只是把会话 id 藏起来。删除是破坏性的，不可撤销：

1. **会话在运行时会拒绝。** 宿主先询问 `workspace/session-activity` 瀑布；只要有活跃任务，
   请求就返回 `{ deleted: false, reason: "session-active" }`，面板提示先停止运行。
2. **删除的是转录文件本身。** 宿主通过 `sessionPersistence.stat(id)` + `locate(...)`
   定位日志（能处理 `.jsonl.zstd` 压缩日志），只 unlink 那一个文件；文件已不存在时仍算成功
   （`existed: false`）。
3. **同时清理记账。** 会话 id 会从 `archivedSessionIds` 移除（`workspaces.unarchiveSession`）、
   从所有包含它的工作区 `detachSession`，并广播 `api-session/removed`，已打开的窗口无需重启即掉行；
   DSH 自己的查询索引会在下次扫描时对齐。
4. **无法撤销。** 没有回收站、没有 undo，内置的“恢复”也无从恢复。
   只是想让会话从视野里消失，请用「归档」。

由于持久化层刻意不提供删除接口，这是本插件唯一越出 DSH 原生 API 的地方——
因此加了显式二次确认，以及“仍在运行”的前置拦截。

## 已知限制

- **删除是永久的**——没有回收站、没有撤销。操作有行内二次确认、运行中会被拒绝，
  但一旦成功，转录文件就没了。
- **定位目标是工作目录**，不是转录目录：DSH 0.2 不再向客户端插件暴露会话日志路径，
  旧的“打开对话文件夹”因此改为定位 `session.cwd`。
- **投影缓存会保留**：删除只 unlink 会话日志；`storages/session_projcache/` 下那条记录属于 DSH 自己的缓存，
  由宿主在下次扫描时对齐，插件不去动它。
- 面板在恢复 / 删除后是乐观更新；权威的 `archivedSessionIds` 会在下一次工作区基线（重连 / 列表刷新）时重新同步。
- 若会话的 agent 仍在运行，宿主会拒绝恢复或删除，面板以错误 toast 提示。

## 许可证

MIT
