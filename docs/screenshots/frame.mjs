// Composes the bb marketplace and README screenshots (1600x1000, at 2x) from settings captures
// in src/ (bb's web UI at 1440x900, 2x): node frame.mjs <chrome-headless-shell>
import { writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { chromiumArg, withWorkDir } from "../../browser-extension/scripts/chromium.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const icon = pathToFileURL(join(here, "../../browser-extension/static/icons/icon-128.png")).href;
// Crop of the settings column, in CSS pixels of the 1440x900 capture.
const shots = [
  { name: "1-overview", src: "s1-config", top: 64, height: 528,
    title: "Desktop and browser control for bb agents",
    lead: "Agents click, type and read windows and web pages on the thread's machine through Cua Driver, in the background." },
  { name: "2-routing", src: "s2-routing", top: 60, height: 637,
    title: "Choose the tools for each provider",
    lead: "Use a provider's own computer use where it has one, or Cua Driver for every agent. Overrides apply per provider." },
  { name: "3-browser-extension", src: "s3-extension", top: 60, height: 350,
    title: "Work in your own browser tabs",
    lead: "With the Browser Bridge for bb extension, agents use the browser you are signed in to, in background tabs. Pause them from the toolbar." },
  { name: "4-agent-tools", src: "s4-tools", top: 60, height: 840,
    title: "Decide what agents are offered",
    lead: "Each Cua Driver tool is dedicated, reachable through cua_call, or off. Tools that run code or change the driver start off." },
  { name: "5-machines", src: "s5-machines", top: 172, height: 400,
    title: "Setup at a glance",
    lead: "Driver version, permissions and service status for every machine that runs your threads, with one-click installs." },
];
// The headline sits above the capture, which is scaled to fill the rest of the frame.
const X = 495, W = 760, AREA_W = 1472, AREA_H = 720;
const page = (s) => {
  const height = Math.min(s.height, 640);
  const scale = Math.min(1.7, AREA_W / W, AREA_H / height);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html, body { width: 1600px; height: 1000px; margin: 0; overflow: hidden; }
body { display: flex; flex-direction: column; align-items: center; gap: 36px; padding: 56px 64px 0; box-sizing: border-box;
  font: 16px/1.5 Inter, system-ui, -apple-system, sans-serif; background: #f5f5f5; color: #333; }
header { display: grid; grid-template-columns: 1fr 1fr; gap: 64px; align-items: end; width: ${AREA_W}px; }
.eyebrow { display: flex; align-items: center; gap: 10px; margin: 0 0 14px; color: #5f4d7e; font-size: 16px; font-weight: 600; }
.eyebrow img { width: 28px; height: 28px; }
h1 { margin: 0; font-size: 48px; line-height: 1.08; letter-spacing: -0.025em; font-weight: 650; color: #181818; text-wrap: balance; }
p.lead { margin: 0 0 4px; font-size: 20px; color: #636363; text-wrap: pretty; }
.shot { position: relative; flex: none; width: ${Math.round(W * scale)}px; height: ${Math.round(height * scale)}px; border: 1px solid #e2e2e2;
  border-radius: 14px; background: url("${pathToFileURL(join(here, "src", `${s.src}.png`)).href}") no-repeat #fff; background-size: ${1440 * scale}px ${900 * scale}px;
  background-position: -${X * scale}px -${s.top * scale}px; box-shadow: 0 1px 2px rgb(0 0 0 / .04), 0 18px 44px rgb(0 0 0 / .08); overflow: hidden; }
${s.height > height ? `.shot::after { content: ""; position: absolute; inset: auto 0 0 0; height: 100px; background: linear-gradient(transparent, #fff); }` : ""}
</style></head><body>
<header><div><p class="eyebrow"><img src="${icon}" alt="">Desktop &amp; Browser Agent</p><h1>${s.title}</h1></div><p class="lead">${s.lead}</p></header>
<div class="shot"></div>
</body></html>`;
};
const chromium = chromiumArg("node docs/screenshots/frame.mjs <path to a Chromium or Chrome binary>");
for (const s of shots) {
  // At 2x (3200x2000) so the settings text stays sharp.
  withWorkDir("frame-", (work) => {
    const html = join(work, `${s.name}.html`);
    writeFileSync(html, page(s));
    execFileSync(chromium, [
      "--no-first-run", "--disable-gpu", "--hide-scrollbars", "--allow-file-access-from-files",
      `--user-data-dir=${join(work, "profile")}`, "--window-size=1600,1000", "--force-device-scale-factor=2",
      `--screenshot=${join(here, `${s.name}.png`)}`, `file://${html}`,
    ], { stdio: "ignore" });
  });
}
