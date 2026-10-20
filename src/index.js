/**
 * dsh-archive-manager — server (host) half.
 *
 * A DeepSeek Harness cordis plugin that adds root-scoped Typert Remote
 * endpoints so the GUI can manage archived conversations:
 *
 *   - `archiveManager/unarchive(sessionId)`        — restore one session.
 *   - `archiveManager/unarchiveMany(sessionIds)`   — restore a batch (bulk).
 *   - `archiveManager/openSessionFolder(sessionId)` — reveal the session's
 *     transcript folder (the directory holding its `session.jsonl*`) in the
 *     platform file manager.
 *
 * Compatibility:
 *   - DSH 0.2.x ships `workspaceRegistry.unarchiveSession()`; we delegate to it
 *     (same serialized op queue, same durability semantics) when present.
 *   - DSH 0.1.x has no unarchive API; we fall back to removing the id from the
 *     registry's `archivedSessionIds` through `enqueueOperation`/`setState`.
 *   - DSH 0.2.x `sessionPersistence.list()` returns `{ header, revision,
 *     sizeBytes }` snapshots (and exposes `stat(id)`); 0.1.x returned bare
 *     headers. `openSessionFolder` accepts both shapes.
 *
 * Why there is no "delete": DSH has no session-delete API by design. The
 * sidebar "Archive session" action only adds a session id to the archive set
 * (hiding it from grouping surfaces), and the persistence seam has no delete
 * interface at all — transcripts are append-only and accumulate until removed
 * externally. Deleting a conversation permanently is out of scope for this
 * plugin (see README "Why there is no delete").
 *
 * Endpoints are plain `@Remote`s on a `TypertRemoteService` with root
 * ("direct") scope. The gateway's source-mode discovery picks them up at
 * runtime; the browser half mounts matching strict descriptors via
 * `ctx.remote.$mount` and reaches the service through `ctx.get(...)`.
 */
import { TypertRemoteService, Remote } from "@deepseek-ai/dsh-typert-protocol";
import { dirname } from "node:path";
import { spawn } from "node:child_process";

/** Marker initializers produced by the @Remote decorators. */
const markerInitializers = [];
for (const method of ["unarchive", "unarchiveMany", "openSessionFolder"]) {
	Remote(method)(void 0, {
		kind: "method",
		name: method,
		static: false,
		private: false,
		metadata: {},
		addInitializer(fn) {
			markerInitializers.push(fn);
		}
	});
}

/**
 * Reveal a directory in the platform file manager (fire-and-forget, never
 * blocks or throws on the GUI side of the launch).
 */
function revealInFileManager(dir) {
	const platform = process.platform;
	const cmd = platform === "win32" ? "explorer" : platform === "darwin" ? "open" : "xdg-open";
	const child = spawn(cmd, [dir], { detached: true, stdio: "ignore" });
	child.on("error", () => {
		/* the file manager is missing; nothing useful to do */
	});
	child.unref();
}

/** Normalize a named RPC payload into a single session id string. */
function idOf(request) {
	return String(request && request.sessionId ? request.sessionId : "");
}

/** Normalize a named RPC payload into a session id list. */
function idsOf(request) {
	const raw = request && Array.isArray(request.sessionIds) ? request.sessionIds : [];
	return raw.map((id) => String(id)).filter((id) => id.length > 0);
}

/** Archive-manager remote service; registers itself as `ctx.archiveManager`. */
export class ArchiveManagerService extends TypertRemoteService {
	constructor(ctx) {
		super(ctx, "archiveManager");
		// Capture deps when the constructing context exposes them; `apply`
		// overrides from its (injected) context to cover receiver-context gaps.
		this._registry = this.safeGet(ctx, "workspaceRegistry");
		this._persistence = this.safeGet(ctx, "sessionPersistence");
		for (const init of markerInitializers) init.call(this);
	}

	/** Read a service defensively (a missing/inject-less ctx must not crash load). */
	safeGet(ctx, name) {
		try {
			return ctx ? (ctx.get ? ctx.get(name) : ctx[name]) : void 0;
		} catch {
			return void 0;
		}
	}

	/** Reject when the workspace registry is absent or unusable. */
	requireRegistry() {
		const registry = this._registry;
		if (!registry || typeof registry.enqueueOperation !== "function") {
			throw new Error("workspace registry unavailable");
		}
		return registry;
	}

