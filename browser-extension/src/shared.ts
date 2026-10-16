/** Native messaging host name; the plugin writes a manifest under this name for each browser. */
export const NATIVE_HOST = "dev.qwadrox.agent_browser_bridge";

/** Tabs agents open go into a tab group with this title, so the user can tell them apart. */
export const GROUP_TITLE = "Agent";

export interface StoredSettings {
  paused: boolean;
}

export interface BridgeStatus {
  connected: boolean;
  error: string | null;
  browser: string;
  settings: StoredSettings;
}

export type PopupRequest = { type: "status" } | { type: "pause" } | { type: "resume" } | { type: "reconnect" };
