# dsh-archive-manager

[English](README.md) | [简体中文](README.zh-CN.md)

A plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) that adds
**archived-conversation management**: a sidebar entry that lists your archived
conversations — **grouped by workspace** — and lets you **view** (open),
**restore** (unarchive), or **reveal the transcript folder** of any archived
conversation.

> **Background.** DSH has a built-in *Archive session* action (it hides a
> conversation from the sidebar by adding its id to the registry-global
> `archivedSessionIds` set), but it ships **no way to view archived sessions
> and no unarchive API** — the shipped `dsh-client-ui-workspace` README lists
> "no viewing or unarchive surface" as a known gap. The underlying transcript
> (`session.jsonl*`) is **never deleted** by any DSH code (the persistence seam
> has no delete interface), so *restore* is exactly: remove one session id from
> the archive set. This plugin implements exactly that, as a normal cordis
> plugin — no core modifications.

## Features

- **View, grouped by workspace** — a popup panel (opened from a new button at
  the bottom of the sidebar) lists every archived conversation under its
  owning workspace's heading (sessions with no workspace go into
  "Ungrouped"), each row showing title, short id and last-updated time.
- **Restore** — one click removes the session from the archive set durably;
  the session reappears in the sidebar at its original position.
- **Open** — *restore + open* in one step (an archived session cannot stay
  open, so opening first unarchives it).
- **Open conversation folder** — reveals the session's transcript directory
  (the folder holding its `session.jsonl*` log) in your platform file manager
  (Explorer / Finder / xdg-open), so you can inspect or back up the raw log.
- **Safe by construction** — the browser bundle is defensive: it never calls
  hooks that the `sidebar.footer.action` slot may not provide, never crashes
  the web shell, degrades to a read-only panel if the remote mount fails, and
  avoids the inject/mount self-deadlock (the `archiveManager` namespace is
  mounted by the bundle itself, so it is fetched with `ctx.get(...)` and is
  deliberately not listed in `inject`).
- **Zero build** — plain ESM/CommonJS-style files, copy-to-install, no
  compile step.
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

- DeepSeek Harness `0.1.0-rc.x` (tested on `0.1.0-rc.6`, web profile)
- Windows (scripts + Explorer reveal) — the plugin itself is platform-agnostic
  (Finder / xdg-open on macOS / Linux)

## Install

### One-command install (Windows)

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

Or from anywhere, with the repo at `<repo>`:

```powershell
powershell -ExecutionPolicy Bypass -File <repo>\scripts\install.ps1
# non-default profile:
powershell -ExecutionPolicy Bypass -File <repo>\scripts\install.ps1 -ProfileName headless
```

The script copies the plugin into
`%USERPROFILE%\.dsh\profiles\node_modules\dsh-archive-manager` and enables it
in `%USERPROFILE%\.dsh\profiles\web\cordis.patch.yml` (a timestamped backup of
the patch file is created first). If the plugin entry already exists it is a
no-op.

> After install: restart DSH (or let the patch HMR re-compose the config),
> then hard-refresh the browser (`Ctrl+Shift+R`).

### Manual install

1. Copy this folder to
   `%USERPROFILE%\.dsh\profiles\node_modules\dsh-archive-manager`
   (create the folder if needed; the profile's `node_modules` is the hoisted
   resolution root for the loader).
2. Edit `%USERPROFILE%\.dsh\profiles\web\cordis.patch.yml` and append:

   ```yaml
   - insert:
       - id: dsh-archive-manager
         name: dsh-archive-manager
   ```

3. Restart DSH (or let the patch HMR re-compose the config), then hard-refresh
   the browser (`Ctrl+Shift+R`).

### Via the official CLI (installs the dependency, still needs the patch)

```powershell
dsh plugin --profile web add "file:<repo>"
```

`dsh plugin` forwards to pnpm and only auto-activates packages that declare a
`dsh.bundle`; this UI plugin does not, so it is installed as a plain
dependency — you still need step 2 (the `cordis.patch.yml` insert) above.

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
powershell -ExecutionPolicy Bypass -File .\scripts\uninstall.ps1
```

or manually: remove the `dsh-archive-manager` entry from
`cordis.patch.yml` and delete
`%USERPROFILE%\.dsh\profiles\node_modules\dsh-archive-manager`, then restart
DSH.

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
