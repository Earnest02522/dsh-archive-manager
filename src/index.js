/**
 * dsh-archive-manager — Host half.
 *
 * The Host half deliberately does nothing. Everything this plugin needs already
 * exists in the DSH 0.2 runtime and is reachable from the browser:
 *
 *   ctx.workspaces.list                 snapshot: { items, archivedSessionIds, pinnedSessionIds, ... }
 *   ctx.workspaces.unarchiveSession(id) restore one archived session (durable, Host-authoritative)
 *   ctx.sessions.list                   snapshot: { ids, byId } — displayTitle / cwd / updatedAt per session
 *   ctx.uiWorkspace.openSession(id)     reveal a session in the main view (optional)
 *   ctx.remote.session.openWorkspacePath({ path, action: "reveal" })
 *                                       reveal a directory in the OS file manager (optional)
 *
 * The previous design (<= 0.5.x) registered a root Typert Remote service
 * (`ctx.archiveManager`) with hand-written `@Remote` markers and mounted a
 * matching descriptor contribution from the browser. DSH 0.2 validates
 * contributed Remote descriptors strictly (`validateContribution` /
 * `requireStrictInputs`) and ships the archive API natively, so a custom
 * service only adds failure modes: a mis-specified codec made `$mount()` throw
 * and the whole browser half silently degraded to "no button". A pure UI
 * plugin — the shape of `@deepseek-ai/dsh-client-ui-open-in-app` — has no such
 * seam and keeps working across 0.2.x releases.
 *
 * @module dsh-archive-manager
 */

/**
 * Host plugin entry point. Kept as a no-op so the package stays loadable from
 * the profile's `cordis.patch.yml` (the bundle layer still inserts this id).
 */
export function apply() {}
