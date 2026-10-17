import {
  domClick,
  fileInputFor,
  fileInputState,
  fieldKind,
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
  type FieldKind,
  type FileInputState,
  type Located,
  type SnapshotOptions,
  type SnapshotResult,
} from "./page.js";
import { diffOutline } from "./outline.js";
import {
  GROUP_TITLE,
  NATIVE_HOST,
  type ActionResult,
  type BridgeErrorCode,
  type BridgeRequest,
  type BridgeStatus,
  type PageDialog,
  type PopupRequest,
  type StoredSettings,
  type TabInfo,
} from "./shared.js";

const CDP_VERSION = "1.3";
const CDP_TIMEOUT_MS = 10_000;
const INPUT_TIMEOUT_MS = 4_000;
const SCREENSHOT_TIMEOUT_MS = 6_000;
const LOAD_TIMEOUT_MS = 20_000;
const WAIT_FOR_MS = 10_000;
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
  if (tab.groupId !== -1 && tab.groupId !== undefined) {
    const group = await chrome.tabGroups.get(tab.groupId).catch(() => null);
    if (group?.title === GROUP_TITLE) return;
  }
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

/** What still works in a tab that shows a dialog: answering it, and closing the tab. */
const DIALOG_METHODS = new Set<string>(["dialog", "close"]);

/** Checks that agents may use a tab, and returns its id. */
async function allowedTab(tabId: unknown, method: string): Promise<number> {
  await assertNotPaused();
  if (typeof tabId !== "number") throw new BridgeError("invalid_arguments", "tab_id must be a number from browser_tabs or browser_open.");
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab === null) throw new BridgeError("tab_closed", `Tab ${tabId} is closed. browser_tabs lists the open tabs.`);
  const dialog = dialogs.get(tabId);
  if (dialog !== undefined && !DIALOG_METHODS.has(method)) throw new DialogOpened(dialog);
  return tabId;
}

function tabSummary(tab: chrome.tabs.Tab) {
  const dialog = tab.id === undefined ? undefined : dialogs.get(tab.id);
  return {
    tab_id: tab.id,
    title: tab.title ?? "",
    url: tab.url ?? "",
    active: tab.active,
    window_id: tab.windowId,
    ...(dialog !== undefined ? { dialog } : {}),
  };
}

// ---------------------------------------------------------------- debugger

const attached = new Map<number, number>();

/** The main frame's isolated world per tab, so evaluate does not create one on every call. */
interface World {
  frameId: string;
  contextId: number;
}
const worlds = new Map<number, World>();

/** The JavaScript dialog each tab shows, from Page.javascriptDialogOpening. */
const dialogs = new Map<number, PageDialog>();
/** Calls in flight per tab. A dialog stops the page answering, so it fails them at once. */
const dialogWaiters = new Map<number, Set<(dialog: PageDialog) => void>>();
/** The outline before the action that opened a tab's dialog, so browser_dialog can say what the answer changed. */
const beforeDialog = new Map<number, string[] | null>();
/** A file picker an action opened, held back by Page.setInterceptFileChooserDialog for browser_upload. */
interface FileChooser {
  backendNodeId: number;
  multiple: boolean;
}
const fileChoosers = new Map<number, FileChooser>();
/** Tabs whose file pickers are held back now; only while an agent action runs. */
const intercepting = new Set<number>();
/** The next ref number per tab, so a new document in the tab does not hand out an earlier page's refs again. */
const refCounters = new Map<number, number>();

class DialogOpened extends BridgeError {
  constructor(readonly dialog: PageDialog) {
    super(
      "dialog_open",
      `The tab shows a ${dialog.type} dialog: ${JSON.stringify(dialog.message)}. Nothing in the tab runs until it is answered: call browser_dialog with accept true or false${dialog.type === "prompt" ? ", and text for the answer" : ""}.`,
    );
  }
}

function forget(tabId: number): void {
  attached.delete(tabId);
  worlds.delete(tabId);
  dialogs.delete(tabId);
  beforeDialog.delete(tabId);
  fileChoosers.delete(tabId);
  intercepting.delete(tabId);
}

/** Detaches the debugger from every tab agents are using. */
async function detachAll(): Promise<void> {
  for (const tabId of [...attached.keys()]) {
    forget(tabId);
    await chrome.debugger.detach({ tabId }).catch(() => undefined);
  }
}

