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
  read: { tab_id: number; query?: string; offset?: number; max_chars?: number };
  click: { tab_id: number; ref: string };
  type: { tab_id: number; ref: string; text: string; replace?: boolean; submit?: boolean };
  select: { tab_id: number; ref: string; option: string };
  key: { tab_id: number; key: string };
  scroll: { tab_id: number; direction?: "up" | "down"; amount?: number; ref?: string };
  navigate: { tab_id: number; url: string };
  screenshot: { tab_id: number };
  close: { tab_id: number };
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
  | "page_error";

/** Codes the plugin's host raises itself (src/browser-host.ts), before or instead of the extension. */
export type HostErrorCode =
  | "unsupported"
  | "not_installed"
  | "not_connected"
  | "no_such_browser"
  | "several_browsers"
  | "bridge_failed";
