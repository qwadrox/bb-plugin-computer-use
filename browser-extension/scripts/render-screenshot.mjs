// Renders store/screenshot.html to the 1280x800 Chrome Web Store screenshot
// with a headless Chromium shell:
// node scripts/render-screenshot.mjs <path to chrome-headless-shell>
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const chromium = process.argv[2];
if (chromium === undefined) {
  console.error("usage: node scripts/render-screenshot.mjs <path to a Chromium or Chrome binary>");
  process.exit(1);
}
const store = fileURLToPath(new URL("../store/", import.meta.url));
const work = mkdtempSync(join(tmpdir(), "screenshot-"));
try {
  execFileSync(chromium, [
    "--use-mock-keychain",
    "--no-first-run",
    "--disable-gpu",
    "--hide-scrollbars",
    `--user-data-dir=${join(work, "profile")}`,
    "--window-size=1280,800",
    "--force-device-scale-factor=1",
    `--screenshot=${join(store, "screenshot-1280x800.png")}`,
    `file://${join(store, "screenshot.html")}`,
  ], { stdio: "ignore" });
} finally {
  rmSync(work, { recursive: true, force: true });
}
