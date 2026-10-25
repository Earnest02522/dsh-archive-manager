/**
 * dsh-archive-manager — Browser half (DSH 0.2.x / 0.3 compatible).
 *
 * A pure client-side DSH plugin: it registers one entry in the sidebar footer
 * slot and opens a panel that lists archived conversations grouped by
 * workspace, with per-session and bulk restore.
 *
 * Why this file looks the way it does:
 *   - It talks only to first-party services (`workspaces`, `sessions`, `slots`,
 *     `locale`) plus two *optional* ones looked up lazily (`uiWorkspace`,
 *     `remote.session`). Nothing here mounts a Remote contribution, so the
 *     strict descriptor validation added in DSH 0.2 cannot break it.
 *   - It is loaded through `window.__ModuleLoader__.load({ id, factory })` and
 *     requires only `react`, the same contract the shipped first-party UI
 *     plugins use. No build step, no JSX, no extra dependency.
 *   - Every DOM/global access is guarded: if the store shapes shift in a future
 *     release, the panel degrades to a readable list instead of throwing inside
 *     the web shell's render tree.
 */
window.__ModuleLoader__.load({
	id: "dsh-archive-manager",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;

		const react = require("react");
		const h = react.createElement;

		/** Package name: slot id, style tag key and locale namespace. */
		const NS = "dsh-archive-manager";
		/** Sidebar footer action slot, rendered with a single `{ wide }` prop. */
		const SLOT = "sidebar.footer.action";
		/** Style tag key, so a hot reload cannot stack duplicate stylesheets. */
		const CSS_KEY = NS + "/client.css";
		/** Slot order: after the native footer entries, before nothing else. */
		const ORDER = 120;

		const MIN_WIDTH = 320;
		const MIN_HEIGHT = 264;
		const DEFAULT_WIDTH = 424;
		const DEFAULT_HEIGHT = 528;
		const MARGIN = 8;

		const zh = {
			"trigger.label": "归档",
			"trigger.title": "归档会话",
			"panel.title": "归档会话",
			"panel.close": "关闭",
			"search.placeholder": "搜索标题、ID 或目录",
			"search.clear": "清除搜索",
			"action.restore": "恢复",
			"action.restoreOpen": "恢复并打开",
			"action.reveal": "在文件管理器中显示工作目录",
			"action.restoreAll": "全部恢复",
			"empty.title": "没有归档的会话",
			"empty.hint": "在侧边栏的会话上右键，选择「归档会话」，它就会出现在这里。",
			"empty.noMatch": "没有匹配的归档会话",
			"group.ungrouped": "未分组",
			"group.untitled": "未命名工作区",
			"toast.restored": "已恢复「{title}」",
			"toast.restoredMany": "已恢复 {count} 个会话",
			"toast.partial": "已恢复 {done} 个，{failed} 个失败",
			"toast.restoreFailed": "恢复失败：{reason}",
			"toast.revealFailed": "无法打开工作目录：{reason}",
			"toast.openMissing": "已恢复，请从侧边栏打开会话",
			"toast.unavailable": "当前 DSH 版本没有提供恢复归档的接口",
			"progress.running": "正在恢复 {done}/{total}",
			"foot.hint": "共 {total} 个归档会话",
			"foot.filtered": "{shown} / {total}",
			"time.now": "刚刚",
			"time.minutes": "{n} 分钟前",
			"time.hours": "{n} 小时前",
			"time.days": "{n} 天前",
		};

		const en = {
			"trigger.label": "Archive",
			"trigger.title": "Archived conversations",
			"panel.title": "Archived conversations",
			"panel.close": "Close",
			"search.placeholder": "Search title, ID or folder",
			"search.clear": "Clear search",
			"action.restore": "Restore",
			"action.restoreOpen": "Restore and open",
			"action.reveal": "Reveal working folder",
			"action.restoreAll": "Restore all",
			"empty.title": "No archived conversations",
			"empty.hint": "Right-click a conversation in the sidebar and pick \u201cArchive session\u201d — it will show up here.",
			"empty.noMatch": "No matching archived conversations",
			"group.ungrouped": "Ungrouped",
			"group.untitled": "Untitled workspace",
			"toast.restored": "Restored \u201c{title}\u201d",
			"toast.restoredMany": "Restored {count} conversations",
			"toast.partial": "Restored {done}, {failed} failed",
			"toast.restoreFailed": "Restore failed: {reason}",
			"toast.revealFailed": "Could not open the folder: {reason}",
			"toast.openMissing": "Restored — open it from the sidebar",
			"toast.unavailable": "This DSH version exposes no unarchive API",
			"progress.running": "Restoring {done}/{total}",
			"foot.hint": "{total} archived conversations",
			"foot.filtered": "{shown} / {total}",
			"time.now": "just now",
			"time.minutes": "{n}m ago",
			"time.hours": "{n}h ago",
			"time.days": "{n}d ago",
		};

		/**
		 * Localise a template with `{name}` placeholders.
		 * @param template - source string, e.g. `Restored {count}`.
		 * @param params - placeholder values.
		 * @returns the interpolated string (`{missing}` is left untouched).
		 */
		function format(template, params) {
			return String(template).replace(/\{(\w+)\}/g, (match, key) => {
				if (params && Object.prototype.hasOwnProperty.call(params, key)) {
					const value = params[key];
					return value === undefined || value === null ? "" : String(value);
				}
				return match;
			});
		}

		/** True when the surrounding UI is expected to speak Chinese. */
		function prefersChinese() {
			let tag = "";
			try {
				if (typeof navigator !== "undefined" && navigator) tag = navigator.language || navigator.userLanguage || "";
			} catch (error) {
				tag = "";
			}
			if (!tag) {
				try {
					if (typeof document !== "undefined" && document && document.documentElement) {
						tag = document.documentElement.lang || "";
					}
				} catch (error) {
					tag = "";
				}
			}
			return String(tag).toLowerCase().indexOf("zh") === 0;
		}

		/**
		 * Build the translator used by the panel.
		 *
		 * The framework binds `t` for a registered locale namespace; the bundled
		 * dictionaries are the fallback for an unknown key, a missing binding or
		 * a Host that ships no locale service at all.
		 *
		 * @param bound - framework-provided translator (may be undefined).
		 * @returns `(key, params) => string`
		 */
		function translator(bound) {
			const fallback = prefersChinese() ? zh : en;
			return (key, params) => {
				let value;
				if (typeof bound === "function") {
					try {
						value = bound(key, params);
					} catch (error) {
						value = undefined;
					}
				}
				if (typeof value !== "string" || value === "" || value === key) {
					value = Object.prototype.hasOwnProperty.call(fallback, key) ? fallback[key] : key;
				}
				return params ? format(value, params) : value;
			};
		}

		/** First 8 characters of a session id. */
		function shortId(id) {
			const text = String(id === undefined || id === null ? "" : id);
			return text.length > 8 ? text.slice(0, 8) : text;
		}

		/** Last path segment, for both POSIX and Windows separators. */
		function baseName(path) {
			const text = String(path === undefined || path === null ? "" : path).replace(/[\\/]+$/, "");
			if (!text) return "";
			const parts = text.split(/[\\/]/);
			return parts[parts.length - 1] || text;
		}

		/** Trim a title for a toast. */
		function ellipsis(text, limit) {
			const value = String(text === undefined || text === null ? "" : text);
			const max = typeof limit === "number" && limit > 8 ? limit : 48;
			return value.length > max ? value.slice(0, max - 1) + "\u2026" : value;
		}

		/** Human-readable relative time for a numeric timestamp or ISO date. */
		function relativeTime(value, t) {
			const time = typeof value === "number" ? value : Date.parse(String(value));
			if (!Number.isFinite(time)) return "";
			const diff = Date.now() - time;
			const minute = 60000;
			const hour = 60 * minute;
			const day = 24 * hour;
			if (diff < minute) return t("time.now");
			if (diff < hour) return t("time.minutes", { n: Math.floor(diff / minute) });
			if (diff < day) return t("time.hours", { n: Math.floor(diff / hour) });
			if (diff < 7 * day) return t("time.days", { n: Math.floor(diff / day) });
			const date = new Date(time);
			const pad = (n) => (n < 10 ? "0" + n : String(n));
			return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
		}

		/** Extract a printable message from anything thrown by a Remote call. */
		function reasonOf(error) {
			if (!error) return "unknown error";
			if (typeof error === "string") return error;
			const code = error.code ? String(error.code) : "";
			const message = error.message ? String(error.message) : String(error);
			return code && message && message.indexOf(code) === -1 ? code + ": " + message : message;
		}

		/* ------------------------------------------------------------------ *
		 * Icons — inline paths on a 24x24 grid, drawn with currentColor.      *
		 * ------------------------------------------------------------------ */
		const ICONS = {
			archive: "M3.5 7.5h17v13h-17z|M3 3.5h18v4H3z|M10 12h4",
			open: "M14 4h6v6|M20 4l-8.5 8.5|M18.5 14.5V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V7A1.5 1.5 0 0 1 5 5.5h4.5",
			restore: "M3.5 12a8.5 8.5 0 1 0 2.6-6.1|M3.5 4.5V10h5.5",
			folder: "M3.5 7a1.5 1.5 0 0 1 1.5-1.5h4l2 2h9A1.5 1.5 0 0 1 21.5 9v9a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18z",
			search: "M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z|M15.5 15.5 21 21",
			close: "M6 6l12 12|M18 6 6 18",
			checkAll: "M2.5 12.5l4 4 8-9|M12.5 15.5l1.5 1.5 8-9",
		};

		function Icon(props) {
			const source = ICONS[props.name] || "";
			const paths = source.split("|").filter(Boolean);
			return h(
				"svg",
				{
					className: "dsh-am-icon",
					width: props.size || 16,
					height: props.size || 16,
					viewBox: "0 0 24 24",
					fill: "none",
					stroke: "currentColor",
					strokeWidth: 1.6,
					strokeLinecap: "round",
					strokeLinejoin: "round",
					"aria-hidden": "true",
					focusable: "false",
				},
				paths.map((d, index) => h("path", { key: index, d })),
			);
		}

		/* ------------------------------------------------------------------ *
		 * Styles — design tokens with plain fallbacks, so the panel follows    *
		 * the app theme in both light and dark mode.                          *
		 * ------------------------------------------------------------------ */
		const CSS = `
.dsh-am-trigger {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	min-width: 28px;
	height: 28px;
	padding: 0 8px;
	border: 0;
	border-radius: var(--dsw-radius-md, 8px);
	background: transparent;
	color: var(--dsw-alias-label-secondary, #5b6270);
	font-family: inherit;
	font-size: 12px;
	line-height: 1;
	cursor: pointer;
	transition: background-color 120ms ease, color 120ms ease;
}
.dsh-am-trigger:hover,
.dsh-am-trigger:focus-visible {
	background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.14));
	color: var(--dsw-alias-label-primary, #1f2430);
}
.dsh-am-trigger[aria-expanded="true"] {
	background: var(--dsw-alias-interactive-bg-active, rgba(127, 127, 127, 0.2));
	color: var(--dsw-alias-label-primary, #1f2430);
}
.dsh-am-trigger:focus-visible {
	outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, #4c8dff);
	outline-offset: 1px;
}
.dsh-am-trigger-label { white-space: nowrap; }
.dsh-am-badge {
	min-width: 16px;
	height: 16px;
	padding: 0 4px;
	border-radius: 999px;
	background: var(--dsw-alias-brand-primary, #4c6ef5);
	color: #fff;
	font-size: 10px;
	font-weight: 600;
	line-height: 16px;
	text-align: center;
	font-variant-numeric: tabular-nums;
}
.dsh-am-panel {
	position: fixed;
	z-index: 1200;
	display: flex;
	flex-direction: column;
	overflow: hidden;
	box-sizing: border-box;
	border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.24));
	border-radius: var(--dsw-radius-lg, 12px);
	background: var(--dsw-alias-bg-layer-2, #fff);
	color: var(--dsw-alias-label-primary, #1f2430);
	box-shadow: var(--dsw-shadow-lv3, 0 16px 40px rgba(0, 0, 0, 0.18));
	font-family: var(--dsw-font-family, inherit);
	font-size: 13px;
	animation: dsh-am-pop 140ms ease-out;
}
@keyframes dsh-am-pop {
	from { opacity: 0; transform: translateY(4px) scale(0.99); }
	to { opacity: 1; transform: translateY(0) scale(1); }
}
.dsh-am-head {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 10px 8px 10px 12px;
	border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.16));
	cursor: grab;
	user-select: none;
	touch-action: none;
}
.dsh-am-head:active { cursor: grabbing; }
.dsh-am-head-icon { display: inline-flex; color: var(--dsw-alias-label-tertiary, #7b8290); }
.dsh-am-head-title {
	font-size: 13px;
	font-weight: 600;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.dsh-am-head-count {
	min-width: 18px;
	padding: 1px 5px;
	border-radius: 999px;
	background: var(--dsw-alias-bg-layer-4, rgba(127, 127, 127, 0.16));
	color: var(--dsw-alias-label-secondary, #5b6270);
	font-size: 11px;
	text-align: center;
	font-variant-numeric: tabular-nums;
}
.dsh-am-spacer { flex: 1 1 auto; }
.dsh-am-icon-btn {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 26px;
	height: 26px;
	padding: 0;
	border: 0;
	border-radius: var(--dsw-radius-sm, 6px);
	background: transparent;
	color: var(--dsw-alias-label-secondary, #5b6270);
	cursor: pointer;
}
.dsh-am-icon-btn:hover:not(:disabled) {
	background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.14));
	color: var(--dsw-alias-label-primary, #1f2430);
}
.dsh-am-icon-btn:disabled { opacity: 0.4; cursor: default; }
.dsh-am-toolbar {
	padding: 8px 12px;
	border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.16));
}
.dsh-am-search {
	display: flex;
	align-items: center;
	gap: 6px;
	height: 28px;
	padding: 0 8px;
	border-radius: var(--dsw-radius-md, 8px);
	background: var(--dsw-alias-bg-layer-1, rgba(127, 127, 127, 0.08));
	color: var(--dsw-alias-label-tertiary, #7b8290);
}
.dsh-am-search:focus-within {
	box-shadow: inset 0 0 0 1px var(--dsw-focus-ring-color, #4c8dff);
}
.dsh-am-input {
	flex: 1 1 auto;
	min-width: 0;
	border: 0;
	background: transparent;
	color: var(--dsw-alias-label-primary, #1f2430);
	font-family: inherit;
	font-size: 12px;
	outline: none;
}
.dsh-am-input::placeholder { color: var(--dsw-alias-label-tertiary, #7b8290); }
.dsh-am-clear {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 18px;
	height: 18px;
	padding: 0;
	border: 0;
	border-radius: 50%;
	background: transparent;
	color: inherit;
	cursor: pointer;
}
.dsh-am-clear:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.18)); }
.dsh-am-body {
	flex: 1 1 auto;
	min-height: 0;
	overflow-y: auto;
	overscroll-behavior: contain;
	padding: 6px 0 8px;
}
.dsh-am-group { padding: 4px 0; }
.dsh-am-group-head {
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 4px 12px 2px;
	position: sticky;
	top: -6px;
	background: var(--dsw-alias-bg-layer-2, #fff);
}
.dsh-am-group-title {
	flex: 1 1 auto;
	font-size: 11px;
	font-weight: 600;
	letter-spacing: 0.02em;
	color: var(--dsw-alias-label-tertiary, #7b8290);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.dsh-am-group-count {
	font-size: 11px;
	color: var(--dsw-alias-label-caption, #9aa1ad);
	font-variant-numeric: tabular-nums;
}
.dsh-am-row {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 6px 12px 6px 14px;
	position: relative;
}
.dsh-am-row:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.1)); }
.dsh-am-row[data-busy="true"] { opacity: 0.6; }
.dsh-am-row-main { flex: 1 1 auto; min-width: 0; }
.dsh-am-row-title {
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	color: var(--dsw-alias-label-primary, #1f2430);
}
.dsh-am-row-meta {
	display: flex;
	align-items: center;
	gap: 5px;
	margin-top: 2px;
	font-size: 11px;
	color: var(--dsw-alias-label-tertiary, #7b8290);
	white-space: nowrap;
	overflow: hidden;
}
.dsh-am-row-cwd {
	overflow: hidden;
	text-overflow: ellipsis;
	max-width: 150px;
}
.dsh-am-mono { font-family: var(--dsw-font-family-mono, ui-monospace, SFMono-Regular, Menlo, monospace); }
.dsh-am-dot { opacity: 0.5; }
.dsh-am-row-actions {
	display: flex;
	align-items: center;
	gap: 2px;
	opacity: 0;
	transition: opacity 120ms ease;
}
.dsh-am-row:hover .dsh-am-row-actions,
.dsh-am-row:focus-within .dsh-am-row-actions { opacity: 1; }
@media (hover: none) { .dsh-am-row-actions { opacity: 1; } }
.dsh-am-empty {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 6px;
	height: 100%;
	min-height: 160px;
	padding: 24px 28px;
	text-align: center;
}
.dsh-am-empty-title { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-secondary, #5b6270); }
.dsh-am-empty-hint { font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-tertiary, #7b8290); }
.dsh-am-foot {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 6px 12px;
	border-top: 1px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.16));
	font-size: 11px;
	color: var(--dsw-alias-label-tertiary, #7b8290);
}
.dsh-am-foot > span:last-child { margin-left: auto; font-variant-numeric: tabular-nums; }
.dsh-am-toast {
	position: absolute;
	left: 12px;
	right: 12px;
	bottom: 34px;
	padding: 7px 10px;
	border-radius: var(--dsw-radius-md, 8px);
	background: var(--dsw-alias-toast-bg, rgba(28, 32, 40, 0.92));
	color: #fff;
	font-size: 12px;
	line-height: 1.5;
	box-shadow: var(--dsw-shadow-lv3, 0 8px 24px rgba(0, 0, 0, 0.2));
	animation: dsh-am-pop 140ms ease-out;
}
.dsh-am-toast[data-kind="error"] { background: var(--dsw-alias-state-error-bg, #c0392b); }
.dsh-am-spinner {
	display: inline-block;
	width: 12px;
	height: 12px;
	border: 1.5px solid currentColor;
	border-right-color: transparent;
	border-radius: 50%;
	animation: dsh-am-spin 700ms linear infinite;
}
@keyframes dsh-am-spin { to { transform: rotate(360deg); } }
.dsh-am-rz { position: absolute; touch-action: none; }
.dsh-am-rz-n { top: -3px; left: 8px; right: 8px; height: 6px; cursor: ns-resize; }
.dsh-am-rz-s { bottom: -3px; left: 8px; right: 8px; height: 6px; cursor: ns-resize; }
.dsh-am-rz-e { right: -3px; top: 8px; bottom: 8px; width: 6px; cursor: ew-resize; }
.dsh-am-rz-w { left: -3px; top: 8px; bottom: 8px; width: 6px; cursor: ew-resize; }
.dsh-am-rz-nw { left: -3px; top: -3px; width: 12px; height: 12px; cursor: nwse-resize; }
.dsh-am-rz-ne { right: -3px; top: -3px; width: 12px; height: 12px; cursor: nesw-resize; }
.dsh-am-rz-sw { left: -3px; bottom: -3px; width: 12px; height: 12px; cursor: nesw-resize; }
.dsh-am-rz-se { right: -3px; bottom: -3px; width: 12px; height: 12px; cursor: nwse-resize; }
`;

		/** Inject the panel stylesheet once per document. */
		function installStyles() {
			if (typeof document === "undefined" || !document) return;
			if (document.querySelector('style[data-plugin-css="' + CSS_KEY + '"]')) return;
			const style = document.createElement("style");
			style.setAttribute("data-plugin", NS);
			style.setAttribute("data-plugin-css", CSS_KEY);
			style.textContent = CSS;
			(document.head || document.documentElement).appendChild(style);
		}

		/* ------------------------------------------------------------------ *
		 * Snapshot helpers                                                    *
		 * ------------------------------------------------------------------ */

		/** One list row for a session id, tolerating a missing session record. */
		function rowOf(id, byId) {
			const session = byId ? byId[id] : undefined;
			const title = session && session.displayTitle ? String(session.displayTitle) : "";
			const cwd = session && typeof session.cwd === "string" ? session.cwd : "";
			return {
				id: String(id),
				title: title || shortId(id),
				cwd,
				updatedAt: session ? session.updatedAt : undefined,
			};
		}

		/**
		 * Group archived session ids by owning workspace.
		 *
		 * Workspace rows keep every session id they ever owned, the archive set is
		 * a separate Host-authoritative list, so the intersection is the truth.
		 * Ids that no workspace claims (deleted workspace, or a session archived
		 * from a different profile) fall into a trailing "Ungrouped" bucket rather
		 * than disappearing.
		 *
		 * @param items - `workspaces.list` snapshot items.
		 * @param archivedIds - `workspaces.list` snapshot archivedSessionIds.
		 * @param byId - `sessions.list` snapshot byId.
		 * @param t - translator.
		 * @returns `[{ key, title, path, rows }]`
		 */
		function groupArchived(items, archivedIds, byId, t) {
			const archived = new Set(archivedIds);
			const claimed = new Set();
			const groups = [];
			for (const workspace of items) {
				if (!workspace) continue;
				const owned = Array.isArray(workspace.sessionIds) ? workspace.sessionIds : [];
				const rows = [];
				for (const id of owned) {
					const key = String(id);
					if (!archived.has(id) && !archived.has(key)) continue;
					if (claimed.has(key)) continue;
					claimed.add(key);
					rows.push(rowOf(key, byId));
				}
				if (!rows.length) continue;
				rows.sort((left, right) => {
					const a = typeof left.updatedAt === "number" ? left.updatedAt : 0;
					const b = typeof right.updatedAt === "number" ? right.updatedAt : 0;
					return b - a;
				});
				const path = typeof workspace.path === "string" ? workspace.path : "";
				groups.push({
					key: String(workspace.workspaceId || groups.length),
					title: workspace.title ? String(workspace.title) : baseName(path) || t("group.untitled"),
					path,
					rows,
				});
			}
			const orphans = [];
			for (const id of archivedIds) {
				const key = String(id);
				if (claimed.has(key)) continue;
				claimed.add(key);
				orphans.push(rowOf(key, byId));
			}
			if (orphans.length) {
				orphans.sort((left, right) => {
					const a = typeof left.updatedAt === "number" ? left.updatedAt : 0;
					const b = typeof right.updatedAt === "number" ? right.updatedAt : 0;
					return b - a;
				});
				groups.push({ key: "@ungrouped", title: t("group.ungrouped"), path: "", rows: orphans });
			}
			return groups;
		}

		/** Case-insensitive match against title, id and working directory. */
		function matchesQuery(row, query) {
			if (!query) return true;
			return (
				row.title.toLowerCase().indexOf(query) !== -1 ||
				row.id.toLowerCase().indexOf(query) !== -1 ||
				row.cwd.toLowerCase().indexOf(query) !== -1
			);
		}

		/** Initial panel rectangle: bottom-left of the viewport, above the sidebar footer. */
		function initialGeometry() {
			const width = Math.min(DEFAULT_WIDTH, viewportWidth() - 2 * MARGIN);
			const height = Math.min(DEFAULT_HEIGHT, viewportHeight() - 2 * MARGIN);
			return {
				left: 12,
				top: Math.max(MARGIN, viewportHeight() - height - 64),
				width,
				height,
			};
		}

		function viewportWidth() {
			if (typeof window !== "undefined" && window && Number.isFinite(window.innerWidth) && window.innerWidth > 0) {
				return window.innerWidth;
			}
			return 1280;
		}

		function viewportHeight() {
			if (typeof window !== "undefined" && window && Number.isFinite(window.innerHeight) && window.innerHeight > 0) {
				return window.innerHeight;
			}
			return 800;
		}

		/** Keep a rectangle fully on screen and above the minimum size. */
		function clampGeometry(next) {
			const maxWidth = Math.max(MIN_WIDTH, viewportWidth() - 2 * MARGIN);
			const maxHeight = Math.max(MIN_HEIGHT, viewportHeight() - 2 * MARGIN);
			const width = Math.min(Math.max(next.width, MIN_WIDTH), maxWidth);
			const height = Math.min(Math.max(next.height, MIN_HEIGHT), maxHeight);
			const maxLeft = Math.max(MARGIN, viewportWidth() - width - MARGIN);
			const maxTop = Math.max(MARGIN, viewportHeight() - height - MARGIN);
			return {
				left: Math.min(Math.max(next.left, MARGIN), maxLeft),
				top: Math.min(Math.max(next.top, MARGIN), maxTop),
				width,
				height,
			};
		}

		/* ------------------------------------------------------------------ *
		 * Trigger + panel component                                           *
		 * ------------------------------------------------------------------ */

		/**
		 * Sidebar footer entry: a small "Archive" button plus the popup panel.
		 *
		 * Props come from two sources: the slot itself (`wide`) and `inject()`
		 * (`useWorkspaces`, `useSessions`, the action callbacks, and the bound
		 * `t` when the locale namespace is registered). Every prop is treated as
		 * optional — a missing callback disables one action instead of breaking
		 * the whole panel.
		 */
		function ArchiveManager(props) {
			const t = translator(props.t);
			const useWorkspaces = props.useWorkspaces;
			const useSessions = props.useSessions;
			const workspacesState = typeof useWorkspaces === "function" ? useWorkspaces((state) => state) : undefined;
			const sessionsState = typeof useSessions === "function" ? useSessions((state) => state) : undefined;

			const [open, setOpen] = react.useState(false);
			const [query, setQuery] = react.useState("");
			const [geometry, setGeometry] = react.useState(null);
			const [pending, setPending] = react.useState(null);
			const [progress, setProgress] = react.useState(null);
			const [toast, setToast] = react.useState(null);
			const dragRef = react.useRef(null);
			const queryRef = react.useRef(null);
			const toastSeq = react.useRef(0);

			const items = workspacesState && Array.isArray(workspacesState.items) ? workspacesState.items : [];
			const archivedIds = workspacesState && Array.isArray(workspacesState.archivedSessionIds) ? workspacesState.archivedSessionIds : [];
			const byId = sessionsState && sessionsState.byId ? sessionsState.byId : {};
			const total = archivedIds.length;
			const groups = groupArchived(items, archivedIds, byId, t);

			const needle = query.trim().toLowerCase();
			const visibleGroups = [];
			let shown = 0;
			for (const group of groups) {
				const rows = needle ? group.rows.filter((row) => matchesQuery(row, needle)) : group.rows;
				if (!rows.length) continue;
				shown += rows.length;
				visibleGroups.push({ key: group.key, title: group.title, path: group.path, rows });
			}

			const notify = react.useCallback((kind, text) => {
				toastSeq.current += 1;
				setToast({ kind, text, seq: toastSeq.current });
			}, []);

			react.useEffect(() => {
				if (!toast) return undefined;
				const timer = window.setTimeout(() => setToast(null), toast.kind === "error" ? 6000 : 2600);
				return () => window.clearTimeout(timer);
			}, [toast]);

			react.useEffect(() => {
				if (!open) return undefined;
				const onKeyDown = (event) => {
					if (event.key === "Escape") {
						event.preventDefault();
						event.stopPropagation();
						setOpen(false);
					}
				};
				window.addEventListener("keydown", onKeyDown, true);
				return () => window.removeEventListener("keydown", onKeyDown, true);
			}, [open]);

			react.useEffect(() => {
				if (!open) return undefined;
				const input = queryRef.current;
				if (input && typeof input.focus === "function") {
					const timer = window.setTimeout(() => input.focus(), 30);
					return () => window.clearTimeout(timer);
				}
				return undefined;
			}, [open]);

			const busy = (id) => Boolean(pending && pending[id]);

			const restoreOne = async (row, alsoOpen) => {
				if (typeof props.restoreOne !== "function") {
					notify("error", t("toast.unavailable"));
					return;
				}
				setPending((current) => Object.assign({}, current || {}, { [row.id]: true }));
				try {
					await props.restoreOne(row.id);
					notify("ok", t("toast.restored", { title: ellipsis(row.title) }));
					if (alsoOpen) {
						let opened = false;
						if (typeof props.openSession === "function") {
							try {
								opened = props.openSession(row.id) !== false;
							} catch (error) {
								opened = false;
							}
						}
						if (!opened) notify("ok", t("toast.openMissing"));
					}
				} catch (error) {
					notify("error", t("toast.restoreFailed", { reason: reasonOf(error) }));
				} finally {
					setPending((current) => {
						const next = Object.assign({}, current || {});
						delete next[row.id];
						return next;
					});
				}
			};

			const restoreVisible = async () => {
				if (typeof props.restoreMany !== "function" || typeof props.restoreOne !== "function") {
					notify("error", t("toast.unavailable"));
					return;
				}
				const ids = [];
				for (const group of visibleGroups) {
					for (const row of group.rows) ids.push(row.id);
				}
				if (!ids.length) return;
				setProgress({ done: 0, total: ids.length });
				try {
					await props.restoreMany(ids, (done, totalCount) => {
						setProgress({ done, total: totalCount });
					});
					notify("ok", t("toast.restoredMany", { count: ids.length }));
				} catch (error) {
					const failures = error && Array.isArray(error.failures) ? error.failures : null;
					if (failures && failures.length) {
						const done = ids.length - failures.length;
						notify(
							failures.length === ids.length ? "error" : "ok",
							t("toast.partial", { done, failed: failures.length }) + " — " + reasonOf(failures[0].error),
						);
					} else {
						notify("error", t("toast.restoreFailed", { reason: reasonOf(error) }));
					}
				} finally {
					setProgress(null);
				}
			};

			const revealRow = async (row) => {
				if (typeof props.revealPath !== "function") return;
				try {
					await props.revealPath(row.cwd);
				} catch (error) {
					notify("error", t("toast.revealFailed", { reason: reasonOf(error) }));
				}
			};

			const beginDrag = (event, mode) => {
				if (event.button !== undefined && event.button !== 0) return;
				if (mode === "move") {
					const target = event.target;
					if (target && typeof target.closest === "function" && target.closest("button, input, textarea, a, select")) return;
				}
				const base = geometry || initialGeometry();
				if (!geometry) setGeometry(base);
				event.preventDefault();
				dragRef.current = {
					mode,
					pointerId: event.pointerId,
					startX: event.clientX,
					startY: event.clientY,
					base,
				};
				if (event.currentTarget && typeof event.currentTarget.setPointerCapture === "function" && event.pointerId !== undefined) {
					try {
						event.currentTarget.setPointerCapture(event.pointerId);
					} catch (error) {
						/* capture is an optimisation only */
					}
				}
			};

			const onPointerMove = (event) => {
				const drag = dragRef.current;
				if (!drag || (drag.pointerId !== undefined && event.pointerId !== drag.pointerId)) return;
				const dx = event.clientX - drag.startX;
				const dy = event.clientY - drag.startY;
				const base = drag.base;
				if (drag.mode === "move") {
					setGeometry(clampGeometry({ left: base.left + dx, top: base.top + dy, width: base.width, height: base.height }));
					return;
				}
				let left = base.left;
				let top = base.top;
				let width = base.width;
				let height = base.height;
				if (drag.mode.indexOf("e") !== -1) width = base.width + dx;
				if (drag.mode.indexOf("s") !== -1) height = base.height + dy;
				if (drag.mode.indexOf("w") !== -1) {
					width = base.width - dx;
					left = base.left + dx;
				}
				if (drag.mode.indexOf("n") !== -1) {
					height = base.height - dy;
					top = base.top + dy;
				}
				if (width < MIN_WIDTH) left = base.left + base.width - MIN_WIDTH;
				if (height < MIN_HEIGHT) top = base.top + base.height - MIN_HEIGHT;
				setGeometry(clampGeometry({ left, top, width, height }));
			};

			const endDrag = (event) => {
				const drag = dragRef.current;
				if (!drag) return;
				dragRef.current = null;
				const target = event && event.currentTarget;
				if (target && typeof target.releasePointerCapture === "function" && drag.pointerId !== undefined) {
					try {
						target.releasePointerCapture(drag.pointerId);
					} catch (error) {
						/* nothing to release */
					}
				}
			};

			const toggle = () => {
				if (open) {
					setOpen(false);
					return;
				}
				if (!geometry) setGeometry(clampGeometry(initialGeometry()));
				setOpen(true);
			};

			const trigger = h(
				"button",
				{
					type: "button",
					className: "dsh-am-trigger",
					title: t("trigger.title"),
					"aria-label": t("trigger.title"),
					"aria-haspopup": "dialog",
					"aria-expanded": open ? "true" : "false",
					onClick: toggle,
				},
				h(Icon, { name: "archive" }),
				props.wide === false ? null : h("span", { className: "dsh-am-trigger-label" }, t("trigger.label")),
				total > 0 ? h("span", { className: "dsh-am-badge" }, total > 99 ? "99+" : String(total)) : null,
			);

			if (!open) return trigger;

			const box = clampGeometry(geometry || initialGeometry());
			const panelStyle = {
				left: box.left + "px",
				top: box.top + "px",
				width: box.width + "px",
				height: box.height + "px",
			};

			const header = h(
				"div",
				{
					className: "dsh-am-head",
					onPointerDown: (event) => beginDrag(event, "move"),
					onPointerMove,
					onPointerUp: endDrag,
					onPointerCancel: endDrag,
				},
				h("span", { className: "dsh-am-head-icon" }, h(Icon, { name: "archive" })),
				h("span", { className: "dsh-am-head-title" }, t("panel.title")),
				h("span", { className: "dsh-am-head-count" }, String(total)),
				h("span", { className: "dsh-am-spacer" }),
				h(
					"button",
					{
						type: "button",
						className: "dsh-am-icon-btn",
						title: t("action.restoreAll"),
						"aria-label": t("action.restoreAll"),
						disabled: shown === 0 || progress !== null,
						onClick: restoreVisible,
					},
					h(Icon, { name: "checkAll" }),
				),
				h(
					"button",
					{
						type: "button",
						className: "dsh-am-icon-btn",
						title: t("panel.close"),
						"aria-label": t("panel.close"),
						onClick: () => setOpen(false),
					},
					h(Icon, { name: "close" }),
				),
			);

			const toolbar = h(
				"div",
				{ className: "dsh-am-toolbar" },
				h(
					"div",
					{ className: "dsh-am-search" },
					h(Icon, { name: "search", size: 13 }),
					h("input", {
						ref: queryRef,
						className: "dsh-am-input",
						type: "search",
						value: query,
						placeholder: t("search.placeholder"),
						spellCheck: false,
						autoComplete: "off",
						onChange: (event) => setQuery(event.target.value),
					}),
					query
						? h(
								"button",
								{
									type: "button",
									className: "dsh-am-clear",
									title: t("search.clear"),
									"aria-label": t("search.clear"),
									onClick: () => setQuery(""),
								},
								h(Icon, { name: "close", size: 11 }),
							)
						: null,
				),
			);

			let body;
			if (total === 0) {
				body = h(
					"div",
					{ className: "dsh-am-empty" },
					h("div", { className: "dsh-am-empty-title" }, t("empty.title")),
					h("div", { className: "dsh-am-empty-hint" }, t("empty.hint")),
				);
			} else if (shown === 0) {
				body = h(
					"div",
					{ className: "dsh-am-empty" },
					h("div", { className: "dsh-am-empty-title" }, t("empty.noMatch")),
					h("div", { className: "dsh-am-empty-hint" }, t("search.placeholder")),
				);
			} else {
				body = visibleGroups.map((group) =>
					h(
						"section",
						{ className: "dsh-am-group", key: group.key },
						h(
							"div",
							{ className: "dsh-am-group-head" },
							h("span", { className: "dsh-am-group-title", title: group.path || group.title }, group.title),
							h("span", { className: "dsh-am-group-count" }, String(group.rows.length)),
						),
						group.rows.map((row) => {
							const isBusy = busy(row.id);
							return h(
								"div",
								{ className: "dsh-am-row", key: row.id, "data-busy": isBusy ? "true" : undefined },
								h(
									"div",
									{ className: "dsh-am-row-main" },
									h("div", { className: "dsh-am-row-title", title: row.title }, row.title),
									h(
										"div",
										{ className: "dsh-am-row-meta" },
										h("span", { className: "dsh-am-mono" }, shortId(row.id)),
										row.cwd ? h("span", { className: "dsh-am-dot" }, "\u00b7") : null,
										row.cwd ? h("span", { className: "dsh-am-row-cwd", title: row.cwd }, baseName(row.cwd)) : null,
										row.updatedAt ? h("span", { className: "dsh-am-dot" }, "\u00b7") : null,
										row.updatedAt ? h("span", null, relativeTime(row.updatedAt, t)) : null,
									),
								),
								isBusy ? h("span", { className: "dsh-am-spinner" }) : null,
								h(
									"div",
									{ className: "dsh-am-row-actions" },
									h(
										"button",
										{
											type: "button",
											className: "dsh-am-icon-btn",
											title: t("action.restoreOpen"),
											"aria-label": t("action.restoreOpen"),
											disabled: isBusy || progress !== null,
											onClick: () => restoreOne(row, true),
										},
										h(Icon, { name: "open", size: 14 }),
									),
									h(
										"button",
										{
											type: "button",
											className: "dsh-am-icon-btn",
											title: t("action.restore"),
											"aria-label": t("action.restore"),
											disabled: isBusy || progress !== null,
											onClick: () => restoreOne(row, false),
										},
										h(Icon, { name: "restore", size: 14 }),
									),
									row.cwd
										? h(
												"button",
												{
													type: "button",
													className: "dsh-am-icon-btn",
													title: t("action.reveal"),
													"aria-label": t("action.reveal"),
													disabled: isBusy,
													onClick: () => revealRow(row),
												},
												h(Icon, { name: "folder", size: 14 }),
											)
										: null,
								),
							);
						}),
					),
				);
			}

			const footer = h(
				"div",
				{ className: "dsh-am-foot" },
				h(
					"span",
					null,
					progress
						? h("span", { className: "dsh-am-spinner" })
						: t("foot.hint", { total }),
				),
				progress
					? h("span", null, t("progress.running", { done: progress.done, total: progress.total }))
					: needle
						? h("span", null, t("foot.filtered", { shown, total }))
						: null,
			);

			const handles = ["n", "s", "e", "w", "nw", "ne", "sw", "se"].map((side) =>
				h("div", {
					key: side,
					className: "dsh-am-rz dsh-am-rz-" + side,
					onPointerDown: (event) => beginDrag(event, "resize-" + side),
					onPointerMove,
					onPointerUp: endDrag,
					onPointerCancel: endDrag,
				}),
			);

			return h(
				react.Fragment,
				null,
				trigger,
				h(
					"div",
					{
						className: "dsh-am-panel",
						role: "dialog",
						"aria-label": t("panel.title"),
						style: panelStyle,
					},
					header,
					toolbar,
					h("div", { className: "dsh-am-body" }, body),
					footer,
					toast ? h("div", { className: "dsh-am-toast", "data-kind": toast.kind, key: toast.seq }, toast.text) : null,
					handles,
				),
			);
		}

		/* ------------------------------------------------------------------ *
		 * Plugin body                                                         *
		 * ------------------------------------------------------------------ */

		/**
		 * Services required before this plugin can apply. Only the three that the
		 * panel cannot work without: the slot registry, the archive-carrying
		 * workspace model, and the session catalog used for titles and folders.
		 * `uiWorkspace` (open) and `remote.session` (reveal) are read lazily, so
		 * their absence disables one action instead of the whole panel.
		 */
		const inject = ["slots", "workspaces", "sessions"];

		/**
		 * Register the sidebar entry.
		 * @param ctx - client root context.
		 */
		function apply(ctx) {
			installStyles();

			ctx.effect(() => {
				const locale = typeof ctx.get === "function" ? ctx.get("locale") : undefined;
				if (!locale || typeof locale.register !== "function") return () => {};
				return locale.register(NS, { zh, en });
			}, "dsh-archive-manager: dictionaries");

			const locale = typeof ctx.get === "function" ? ctx.get("locale") : undefined;
			const t = translator(locale && typeof locale.bind === "function" ? locale.bind(NS) : undefined);

			/** Restore one archived session through the Host-authoritative archive API. */
			const restoreOne = async (sessionId) => {
				const workspaces = ctx.workspaces;
				if (!workspaces || typeof workspaces.unarchiveSession !== "function") {
					throw new Error("unarchiveSession() is unavailable");
				}
				await workspaces.unarchiveSession(sessionId);
			};

			/** Restore every id, reporting progress and collecting partial failures. */
			const restoreMany = async (sessionIds, onProgress) => {
				const ids = Array.isArray(sessionIds) ? sessionIds.slice() : [];
				const failures = [];
				let done = 0;
				for (const id of ids) {
					try {
						await restoreOne(id);
					} catch (error) {
						failures.push({ id, error });
					}
					done += 1;
					if (typeof onProgress === "function") {
						try {
							onProgress(done, ids.length);
						} catch (error) {
							/* a UI callback must not abort the batch */
						}
					}
				}
				if (failures.length) {
					const error = new Error("restored " + (ids.length - failures.length) + "/" + ids.length + " sessions");
					error.failures = failures;
					throw error;
				}
				return done;
			};

			/** Reveal a session in the main view; returns false when unavailable. */
			const openSession = (sessionId) => {
				const workspaceUi = typeof ctx.get === "function" ? ctx.get("uiWorkspace") : undefined;
				if (!workspaceUi || typeof workspaceUi.openSession !== "function") return false;
				workspaceUi.openSession(sessionId);
				return true;
			};

			/** Reveal a directory in the OS file manager through the session Remote. */
			const revealPath = async (path) => {
				if (typeof path !== "string" || !path) throw new Error("no folder to reveal");
				const remote = typeof ctx.get === "function" ? ctx.get("remote.session") : undefined;
				if (!remote || typeof remote.openWorkspacePath !== "function") {
					throw new Error("openWorkspacePath() is unavailable");
				}
				const result = await remote.openWorkspacePath({ path, action: "reveal" });
				if (result && result.ok === false) throw result.error || new Error("reveal rejected");
			};

			ctx.slots.inject(SLOT, () =>
				ctx.slots.register(
					{
						name: SLOT,
						id: NS,
						order: ORDER,
						locale: NS,
						inject: () => ({
							hooks: {
								useWorkspaces: ctx.workspaces.list,
								useSessions: ctx.sessions.list,
							},
							restoreOne,
							restoreMany,
							openSession,
							revealPath,
							t,
						}),
					},
					ArchiveManager,
				),
			);
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.name = NS;
		return module.exports;
	},
});
