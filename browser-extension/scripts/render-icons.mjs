// Renders static/icons/icon.svg to the PNG sizes the manifest lists, with a
// headless Chromium shell. Run after editing the SVG:
// node scripts/render-icons.mjs <path to chrome-headless-shell>
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromiumArg, screenshot, withWorkDir } from "./chromium.mjs";

const chromium = chromiumArg("node scripts/render-icons.mjs <path to a Chromium or Chrome binary>");
const icons = fileURLToPath(new URL("../static/icons/", import.meta.url));
const svg = readFileSync(join(icons, "icon.svg"), "utf8");
withWorkDir("icons-", (work) => {
  for (const size of [16, 32, 48, 128]) {
    const page = join(work, `icon-${size}.html`);
    writeFileSync(
      page,
      `<html><body style="margin:0;background:transparent"><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}" width="${size}" height="${size}" style="display:block"></body></html>`,
    );
    screenshot(chromium, {
      work,
      url: `file://${page}`,
      output: join(icons, `icon-${size}.png`),
      width: size,
      height: size,
      extraArgs: ["--default-background-color=00000000"],
    });
  }
});
