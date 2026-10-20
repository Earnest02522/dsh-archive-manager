# dsh-archive-manager

[English](README.md) | [简体中文](README.zh-CN.md)

A plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) that adds
**archived-conversation management**: a sidebar entry that lists your archived
conversations — **grouped by workspace** — and lets you **restore** them
(single or **bulk**) or **reveal the transcript folder** of any archived
conversation.

> **What the built-in features cover (DSH 0.2.x).** Modern DSH ships an
> *Archive session* action, an archived filter (`default` / `show` / `only`),
> pinning, and a native `unarchiveSession` API. This plugin does not replace
> those — it adds what they do not do:
>
> - **Bulk restore** — a *Restore all* button restores every archived
>   conversation in one call instead of one-by-one.
> - **Reveal the transcript folder** of an archived session (the directory
>   holding its `session.jsonl*` log). The built-in *reveal* targets the
>   **workspace** directory, not the session log.
> - **A one-click archived overview** grouped by workspace with per-group
>   counts.
> - **DSH 0.1.x support** — on 0.1.x there is no archive filter and no
>   unarchive API at all; this plugin provides them.
>
> The browser half is defensive across versions: DSH 0.2 removed
> `sessions.open`, so the panel never assumes it exists and degrades to a
> "restored — open it from the sidebar" notice when no opener is wired.

## Features

- **View, grouped by workspace** — a popup panel (opened from a new button at
  the bottom of the sidebar) lists every archived conversation under its
  owning workspace's heading (sessions with no workspace go into
  "Ungrouped"), each row showing title, short id and last-updated time.
- **Restore** — one click removes the session from the archive set durably;
  the session reappears in the sidebar at its original position.
- **Bulk restore** — *Restore all* restores every archived conversation at
  once through the plugin's `unarchiveMany` endpoint (falls back to
  one-by-one when the bulk endpoint is unavailable).
- **Restore & open** — restores and then opens the conversation; on DSH 0.2
  (which removed the client `sessions.open`) it restores and tells you to
  open it from the sidebar instead.
- **Open conversation folder** — reveals the session's transcript directory
  (the folder holding its `session.jsonl*` log) in your platform file manager
  (Explorer / Finder / xdg-open), so you can inspect or back up the raw log.
- **Safe by construction** — the browser bundle is defensive: it never calls
  hooks that the `sidebar.footer.action` slot may not provide, never crashes
  the web shell, degrades to a read-only panel if the remote mount fails, and
  avoids the inject/mount self-deadlock (the `archiveManager` namespace is
  mounted by the bundle itself, so it is fetched with `ctx.get(...)` and is
  deliberately not listed in `inject`).
- **Zero build** — plain ESM/CommonJS-style files, no compile step; installs
  through the official `dsh plugin add` CLI or the bundled scripts.
- **i18n** — Chinese and English UI text, chosen from the browser language.

## Why there is no "delete" (and why the plugin does not add one)

Deleting a conversation is **not something DSH supports**, by design, and this
plugin intentionally stays within that boundary:

1. **The persistence seam has no delete interface.** DSH stores every session
   as an append-only JSONL log under `~/.dsh/sessions/...`. The
   `dsh-session-persistence-jsonl` README states: *"logs accumulate under the
   root until removed externally (the seam has no delete interface)"*. No DSH
   code — including this plugin — ever unlinks a transcript file.
2. **"Archive" is a soft hide, not deletion.** The built-in *Archive session*
   action only adds the session id to `archivedSessionIds`; the log, the
   workspace accounting slot, and the session's data all remain intact. That
   is precisely what makes *restore* possible.
3. **Session cleanup is out-of-band.** If you really want a transcript gone,
   the supported way is to stop DSH and remove the session's directory under
   `~/.dsh/sessions/--<project>--/<session-id>/` yourself (the sqlite search
   index then reconciles the entry away on the next scan). This plugin instead
   gives you the *Open conversation folder* button to find that directory
   quickly and safely.

In short: **view and restore are reversible and safe; physical deletion is
deliberately out of scope** — a destructive "delete" button would fight the
storage design (append-only logs, rebuildable indexes) and could silently
destroy data this plugin cannot restore.

## How it works

