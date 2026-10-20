import { z } from "zod";
import type { ToolLabels } from "./catalog.js";
import type { BrowserCallResult, ToolCallResult } from "./contract.js";
// Types only: the extension's shared module is bundled into the extension, not the plugin server.
import type { ActionResult, BridgeParams, BridgeToolMethod, HostErrorCode, TabInfo } from "../browser-extension/src/shared.js";

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
const ref = z.string().min(1).describe("Element ref such as e12 from browser_read or an earlier action's result in this tab");
const waitFor = z
  .string()
  .min(1)
  .optional()
  .describe("Text to wait for (up to 10 s) before reporting, such as a confirmation or the next step's heading");

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
      "Read a tab as a text outline: headings, text, and interactive elements as `[eN] role \"name\"` lines whose refs the other browser_* tools take. A ref stays with its element while the element is on the page and unchanged, across reads and actions. Same-site frames are included. query keeps matching lines (a ref such as e12 gives that element's line); scope reads only the main region, the open dialog, or the part under a ref; offset continues a long outline.",
    parameters: z.object({
      tab_id: tabId,
      query: z.string().optional().describe("Only lines containing this text (case-insensitive), or a ref"),
      scope: z.string().optional().describe('"main", "dialog" (the open modal), or a ref: read only that part'),
      offset: z.number().int().min(0).optional().describe("Character offset from a previous read's next offset"),
      max_chars: z.number().int().min(1_000).max(60_000).optional().describe("Default 15000"),
      wait_for: waitFor,
      browser,
    }) satisfies z.ZodType<BridgeParams["read"]>,
    labels: { pending: "Reading the page", completed: "Read the page" },
  },
  {
    name: "browser_click",
    method: "click",
    description:
      "Click an element of a tab by ref; works while the tab is in the background. Like every browser_* action it answers with what changed in the page outline (or the new page), and any dialog, new tab or file picker the click opened.",
    parameters: z.object({ tab_id: tabId, ref, wait_for: waitFor, browser }) satisfies z.ZodType<BridgeParams["click"]>,
    labels: { pending: "Clicking in the browser", completed: "Clicked in the browser" },
  },
  {
    name: "browser_hover",
    method: "hover",
    description: "Move the pointer onto an element by ref, for menus and tooltips that open on hover.",
    parameters: z.object({ tab_id: tabId, ref, wait_for: waitFor, browser }) satisfies z.ZodType<BridgeParams["hover"]>,
    labels: { pending: "Hovering in the browser", completed: "Hovered in the browser" },
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
      wait_for: waitFor,
      browser,
    }) satisfies z.ZodType<BridgeParams["type"]>,
    labels: { pending: "Typing in the browser", completed: "Typed in the browser" },
  },
  {
    name: "browser_select",
    method: "select",
    description: "Choose an option of a <select> in a tab by ref, matching the option's label or value.",
    parameters: z.object({ tab_id: tabId, ref, option: z.string().min(1), wait_for: waitFor, browser }) satisfies z.ZodType<
      BridgeParams["select"]
    >,
    labels: { pending: "Choosing an option", completed: "Chose an option" },
  },
  {
    name: "browser_fill",
    method: "fill",
    description:
      "Fill several form fields of a tab in one call: text fields are replaced with the value, a <select> chooses the option matching it, and a checkbox or switch takes true or false. It does not submit; click the form's button afterwards.",
    parameters: z.object({
      tab_id: tabId,
      fields: z
        .array(z.object({ ref, value: z.union([z.string(), z.boolean()]) }))
        .min(1)
        .describe("Fields in the order to fill them"),
      wait_for: waitFor,
      browser,
    }) satisfies z.ZodType<BridgeParams["fill"]>,
    labels: { pending: "Filling in a form", completed: "Filled in a form" },
  },
  {
    name: "browser_key",
    method: "key",
    description: "Press a key or combination in a tab, such as Enter, Escape, Tab, ArrowDown, or Meta+A.",
    parameters: z.object({ tab_id: tabId, key: z.string().min(1), wait_for: waitFor, browser }) satisfies z.ZodType<BridgeParams["key"]>,
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
      wait_for: waitFor,
      browser,
    }) satisfies z.ZodType<BridgeParams["navigate"]>,
    labels: { pending: "Navigating the page", completed: "Navigated the page" },
  },
  {
    name: "browser_screenshot",
    method: "screenshot",
    description:
      "Take a JPEG of a tab's viewport at its CSS size (one image pixel per CSS pixel), or pass ref for that element alone at the screen's full resolution, to read small print. A tab in the background may not be drawn; then read it with browser_read instead.",
    parameters: z.object({ tab_id: tabId, ref: ref.optional(), browser }) satisfies z.ZodType<BridgeParams["screenshot"]>,
    labels: { pending: "Taking a screenshot", completed: "Took a screenshot" },
  },
  {
    name: "browser_upload",
    method: "upload",
    description:
      "Attach files from this machine to a file input in a tab, as choosing them in the file picker would; no picker opens and nothing needs dragging. ref is the input's `file` line from browser_read (hidden inputs behind dropzones are listed too) or the dropzone or button around it. Without ref it fills the picker an action just opened, or the page's only file input. Returns the file names the input now holds.",
    parameters: z.object({
      tab_id: tabId,
      ref: ref.optional(),
      paths: z.array(z.string().min(1)).min(1).describe("Absolute paths of the files on the machine the browser runs on"),
      wait_for: waitFor,
      browser,
    }) satisfies z.ZodType<BridgeParams["upload"]>,
    labels: { pending: "Attaching files", completed: "Attached files" },
  },
  {
    name: "browser_dialog",
    method: "dialog",
    description:
      "Answer the alert, confirm or prompt dialog a tab shows (an action's result says when one opened; nothing in the tab runs until it is answered). accept false is Cancel; text is a prompt's answer.",
    parameters: z.object({
      tab_id: tabId,
      accept: z.boolean(),
      text: z.string().optional().describe("The answer to a prompt dialog"),
      browser,
    }) satisfies z.ZodType<BridgeParams["dialog"]>,
    labels: { pending: "Answering a dialog", completed: "Answered a dialog" },
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
  if (tool.method === "screenshot" && result !== null && typeof result.data === "string") {
    return {
      content: [{ type: "image", data: result.data, mimeType: typeof result.mime_type === "string" ? result.mime_type : "image/jpeg" }],
      isError: false,
    };
  }
  return text(formatResult(tool, result ?? {}));
}