chrome.debugger.onDetach.addListener((source, reason) => {
  if (source.tabId === undefined) return;
  forget(source.tabId);
  if (reason === "canceled_by_user") {
    // The user dismissed the "started debugging this browser" bar: stop all agent work.
    void chrome.storage.local.set({ [PAUSED_KEY]: true });
    void detachAll();
  }
});

chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source.tabId;
  if (tabId === undefined) return;
  if (method === "Page.javascriptDialogOpening") {
    const event = (params ?? {}) as { type?: string; message?: string; defaultPrompt?: string };
    const dialog: PageDialog = { type: event.type ?? "alert", message: event.message ?? "", default_prompt: event.defaultPrompt ?? "" };
    dialogs.set(tabId, dialog);
    for (const waiter of [...(dialogWaiters.get(tabId) ?? [])]) waiter(dialog);
  } else if (method === "Page.javascriptDialogClosed") {
    dialogs.delete(tabId);
  } else if (method === "Page.fileChooserOpened") {
    const event = (params ?? {}) as { backendNodeId?: number; mode?: string };
    if (event.backendNodeId !== undefined) {
      fileChoosers.set(tabId, { backendNodeId: event.backendNodeId, multiple: event.mode === "selectMultiple" });
    }
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  forget(tabId);
  refCounters.delete(tabId);
  dialogWaiters.delete(tabId);
});

// A new document replaces the page's isolated world. A call that raced the load recovers in evaluate.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    worlds.delete(tabId);
    fileChoosers.delete(tabId);
  }
});

setInterval(() => {
  const now = Date.now();
  for (const [tabId, used] of attached) {
    // A tab waiting on a dialog stays attached, so the dialog can still be answered.
    if (now - used > IDLE_DETACH_MS && !dialogs.has(tabId)) {
      forget(tabId);
      void chrome.debugger.detach({ tabId }).catch(() => undefined);
    }
  }
}, 15_000);

/** What the browser's debugger errors mean for an agent. */
function debuggerError(text: string): BridgeError | null {
  if (/chrome-extension:\/\/|different extension/i.test(text)) {
    return new BridgeError(
      "blocked_by_extension",
      "This tab shows a frame or popup of another extension (a password manager or wallet, for example), and the browser does not let one extension control a page while it does. Ask the user to close it, or work in the browser window with the cua_* tools.",
    );
  }
  if (/cannot be scripted|chrome:\/\/|edge:\/\/|brave:\/\/|webstore|cannot access contents/i.test(text)) {
    return new BridgeError(
      "restricted_page",
      "The browser does not let extensions control this page (browser settings, the extension store, other extensions' pages). Navigate the tab to a website, or use the cua_* window tools.",
    );
  }
  return null;
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
    throw debuggerError(text) ?? new BridgeError("attach_failed", `The extension cannot control this tab: ${text}`);
  }
  attached.set(tabId, Date.now());
  // Page events report dialogs and file pickers.
  await cdp(tabId, "Page.enable").catch(() => undefined);
  // A background tab should behave like a focused, running one.
  await cdp(tabId, "Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => undefined);
  await cdp(tabId, "Page.setWebLifecycleState", { state: "active" }).catch(() => undefined);
}

const DIALOG_COMMANDS = new Set([
  "Page.handleJavaScriptDialog",
  "Page.enable",
  "Page.setWebLifecycleState",
  "Emulation.setFocusEmulationEnabled",
  "Runtime.releaseObject",
]);

