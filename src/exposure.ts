import type { ToolLabels } from "./catalog.js";
import { isReadOnly, type DriverTool } from "./driver-tools.js";

export const TOOL_GROUPS = ["desktop", "browser", "clipboard"] as const;
export type ToolGroup = (typeof TOOL_GROUPS)[number];

/**
 * How agents reach one Cua Driver tool:
 * - `tool`: a dedicated `cua_<name>` tool in every session.
 * - `call`: only through `cua_call`, so it costs no prompt space until used.
 * - `off`: refused everywhere, `cua_call` included.
 */
export const EXPOSURES = ["tool", "call", "off"] as const;
export type Exposure = (typeof EXPOSURES)[number];

/** Why a tool has its default exposure. */
export type ExposureSource = "reviewed" | "managed" | "unreviewed";

interface Reviewed {
  group: ToolGroup;
  exposure: Exposure | "managed";
  /** Short description for the dedicated tool; the driver's lead paragraph otherwise. */
  summary?: string;
  labels?: ToolLabels;
}

const tool = (summary: string, pending: string, completed: string, group: ToolGroup = "desktop"): Reviewed => ({
  group,
  exposure: "tool",
  summary,
  labels: { pending, completed },
});
const call = (group: ToolGroup = "desktop"): Reviewed => ({ group, exposure: "call" });
const off = (group: ToolGroup = "desktop"): Reviewed => ({ group, exposure: "off" });

/**
 * Every tool of the driver release this plugin was tested with, reviewed by
 * hand. Tools a later driver adds are not here and get the unreviewed default.
 */
