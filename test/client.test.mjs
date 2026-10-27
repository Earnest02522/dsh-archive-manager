/**
 * Headless checks for the browser half.
 *
 * There is no bundler and no test framework in this package, so this file
 * supplies the two things `src/client.js` needs at load time — a
 * `window.__ModuleLoader__` and a very small React-compatible runtime — and
 * then drives the registered panel component directly:
 *
 *   node test/client.test.mjs
 *
 * It covers the load contract (factory/id, exported appy/inject), the slot
 * registration shape, grouping of archived sessions by workspace, the search
 * filter, single restore, bulk restore with a partial failure, the reveal
 * action, degraded mode (no unarchive API) and the drag/resize geometry.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT = resolve(HERE, "..", "src", "client.js");

/* -------------------------------------------------------------------------- *
 * Minimal React runtime                                                       *
 * -------------------------------------------------------------------------- */

const Fragment = Symbol.for("react.fragment");

let activeHooks = null;

function createElement(type, props, ...children) {
	const next = Object.assign({}, props || {});
	const flat = [];
	const push = (value) => {
		if (value === null || value === undefined || value === false || value === true) return;
		if (Array.isArray(value)) {
			value.forEach(push);
			return;
		}
		flat.push(value);
	};
	children.forEach(push);
	next.children = flat;
	return { type, props: next };
}

function useSlot(kind) {
	if (!activeHooks) throw new Error("hook used outside of a component: " + kind);
	const index = activeHooks.index++;
	const existing = activeHooks.hooks[index];
	if (existing) {
		if (existing.kind !== kind) throw new Error("hook order changed at index " + index);
		return existing;
	}
	const slot = { kind };
	activeHooks.hooks[index] = slot;
	return slot;
}

function useState(initial) {
	const slot = useSlot("state");
	if (!("value" in slot)) slot.value = typeof initial === "function" ? initial() : initial;
	const owner = activeHooks;
	const setState = (next) => {
		const value = typeof next === "function" ? next(slot.value) : next;
		if (Object.is(value, slot.value)) return;
		slot.value = value;
		owner.rerender();
	};
	return [slot.value, setState];
}

function useEffect(effect, deps) {
	const slot = useSlot("effect");
	slot.effect = effect;
	slot.deps = deps;
}

function useRef(initial) {
	const slot = useSlot("ref");
	if (!("current" in slot)) slot.current = initial;
	return slot;
}

function useCallback(callback, deps) {
	const slot = useSlot("callback");
	const same = slot.deps && deps && slot.deps.length === deps.length && slot.deps.every((value, index) => Object.is(value, deps[index]));
	if (!same) {
		slot.callback = callback;
		slot.deps = deps;
	}
	return slot.callback;
}

function useMemo(factory, deps) {
	const slot = useSlot("memo");
	const same = slot.deps && deps && slot.deps.length === deps.length && slot.deps.every((value, index) => Object.is(value, deps[index]));
	if (!same) {
		slot.value = factory();
		slot.deps = deps;
	}
	return slot.value;
}

const react = { Fragment, createElement, useState, useEffect, useRef, useCallback, useMemo };

/* -------------------------------------------------------------------------- *
 * Renderer                                                                    *
 * -------------------------------------------------------------------------- */

function sameDeps(left, right) {
	if (!left || !right) return false;
	if (left.length !== right.length) return false;
	return left.every((value, index) => Object.is(value, right[index]));
}

/**
 * Mount a function component into a plain tree and return helpers to inspect
 * and interact with it.
 *
 * @param Component - the component function.
 * @param getProps - called on every render to build props.
 */
function mount(Component, getProps) {
	const hooks = [];
	let tree = null;
	let disposed = false;

	const rerender = () => {
		if (disposed) return;
		render();
	};

	function runEffects() {
		for (const slot of hooks) {
			if (!slot || slot.kind !== "effect") continue;
			if (slot.installed && sameDeps(slot.deps, slot.lastDeps)) continue;
			if (typeof slot.cleanup === "function") {
				slot.cleanup();
				slot.cleanup = undefined;
			}
			slot.lastDeps = slot.deps;
			slot.installed = true;
			const result = slot.effect();
			slot.cleanup = typeof result === "function" ? result : undefined;
		}
	}

	function render() {
		activeHooks = { hooks, index: 0, rerender };
		try {
			const element = Component(getProps());
			tree = resolve(element);
		} finally {
			activeHooks = null;
		}
		runEffects();
	}

	function resolve(node) {
		if (node === null || node === undefined || typeof node === "boolean") return null;
		if (typeof node === "string" || typeof node === "number") return { text: String(node) };
		if (Array.isArray(node)) {
			return { type: "@array", props: {}, children: node.map(resolve).filter(Boolean) };
		}
		const type = node.type;
		if (typeof type === "function") {
			if (type === Fragment) return { type: "@fragment", props: node.props, children: node.props.children.map(resolve).filter(Boolean) };
			const previous = activeHooks;
			activeHooks = null;
			let produced;
			try {
				produced = type(node.props);
			} finally {
				activeHooks = previous;
			}
			return resolve(produced);
		}
		if (type === Fragment) {
			return { type: "@fragment", props: node.props, children: node.props.children.map(resolve).filter(Boolean) };
		}
		return {
			type,
			props: node.props,
			children: node.props.children.map(resolve).filter(Boolean),
		};
	}

	render();

	return {
		get tree() {
			return tree;
		},
		rerender,
		dispose() {
			disposed = true;
			for (const slot of hooks) {
				if (slot && slot.kind === "effect" && typeof slot.cleanup === "function") slot.cleanup();
			}
		},
	};
}

/** Depth-first collection of rendered nodes matching `predicate`. */
function findAll(node, predicate, out) {
	const found = out || [];
	if (!node) return found;
	if (node.text !== undefined) return found;
	if (predicate(node)) found.push(node);
	for (const child of node.children || []) findAll(child, predicate, found);
	return found;
}

/** Concatenated text content of a rendered node. */
function textOf(node) {
	if (!node) return "";
	if (node.text !== undefined) return node.text;
	return (node.children || []).map(textOf).join(" ");
}

function byClass(name) {
	return (node) => typeof node.props.className === "string" && node.props.className.split(/\s+/).indexOf(name) !== -1;
}