function quote(value: unknown): string {
  return JSON.stringify(typeof value === "string" ? value : String(value));
}

function tabLine(tab: TabInfo): string {
  return `tab ${tab.tab_id}: ${tab.title === "" ? "(untitled)" : tab.title} — ${tab.url}`;
}

/** The agent reads results as text: what was done, what it changed, and what to do about a dialog or a new tab. */
export function formatResult(tool: BrowserTool, result: Record<string, unknown>): string {
  switch (tool.method) {
    case "read": {
      const lines: string[] = [];
      const waited = result.wait_for as ActionResult["wait_for"];
      if (waited !== undefined && !waited.found) lines.push(`(${quote(waited.text)} did not appear within 10 s; this is the page as it is.)`, "");
      lines.push(typeof result.text === "string" ? result.text : "");
      if (typeof result.nextOffset === "number") lines.push("", `(More: call browser_read with offset ${result.nextOffset}.)`);
      return lines.join("\n");
    }
    case "tabs": {
      const tabs = Array.isArray(result.tabs) ? (result.tabs as Array<TabInfo & { active?: boolean; window_id?: number; dialog?: unknown }>) : [];
      const lines = tabs.map(
        (tab) => `- ${tabLine(tab)}${tab.active === true ? " (in front)" : ""}${tab.dialog !== undefined ? " (shows a dialog: answer it with browser_dialog)" : ""}`,
      );
      if (result.paused === true) lines.unshift("The user paused agents in the browser extension: do not act in these tabs until they resume.");
      return lines.length > 0 ? lines.join("\n") : "The browser has no open tabs.";
    }
    case "open":
      return `Opened ${tabLine(result as unknown as TabInfo)}, in the background.`;
    case "close":
      return `Closed tab ${String(result.closed)}.`;
    case "scroll":
      return `Scrolled; the page is now ${String(result.scroll_y)} px from the top. browser_read shows the whole page whatever the scroll, so scroll for lazy-loaded content or a screenshot.`;
    default:
      return formatAction(tool, result as unknown as ActionResult & Record<string, unknown>);
  }
}