| Layer | What happens |
|---|---|
| Host plugin (`src/index.js`) | Registers a root-scoped Typert Remote service `ctx.archiveManager` with two endpoints: `archiveManager/unarchive` (removes a session id from `ctx.workspaceRegistry`'s `archivedSessionIds` through the registry's own serialized op queue — `enqueueOperation`/`requireState`/`setState` — and returns the updated set) and `archiveManager/openSessionFolder` (locates the session's transcript via `ctx.sessionPersistence` and reveals its directory in the platform file manager). |
| Browser plugin (`src/client.js`) | Mounts the matching strict remote descriptors via `ctx.remote.$mount`, then registers a `sidebar.footer.action` entry (button + panel). The panel reads `workspaces.list` (items + archivedSessionIds) and `sessions.list` (both reactive stores), groups archived ids by workspace accounting, calls `archiveManager/unarchive` for restore, `sessions.open(id)` to open, and `archiveManager/openSessionFolder` for the folder button. |

No DSH source is patched. The plugin is discovered by the standard loader
(the profile's `cordis.patch.yml`) and its browser half by the client module
loader (`dsh.client.platform = "web"`).

## Compatibility

- **DSH 0.2.x (desktop app)** — the primary target of v0.5.0. Uses the native
  `workspaceRegistry.unarchiveSession()` when present, reads the 0.2
  `sessionPersistence.list()` snapshot shape (`{ header, revision, sizeBytes }`)
  and `stat(id)`, and tolerates the removed client `sessions.open`.
- **DSH 0.1.x (web)** — fully supported: falls back to removing the id from
  `archivedSessionIds` through the registry op queue and accepts the legacy
  bare-header `list()` shape. Verified end-to-end on `0.1.1-rc.2`.
- Windows (scripts + Explorer reveal) — the plugin itself is platform-agnostic
  (Finder / xdg-open on macOS / Linux)

## Install

### Official CLI — npx (recommended, no global install)

```powershell
npx --yes @deepseek-ai/dsh plugin --profile desktop add https://github.com/Earnest02522/dsh-archive-manager.git
```

The desktop app's profile is `desktop`; on older web installs use
`--profile web`.

`npx --yes @deepseek-ai/dsh` runs the official CLI straight from the npx cache,
so **no global install is needed** — most machines do not have `dsh` on `PATH`.

### Or: global install, then plain `dsh`

If you prefer to have the CLI installed globally (or already do):

```powershell
npm install -g @deepseek-ai/dsh
dsh plugin --profile desktop add https://github.com/Earnest02522/dsh-archive-manager.git
```

Both forms are equivalent; the rest of this page uses the npx form.

The package declares a `dsh.bundle` manifest, so the `plugin add` subcommand installs the
dependency **and** registers its loader line automatically — no manual patch
editing needed. From a local checkout, a file path works too:

```powershell
npx --yes @deepseek-ai/dsh plugin --profile desktop add "file:D:\path\to\dsh-archive-manager"
```

> After install: restart DSH (or let the patch HMR re-compose the config),
> then hard-refresh the browser (`Ctrl+Shift+R`).
> Non-default profiles: swap `web` for e.g. `headless` in the command above.

### Windows install script (legacy)

Open PowerShell and `cd` into the repo folder first, then run the script:

```powershell
cd <path-to-repo>          # e.g. cd D:\dsh-archive-manager
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

Or from anywhere, with the repo at `<repo>`:

```powershell
powershell -ExecutionPolicy Bypass -File <repo>\scripts\install.ps1
# non-default profile:
powershell -ExecutionPolicy Bypass -File <repo>\scripts\install.ps1 -ProfileName desktop
```

The script auto-detects the profile (`desktop` on DSH 0.2.x, `web` on 0.1.x)
and the plugin directory (`<profile>/node_modules`, falling back to the
hoisted `profiles/node_modules`), copies the plugin in, and enables it in the
profile's `cordis.patch.yml` (a timestamped backup of the patch file is created
first). If the plugin entry already exists it is a no-op.

> After install: restart DSH (or let the patch HMR re-compose the config),
> then hard-refresh the browser (`Ctrl+Shift+R`).

### Linux / macOS install script

The repo also bundles a bash installer with the same auto-detection:

```bash
cd <path-to-repo>          # e.g. cd ~/dsh-archive-manager
bash scripts/install.sh
# non-default profile / scoped package name:
bash scripts/install.sh web "@earnest020522/dsh-archive-manager"
```

It uses `$DSH_HOME` when set, otherwise `~/.dsh`, and handles the empty
`[]` patch template automatically.

### Manual install

1. Copy this folder to
   `%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-archive-manager`
   (DSH 0.2.x; on 0.1.x use the hoisted
   `%USERPROFILE%\.dsh\profiles\node_modules\dsh-archive-manager`).
2. Edit `%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml` and append:

   ```yaml
   - insert:
       - id: dsh-archive-manager
         name: dsh-archive-manager
   ```

3. Restart DSH (or let the patch HMR re-compose the config), then hard-refresh
   the browser (`Ctrl+Shift+R`).

### Verify

- The sidebar foot now shows an **归档 / Archive** button next to Settings.
- Click it: archived conversations are listed under their workspace headings
  with **Open**, **Restore** and folder-icon actions.
- You can also probe the host endpoints directly:

  ```
  POST /api/archiveManager/unarchive
  {"type":"client-request","rpcId":"x","method":"archiveManager/unarchive",
   "payload":{"args":{"request":{"sessionId":"<archived-session-id>"}}}}

  POST /api/archiveManager/openSessionFolder
  {"type":"client-request","rpcId":"x","method":"archiveManager/openSessionFolder",
   "payload":{"args":{"request":{"sessionId":"<archived-session-id>"}}}}
  ```

## Uninstall

```powershell
npx --yes @deepseek-ai/dsh plugin --profile desktop remove dsh-archive-manager
# with a global install, the equivalent is:
#   dsh plugin --profile desktop remove dsh-archive-manager
```

then restart DSH. Legacy fallbacks: run
`powershell -ExecutionPolicy Bypass -File .\scripts\uninstall.ps1`, or manually
remove the `dsh-archive-manager` loader entry from the profile's
`cordis.patch.yml` and delete
`%USERPROFILE%\.dsh\profiles\node_modules\dsh-archive-manager`.

## Development

No build step: `src/index.js` is the host plugin, `src/client.js` is the
browser bundle (module-loader format). Sanity checks:

```powershell
node --check src/index.js
node --check src/client.js
```

Host-side smoke test (real cordis `Context` + stub registry/persistence):

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

## Known limitations

- **No "delete" feature by design** — see *Why there is no "delete"* above.
- The panel refreshes optimistically on restore; the authoritative
  `archivedSessionIds` set re-syncs on the next workspace baseline
  (reconnect / list refresh).
- `openSessionFolder` reveals the *transcript* directory (under
  `~/.dsh/sessions/...`), not the project workspace directory.
- Removing a session's transcript file by hand is out of scope and will not
  be "restored" (the endpoint leaves the set unchanged for unknown ids).

## License

MIT
