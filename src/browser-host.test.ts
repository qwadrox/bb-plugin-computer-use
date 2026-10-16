import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EXTENSION_IDS } from "./links.js";
import {
  NATIVE_HOST_NAME,
  bridgeLayout,
  bridgeState,
  callBrowser,
  installBridge,
  launcherScript,
  uninstallBridge,
  type BridgeLayout,
} from "./browser-host.js";

const cleanup: Array<() => void> = [];
afterEach(() => {
  while (cleanup.length > 0) cleanup.pop()?.();
});

function tempLayout(): { layout: BridgeLayout; profile: string } {
  const work = mkdtempSync("/tmp/abb-test-");
  cleanup.push(() => rmSync(work, { recursive: true, force: true }));
  const profile = join(work, "Brave");
  mkdirSync(profile);
  return {
    layout: {
      ...bridgeLayout("darwin", work, 501),
      sockets: join(work, "s"),
      browsers: [
        { id: "brave", name: "Brave", userDataDir: profile },
        { id: "chrome", name: "Chrome", userDataDir: join(work, "Chrome") },
      ],
    },
    profile,
  };
}

function frame(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

/** Starts the bridge the way a browser would and answers its requests like the extension. */
function fakeBrowser(layout: BridgeLayout, browser: string, answer: (method: string, params: unknown) => unknown) {
  const child: ChildProcessWithoutNullStreams = spawn(process.execPath, [layout.script], {
    env: { ...process.env, AGENT_BRIDGE_SOCKETS: layout.sockets },
  });
  cleanup.push(() => child.kill());
  let buffer = Buffer.alloc(0);
  let ready: () => void;
  const started = new Promise<void>((resolve) => (ready = resolve));
  child.stdout.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const length = buffer.readUInt32LE(0);
      if (buffer.length < 4 + length) break;
      const message = JSON.parse(buffer.subarray(4, 4 + length).toString()) as { type?: string; id?: string; method?: string; params?: unknown };
      buffer = buffer.subarray(4 + length);
      if (message.type === "ready") {
        child.stdin.write(frame({ type: "hello", browser, version: "155.0", extension: "0.1.0" }));
        ready();
      } else if (message.id !== undefined) {
        try {
          child.stdin.write(frame({ id: message.id, result: answer(message.method ?? "", message.params) }));
        } catch (error) {
          child.stdin.write(frame({ id: message.id, error: { code: "tab_not_shared", message: (error as Error).message } }));
        }
      }
    }
  });
  return { child, started };
}

describe("browser bridge install", () => {
  it("registers the native host only for browsers on this machine", async () => {
    const { layout, profile } = tempLayout();
    await installBridge(layout, "/Applications/bb.app/Contents/MacOS/bb");

    const manifest = JSON.parse(readFileSync(join(profile, "NativeMessagingHosts", `${NATIVE_HOST_NAME}.json`), "utf8"));
    expect(manifest).toMatchObject({ name: NATIVE_HOST_NAME, type: "stdio", path: layout.launcher });
    expect(manifest.allowed_origins).toEqual(EXTENSION_IDS.map((id) => `chrome-extension://${id}/`));
    expect(statSync(layout.launcher).mode & 0o777).toBe(0o700);
    expect(readFileSync(layout.launcher, "utf8")).toContain("ELECTRON_RUN_AS_NODE=1");

    const state = await bridgeState(layout, "/Applications/bb.app/Contents/MacOS/bb");
    expect(state.installed).toBe(true);
    expect(state.browsers.map((browser) => [browser.id, browser.detected, browser.registered])).toEqual([
      ["brave", true, true],
      ["chrome", false, false],
    ]);

    await uninstallBridge(layout);
    expect((await bridgeState(layout, "x")).installed).toBe(false);
  });

  it("keeps the launcher pointed at the current runtime", async () => {
    const { layout } = tempLayout();
    await installBridge(layout, "/old/node");
    await bridgeState(layout, "/new/node");
    expect(readFileSync(layout.launcher, "utf8")).toBe(launcherScript(layout, "/new/node"));
  });

  it("quotes paths with spaces and quotes in the launcher", () => {
    const { layout } = tempLayout();
    const script = launcherScript({ ...layout, script: "/a b/it's.mjs" }, "/x/node");
    expect(script).toContain(`'/a b/it'\\''s.mjs'`);
  });

  it("matches the extension's native host name", () => {
    const shared = readFileSync(new URL("../browser-extension/src/shared.ts", import.meta.url), "utf8");
    expect(shared).toContain(`"${NATIVE_HOST_NAME}"`);
    const manifest = readFileSync(new URL("../browser-extension/static/manifest.json", import.meta.url), "utf8");
    expect(JSON.parse(manifest).permissions).toContain("nativeMessaging");
  });
});

describe("browser bridge calls", () => {
  it("relays a call to the connected browser and back", async () => {
    const { layout } = tempLayout();
    await installBridge(layout, process.execPath);
    const brave = fakeBrowser(layout, "Brave", (method, params) => ({ method, params }));
    await brave.started;

    const state = await bridgeState(layout, process.execPath);
    expect(state.connections).toEqual([{ browser: "Brave", version: "155.0", extension: "0.1.0", pid: brave.child.pid }]);
    const reply = await callBrowser(layout, "read", { tab_id: 4 });
    expect(reply).toEqual({ ok: true, browser: "Brave", result: { method: "read", params: { tab_id: 4 } } });
  });

  it("passes the extension's refusal through with its code", async () => {
    const { layout } = tempLayout();
    await installBridge(layout, process.execPath);
    const brave = fakeBrowser(layout, "Brave", () => {
      throw new Error("Tab 4 is not shared with agents.");
    });
    await brave.started;
    expect(await callBrowser(layout, "read", { tab_id: 4 })).toEqual({
      ok: false,
      code: "tab_not_shared",
      message: "Tab 4 is not shared with agents.",
    });
  });

  it("asks which browser when several are connected, and drops sockets of closed ones", async () => {
    const { layout } = tempLayout();
    await installBridge(layout, process.execPath);
    const brave = fakeBrowser(layout, "Brave", () => "brave");
    const chrome = fakeBrowser(layout, "Chrome", () => "chrome");
    await Promise.all([brave.started, chrome.started]);

    const both = await callBrowser(layout, "tabs", {});
    expect(both).toMatchObject({ ok: false, code: "several_browsers" });
    expect(await callBrowser(layout, "tabs", {}, { browser: "chrome" })).toMatchObject({ ok: true, result: "chrome" });

    chrome.child.stdin.end();
    await new Promise((resolve) => chrome.child.once("exit", resolve));
    expect(await callBrowser(layout, "tabs", {})).toMatchObject({ ok: true, browser: "Brave", result: "brave" });
  });

  it("treats a blank browser name like none given", async () => {
    const { layout } = tempLayout();
    await installBridge(layout, process.execPath);
    const brave = fakeBrowser(layout, "Brave", () => "brave");
    const chrome = fakeBrowser(layout, "Chrome", () => "chrome");
    await Promise.all([brave.started, chrome.started]);

    expect(await callBrowser(layout, "tabs", {}, { browser: " " })).toMatchObject({ ok: false, code: "several_browsers" });
  });

  it("says when no browser is connected", async () => {
    const { layout } = tempLayout();
    expect(await callBrowser(layout, "tabs", {})).toMatchObject({ ok: false, code: "not_installed" });
    await installBridge(layout, process.execPath);
    expect(await callBrowser(layout, "tabs", {})).toMatchObject({ ok: false, code: "not_connected" });
  });
});