	/**
	 * Restore one session: prefer the host's native `unarchiveSession` (0.2.x),
	 * otherwise remove the id from the archive set through the registry's own
	 * serialized op queue (0.1.x).
	 */
	async restoreOne(sessionId) {
		const registry = this.requireRegistry();
		if (typeof registry.unarchiveSession === "function") {
			await registry.unarchiveSession(sessionId);
			return;
		}
		await registry.enqueueOperation(async () => {
			const state = registry.requireState();
			if (!state.archivedSessionIds.includes(sessionId)) return;
			await registry.setState({
				...state,
				archivedSessionIds: state.archivedSessionIds.filter((id) => id !== sessionId)
			});
		});
	}

	/**
	 * Remove one session from the global archive set.
	 * @param {{sessionId: string}} request - named RPC payload.
	 * @returns {{archivedSessionIds: string[]}} full updated archive set.
	 */
	async unarchive(request) {
		const sessionId = idOf(request);
		const registry = this.requireRegistry();
		await this.restoreOne(sessionId);
		return { archivedSessionIds: [...registry.archivedSessionIds] };
	}

	/**
	 * Restore several sessions in one call (bulk restore).
	 * @param {{sessionIds: string[]}} request - named RPC payload.
	 * @returns {{archivedSessionIds: string[], restored: number}} updated set.
	 */
	async unarchiveMany(request) {
		const ids = idsOf(request);
		const registry = this.requireRegistry();
		let restored = 0;
		for (const sessionId of ids) {
			const before = Array.isArray(registry.archivedSessionIds) ? registry.archivedSessionIds.length : 0;
			await this.restoreOne(sessionId);
			const after = Array.isArray(registry.archivedSessionIds) ? registry.archivedSessionIds.length : 0;
			if (after < before) restored += 1;
		}
		return { archivedSessionIds: [...registry.archivedSessionIds], restored };
	}

	/**
	 * Resolve a session's stored header across DSH versions.
	 * 0.2.x: `stat(id)` / `list()` snapshots carry `{ header, revision, ... }`.
	 * 0.1.x: `list()` returned bare headers.
	 * @param {string} sessionId - the session to resolve.
	 * @returns {object|undefined} the stored header, when resolvable.
	 */
	async resolveHeader(sessionId) {
		const persistence = this._persistence;
		if (!persistence) return void 0;
		if (typeof persistence.stat === "function") {
			try {
				const snapshot = await persistence.stat(sessionId, {});
				if (snapshot) return snapshot.header && snapshot.header.id ? snapshot.header : snapshot;
			} catch {
				/* fall through to list() */
			}
		}
		if (typeof persistence.list === "function") {
			const entries = await persistence.list({});
			const list = Array.isArray(entries) ? entries : [];
			const entry = list.find((candidate) => (candidate && candidate.header && candidate.header.id ? candidate.header.id : candidate && candidate.id) === sessionId);
			if (entry) return entry.header && entry.header.id ? entry.header : entry;
		}
		return void 0;
	}

	/**
	 * Reveal the session's transcript folder in the platform file manager.
	 * @param {{sessionId: string}} request - named RPC payload.
	 * @returns {{path: string}} the revealed directory.
	 */
	async openSessionFolder(request) {
		const sessionId = idOf(request);
		const persistence = this._persistence;
		if (!persistence || typeof persistence.locate !== "function") {
			throw new Error("session persistence unavailable");
		}
		const header = await this.resolveHeader(sessionId);
		if (!header) throw new Error("session not found: " + sessionId);
		const location = persistence.locate(header);
		if (!location || typeof location.path !== "string" || location.path.length === 0) {
			throw new Error("cannot locate session log: " + sessionId);
		}
		const dir = dirname(location.path);
		revealInFileManager(dir);
		return { path: dir };
	}
}

/**
 * Cordis plugin entry. Instantiating the service registers `ctx.archiveManager`
 * (which is also the Typert wire namespace), and the gateway's source-mode
 * discovery binds the endpoints from the Remote markers.
 */
export function apply(ctx) {
	const service = new ArchiveManagerService(ctx);
	// The plugin fiber's context has the deps injected (see `apply.inject`); the
	// remote receiver context may not, so pin them here.
	service._registry = service.safeGet(ctx, "workspaceRegistry");
	service._persistence = service.safeGet(ctx, "sessionPersistence");
	return service;
}
/** Inject the host services this plugin needs. */
apply.inject = ["workspaceRegistry", "sessionPersistence"];

export default apply;
