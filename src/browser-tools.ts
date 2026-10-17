import { z } from "zod";
import type { ToolLabels } from "./catalog.js";
import type { BrowserCallResult, ToolCallResult } from "./contract.js";
// Types only: the extension's shared module is bundled into the extension, not the plugin server.
import type { BridgeParams, BridgeToolMethod, HostErrorCode } from "../browser-extension/src/shared.js";

/**
 * Agent tools backed by the optional Browser Bridge for bb extension. Each one
 * maps to a method the extension's service worker dispatches.
 */
export interface BrowserTool {
  name: string;
  method: BridgeToolMethod;
  description: string;
  parameters: z.ZodObject<z.ZodRawShape>;
  labels: ToolLabels;
}

const browser = z
  .string()
  .min(1)
  .optional()
  .describe("Which connected browser (Brave, Chrome, Edge, Chromium) when more than one has the extension");
const tabId = z.number().int().describe("Tab id from browser_tabs or browser_open");
const ref = z.string().min(1).describe("Element ref such as e12 from the latest browser_read of this tab");

// Each `satisfies` checks the schema against the params the extension takes for its method.
export const BROWSER_TOOLS: readonly BrowserTool[] = [
  {
    name: "browser_tabs",
    method: "tabs",
    description:
      "List the open tabs of the user's own browser with tab ids, titles and URLs, and whether agents are paused.",
    parameters: z.object({ browser }) satisfies z.ZodType<BridgeParams["tabs"]>,
    labels: { pending: "Listing browser tabs", completed: "Listed browser tabs" },
  },
  {
    name: "browser_open",
    method: "open",
    description:
      "Open a URL in a new background tab of the user's browser, in its purple Agent tab group. The user's own tab stays in front. Returns its tab_id.",
    parameters: z.object({ url: z.string().min(1).describe("http(s) URL, or about:blank"), browser }) satisfies z.ZodType<BridgeParams["open"]>,
    labels: { pending: "Opening a tab", completed: "Opened a tab" },
  },
  {
    name: "browser_read",
    method: "read",
    description:
      "Read a tab as a text outline: headings, text, and interactive elements as `[eN] role \"name\"` lines whose refs the other browser_* tools take. Refs expire when the page changes; read again after navigation. Use query to keep only matching lines, and offset for the next page of a long outline.",
    parameters: z.object({
      tab_id: tabId,
      query: z.string().optional().describe("Only lines containing this text (case-insensitive)"),
      offset: z.number().int().min(0).optional().describe("Character offset from a previous read's next offset"),
      max_chars: z.number().int().min(1_000).max(60_000).optional().describe("Default 15000"),
      browser,
    }) satisfies z.ZodType<BridgeParams["read"]>,
    labels: { pending: "Reading the page", completed: "Read the page" },
  },
  {
    name: "browser_click",
    method: "click",
    description: "Click an element of a tab by ref. Works while the tab is in the background; returns the page's URL and title afterwards.",
    parameters: z.object({ tab_id: tabId, ref, browser }) satisfies z.ZodType<BridgeParams["click"]>,
    labels: { pending: "Clicking in the browser", completed: "Clicked in the browser" },
  },
  {
    name: "browser_type",
    method: "type",
    description:
      "Type text into a text field of a tab by ref. replace clears the field first; submit presses Enter afterwards. Password values are never echoed back.",
    parameters: z.object({
      tab_id: tabId,
      ref,
      text: z.string(),
      replace: z.boolean().optional(),
      submit: z.boolean().optional(),
      browser,
    }) satisfies z.ZodType<BridgeParams["type"]>,
    labels: { pending: "Typing in the browser", completed: "Typed in the browser" },
  },
  {
    name: "browser_select",
    method: "select",
    description: "Choose an option of a <select> in a tab by ref, matching the option's label or value.",
    parameters: z.object({ tab_id: tabId, ref, option: z.string().min(1), browser }) satisfies z.ZodType<BridgeParams["select"]>,
    labels: { pending: "Choosing an option", completed: "Chose an option" },
  },
  {
    name: "browser_key",
    method: "key",
    description: "Press a key or combination in a tab, such as Enter, Escape, Tab, ArrowDown, or Meta+A.",
    parameters: z.object({ tab_id: tabId, key: z.string().min(1), browser }) satisfies z.ZodType<BridgeParams["key"]>,
    labels: { pending: "Pressing a key", completed: "Pressed a key" },
  },
  {
    name: "browser_scroll",
    method: "scroll",
    description:
      "Scroll a tab up or down by a share of the viewport (amount, default 0.8), or scroll an element into view by ref.",
    parameters: z.object({
      tab_id: tabId,
      direction: z.enum(["up", "down"]).optional(),
      amount: z.number().min(0.1).max(10).optional(),
      ref: ref.optional(),
      browser,
    }) satisfies z.ZodType<BridgeParams["scroll"]>,
    labels: { pending: "Scrolling the page", completed: "Scrolled the page" },
  },
  {
    name: "browser_navigate",
    method: "navigate",
    description: "Load a URL in a tab, or pass back, forward, or reload.",
    parameters: z.object({
      tab_id: tabId,
      url: z.string().min(1).describe("http(s) URL, about:blank, back, forward, or reload"),
      browser,
    }) satisfies z.ZodType<BridgeParams["navigate"]>,
    labels: { pending: "Navigating the page", completed: "Navigated the page" },
  },
  {
    name: "browser_screenshot",
    method: "screenshot",
    description:
      "Take a JPEG of a tab's viewport. A tab in the background may not be drawn; then read it with browser_read instead.",
    parameters: z.object({ tab_id: tabId, browser }) satisfies z.ZodType<BridgeParams["screenshot"]>,
    labels: { pending: "Taking a screenshot", completed: "Took a screenshot" },
  },
  {
    name: "browser_upload",
    method: "upload",
    description:
      "Attach files from this machine to a file input in a tab, as choosing them in the file picker would; no picker opens and nothing needs dragging. ref is the input's `file` line from browser_read (hidden inputs behind dropzones are listed too) or the dropzone or button around it; without ref the page's only file input is used. Returns the file names the input now holds.",
    parameters: z.object({
      tab_id: tabId,
      ref: ref.optional(),
      paths: z.array(z.string().min(1)).min(1).describe("Absolute paths of the files on the machine the browser runs on"),
      browser,
    }) satisfies z.ZodType<BridgeParams["upload"]>,
    labels: { pending: "Attaching files", completed: "Attached files" },
  },
  {
    name: "browser_close",
    method: "close",
    description: "Close a tab, for example one this agent opened and no longer needs.",
    parameters: z.object({ tab_id: tabId, browser }) satisfies z.ZodType<BridgeParams["close"]>,
    labels: { pending: "Closing a tab", completed: "Closed a tab" },
  },
];

