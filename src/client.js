/**
 * dsh-archive-manager — browser (client) half.
 *
 * Loaded by DSH's client module loader as a `window.__ModuleLoader__.load`
 * bundle. Registers a sidebar footer action ("归档 / Archive") that opens a
 * popup panel listing archived conversations, grouped by workspace, with
 * three actions per row:
 *
 *   - 打开 (Open):       unarchive + open the conversation in one step
 *   - 恢复 (Restore):    unarchive only, keep browsing the panel
 *   - 文件夹 (Folder):   reveal the session's transcript folder in the file
 *                        manager (archiveManager/openSessionFolder)
 *
 * Robustness contract (this bundle must never take the whole web app down):
 *   - The `archiveManager` remote namespace is mounted BY THIS BUNDLE via
 *     `ctx.remote.$mount`, so it must NOT appear in `inject` (a fiber waits
 *     for every injected service to be ready before it can activate, which
 *     would deadlock against its own mount). It is reached with the
 *     dynamic `ctx.get("remote.archiveManager")` after mounting, exactly the
 *     pattern the official code uses for `connection`.
 *   - It uses only injected props (built defensively in `apply`) plus the
 *     self-mounted namespace above; it never calls standard hooks whose
 *     availability is not guaranteed on the `sidebar.footer.action` slot
 *     (e.g. `useWorkspaces`).
 *   - Every store is null-guarded with a no-op fallback; every async step in
 *     `apply` is try/caught; a failed remote mount degrades to a read-only
 *     panel instead of a crash.
 *   - Locale text is bundled inline (zh / en chosen from `navigator.language`),
 *     so nothing depends on the host locale registry.
 */
