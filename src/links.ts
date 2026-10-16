/**
 * URLs, ids and commands that the server, the host and the settings app all
 * show. Pure data: the app bundles this file too.
 */

export const CUA_DOCS_URL = "https://cua.ai/docs";
export const CUA_INSTALL_DOCS_URL = "https://cua.ai/docs/how-to-guides/driver/install";

/** The newest release, through the official one-line installer; pinned installs come from the release itself. */
export const INSTALL_SCRIPT_URLS = {
  posix: "https://cua.ai/driver/install.sh",
  windows: "https://cua.ai/driver/install.ps1",
} as const;

/** One-line manual installs of a given driver version. */
export function manualInstallCommands(version: string): { posix: string; windows: string } {
  return {
    posix: `CUA_DRIVER_RS_VERSION=${version} /bin/bash -c "$(curl -fsSL ${INSTALL_SCRIPT_URLS.posix})"`,
    windows: `$env:CUA_DRIVER_RS_VERSION="${version}"; irm ${INSTALL_SCRIPT_URLS.windows} | iex`,
  };
}

/**
 * Extension ids the browser bridge accepts: the unpacked build (fixed by the
 * manifest's "key") first, then the Chrome Web Store item.
 */
export const EXTENSION_IDS = ["apeidchlabamkkpmahikoiingkhdcagf", "aaidacbpcgjigclcoffjlcpnkmpnpgcc"] as const;
export const UNPACKED_EXTENSION_ID = EXTENSION_IDS[0];
export const STORE_EXTENSION_ID = EXTENSION_IDS[1];
export const EXTENSION_STORE_URL = `https://chromewebstore.google.com/detail/${STORE_EXTENSION_ID}`;
