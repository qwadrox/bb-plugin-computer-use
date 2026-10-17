import {
  domClick,
  fileInputFor,
  fileInputState,
  findRef,
  focusRef,
  hideCursor,
  locateRef,
  moveCursor,
  pageRoots,
  readValue,
  scrollPage,
  selectOption,
  setValue,
  snapshotPage,
  type FileInputState,
  type Located,
  type SnapshotResult,
} from "./page.js";
import {
  GROUP_TITLE,
  NATIVE_HOST,
  type BridgeErrorCode,
  type BridgeParams,
  type BridgeRequest,
  type BridgeStatus,
  type PopupRequest,
  type StoredSettings,
} from "./shared.js";

const CDP_VERSION = "1.3";
const CDP_TIMEOUT_MS = 10_000;
const INPUT_TIMEOUT_MS = 4_000;
const SCREENSHOT_TIMEOUT_MS = 6_000;
const LOAD_TIMEOUT_MS = 20_000;
const IDLE_DETACH_MS = 60_000;
const RECONNECT_ALARM = "reconnect";
const PAUSED_KEY = "paused";
const CURSOR_KEY = "cursor";

class BridgeError extends Error {
  constructor(
    readonly code: BridgeErrorCode,
    message: string,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------- settings

async function readSettings(): Promise<StoredSettings> {
  const stored = await chrome.storage.local.get([PAUSED_KEY, CURSOR_KEY]);
  return { paused: stored[PAUSED_KEY] === true, cursor: stored[CURSOR_KEY] !== false };
}

function browserName(): string {
  const brands = (navigator as Navigator & { userAgentData?: { brands: Array<{ brand: string }> } }).userAgentData?.brands ?? [];
  const names = brands.map((entry) => entry.brand);
  if ((navigator as Navigator & { brave?: unknown }).brave !== undefined || names.includes("Brave")) return "Brave";
  if (names.includes("Microsoft Edge")) return "Edge";
  if (names.includes("Google Chrome")) return "Chrome";
  return "Chromium";
}

function browserVersion(): string {
  return /Chrome\/([\d.]+)/.exec(navigator.userAgent)?.[1] ?? "";
}

// ---------------------------------------------------------------- native host

let port: chrome.runtime.Port | null = null;
let lastError: string | null = null;
let retryMs = 2_000;

function connect(): void {
  if (port !== null) return;
  let next: chrome.runtime.Port;
  try {
    next = chrome.runtime.connectNative(NATIVE_HOST);
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    scheduleReconnect();
    return;
  }
  port = next;
  next.onMessage.addListener((message: unknown) => {
    retryMs = 2_000;
    lastError = null;
    void handleHostMessage(message);
  });
  next.onDisconnect.addListener(() => {
    lastError = chrome.runtime.lastError?.message ?? "The bridge disconnected.";
    if (port === next) port = null;
    scheduleReconnect();
  });
  next.postMessage({ type: "hello", browser: browserName(), version: browserVersion(), extension: chrome.runtime.getManifest().version });
}

function scheduleReconnect(): void {
  setTimeout(connect, retryMs);
  retryMs = Math.min(retryMs * 2, 60_000);
}

chrome.alarms.create(RECONNECT_ALARM, { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RECONNECT_ALARM) connect();
});
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
connect();

interface HostRequest {
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

async function handleHostMessage(message: unknown): Promise<void> {
  const request = message as Partial<HostRequest>;
  if (typeof request.id !== "string" || typeof request.method !== "string") return;
  try {
    // The plugin sends the methods and params of BridgeRequest; any other method reaches dispatch's default case.
    const result = await dispatch({ method: request.method, params: request.params ?? {} } as BridgeRequest);
    port?.postMessage({ id: request.id, result });
  } catch (error) {
    const code = error instanceof BridgeError ? error.code : "failed";
    const text = error instanceof Error ? error.message : String(error);
    port?.postMessage({ id: request.id, error: { code, message: text } });
  }
}

// ---------------------------------------------------------------- tabs

/** Puts a tab an agent opened into the purple Agent group of its window. */
async function groupAgentTab(tabId: number): Promise<void> {
  if (typeof chrome.tabGroups === "undefined") return;
  const tab = await chrome.tabs.get(tabId);
  const [existing] = await chrome.tabGroups.query({ title: GROUP_TITLE, windowId: tab.windowId });
  if (existing !== undefined) {
    await chrome.tabs.group({ tabIds: [tabId], groupId: existing.id });
    return;
  }
  const groupId = await chrome.tabs.group({ tabIds: [tabId], createProperties: { windowId: tab.windowId } });
  await chrome.tabGroups.update(groupId, { title: GROUP_TITLE, color: "purple" });
}

async function assertNotPaused(): Promise<void> {
  if ((await readSettings()).paused) {
    throw new BridgeError(
      "paused",
      "The user paused agents in the browser extension. Do not work around it; ask the user to resume from the extension's toolbar button if the task needs the browser.",
    );
  }
}

/** Checks that agents may use a tab, and returns its id. */
async function allowedTab(tabId: unknown): Promise<number> {
  await assertNotPaused();
  if (typeof tabId !== "number") throw new BridgeError("invalid_arguments", "tab_id must be a number from browser_tabs or browser_open.");
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab === null) throw new BridgeError("tab_closed", `Tab ${tabId} is closed. browser_tabs lists the open tabs.`);
  return tabId;
}

function tabSummary(tab: chrome.tabs.Tab) {
  return { tab_id: tab.id, title: tab.title ?? "", url: tab.url ?? "", active: tab.active, window_id: tab.windowId };
}

// ---------------------------------------------------------------- debugger

const attached = new Map<number, number>();

/** The main frame's isolated world per tab, so evaluate does not create one on every call. */
interface World {
  frameId: string;
  contextId: number;
}
const worlds = new Map<number, World>();

/** Detaches the debugger from every tab agents are using. */
async function detachAll(): Promise<void> {
  for (const tabId of [...attached.keys()]) {
    attached.delete(tabId);
    worlds.delete(tabId);
    await chrome.debugger.detach({ tabId }).catch(() => undefined);
  }
}

chrome.debugger.onDetach.addListener((source, reason) => {
  if (source.tabId === undefined) return;
  attached.delete(source.tabId);
  worlds.delete(source.tabId);
  if (reason === "canceled_by_user") {
    // The user dismissed the "started debugging this browser" bar: stop all agent work.
    void chrome.storage.local.set({ [PAUSED_KEY]: true });
    void detachAll();
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  attached.delete(tabId);
  worlds.delete(tabId);
});

// A new document replaces the page's isolated world. A call that raced the load recovers in evaluate.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") worlds.delete(tabId);
});

