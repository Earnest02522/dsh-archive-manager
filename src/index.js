/**
 * dsh-archive-manager — Host half.
 *
 * The panel itself is a pure client plugin: archiving and restoring are
 * first-party DSH services (`ctx.workspaces.archiveSession` /
 * `unarchiveSession`), so nothing has to run here for those. Deleting an
 * archived conversation is the one operation DSH deliberately does not offer
 * — session logs are append-only and no service exposes a delete method — so
 * this half contributes a single Host Remote:
 *
 *   `archiveManager/deleteSession` — remove one stored session log from disk
 *   and drop every registry reference to it.
 *
 * The method is declared the way DSH 0.2.x expects from a package without a
 * generated `./typert` artifact: a `TypertRemoteService` subclass whose public
 * instance method carries the protocol's Remote marker. The Gateway then
 * derives the wire descriptor ("SRC mode") from that method's source, which is
 * why the parameter is spelled `request` here and on the client.
 *
 * Deleting is inherently destructive, so this half is conservative:
 *   - a session with running work is refused instead of stopped;
 *   - only the log file the persistence backend reports through
 *     `locate(header)` is unlinked (no recursive deletes, no directory walks);
 *   - the id is unarchived and detached from every workspace afterwards, so no
 *     surface can keep pointing at a log that no longer exists.
 */

import { unlink } from "node:fs/promises";

import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";

/** Cordis service key, which doubles as the wire namespace. */
const SERVICE_KEY = "archiveManager";

/** The single Remote this package exports. */
const DELETE_METHOD = "deleteSession";

/**
 * Node has no decorator syntax here, and the protocol's `Remote()` decorator is
 * a plain function over a TC39 decorator context. Applying it by hand records
 * exactly the marker the build output would carry: `addInitializer` is captured
 * now and run from the constructor, where `this` is a live instance and the
 * marker lands on the class prototype.
 */
const markerInitializers = [];

Remote(DELETE_METHOD)(void 0, {
	kind: "method",
	name: DELETE_METHOD,
	static: false,
	private: false,
	addInitializer(initializer) {
		markerInitializers.push(initializer);
	},
});

/** Read one human-readable message out of an unknown rejection reason. */
function messageOf(error) {
	if (error instanceof Error && typeof error.message === "string") return error.message;
	return String(error);
}

/**
 * Host service behind `archiveManager/deleteSession`.
 *
 * `inject` defers activation until session persistence and workspace accounting
 * exist; the per-call checks below cover a composition where a service is
 * present but does not implement the operation this method needs, so the panel
 * always gets a reason instead of a failed Remote call.
 */
export class ArchiveManagerService extends TypertRemoteService {
	static inject = ["sessionPersistence", "workspaceRegistry"];

	constructor(ctx) {
		super(ctx, SERVICE_KEY);
		for (const initializer of markerInitializers) initializer.call(this);
	}

	/**
	 * Delete one stored session.
	 *
	 * @param request - `{ sessionId }` supplied by the client panel.
	 * @returns a plain outcome: `{ sessionId, deleted: true, existed, path }` on
	 *   success, or `{ sessionId, deleted: false, reason }` when the request was
	 *   refused. Expected refusals are values, not exceptions, so the panel can
	 *   translate them; unexpected filesystem errors are returned the same way.
	 */
	async deleteSession(request) {
		const sessionId =
			request !== null && typeof request === "object" && typeof request.sessionId === "string"
				? request.sessionId
				: "";

		if (sessionId === "") {
			return { sessionId, deleted: false, reason: "invalid-session-id" };
		}

		const activity = await this.activity(sessionId);
		if (activity.length > 0) {
			return { sessionId, deleted: false, reason: "session-active" };
		}

		const persistence = this.ctx.sessionPersistence;
		if (!persistence || typeof persistence.stat !== "function") {
			return { sessionId, deleted: false, reason: "persistence-unavailable" };
		}

		let existed = false;
		let path;
		try {
			const snapshot = await persistence.stat(sessionId);
			if (snapshot !== undefined && snapshot !== null) {
				existed = true;
				path = this.locate(persistence, snapshot);
			}
		} catch (error) {
			return { sessionId, deleted: false, reason: "inspect-failed", message: messageOf(error) };
		}

		if (typeof path === "string" && path !== "") {
			try {
				await unlink(path);
			} catch (error) {
				if (error === null || typeof error !== "object" || error.code !== "ENOENT") {
					return { sessionId, deleted: false, reason: "unlink-failed", message: messageOf(error) };
				}
			}
		}

		const pruned = await this.forget(sessionId);
		this.announceRemoval(sessionId);
		return { sessionId, deleted: true, existed, path: typeof path === "string" ? path : null, pruned };
	}

