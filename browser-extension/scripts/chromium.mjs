// Shared by the scripts that render a page with a headless Chromium shell.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The Chromium binary from the first argument, or exits with the script's usage line. */
export function chromiumArg(usage) {
  const chromium = process.argv[2];
  if (chromium === undefined) {
    console.error(`usage: ${usage}`);
    process.exit(1);
  }
  return chromium;
}

/** Runs body with a fresh work directory, which is removed afterwards. */
export function withWorkDir(prefix, body) {
  const work = mkdtempSync(join(tmpdir(), prefix));
  try {
    return body(work);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Saves a PNG of url rendered at width x height with a throwaway profile in work. */
export function screenshot(chromium, { work, url, output, width, height, extraArgs = [] }) {
  execFileSync(
    chromium,
    [
      "--use-mock-keychain",
      "--no-first-run",
      "--disable-gpu",
      "--hide-scrollbars",
      ...extraArgs,
      `--user-data-dir=${join(work, "profile")}`,
      `--window-size=${width},${height}`,
      "--force-device-scale-factor=1",
      `--screenshot=${output}`,
      url,
    ],
    { stdio: "ignore" },
  );
}
