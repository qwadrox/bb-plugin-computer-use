// Renders static/icons/icon.svg to the PNG sizes the manifest lists, with a
// headless Chromium shell. Run after editing the SVG:
// node scripts/render-icons.mjs <path to chrome-headless-shell>
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const chromium = process.argv[2];
if (chromium === undefined) {
  console.error("usage: node scripts/render-icons.mjs <path to a Chromium or Chrome binary>");
  process.exit(1);
}
const icons = fileURLToPath(new URL("../static/icons/", import.meta.url));
const svg = readFileSync(join(icons, "icon.svg"), "utf8");
const work = mkdtempSync(join(tmpdir(), "icons-"));
try {
  for (const size of [16, 32, 48, 128]) {
    const page = join(work, `icon-${size}.html`);
    writeFileSync(
      page,
      `<html><body style="margin:0;background:transparent"><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}" width="${size}" height="${size}" style="display:block"></body></html>`,
    );
    execFileSync(chromium, [
      "--use-mock-keychain",
      "--no-first-run",
      "--disable-gpu",
      "--hide-scrollbars",
      "--default-background-color=00000000",
      `--user-data-dir=${join(work, "profile")}`,
      `--window-size=${size},${size}`,
      "--force-device-scale-factor=1",
      `--screenshot=${join(icons, `icon-${size}.png`)}`,
      `file://${page}`,
    ], { stdio: "ignore" });
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
