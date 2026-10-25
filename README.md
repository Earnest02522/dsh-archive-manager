# dsh-archive-manager

[English](README.md) | [简体中文](README.zh-CN.md)

A plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) that adds
**archived-conversation management**: a sidebar entry that lists your archived
conversations — **grouped by workspace**, searchable — and lets you **restore**
them one by one or **all at once**, open one straight back into the main view,
or jump to the folder the conversation belongs to.

> **What the built-in features cover (DSH 0.2.x).** Modern DSH already ships an
> *Archive session* action, an archived filter (`default` / `show` / `only`),
> pinning, and a native archive API. This plugin does not replace those — it
> adds what they do not do:
>
> - **A single archived overview** — one panel that lists *every* archived
>   conversation, grouped by workspace, with per-group counts.
> - **Bulk restore** — a *Restore all* button drains the archive in one go,
>   instead of unarchiving conversations one by one from the sidebar.
> - **Search** — filter the archive by title, session id or working directory.
> - **Restore & open** — restore a conversation and immediately reveal it in
>   the main view.
> - **Reveal the working directory** of an archived conversation.

## Features

- **Archived overview, grouped by workspace** — popup panel opened from a
  button at the bottom of the sidebar (`sidebar.footer.action`). Every archived
  conversation is listed under its workspace heading (sessions that no
  workspace claims fall into *Ungrouped*), newest first, with title, short
  session id, relative time and working directory.
- **Restore** — removes the session from the archive set through DSH's own
  `workspaces.unarchiveSession(...)` service, so the sidebar, the workspace
  accounting and the durability layer all stay in sync.
- **Restore all** — restores every archived conversation (and every
  conversation matching the current search) sequentially, reporting partial
  failures instead of stopping.
- **Restore & open** — restores and then opens the conversation in the main
  view through the `uiWorkspace` service (skipped gracefully when that service
  is not available).
- **Reveal working directory** — asks the host to reveal the session's `cwd`
  in the platform file manager (`session/openWorkspacePath { action: "reveal" }`).
- **Keyboard and pointer friendly** — `Esc` closes the panel, the header drags,
  all eight edges/corners resize, the geometry is clamped to the viewport, and
  row actions stay visible on touch devices.
- **i18n** — Chinese and English UI text, picked from the DSH locale first and
  the browser language second.
- **Client-only, zero build** — no host service, no Typert remote, no compile
  step. Plain ESM sources plus a module-loader browser bundle.

## Why this is a client-only plugin now

Older releases (≤ 0.5.x) registered a root Typert Remote service
(`ctx.archiveManager`) on the host and mounted a hand-written descriptor from
the browser bundle with `ctx.remote.$mount(...)`. DSH 0.2 validates contributed
descriptors strictly (`validateContribution` → `requireStrictInputs`, plus
namespace collisions against the built-in `remote.*` services), and the archive
feature became a first-class part of the `workspaces` client service. A custom
remote is therefore both fragile and unnecessary.

v0.6.0 keeps only the part that has to be custom — the UI — and talks to the
services DSH already provides:

| Layer | What happens |
|---|---|
| Host plugin (`src/index.js`) | `export function apply() {}` — deliberately empty. No service, no inject list, no patch beyond registering the bundle. |
| Browser plugin (`src/client.js`) | Registers a `sidebar.footer.action` slot entry. Reads `workspaces.list` (`{ items, archivedSessionIds, pinnedSessionIds, … }`) and `sessions.list` (`{ ids, byId, … }`) as reactive snapshot stores, groups archived ids by workspace accounting, restores through `workspaces.unarchiveSession(id)`, opens through `uiWorkspace.openSession(id)`, and reveals through `remote.session.openWorkspacePath({ path, action: "reveal" })`. |

