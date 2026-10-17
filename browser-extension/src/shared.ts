/** Native messaging host name; the plugin writes a manifest under this name for each browser. */
export const NATIVE_HOST = "dev.qwadrox.agent_browser_bridge";

/** Tabs agents open go into a tab group with this title, so the user can tell them apart. */
export const GROUP_TITLE = "Agent";

export interface StoredSettings {
  paused: boolean;
  /** Show the agent's purple cursor on pages it clicks or types in. On unless the user turns it off. */
  cursor: boolean;
}

export interface BridgeStatus {
  connected: boolean;
  error: string | null;
  browser: string;
  settings: StoredSettings;
}

export type PopupRequest =
  | { type: "status" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "reconnect" }
  | { type: "cursor"; enabled: boolean };

// The bridge wire protocol. The plugin's browser-tools.ts imports these types, and
// names and fields must stay compatible with the published extension.

/**
 * What each method takes. The plugin's browser_* tools send their arguments
 * as they are, except `browser`, which the host uses to pick a browser.
 */
export interface BridgeParams {
  status: {};
  tabs: {};
  open: { url: string };
  /** `scope` is "main", "dialog" or a ref; `wait_for` waits up to 10 s for text to appear first. */
  read: { tab_id: number; query?: string; offset?: number; max_chars?: number; scope?: string; wait_for?: string };
  click: { tab_id: number; ref: string; wait_for?: string };
  hover: { tab_id: number; ref: string; wait_for?: string };
  type: { tab_id: number; ref: string; text: string; replace?: boolean; submit?: boolean; wait_for?: string };
  select: { tab_id: number; ref: string; option: string; wait_for?: string };
  /** Each field is typed into (replacing), chosen in, or ticked (true) or cleared (false). */
  fill: { tab_id: number; fields: Array<{ ref: string; value: string | boolean }>; wait_for?: string };
  key: { tab_id: number; key: string; wait_for?: string };
  scroll: { tab_id: number; direction?: "up" | "down"; amount?: number; ref?: string };
  navigate: { tab_id: number; url: string; wait_for?: string };
  screenshot: { tab_id: number };
  close: { tab_id: number };
  /** Absolute paths on the browser's machine; `ref` is a file input, or an element around one. */
  upload: { tab_id: number; ref?: string; paths: string[]; wait_for?: string };
  /** Answers the alert, confirm or prompt a tab is showing; `text` is a prompt's answer. */
  dialog: { tab_id: number; accept: boolean; text?: string };
}

/** A JavaScript dialog (alert, confirm, prompt, beforeunload) a tab is showing. */
export interface PageDialog {
  type: string;
  message: string;
  default_prompt: string;
}

/** How an action changed the tab's outline, compared line by line. */
export interface PageChanges {
  added: string[];
  removed: string[];
  /** Set instead of the lists when most of the page changed: the start of its new outline. */
  outline?: string;
  /** Some lines or the outline were left out. */
  truncated?: boolean;
}

export interface TabInfo {
  tab_id: number;
  title: string;
  url: string;
}

/** What every action answers, besides its own fields (route, value, chosen, files…). */
export interface ActionResult {
  /** The ref's outline line before the action, so the agent sees what it acted on. */
  target?: string;
  url: string;
  title: string;
  /** Missing when the page could not be read afterwards. */
  changes?: PageChanges;
  /** The action opened a dialog; it waits for browser_dialog, and nothing else in the tab runs until then. */
  dialog?: PageDialog;
  /** Tabs the action opened, such as a link with target=_blank. They stay in the background. */
  opened_tabs?: TabInfo[];
  wait_for?: { text: string; found: boolean };
  /** The action opened a file picker; the extension held it back, and browser_upload without ref fills it. */
  file_chooser?: { multiple: boolean };
}

/** Every method the extension answers. */
export type BridgeMethod = keyof BridgeParams;

/** The methods the browser_* agent tools call. `status` is for checks outside the agent tools. */
export type BridgeToolMethod = Exclude<BridgeMethod, "status">;

/** A request as the extension's service worker receives it. */
export type BridgeRequest = { [M in BridgeMethod]: { method: M; params: BridgeParams[M] } }[BridgeMethod];

/** Codes the extension answers a failed call with. */
export type BridgeErrorCode =
  | "failed"
  | "paused"
  | "invalid_arguments"
  | "unknown_method"
  | "tab_closed"
  | "timeout"
  | "busy"
  | "attach_failed"
  | "stale_ref"
  | "not_editable"
  | "no_such_option"
  | "no_history"
  | "not_rendered"
  | "page_error"
  | "no_file_input"
  | "no_file_access"
  | "dialog_open"
  | "no_dialog"
  | "not_visible"
  | "blocked_by_extension"
  | "restricted_page";

/** Codes the plugin's host raises itself (src/browser-host.ts), before or instead of the extension. */
export type HostErrorCode =
  | "unsupported"
  | "not_installed"
  | "not_connected"
  | "no_such_browser"
  | "several_browsers"
  | "bridge_failed"
  | "no_such_file";
