// Renders store/screenshot.html to the 1280x800 Chrome Web Store screenshot
// with a headless Chromium shell:
// node scripts/render-screenshot.mjs <path to chrome-headless-shell>
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { chromiumArg, screenshot, withWorkDir } from "./chromium.mjs";

const chromium = chromiumArg("node scripts/render-screenshot.mjs <path to a Chromium or Chrome binary>");
const store = fileURLToPath(new URL("../store/", import.meta.url));
withWorkDir("screenshot-", (work) => {
  screenshot(chromium, {
    work,
    url: `file://${join(store, "screenshot.html")}`,
    output: join(store, "screenshot-1280x800.png"),
    width: 1280,
    height: 800,
  });
});
