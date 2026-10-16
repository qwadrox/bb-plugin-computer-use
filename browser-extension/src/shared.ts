/** Native messaging host name; the plugin writes a manifest under this name for each browser. */
export const NATIVE_HOST = "dev.qwadrox.agent_browser_bridge";

/** Agents may use tabs in a tab group with this title, and tabs they opened themselves. */
export const GROUP_TITLE = "Agent";

export type Scope = "shared" | "all";

export interface StoredSettings {
  scope: Scope;
  paused: boolean;
}

export const DEFAULT_SETTINGS: StoredSettings = { scope: "shared", paused: false };

export interface BridgeStatus {
  connected: boolean;
  error: string | null;
  browser: string;
  settings: StoredSettings;
  activeTab: { id: number; title: string; shared: boolean } | null;
}

export type PopupRequest =
  | { type: "status" }
  | { type: "share"; tabId: number }
  | { type: "unshare"; tabId: number }
  | { type: "scope"; scope: Scope }
  | { type: "resume" }
  | { type: "reconnect" };
