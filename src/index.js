/**
 * dsh-archive-manager — server (host) half.
 *
 * A DeepSeek Harness cordis plugin that adds root-scoped Typert Remote
 * endpoints to the Host so the GUI can manage archived conversations:
 *
 *   - `archiveManager/unarchive(sessionId)`        — remove one session from
 *     the registry-global `archivedSessionIds` set ("restore").
 *   - `archiveManager/openSessionFolder(sessionId)` — reveal the session's
 *     transcript folder (the directory holding its `session.jsonl*`) in the
 *     platform file manager.
 *
 * Why there is no "delete": DSH has no session-delete API by design. The
 * sidebar "Archive session" action only adds a session id to the archive set
 * (hiding it from grouping surfaces), and the persistence seam has no delete
 * interface at all — transcripts are append-only and accumulate until removed
 * externally. "Restore" is therefore exactly: remove one session id from that
 * set, routed through the registry's own serialized op queue so it cannot
 * interleave with built-in writes. Deleting a conversation permanently is out
 * of scope for this plugin (see README "Why there is no delete").
 *
 * The endpoints are plain `@Remote`s on a `TypertRemoteService` with root
 * ("direct") scope. The gateway's source-mode discovery picks them up at
 * runtime (no generated protocol artifacts required on the host side); the
 * browser half mounts the matching strict descriptors via
 * `ctx.remote.$mount` and reaches the service through `ctx.get(...)`.
 */
import { TypertRemoteService, Remote } from "@deepseek-ai/dsh-typert-protocol";
import { dirname } from "node:path";
import { spawn } from "node:child_process";

/** Marker initializers produced by the @Remote decorators. */
const markerInitializers = [];
for (const method of ["unarchive", "openSessionFolder"]) {
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
			return ctx ? ctx.get ? ctx.get(name) : ctx[name] : void 0;
		} catch {
			return void 0;
		}
	}

	/**
	 * Remove one session from the global archive set.
	 * @param {{sessionId: string}} request - named RPC payload.
	 * @returns {{archivedSessionIds: string[]}} full updated archive set.
	 */
	async unarchive(request) {
		const sessionId = String(request && request.sessionId ? request.sessionId : "");
		const registry = this._registry;
		if (!registry || typeof registry.enqueueOperation !== "function") {
			throw new Error("workspace registry unavailable");
		}
		await registry.enqueueOperation(async () => {
			const state = registry.requireState();
			if (!state.archivedSessionIds.includes(sessionId)) return;
			await registry.setState({
				...state,
				archivedSessionIds: state.archivedSessionIds.filter((id) => id !== sessionId)
			});
		});
		return { archivedSessionIds: [...registry.archivedSessionIds] };
	}

	/**
	 * Reveal the session's transcript folder in the platform file manager.
	 * @param {{sessionId: string}} request - named RPC payload.
	 * @returns {{path: string}} the revealed directory.
	 */
	async openSessionFolder(request) {
		const sessionId = String(request && request.sessionId ? request.sessionId : "");
		const persistence = this._persistence;
		if (!persistence || typeof persistence.list !== "function" || typeof persistence.locate !== "function") {
			throw new Error("session persistence unavailable");
		}
		const headers = await persistence.list();
		const header = headers.find((h) => h && h.id === sessionId);
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