function cdp<T = Record<string, unknown>>(
  tabId: number,
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = CDP_TIMEOUT_MS,
): Promise<T> {
  // Only refresh a tab that is still attached: a call that outlives a detach must not re-add it.
  if (attached.has(tabId)) attached.set(tabId, Date.now());
  // While a dialog shows, the page answers nothing but these; anything else would wait for the dialog.
  const watchDialogs = !DIALOG_COMMANDS.has(method);
  const open = dialogs.get(tabId);
  if (watchDialogs && open !== undefined) return Promise.reject(new DialogOpened(open));
  const sent = (chrome.debugger.sendCommand({ tabId }, method, params) as Promise<T>).catch((error: unknown) => {
    throw debuggerError(error instanceof Error ? error.message : String(error)) ?? error;
  });
  return new Promise<T>((resolve, reject) => {
    const waiters = dialogWaiters.get(tabId) ?? new Set<(dialog: PageDialog) => void>();
    dialogWaiters.set(tabId, waiters);
    const onDialog = (dialog: PageDialog): void => {
      done();
      reject(new DialogOpened(dialog));
    };
    const timer = setTimeout(() => {
      done();
      reject(new BridgeError("timeout", `The tab did not answer ${method} within ${timeoutMs / 1000} s. It may be busy: try again, or take a browser_screenshot.`));
    }, timeoutMs);
    const done = (): void => {
      clearTimeout(timer);
      waiters.delete(onDialog);
    };
    if (watchDialogs) waiters.add(onDialog);
    sent.then(
      (value) => {
        done();
        resolve(value);
      },
      (error: unknown) => {
        done();
        reject(error);
      },
    );
  });
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForLoad(tabId: number, timeoutMs = LOAD_TIMEOUT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (tab === null) return;
    if (tab.status === "complete") return;
    await sleep(200);
  }
}

/** After an action: give the page a moment, and wait out a navigation it started. */
async function settle(tabId: number): Promise<{ url: string; title: string }> {
  await sleep(350);
  await waitForLoad(tabId);
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  return { url: tab?.url ?? "", title: tab?.title ?? "" };
}

/** The page outline; refs continue from the tab's earlier pages. */
async function snapshot(tabId: number, options: Partial<SnapshotOptions> = {}): Promise<SnapshotResult> {
  const full: SnapshotOptions = {
    query: null,
    offset: 0,
    maxChars: 15_000,
    scope: null,
    lines: false,
    start: refCounters.get(tabId) ?? 1,
    ...options,
  };
  const result = await evaluate<SnapshotResult>(tabId, snapshotPage, full);
  refCounters.set(tabId, Math.max(refCounters.get(tabId) ?? 1, result.next));
  return result;
}

/** The outline's lines, or null when the page cannot be read; a dialog still stops the action. */
async function outlineLines(tabId: number): Promise<string[] | null> {
  try {
    return (await snapshot(tabId, { lines: true, maxChars: 1 })).lines ?? [];
  } catch (error) {
    if (error instanceof DialogOpened) throw error;
    return null;
  }
}

/** Waits up to WAIT_FOR_MS for text to appear in the tab's outline. */
async function waitForText(tabId: number, text: string): Promise<{ text: string; found: boolean }> {
  const wanted = text.trim().toLowerCase();
  const deadline = Date.now() + WAIT_FOR_MS;
  for (;;) {
    const lines = await outlineLines(tabId);
    if (lines?.some((line) => line.toLowerCase().includes(wanted)) === true) return { text, found: true };
    if (Date.now() >= deadline) return { text, found: false };
    await sleep(300);
    await waitForLoad(tabId);
  }
}

