/**
 * End-to-end check of the Browser Bridge for bb: a real Chromium with the built
 * extension, the native host bridge, and the host-side client. Opt-in:
 *
 *   npm run build:extension
 *   CUA_BROWSER_E2E=1 CHROMIUM=<path to Chrome for Testing or Chromium> npx vitest run browser.e2e.test.ts
 *
 * It uses a throwaway profile, so no installed browser is touched.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bridgeLayout, bridgeState, callBrowser, installBridge, type BridgeLayout } from "./src/browser-host.js";

const enabled = process.env.CUA_BROWSER_E2E === "1";
const DEFAULT_CHROMIUM = join(
  homedir(),
  "Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
);
const extensionDir = fileURLToPath(new URL("./browser-extension/dist", import.meta.url));

const FORM = `<!doctype html><title>Form</title>
<h1>Expenses</h1>
<label for="name">Name</label><input id="name">
<label for="kind">Kind</label><select id="kind"><option value="a">Food</option><option value="b">Travel</option></select>
<button id="save" onclick="document.getElementById('out').textContent = 'Saved: ' + document.getElementById('name').value + ' / ' + document.getElementById('kind').selectedOptions[0].text">Save</button>
<p id="out"></p>
<a href="/second">Next page</a>
<div style="height:3000px"></div>`;
const SECOND = `<!doctype html><title>Second</title><p>Second page</p>`;
// A dropzone the way upload libraries build one: the file input inside it is hidden.
const UPLOAD = `<!doctype html><title>Upload</title>
<div id="drop" role="presentation" tabindex="0" style="border:2px dashed;padding:40px">
  <input type="file" accept=".csv" multiple style="display:none"
    onchange="Promise.all([...this.files].map((file) => file.text().then((text) => file.name + ': ' + text.trim()))).then((parts) => { document.getElementById('got').textContent = 'Got ' + parts.join(' | '); })">
  <p>Click or drag CSV files here</p>
</div>
<p id="got"></p>
<label for="avatar">Avatar</label><input type="file" id="avatar">`;

function refFor(text: string, pattern: RegExp): string {
  const line = text.split("\n").find((entry) => pattern.test(entry));
  const ref = line === undefined ? undefined : /^\[(e\d+)\]/.exec(line)?.[1];
  if (ref === undefined) throw new Error(`no ref matches ${pattern} in:\n${text}`);
  return ref;
}

describe.skipIf(!enabled)("agent browser bridge end to end", () => {
  let work: string;
  let layout: BridgeLayout;
  let chromium: ChildProcess;
  let server: Server;
  let base: string;
  let tabId: number;

  const call = async (method: string, params: Record<string, unknown> = {}) => {
    const reply = await callBrowser(layout, method, params, { timeoutMs: 30_000 });
    if (!reply.ok) throw new Error(`${method}: ${reply.code}: ${reply.message}`);
    return reply.result as Record<string, unknown>;
  };

  beforeAll(async () => {
    if (!existsSync(join(extensionDir, "manifest.json"))) throw new Error("Run npm run build:extension first.");
    work = mkdtempSync("/tmp/abb-e2e-");
    const profile = join(work, "profile");
    mkdirSync(profile);
    layout = {
      ...bridgeLayout("darwin", work, process.getuid?.() ?? null),
      sockets: join(work, "s"),
      browsers: [{ id: "test", name: "Test", userDataDir: profile }],
    };
    await installBridge(layout, process.execPath);

    server = createServer((request, response) => {
      response.setHeader("content-type", "text/html");
      response.end(request.url === "/second" ? SECOND : request.url === "/upload" ? UPLOAD : FORM);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    base = `http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}`;

    chromium = spawn(
      process.env.CHROMIUM ?? DEFAULT_CHROMIUM,
      [
        `--user-data-dir=${profile}`,
        `--load-extension=${extensionDir}`,
        `--disable-extensions-except=${extensionDir}`,
        "--disable-features=DisableLoadExtensionCommandLineSwitch",
        "--headless=new",
        "--no-first-run",
        "--no-default-browser-check",
        "--use-mock-keychain",
        "about:blank",
      ],
      { stdio: "ignore" },
    );
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if ((await bridgeState(layout, process.execPath)).connections.length > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    throw new Error("The extension did not connect to the bridge.");
  }, 60_000);

  afterAll(async () => {
    chromium?.kill();
    await new Promise((resolve) => setTimeout(resolve, 500));
    server?.close();
    if (work !== undefined) rmSync(work, { recursive: true, force: true });
  });

  it("reports the browser and its settings", async () => {
    const status = await call("status");
    expect(status.paused).toBe(false);
    expect(status.cursor).toBe(true);
  });

  it("opens a tab in the agent group and reads it", async () => {
    const opened = await call("open", { url: `${base}/form` });
    tabId = opened.tab_id as number;
    const page = await call("read", { tab_id: tabId });
    expect(page.text).toContain("# Expenses");
    expect(page.text).toMatch(/\[e\d+\] textbox "Name"/);
    const tabs = await call("tabs");
    expect((tabs.tabs as Array<{ tab_id: number }>).map((tab) => tab.tab_id)).toContain(tabId);
  });

  it("types, selects and clicks", async () => {
    const page = (await call("read", { tab_id: tabId })).text as string;
    const typed = await call("type", { tab_id: tabId, ref: refFor(page, /textbox "Name"/), text: "Ada" });
    expect(typed.value).toBe("Ada");
    const chosen = await call("select", { tab_id: tabId, ref: refFor(page, /combobox/), option: "Travel" });
    expect(chosen.chosen).toBe("Travel");
    await call("click", { tab_id: tabId, ref: refFor(page, /button "Save"/) });
    const after = (await call("read", { tab_id: tabId, query: "Saved" })).text as string;
    expect(after).toContain("Saved: Ada / Travel");
  });

  it("refuses refs from an older snapshot after navigation", async () => {
    const page = (await call("read", { tab_id: tabId })).text as string;
    const link = refFor(page, /link "Next page"/);
    await call("click", { tab_id: tabId, ref: link });
    const second = (await call("read", { tab_id: tabId })).text as string;
    expect(second).toContain("Second page");
    await expect(call("click", { tab_id: tabId, ref: link })).rejects.toThrow(/stale_ref/);
  });

  it("scrolls, navigates back, and takes a screenshot or explains why not", async () => {
    await call("navigate", { tab_id: tabId, url: "back" });
    const scrolled = await call("scroll", { tab_id: tabId, direction: "down" });
    expect(scrolled.scroll_y as number).toBeGreaterThan(0);
    const reply = await callBrowser(layout, "screenshot", { tab_id: tabId }, { timeoutMs: 30_000 });
    if (reply.ok) expect((reply.result as { data: string }).data.length).toBeGreaterThan(1000);
    else expect(reply.code).toBe("not_rendered");
  });

  it("uploads files into a hidden file input behind a dropzone", async () => {
    const csv = join(work, "erste.csv");
    writeFileSync(csv, "date,amount\n2026-01-02,-300\n");
    const other = join(work, "notes.csv");
    writeFileSync(other, "x\n");
    const uploadTab = (await call("open", { url: `${base}/upload` })).tab_id as number;
    const page = (await call("read", { tab_id: uploadTab })).text as string;
    expect(page).toMatch(/\[e\d+\] file "Click or drag CSV files here" accept="\.csv" multiple hidden/);
    const ref = refFor(page, /file "Click or drag/);

    const uploaded = await call("upload", { tab_id: uploadTab, ref, paths: [csv, other] });
    expect(uploaded.files).toEqual(["erste.csv", "notes.csv"]);
    const got = (await call("read", { tab_id: uploadTab, query: "Got" })).text as string;
    expect(got).toContain("Got erste.csv: date,amount 2026-01-02,-300 | notes.csv: x");
    expect((await call("read", { tab_id: uploadTab, query: "Click or drag" })).text).toContain('files="erste.csv, notes.csv"');

    // The label's ref finds its input; that one takes a single file.
    const avatar = refFor(page, /file "Avatar"/);
    await expect(call("upload", { tab_id: uploadTab, ref: avatar, paths: [csv, other] })).rejects.toThrow(/invalid_arguments: That file input takes one file/);
    await expect(call("upload", { tab_id: uploadTab, paths: [csv] })).rejects.toThrow(/no_file_input: The page has several file inputs/);
    await expect(call("upload", { tab_id: uploadTab, ref, paths: [join(work, "missing.csv")] })).rejects.toThrow(/no_such_file: .*does not exist/);
    await call("close", { tab_id: uploadTab });
  });

  it("refuses closed tabs and closes its own", async () => {
    await expect(call("read", { tab_id: 999_999 })).rejects.toThrow(/tab_closed/);
    await call("close", { tab_id: tabId });
    await expect(call("read", { tab_id: tabId })).rejects.toThrow(/tab_closed/);
  });
});