export const REVIEWED_TOOLS: Readonly<Record<string, Reviewed>> = {
  // Find and read.
  list_apps: tool("List running and installed desktop apps with pid and bundle id or launch path. Start here to find a target app.", "Listing desktop apps", "Listed desktop apps"),
  list_windows: tool("List top-level windows with window_id, title, bounds, and z_index (higher is frontmost). Filter by pid.", "Listing windows", "Listed windows"),
  get_window_state: tool("Snapshot one window: accessibility tree with element_token per element plus a screenshot. Call before element actions; tokens expire on the next snapshot.", "Reading window state", "Read window state"),
  get_accessibility_tree: tool("Lightweight desktop overview: running apps and on-screen windows with bounds, z-order and owner pid. Cheaper than a screenshot for finding a target window.", "Reading desktop overview", "Read desktop overview"),
  get_desktop_state: tool("Capture the full primary display. Use only for desktop-scope work with no single target window.", "Capturing desktop", "Captured desktop"),
  zoom: tool("Capture a cropped, full-resolution image of a window region for reading small text.", "Zooming into window", "Zoomed into window"),
  verify_state: tool("Verify bounded predicates against one window, for example that an element with a label exists. Returns satisfied, unsatisfied, or unknown; unknown never means success.", "Verifying window state", "Verified window state"),
  // Act.
  run_steps: tool("The default way to act: run one or more action steps (click, type_text, press_key, hotkey, set_value, scroll, drag, ...) in order in ONE call, stop at the first failure, and with `observe` get the window's new state in the same response. For example {pid: 812, window_id: 3, steps: [{tool: \"click\", args: {element_token: \"s1:4\"}}, {tool: \"type_text\", args: {text: \"hello\"}}, {tool: \"press_key\", args: {key: \"Return\"}}], observe: {}}. Steps take optional wait_for/expect checks and may name targets by role and name; cua_describe {tool: \"run_steps\"} has the full format.", "Running steps", "Ran steps"),
  click: tool("Click an element by element_token (preferred) or window-local x,y. Background delivery by default. Check effect and escalation in the result before retrying.", "Clicking", "Clicked"),
  double_click: tool("Double-click an element or window-local coordinates.", "Double-clicking", "Double-clicked"),
  right_click: tool("Right-click an element or window-local coordinates to open a context menu.", "Right-clicking", "Right-clicked"),
  drag: tool("Press, drag, and release between two window-local points.", "Dragging", "Dragged"),
  type_text: tool("Insert text into a focused or targeted element. Element form sets the value through accessibility; x,y form clicks to focus first, which fixes web and Electron inputs.", "Typing text", "Typed text"),
  press_key: tool("Press one key (for example Return, Escape, Tab, a) with optional modifiers, targeted at a pid or element.", "Pressing key", "Pressed key"),
  hotkey: tool("Press a key combination such as [\"cmd\",\"c\"] or [\"ctrl\",\"s\"] against a pid without changing focus.", "Pressing hotkey", "Pressed hotkey"),
  set_value: tool("Set the whole value of a non-text control (popup button, checkbox, slider) through accessibility. Also the reliable commit path for minimized windows.", "Setting value", "Set value"),
  scroll: tool("Scroll an element or window by wheel events or keystrokes; `by` takes line or page.", "Scrolling", "Scrolled"),
  invoke_menu: tool("Invoke a native application menu path such as [\"File\",\"Save\"]. Refuses missing, ambiguous, or disabled items; verify the effect afterwards.", "Invoking menu", "Invoked menu"),
  launch_app: tool("Launch an app in the background without stealing focus. macOS uses bundle_id; Windows and Linux use name or a launch path. Returns pid and windows. Confirm with the user before launching apps they did not ask for.", "Launching app", "Launched app"),
  set_window_frame: tool("Move and resize a window to an exact frame, then read the geometry back.", "Setting window frame", "Set window frame"),
  bring_to_front: tool("Activate an app and leave it in the foreground. Use only when the user asked for a visible window or background delivery was refused.", "Bringing window to front", "Brought window to front"),
  // Browser.
  get_browser_state: tool("Bind a Chrome, Edge, Brave, or Electron window to its page and return a semantic snapshot with refs for cua_browser_click, cua_browser_type and cua_browser_select. Refs expire on the next snapshot.", "Reading browser state", "Read browser state", "browser"),
  browser_prepare: tool("Prepare a DevTools endpoint for a browser. With allow_launch it can start a separate, isolated driver-owned Chromium; attaching to a signed-in profile needs the Signed-in browser profiles plugin setting.", "Preparing the browser", "Prepared the browser", "browser"),
  browser_navigate: tool("Navigate a bound tab to an http, https, or about URL.", "Navigating the browser", "Navigated the browser", "browser"),
  browser_click: tool("Click a page element by ref from cua_get_browser_state or by viewport coordinates.", "Clicking in the browser", "Clicked in the browser", "browser"),
  browser_type: tool("Type into a page element by ref.", "Typing in the browser", "Typed in the browser", "browser"),
  browser_select: tool("Choose one option of a native <select> by ref, by its exact label or value, without opening the popup.", "Choosing in the browser", "Chose in the browser", "browser"),
  browser_pointer: tool("Hover, right-click, double-click, scroll, or drag inside a bound tab.", "Using the pointer in the browser", "Used the pointer in the browser", "browser"),
  browser_dialog: tool("Inspect or resolve a JavaScript alert, confirm, or prompt dialog.", "Handling the browser dialog", "Handled the browser dialog", "browser"),
  browser_download: tool("Trigger one download from a live page ref and save it inside an approved, existing absolute directory. Confirm the destination with the user.", "Downloading in the browser", "Downloaded in the browser", "browser"),
  browser_set_input_files: tool("Attach explicit absolute local files to a live <input type=file> ref. Only upload files the user asked you to upload.", "Attaching files in the browser", "Attached files in the browser", "browser"),
  // Clipboard.
  clipboard_read: tool("List clipboard content types and optionally return the plain text.", "Reading clipboard", "Read clipboard", "clipboard"),
  clipboard_write: tool("Replace the clipboard with text, an image file, or a file reference.", "Writing clipboard", "Wrote clipboard", "clipboard"),
  // Reachable through cua_call: the driver's guide, diagnostics, cursor cosmetics, legacy aliases.
  get_guide: call(),
  get_screen_size: call(),
  get_cursor_position: call(),
  move_cursor: call(),
  parse_visual_regions: call(),
  check_permissions: call(),
  health_report: call(),
  check_for_update: call(),
  get_config: call(),
  get_agent_cursor_state: call(),
  set_agent_cursor_enabled: call(),
  set_agent_cursor_motion: call(),
  set_agent_cursor_theme: call(),
  get_recording_state: call(),
  list_sessions: call(),
  get_session: call(),
  get_session_state: call(),
  escalate_session: call(),
  // Off until the user turns them on: code execution, process control,
  // installs, driver configuration, recordings, the legacy page tool.
  run_script: off(),
  kill_app: off(),
  install_extension: off(),
  install_ffmpeg: off(),
  set_config: off(),
  replay_trajectory: off(),
  start_recording: off(),
  stop_recording: off(),
  page: off("browser"),
  // The plugin owns each thread's session label.
  start_session: { group: "desktop", exposure: "managed" },
  end_session: { group: "desktop", exposure: "managed" },
};

export function isManaged(name: string): boolean {
  return REVIEWED_TOOLS[name]?.exposure === "managed";
}

