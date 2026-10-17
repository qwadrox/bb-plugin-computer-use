// Renders the Chrome Web Store screenshots (1280x800) from store/*.html
// with a headless Chromium shell:
// node scripts/render-screenshot.mjs <path to chrome-headless-shell>
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { chromiumArg, screenshot, withWorkDir } from "./chromium.mjs";

const chromium = chromiumArg("node scripts/render-screenshot.mjs <path to a Chromium or Chrome binary>");
const store = fileURLToPath(new URL("../store/", import.meta.url));
for (const name of ["screenshot", "screenshot-cursor"]) {
  withWorkDir("screenshot-", (work) => {
    screenshot(chromium, {
      work,
      url: `file://${join(store, `${name}.html`)}`,
      output: join(store, `${name}-1280x800.png`),
      width: 1280,
      height: 800,
    });
  });
}