function waitForParam(params: Record<string, unknown>): string | null {
  const value = params.wait_for;
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** What an action needs from before it ran. */
interface ActionStart {
  before: string[] | null;
  targets: string[];
  url: string;
  /** The tab in front in the window, to bring back if the action opens one over it. */
  front: number | undefined;
}

function samePage(a: string, b: string): boolean {
  return a.split("#")[0] === b.split("#")[0];
}

async function frontTab(tabId: number): Promise<{ url: string; front: number | undefined }> {
  const tab = await chrome.tabs.get(tabId);
  const [front] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
  return { url: tab.url ?? "", front: front?.id };
}

/** Reads the page before an action; each ref must be on it now. */
async function startAction(tabId: number, refs: string[]): Promise<ActionStart> {
  try {
    await attach(tabId);
  } catch (error) {
    // Navigating away from a page the extension cannot control still works.
    if (refs.length > 0) throw error;
  }
  await waitForLoad(tabId);
  const before = refs.length > 0 ? ((await snapshot(tabId, { lines: true, maxChars: 1 })).lines ?? []) : await outlineLines(tabId);
  const targets = refs.map((ref) => {
    const line = before?.find((entry) => entry.startsWith(`[${ref}] `));
    if (line === undefined) throw staleRef(ref);
    return line;
  });
  return { before, targets, ...(await frontTab(tabId)) };
}

/** Keeps tabs an action opened in the background, in the Agent group, and says what they hold. */
async function placeOpenedTabs(tabId: number, opened: number[], front: number | undefined): Promise<TabInfo[]> {
  const tabs: TabInfo[] = [];
  for (const id of opened) {
    await waitForLoad(id, 5_000);
    const tab = await chrome.tabs.get(id).catch(() => null);
    if (tab === null) continue;
    if (tab.active && front !== undefined && front !== id && front !== tabId) {
      await chrome.tabs.update(front, { active: true }).catch(() => undefined);
    }
    await groupAgentTab(id).catch(() => undefined);
    tabs.push({ tab_id: id, title: tab.title ?? "", url: tab.url || tab.pendingUrl || "" });
  }
  return tabs;
}

/**
 * Runs an action and reports what it did to the page: the outline's changes,
 * a dialog it opened, tabs it opened, a file picker it opened.
 */
async function runAction(
  tabId: number,
  start: ActionStart,
  waitFor: string | null,
  work: () => Promise<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const opened: number[] = [];
  const onCreated = (tab: chrome.tabs.Tab): void => {
    // A link opened from a background tab names the window's front tab as its opener.
    if (tab.id !== undefined && (tab.openerTabId === tabId || (tab.openerTabId !== undefined && tab.openerTabId === start.front))) opened.push(tab.id);
  };
  chrome.tabs.onCreated.addListener(onCreated);
  const chooserBefore = fileChoosers.get(tabId);
  // A click on an upload button reports the picker instead of opening it on the user's screen.
  // (Not while a dialog shows: the call would wait for it.)
  if (attached.has(tabId) && !dialogs.has(tabId) && !intercepting.has(tabId)) {
    await cdp(tabId, "Page.setInterceptFileChooserDialog", { enabled: true }).then(
      () => intercepting.add(tabId),
      () => undefined,
    );
  }
  let own: Record<string, unknown> = {};
  let outcome: Partial<ActionResult> = {};
  try {
    own = await work();
    const settled = await settle(tabId);
    const waited = waitFor !== null ? await waitForText(tabId, waitFor) : undefined;
    const after = await outlineLines(tabId);
    outcome = {
      ...settled,
      ...(after !== null ? { changes: diffOutline(start.before, after, !samePage(start.url, settled.url)) } : {}),
      ...(waited !== undefined ? { wait_for: waited } : {}),
    };
  } catch (error) {
    if (!(error instanceof DialogOpened)) throw error;
    beforeDialog.set(tabId, start.before);
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    outcome = { url: tab?.url ?? "", title: tab?.title ?? "", dialog: error.dialog };
  } finally {
    chrome.tabs.onCreated.removeListener(onCreated);
    // Left on while a dialog waits; the action that answers it turns it off.
    if (intercepting.has(tabId) && !dialogs.has(tabId)) {
      intercepting.delete(tabId);
      await cdp(tabId, "Page.setInterceptFileChooserDialog", { enabled: false }).catch(() => undefined);
    }
  }
  const chooser = fileChoosers.get(tabId);
  const openedTabs = opened.length > 0 ? await placeOpenedTabs(tabId, opened, start.front) : [];
  return {
    ...(start.targets.length === 1 ? { target: start.targets[0] } : {}),
    ...own,
    ...outcome,
    ...(openedTabs.length > 0 ? { opened_tabs: openedTabs } : {}),
    ...(chooser !== undefined && chooser !== chooserBefore ? { file_chooser: { multiple: chooser.multiple } } : {}),
  };
}

async function act(
  tabId: number,
  refs: string[],
  params: Record<string, unknown>,
  work: (start: ActionStart) => Promise<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const start = await startAction(tabId, refs);
  return runAction(tabId, start, waitForParam(params), () => work(start));
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
  if (located?.found === true && located.visible) await showCursor(tabId, located, false);
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
  return new BridgeError(
    "stale_ref",
    `Ref ${ref} is not on the page now: the element is gone, hidden, or changed. Call browser_read again and use a ref from it.`,
  );
}

/** Where a ref is, for a pointer action; it must take space on the page. */
async function located(tabId: number, ref: string, doing: string): Promise<Located> {
  const spot = await evaluate<Located>(tabId, locateRef, ref);
  if (!spot.found) throw staleRef(ref);
  if (!spot.visible) {
    throw new BridgeError(
      "not_visible",
      `Ref ${ref} takes no space on the page, so it cannot be ${doing}. Open what shows it (a menu, a tab, a section) and read again; for a file input, use browser_upload.`,
    );
  }
  return spot;
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

// ---------------------------------------------------------------- actions

async function clickRef(tabId: number, ref: string): Promise<Record<string, unknown>> {
  const spot = await located(tabId, ref, "clicked");
  await showCursor(tabId, spot, true);
  let route = "trusted";
  try {
    const point = { x: spot.x, y: spot.y };
    await cdp(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", ...point }, INPUT_TIMEOUT_MS);
    await cdp(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 }, INPUT_TIMEOUT_MS);
    await cdp(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 }, INPUT_TIMEOUT_MS);
  } catch (error) {
    if (!(error instanceof BridgeError) || error.code !== "timeout") throw error;
    route = "dom";
    if (!(await evaluate<boolean>(tabId, domClick, ref))) throw staleRef(ref);
  }
  return { route, ...(spot.covered !== null ? { covered_by: spot.covered } : {}) };
}

async function typeInto(tabId: number, ref: string, text: string, replace: boolean): Promise<{ route: string; value: string }> {
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
  return { route, value: after.secret ? "(hidden)" : after.value.slice(0, 500) };
}

async function chooseOption(tabId: number, ref: string, option: string): Promise<string> {
  await pointAt(tabId, ref);
  const result = await evaluate<{ found: boolean; chosen: string | null; options: string[] }>(tabId, selectOption, { ref, option });
  if (!result.found) throw staleRef(ref);
  if (result.chosen === null) {
    throw new BridgeError(
      "no_such_option",
      result.options.length > 0
        ? `No option of ${ref} matches ${JSON.stringify(option)}. Options: ${result.options.slice(0, 40).join(" | ")}`
        : `Ref ${ref} is not a <select>. For a custom dropdown, click it and then click the option.`,
    );
  }
  return result.chosen;
}

/** Fills one field of browser_fill the way its kind takes a value. */
async function fillField(tabId: number, ref: string, value: unknown): Promise<string> {
  const field = await evaluate<FieldKind>(tabId, fieldKind, ref);
  if (!field.found) throw staleRef(ref);
  if (field.kind === "file") throw new BridgeError("invalid_arguments", `Ref ${ref} is a file input: attach files with browser_upload.`);
  if (field.kind === "check") {
    const wanted = value === true || value === "true" || value === "on";
    if (!wanted && value !== false && value !== "false" && value !== "off") {
      throw new BridgeError("invalid_arguments", `Ref ${ref} is a checkbox or switch: pass true or false.`);
    }
    if (field.checked !== wanted) await clickRef(tabId, ref);
    return wanted ? "checked" : "unchecked";
  }
  if (typeof value !== "string") throw new BridgeError("invalid_arguments", `Ref ${ref} takes text: pass a string.`);
  if (field.kind === "select") return chooseOption(tabId, ref, value);
  if (field.kind === "text") return (await typeInto(tabId, ref, value, true)).value;
  throw new BridgeError("not_editable", `Ref ${ref} is not a form field. Click it with browser_click instead.`);
}

/** The page object of the file input to fill: an intercepted picker's, or the one fileInputFor finds. */
async function fileInputObject(tabId: number, ref: string | null): Promise<string> {
  const chooser = fileChoosers.get(tabId);
  if (ref === null && chooser !== undefined) {
    const node = await cdp<{ object: RemoteResult }>(tabId, "DOM.resolveNode", { backendNodeId: chooser.backendNodeId }).catch(() => null);
    if (node?.object.objectId !== undefined) return node.object.objectId;
  }
  const input = await evaluateHandle(tabId, fileInputFor, ref);
  if (input.objectId !== undefined) return input.objectId;
  if (input.value === "stale" && ref !== null) throw staleRef(ref);
  throw new BridgeError(
    "no_file_input",
    input.value === "several"
      ? `${ref === null ? "The page" : `Ref ${ref}`} has several file inputs. Pass the ref of the one you want: browser_read lists them as file lines, hidden ones too.`
      : `${ref === null ? "The page has no file input" : `There is no file input at or around ref ${ref}`}. Open the page's upload step or dialog first (clicking its upload button is fine: no picker opens), then call browser_upload again.`,
  );
}

const SCREENSHOT_WIDTH = 1_280;

/** Scales a JPEG down to SCREENSHOT_WIDTH: a Retina capture is twice the size and says no more. */
async function fitWidth(data: string): Promise<string> {
  try {
    const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
    if (bitmap.width <= SCREENSHOT_WIDTH) {
      bitmap.close();
      return data;
    }
    const height = Math.round((bitmap.height * SCREENSHOT_WIDTH) / bitmap.width);
    const canvas = new OffscreenCanvas(SCREENSHOT_WIDTH, height);
    const context = canvas.getContext("2d");
    if (context === null) return data;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, SCREENSHOT_WIDTH, height);
    bitmap.close();
    const scaled = new Uint8Array(await (await canvas.convertToBlob({ type: "image/jpeg", quality: 0.75 })).arrayBuffer());
    let binary = "";
    for (let index = 0; index < scaled.length; index += 0x8000) binary += String.fromCharCode(...scaled.subarray(index, index + 0x8000));
    return btoa(binary);
  } catch {
    return data;
  }
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

function scopeParam(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string" && (value === "main" || value === "dialog" || /^e\d+$/.test(value))) return value;
  throw new BridgeError("invalid_arguments", 'scope must be "main", "dialog", or a ref such as e12.');
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
      const tabId = await allowedTab(params.tab_id, method);
      const options = {
        query: typeof params.query === "string" && params.query !== "" ? params.query : null,
        offset: typeof params.offset === "number" ? params.offset : 0,
        maxChars: typeof params.max_chars === "number" ? Math.min(Math.max(params.max_chars, 1_000), 60_000) : 15_000,
        scope: scopeParam(params.scope),
      };
      await waitForLoad(tabId);
      const waitFor = waitForParam(params);
      const waited = waitFor !== null ? await waitForText(tabId, waitFor) : undefined;
      let result = await snapshot(tabId, options);
      if (result.empty && waited === undefined) {
        // A page that is still drawing: give it a moment before saying it is empty.
        await sleep(1_000);
        await waitForLoad(tabId);
        result = await snapshot(tabId, options);
      }
      return { ...result, ...(waited !== undefined ? { wait_for: waited } : {}) };
    }
    case "click": {
      const tabId = await allowedTab(params.tab_id, method);
      const ref = stringParam(params, "ref");
      return act(tabId, [ref], params, async (start) => {
        if (/^\[e\d+\] file /.test(start.targets[0] ?? "")) {
          throw new BridgeError("invalid_arguments", `Ref ${ref} is a file input, and clicking it would open the file picker. Call browser_upload with its ref and the file paths.`);
        }
        return clickRef(tabId, ref);
      });
    }
    case "hover": {
      const tabId = await allowedTab(params.tab_id, method);
      const ref = stringParam(params, "ref");
      return act(tabId, [ref], params, async () => {
        const spot = await located(tabId, ref, "hovered");
        await showCursor(tabId, spot, false);
        await cdp(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x: spot.x, y: spot.y }, INPUT_TIMEOUT_MS);
        return {};
      });
    }
    case "type": {
      const tabId = await allowedTab(params.tab_id, method);
      const ref = stringParam(params, "ref");
      const text = typeof params.text === "string" ? params.text : "";
      return act(tabId, [ref], params, async () => {
        const typed = await typeInto(tabId, ref, text, params.replace === true);
        if (params.submit === true) await pressKey(tabId, "Enter");
        return typed;
      });
    }
    case "select": {
      const tabId = await allowedTab(params.tab_id, method);
      const ref = stringParam(params, "ref");
      const option = stringParam(params, "option");
      return act(tabId, [ref], params, async () => ({ chosen: await chooseOption(tabId, ref, option) }));
    }
    case "fill": {
      const tabId = await allowedTab(params.tab_id, method);
      const fields: unknown = params.fields;
      if (
        !Array.isArray(fields) ||
        fields.length === 0 ||
        !fields.every((field) => typeof field?.ref === "string" && field.ref !== "" && (typeof field.value === "string" || typeof field.value === "boolean"))
      ) {
        throw new BridgeError("invalid_arguments", "fields must list one or more {ref, value} entries; value is text, or true or false for a checkbox.");
      }
      const entries = fields as Array<{ ref: string; value: string | boolean }>;
      return act(
        tabId,
        entries.map((field) => field.ref),
        params,
        async () => {
          const filled: Array<{ ref: string; value: string }> = [];
          for (const field of entries) {
            try {
              filled.push({ ref: field.ref, value: await fillField(tabId, field.ref, field.value) });
            } catch (error) {
              if (!(error instanceof BridgeError) || error instanceof DialogOpened || filled.length === 0) throw error;
              throw new BridgeError(error.code, `Filled ${filled.map((entry) => entry.ref).join(", ")}; then ${field.ref} failed: ${error.message}`);
            }
          }
          return { fields: filled };
        },
      );
    }
    case "key": {
      const tabId = await allowedTab(params.tab_id, method);
      const key = stringParam(params, "key");
      return act(tabId, [], params, async () => {
        await pressKey(tabId, key);
        return {};
      });
    }
    case "scroll": {
      const tabId = await allowedTab(params.tab_id, method);
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
      const tabId = await allowedTab(params.tab_id, method);
      const target = stringParam(params, "url");
      const url = target === "back" || target === "forward" || target === "reload" ? null : webUrl(target);
      return act(tabId, [], params, async () => {
        if (target === "back" || target === "forward") {
          await (target === "back" ? chrome.tabs.goBack(tabId) : chrome.tabs.goForward(tabId)).catch(() => {
            throw new BridgeError("no_history", `There is no page to go ${target} to.`);
          });
        } else if (url === null) {
          await chrome.tabs.reload(tabId);
        } else {
          await chrome.tabs.update(tabId, { url });
        }
        return {};
      });
    }
    case "screenshot": {
      const tabId = await allowedTab(params.tab_id, method);
      await attach(tabId);
      // The picture is for the agent: leave its own cursor out.
      const cursor = (await readSettings()).cursor;
      if (cursor) await evaluate(tabId, hideCursor, true).catch(() => undefined);
      try {
        const shot = await cdp<{ data: string }>(
          tabId,
          "Page.captureScreenshot",
          { format: "jpeg", quality: 80, captureBeyondViewport: false },
          SCREENSHOT_TIMEOUT_MS,
        );
        return { data: await fitWidth(shot.data), mime_type: "image/jpeg" };
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
      const tabId = await allowedTab(params.tab_id, method);
      await chrome.tabs.remove(tabId);
      return { closed: tabId };
    }
    case "upload": {
      const tabId = await allowedTab(params.tab_id, method);
      const paths: unknown = params.paths;
      if (!Array.isArray(paths) || paths.length === 0 || !paths.every((path) => typeof path === "string" && path !== "")) {
        throw new BridgeError("invalid_arguments", "paths must list one or more absolute file paths.");
      }
      if (!(await chrome.extension.isAllowedFileSchemeAccess())) throw noFileAccess();
      const ref = typeof params.ref === "string" && params.ref !== "" ? params.ref : null;
      return act(tabId, ref === null ? [] : [ref], params, async () => {
        const objectId = await fileInputObject(tabId, ref);
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
          fileChoosers.delete(tabId);
          return { files: (await callOn<FileInputState>(tabId, objectId, fileInputState)).files };
        } finally {
          await cdp(tabId, "Runtime.releaseObject", { objectId }).catch(() => undefined);
        }
      });
    }
    case "dialog": {
      const tabId = await allowedTab(params.tab_id, method);
      const dialog = dialogs.get(tabId);
      if (dialog === undefined) throw new BridgeError("no_dialog", "The tab shows no dialog now; it may have been answered already. Read the page.");
      const start: ActionStart = { before: beforeDialog.get(tabId) ?? null, targets: [], ...(await frontTab(tabId)) };
      beforeDialog.delete(tabId);
      return runAction(tabId, start, null, async () => {
        await cdp(tabId, "Page.handleJavaScriptDialog", {
          accept: params.accept === true,
          ...(typeof params.text === "string" ? { promptText: params.text } : {}),
        });
        // The closed event usually says so first; a dialog the answer led to is a new one.
        if (dialogs.get(tabId) === dialog) dialogs.delete(tabId);
        return { answered: { type: dialog.type, accepted: params.accept === true } };
      });
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