export function groupOf(name: string): ToolGroup {
  const reviewed = REVIEWED_TOOLS[name];
  if (reviewed !== undefined) return reviewed.group;
  if (name.startsWith("browser_")) return "browser";
  if (name.startsWith("clipboard_")) return "clipboard";
  return "desktop";
}

/**
 * Exposure before any user choice. A tool no one has reviewed is reachable
 * through cua_call when the driver marks it read-only, and off otherwise.
 */
export function defaultExposure(name: string, driverTool: DriverTool | undefined): { exposure: Exposure; source: ExposureSource } {
  const reviewed = REVIEWED_TOOLS[name];
  if (reviewed?.exposure === "managed") return { exposure: "off", source: "managed" };
  if (reviewed !== undefined) return { exposure: reviewed.exposure, source: "reviewed" };
  return { exposure: isReadOnly(driverTool) ? "call" : "off", source: "unreviewed" };
}

export interface ExposureInputs {
  overrides: Readonly<Record<string, Exposure>>;
  enabledGroups: ReadonlySet<ToolGroup>;
}

/** What agents get for one tool after user overrides and group switches. */
export function resolveExposure(name: string, driverTool: DriverTool | undefined, inputs: ExposureInputs): Exposure {
  const fallback = defaultExposure(name, driverTool);
  if (fallback.source === "managed") return "off";
  if (!inputs.enabledGroups.has(groupOf(name))) return "off";
  return inputs.overrides[name] ?? fallback.exposure;
}

export function normalizeOverrides(input: unknown): Record<string, Exposure> {
  if (typeof input !== "object" || input === null) return {};
  const overrides: Record<string, Exposure> = {};
  for (const [name, value] of Object.entries(input)) {
    if (name.length > 0 && !isManaged(name) && EXPOSURES.includes(value as Exposure)) {
      overrides[name] = value as Exposure;
    }
  }
  return overrides;
}

/** True when a browser_prepare call asks to attach to a person's own signed-in profile. */
export function requestsExistingProfile(tool: string, args: Readonly<Record<string, unknown>>): boolean {
  if (tool !== "browser_prepare") return false;
  const strategy = args.strategy;
  return typeof strategy === "object" && strategy !== null && (strategy as { kind?: unknown }).kind === "existing_profile";
}

/**
 * Calls that reach past the target window: clipboard text, the whole screen,
 * local files, code execution. Each reason completes "The agent wants to …".
 */
const SENSITIVE_TOOLS: Readonly<Record<string, string>> = {
  clipboard_write: "replace what is on your clipboard",
  get_desktop_state: "capture your whole screen, every window included",
  browser_set_input_files: "upload files from this machine to a web page",
  browser_download: "save a file from a web page to this machine",
  run_script: "run a script on this machine",
  kill_app: "force-quit an app",
  install_extension: "install a browser extension",
  set_config: "change Cua Driver's configuration",
  start_recording: "record your screen",
  replay_trajectory: "replay recorded actions",
};

export interface SensitiveAction {
  /** What an approval "for this thread" covers. */
  key: string;
  reason: string;
}

/**
 * Why a call needs the user's approval while **Ask before sensitive actions**
 * is on, or null when it does not. Listing clipboard types or preparing an
 * isolated browser asks nothing.
 */
export function sensitiveAction(name: string, args: Readonly<Record<string, unknown>>): SensitiveAction | null {
  if (name === "clipboard_read") {
    return args.include_text === true ? { key: "clipboard_read", reason: "read the text on your clipboard, which may be a copied password" } : null;
  }
  if (requestsExistingProfile(name, args)) {
    return { key: "browser_prepare:existing_profile", reason: "attach to your signed-in browser, with everything you are logged in to" };
  }
  const reason = SENSITIVE_TOOLS[name];
  return reason === undefined ? null : { key: name, reason };
}

/** Tools that may ask first, for the settings list. */
export function mayAskFirst(name: string): boolean {
  return name === "clipboard_read" || name === "browser_prepare" || SENSITIVE_TOOLS[name] !== undefined;
}

export function presentationFor(name: string, driverTool: DriverTool | undefined): {
  description: string;
  labels: ToolLabels;
} {
  const reviewed = REVIEWED_TOOLS[name];
  const words = name.replace(/_/g, " ");
  return {
    description: reviewed?.summary ?? (driverTool?.description || `Cua Driver tool ${name}.`),
    labels: reviewed?.labels ?? { pending: `Running ${words}`, completed: `Ran ${words}` },
  };
}