	/**
	 * Ask the workspace activity providers whether this session is busy, using
	 * the same waterfall first-party archiving consults.
	 *
	 * @param sessionId - the session to inspect.
	 * @returns the reported activity entries; empty when idle or unsupported.
	 */
	async activity(sessionId) {
		try {
			const reported = await this.ctx.waterfall(
				"workspace/session-activity",
				{ sessionId },
				() => Promise.resolve([]),
			);
			return Array.isArray(reported) ? reported : [];
		} catch {
			return [];
		}
	}

	/**
	 * Resolve the artifact path for one stored session.
	 *
	 * @param persistence - the session persistence backend.
	 * @param snapshot - the `stat()` snapshot holding the session header.
	 * @returns the absolute log path, or `undefined` when the backend cannot
	 *   name one.
	 */
	locate(persistence, snapshot) {
		if (typeof persistence.locate !== "function") return undefined;
		const header = snapshot !== null && typeof snapshot === "object" && snapshot.header ? snapshot.header : snapshot;
		try {
			const located = persistence.locate(header);
			return located !== null && typeof located === "object" && typeof located.path === "string"
				? located.path
				: undefined;
		} catch {
			return undefined;
		}
	}

	/**
	 * Drop every registry reference to a session whose log is gone.
	 *
	 * Unarchiving never checks that the session still exists — which is exactly
	 * what is needed here — and detaching keeps workspace accounting from
	 * carrying a dangling id. Both steps are best-effort: the log is already
	 * deleted, so a failure to clean up must not be reported as a failed delete.
	 *
	 * @param sessionId - the deleted session.
	 * @returns whether any reference was removed.
	 */
	async forget(sessionId) {
		const registry = this.ctx.workspaceRegistry;
		if (!registry) return false;

		let pruned = false;
		try {
			const archived = registry.archivedSessionIds;
			if (Array.isArray(archived) && archived.includes(sessionId) && typeof registry.unarchiveSession === "function") {
				await registry.unarchiveSession(sessionId);
				pruned = true;
			}
		} catch {
			/* an unavailable registry state leaves the archive set untouched */
		}

		try {
			const workspaces = typeof registry.list === "function" ? registry.list() : [];
			for (const workspace of Array.isArray(workspaces) ? workspaces : []) {
				const ids = workspace && Array.isArray(workspace.sessionIds) ? workspace.sessionIds : [];
				if (!ids.includes(sessionId) || typeof workspace.detachSession !== "function") continue;
				await workspace.detachSession(sessionId);
				pruned = true;
			}
		} catch {
			/* accounting left in place is repaired by the registry's next header index */
		}

		return pruned;
	}

	/**
	 * Tell connected clients that the session no longer exists, so no surface
	 * keeps offering it until the next list refresh.
	 *
	 * @param sessionId - the deleted session.
	 */
	announceRemoval(sessionId) {
		try {
			this.ctx.emit("api-session/removed", sessionId);
		} catch {
			/* the event is a courtesy; the log is already gone */
		}
	}
}

/**
 * Mount the Host service.
 *
 * @param ctx - the plugin context.
 */
export function apply(ctx) {
	ctx.plugin(ArchiveManagerService);
}