function byLabel(label) {
	return (node) => node.props["aria-label"] === label;
}

/* -------------------------------------------------------------------------- *
 * Loader / DOM stubs                                                          *
 * -------------------------------------------------------------------------- */

const styleTags = [];
const documentListeners = new Map();
const documentStub = {
	documentElement: { lang: "zh-CN" },
	head: {
		appendChild(child) {
			styleTags.push(child);
			return child;
		},
	},
	createElement() {
		return {
			attributes: {},
			textContent: "",
			setAttribute(name, value) {
				this.attributes[name] = value;
			},
		};
	},
	addEventListener(name, handler) {
		const list = documentListeners.get(name) || [];
		list.push(handler);
		documentListeners.set(name, list);
	},
	removeEventListener(name, handler) {
		const list = documentListeners.get(name) || [];
		documentListeners.set(
			name,
			list.filter((entry) => entry !== handler),
		);
	},
	querySelector(selector) {
		const match = /data-plugin-css="([^"]+)"/.exec(selector);
		if (!match) return null;
		return styleTags.find((tag) => tag.attributes["data-plugin-css"] === match[1]) || null;
	},
};

/** Deliver a pointer press the way a real outside click would. */
function pressOutside(target) {
	const handlers = (documentListeners.get("pointerdown") || []).slice();
	for (const handler of handlers) handler({ target });
	return handlers.length;
}

const listeners = new Map();
const windowStub = {
	innerWidth: 1440,
	innerHeight: 900,
	setTimeout: (fn, ms) => setTimeout(fn, ms),
	clearTimeout: (handle) => clearTimeout(handle),
	addEventListener(name, handler) {
		const list = listeners.get(name) || [];
		list.push(handler);
		listeners.set(name, list);
	},
	removeEventListener(name, handler) {
		const list = listeners.get(name) || [];
		listeners.set(
			name,
			list.filter((entry) => entry !== handler),
		);
	},
};

let captured = null;
windowStub.__ModuleLoader__ = {
	load(spec) {
		captured = spec;
	},
};

globalThis.window = windowStub;
globalThis.document = documentStub;
Object.defineProperty(globalThis, "navigator", {
	value: { language: "zh-CN" },
	configurable: true,
	writable: true,
});

/* -------------------------------------------------------------------------- *
 * Tiny assertion helpers                                                      *
 * -------------------------------------------------------------------------- */

let passed = 0;
const failures = [];

function check(name, condition, detail) {
	if (condition) {
		passed += 1;
		console.log("  ok   " + name);
		return;
	}
	failures.push(name + (detail === undefined ? "" : " — " + detail));
	console.log("  FAIL " + name + (detail === undefined ? "" : " — " + detail));
}