window.__ModuleLoader__.load({
	id: "dsh-archive-manager",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;

		const React = require("react");
		const { useSyncExternalStore, useState, useMemo, useCallback, useRef } = React;

		// ---------------------------------------------------------------- locale
		const isZh = typeof navigator !== "undefined" && navigator.language && navigator.language.toLowerCase().startsWith("zh");
		const STR = isZh
			? {
					trigger: "归档",
					triggerTip: "查看 / 恢复已归档的会话",
					title: "归档会话管理",
					count: (n) => n + " 个归档会话",
					empty: "没有已归档的会话",
					emptyTip: "在会话上点击“归档”后会出现在这里",
					ungrouped: "未分组",
					open: "打开",
					restore: "恢复",
					folder: "打开对话文件夹",
					restoring: "恢复中…",
					restored: "已恢复",
					restoreAndOpen: "已恢复并打开",
					openedFolder: "已打开文件夹",
					close: "关闭",
					justNow: "刚刚",
					minAgo: (n) => n + " 分钟前",
					hourAgo: (n) => n + " 小时前",
					dayAgo: (n) => n + " 天前",
					error: "操作失败",
					remoteDown: "恢复服务不可用（archiveManager 未挂载）",
					noTitle: "（未命名会话）"
				}
			: {
					trigger: "Archive",
					triggerTip: "View and restore archived sessions",
					title: "Archived Conversations",
					count: (n) => n + " archived",
					empty: "No archived sessions",
					emptyTip: "Sessions you archive from a conversation menu appear here",
					ungrouped: "Ungrouped",
					open: "Open",
					restore: "Restore",
					folder: "Open conversation folder",
					restoring: "…",
					restored: "Restored",
					restoreAndOpen: "Restored & opened",
					openedFolder: "Folder opened",
					close: "Close",
					justNow: "just now",
					minAgo: (n) => n + "m ago",
					hourAgo: (n) => n + "h ago",
					dayAgo: (n) => n + "d ago",
					error: "Operation failed",
					remoteDown: "Restore service unavailable (archiveManager not mounted)",
					noTitle: "(untitled)"
				};

		function fmtTime(ts) {
			if (!ts || typeof ts !== "number") return "";
			const diff = Date.now() - ts;
			if (diff < 60_000) return STR.justNow;
			if (diff < 3_600_000) return STR.minAgo(Math.max(1, Math.floor(diff / 60_000)));
			if (diff < 86_400_000) return STR.hourAgo(Math.max(1, Math.floor(diff / 3_600_000)));
			return STR.dayAgo(Math.max(1, Math.floor(diff / 86_400_000)));
		}

		function shortId(id) {
			return typeof id === "string" && id.length > 12 ? id.slice(0, 8) + "…" + id.slice(-4) : String(id || "");
		}

		// ----------------------------------------------------------------- icons
		const svg = (w, h, children) =>
			React.createElement("svg", {
				width: w, height: h, viewBox: "0 0 24 24", fill: "none",
				stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round",
				children: React.createElement("g", { children })
			});
		const I = {
			archive: svg(15, 15, [
				React.createElement("rect", { x: 2, y: 3, width: 20, height: 5, rx: 1.5 }),
				React.createElement("path", { d: "M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" }),
				React.createElement("path", { d: "M10 12h4" })
			]),
			open: svg(13, 13, [
				React.createElement("path", { d: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" }),
				React.createElement("path", { d: "M15 3h6v6" }),
				React.createElement("path", { d: "M10 14 21 3" })
			]),
			restore: svg(13, 13, [
				React.createElement("path", { d: "M3 12a9 9 0 1 0 3-6.7L3 8" }),
				React.createElement("path", { d: "M3 3v5h5" })
			]),
			folder: svg(13, 13, [
				React.createElement("path", { d: "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" })
			]),
			close: svg(14, 14, [
				React.createElement("path", { d: "M18 6 6 18" }),
				React.createElement("path", { d: "M6 6l12 12" })
			]),
			inbox: React.createElement("svg", {
				width: 40, height: 40, viewBox: "0 0 24 24", fill: "none",
				stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round",
				children: React.createElement("g", { children: [
					React.createElement("path", { d: "M22 12h-6l-2 3h-4l-2-3H2" }),
					React.createElement("path", { d: "M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.1Z" })
				] })
			}),
			check: svg(12, 12, [React.createElement("path", { d: "M20 6 9 17l-5-5" })])
		};

		// ------------------------------------------------------------- descriptor
		// Strict codecs (plain parse objects) matching the host endpoints;
		// required by the client $mount path.
		const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v));
		const TYPERT_REMOTE = {
			package: "dsh-archive-manager",
			descriptors: [
				{
					id: "dsh-archive-manager#archiveManager/unarchive",
					service: "archiveManager",
					namespace: "archiveManager",
					method: "unarchive",
					invocation: { kind: "direct" },
					parameters: [
						{
							name: "request",
							wire: "request",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "dsh-archive-manager/types#UnarchiveRequest",
								schema: {
									parse: (v) => {
										if (!v || typeof v !== "object") throw new Error("request must be an object");
										return { sessionId: str(v.sessionId) };
									}
								}
							}
						}
					],
					result: {
						mode: "strict",
						typeSymbol: "dsh-archive-manager/types#UnarchiveResult",
						schema: {
							parse: (v) => {
								if (!v || typeof v !== "object") throw new Error("result must be an object");
								const arr = Array.isArray(v.archivedSessionIds) ? v.archivedSessionIds.map(str) : [];
								return { archivedSessionIds: arr };
							}
						}
					}
				},
				{
					id: "dsh-archive-manager#archiveManager/openSessionFolder",
					service: "archiveManager",
					namespace: "archiveManager",
					method: "openSessionFolder",
					invocation: { kind: "direct" },
					parameters: [
						{
							name: "request",
							wire: "request",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "dsh-archive-manager/types#OpenSessionFolderRequest",
								schema: {
									parse: (v) => {
										if (!v || typeof v !== "object") throw new Error("request must be an object");
										return { sessionId: str(v.sessionId) };
									}
								}
							}
						}
					],
					result: {
						mode: "strict",
						typeSymbol: "dsh-archive-manager/types#OpenSessionFolderResult",
						schema: {
							parse: (v) => {
								if (!v || typeof v !== "object") throw new Error("result must be an object");
								return { path: str(v.path) };
							}
						}
					}
				}
			]
		};

		// ----------------------------------------------------------------- styles
		const S = {
			trigger: {
				flex: "1", minWidth: 0, height: 32, border: "none", background: "transparent",
				color: "var(--dsw-alias-label-secondary, #5f6672)", cursor: "pointer",
				borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center",
				gap: 6, fontSize: 13, fontWeight: 500, transition: "background .15s ease, color .15s ease",
				padding: "0 8px", whiteSpace: "nowrap", overflow: "hidden"
			},
			triggerHover: { background: "var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.05))", color: "var(--dsw-alias-label-primary, #1f2329)" },
			panel: {
				position: "fixed", left: 12, bottom: 60, width: 400, maxWidth: "calc(100vw - 24px)",
				maxHeight: "min(560px, calc(100vh - 80px))", display: "flex", flexDirection: "column",
				background: "var(--dsw-alias-bg-elevated, #ffffff)", border: "1px solid var(--dsw-alias-border-l2, #e4e7ec)",
				borderRadius: 14, boxShadow: "0 12px 32px rgba(0,0,0,.16), 0 2px 8px rgba(0,0,0,.06)",
				zIndex: 2000, overflow: "hidden", animation: "dsh-am-pop .18s ease"
			},
			head: {
				display: "flex", alignItems: "center", gap: 8, padding: "12px 14px 10px",
				borderBottom: "1px solid var(--dsw-alias-border-l1, #f0f1f3)", cursor: "grab"
			},
			resizeN: { position: "absolute", left: 10, top: 0, right: 10, height: 6, cursor: "ns-resize", zIndex: 3 },
			resizeS: { position: "absolute", left: 10, bottom: 0, right: 10, height: 6, cursor: "ns-resize", zIndex: 3 },
			resizeE: { position: "absolute", top: 10, right: 0, bottom: 10, width: 6, cursor: "ew-resize", zIndex: 3 },
			resizeW: { position: "absolute", top: 10, left: 0, bottom: 10, width: 6, cursor: "ew-resize", zIndex: 3 },
			resizeNW: { position: "absolute", top: 0, left: 0, width: 14, height: 14, cursor: "nwse-resize", zIndex: 4 },
			resizeNE: { position: "absolute", top: 0, right: 0, width: 14, height: 14, cursor: "nesw-resize", zIndex: 4 },
			resizeSW: { position: "absolute", bottom: 0, left: 0, width: 14, height: 14, cursor: "nesw-resize", zIndex: 4 },
			resizeSE: { position: "absolute", bottom: 0, right: 0, width: 16, height: 16, cursor: "nwse-resize", zIndex: 4 },
			headGrip: {
				flex: "none", width: 12, height: 16, cursor: "grab",
				backgroundImage: "radial-gradient(circle, var(--dsw-alias-state-business-primary, #3b6ef6) 1.7px, transparent 2px)",
				backgroundSize: "5px 5px", backgroundPosition: "left center",
				opacity: 0.9
			},
			headIcon: {
				display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24,
				borderRadius: 7, color: "var(--dsw-alias-state-business-primary, #3b6ef6)",
				background: "color-mix(in srgb, var(--dsw-alias-state-business-primary, #3b6ef6) 12%, transparent)"
			},
			headTitle: { flex: 1, fontSize: 14, fontWeight: 600, color: "var(--dsw-alias-label-primary, #1f2329)", minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
			badge: {
				flex: "none", fontSize: 11, fontWeight: 600, color: "var(--dsw-alias-label-secondary, #5f6672)",
				background: "var(--dsw-alias-bg-base, #f7f8fa)", border: "1px solid var(--dsw-alias-border-l1, #f0f1f3)",
				borderRadius: 999, padding: "1px 8px"
			},
			closeBtn: {
				flex: "none", width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center",
				border: "none", background: "transparent", color: "var(--dsw-alias-label-tertiary, #8a919c)",
				cursor: "pointer", borderRadius: 7, transition: "background .15s ease, color .15s ease"
			},
			body: { flex: 1, overflowY: "auto", padding: "6px 8px 8px" },
			toast: {
				margin: "6px 6px 2px", padding: "7px 10px", borderRadius: 9, fontSize: 12, lineHeight: "18px",
				display: "flex", alignItems: "center", gap: 6
			},
			toastOk: { color: "var(--dsw-alias-state-success-primary, #2e7d32)", background: "color-mix(in srgb, var(--dsw-alias-state-success-primary, #2e7d32) 10%, transparent)" },
			toastErr: { color: "var(--dsw-alias-state-error-primary, #c62828)", background: "color-mix(in srgb, var(--dsw-alias-state-error-primary, #c62828) 10%, transparent)" },
			group: { display: "flex", alignItems: "center", gap: 6, padding: "10px 10px 4px", fontSize: 11, fontWeight: 600, letterSpacing: ".02em", textTransform: "uppercase", color: "var(--dsw-alias-label-tertiary, #8a919c)" },
			groupBadge: {
				fontSize: 10, fontWeight: 600, color: "var(--dsw-alias-label-tertiary, #8a919c)",
				background: "var(--dsw-alias-bg-base, #f7f8fa)", border: "1px solid var(--dsw-alias-border-l1, #f0f1f3)",
				borderRadius: 999, padding: "0 6px", lineHeight: "15px"
			},
			row: {
				display: "flex", alignItems: "center", gap: 6, padding: "7px 10px", borderRadius: 10,
				transition: "background .12s ease, opacity .25s ease"
			},
			rowText: { flex: 1, minWidth: 0 },
			rowTitle: { fontSize: 13, fontWeight: 500, color: "var(--dsw-alias-label-primary, #1f2329)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
			rowMeta: { display: "flex", alignItems: "center", gap: 6, marginTop: 2, fontSize: 11, color: "var(--dsw-alias-label-tertiary, #8a919c)" },
			btn: {
				flex: "none", display: "inline-flex", alignItems: "center", gap: 5, height: 28,
				padding: "0 10px", borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: "pointer",
				transition: "background .12s ease, border-color .12s ease, opacity .12s ease", whiteSpace: "nowrap"
			},
			btnPrimary: {
				border: "1px solid var(--dsw-alias-state-business-primary, #3b6ef6)",
				background: "var(--dsw-alias-state-business-primary, #3b6ef6)",
				color: "#fff"
			},
			btnGhost: {
				border: "1px solid var(--dsw-alias-border-l2, #e4e7ec)",
				background: "transparent", color: "var(--dsw-alias-label-secondary, #5f6672)"
			},
			btnIcon: {
				flex: "none", width: 28, height: 28, display: "inline-flex", alignItems: "center", justifyContent: "center",
				border: "1px solid var(--dsw-alias-border-l2, #e4e7ec)", background: "transparent",
				color: "var(--dsw-alias-label-tertiary, #8a919c)", cursor: "pointer", borderRadius: 8,
				transition: "background .12s ease, color .12s ease"
			},
			empty: { display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "44px 0 40px", color: "var(--dsw-alias-label-tertiary, #a3aab5)" },
			emptyTitle: { fontSize: 13, fontWeight: 500, color: "var(--dsw-alias-label-secondary, #5f6672)" },
			emptyTip: { fontSize: 12, textAlign: "center", padding: "0 24px", lineHeight: "18px" }
		};

		// ------------------------------------------------------------ component
		/**
		 * Sidebar footer trigger + popup panel.
		 * Props (all injected defensively by `apply`): workspacesStore,
		 * sessionsStore, remote, open. Plus owner `wide` (unused standard hooks
		 * and locale seat are deliberately ignored — text is bundled inline).
		 */
		function ArchiveManagerButton(props) {
			const workspacesStore = props.workspacesStore;
			const sessionsStore = props.sessionsStore;

			// Stable fallbacks so rendering can never throw on a missing store.
			const ws = workspacesStore && typeof workspacesStore.subscribe === "function" ? workspacesStore : null;
			const ss = sessionsStore && typeof sessionsStore.subscribe === "function" ? sessionsStore : null;

			const noopSub = useCallback(() => () => {}, []);
			const workspaces = useSyncExternalStore(
				ws ? useCallback((fn) => ws.subscribe(fn), [ws]) : noopSub,
				useCallback(() => (ws ? ws.getSnapshot() : { items: [], archivedSessionIds: [] }), [ws]),
				useCallback(() => (ws ? ws.getSnapshot() : { items: [], archivedSessionIds: [] }), [ws])
			);
			const sessions = useSyncExternalStore(
				ss ? useCallback((fn) => ss.subscribe(fn), [ss]) : noopSub,
				useCallback(() => (ss ? ss.getSnapshot() : { byId: {} }), [ss]),
				useCallback(() => (ss ? ss.getSnapshot() : { byId: {} }), [ss])
			);

			const [open, setOpen] = useState(false);
			const [busy, setBusy] = useState(null);
			const [toast, setToast] = useState(null); // {kind:'ok'|'err', text}
			const [removed, setRemoved] = useState(() => new Set());
			const [hover, setHover] = useState(false);
			const removedRef = useRef(removed);
			removedRef.current = removed;

			// Draggable / resizable panel (8-way: n/s/e/w edges + 4 corners).
			const [dims, setDims] = useState(null); // {left, top, width, height} once moved/resized
			const dragRef = useRef(null);           // {mode, startX, startY, base}
			const panelRef = useRef(null);
			const MIN_W = 280, MIN_H = 220;
			const startDrag = useCallback((e, mode) => {
				if (mode === "move" && e.target && e.target.closest && e.target.closest("button")) return;
				const el = panelRef.current;
				if (!el || dragRef.current) return;
				const rect = el.getBoundingClientRect();
				const base = dims || { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
				dragRef.current = { mode, startX: e.clientX, startY: e.clientY, base };
				if (e.preventDefault) e.preventDefault();
				const onMove = (ev) => {
					const d = dragRef.current;
					if (!d) return;
					const dx = ev.clientX - d.startX;
					const dy = ev.clientY - d.startY;
					const vw = window.innerWidth || 1280;
					const vh = window.innerHeight || 800;
					if (d.mode === "move") {
						const left = Math.min(Math.max(8, d.base.left + dx), Math.max(8, vw - Math.min(d.base.width, vw - 16) - 8));
						const top = Math.min(Math.max(8, d.base.top + dy), Math.max(8, vh - 48));
						setDims({ ...d.base, left, top });
					} else if (d.mode.startsWith("resize-")) {
						// dir is one of: nw | n | ne | e | se | s | sw | w
						const dir = d.mode.slice(7);
						let { left, top, width, height } = d.base;
						const right = left + width;
						const bottom = top + height;
						if (dir.includes("e")) width = Math.min(Math.max(MIN_W, width + dx), vw - 16);
						if (dir.includes("s")) height = Math.min(Math.max(MIN_H, height + dy), vh - 16);
						if (dir.includes("w")) {
							const nl = Math.min(Math.max(8, left + dx), Math.max(8, right - MIN_W));
							width = right - nl;
							left = nl;
						}
						if (dir.includes("n")) {
							const nt = Math.min(Math.max(8, top + dy), Math.max(8, bottom - MIN_H));
							height = bottom - nt;
							top = nt;
						}
						setDims({ ...d.base, left, top, width, height });
					} else {
						const width = Math.min(Math.max(MIN_W, d.base.width + dx), vw - 16);
						const height = Math.min(Math.max(MIN_H, d.base.height + dy), vh - 16);
						setDims({ ...d.base, width, height });
					}
				};
				const onUp = () => {
					dragRef.current = null;
					window.removeEventListener("pointermove", onMove);
					window.removeEventListener("pointerup", onUp);
				};
				window.addEventListener("pointermove", onMove);
				window.addEventListener("pointerup", onUp);
			}, [dims]);

			const archivedIds = (workspaces && workspaces.archivedSessionIds) || [];
			const wsItems = (workspaces && workspaces.items) || [];
			const byId = (sessions && sessions.byId) || {};

			// Group archived sessions by owning workspace (via `sessionIds`
			// accounting), remainder into an "Ungrouped" bucket.
			const groups = useMemo(() => {
				const rowsOf = (id) => {
					if (removed.has(id)) return null;
					const s = byId[id];
					return {
						id,
						title: s ? s.displayTitle || STR.noTitle : STR.noTitle,
						updatedAt: s ? s.updatedAt : void 0
					};
				};
				const wsGroups = wsItems.map((w) => ({
					key: "ws:" + w.workspaceId,
					title: w.title || w.path || STR.ungrouped,
					rows: []
				}));
				const wsBySession = new Map();
				for (const w of wsItems) for (const sid of w.sessionIds || []) if (!wsBySession.has(sid)) wsBySession.set(sid, wsGroups.length - wsItems.length + wsItems.indexOf(w));
				const ungrouped = { key: "__ungrouped__", title: STR.ungrouped, rows: [] };
				const out = [];
				for (const id of archivedIds) {
					const row = rowsOf(id);
					if (!row) continue;
					const gi = wsBySession.get(id);
					if (gi !== void 0) wsGroups[gi].rows.push(row);
					else ungrouped.rows.push(row);
				}
				for (const g of wsGroups) if (g.rows.length) out.push(g);
				if (ungrouped.rows.length) out.push(ungrouped);
				return out;
			}, [archivedIds, wsItems, byId, removed]);

			const total = archivedIds.length - removed.size;

			const remote = props.remote;

			const runUnarchive = useCallback(async (id) => {
				if (!remote || typeof remote.unarchive !== "function") {
					setToast({ kind: "err", text: STR.remoteDown });
					return false;
				}
				try {
					const result = await remote.unarchive({ sessionId: id });
					if (result && result.ok) {
						setRemoved((prev) => new Set(prev).add(id));
						return true;
					}
					setToast({ kind: "err", text: STR.error + ": " + (result && result.error ? result.error.message : "unknown") });
					return false;
				} catch (e) {
					setToast({ kind: "err", text: STR.error + ": " + (e instanceof Error ? e.message : String(e)) });
					return false;
				}
			}, [remote]);

			const doRestore = useCallback(async (id) => {
				if (busy) return;
				setBusy(id);
				setToast(null);
				const ok = await runUnarchive(id);
				if (ok) setToast({ kind: "ok", text: STR.restored + " " + shortId(id) });
				setBusy(null);
			}, [busy, runUnarchive]);

			const doOpen = useCallback(async (id) => {
				if (busy) return;
				setBusy(id);
				setToast(null);
				const ok = await runUnarchive(id);
				if (ok && props.open) {
					try {
						props.open(id);
					} catch (e) {
						/* open failure shouldn't kill the panel */
					}
					setToast({ kind: "ok", text: STR.restoreAndOpen + " " + shortId(id) });
				}
				setBusy(null);
			}, [busy, runUnarchive, props]);

			const doOpenFolder = useCallback(async (id) => {
				if (busy) return;
				if (!remote || typeof remote.openSessionFolder !== "function") {
					setToast({ kind: "err", text: STR.remoteDown });
					return;
				}
				setBusy(id);
				setToast(null);
				try {
					const result = await remote.openSessionFolder({ sessionId: id });
					if (result && result.ok) {
						setToast({ kind: "ok", text: STR.openedFolder + " · " + shortId(id) });
					} else {
						setToast({ kind: "err", text: STR.error + ": " + (result && result.error ? result.error.message : "unknown") });
					}
				} catch (e) {
					setToast({ kind: "err", text: STR.error + ": " + (e instanceof Error ? e.message : String(e)) });
				} finally {
					setBusy(null);
				}
			}, [busy, remote]);

			const triggerNode = React.createElement(
				"button",
				{
					type: "button",
					title: STR.triggerTip,
					"aria-label": STR.triggerTip,
					onClick: () => setOpen(true),
					onMouseEnter: () => setHover(true),
					onMouseLeave: () => setHover(false),
					style: Object.assign({}, S.trigger, hover ? S.triggerHover : null)
				},
				I.archive,
				props.wide ? React.createElement("span", null, STR.trigger) : null
			);

			if (!open) return triggerNode;

			const rowNode = (row) =>
				React.createElement(
					"div",
					{
						key: row.id,
						style: S.row,
						onMouseEnter: (e) => (e.currentTarget.style.background = "var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.04))"),
						onMouseLeave: (e) => (e.currentTarget.style.background = "transparent")
					},
					React.createElement(
						"div",
						{ style: S.rowText },
						React.createElement("div", { style: S.rowTitle, title: row.id }, row.title),
						React.createElement(
							"div",
							{ style: S.rowMeta },
							React.createElement("span", null, shortId(row.id)),
							row.updatedAt ? React.createElement("span", null, "·") : null,
							row.updatedAt ? React.createElement("span", null, fmtTime(row.updatedAt)) : null
						)
					),
					React.createElement(
						"button",
						{
							type: "button",
							style: S.btnIcon,
							title: STR.folder,
							"aria-label": STR.folder,
							disabled: busy === row.id,
							onClick: () => doOpenFolder(row.id)
						},
						I.folder
					),
					React.createElement(
						"button",
						{
							type: "button",
							style: Object.assign({}, S.btn, S.btnGhost),
							disabled: busy === row.id,
							onClick: () => doRestore(row.id)
						},
						busy === row.id ? STR.restoring : I.restore,
						busy === row.id ? null : React.createElement("span", null, STR.restore)
					),
					React.createElement(
						"button",
						{
							type: "button",
							style: Object.assign({}, S.btn, S.btnPrimary),
							disabled: busy === row.id,
							onClick: () => doOpen(row.id)
						},
						busy === row.id ? null : I.open,
						React.createElement("span", null, STR.open)
					)
				);

			const bodyNode =
				total === 0
					? React.createElement(
							"div",
							{ style: S.empty },
							I.inbox,
							React.createElement("span", { style: S.emptyTitle }, STR.empty),
							React.createElement("span", { style: S.emptyTip }, STR.emptyTip)
						)
					: React.createElement(
							"div",
							{ style: S.body },
							groups.map((g) =>
								React.createElement(
									"div",
									{ key: g.key },
									React.createElement(
										"div",
										{ style: S.group },
										React.createElement("span", { style: { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 } }, g.title),
										React.createElement("span", { style: S.groupBadge }, g.rows.length)
									),
									g.rows.map(rowNode)
								)
							)
						);

			const panelStyle = dims
				? Object.assign({}, S.panel, {
						left: dims.left, top: dims.top, right: "auto", bottom: "auto",
						width: dims.width, height: dims.height, maxHeight: "none"
					})
				: S.panel;
			const panelNode = React.createElement(
				"div",
				{ ref: panelRef, style: panelStyle, role: "dialog", "aria-label": STR.title },
				React.createElement(
					"div",
					{ style: S.head, onPointerDown: (e) => startDrag(e, "move") },
					React.createElement("span", { style: S.headGrip }),
					React.createElement("span", { style: S.headIcon }, I.archive),
					React.createElement("span", { style: S.headTitle }, STR.title),
					React.createElement("span", { style: S.badge }, STR.count(total)),
					React.createElement(
						"button",
						{ type: "button", style: S.closeBtn, onClick: () => setOpen(false), title: STR.close, "aria-label": STR.close },
						I.close
					)
				),
				toast
					? React.createElement(
							"div",
							{ style: Object.assign({}, S.toast, toast.kind === "ok" ? S.toastOk : S.toastErr) },
							toast.kind === "ok" ? I.check : null,
							React.createElement("span", null, toast.text)
						)
					: null,
				bodyNode,
				// 8-way resize hotspots (transparent; highlighted on hover via CSS).
				React.createElement("div", { className: "dsh-am-rz", style: S.resizeN, onPointerDown: (e) => startDrag(e, "resize-n"), title: "上边缘拉伸 / Resize top", "aria-label": "Resize top" }),
				React.createElement("div", { className: "dsh-am-rz", style: S.resizeS, onPointerDown: (e) => startDrag(e, "resize-s"), title: "下边缘拉伸 / Resize bottom", "aria-label": "Resize bottom" }),
				React.createElement("div", { className: "dsh-am-rz", style: S.resizeE, onPointerDown: (e) => startDrag(e, "resize-e"), title: "右边缘拉伸 / Resize right", "aria-label": "Resize right" }),
				React.createElement("div", { className: "dsh-am-rz", style: S.resizeW, onPointerDown: (e) => startDrag(e, "resize-w"), title: "左边缘拉伸 / Resize left", "aria-label": "Resize left" }),
				React.createElement("div", { className: "dsh-am-rz", style: S.resizeNW, onPointerDown: (e) => startDrag(e, "resize-nw"), title: "左上角拉伸 / Resize", "aria-label": "Resize NW" }),
				React.createElement("div", { className: "dsh-am-rz", style: S.resizeNE, onPointerDown: (e) => startDrag(e, "resize-ne"), title: "右上角拉伸 / Resize", "aria-label": "Resize NE" }),
				React.createElement("div", { className: "dsh-am-rz", style: S.resizeSW, onPointerDown: (e) => startDrag(e, "resize-sw"), title: "左下角拉伸 / Resize", "aria-label": "Resize SW" }),
				React.createElement("div", { className: "dsh-am-rz", style: S.resizeSE, onPointerDown: (e) => startDrag(e, "resize-se"), title: "右下角拉伸 / Resize", "aria-label": "Resize SE" })
			);

			// A small pop animation via a keyframe injected once.
			if (typeof document !== "undefined" && !document.querySelector("style[data-am-pop]")) {
				const tag = document.createElement("style");
				tag.dataset.amPop = "1";
				tag.textContent = "@keyframes dsh-am-pop{from{opacity:0;transform:translateY(6px) scale(.985)}to{opacity:1;transform:none}}";
				document.head.appendChild(tag);
			}
			// Resize hotspot hover highlight (transparent by default).
			if (typeof document !== "undefined" && !document.querySelector("style[data-am-rz]")) {
				const tag = document.createElement("style");
				tag.dataset.amRz = "1";
				tag.textContent = ".dsh-am-rz{background:transparent}.dsh-am-rz:hover{background:color-mix(in srgb, var(--dsw-alias-state-business-primary, #3b6ef6) 30%, transparent)}";
				document.head.appendChild(tag);
			}

			return panelNode;
		}

		// ---------------------------------------------------------------- plugin
		// NOTE: `remote.archiveManager` must NOT be listed here — this bundle
		// mounts that namespace itself via ctx.remote.$mount in apply(); a fiber
		// waits for every injected service before activating, which would
		// deadlock against its own mount. The service is fetched dynamically
		// with ctx.get() after mounting (same pattern as the official
		// `connection` access).
		const inject = ["slots", "sessions", "workspaces", "remote"];

		/**
		 * Client plugin body. Every step is defensive: a failure here must never
		 * take down the whole web shell.
		 * @param {object} ctx - client root context.
		 */
		async function apply(ctx) {
			const disposers = [];

			// 1. Mount the Host remote (best effort; degrade to read-only panel).
			let remote = null;
			try {
				const disposeMount = await ctx.remote.$mount(TYPERT_REMOTE);
				if (typeof disposeMount === "function") disposers.push(disposeMount);
				remote = ctx.get ? ctx.get("remote.archiveManager") : ctx.remote.archiveManager;
			} catch (e) {
				console.warn("[dsh-archive-manager] remote mount failed:", e);
			}

			// 2. Capture stores / actions (best effort).
			let workspacesStore = null;
			let sessionsStore = null;
			let openSession = null;
			try {
				workspacesStore = ctx.workspaces.list;
				sessionsStore = ctx.sessions.list;
				openSession = (id) => ctx.sessions.open(id);
			} catch (e) {
				console.warn("[dsh-archive-manager] store capture failed:", e);
			}

			// 3. Register the sidebar footer action.
			try {
				const disposeInject = ctx.slots.inject("sidebar.footer.action", () =>
					ctx.slots.register(
						{
							name: "sidebar.footer.action",
							id: "dsh-archive-manager",
							order: 120,
							inject: () => ({
								workspacesStore,
								sessionsStore,
								remote,
								open: openSession
							})
						},
						ArchiveManagerButton
					)
				);
				if (typeof disposeInject === "function") disposers.push(disposeInject);
			} catch (e) {
				console.warn("[dsh-archive-manager] slot registration failed:", e);
			}

			return () => {
				for (const d of disposers.reverse()) {
					try {
						d();
					} catch (e) {
						/* teardown must not throw */
					}
				}
			};
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.ArchiveManagerButton = ArchiveManagerButton;
		return module.exports;
	}
});
