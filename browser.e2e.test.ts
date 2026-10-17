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
const FEATURES = `<!doctype html><title>Features</title>
<header><a href="/second">Home</a></header>
<main>
<h1>Features</h1>
<button onclick="const row = document.createElement('li'); row.textContent = 'Row ' + (document.querySelectorAll('#list li').length + 1); document.getElementById('list').append(row)">Add row</button>
<ul id="list"><li>Row 1</li></ul>
<button onclick="document.getElementById('answer').textContent = confirm('Delete everything?') ? 'Deleted' : 'Kept'">Delete</button>
<button onclick="document.getElementById('answer').textContent = 'Name: ' + prompt('Your name?', 'Bob')">Ask name</button>
<p id="answer"></p>
<a href="/second" target="_blank">Open second</a>
<button onmouseenter="document.getElementById('items').style.display = 'block'">Menu</button>
<div id="items" style="display:none"><button>Settings item</button></div>
<button onclick="setTimeout(() => { document.getElementById('late').textContent = 'Loaded late' }, 1500)">Load later</button>
<p id="late"></p>
<form><label>Email <input id="email"></label> <label>Plan <select><option>Free</option><option>Pro</option></select></label>
<label><input type="checkbox"> Accept terms</label></form>
<iframe title="Embedded" srcdoc="<button onclick=&quot;document.body.insertAdjacentHTML('beforeend', '<p>Frame clicked</p>')&quot;>Frame button</button>" style="width:300px;height:100px"></iframe>
<button onclick="document.getElementById('photo').click()">Choose photo</button>
<input type="file" id="photo" style="display:none" onchange="document.getElementById('picked').textContent = 'Picked ' + this.files[0].name">
<p id="picked"></p>
<label>Other file <input type="file"></label>
</main>
<div role="dialog" aria-label="Cookies"><p>We use cookies</p><button>Accept cookies</button></div>`;