No DSH source is patched. The plugin is discovered by the standard loader (the
profile's `cordis.patch.yml` / `dsh.profile.bundles`) and its browser half by
the client module loader (`dsh.client.platform = "web"`).

## Compatibility

- **DSH 0.2.1-rc.3 and newer (desktop app)** — verified against
  `@deepseek-ai/dsh-desktop-runtime 0.2.1-rc.3`: the bundle is served, the slot
  is registered and the panel renders against the live `workspaces` /
  `sessions` / `remote.session` services.
- **DSH 0.1.x is no longer supported.** The plugin relies on the `workspaces`
  client service (archive snapshot + `unarchiveSession`) and the
  `session/openWorkspacePath` endpoint, both introduced with the 0.2 line.
- Platform-agnostic: revealing a folder is delegated to the host, so it works
  with Explorer, Finder and xdg-open alike.

## Install

### Official CLI — npx (recommended, no global install)

```powershell
npx --yes @deepseek-ai/dsh plugin --profile desktop add https://github.com/Earnest02522/dsh-archive-manager.git
```

The desktop app's profile is `desktop`; a `dsh web` install uses `--profile web`.

`npx --yes @deepseek-ai/dsh` runs the official CLI straight from the npx cache,
so **no global install is needed** — most machines do not have `dsh` on `PATH`.

> The desktop profile must exist before installing: open DeepSeek Harness
> Desktop once, then fully quit it while running the command.

### Or: global install, then plain `dsh`

```powershell
npm install -g @deepseek-ai/dsh
dsh plugin --profile desktop add https://github.com/Earnest02522/dsh-archive-manager.git
```

Both forms are equivalent. The package declares a `dsh.bundle` manifest, so
`plugin add` installs the dependency **and** registers its loader line
automatically — no manual patch editing. From a local checkout a path works too:

```powershell
npx --yes @deepseek-ai/dsh plugin --profile desktop add "file:D:\path\to\dsh-archive-manager"
```

> After install: restart DSH (or let the patch HMR re-compose the config), then
> hard-refresh the browser (`Ctrl+Shift+R`).

### Windows install script (legacy fallback)

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

The script auto-detects the profile (`desktop`, then `web`, then the only
profile present), copies the plugin into `<profile>/node_modules`, and enables
it in the profile's `cordis.patch.yml` (a timestamped backup is created first).
If the entry already exists it is a no-op.

### Linux / macOS install script

The repo also bundles a bash installer with the same auto-detection:

```bash
cd <path-to-repo>          # e.g. cd ~/dsh-archive-manager
bash scripts/install.sh
# non-default profile / scoped package name:
bash scripts/install.sh web "@earnest020522/dsh-archive-manager"
```

It uses `$DSH_HOME` when set, otherwise `~/.dsh`, and handles the empty `[]`
patch template automatically.

### Manual install

1. Copy this folder to
   `%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-archive-manager`
   (or into the `dsh.profile.bundles` list of the profile you use).
2. Edit `%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml` and append:

   ```yaml
   - insert:
       - id: dsh-archive-manager
         name: dsh-archive-manager
   ```

3. Restart DSH, then hard-refresh the browser (`Ctrl+Shift+R`).

### Verify

- The sidebar foot shows a **归档 / Archive** button next to Settings.
- Click it: archived conversations appear under their workspace headings with
  search, row actions and a footer counter.
- With DSH's devtools open, the browser bundle
  `plugins/??dsh-archive-manager/client.js` must appear in the page's preload
  list and must not raise a module-loader error.

## Uninstall

```powershell
npx --yes @deepseek-ai/dsh plugin --profile desktop remove dsh-archive-manager
# with a global install, the equivalent is:
#   dsh plugin --profile desktop remove dsh-archive-manager
```

then restart DSH. Legacy fallbacks: run
`powershell -ExecutionPolicy Bypass -File .\scripts\uninstall.ps1`, or remove the
`dsh-archive-manager` loader entry from the profile's `cordis.patch.yml` and
delete `<profile>/node_modules/dsh-archive-manager`.

## Development

No build step: `src/index.js` is the (empty) host plugin, `src/client.js` is the
browser bundle in module-loader format. Sanity checks:

```powershell
node --check src/index.js
node --check src/client.js
npm test
```

`npm test` runs `test/client.test.mjs`, a dependency-free harness with a
hand-written mini React runtime that stubs `window.__ModuleLoader__`,
`document` and `navigator`, applies the plugin to a fake `ctx`, and asserts 69
behaviours: the load contract, slot registration (`name` / `id` / `order` /
`locale`), Chinese fallback translation, grouping (3 workspaces → 3 groups),
search filtering, single restore (service call + toast + reactive row removal),
restore-and-open, bulk restore, reveal request payload, degraded mode without
`unarchiveSession`, empty-archive and narrow-sidebar rendering, drag/resize
geometry math, and `Esc` handling.

The plugin's own sources are the only inputs; the harness never touches a DSH
installation.

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
   workspace accounting slot, and the session's data all remain intact. That is
   precisely what makes *restore* possible.
3. **Session cleanup is out-of-band.** If you really want a transcript gone,
   the supported way is to stop DSH and remove the session's directory under
   `~/.dsh/sessions/--<project>--/<session-id>/` yourself (the search index then
   reconciles the entry away on the next scan). The *Reveal working directory*
   action helps you get to a conversation's project folder quickly.

In short: **view and restore are reversible and safe; physical deletion is
deliberately out of scope** — a destructive "delete" button would fight the
storage design (append-only logs, rebuildable indexes) and could silently
destroy data this plugin cannot restore.

## Known limitations

- **No "delete" feature by design** — see above.
- **Reveal targets the working directory**, not the transcript directory: DSH
  0.2 no longer exposes a session-log path to client plugins, so the old
  "open conversation folder" action was re-pointed at `session.cwd`.
- The panel refreshes optimistically on restore; the authoritative
  `archivedSessionIds` set re-syncs with the next workspace baseline
  (reconnect / list refresh).
- Restoring a session whose agent is still running is refused by the host
  (`workspace/session-active`); the panel surfaces that as an error toast.

## License

MIT
