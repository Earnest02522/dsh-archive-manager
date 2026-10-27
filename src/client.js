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
		/** Where the sidebar-entry width preference is remembered. */
		const STYLE_KEY = NS + "/trigger-style";

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
			"action.deleteAll": "全部删除",
			"deleteAll.confirm": "永久删除全部 {count} 个归档会话？",
			"action.delete": "删除归档会话",
			"action.select": "选择该会话",
			"action.selectAll": "全选",
			"action.clearSelection": "清除选择",
			"action.triggerWide": "入口改为通栏",
			"action.triggerCompact": "入口改为紧凑",
			"delete.confirm": "永久删除「{title}」？会话记录文件会被移除，无法撤销。",
			"delete.confirmShort": "永久删除「{title}」？",
			"delete.irreversible": "无法撤销",
			"delete.confirmYes": "删除",
			"delete.confirmNo": "取消",
			"bulk.selected": "已选 {count} 项",
			"bulk.hint": "可批量恢复或删除",
			"bulk.restore": "恢复所选",
			"bulk.delete": "删除所选",
			"bulk.confirm": "永久删除这 {count} 个归档会话？",
			"group.restore": "恢复该组的 {count} 个会话",
			"group.delete": "删除该组的 {count} 个会话",
			"group.confirm": "永久删除该组的 {count} 个会话？",
			"group.collapse": "收起该组",
			"group.expand": "展开该组",
			"group.collapsed": "已收起 {count} 个",
			"toast.deleted": "已删除「{title}」",
			"toast.deletedMany": "已删除 {count} 个会话",
			"toast.deletedPartial": "已删除 {done} 个，{failed} 个失败",
			"toast.deleteFailed": "删除失败：{reason}",
			"toast.deleteActive": "该会话仍在运行，请先停止再删除",
			"toast.deleteUnavailable": "当前 DSH 版本没有提供删除会话的接口",
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
			"progress.running": "正在处理 {done}/{total}",
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
			"action.deleteAll": "Delete all",
			"deleteAll.confirm": "Permanently delete all {count} archived conversations?",
			"action.delete": "Delete archived conversation",
			"action.select": "Select this conversation",
			"action.selectAll": "Select all",
			"action.clearSelection": "Clear selection",
			"action.triggerWide": "Stretch the sidebar entry",
			"action.triggerCompact": "Compact the sidebar entry",
			"delete.confirm": "Permanently delete \"{title}\"? Its transcript file is removed and cannot be restored.",
			"delete.confirmShort": "Permanently delete \"{title}\"?",
			"delete.irreversible": "cannot be undone",
			"delete.confirmYes": "Delete",
			"delete.confirmNo": "Cancel",
			"bulk.selected": "{count} selected",
			"bulk.hint": "restore or delete together",
			"bulk.restore": "Restore selected",
			"bulk.delete": "Delete selected",
			"bulk.confirm": "Permanently delete these {count} archived conversations?",
			"group.restore": "Restore the {count} conversations in this group",
			"group.delete": "Delete the {count} conversations in this group",
			"group.confirm": "Permanently delete the {count} conversations in this group?",
			"group.collapse": "Collapse this group",
			"group.expand": "Expand this group",
			"group.collapsed": "{count} hidden",
			"toast.deleted": "Deleted \"{title}\"",
			"toast.deletedMany": "Deleted {count} conversations",
			"toast.deletedPartial": "Deleted {done}, {failed} failed",
			"toast.deleteFailed": "Delete failed: {reason}",
			"toast.deleteActive": "This conversation is still running — stop it before deleting",
			"toast.deleteUnavailable": "This DSH version exposes no delete-session API",
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
			"progress.running": "Working {done}/{total}",
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

		/**
		 * Per-group accent colours.
		 *
		 * The panel used to be entirely grey, which made a long archive look like
		 * one block. Each workspace now gets a stable hue derived from its id, so
		 * groups are told apart by colour as well as by heading — and the hue does
		 * not jump around when sessions are restored or deleted (it depends on the
		 * key only, never on position).
		 */
		const ACCENTS = [
			"#5b8def",
			"#2f9e6e",
			"#c1802f",
			"#9469d6",
			"#2f9fc4",
			"#d15b56",
			"#3aa79b",
			"#b5892f",
		];

		/** Stable accent for a group key (`@ungrouped` gets the neutral slate). */
		function accentOf(key) {
			const text = String(key === undefined || key === null ? "" : key);
			if (text === "@ungrouped") return "#7b8290";
			let hash = 0;
			for (let index = 0; index < text.length; index += 1) {
				hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
			}
			return ACCENTS[hash % ACCENTS.length];
		}

		/** Inline custom properties consumed by the stylesheet for one group. */
		function accentStyle(key) {
			const color = accentOf(key);
			return {
				"--dsh-am-accent": color,
				"--dsh-am-accent-soft": color + "1f",
				"--dsh-am-accent-line": color + "59",
			};
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
		 * Host Remote — `archiveManager/deleteSession`                        *
		 *                                                                     *
		 * Deleting a stored conversation is the one operation DSH does not    *
		 * offer as a first-party client API, so this package ships a small    *
		 * Host service (see src/index.js) and mounts its wire descriptor      *
		 * here. Everything else in the panel stays first-party.               *
		 * ------------------------------------------------------------------ */

		/** Wire namespace and method of the only Remote this panel uses. */
		const REMOTE_ENDPOINT = "archiveManager/deleteSession";

		/**
		 * Build one strict codec.
		 *
		 * `$mount` refuses descriptors whose parameter codecs are not strict,
		 * and the registry wants a `typeSymbol` plus a `create` function — but
		 * the browser never encodes a request or decodes a response for this
		 * endpoint (it sends `{ sessionId }` and reads plain JSON), so `create`
		 * only has to exist.
		 *
		 * @param typeSymbol - stable name reported to the registry.
		 * @returns a strict codec with no schema of its own.
		 */
		function codec(typeSymbol) {
			return { mode: "strict", typeSymbol: NS + "#" + typeSymbol, create: () => ({}) };
		}

		/** Descriptor for `archiveManager/deleteSession`. */
		const REMOTE_DESCRIPTOR = {
			id: NS + "#" + REMOTE_ENDPOINT,
			service: "archiveManager",
			namespace: "archiveManager",
			method: "deleteSession",
			description: "Delete the stored transcript of one archived conversation.",
			invocation: { kind: "direct" },
			parameters: [{ name: "request", wire: "request", source: "json", codec: codec("DeleteRequest") }],
			result: codec("DeleteResult"),
		};

		/**
		 * Mounted Remote namespaces, memoised per client context.
		 *
		 * Keyed by context rather than by module so a second composition (hot
		 * reload, tests) mounts its own descriptor set instead of reusing a handle
		 * bound to another gateway. Mounting is deferred to the first delete so a
		 * gateway that is still warming up cannot poison the cache, and a failure is
		 * remembered as `undefined` so the panel reports "unavailable" instead of
		 * retrying on every click.
		 */
		const mountedNamespaces = new WeakMap();

		/**
		 * Resolve the Host delete service, mounting the descriptor on first use.
		 *
		 * @param ctx - client root context.
		 * @returns the Remote namespace handle, or `undefined` when the gateway,
		 *   the descriptor, or the Host service is unavailable.
		 */
		function deleteRemote(ctx) {
			const existing = typeof ctx.get === "function" ? ctx.get("remote.archiveManager") : undefined;
			if (existing && typeof existing.deleteSession === "function") return Promise.resolve(existing);

			const cached = mountedNamespaces.get(ctx);
			if (cached) return cached;

			const remote = typeof ctx.get === "function" ? ctx.get("remote") : undefined;
			const pending = (async () => {
				if (!remote || typeof remote.$mount !== "function") return undefined;
				try {
					await remote.$mount({ package: NS, descriptors: [REMOTE_DESCRIPTOR] });
				} catch (error) {
					return undefined;
				}
				const service = typeof ctx.get === "function" ? ctx.get("remote.archiveManager") : undefined;
				if (service && typeof service.deleteSession === "function") return service;
				try {
					const viaRemote = remote.archiveManager;
					if (viaRemote && typeof viaRemote.deleteSession === "function") return viaRemote;
				} catch (error) {
					/* an unmounted namespace throws on access */
				}
				return undefined;
			})().catch(() => undefined);

			mountedNamespaces.set(ctx, pending);
			return pending;
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
			check: "M5 12.5l4.5 4.5L19 7",
			select: "M4.5 4.5h15v15h-15z|M8.5 12.6l2.6 2.6 4.6-5.4",
			trash: "M4 7h16|M9.5 7V4.5h5V7|M6.5 7l1 13h9l1-13|M10.5 11v5|M13.5 11v5",
			chevron: "M9 5.5l7 6.5-7 6.5",
			stretch: "M4 12h16|M8 8.5 4.5 12 8 15.5|M16 8.5 19.5 12 16 15.5",
		};

		/**
		 * The sidebar entry ships compact: it hugs its own content, like a chip
		 * next to the other footer controls. "Wide" is the optional variant that
		 * stretches across the sidebar and lines up with the rows above it. It is
		 * a matter of taste, so it is a preference — remembered per browser, and
		 * never applied on its own.
		 */
		function storedTriggerStyle() {
			try {
				const storage = typeof window !== "undefined" ? window.localStorage : undefined;
				return storage && storage.getItem(STYLE_KEY) === "wide" ? "wide" : "compact";
			} catch {
				return "compact";
			}
		}

		function rememberTriggerStyle(style) {
			try {
				const storage = typeof window !== "undefined" ? window.localStorage : undefined;
				if (storage) storage.setItem(STYLE_KEY, style);
			} catch {
				/* Blocked storage is not worth a broken panel. */
			}
		}

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
/* Sidebar entry ------------------------------------------------------- */
.dsh-am-trigger {
	position: relative;
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
.dsh-am-trigger-icon { display: inline-flex; }
.dsh-am-trigger-label { white-space: nowrap; }
/*
 * Optional "wide" entry, toggled from the panel header and remembered per
 * browser. The footer slot is a full-width flex row, so growing the entry by
 * flex makes it line up with the rows above instead of floating as a chip.
 */
.dsh-am-trigger[data-style="wide"] {
	display: flex;
	flex: 1 1 auto;
	justify-content: flex-start;
	gap: 8px;
	min-width: 0;
	height: 34px;
	margin: 0 2px;
	padding: 0 8px;
	font-size: 13px;
	text-align: left;
}
.dsh-am-trigger[data-style="wide"] .dsh-am-trigger-label {
	flex: 0 1 auto;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
}
.dsh-am-trigger[data-style="wide"] .dsh-am-badge { margin-left: auto; }
/* The collapsed rail wins over the wide preference: one square icon button. */
.dsh-am-trigger[data-wide="false"] {
	flex: none;
	width: 36px;
	height: 36px;
	margin: 0;
	padding: 0;
	justify-content: center;
}
.dsh-am-badge {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	min-width: 17px;
	height: 17px;
	padding: 0 5px;
	border-radius: 999px;
	background: linear-gradient(135deg, var(--dsw-alias-brand-primary, #5b8def), #7c5cd6);
	color: #fff;
	font-size: 10px;
	font-weight: 600;
	line-height: 17px;
	text-align: center;
	font-variant-numeric: tabular-nums;
	box-shadow: 0 1px 3px rgba(91, 141, 239, 0.35);
}

/* Panel --------------------------------------------------------------- */
.dsh-am-panel {
	position: fixed;
	z-index: 1200;
	display: flex;
	flex-direction: column;
	overflow: hidden;
	box-sizing: border-box;
	border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.22));
	border-radius: var(--dsw-radius-panel, 14px);
	background: var(--dsw-alias-bg-layer-2, #fff);
	color: var(--dsw-alias-label-primary, #1f2430);
	box-shadow: var(--dsw-shadow-lv3, 0 18px 48px rgba(0, 0, 0, 0.24)), 0 1px 2px rgba(0, 0, 0, 0.06);
	font-family: var(--dsw-font-family, inherit);
	font-size: 13px;
	animation: dsh-am-pop 150ms cubic-bezier(0.2, 0.8, 0.3, 1);
}
@keyframes dsh-am-pop {
	from { opacity: 0; transform: translateY(6px) scale(0.985); }
	to { opacity: 1; transform: none; }
}

/* Header -------------------------------------------------------------- */
.dsh-am-head {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 9px 8px 9px 12px;
	border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.14));
	background: linear-gradient(180deg, rgba(91, 141, 239, 0.14), rgba(124, 92, 214, 0.04));
	cursor: grab;
	user-select: none;
	touch-action: none;
}
.dsh-am-head:active { cursor: grabbing; }
.dsh-am-head-icon { display: inline-flex; color: var(--dsw-alias-brand-primary, #5b8def); }
.dsh-am-head-title {
	font-size: 13px;
	font-weight: 600;
	letter-spacing: 0.01em;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.dsh-am-head-count {
	min-width: 18px;
	padding: 1px 6px;
	border-radius: 999px;
	background: var(--dsw-alias-bg-layer-4, rgba(127, 127, 127, 0.16));
	color: var(--dsw-alias-label-secondary, #5b6270);
	font-size: 11px;
	text-align: center;
	font-variant-numeric: tabular-nums;
}
.dsh-am-spacer { flex: 1 1 auto; }

/* Controls ------------------------------------------------------------ */
.dsh-am-icon-btn {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	flex: none;
	width: 26px;
	height: 26px;
	padding: 0;
	border: 0;
	border-radius: var(--dsw-radius-sm, 6px);
	background: transparent;
	color: var(--dsw-alias-label-secondary, #5b6270);
	cursor: pointer;
	transition: background-color 120ms ease, color 120ms ease;
}
.dsh-am-icon-btn:hover:not(:disabled) {
	background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.14));
	color: var(--dsw-alias-label-primary, #1f2430);
}
.dsh-am-icon-btn:focus-visible {
	outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, #4c8dff);
	outline-offset: 1px;
}
.dsh-am-icon-btn:disabled { opacity: 0.35; cursor: default; }
/* Pressed icon buttons (the entry-width toggle) stay visibly on. */
.dsh-am-icon-btn[aria-pressed="true"] {
	background: var(--dsw-alias-interactive-bg-active, rgba(127, 127, 127, 0.2));
	color: var(--dsw-alias-label-primary, #1f2430);
}
/*
 * Tone per action. Grey-on-grey made four icons in a row indistinguishable at
 * a glance; restore/open/reveal now carry their own hue on hover, and the
 * destructive one stays red. The base colour is still neutral, so the row is
 * calm until the pointer arrives.
 */
.dsh-am-icon-btn[data-tone="open"]:hover:not(:disabled),
.dsh-am-icon-btn[data-tone="open"]:focus-visible {
	color: #4a7fe0;
	background: rgba(74, 127, 224, 0.14);
}
.dsh-am-icon-btn[data-tone="restore"]:hover:not(:disabled),
.dsh-am-icon-btn[data-tone="restore"]:focus-visible {
	color: #2f9e6e;
	background: rgba(47, 158, 110, 0.15);
}
.dsh-am-icon-btn[data-tone="reveal"]:hover:not(:disabled),
.dsh-am-icon-btn[data-tone="reveal"]:focus-visible {
	color: #c1802f;
	background: rgba(193, 128, 47, 0.15);
}
.dsh-am-icon-btn.dsh-am-danger:hover:not(:disabled),
.dsh-am-icon-btn.dsh-am-danger:focus-visible {
	color: var(--dsw-alias-label-error, #d15b56);
	background: rgba(209, 91, 86, 0.14);
}

.dsh-am-toolbar {
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 8px 10px;
	border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.14));
}
.dsh-am-search {
	display: flex;
	align-items: center;
	flex: 1 1 auto;
	gap: 6px;
	height: 30px;
	padding: 0 8px;
	border-radius: var(--dsw-radius-md, 8px);
	background: var(--dsw-alias-bg-layer-1, rgba(127, 127, 127, 0.08));
	color: var(--dsw-alias-label-tertiary, #7b8290);
	transition: box-shadow 120ms ease;
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

/* Body ---------------------------------------------------------------- */
.dsh-am-body {
	flex: 1 1 auto;
	min-height: 0;
	overflow-y: auto;
	overscroll-behavior: contain;
	padding: 2px 6px 8px;
	scrollbar-width: thin;
	scrollbar-color: var(--dsw-alias-border-l3, rgba(127, 127, 127, 0.4)) transparent;
}
.dsh-am-body::-webkit-scrollbar { width: 8px; }
.dsh-am-body::-webkit-scrollbar-track { background: transparent; }
.dsh-am-body::-webkit-scrollbar-thumb {
	border: 2px solid transparent;
	border-radius: 999px;
	background-clip: content-box;
	background-color: var(--dsw-alias-border-l3, rgba(127, 127, 127, 0.35));
}
.dsh-am-group { padding: 2px 0 4px; }
.dsh-am-group-head {
	position: sticky;
	top: 0;
	z-index: 1;
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 7px 6px 4px;
	background: var(--dsw-alias-bg-layer-2, #fff);
}
/* The heading itself is the collapse toggle: one wide target, no tiny ✕. */
.dsh-am-group-toggle {
	display: flex;
	align-items: center;
	gap: 6px;
	flex: 1 1 auto;
	min-width: 0;
	padding: 2px 4px;
	border: 0;
	border-radius: var(--dsw-radius-sm, 6px);
	background: transparent;
	color: inherit;
	font: inherit;
	text-align: left;
	cursor: pointer;
}
.dsh-am-group-toggle:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.1)); }
.dsh-am-group-toggle:focus-visible {
	outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, #4c8dff);
	outline-offset: 1px;
}
.dsh-am-group-accent {
	flex: none;
	width: 7px;
	height: 7px;
	border-radius: 999px;
	background: var(--dsh-am-accent, var(--dsw-alias-brand-primary, #5b8def));
	box-shadow: 0 0 0 3px var(--dsh-am-accent-soft, rgba(91, 141, 239, 0.14));
}
.dsh-am-group-chevron {
	display: inline-flex;
	flex: none;
	color: var(--dsw-alias-label-tertiary, #7b8290);
	transition: transform 140ms ease;
}
.dsh-am-group-toggle[aria-expanded="false"] .dsh-am-group-chevron { transform: rotate(-90deg); }
.dsh-am-group-title {
	flex: 1 1 auto;
	min-width: 0;
	font-size: 10.5px;
	font-weight: 600;
	letter-spacing: 0.07em;
	text-transform: uppercase;
	color: var(--dsw-alias-label-tertiary, #7b8290);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.dsh-am-group-count {
	flex: none;
	min-width: 16px;
	padding: 0 5px;
	border-radius: 999px;
	background: var(--dsh-am-accent-soft, var(--dsw-alias-bg-layer-3, rgba(127, 127, 127, 0.1)));
	color: var(--dsh-am-accent, var(--dsw-alias-label-caption, #9aa1ad));
	font-size: 10.5px;
	font-weight: 600;
	line-height: 16px;
	text-align: center;
	font-variant-numeric: tabular-nums;
}
/* Folded group: keep the heading, drop the rows, leave a one-line receipt. */
.dsh-am-group-collapsed {
	padding: 1px 8px 3px 25px;
	font-size: 11px;
	color: var(--dsw-alias-label-tertiary, #7b8290);
}
.dsh-am-group-actions {
	display: flex;
	align-items: center;
	gap: 2px;
	flex: none;
	opacity: 0;
	transition: opacity 120ms ease;
}
.dsh-am-group-head:hover .dsh-am-group-actions,
.dsh-am-group-head:focus-within .dsh-am-group-actions { opacity: 1; }
@media (hover: none) {
	.dsh-am-group-actions { opacity: 1; }
}
.dsh-am-group-confirm {
	display: flex;
	align-items: center;
	gap: 6px;
	flex: 1 1 auto;
	min-width: 0;
	font-size: 11px;
	color: var(--dsw-alias-label-secondary, #5b6270);
}
.dsh-am-group-confirm .dsh-am-confirm-text { flex: 1 1 auto; }

/* Rows ---------------------------------------------------------------- */
.dsh-am-row {
	display: flex;
	align-items: center;
	gap: 8px;
	min-height: 44px;
	padding: 5px 6px 5px 4px;
	border-radius: var(--dsw-radius-md, 8px);
	position: relative;
	transition: background-color 120ms ease, box-shadow 120ms ease;
}
.dsh-am-row:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.1)); }
.dsh-am-row[data-selected="true"] {
	background: rgba(76, 110, 245, 0.1);
	box-shadow: inset 2px 0 0 var(--dsw-alias-brand-primary, #4c6ef5);
}
.dsh-am-row[data-busy="true"] { opacity: 0.55; }
.dsh-am-check {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	flex: none;
	width: 18px;
	height: 18px;
	padding: 0;
	border: 1.5px solid var(--dsw-alias-border-l3, rgba(127, 127, 127, 0.45));
	border-radius: 5px;
	background: transparent;
	color: transparent;
	cursor: pointer;
	opacity: 0;
	transition: opacity 120ms ease, background-color 120ms ease, border-color 120ms ease;
}
.dsh-am-row:hover .dsh-am-check,
.dsh-am-row:focus-within .dsh-am-check,
.dsh-am-row[data-selected="true"] .dsh-am-check,
.dsh-am-check:focus-visible { opacity: 1; }
.dsh-am-check[aria-checked="true"] {
	border-color: transparent;
	background: var(--dsw-alias-brand-primary, #4c6ef5);
	color: #fff;
}
.dsh-am-check:focus-visible {
	outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, #4c8dff);
	outline-offset: 1px;
}
@media (hover: none) { .dsh-am-check { opacity: 1; } }
.dsh-am-row-main { flex: 1 1 auto; min-width: 0; }
.dsh-am-row-title {
	font-size: 13px;
	font-weight: 500;
	line-height: 1.35;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	color: var(--dsw-alias-label-primary, #1f2430);
}
.dsh-am-row-meta {
	display: flex;
	align-items: center;
	gap: 5px;
	margin-top: 1px;
	font-size: 11px;
	color: var(--dsw-alias-label-tertiary, #7b8290);
	white-space: nowrap;
	overflow: hidden;
}
.dsh-am-row-cwd {
	overflow: hidden;
	text-overflow: ellipsis;
	max-width: 140px;
}
.dsh-am-mono { font-family: var(--dsw-font-family-mono, ui-monospace, SFMono-Regular, Menlo, monospace); }
.dsh-am-dot { opacity: 0.45; }
.dsh-am-row-actions {
	display: flex;
	align-items: center;
	gap: 1px;
	opacity: 0;
	transform: translateX(2px);
	transition: opacity 120ms ease, transform 120ms ease;
}
.dsh-am-row:hover .dsh-am-row-actions,
.dsh-am-row:focus-within .dsh-am-row-actions,
.dsh-am-row[data-selected="true"] .dsh-am-row-actions { opacity: 1; transform: none; }
@media (hover: none) { .dsh-am-row-actions { opacity: 1; transform: none; } }

/* Inline delete confirmation, on the row itself ----------------------- */
.dsh-am-row[data-confirm="true"] {
	background: var(--dsw-alias-interactive-bg-hover-danger, rgba(192, 57, 43, 0.1));
	box-shadow: inset 2px 0 0 var(--dsw-alias-label-error, #c0392b);
}
.dsh-am-confirm {
	display: flex;
	align-items: center;
	gap: 6px;
	flex: 1 1 auto;
	min-width: 0;
	animation: dsh-am-confirm-in 120ms ease-out;
}
@keyframes dsh-am-confirm-in {
	from { opacity: 0; }
	to { opacity: 1; }
}
.dsh-am-confirm-icon {
	display: inline-flex;
	flex: none;
	color: var(--dsw-alias-label-error, #c0392b);
}
.dsh-am-confirm-text {
	flex: 1 1 auto;
	min-width: 0;
	font-size: 12px;
	line-height: 1.4;
	color: var(--dsw-alias-label-secondary, #5b6270);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

/* Buttons ------------------------------------------------------------- */
.dsh-am-btn {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: 4px;
	flex: none;
	height: 24px;
	padding: 0 9px;
	border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.28));
	border-radius: var(--dsw-radius-sm, 6px);
	background: var(--dsw-alias-bg-layer-1, rgba(127, 127, 127, 0.06));
	color: var(--dsw-alias-label-primary, #1f2430);
	font: inherit;
	font-size: 11.5px;
	line-height: 1;
	white-space: nowrap;
	cursor: pointer;
	transition: background-color 120ms ease, border-color 120ms ease;
}
.dsh-am-btn:hover:not(:disabled) {
	background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.12));
}
.dsh-am-btn:disabled { opacity: 0.45; cursor: default; }
.dsh-am-btn-label { white-space: nowrap; }
.dsh-am-btn:focus-visible {
	outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, #4c8dff);
	outline-offset: 1px;
}
.dsh-am-btn-danger {
	border-color: transparent;
	background: var(--dsw-alias-label-error, #c0392b);
	color: #fff;
}
.dsh-am-btn-danger:hover:not(:disabled) { background: #a93226; }
.dsh-am-btn-ghost {
	border-color: transparent;
	background: transparent;
	color: var(--dsw-alias-label-secondary, #5b6270);
}
.dsh-am-btn-ghost:hover:not(:disabled) {
	background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.12));
	color: var(--dsw-alias-label-primary, #1f2430);
}

/* Bulk selection bar -------------------------------------------------- */
.dsh-am-bulk {
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 7px 10px;
	border-top: 1px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.14));
	background: linear-gradient(90deg, rgba(91, 141, 239, 0.13), rgba(124, 92, 214, 0.09));
	animation: dsh-am-rise 140ms ease-out;
}
@keyframes dsh-am-rise {
	from { opacity: 0; transform: translateY(5px); }
	to { opacity: 1; transform: none; }
}
.dsh-am-bulk-count {
	flex: none;
	font-size: 11.5px;
	font-weight: 600;
	color: var(--dsw-alias-label-secondary, #5b6270);
	font-variant-numeric: tabular-nums;
	white-space: nowrap;
}
.dsh-am-bulk-hint {
	flex: 1 1 auto;
	min-width: 0;
	font-size: 11.5px;
	color: var(--dsw-alias-label-tertiary, #7b8290);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.dsh-am-bulk-actions {
	display: flex;
	align-items: center;
	gap: 4px;
	flex: none;
}

/* Empty state --------------------------------------------------------- */
.dsh-am-empty {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 4px;
	height: 100%;
	min-height: 168px;
	padding: 26px 26px 30px;
	text-align: center;
}
.dsh-am-empty-icon {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 40px;
	height: 40px;
	margin-bottom: 4px;
	border-radius: 12px;
	background: linear-gradient(150deg, rgba(91, 141, 239, 0.16), rgba(124, 92, 214, 0.1));
	color: var(--dsw-alias-brand-primary, #5b8def);
}
.dsh-am-empty-title { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-secondary, #5b6270); }
.dsh-am-empty-hint { max-width: 240px; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-tertiary, #7b8290); }

/* Footer + toast ------------------------------------------------------ */
.dsh-am-foot {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 6px 12px 7px;
	border-top: 1px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.14));
	font-size: 11px;
	color: var(--dsw-alias-label-tertiary, #7b8290);
}
.dsh-am-foot-filtered { margin-left: auto; font-variant-numeric: tabular-nums; }
.dsh-am-foot > .dsh-am-btn { flex: 0 0 auto; margin-left: 8px; }
.dsh-am-foot-restore {
	border-color: rgba(47, 158, 110, 0.32);
	background: rgba(47, 158, 110, 0.1);
	color: #2f9e6e;
}
.dsh-am-foot-restore:hover:not(:disabled) { background: rgba(47, 158, 110, 0.19); }

/* "Delete all" lives beside "Restore all", never beside the ✕ ---------- */
.dsh-am-foot-delete {
	border-color: rgba(209, 91, 86, 0.32);
	background: rgba(209, 91, 86, 0.1);
	color: #cf5751;
}
.dsh-am-foot-delete:hover:not(:disabled) { background: rgba(209, 91, 86, 0.19); }
.dsh-am-foot-confirm {
	display: flex;
	align-items: center;
	gap: 6px;
	flex: 1 1 auto;
	min-width: 0;
	animation: dsh-am-confirm-in 120ms ease-out;
}
.dsh-am-foot-confirm .dsh-am-confirm-text { flex: 1 1 auto; font-size: 11px; }
.dsh-am-foot-spinner { display: inline-flex; align-items: center; gap: 6px; }
.dsh-am-toast {
	position: absolute;
	left: 10px;
	right: 10px;
	bottom: 40px;
	padding: 8px 11px;
	border-radius: var(--dsw-radius-md, 8px);
	background: var(--dsw-alias-toast-bg, rgba(28, 32, 40, 0.94));
	color: #fff;
	font-size: 12px;
	line-height: 1.45;
	box-shadow: var(--dsw-shadow-lv3, 0 10px 26px rgba(0, 0, 0, 0.24));
	animation: dsh-am-rise 140ms ease-out;
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

/* Resize handles ------------------------------------------------------ */
.dsh-am-rz { position: absolute; touch-action: none; z-index: 2; }
.dsh-am-rz-n { top: -3px; left: 10px; right: 10px; height: 6px; cursor: ns-resize; }
.dsh-am-rz-s { bottom: -3px; left: 10px; right: 10px; height: 6px; cursor: ns-resize; }
.dsh-am-rz-e { right: -3px; top: 10px; bottom: 10px; width: 6px; cursor: ew-resize; }
.dsh-am-rz-w { left: -3px; top: 10px; bottom: 10px; width: 6px; cursor: ew-resize; }
.dsh-am-rz-nw { left: -3px; top: -3px; width: 12px; height: 12px; cursor: nwse-resize; }
.dsh-am-rz-ne { right: -3px; top: -3px; width: 12px; height: 12px; cursor: nesw-resize; }
.dsh-am-rz-sw { left: -3px; bottom: -3px; width: 12px; height: 12px; cursor: nesw-resize; }
.dsh-am-rz-se { right: -3px; bottom: -3px; width: 12px; height: 12px; cursor: nwse-resize; }`;

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
			const [confirming, setConfirming] = react.useState(null);
			const [selected, setSelected] = react.useState(null);
			const [bulkConfirm, setBulkConfirm] = react.useState(false);
			const [groupConfirm, setGroupConfirm] = react.useState(null);
			const [collapsed, setCollapsed] = react.useState(null);
			const [footerConfirm, setFooterConfirm] = react.useState(false);
			/*
			 * Compact by default: the entry only stretches when the user asks for
			 * it, and the choice survives a reload.
			 */
			const [triggerStyle, setTriggerStyle] = react.useState(storedTriggerStyle);
			const dragRef = react.useRef(null);
			const queryRef = react.useRef(null);
			const toastSeq = react.useRef(0);
			const panelRef = react.useRef(null);
			const triggerRef = react.useRef(null);

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

			/*
			 * Selection state.
			 *
			 * `selected` is a plain id map (cheap to copy, no Set polyfill needed).
			 * Every render filters it through the live archive set, so an id that
			 * was restored or deleted elsewhere silently drops out instead of
			 * letting a bulk action hit a stale row.
			 */
			const archivedSet = new Set(archivedIds.map((id) => String(id)));
			const selectedIds = selected ? Object.keys(selected).filter((id) => selected[id] && archivedSet.has(id)) : [];
			const selectedCount = selectedIds.length;
			const visibleIds = [];
			for (const group of visibleGroups) {
				for (const row of group.rows) visibleIds.push(row.id);
			}
			const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.indexOf(id) !== -1);

			/** Close everything transient, so reopening the panel starts clean. */
			const closePanel = () => {
				setOpen(false);
				setConfirming(null);
				setBulkConfirm(false);
				setGroupConfirm(null);
				setFooterConfirm(false);
				setSelected(null);
			};

			/**
			 * Fold or unfold one workspace group.
			 *
			 * Folding is purely visual: the rows stay in the archive, stay in the
			 * selection and stay part of "restore all" / "delete all", so collapsing
			 * a group can never silently change what a bulk action touches.
			 */
			const toggleGroup = (key) => {
				setCollapsed((current) => {
					const next = Object.assign({}, current || {});
					if (next[key]) delete next[key];
					else next[key] = true;
					return Object.keys(next).length ? next : null;
				});
				setGroupConfirm(null);
			};

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
						closePanel();
					}
				};
				window.addEventListener("keydown", onKeyDown, true);
				return () => window.removeEventListener("keydown", onKeyDown, true);
			}, [open]);

			/*
			 * Click-away dismissal: any pointer press outside the panel (and outside
			 * the sidebar trigger) folds the panel, so the archive UI never lingers
			 * over the conversation the user just switched to. Capture phase runs
			 * before the click handler of whatever was pressed, which keeps the
			 * very first outside press from also activating a control behind it.
			 */
			react.useEffect(() => {
				if (!open) return undefined;
				const onPointerDown = (event) => {
					const target = event && event.target;
					const panel = panelRef.current;
					if (panel && typeof panel.contains === "function" && target && panel.contains(target)) return;
					if (target && typeof target.closest === "function" && target.closest("[data-dsh-am]")) return;
					closePanel();
				};
				if (typeof document === "undefined" || !document || typeof document.addEventListener !== "function") return undefined;
				document.addEventListener("pointerdown", onPointerDown, true);
				return () => document.removeEventListener("pointerdown", onPointerDown, true);
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

			/** Tick or untick one row. */
			const toggleSelect = (id) => {
				setSelected((current) => {
					const next = Object.assign({}, current || {});
					if (next[id]) delete next[id];
					else next[id] = true;
					return Object.keys(next).length ? next : null;
				});
				setBulkConfirm(false);
			};

			/** Tick every visible row, or clear the visible ones when already ticked. */
			const toggleSelectAll = () => {
				if (!visibleIds.length) return;
				setSelected((current) => {
					const next = Object.assign({}, current || {});
					if (visibleIds.every((id) => next[id])) visibleIds.forEach((id) => delete next[id]);
					else visibleIds.forEach((id) => { next[id] = true; });
					return Object.keys(next).length ? next : null;
				});
				setBulkConfirm(false);
			};

			/** Drop the whole selection. */
			const clearSelection = () => {
				setSelected(null);
				setBulkConfirm(false);
			};

			/**
			 * Restore a list of ids one by one, reporting progress in the footer and
			 * partial failures as a toast. Shared by "restore selected", the
			 * per-group action and "restore all", so all three behave the same.
			 * @returns true when the batch ran to completion (even with failures).
			 */
			const restoreIds = async (ids) => {
				if (!ids.length) return false;
				if (typeof props.restoreMany !== "function") {
					notify("error", t("toast.unavailable"));
					return false;
				}
				setProgress({ done: 0, total: ids.length });
				try {
					await props.restoreMany(ids, (done, totalCount) => setProgress({ done, total: totalCount }));
					notify("ok", t("toast.restoredMany", { count: ids.length }));
					return true;
				} catch (error) {
					const failures = error && Array.isArray(error.failures) ? error.failures : null;
					if (failures && failures.length) {
						const done = ids.length - failures.length;
						notify(
							failures.length === ids.length ? "error" : "ok",
							t("toast.partial", { done, failed: failures.length }) + " — " + reasonOf(failures[0].error),
						);
						return true;
					}
					notify("error", t("toast.restoreFailed", { reason: reasonOf(error) }));
					return false;
				} finally {
					setProgress(null);
				}
			};

			/**
			 * Delete a list of ids one by one, with the same progress reporting.
			 * @returns true when the batch ran to completion (even with failures).
			 */
			const deleteIds = async (ids) => {
				if (!ids.length) return false;
				if (typeof props.deleteMany !== "function") {
					notify("error", t("toast.deleteUnavailable"));
					return false;
				}
				setBulkConfirm(false);
				setProgress({ done: 0, total: ids.length });
				try {
					await props.deleteMany(ids, (done, totalCount) => setProgress({ done, total: totalCount }));
					notify("ok", t("toast.deletedMany", { count: ids.length }));
					return true;
				} catch (error) {
					const failures = error && Array.isArray(error.failures) ? error.failures : null;
					if (failures && failures.length) {
						const done = ids.length - failures.length;
						notify(
							failures.length === ids.length ? "error" : "ok",
							t("toast.deletedPartial", { done, failed: failures.length }) + " — " + reasonOf(failures[0].error),
						);
						return true;
					}
					notify("error", t("toast.deleteFailed", { reason: reasonOf(error) }));
					return false;
				} finally {
					setProgress(null);
				}
			};

			/** Restore every ticked conversation. */
			const restoreSelected = async () => {
				if (!selectedIds.length) return;
				if (await restoreIds(selectedIds.slice())) clearSelection();
			};

			/** Delete every ticked conversation, reporting partial failures. */
			const deleteSelected = async () => {
				if (!selectedIds.length) return;
				if (await deleteIds(selectedIds.slice())) clearSelection();
			};

			/** Ids of a group's rows that are not mid-flight. */
			const groupIds = (group) => group.rows.filter((row) => !busy(row.id)).map((row) => row.id);

			/** Restore a whole workspace group in one go. */
			const restoreGroup = async (group) => {
				await restoreIds(groupIds(group));
			};

			/** Delete a whole workspace group, after the inline confirmation. */
			const deleteGroup = async (group) => {
				setGroupConfirm(null);
				await deleteIds(groupIds(group));
			};

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
				setFooterConfirm(false);
				await restoreIds(visibleIds.slice());
			};

			/**
			 * Delete everything the panel is currently listing (search included),
			 * after the footer's own inline confirmation.
			 */
			const deleteVisible = async () => {
				setFooterConfirm(false);
				if (typeof props.deleteMany !== "function") {
					notify("error", t("toast.deleteUnavailable"));
					return;
				}
				await deleteIds(visibleIds.slice());
			};

			const revealRow = async (row) => {
				if (typeof props.revealPath !== "function") return;
				try {
					await props.revealPath(row.cwd);
				} catch (error) {
					notify("error", t("toast.revealFailed", { reason: reasonOf(error) }));
				}
			};

			const deleteRow = async (row) => {
				setConfirming(null);
				if (typeof props.deleteSession !== "function") {
					notify("error", t("toast.deleteUnavailable"));
					return;
				}
				setPending((current) => Object.assign({}, current || {}, { [row.id]: true }));
				try {
					await props.deleteSession(row.id);
					notify("ok", t("toast.deleted", { title: ellipsis(row.title) }));
					setSelected((current) => {
						if (!current || !current[row.id]) return current;
						const next = Object.assign({}, current);
						delete next[row.id];
						return Object.keys(next).length ? next : null;
					});
				} catch (error) {
					const code = error && error.code ? String(error.code) : "";
					notify(
						"error",
						code === "session-active"
							? t("toast.deleteActive")
							: code === "unavailable"
								? t("toast.deleteUnavailable")
								: t("toast.deleteFailed", { reason: reasonOf(error) }),
					);
				} finally {
					setPending((current) => {
						const next = Object.assign({}, current || {});
						delete next[row.id];
						return next;
					});
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
					closePanel();
					return;
				}
				if (!geometry) setGeometry(clampGeometry(initialGeometry()));
				setOpen(true);
				setSelected(null);
				setConfirming(null);
			};

			const toggleTriggerStyle = () => {
				const next = triggerStyle === "wide" ? "compact" : "wide";
				setTriggerStyle(next);
				rememberTriggerStyle(next);
			};

			const trigger = h(
				"button",
				{
					ref: triggerRef,
					type: "button",
					className: "dsh-am-trigger",
					title: t("trigger.title"),
					"aria-label": t("trigger.title"),
					"aria-haspopup": "dialog",
					"aria-expanded": open ? "true" : "false",
					"data-dsh-am": "trigger",
					"data-style": triggerStyle,
					"data-wide": props.wide === false ? "false" : "true",
					onClick: toggle,
				},
				h("span", { className: "dsh-am-trigger-icon" }, h(Icon, { name: "archive" })),
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
						title: t("action.selectAll"),
						"aria-label": t("action.selectAll"),
						"aria-pressed": allVisibleSelected ? "true" : "false",
						disabled: shown === 0 || progress !== null,
						onClick: toggleSelectAll,
					},
					h(Icon, { name: "select" }),
				),
				/*
				 * Entry width is a taste, not a rule: the compact chip stays the
				 * default, and this swaps it for the full-width row.
				 */
				h(
					"button",
					{
						type: "button",
						className: "dsh-am-icon-btn",
						title: t(triggerStyle === "wide" ? "action.triggerCompact" : "action.triggerWide"),
						"aria-label": t(triggerStyle === "wide" ? "action.triggerCompact" : "action.triggerWide"),
						"aria-pressed": triggerStyle === "wide" ? "true" : "false",
						onClick: toggleTriggerStyle,
					},
					h(Icon, { name: "stretch" }),
				),
				/*
				 * "Restore all" deliberately does NOT live here: one gap away from the
				 * close button it was too easy to hit by accident. It moved down into
				 * the footer, far from the ✕, where it also carries a label.
				 */
				h(
					"button",
					{
						type: "button",
						className: "dsh-am-icon-btn",
						title: t("panel.close"),
						"aria-label": t("panel.close"),
						onClick: closePanel,
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
					h("span", { className: "dsh-am-empty-icon" }, h(Icon, { name: "archive", size: 20 })),
					h("div", { className: "dsh-am-empty-title" }, t("empty.title")),
					h("div", { className: "dsh-am-empty-hint" }, t("empty.hint")),
				);
			} else if (shown === 0) {
				body = h(
					"div",
					{ className: "dsh-am-empty" },
					h("span", { className: "dsh-am-empty-icon" }, h(Icon, { name: "search", size: 20 })),
					h("div", { className: "dsh-am-empty-title" }, t("empty.noMatch")),
					h("div", { className: "dsh-am-empty-hint" }, t("search.placeholder")),
				);
			} else {
				body = visibleGroups.map((group) => {
					const confirmingGroup = groupConfirm === group.key;
					const isCollapsed = Boolean(collapsed && collapsed[group.key]);
					return h(
						"section",
						{
							className: "dsh-am-group",
							key: group.key,
							style: accentStyle(group.key),
							"data-collapsed": isCollapsed ? "true" : undefined,
						},
						h(
							"div",
							{ className: "dsh-am-group-head" },
							confirmingGroup
								? h(
										"div",
										{ className: "dsh-am-group-confirm" },
										h(Icon, { name: "trash", size: 12 }),
										h(
											"span",
											{ className: "dsh-am-confirm-text" },
											t("group.confirm", { count: group.rows.length }),
										),
										h(
											"button",
											{
												type: "button",
												className: "dsh-am-btn dsh-am-btn-danger",
												onClick: () => deleteGroup(group),
											},
											t("delete.confirmYes"),
										),
										h(
											"button",
											{
												type: "button",
												className: "dsh-am-btn dsh-am-btn-ghost",
												onClick: () => setGroupConfirm(null),
											},
											t("delete.confirmNo"),
										),
									)
								: h(
										react.Fragment,
										null,
										/*
										 * The heading is the fold toggle: the whole caption is one
										 * target, so collapsing never competes with the two group
										 * actions sitting next to it.
										 */
										h(
											"button",
											{
												type: "button",
												className: "dsh-am-group-toggle",
												title: isCollapsed ? t("group.expand") : t("group.collapse"),
												"aria-expanded": isCollapsed ? "false" : "true",
												onClick: () => toggleGroup(group.key),
											},
											h("span", { className: "dsh-am-group-chevron" }, h(Icon, { name: "chevron", size: 11 })),
											h("span", { className: "dsh-am-group-accent" }),
											h(
												"span",
												{ className: "dsh-am-group-title", title: group.path || group.title },
												group.title,
											),
											h("span", { className: "dsh-am-group-count" }, String(group.rows.length)),
										),
										/*
										 * Per-group actions, revealed on hover so the header stays
										 * quiet: restore (harmless) and delete (asks in place).
										 */
										h(
											"div",
											{ className: "dsh-am-group-actions" },
											h(
												"button",
												{
													type: "button",
													className: "dsh-am-icon-btn",
													"data-tone": "restore",
													title: t("group.restore", { count: group.rows.length }),
													"aria-label": t("group.restore", { count: group.rows.length }),
													disabled: progress !== null || typeof props.restoreMany !== "function",
													onClick: () => restoreGroup(group),
												},
												h(Icon, { name: "restore", size: 13 }),
											),
											h(
												"button",
												{
													type: "button",
													className: "dsh-am-icon-btn dsh-am-danger",
													title: t("group.delete", { count: group.rows.length }),
													"aria-label": t("group.delete", { count: group.rows.length }),
													disabled: progress !== null || typeof props.deleteMany !== "function",
													onClick: () => setGroupConfirm(group.key),
												},
												h(Icon, { name: "trash", size: 13 }),
											),
										),
									),
						),
						isCollapsed
							? h(
									"div",
									{ className: "dsh-am-group-collapsed" },
									t("group.collapsed", { count: group.rows.length }),
								)
							: null,
						isCollapsed ? null : group.rows.map((row) => {
							const isBusy = busy(row.id);
							const isConfirming = confirming === row.id;
							const isSelected = selectedIds.indexOf(row.id) !== -1;
							if (isConfirming) {
								/*
								 * The confirmation takes over the row instead of opening a
								 * strip underneath it: the panel height stays put, the eye
								 * does not have to travel, and there is no second target to
								 * hit. Same height as a normal row (44px).
								 */
								return h(
									"div",
									{
										className: "dsh-am-row",
										key: row.id,
										"data-confirm": "true",
									},
									h(
										"div",
										{ className: "dsh-am-confirm" },
										h("span", { className: "dsh-am-confirm-icon" }, h(Icon, { name: "trash", size: 14 })),
										h("span", { className: "dsh-am-confirm-text", title: row.title }, t("delete.confirmShort", { title: ellipsis(row.title, 40) })),
										h(
											"button",
											{
												type: "button",
												className: "dsh-am-btn dsh-am-btn-danger",
												onClick: () => deleteRow(row),
											},
											t("delete.confirmYes"),
										),
										h(
											"button",
											{
												type: "button",
												className: "dsh-am-btn dsh-am-btn-ghost",
												onClick: () => setConfirming(null),
											},
											t("delete.confirmNo"),
										),
									),
								);
							}
							return h(
								"div",
								{
									className: "dsh-am-row",
									key: row.id,
									"data-busy": isBusy ? "true" : undefined,
									"data-selected": isSelected ? "true" : undefined,
								},
								h(
									"button",
									{
										type: "button",
										className: "dsh-am-check",
										role: "checkbox",
										"aria-checked": isSelected ? "true" : "false",
										"aria-label": t("action.select"),
										disabled: isBusy || progress !== null,
										onClick: () => toggleSelect(row.id),
									},
									isSelected ? h(Icon, { name: "check", size: 11 }) : null,
								),
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
									h(
										"button",
										{
											type: "button",
											className: "dsh-am-icon-btn dsh-am-danger",
											title: typeof props.deleteSession === "function" ? t("action.delete") : t("toast.deleteUnavailable"),
											"aria-label": t("action.delete"),
											disabled: isBusy || progress !== null || typeof props.deleteSession !== "function",
											onClick: () => setConfirming(row.id),
										},
										h(Icon, { name: "trash", size: 14 }),
									),
								),
							);
						}),
				);
			});
			}

			/*
			 * Bulk bar. Appears between the list and the footer as soon as at least
			 * one row is ticked, so the actions sit right under the selection the
			 * user just made. Deleting asks once for the whole batch, in place.
			 */
			const bulkBar =
				selectedCount > 0
					? h(
							"div",
							{ className: "dsh-am-bulk" },
							bulkConfirm
								? h(
										react.Fragment,
										null,
										h("span", { className: "dsh-am-bulk-count" }, t("bulk.confirm", { count: selectedCount })),
										h("span", { className: "dsh-am-bulk-hint" }, t("delete.irreversible")),
										h(
											"div",
											{ className: "dsh-am-bulk-actions" },
											h(
												"button",
												{
													type: "button",
													className: "dsh-am-btn dsh-am-btn-danger",
													onClick: () => deleteSelected(),
												},
												t("delete.confirmYes"),
											),
											h(
												"button",
												{
													type: "button",
													className: "dsh-am-btn dsh-am-btn-ghost",
													onClick: () => setBulkConfirm(false),
												},
												t("delete.confirmNo"),
											),
										),
									)
								: h(
										react.Fragment,
										null,
										h("span", { className: "dsh-am-bulk-count" }, t("bulk.selected", { count: selectedCount })),
										h("span", { className: "dsh-am-bulk-hint" }, t("bulk.hint")),
										h(
											"div",
											{ className: "dsh-am-bulk-actions" },
											h(
												"button",
												{
													type: "button",
													className: "dsh-am-btn",
													"aria-label": t("bulk.restore"),
													disabled: progress !== null,
													onClick: () => restoreSelected(),
												},
												h(Icon, { name: "restore", size: 12 }),
												h("span", { className: "dsh-am-btn-label" }, t("bulk.restore")),
											),
											h(
												"button",
												{
													type: "button",
													className: "dsh-am-btn dsh-am-btn-danger",
													"aria-label": t("bulk.delete"),
													disabled: progress !== null || typeof props.deleteMany !== "function",
													onClick: () => setBulkConfirm(true),
												},
												h(Icon, { name: "trash", size: 12 }),
												h("span", { className: "dsh-am-btn-label" }, t("bulk.delete")),
											),
											h(
												"button",
												{
													type: "button",
													className: "dsh-am-icon-btn",
													title: t("action.clearSelection"),
													"aria-label": t("action.clearSelection"),
													onClick: clearSelection,
												},
												h(Icon, { name: "close", size: 12 }),
											),
										),
									),
						)
					: null;

			const footer = h(
				"div",
				{ className: "dsh-am-foot" },
				progress
					? h(
							"span",
							{ className: "dsh-am-foot-spinner" },
							h("span", { className: "dsh-am-spinner" }),
							h("span", null, t("progress.running", { done: progress.done, total: progress.total })),
						)
					: footerConfirm
						? h(
								"div",
								{ className: "dsh-am-foot-confirm" },
								h(Icon, { name: "trash", size: 12 }),
								h("span", { className: "dsh-am-confirm-text" }, t("deleteAll.confirm", { count: shown })),
							)
						: h("span", null, t("foot.hint", { total })),
				footerConfirm
					? null
					: h(
							"span",
							{ className: "dsh-am-foot-filtered" },
							progress || !needle ? null : t("foot.filtered", { shown, total }),
						),
				/*
				 * Both global actions live down here rather than beside ✕. One gap
				 * away from the close button they were too easy to hit by accident;
				 * at the bottom of the panel they are far from it, labelled, and the
				 * destructive one asks first.
				 */
				footerConfirm
					? h(
							react.Fragment,
							null,
							h(
								"button",
								{
									type: "button",
									className: "dsh-am-btn dsh-am-btn-danger",
									onClick: () => deleteVisible(),
								},
								t("delete.confirmYes"),
							),
							h(
								"button",
								{
									type: "button",
									className: "dsh-am-btn dsh-am-btn-ghost",
									onClick: () => setFooterConfirm(false),
								},
								t("delete.confirmNo"),
							),
						)
					: h(
							"button",
							{
								type: "button",
								className: "dsh-am-btn dsh-am-foot-restore",
								title: t("action.restoreAll"),
								"aria-label": t("action.restoreAll"),
								disabled: shown === 0 || progress !== null,
								onClick: restoreVisible,
							},
							h(Icon, { name: "checkAll", size: 12 }),
							h("span", { className: "dsh-am-btn-label" }, t("action.restoreAll")),
						),
				footerConfirm
					? null
					: h(
							"button",
							{
								type: "button",
								className: "dsh-am-btn dsh-am-foot-delete",
								title: t("action.deleteAll"),
								"aria-label": t("action.deleteAll"),
								disabled:
									shown === 0 || progress !== null || typeof props.deleteMany !== "function",
								onClick: () => setFooterConfirm(true),
							},
							h(Icon, { name: "trash", size: 12 }),
							h("span", { className: "dsh-am-btn-label" }, t("action.deleteAll")),
						),
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
						ref: panelRef,
						className: "dsh-am-panel",
						role: "dialog",
						"aria-label": t("panel.title"),
						"data-dsh-am": "panel",
						style: panelStyle,
					},
					header,
					toolbar,
					h("div", { className: "dsh-am-body" }, body),
					bulkBar,
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

			/**
			 * Delete one archived session through the Host Remote.
			 *
			 * The Host answers with a plain outcome rather than an error, so refusals
			 * are translated here into a rejected promise carrying the reason as
			 * `error.code`; the panel maps those codes to user-facing text.
			 *
			 * @param sessionId - the archived session to delete.
			 */
			const deleteSession = async (sessionId) => {
				const service = await deleteRemote(ctx);
				if (!service || typeof service.deleteSession !== "function") {
					const error = new Error("deleteSession() is unavailable");
					error.code = "unavailable";
					throw error;
				}
				const result = await service.deleteSession({ sessionId });
				if (result && result.ok === false) {
					const failure = result.error || {};
					const error = new Error(failure.message ? String(failure.message) : "deleteSession() failed");
					error.code = failure.code ? String(failure.code) : "failed";
					throw error;
				}
				const value = result && result.value !== undefined ? result.value : result;
				if (!value || value.deleted !== true) {
					const error = new Error(value && value.reason ? String(value.reason) : "not deleted");
					error.code = value && value.reason ? String(value.reason) : "not-deleted";
					throw error;
				}
				/*
				 * The Host already dropped the id from the archive set, and its
				 * registry change normally reaches this window through the workspace
				 * stream. Replaying the unarchive round-trip makes the local archive
				 * snapshot authoritative either way, so the row disappears even when
				 * the stream is lagging behind the click.
				 */
				const workspaces = ctx.workspaces;
				if (workspaces && typeof workspaces.unarchiveSession === "function") {
					try {
						await workspaces.unarchiveSession(sessionId);
					} catch (error) {
						/* a refused resync is repaired by the next workspace baseline */
					}
				}
				return value;
			};

			/** Delete a batch, reporting progress and collecting partial failures. */
			const deleteMany = async (sessionIds, onProgress) => {
				const ids = Array.isArray(sessionIds) ? sessionIds.slice() : [];
				const failures = [];
				let done = 0;
				for (const id of ids) {
					try {
						await deleteSession(id);
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
					const error = new Error("deleted " + (ids.length - failures.length) + "/" + ids.length + " sessions");
					error.failures = failures;
					throw error;
				}
				return done;
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
							deleteSession,
							deleteMany,
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