export const BROWSER_TOOL_NAMES: readonly string[] = BROWSER_TOOLS.map((tool) => tool.name);

/** Codes that mean the user has setup to do, not the agent. */
const SETUP_CODES = new Set<string>(["unsupported", "not_installed", "not_connected"] satisfies HostErrorCode[]);

function text(value: string, isError = false): ToolCallResult {
  return { content: [{ type: "text", text: value }], isError };
}

/** What the user has to do for a setup code, pointing at the card that does it. */
function setupStep(code: string, settingsPath: string): string {
  const settings = `[Desktop & Browser Agent settings](${settingsPath})`;
  if (code === "not_installed") {
    return `Ask the user to press **Install bridge** for this machine in the **Browser extension** card of ${settings}.`;
  }
  if (code === "not_connected") {
    return `Ask the user to open a browser with the Browser Bridge for bb extension, or to check the **Browser extension** card of ${settings}.`;
  }
  return `Tell the user that the browser extension is not available on this system (see the **Browser extension** card of ${settings}).`;
}

/** Turns the extension's answer into what the agent sees. */
export function browserToolResult(tool: BrowserTool, reply: BrowserCallResult, settingsPath: string): ToolCallResult {
  if (!reply.ok) {
    if (SETUP_CODES.has(reply.code)) {
      return text(`${reply.message}\n\n${setupStep(reply.code, settingsPath)} Do not work around it with other browser tools unless the user says so.`, true);
    }
    if (reply.code === "unknown_method") {
      return text(
        `${tool.name} needs a newer Browser Bridge for bb than the one in this browser. Ask the user to update it: **Update** on the browser's extensions page (with Developer mode on) for a Web Store install, or \`npm run build:extension\` and **Reload** for an unpacked build.`,
        true,
      );
    }
    return text(`${tool.name} failed (${reply.code}): ${reply.message}`, true);
  }
  const result = reply.result as Record<string, unknown> | null;
  if (tool.method === "read" && result !== null && typeof result.text === "string") {
    const next = typeof result.nextOffset === "number" ? `\n\n(More: call browser_read with offset ${result.nextOffset}.)` : "";
    return text(`${result.text}${next}`);
  }
  if (tool.method === "screenshot" && result !== null && typeof result.data === "string") {
    return {
      content: [{ type: "image", data: result.data, mimeType: typeof result.mime_type === "string" ? result.mime_type : "image/jpeg" }],
      isError: false,
    };
  }
  return text(JSON.stringify(result ?? null));
}