const DONE: Partial<Record<BridgeToolMethod, string>> = {
  click: "Clicked",
  hover: "Hovered over",
  type: "Typed into",
  select: "Chose in",
  upload: "Attached files to",
};

function formatAction(tool: BrowserTool, result: ActionResult & Record<string, unknown>): string {
  const lines: string[] = [];
  const done = DONE[tool.method];
  if (done !== undefined && result.target !== undefined) lines.push(`${done} ${result.target}`);
  if (tool.method === "key") lines.push("Pressed the key.");
  if (tool.method === "navigate") lines.push("Navigated.");
  if (result.route === "dom") lines.push("(The tab did not take trusted input, so this went through the page's DOM instead.)");
  if (typeof result.covered_by === "string") lines.push(`Note: ${result.covered_by} covers the element's center; if nothing happened, close what covers it.`);
  if (tool.method === "type" && typeof result.value === "string") lines.push(`The field now holds ${quote(result.value)}.`);
  if (tool.method === "select" && typeof result.chosen === "string") lines.push(`Chose ${quote(result.chosen)}.`);
  if (tool.method === "fill" && Array.isArray(result.fields)) {
    lines.push(`Filled ${(result.fields as Array<{ ref: string; value: string }>).map((field) => `${field.ref} = ${quote(field.value)}`).join(", ")}.`);
  }
  if (tool.method === "upload" && Array.isArray(result.files)) lines.push(`The input holds ${(result.files as string[]).join(", ") || "no files"}.`);
  const answered = result.answered as { type: string; accepted: boolean } | undefined;
  if (answered !== undefined) lines.push(`${answered.accepted ? "Accepted" : "Dismissed"} the ${answered.type} dialog.`);
  if (result.dialog !== undefined) {
    const dialog = result.dialog;
    lines.push(
      `The page opened a ${dialog.type} dialog: ${quote(dialog.message)}${dialog.default_prompt !== "" ? ` (default answer ${quote(dialog.default_prompt)})` : ""}.`,
      `Nothing in the tab runs until it is answered: call browser_dialog with accept true or false${dialog.type === "prompt" ? ", and text for the answer" : ""}.`,
    );
  }
  const chooser = result.file_chooser as { multiple: boolean } | undefined;
  if (chooser !== undefined) {
    lines.push(`It opened a file picker${chooser.multiple ? " for several files" : ""}, which the extension held back: call browser_upload without ref to attach files to it.`);
  }
  for (const tab of result.opened_tabs ?? []) lines.push(`It opened ${tabLine(tab)}, in the background; use its tab_id to read it.`);
  if (result.wait_for !== undefined) {
    lines.push(result.wait_for.found ? `${quote(result.wait_for.text)} appeared.` : `${quote(result.wait_for.text)} did not appear within 10 s.`);
  }
  const changes = result.changes;
  if (changes !== undefined && result.dialog === undefined) {
    if (changes.outline !== undefined) {
      lines.push("", "The page changed; its outline now:", changes.outline);
      if (changes.truncated === true) lines.push("(Cut short: browser_read for the rest.)");
    } else if (changes.added.length + changes.removed.length === 0) {
      if (result.opened_tabs === undefined && chooser === undefined && answered === undefined) {
        lines.push(
          "The page outline did not change. If something should have happened, it may still be loading (pass wait_for), the element may need another action, or check with browser_screenshot.",
        );
      }
    } else {
      lines.push("", "Changes:", ...changes.removed.map((line) => `- ${line}`), ...changes.added.map((line) => `+ ${line}`));
      if (changes.truncated === true) lines.push("(More changed: browser_read for the whole page.)");
    }
  }
  if (typeof result.url === "string" && result.url !== "") lines.push("", `Page: ${typeof result.title === "string" && result.title !== "" ? `${result.title} — ` : ""}${result.url}`);
  return lines.join("\n").trim();
}
