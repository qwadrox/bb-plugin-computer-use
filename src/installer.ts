import { createHash } from "node:crypto";
import installerJson from "./driver-installer.json";

/** The installer files of one driver release, with the sha256 this plugin recorded for each (`npm run sync:tools`). */
export interface InstallerRecord {
  driverVersion: string;
  sha256: Readonly<Record<string, string>>;
}

export interface InstallerFile {
  name: string;
  url: string;
  sha256: string;
}

export const TESTED_INSTALLER: InstallerRecord = installerJson;

export const RELEASE_DOWNLOAD_BASE = "https://github.com/trycua/cua/releases/download";
export const SOURCE_BASE = "https://raw.githubusercontent.com/trycua/cua";

/**
 * The entry script runs first; the others sit beside it so it loads them from
 * disk instead of fetching unpinned copies from cua.ai. The `_install-common`
 * helpers are not release assets, so they come from the release's tag.
 */
export const INSTALLER_LAYOUT = {
  posix: { entry: "install.sh", assets: ["install.sh", "_install-rust.sh"], tagged: ["_install-common.sh"] },
  windows: { entry: "install.ps1", assets: ["install.ps1"], tagged: ["_install-common.psm1"] },
} as const;

export function releaseTag(version: string): string {
  return `cua-driver-rs-v${version}`;
}

function releaseAssetUrl(version: string, name: string): string {
  return `${RELEASE_DOWNLOAD_BASE}/${releaseTag(version)}/${name}`;
}

function taggedSourceUrl(version: string, name: string): string {
  return `${SOURCE_BASE}/${releaseTag(version)}/libs/cua-driver/scripts/${name}`;
}

/** Every file the platform's installer needs, or null when `record` holds no checksums for this version. */
export function installerFiles(
  platform: keyof typeof INSTALLER_LAYOUT,
  version: string,
  record: InstallerRecord = TESTED_INSTALLER,
): InstallerFile[] | null {
  if (record.driverVersion !== version) return null;
  const layout = INSTALLER_LAYOUT[platform];
  const sources = [
    ...layout.assets.map((name) => ({ name, url: releaseAssetUrl(version, name) })),
    ...layout.tagged.map((name) => ({ name, url: taggedSourceUrl(version, name) })),
  ];
  const files: InstallerFile[] = [];
  for (const source of sources) {
    const sha256 = record.sha256[source.name];
    if (sha256 === undefined) return null;
    files.push({ ...source, sha256 });
  }
  return files;
}

export function sha256Hex(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}