setInterval(() => {
  const now = Date.now();
  for (const [tabId, used] of attached) {
    if (now - used > IDLE_DETACH_MS) {
      attached.delete(tabId);
      worlds.delete(tabId);
      void chrome.debugger.detach({ tabId }).catch(() => undefined);
    }
  }
}, 15_000);

function withTimeout<T>(promise: Promise<T>, ms: number, code: BridgeErrorCode, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new BridgeError(code, message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function attach(tabId: number): Promise<void> {
  if (attached.has(tabId)) {
    attached.set(tabId, Date.now());
    return;
  }
  try {
    await chrome.debugger.attach({ tabId }, CDP_VERSION);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (/already attached/i.test(text)) {
      throw new BridgeError("busy", "Another debugger (DevTools or another extension) is attached to this tab. Ask the user to close it.");
    }
    throw new BridgeError("attach_failed", `The extension cannot control this tab: ${text}`);
  }
  attached.set(tabId, Date.now());
  // A background tab should behave like a focused, running one.
  await cdp(tabId, "Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => undefined);
  await cdp(tabId, "Page.setWebLifecycleState", { state: "active" }).catch(() => undefined);
}

function cdp<T = Record<string, unknown>>(
  tabId: number,
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = CDP_TIMEOUT_MS,
): Promise<T> {
  // Only refresh a tab that is still attached: a call that outlives a detach must not re-add it.
  if (attached.has(tabId)) attached.set(tabId, Date.now());
  return withTimeout(
    chrome.debugger.sendCommand({ tabId }, method, params) as Promise<T>,
    timeoutMs,
    "timeout",
    `${method} did not answer within ${timeoutMs / 1000} s.`,
  );
}

async function worldOf(tabId: number): Promise<World> {
  const cached = worlds.get(tabId);
  if (cached !== undefined) return cached;
  const tree = await cdp<{ frameTree: { frame: { id: string } } }>(tabId, "Page.getFrameTree");
  const frameId = tree.frameTree.frame.id;
  const world = await cdp<{ executionContextId: number }>(tabId, "Page.createIsolatedWorld", {
    frameId,
    worldName: "agent-browser-bridge",
  });
  const entry = { frameId, contextId: world.executionContextId };
  worlds.set(tabId, entry);
  return entry;
}

/** What Runtime.evaluate and Runtime.callFunctionOn answer: a value, or a handle on a page object. */
interface RemoteResult {
  value?: unknown;
  objectId?: string;
}

async function evaluateIn(tabId: number, expression: string, returnByValue: boolean): Promise<RemoteResult> {
  const world = await worldOf(tabId);
  const response = await cdp<{
    result: RemoteResult;
    exceptionDetails?: { text: string; exception?: { description?: string } };
  }>(tabId, "Runtime.evaluate", {
    expression,
    contextId: world.contextId,
    returnByValue,
    awaitPromise: true,
  });
  if (response.exceptionDetails !== undefined) {
    throw new BridgeError("page_error", response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
  }
  return response.result;
}

async function run(tabId: number, fn: (...args: never[]) => unknown, arg: unknown, returnByValue: boolean): Promise<RemoteResult> {
  await attach(tabId);
  // The page helpers are defined ahead of fn, which may call them (see page.ts).
  const expression = `(() => {
    const pageRoots = ${pageRoots.toString()};
    const findRef = ${findRef.toString()};
    return (${fn.toString()})(${arg === undefined ? "" : JSON.stringify(arg)});
  })()`;
  try {
    return await evaluateIn(tabId, expression, returnByValue);
  } catch (error) {
    // The context was destroyed by a navigation the cache has not seen yet: make a fresh world and try once more.
    if (error instanceof BridgeError || !(error instanceof Error) || !/Cannot find context/i.test(error.message)) throw error;
    worlds.delete(tabId);
    return evaluateIn(tabId, expression, returnByValue);
  }
}

async function evaluate<T>(tabId: number, fn: (...args: never[]) => unknown, arg?: unknown): Promise<T> {
  return (await run(tabId, fn, arg, true)).value as T;
}

/** Like evaluate, but an object result comes back as a handle; release it with Runtime.releaseObject. */
function evaluateHandle(tabId: number, fn: (...args: never[]) => unknown, arg?: unknown): Promise<RemoteResult> {
  return run(tabId, fn, arg, false);
}

/** Calls fn with a page object from evaluateHandle as `this`. */
async function callOn<T>(tabId: number, objectId: string, fn: (this: never) => unknown): Promise<T> {
  const response = await cdp<{ result: RemoteResult }>(tabId, "Runtime.callFunctionOn", {
    objectId,
    functionDeclaration: fn.toString(),
    returnByValue: true,
  });
  return response.result.value as T;
}

async function waitForLoad(tabId: number): Promise<void> {
  const deadline = Date.now() + LOAD_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (tab === null) return;
    if (tab.status === "complete") return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

/** After an action: give the page a moment, and wait out a navigation it started. */
async function settle(tabId: number): Promise<{ url: string; title: string }> {
  await new Promise((resolve) => setTimeout(resolve, 350));
  await waitForLoad(tabId);
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  return { url: tab?.url ?? "", title: tab?.title ?? "" };
}

/** Glides the agent cursor to a point before an action, when the user has it on. It never fails the action. */
async function showCursor(tabId: number, point: { x: number; y: number }, click: boolean): Promise<void> {
  if (!(await readSettings()).cursor) return;
  await evaluate(tabId, moveCursor, { ...point, click }).catch(() => undefined);
}

/** Moves the cursor onto a ref before typing into or choosing in it. */
async function pointAt(tabId: number, ref: string): Promise<void> {
  if (!(await readSettings()).cursor) return;
  const located = await evaluate<Located>(tabId, locateRef, ref).catch(() => null);
  if (located?.found === true) await showCursor(tabId, located, false);
}

/** The browser lets an extension hand files to a page only with the user's "Allow access to file URLs". */
function noFileAccess(): BridgeError {
  const browser = browserName();
  const scheme = browser === "Brave" ? "brave" : browser === "Edge" ? "edge" : "chrome";
  return new BridgeError(
    "no_file_access",
    `${browser} does not let Browser Bridge for bb read files yet. Ask the user to open ${scheme}://extensions/?id=${chrome.runtime.id} in ${browser}, turn on **Allow access to file URLs**, and tell you when it is on; then call browser_upload again.`,
  );
}

function staleRef(ref: string): BridgeError {
  return new BridgeError("stale_ref", `Ref ${ref} is not on the page any more. Call browser_read again and use a fresh ref.`);
}

// ---------------------------------------------------------------- keys

const KEYS: Record<string, { code: string; keyCode: number; text?: string; key?: string }> = {
  Enter: { code: "Enter", keyCode: 13, text: "\r" },
  Tab: { code: "Tab", keyCode: 9 },
  Escape: { code: "Escape", keyCode: 27 },
  Backspace: { code: "Backspace", keyCode: 8 },
  Delete: { code: "Delete", keyCode: 46 },
  ArrowUp: { code: "ArrowUp", keyCode: 38 },
  ArrowDown: { code: "ArrowDown", keyCode: 40 },
  ArrowLeft: { code: "ArrowLeft", keyCode: 37 },
  ArrowRight: { code: "ArrowRight", keyCode: 39 },
  Home: { code: "Home", keyCode: 36 },
  End: { code: "End", keyCode: 35 },
  PageUp: { code: "PageUp", keyCode: 33 },
  PageDown: { code: "PageDown", keyCode: 34 },
  Space: { code: "Space", keyCode: 32, text: " ", key: " " },
};
/** The named keys by lower-case name, so "arrowdown" and "ArrowDown" both work. */
const NAMED_KEYS = new Map(Object.entries(KEYS).map(([name, spec]) => [name.toLowerCase(), spec] as const));
const MODIFIERS: Record<string, number> = { alt: 1, ctrl: 2, control: 2, meta: 4, cmd: 4, command: 4, shift: 8 };

async function pressKey(tabId: number, combo: string): Promise<void> {
  const parts = combo.split("+").map((part) => part.trim()).filter((part) => part !== "");
  const keyName = parts.pop();
  if (keyName === undefined) throw new BridgeError("invalid_arguments", "key is empty.");
  let modifiers = 0;
  for (const part of parts) {
    const bit = MODIFIERS[part.toLowerCase()];
    if (bit === undefined) throw new BridgeError("invalid_arguments", `Unknown modifier ${part}. Use ctrl, alt, shift or meta.`);
    modifiers |= bit;
  }
  const named = NAMED_KEYS.get(keyName.toLowerCase());
  let event: { key: string; code: string; windowsVirtualKeyCode: number; text?: string };
  if (named !== undefined) {
    event = { key: named.key ?? named.code, code: named.code, windowsVirtualKeyCode: named.keyCode, ...(named.text ? { text: named.text } : {}) };
  } else if ([...keyName].length === 1) {
    const upper = keyName.toUpperCase();
    const isLetter = /[A-Z]/.test(upper);
    const isDigit = /[0-9]/.test(keyName);
    event = {
      key: keyName,
      code: isLetter ? `Key${upper}` : isDigit ? `Digit${keyName}` : "",
      windowsVirtualKeyCode: isLetter || isDigit ? upper.charCodeAt(0) : 0,
      ...(modifiers & (2 | 4) ? {} : { text: keyName }),
    };
  } else {
    throw new BridgeError("invalid_arguments", `Unknown key ${keyName}. Use a single character or one of ${Object.keys(KEYS).join(", ")}.`);
  }
  await cdp(tabId, "Input.dispatchKeyEvent", { type: event.text ? "keyDown" : "rawKeyDown", modifiers, ...event }, INPUT_TIMEOUT_MS);
  await cdp(tabId, "Input.dispatchKeyEvent", { type: "keyUp", modifiers, ...event }, INPUT_TIMEOUT_MS);
}

// ---------------------------------------------------------------- methods

function stringParam(params: Record<string, unknown>, name: string): string {
  const value = params[name];
  if (typeof value !== "string" || value === "") throw new BridgeError("invalid_arguments", `${name} must be a non-empty string.`);
  return value;
}

function webUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BridgeError("invalid_arguments", `${raw} is not a full URL. Include https://.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:" && url.href !== "about:blank") {
    throw new BridgeError("invalid_arguments", "Only http, https and about:blank URLs can be opened.");
  }
  return url.href;
}

async function dispatch({ method, params }: BridgeRequest): Promise<unknown> {
  switch (method) {
    case "status": {
      const settings = await readSettings();
      return { browser: browserName(), version: browserVersion(), extension: chrome.runtime.getManifest().version, ...settings };
    }
    case "tabs": {
      const settings = await readSettings();
      const tabs = await chrome.tabs.query({ windowType: "normal" });
      return { paused: settings.paused, tabs: tabs.map(tabSummary) };
    }
    case "open": {
      await assertNotPaused();
      const url = webUrl(typeof params.url === "string" && params.url !== "" ? params.url : "about:blank");
      const window = await chrome.windows.getLastFocused({ windowTypes: ["normal"] }).catch(() => null);
      const tab = await chrome.tabs.create({ url, active: false, ...(window?.id !== undefined ? { windowId: window.id } : {}) });
      if (tab.id === undefined) throw new BridgeError("failed", "The browser did not create a tab.");
      await groupAgentTab(tab.id).catch(() => undefined);
      await waitForLoad(tab.id);
      return tabSummary(await chrome.tabs.get(tab.id));
    }
    case "read": {
      const tabId = await allowedTab(params.tab_id);
      await waitForLoad(tabId);
      const result = await evaluate<SnapshotResult>(tabId, snapshotPage, {
        query: typeof params.query === "string" && params.query !== "" ? params.query : null,
        offset: typeof params.offset === "number" ? params.offset : 0,
        maxChars: typeof params.max_chars === "number" ? Math.min(Math.max(params.max_chars, 1_000), 60_000) : 15_000,
      });
      return result;
    }
    case "click": {
      const tabId = await allowedTab(params.tab_id);
      const ref = stringParam(params, "ref");
      const located = await evaluate<Located>(tabId, locateRef, ref);
      if (!located.found) throw staleRef(ref);
      await showCursor(tabId, located, true);
      let route = "trusted";
      try {
        const point = { x: located.x, y: located.y };
        await cdp(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", ...point }, INPUT_TIMEOUT_MS);
        await cdp(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 }, INPUT_TIMEOUT_MS);
        await cdp(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 }, INPUT_TIMEOUT_MS);
      } catch (error) {
        if (!(error instanceof BridgeError) || error.code !== "timeout") throw error;
        route = "dom";
        if (!(await evaluate<boolean>(tabId, domClick, ref))) throw staleRef(ref);
      }
      const after = await settle(tabId);
      return { route, covered_by: located.covered, ...after };
    }
    case "type": {
      const tabId = await allowedTab(params.tab_id);
      const ref = stringParam(params, "ref");
      const text = typeof params.text === "string" ? params.text : "";
      const replace = params.replace === true;
      await pointAt(tabId, ref);
      const focused = await evaluate<{ found: boolean; editable: boolean }>(tabId, focusRef, { ref, replace });
      if (!focused.found) throw staleRef(ref);
      if (!focused.editable) throw new BridgeError("not_editable", `Ref ${ref} is not a text field. Click it or pick another ref.`);
      const before = await evaluate<{ value: string }>(tabId, readValue, ref);
      let route = "trusted";
      try {
        if (text !== "") await cdp(tabId, "Input.insertText", { text }, INPUT_TIMEOUT_MS);
        else if (replace) await pressKey(tabId, "Backspace");
      } catch (error) {
        if (!(error instanceof BridgeError) || error.code !== "timeout") throw error;
        route = "dom";
      }
      let after = await evaluate<{ value: string; secret: boolean }>(tabId, readValue, ref);
      if (route === "trusted" && text !== "" && after.value === before.value && !after.secret) route = "dom";
      if (route === "dom") {
        await evaluate<boolean>(tabId, setValue, { ref, text, replace });
        after = await evaluate<{ value: string; secret: boolean }>(tabId, readValue, ref);
      }
      if (params.submit === true) await pressKey(tabId, "Enter");
      const settled = params.submit === true ? await settle(tabId) : null;
      return { route, value: after.secret ? "(hidden)" : after.value.slice(0, 500), ...(settled ?? {}) };
    }
    case "key": {
      const tabId = await allowedTab(params.tab_id);
      await attach(tabId);
      await pressKey(tabId, stringParam(params, "key"));
      return settle(tabId);
    }
    case "select": {
      const tabId = await allowedTab(params.tab_id);
      const ref = stringParam(params, "ref");
      await pointAt(tabId, ref);
      const result = await evaluate<{ found: boolean; chosen: string | null; options: string[] }>(tabId, selectOption, {
        ref,
        option: stringParam(params, "option"),
      });
      if (!result.found) throw staleRef(ref);
      if (result.chosen === null) {
        throw new BridgeError(
          "no_such_option",
          result.options.length > 0 ? `No option matches. Options: ${result.options.slice(0, 40).join(" | ")}` : `Ref ${ref} is not a <select>.`,
        );
      }
      return { chosen: result.chosen, ...(await settle(tabId)) };
    }
    case "scroll": {
      const tabId = await allowedTab(params.tab_id);
      const ref = typeof params.ref === "string" && params.ref !== "" ? params.ref : null;
      const direction = params.direction === "up" ? -1 : 1;
      const amount = typeof params.amount === "number" ? params.amount : 0.8;
      const height = await evaluate<number>(tabId, () => innerHeight);
      const result = await evaluate<{ found: boolean; scrollY: number }>(tabId, scrollPage, {
        ref,
        deltaY: Math.round(direction * amount * height),
      });
      if (!result.found && ref !== null) throw staleRef(ref);
      return { scroll_y: result.scrollY };
    }
    case "navigate": {
      const tabId = await allowedTab(params.tab_id);
      const target = stringParam(params, "url");
      if (target === "back" || target === "forward") {
        await (target === "back" ? chrome.tabs.goBack(tabId) : chrome.tabs.goForward(tabId)).catch(() => {
          throw new BridgeError("no_history", `There is no page to go ${target} to.`);
        });
      } else if (target === "reload") {
        await chrome.tabs.reload(tabId);
      } else {
        await chrome.tabs.update(tabId, { url: webUrl(target) });
      }
      return settle(tabId);
    }
    case "screenshot": {
      const tabId = await allowedTab(params.tab_id);
      await attach(tabId);
      // The picture is for the agent: leave its own cursor out.
      const cursor = (await readSettings()).cursor;
      if (cursor) await evaluate(tabId, hideCursor, true).catch(() => undefined);
      try {
        const shot = await cdp<{ data: string }>(
          tabId,
          "Page.captureScreenshot",
          { format: "jpeg", quality: 70, captureBeyondViewport: false },
          SCREENSHOT_TIMEOUT_MS,
        );
        return { data: shot.data, mime_type: "image/jpeg" };
      } catch (error) {
        if (error instanceof BridgeError && error.code === "timeout") {
          throw new BridgeError(
            "not_rendered",
            "The browser is not drawing this tab because it is in the background, so there is no picture. Read it with browser_read instead.",
          );
        }
        throw error;
      } finally {
        if (cursor) await evaluate(tabId, hideCursor, false).catch(() => undefined);
      }
    }
    case "close": {
      const tabId = await allowedTab(params.tab_id);
      await chrome.tabs.remove(tabId);
      return { closed: tabId };
    }
    case "upload": {
      const tabId = await allowedTab(params.tab_id);
      const paths: unknown = params.paths;
      if (!Array.isArray(paths) || paths.length === 0 || !paths.every((path) => typeof path === "string" && path !== "")) {
        throw new BridgeError("invalid_arguments", "paths must list one or more absolute file paths.");
      }
      if (!(await chrome.extension.isAllowedFileSchemeAccess())) throw noFileAccess();
      const ref = typeof params.ref === "string" && params.ref !== "" ? params.ref : null;
      const input = await evaluateHandle(tabId, fileInputFor, ref);
      if (input.objectId === undefined) {
        if (input.value === "stale" && ref !== null) throw staleRef(ref);
        throw new BridgeError(
          "no_file_input",
          input.value === "several"
            ? `${ref === null ? "The page" : `Ref ${ref}`} has several file inputs. Pass the ref of the one you want: browser_read lists them as file lines, hidden ones too.`
            : `${ref === null ? "The page has no file input" : `There is no file input at or around ref ${ref}`}. Open the page's upload step or dialog first, read again, and pass the ref of its file line.`,
        );
      }
      const objectId = input.objectId;
      try {
        const before = await callOn<FileInputState>(tabId, objectId, fileInputState);
        if (before.disabled) throw new BridgeError("no_file_input", "That file input is disabled.");
        if (!before.multiple && paths.length > 1) {
          throw new BridgeError("invalid_arguments", "That file input takes one file. Upload them one at a time, or find an input marked multiple.");
        }
        await cdp(tabId, "DOM.setFileInputFiles", { files: paths, objectId }).catch((error: unknown) => {
          if (error instanceof Error && /not allowed/i.test(error.message)) throw noFileAccess();
          throw error;
        });
        const after = await callOn<FileInputState>(tabId, objectId, fileInputState);
        return { files: after.files, ...(await settle(tabId)) };
      } finally {
        await cdp(tabId, "Runtime.releaseObject", { objectId }).catch(() => undefined);
      }
    }
    default: {
      // Fails to compile if a BridgeMethod has no case. At run time this is a method the plugin does not know.
      const unhandled: never = method;
      throw new BridgeError("unknown_method", `Unknown method ${String(unhandled)}.`);
    }
  }
}

// ---------------------------------------------------------------- popup

chrome.runtime.onMessage.addListener((message: PopupRequest, _sender, reply) => {
  void (async () => {
    switch (message.type) {
      case "pause":
        await chrome.storage.local.set({ [PAUSED_KEY]: true });
        await detachAll();
        break;
      case "resume":
        await chrome.storage.local.set({ [PAUSED_KEY]: false });
        break;
      case "cursor":
        await chrome.storage.local.set({ [CURSOR_KEY]: message.enabled });
        break;
      case "reconnect":
        retryMs = 2_000;
        connect();
        await new Promise((resolve) => setTimeout(resolve, 300));
        break;
      case "status":
        break;
    }
    const status: BridgeStatus = {
      connected: port !== null && lastError === null,
      error: lastError,
      browser: browserName(),
      settings: await readSettings(),
    };
    reply(status);
  })();
  return true;
});
