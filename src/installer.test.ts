import { describe, expect, it } from "vitest";
import { TESTED_INSTALLER, installerFiles, sha256Hex } from "./installer.js";
import { TESTED_DRIVER_VERSION } from "./snapshot.js";

describe("installer checksums", () => {
  it("are recorded for the same driver version as the tool snapshot", () => {
    expect(TESTED_INSTALLER.driverVersion).toBe(TESTED_DRIVER_VERSION);
    for (const [name, sha256] of Object.entries(TESTED_INSTALLER.sha256)) expect(sha256, name).toMatch(/^[0-9a-f]{64}$/);
  });

  it("cover every file each platform's installer loads", () => {
    expect(installerFiles("posix", TESTED_DRIVER_VERSION)?.map((file) => file.name)).toEqual([
      "install.sh",
      "_install-rust.sh",
      "_install-common.sh",
    ]);
    expect(installerFiles("windows", TESTED_DRIVER_VERSION)?.map((file) => file.url)).toEqual([
      `https://github.com/trycua/cua/releases/download/cua-driver-rs-v${TESTED_DRIVER_VERSION}/install.ps1`,
      `https://raw.githubusercontent.com/trycua/cua/cua-driver-rs-v${TESTED_DRIVER_VERSION}/libs/cua-driver/scripts/_install-common.psm1`,
    ]);
  });

  it("has nothing for another version, or a record missing a file", () => {
    expect(installerFiles("posix", "0.0.1")).toBeNull();
    expect(installerFiles("windows", "1.0.0", { driverVersion: "1.0.0", sha256: { "install.ps1": "a".repeat(64) } })).toBeNull();
  });

  // CUA_NETWORK=1: downloads the real files, as the host does before a pinned install.
  it.runIf(process.env.CUA_NETWORK === "1")("match what the tested release serves today", async () => {
    for (const platform of ["posix", "windows"] as const) {
      for (const file of installerFiles(platform, TESTED_DRIVER_VERSION) ?? []) {
        const response = await fetch(file.url, { redirect: "follow" });
        expect(response.status, file.url).toBe(200);
        expect(sha256Hex(new Uint8Array(await response.arrayBuffer())), file.name).toBe(file.sha256);
      }
    }
  }, 60_000);
});