/** A JPEG's width, from its start-of-frame segment. */
function jpegWidth(base64: string): number {
  const bytes = Buffer.from(base64, "base64");
  for (let index = 2; index + 9 < bytes.length; ) {
    if (bytes[index] !== 0xff) return 0;
    const marker = bytes[index + 1]!;
    if (marker === 0xc0 || marker === 0xc2) return bytes.readUInt16BE(index + 7);
    index += 2 + bytes.readUInt16BE(index + 2);
  }
  return 0;
}

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
      const pages: Record<string, string> = { "/second": SECOND, "/upload": UPLOAD, "/features": FEATURES };
      response.end(pages[request.url ?? ""] ?? FORM);
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
        // A Retina-like screen, so screenshots are scaled down.
        "--force-device-scale-factor=2",
        "--window-size=1000,800",
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
    if (reply.ok) {
      const data = (reply.result as { data: string }).data;
      expect(data.length).toBeGreaterThan(1000);
      // 1000 CSS px at 2x is 2000 px, scaled down to 1280.
      expect(jpegWidth(data)).toBe(1280);
    } else {
      expect(reply.code).toBe("not_rendered");
    }
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

  describe("on a page with dialogs, frames, menus and late content", () => {
    let tab: number;
    let page: string;
    const changes = (result: Record<string, unknown>) => result.changes as { added: string[]; removed: string[]; outline?: string };

    beforeAll(async () => {
      tab = (await call("open", { url: `${base}/features` })).tab_id as number;
      page = (await call("read", { tab_id: tab })).text as string;
    });

    afterAll(async () => {
      await call("close", { tab_id: tab }).catch(() => undefined);
    });

    it("keeps refs while their elements stay, and reports what an action changed", async () => {
      const add = refFor(page, /button "Add row"/);
      const remove = refFor(page, /button "Delete"/);
      const clicked = await call("click", { tab_id: tab, ref: add });
      expect(clicked.target).toBe(`[${add}] button "Add row"`);
      expect(changes(clicked)).toEqual({ added: ["- Row 2"], removed: [] });
      const again = (await call("read", { tab_id: tab })).text as string;
      expect(refFor(again, /button "Add row"/)).toBe(add);
      expect(refFor(again, /button "Delete"/)).toBe(remove);
      expect((await call("read", { tab_id: tab, query: remove })).text).toMatch(new RegExp(`\\n\\[${remove}\\] button "Delete"$`));
    });

    it("reports a dialog an action opened and answers it", { timeout: 20_000 }, async () => {
      const opened = await call("click", { tab_id: tab, ref: refFor(page, /button "Delete"/) });
      expect(opened.dialog).toEqual({ type: "confirm", message: "Delete everything?", default_prompt: "" });
      await expect(call("read", { tab_id: tab })).rejects.toThrow(/dialog_open: .*browser_dialog/);
      const answered = await call("dialog", { tab_id: tab, accept: false });
      expect(changes(answered).added).toContain("Kept");

      expect((await call("click", { tab_id: tab, ref: refFor(page, /button "Ask name"/) })).dialog).toMatchObject({ type: "prompt", default_prompt: "Bob" });
      const named = await call("dialog", { tab_id: tab, accept: true, text: "Ada" });
      expect(changes(named).added).toContain("Name: Ada");
      await expect(call("dialog", { tab_id: tab, accept: true })).rejects.toThrow(/no_dialog/);
    });

    it("reports a tab a link opened and leaves it in the background", async () => {
      const clicked = await call("click", { tab_id: tab, ref: refFor(page, /link "Open second"/) });
      const opened = clicked.opened_tabs as Array<{ tab_id: number; url: string }>;
      expect(opened).toHaveLength(1);
      expect(opened[0]!.url).toBe(`${base}/second`);
      await call("close", { tab_id: opened[0]!.tab_id });
    });

    it("hovers to open a menu, and waits for late content", { timeout: 20_000 }, async () => {
      const hovered = await call("hover", { tab_id: tab, ref: refFor(page, /button "Menu"/) });
      expect(changes(hovered).added).toEqual([expect.stringMatching(/^\[e\d+\] button "Settings item"$/)]);
      const late = await call("click", { tab_id: tab, ref: refFor(page, /button "Load later"/), wait_for: "Loaded late" });
      expect(late.wait_for).toEqual({ text: "Loaded late", found: true });
      expect(changes(late).added).toContain("Loaded late");
    });

    it("fills a form in one call", async () => {
      const filled = await call("fill", {
        tab_id: tab,
        fields: [
          { ref: refFor(page, /textbox "Email"/), value: "ada@example.com" },
          { ref: refFor(page, /combobox "Plan"/), value: "Pro" },
          { ref: refFor(page, /checkbox "Accept terms"/), value: true },
        ],
      });
      expect((filled.fields as Array<{ value: string }>).map((field) => field.value)).toEqual(["ada@example.com", "Pro", "checked"]);
      const form = (await call("read", { tab_id: tab, query: "e" })).text as string;
      expect(form).toMatch(/textbox "Email" value="ada@example.com"/);
      expect(form).toMatch(/combobox "Plan" selected="Pro"/);
      expect(form).toMatch(/checkbox "Accept terms" checked/);
    });

    it("reads and clicks inside a same-site frame", async () => {
      const clicked = await call("click", { tab_id: tab, ref: refFor(page, /button "Frame button"/) });
      expect(changes(clicked).added).toContain("Frame clicked");
    });

    it("reads one region with scope", async () => {
      const dialog = (await call("read", { tab_id: tab, scope: "dialog" })).text as string;
      expect(dialog).toContain('button "Accept cookies"');
      expect(dialog).not.toContain("# Features");
      const main = (await call("read", { tab_id: tab, scope: "main" })).text as string;
      expect(main).toContain("# Features");
      expect(main).not.toContain("Accept cookies");
      expect(main).not.toContain('link "Home"');
    });

    it("holds back a file picker a click opened, and fills it", async () => {
      const photo = join(work, "photo.png");
      writeFileSync(photo, "png");
      const clicked = await call("click", { tab_id: tab, ref: refFor(page, /button "Choose photo"/) });
      expect(clicked.file_chooser).toEqual({ multiple: false });
      const uploaded = await call("upload", { tab_id: tab, paths: [photo] });
      expect(uploaded.files).toEqual(["photo.png"]);
      expect(changes(uploaded).added).toContain("Picked photo.png");
    });
  });

  it("refuses closed tabs and closes its own", async () => {
    await expect(call("read", { tab_id: 999_999 })).rejects.toThrow(/tab_closed/);
    await call("close", { tab_id: tabId });
    await expect(call("read", { tab_id: tabId })).rejects.toThrow(/tab_closed/);
  });
});