function equal(name, actual, expected) {
	check(name, Object.is(actual, expected), "expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual));
}

/* -------------------------------------------------------------------------- *
 * Fixtures                                                                    *
 * -------------------------------------------------------------------------- */

function archiveSnapshot() {
	return {
		items: [
			{ workspaceId: "ws-a", title: "Alpha project", path: "D:\\work\\alpha", sessionIds: ["s-alpha-1", "s-alpha-2", "s-live"], createdAt: "", updatedAt: "" },
			{ workspaceId: "ws-b", title: "Beta project", path: "D:\\work\\beta", sessionIds: ["s-beta-1"], createdAt: "", updatedAt: "" },
		],
		archivedSessionIds: ["s-alpha-1", "s-beta-1", "s-orphan"],
		pinnedSessionIds: [],
		phase: "ready",
	};
}

function sessionSnapshot() {
	return {
		ids: ["s-alpha-1", "s-alpha-2", "s-beta-1", "s-live"],
		byId: {
			"s-alpha-1": { id: "s-alpha-1", displayTitle: "Fix the parser", cwd: "D:\\work\\alpha", updatedAt: Date.now() - 5 * 60000 },
			"s-alpha-2": { id: "s-alpha-2", displayTitle: "Live session", cwd: "D:\\work\\alpha", updatedAt: Date.now() - 3 * 3600000 },
			"s-beta-1": { id: "s-beta-1", displayTitle: "Bulk ingest", cwd: "D:\\work\\beta", updatedAt: Date.now() - 2 * 86400000 },
			"s-live": { id: "s-live", displayTitle: "Visible", cwd: "D:\\work\\alpha", updatedAt: Date.now() },
		},
		phase: "ready",
	};
}

function makeStore(initial) {
	const listeners = new Set();
	let current = initial;
	return {
		getSnapshot: () => current,
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		set(next) {
			current = next;
			for (const listener of Array.from(listeners)) listener();
		},
	};
}

/**
 * Turn a snapshot store into the selector hook the slot renderer hands to a
 * component for each entry of the injected `hooks` map.
 */
function makeStoreHook(store) {
	return (selector) => {
		const [, force] = useState(0);
		const value = selector(store.getSnapshot());
		useEffect(() => store.subscribe(() => force((count) => count + 1)), [store]);
		return value;
	};
}

/**
 * Props for a registered slot component: the plugin's own injected props, with
 * the `hooks` store map promoted to selector hooks the way the renderer does.
 */
function propsFor(registration, extra) {
	const injectedProps = registration.options.inject();
	const hooks = injectedProps.hooks || {};
	const props = Object.assign({}, injectedProps, extra || {});
	if (hooks.useWorkspaces) props.useWorkspaces = makeStoreHook(hooks.useWorkspaces);
	if (hooks.useSessions) props.useSessions = makeStoreHook(hooks.useSessions);
	return props;
}

/**
 * Fake client context: what `apply(ctx)` sees in the real app, trimmed to the
 * three services the plugin injects plus the two optional lookups.
 */
function makeContext(options) {
	const config = options || {};
	const calls = { unarchive: [], revealed: [], opened: [], deleted: [], mounts: 0, contribution: null };
	const workspacesStore = makeStore(config.workspaces || archiveSnapshot());
	const sessionsStore = makeStore(config.sessions || sessionSnapshot());
	const services = {
		workspaces: {
			list: workspacesStore,
			async unarchiveSession(sessionId) {
				calls.unarchive.push(sessionId);
				const state = workspacesStore.getSnapshot();
				workspacesStore.set(
					Object.assign({}, state, { archivedSessionIds: state.archivedSessionIds.filter((id) => id !== sessionId) }),
				);
			},
		},
		sessions: { list: sessionsStore },
	};
	if (config.uiWorkspace !== false) {
		services.uiWorkspace = {
			openSession(sessionId) {
				calls.opened.push(sessionId);
			},
		};
	}
	if (config.remote !== false) {
		services["remote.session"] = {
			async openWorkspacePath(request) {
				calls.revealed.push(request);
				return { ok: true };
			},
		};
	}
	if (config.delete !== "missing") {
		services.remote = {
			async $mount(contribution) {
				calls.mounts += 1;
				calls.contribution = contribution;
				if (config.delete === "mount-fails") throw new Error("mount rejected");
				const descriptor = contribution.descriptors[0];
				services["remote." + descriptor.namespace] = {
					async [descriptor.method](request) {
						calls.deleted.push(request.sessionId);
						if (config.delete === "active") {
							return {
								ok: true,
								value: { sessionId: request.sessionId, deleted: false, reason: "session-active" },
							};
						}
						const state = workspacesStore.getSnapshot();
						workspacesStore.set(
							Object.assign({}, state, {
								archivedSessionIds: state.archivedSessionIds.filter((id) => id !== request.sessionId),
							}),
						);
						return {
							ok: true,
							value: {
								sessionId: request.sessionId,
								deleted: true,
								existed: true,
								path: "C:\\sessions\\" + request.sessionId + ".jsonl",
								pruned: true,
							},
						};
					},
				};
			},
		};
	}
	if (config.unavailable) delete services.workspaces.unarchiveSession;

	const registrations = [];
	let injected = null;
	const ctx = {
		services,
		registrations,
		workspaces: services.workspaces,
		sessions: services.sessions,
		effect(factory) {
			const dispose = factory();
			return typeof dispose === "function" ? dispose : () => {};
		},
		get(name) {
			return services[name];
		},
		slots: {
			inject(name, factory) {
				injected = { name, result: factory() };
				return () => {};
			},
			register(options, Component) {
				registrations.push({ options, Component });
				return () => {};
			},
		},
	};
	return { ctx, calls, registrations, injected: () => injected, workspacesStore, sessionsStore };
}

/* -------------------------------------------------------------------------- *
 * Tests                                                                       *
 * -------------------------------------------------------------------------- */

async function main() {
	console.log("\n# load contract");
	await import(pathToFileURL(CLIENT).href);
	check("module loader received a spec", captured !== null);
	equal("bundle id", captured && captured.id, "dsh-archive-manager");
	equal("factory is a function", typeof (captured && captured.factory), "function");

	const exports = captured.factory((specifier) => {
		if (specifier === "react") return react;
		throw new Error("unexpected require: " + specifier);
	});

	check("exports apply", typeof exports.apply === "function");
	check("exports inject", Array.isArray(exports.inject));
	equal("inject keys", exports.inject.join(","), "slots,workspaces,sessions");

	console.log("\n# slot registration");
	const harness = makeContext();
	exports.apply(harness.ctx);
	check("style sheet installed", styleTags.length === 1, "styles: " + styleTags.length);
	check("style sheet is keyed", styleTags[0] && styleTags[0].attributes["data-plugin-css"] === "dsh-archive-manager/client.css");
	check("style sheet has content", styleTags[0] && styleTags[0].textContent.indexOf(".dsh-am-panel") !== -1);
	const repeat = makeContext();
	exports.apply(repeat.ctx);
	check("style sheet is injected only once", styleTags.length === 1);
	const injected = harness.injected();
	check("registered into the sidebar footer", injected && injected.name === "sidebar.footer.action");
	equal("one registration", harness.registrations.length, 1);
	const registration = harness.registrations[0];
	equal("registration name", registration.options.name, "sidebar.footer.action");
	equal("registration id", registration.options.id, "dsh-archive-manager");
	equal("registration order", registration.options.order, 120);
	equal("locale namespace", registration.options.locale, "dsh-archive-manager");
	check("component is a function", typeof registration.Component === "function");

	const injectedProps = registration.options.inject();
	check("hooks exposed", Boolean(injectedProps.hooks && injectedProps.hooks.useWorkspaces && injectedProps.hooks.useSessions));
	check(
		"callbacks exposed",
		["restoreOne", "restoreMany", "openSession", "revealPath", "deleteSession", "deleteMany"].every(
			(key) => typeof injectedProps[key] === "function",
		),
	);
	check("translator exposed", typeof injectedProps.t === "function");
	equal("translator falls back to Chinese", injectedProps.t("trigger.label"), "归档");

	console.log("\n# panel rendering");
	const view = mount(registration.Component, () => propsFor(registration, { wide: true }));
	const trigger = findAll(view.tree, byClass("dsh-am-trigger"))[0];
	check("trigger rendered", Boolean(trigger));
	equal("badge shows the archive count", textOf(findAll(view.tree, byClass("dsh-am-badge"))[0]), "3");
	equal("panel hidden initially", findAll(view.tree, byClass("dsh-am-panel")).length, 0);

	trigger.props.onClick();
	const panel = findAll(view.tree, byClass("dsh-am-panel"))[0];
	check("panel opened", Boolean(panel));
	equal("groups", findAll(view.tree, byClass("dsh-am-group")).length, 3);
	equal("rows", findAll(view.tree, byClass("dsh-am-row")).length, 3);
	check(
		"grouped by workspace + ungrouped bucket",
		findAll(view.tree, byClass("dsh-am-group-title"))
			.map(textOf)
			.join("|") === "Alpha project|Beta project|未分组",
		findAll(view.tree, byClass("dsh-am-group-title")).map(textOf).join("|"),
	);
	check(
		"row meta shows title and folder",
		textOf(findAll(view.tree, byClass("dsh-am-row"))[0]).indexOf("Fix the parser") !== -1 &&
			textOf(findAll(view.tree, byClass("dsh-am-row"))[0]).indexOf("alpha") !== -1,
	);

	console.log("\n# search");
	const input = findAll(view.tree, (node) => node.props && node.props.type === "search")[0];
	check("search input rendered", Boolean(input));
	input.props.onChange({ target: { value: "beta" } });
	equal("filtered rows", findAll(view.tree, byClass("dsh-am-row")).length, 1);
	equal("filtered groups", findAll(view.tree, byClass("dsh-am-group")).length, 1);
	input.props.onChange({ target: { value: "no-such-session" } });
	equal("empty filter state", findAll(view.tree, byClass("dsh-am-row")).length, 0);
	check("no-match message", textOf(view.tree).indexOf("没有匹配的归档会话") !== -1);
	input.props.onChange({ target: { value: "" } });
	equal("rows restored after clearing", findAll(view.tree, byClass("dsh-am-row")).length, 3);

	console.log("\n# single restore");
	const restoreLabel = injectedProps.t("action.restore");
	const firstRow = findAll(view.tree, byClass("dsh-am-row"))[0];
	const restoreButton = findAll(firstRow, byLabel(restoreLabel))[0];
	check("restore button rendered", Boolean(restoreButton));
	await restoreButton.props.onClick();
	equal("unarchiveSession called", harness.calls.unarchive.join(","), "s-alpha-1");
	check("success toast", textOf(findAll(view.tree, byClass("dsh-am-toast"))[0]).indexOf("已恢复") !== -1, textOf(findAll(view.tree, byClass("dsh-am-toast"))[0]));
	equal("row removed from the list", findAll(view.tree, byClass("dsh-am-row")).length, 2);

	console.log("\n# restore and open");
	const openLabel = injectedProps.t("action.restoreOpen");
	const openButton = findAll(findAll(view.tree, byClass("dsh-am-row"))[0], byLabel(openLabel))[0];
	check("restore-and-open button rendered", Boolean(openButton));
	await openButton.props.onClick();
	check("session opened in the main view", harness.calls.opened.join(",") === "s-beta-1", harness.calls.opened.join(","));
	equal("archive set drained", harness.workspacesStore.getSnapshot().archivedSessionIds.length, 1);

	console.log("\n# bulk restore");
	const restoreAllLabel = injectedProps.t("action.restoreAll");
	const restoreAll = findAll(view.tree, byLabel(restoreAllLabel))[0];
	check("restore-all button rendered", Boolean(restoreAll));
	await restoreAll.props.onClick();
	equal("remaining session restored", harness.calls.unarchive.join(","), "s-alpha-1,s-beta-1,s-orphan");
	check("bulk toast", textOf(findAll(view.tree, byClass("dsh-am-toast"))[0]).indexOf("已恢复") !== -1);
	equal("empty state", findAll(view.tree, byClass("dsh-am-row")).length, 0);
	check("empty message", textOf(view.tree).indexOf("没有归档的会话") !== -1);

	console.log("\n# reveal");
	const revealHarness = makeContext();
	exports.apply(revealHarness.ctx);
	const revealRegistration = revealHarness.registrations[0];
	const revealView = mount(revealRegistration.Component, () => propsFor(revealRegistration, { wide: true }));
	findAll(revealView.tree, byClass("dsh-am-trigger"))[0].props.onClick();
	const revealButton = findAll(revealView.tree, byLabel(revealRegistration.options.inject().t("action.reveal")))[0];
	check("reveal button rendered for a session with a cwd", Boolean(revealButton));
	await revealButton.props.onClick();
	equal("reveal request path", revealHarness.calls.revealed[0] && revealHarness.calls.revealed[0].path, "D:\\work\\alpha");
	equal("reveal request action", revealHarness.calls.revealed[0] && revealHarness.calls.revealed[0].action, "reveal");

	console.log("\n# degraded mode");
	const degraded = makeContext({ unavailable: true });
	exports.apply(degraded.ctx);
	const degradedRegistration = degraded.registrations[0];
	const degradedView = mount(degradedRegistration.Component, () => propsFor(degradedRegistration, { wide: true }));
	findAll(degradedView.tree, byClass("dsh-am-trigger"))[0].props.onClick();
	const degradedRestore = findAll(degradedView.tree, byLabel(degradedRegistration.options.inject().t("action.restore")))[0];
	await degradedRestore.props.onClick();
	check("degraded restore reports an error toast", textOf(findAll(degradedView.tree, byClass("dsh-am-toast"))[0]).indexOf("恢复失败") !== -1);

	console.log("\n# missing snapshots");
	const emptyHarness = makeContext({ workspaces: { items: [], archivedSessionIds: [] }, sessions: { ids: [], byId: {} } });
	exports.apply(emptyHarness.ctx);
	const emptyRegistration = emptyHarness.registrations[0];
	const emptyView = mount(emptyRegistration.Component, () => propsFor(emptyRegistration, { wide: false }));
	const emptyTrigger = findAll(emptyView.tree, byClass("dsh-am-trigger"))[0];
	check("trigger renders with an empty archive", Boolean(emptyTrigger));
	check("no badge without archived sessions", findAll(emptyView.tree, byClass("dsh-am-badge")).length === 0);
	check("label hidden when narrow", findAll(emptyView.tree, byClass("dsh-am-trigger-label")).length === 0);
	emptyTrigger.props.onClick();
	check("empty panel is stable", findAll(emptyView.tree, byClass("dsh-am-empty")).length === 1);

	console.log("\n# drag and resize");
	const dragView = mount(registration.Component, () => propsFor(registration, { wide: true }));
	findAll(dragView.tree, byClass("dsh-am-trigger"))[0].props.onClick();
	const before = findAll(dragView.tree, byClass("dsh-am-panel"))[0].props.style;
	const head = findAll(dragView.tree, byClass("dsh-am-head"))[0];
	const fakeTarget = { closest: () => null };
	head.props.onPointerDown({ button: 0, pointerId: 7, clientX: 200, clientY: 300, target: fakeTarget, preventDefault() {}, currentTarget: {} });
	head.props.onPointerMove({ pointerId: 7, clientX: 240, clientY: 340 });
	head.props.onPointerUp({ pointerId: 7, currentTarget: {} });
	const after = findAll(dragView.tree, byClass("dsh-am-panel"))[0].props.style;
	equal("moved by dx", parseInt(after.left, 10) - parseInt(before.left, 10), 40);
	equal("moved by dy", parseInt(after.top, 10) - parseInt(before.top, 10), 40);

	const resizeHandle = findAll(dragView.tree, byClass("dsh-am-rz-se"))[0];
	check("south-east resize handle rendered", Boolean(resizeHandle));
	const widthBefore = parseInt(findAll(dragView.tree, byClass("dsh-am-panel"))[0].props.style.width, 10);
	resizeHandle.props.onPointerDown({ button: 0, pointerId: 9, clientX: 0, clientY: 0, target: fakeTarget, preventDefault() {}, currentTarget: {} });
	resizeHandle.props.onPointerMove({ pointerId: 9, clientX: 60, clientY: 40 });
	resizeHandle.props.onPointerUp({ pointerId: 9, currentTarget: {} });
	const widthAfter = parseInt(findAll(dragView.tree, byClass("dsh-am-panel"))[0].props.style.width, 10);
	equal("resized by dx", widthAfter - widthBefore, 60);

	console.log("\n# escape closes");
	const escapeHandlers = listeners.get("keydown") || [];
	check("keydown listener installed while open", escapeHandlers.length > 0);
	escapeHandlers[escapeHandlers.length - 1]({ key: "Escape", preventDefault() {}, stopPropagation() {} });
	equal("panel closed", findAll(dragView.tree, byClass("dsh-am-panel")).length, 0);

	view.dispose();
	revealView.dispose();
	degradedView.dispose();
	emptyView.dispose();
	dragView.dispose();

	console.log("\n# delete archived conversation");
	const deleteHarness = makeContext();
	exports.apply(deleteHarness.ctx);
	const deleteRegistration = deleteHarness.registrations[0];
	const deleteProps = deleteRegistration.options.inject();
	const deleteView = mount(deleteRegistration.Component, () => propsFor(deleteRegistration, { wide: true }));
	findAll(deleteView.tree, byClass("dsh-am-trigger"))[0].props.onClick();
	check("no confirmation strip before asking", findAll(deleteView.tree, byClass("dsh-am-confirm")).length === 0);
	const deleteLabel = deleteProps.t("action.delete");
	const firstDeleteButton = findAll(findAll(deleteView.tree, byClass("dsh-am-row"))[0], byLabel(deleteLabel))[0];
	check("delete button rendered", Boolean(firstDeleteButton));
	firstDeleteButton.props.onClick();
	const strip = findAll(deleteView.tree, byClass("dsh-am-confirm"))[0];
	check("confirmation strip appears", Boolean(strip));
	check("confirmation names the conversation", textOf(strip).indexOf("Fix the parser") !== -1, textOf(strip));
	check("nothing deleted before confirming", deleteHarness.calls.deleted.length === 0);
	const cancelButton = findAll(strip, byClass("dsh-am-btn"))[1];
	check("cancel button rendered", Boolean(cancelButton));
	cancelButton.props.onClick();
	check("cancel closes the strip", findAll(deleteView.tree, byClass("dsh-am-confirm")).length === 0);
	check("cancel deletes nothing", deleteHarness.calls.deleted.length === 0);

	findAll(findAll(deleteView.tree, byClass("dsh-am-row"))[0], byLabel(deleteLabel))[0].props.onClick();
	const confirmStrip = findAll(deleteView.tree, byClass("dsh-am-confirm"))[0];
	const confirmButton = findAll(confirmStrip, byClass("dsh-am-btn-danger"))[0];
	check("confirm button rendered", Boolean(confirmButton));
	await confirmButton.props.onClick();
	equal("delete requested for the archived session", deleteHarness.calls.deleted.join(","), "s-alpha-1");
	check(
		"delete re-syncs the archived snapshot",
		deleteHarness.calls.unarchive.indexOf("s-alpha-1") !== -1,
		deleteHarness.calls.unarchive.join(","),
	);
	equal("row removed after delete", findAll(deleteView.tree, byClass("dsh-am-row")).length, 2);
	check(
		"delete toast",
		textOf(findAll(deleteView.tree, byClass("dsh-am-toast"))[0]).indexOf("已删除") !== -1,
		textOf(findAll(deleteView.tree, byClass("dsh-am-toast"))[0]),
	);
	equal("descriptor mounted once", deleteHarness.calls.mounts, 1);
	equal("descriptor package", deleteHarness.calls.contribution.package, "dsh-archive-manager");
	equal("descriptor namespace", deleteHarness.calls.contribution.descriptors[0].namespace, "archiveManager");
	equal("descriptor method", deleteHarness.calls.contribution.descriptors[0].method, "deleteSession");
	equal(
		"descriptor parameter wire",
		deleteHarness.calls.contribution.descriptors[0].parameters[0].wire,
		"request",
	);
	equal(
		"descriptor parameters are strict",
		deleteHarness.calls.contribution.descriptors[0].parameters[0].codec.mode,
		"strict",
	);

	findAll(findAll(deleteView.tree, byClass("dsh-am-row"))[0], byLabel(deleteLabel))[0].props.onClick();
	await findAll(findAll(deleteView.tree, byClass("dsh-am-confirm"))[0], byClass("dsh-am-btn-danger"))[0].props.onClick();
	equal("second delete reuses the mounted namespace", deleteHarness.calls.mounts, 1);
	equal("second delete requested", deleteHarness.calls.deleted.length, 2);

	console.log("\n# delete refused while the conversation is running");
	const activeHarness = makeContext({ delete: "active" });
	exports.apply(activeHarness.ctx);
	const activeRegistration = activeHarness.registrations[0];
	const activeView = mount(activeRegistration.Component, () => propsFor(activeRegistration, { wide: true }));
	findAll(activeView.tree, byClass("dsh-am-trigger"))[0].props.onClick();
	findAll(findAll(activeView.tree, byClass("dsh-am-row"))[0], byLabel(deleteLabel))[0].props.onClick();
	await findAll(findAll(activeView.tree, byClass("dsh-am-confirm"))[0], byClass("dsh-am-btn-danger"))[0].props.onClick();
	equal("delete attempted", activeHarness.calls.deleted.join(","), "s-alpha-1");
	equal("row kept when the Host refuses", findAll(activeView.tree, byClass("dsh-am-row")).length, 3);
	check(
		"running-conversation toast",
		textOf(findAll(activeView.tree, byClass("dsh-am-toast"))[0]).indexOf("仍在运行") !== -1,
		textOf(findAll(activeView.tree, byClass("dsh-am-toast"))[0]),
	);

	console.log("\n# delete without a gateway");
	const offlineHarness = makeContext({ delete: "missing" });
	exports.apply(offlineHarness.ctx);
	const offlineRegistration = offlineHarness.registrations[0];
	const offlineView = mount(offlineRegistration.Component, () => propsFor(offlineRegistration, { wide: true }));
	findAll(offlineView.tree, byClass("dsh-am-trigger"))[0].props.onClick();
	findAll(findAll(offlineView.tree, byClass("dsh-am-row"))[0], byLabel(deleteLabel))[0].props.onClick();
	await findAll(findAll(offlineView.tree, byClass("dsh-am-confirm"))[0], byClass("dsh-am-btn-danger"))[0].props.onClick();
	check(
		"unavailable toast",
		textOf(findAll(offlineView.tree, byClass("dsh-am-toast"))[0]).indexOf("没有提供删除会话的接口") !== -1,
		textOf(findAll(offlineView.tree, byClass("dsh-am-toast"))[0]),
	);
	equal("nothing deleted without a gateway", offlineHarness.calls.deleted.length, 0);
	equal("row kept without a gateway", findAll(offlineView.tree, byClass("dsh-am-row")).length, 3);

	const mountFailHarness = makeContext({ delete: "mount-fails" });
	exports.apply(mountFailHarness.ctx);
	const mountFailRegistration = mountFailHarness.registrations[0];
	const mountFailView = mount(mountFailRegistration.Component, () => propsFor(mountFailRegistration, { wide: true }));
	findAll(mountFailView.tree, byClass("dsh-am-trigger"))[0].props.onClick();
	findAll(findAll(mountFailView.tree, byClass("dsh-am-row"))[0], byLabel(deleteLabel))[0].props.onClick();
	await findAll(findAll(mountFailView.tree, byClass("dsh-am-confirm"))[0], byClass("dsh-am-btn-danger"))[0].props.onClick();
	check(
		"rejected mount degrades to unavailable",
		textOf(findAll(mountFailView.tree, byClass("dsh-am-toast"))[0]).indexOf("没有提供删除会话的接口") !== -1,
		textOf(findAll(mountFailView.tree, byClass("dsh-am-toast"))[0]),
	);

	deleteView.dispose();
	activeView.dispose();
	offlineView.dispose();
	mountFailView.dispose();

	console.log("\n# delete confirmation lives on the row");
	const inlineHarness = makeContext();
	exports.apply(inlineHarness.ctx);
	const inlineRegistration = inlineHarness.registrations[0];
	const inlineProps = inlineRegistration.options.inject();
	const inlineView = mount(inlineRegistration.Component, () => propsFor(inlineRegistration, { wide: true }));
	findAll(inlineView.tree, byClass("dsh-am-trigger"))[0].props.onClick();
	const rowsBefore = findAll(inlineView.tree, byClass("dsh-am-row"));
	const heightBefore = findAll(inlineView.tree, byClass("dsh-am-panel"))[0].props.style.height;
	findAll(rowsBefore[0], byLabel(inlineProps.t("action.delete")))[0].props.onClick();
	const rowsDuring = findAll(inlineView.tree, byClass("dsh-am-row"));
	equal("row count unchanged by the confirmation", rowsDuring.length, rowsBefore.length);
	const confirmNode = findAll(rowsDuring[0], byClass("dsh-am-confirm"))[0];
	check("confirmation rendered inside the row itself", Boolean(confirmNode));
	check("row is flagged as confirming", rowsDuring[0].props["data-confirm"] === "true");
	check("confirmation replaces that row's actions", findAll(rowsDuring[0], byClass("dsh-am-row-actions")).length === 0);
	check("other rows keep their actions", findAll(rowsDuring[1], byClass("dsh-am-row-actions")).length === 1);
	equal("panel keeps its geometry", findAll(inlineView.tree, byClass("dsh-am-panel"))[0].props.style.height, heightBefore);
	findAll(confirmNode, byClass("dsh-am-btn"))[1].props.onClick();
	check("cancel restores the row", findAll(inlineView.tree, byClass("dsh-am-confirm")).length === 0);
	inlineView.dispose();

	console.log("\n# multi-select restore");
	const selectHarness = makeContext();
	exports.apply(selectHarness.ctx);
	const selectRegistration = selectHarness.registrations[0];
	const selectProps = selectRegistration.options.inject();
	const selectView = mount(selectRegistration.Component, () => propsFor(selectRegistration, { wide: true }));
	findAll(selectView.tree, byClass("dsh-am-trigger"))[0].props.onClick();
	equal("a checkbox per row", findAll(selectView.tree, byClass("dsh-am-check")).length, 3);
	check("no bulk bar before selecting", findAll(selectView.tree, byClass("dsh-am-bulk")).length === 0);
	findAll(selectView.tree, byClass("dsh-am-check"))[0].props.onClick();
	check("bulk bar appears", findAll(selectView.tree, byClass("dsh-am-bulk")).length === 1);
	check(
		"bulk bar counts the selection",
		textOf(findAll(selectView.tree, byClass("dsh-am-bulk"))[0]).indexOf("已选 1 项") !== -1,
		textOf(findAll(selectView.tree, byClass("dsh-am-bulk"))[0]),
	);
	findAll(selectView.tree, byClass("dsh-am-check"))[1].props.onClick();
	equal(
		"two rows marked selected",
		findAll(selectView.tree, byClass("dsh-am-row")).filter((row) => row.props["data-selected"] === "true").length,
		2,
	);
	const bulkRestore = findAll(selectView.tree, byLabel(selectProps.t("bulk.restore")))[0];
	check("bulk restore button rendered", Boolean(bulkRestore));
	await bulkRestore.props.onClick();
	equal("bulk restore unarchived both", selectHarness.calls.unarchive.join(","), "s-alpha-1,s-beta-1");
	check("bulk bar cleared after restoring", findAll(selectView.tree, byClass("dsh-am-bulk")).length === 0);
	equal("only the ungrouped row left", findAll(selectView.tree, byClass("dsh-am-row")).length, 1);
	selectView.dispose();

	console.log("\n# multi-select delete");
	const bulkDeleteHarness = makeContext();
	exports.apply(bulkDeleteHarness.ctx);
	const bulkDeleteRegistration = bulkDeleteHarness.registrations[0];
	const bulkDeleteProps = bulkDeleteRegistration.options.inject();
	const bulkDeleteView = mount(bulkDeleteRegistration.Component, () => propsFor(bulkDeleteRegistration, { wide: true }));
	findAll(bulkDeleteView.tree, byClass("dsh-am-trigger"))[0].props.onClick();
	findAll(bulkDeleteView.tree, byClass("dsh-am-check"))[0].props.onClick();
	findAll(bulkDeleteView.tree, byClass("dsh-am-check"))[1].props.onClick();
	findAll(bulkDeleteView.tree, byLabel(bulkDeleteProps.t("bulk.delete")))[0].props.onClick();
	const bulkConfirmBar = findAll(bulkDeleteView.tree, byClass("dsh-am-bulk"))[0];
	check("bulk delete asks once for the batch", textOf(bulkConfirmBar).indexOf("永久删除这 2 个归档会话") !== -1, textOf(bulkConfirmBar));
	check("nothing deleted before confirming", bulkDeleteHarness.calls.deleted.length === 0);
	await findAll(bulkConfirmBar, byClass("dsh-am-btn-danger"))[0].props.onClick();
	equal("both sessions deleted", bulkDeleteHarness.calls.deleted.slice().sort().join(","), "s-alpha-1,s-beta-1");
	check(
		"bulk delete toast",
		textOf(findAll(bulkDeleteView.tree, byClass("dsh-am-toast"))[0]).indexOf("已删除 2 个会话") !== -1,
		textOf(findAll(bulkDeleteView.tree, byClass("dsh-am-toast"))[0]),
	);
	equal("rows removed after the batch", findAll(bulkDeleteView.tree, byClass("dsh-am-row")).length, 1);
	check("selection cleared after the batch", findAll(bulkDeleteView.tree, byClass("dsh-am-bulk")).length === 0);
	bulkDeleteView.dispose();

	console.log("\n# select all");
	const allHarness = makeContext();
	exports.apply(allHarness.ctx);
	const allRegistration = allHarness.registrations[0];
	const allProps = allRegistration.options.inject();
	const allView = mount(allRegistration.Component, () => propsFor(allRegistration, { wide: true }));
	findAll(allView.tree, byClass("dsh-am-trigger"))[0].props.onClick();
	const selectAll = findAll(allView.tree, byLabel(allProps.t("action.selectAll")))[0];
	check("select-all toggle rendered", Boolean(selectAll));
	selectAll.props.onClick();
	equal(
		"select all ticks every visible row",
		findAll(allView.tree, byClass("dsh-am-row")).filter((row) => row.props["data-selected"] === "true").length,
		3,
	);
	check("select all is pressed", findAll(allView.tree, byLabel(allProps.t("action.selectAll")))[0].props["aria-pressed"] === "true");
	findAll(allView.tree, byLabel(allProps.t("action.selectAll")))[0].props.onClick();
	check("select all toggles back off", findAll(allView.tree, byClass("dsh-am-bulk")).length === 0);
	allView.dispose();

	console.log("\n# per-group actions");
	const groupSnapshot = {
		items: [
			{
				workspaceId: "ws-a",
				title: "Alpha project",
				path: "D:\\work\\alpha",
				sessionIds: ["s-alpha-1", "s-alpha-2", "s-live"],
				createdAt: "",
				updatedAt: "",
			},
		],
		archivedSessionIds: ["s-alpha-1", "s-alpha-2"],
	};
	const groupHarness = makeContext({ workspaces: groupSnapshot });
	exports.apply(groupHarness.ctx);
	const groupRegistration = groupHarness.registrations[0];
	const groupProps = groupRegistration.options.inject();
	const groupView = mount(groupRegistration.Component, () => propsFor(groupRegistration, { wide: true }));
	findAll(groupView.tree, byClass("dsh-am-trigger"))[0].props.onClick();
	const groupHead = findAll(groupView.tree, byClass("dsh-am-group-head"))[0];
	const groupActions = findAll(groupHead, byClass("dsh-am-group-actions"))[0];
	check("group actions rendered", Boolean(groupActions));
	equal("group offers restore and delete", findAll(groupActions, byClass("dsh-am-icon-btn")).length, 2);
	const groupRestoreLabel = groupProps.t("group.restore", { count: 2 });
	const groupDeleteLabel = groupProps.t("group.delete", { count: 2 });
	check("group restore is labelled with its size", Boolean(findAll(groupHead, byLabel(groupRestoreLabel))[0]));
	check("group delete is labelled with its size", Boolean(findAll(groupHead, byLabel(groupDeleteLabel))[0]));
	await findAll(groupHead, byLabel(groupRestoreLabel))[0].props.onClick();
	equal("only the group is restored", groupHarness.calls.unarchive.join(","), "s-alpha-1,s-alpha-2");
	check(
		"group restore toast",
		textOf(findAll(groupView.tree, byClass("dsh-am-toast"))[0]).indexOf("已恢复 2 个会话") !== -1,
	);
	equal("restored group leaves no rows", findAll(groupView.tree, byClass("dsh-am-row")).length, 0);
	groupView.dispose();

	console.log("\n# per-group delete asks in place");
	const groupDeleteHarness = makeContext({ workspaces: groupSnapshot });
	exports.apply(groupDeleteHarness.ctx);
	const groupDeleteRegistration = groupDeleteHarness.registrations[0];
	const groupDeleteProps = groupDeleteRegistration.options.inject();
	const groupDeleteView = mount(groupDeleteRegistration.Component, () => propsFor(groupDeleteRegistration, { wide: true }));
	findAll(groupDeleteView.tree, byClass("dsh-am-trigger"))[0].props.onClick();
	findAll(groupDeleteView.tree, byLabel(groupDeleteProps.t("group.delete", { count: 2 })))[0].props.onClick();
	const groupStrip = findAll(groupDeleteView.tree, byClass("dsh-am-group-confirm"))[0];
	check("the group asks in place", Boolean(groupStrip));
	check(
		"the group question names the count",
		textOf(groupStrip).indexOf("永久删除该组的 2 个会话") !== -1,
		textOf(groupStrip),
	);
	equal("nothing deleted before confirming", groupDeleteHarness.calls.deleted.length, 0);
	equal("rows stay listed while asking", findAll(groupDeleteView.tree, byClass("dsh-am-row")).length, 2);
	findAll(groupStrip, byClass("dsh-am-btn"))[1].props.onClick();
	equal("cancel restores the group head", findAll(groupDeleteView.tree, byClass("dsh-am-group-confirm")).length, 0);
	equal("cancel deletes nothing", groupDeleteHarness.calls.deleted.length, 0);
	findAll(groupDeleteView.tree, byLabel(groupDeleteProps.t("group.delete", { count: 2 })))[0].props.onClick();
	const groupConfirmAgain = findAll(groupDeleteView.tree, byClass("dsh-am-group-confirm"))[0];
	await findAll(groupConfirmAgain, byClass("dsh-am-btn-danger"))[0].props.onClick();
	equal("the whole group is deleted", groupDeleteHarness.calls.deleted.slice().sort().join(","), "s-alpha-1,s-alpha-2");
	check(
		"group delete toast",
		textOf(findAll(groupDeleteView.tree, byClass("dsh-am-toast"))[0]).indexOf("已删除 2 个会话") !== -1,
	);
	equal("deleted group leaves no rows", findAll(groupDeleteView.tree, byClass("dsh-am-row")).length, 0);
	groupDeleteView.dispose();

	console.log("\n# restore all sits away from the close button");
	const awayFromClose = mount(registration.Component, () => propsFor(registration, { wide: true }));
	findAll(awayFromClose.tree, byClass("dsh-am-trigger"))[0].props.onClick();
	const headerRegion = findAll(awayFromClose.tree, byClass("dsh-am-head"))[0];
	equal(
		"the header no longer offers restore-all",
		findAll(headerRegion, byLabel(injectedProps.t("action.restoreAll"))).length,
		0,
	);
	const footerRegion = findAll(awayFromClose.tree, byClass("dsh-am-foot"))[0];
	check(
		"restore-all moved to the footer",
		Boolean(findAll(footerRegion, byLabel(injectedProps.t("action.restoreAll")))[0]),
	);
	awayFromClose.dispose();

	console.log("\n# click away collapses the panel");
	const awayHarness = makeContext();
	exports.apply(awayHarness.ctx);
	const awayRegistration = awayHarness.registrations[0];
	const awayView = mount(awayRegistration.Component, () => propsFor(awayRegistration, { wide: true }));
	equal("no document listener while closed", (documentListeners.get("pointerdown") || []).length, 0);
	findAll(awayView.tree, byClass("dsh-am-trigger"))[0].props.onClick();
	check("document listener installed while open", (documentListeners.get("pointerdown") || []).length > 0);
	pressOutside({ closest: () => ({}) });
	check("a press on the panel itself keeps it open", findAll(awayView.tree, byClass("dsh-am-panel")).length === 1);
	pressOutside({ closest: () => null });
	equal("a press outside collapses the panel", findAll(awayView.tree, byClass("dsh-am-panel")).length, 0);
	equal("listener removed after closing", (documentListeners.get("pointerdown") || []).length, 0);
	awayView.dispose();

	console.log("\n# bundle surface");
	const source = readFileSync(new URL("../src/client.js", import.meta.url), "utf8");
	const requires = Array.from(new Set(Array.from(source.matchAll(/require\("([^"]+)"\)/g), (match) => match[1])));
	equal("module dependencies", requires.join(","), "react");
	check("no hand-written remote descriptors", source.indexOf("TYPERT_REMOTE") === -1);
	check("mounts exactly one Remote", (source.match(/\$mount\(/g) || []).length === 1);
	check("declares the delete endpoint", source.indexOf('"archiveManager/deleteSession"') !== -1);
	check("no legacy archive Remote endpoints", source.indexOf("archiveManager/unarchive") === -1);
	check("restores through the workspaces service", source.indexOf("workspaces.unarchiveSession") !== -1);
	check("reveals through the session remote", source.indexOf("openWorkspacePath") !== -1);
	check("browser half never deletes files itself", source.indexOf("unlink(") === -1);

	console.log("\n# host surface");
	const hostSource = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
	const hostImports = Array.from(new Set(Array.from(hostSource.matchAll(/from "([^"]+)"/g), (match) => match[1])));
	equal("host dependencies", hostImports.join(","), "node:fs/promises,@deepseek-ai/dsh-typert-protocol");
	check("host declares the Remote marker", hostSource.indexOf("Remote(DELETE_METHOD)") !== -1);
	check("host extends TypertRemoteService", hostSource.indexOf("extends TypertRemoteService") !== -1);
	check("host deletes through unlink only", hostSource.indexOf("unlink(") !== -1);
	check(
		"host never deletes recursively",
		hostSource.indexOf("rmSync") === -1 && hostSource.indexOf("rmdir") === -1 && hostSource.indexOf("recursive: true") === -1,
	);
	check("host prunes the archive set", hostSource.indexOf("unarchiveSession") !== -1);
	check("host detaches workspace references", hostSource.indexOf("detachSession") !== -1);
	check("host announces the removal", hostSource.indexOf("api-session/removed") !== -1);
	check("host exposes apply", /export function apply\(ctx\)/.test(hostSource));

	const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
	equal("declares engines.dsh", typeof manifest.engines.dsh, "string");
	check("engines.dsh admits 0.2.1 prereleases", /^>=0\.2\.1-0/.test(manifest.engines.dsh), manifest.engines.dsh);
	check("client half is declared web-only", manifest.dsh.client.platform === "web");

	// Every key the panel asks for must exist in both bundled dictionaries, or
	// the UI would fall back to showing a raw key in one language only.
	const dictKeys = (name) => {
		const block = new RegExp(`const ${name} = \\{([\\s\\S]*?)\\n\\t\\t\\};`).exec(source);
		if (!block) return null;
		return new Set(Array.from(block[1].matchAll(/"([a-z][\w.]*)":/g), (match) => match[1]));
	};
	const zhKeys = dictKeys("zh");
	const enKeys = dictKeys("en");
	const usedKeys = new Set(Array.from(source.matchAll(/\bt\("([a-z][\w.]*)"/g), (match) => match[1]));
	const missing = Array.from(usedKeys).filter((key) => !zhKeys?.has(key) || !enKeys?.has(key));
	equal("dictionary keys are present in both languages", missing.join(","), "");
	check("the panel uses translated labels", usedKeys.size > 10, "keys: " + usedKeys.size);

	console.log("\n" + passed + " checks passed, " + failures.length + " failed");
	if (failures.length) {
		for (const failure of failures) console.log("  - " + failure);
		process.exitCode = 1;
	}
}

await main();
