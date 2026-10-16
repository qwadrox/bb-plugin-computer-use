import { connect } from "node:net";
import { access, chmod, mkdir, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BRIDGE_SCRIPT } from "./browser-bridge-script.js";
import type { BrowserBridgeState, BrowserCallResult } from "./contract.js";
import { EXTENSION_IDS } from "./links.js";

/** Must match NATIVE_HOST in browser-extension/src/shared.ts. */
export const NATIVE_HOST_NAME = "dev.qwadrox.agent_browser_bridge";

const HELLO_TIMEOUT_MS = 1_500;
const CALL_TIMEOUT_MS = 90_000;
/** sun_path is 104 bytes on macOS. */
const SOCKET_PATH_MAX = 100;

export interface BrowserTarget {
  id: string;
  name: string;
  /** The browser's user data directory; native messaging manifests go in its NativeMessagingHosts folder. */
  userDataDir: string;
}

export interface BridgeLayout {
  supported: boolean;
  dir: string;
  script: string;
  launcher: string;
  sockets: string;
  browsers: BrowserTarget[];
}

export function bridgeLayout(platform: NodeJS.Platform, homeDir: string, uid: number | null): BridgeLayout {
  const darwin = platform === "darwin";
  const support = darwin ? join(homeDir, "Library", "Application Support") : join(homeDir, ".config");
  const dir = darwin
    ? join(support, "agent-browser-bridge")
    : join(homeDir, ".local", "share", "agent-browser-bridge");
  const sockets = join(dir, "s");
  const browsers: BrowserTarget[] = darwin
    ? [
        { id: "brave", name: "Brave", userDataDir: join(support, "BraveSoftware", "Brave-Browser") },
        { id: "chrome", name: "Chrome", userDataDir: join(support, "Google", "Chrome") },
        { id: "edge", name: "Edge", userDataDir: join(support, "Microsoft Edge") },
        { id: "chromium", name: "Chromium", userDataDir: join(support, "Chromium") },
      ]
    : [
        { id: "brave", name: "Brave", userDataDir: join(support, "BraveSoftware", "Brave-Browser") },
        { id: "chrome", name: "Chrome", userDataDir: join(support, "google-chrome") },
        { id: "edge", name: "Edge", userDataDir: join(support, "microsoft-edge") },
        { id: "chromium", name: "Chromium", userDataDir: join(support, "chromium") },
      ];
  const fits = `${sockets}/9999999.sock`.length <= SOCKET_PATH_MAX;
  return {
    supported: darwin || platform === "linux",
    dir,
    script: join(dir, "bridge.mjs"),
    launcher: join(dir, "bridge.sh"),
    sockets: fits ? sockets : `/tmp/agent-browser-bridge-${uid ?? "user"}`,
    browsers,
  };
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** bb runs host workers on its own Electron binary; ELECTRON_RUN_AS_NODE makes it plain Node, and plain Node ignores it. */
export function launcherScript(layout: BridgeLayout, runtime: string): string {
  return [
    "#!/bin/sh",
    "# Browser Bridge for bb native host launcher, written by the Desktop & Browser Agent bb plugin.",
    `ELECTRON_RUN_AS_NODE=1 AGENT_BRIDGE_SOCKETS=${shellQuote(layout.sockets)} exec ${shellQuote(runtime)} ${shellQuote(layout.script)} "$@"`,
    "",
  ].join("\n");
}

function nativeManifest(layout: BridgeLayout): string {
  return `${JSON.stringify(
    {
      name: NATIVE_HOST_NAME,
      description: "Browser Bridge for bb: lets bb agents work in your browser tabs.",
      path: layout.launcher,
      type: "stdio",
      allowed_origins: EXTENSION_IDS.map((id) => `chrome-extension://${id}/`),
    },
    null,
    2,
  )}\n`;
}

function manifestPath(browser: BrowserTarget): string {
  return join(browser.userDataDir, "NativeMessagingHosts", `${NATIVE_HOST_NAME}.json`);
}

const exists = (path: string) => access(path).then(() => true, () => false);

type BrowserConnection = BrowserBridgeState["connections"][number];

/** Writes the bridge script, its launcher, and a manifest for every browser found on this machine. */
export async function installBridge(layout: BridgeLayout, runtime: string): Promise<void> {
  if (!layout.supported) throw new Error("The browser bridge supports macOS and Linux.");
  await mkdir(layout.dir, { recursive: true, mode: 0o700 });
  await writeFile(layout.script, BRIDGE_SCRIPT, { mode: 0o600 });
  await writeFile(layout.launcher, launcherScript(layout, runtime), { mode: 0o700 });
  await chmod(layout.launcher, 0o700);
  for (const browser of layout.browsers) {
    if (!(await exists(browser.userDataDir))) continue;
    await mkdir(join(browser.userDataDir, "NativeMessagingHosts"), { recursive: true });
    await writeFile(manifestPath(browser), nativeManifest(layout), { mode: 0o644 });
  }
}

export async function uninstallBridge(layout: BridgeLayout): Promise<void> {
  for (const browser of layout.browsers) await rm(manifestPath(browser), { force: true });
  await rm(layout.script, { force: true });
  await rm(layout.launcher, { force: true });
}

/** Rewrites the launcher when the runtime moved (for example after a bb update). */
async function refreshLauncher(layout: BridgeLayout, runtime: string): Promise<void> {
  const expected = launcherScript(layout, runtime);
  const current = await readFile(layout.launcher, "utf8").catch(() => null);
  if (current !== null && current !== expected) await writeFile(layout.launcher, expected, { mode: 0o700 });
  const script = await readFile(layout.script, "utf8").catch(() => null);
  if (script !== null && script !== BRIDGE_SCRIPT) await writeFile(layout.script, BRIDGE_SCRIPT, { mode: 0o600 });
}

interface SocketReply {
  id?: unknown;
  result?: unknown;
  error?: { code?: unknown; message?: unknown };
}

/** One request over a bridge socket. */
function request(path: string, method: string, params: unknown, timeoutMs: number, signal?: AbortSignal): Promise<SocketReply> {
  return new Promise((resolve, reject) => {
    const socket = connect(path);
    let text = "";
    let settled = false;
    const finish = (error: Error | null, reply?: SocketReply) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      socket.destroy();
      if (error !== null) reject(error);
      else resolve(reply ?? {});
    };
    const onAbort = () => finish(new Error("The call was cancelled."));
    const timer = setTimeout(() => finish(new Error(`The browser did not answer within ${Math.round(timeoutMs / 1000)} s.`)), timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(`${JSON.stringify({ id: 1, method, params })}\n`));
    socket.on("data", (chunk: string) => {
      text += chunk;
      const end = text.indexOf("\n");
      if (end < 0) return;
      try {
        finish(null, JSON.parse(text.slice(0, end)) as SocketReply);
      } catch (error) {
        finish(error as Error);
      }
    });
    socket.on("error", (error) => finish(error));
    socket.on("close", () => finish(new Error("The browser bridge closed the connection.")));
  });
}

interface LiveSocket {
  path: string;
  hello: BrowserConnection;
}

async function liveSockets(layout: BridgeLayout): Promise<LiveSocket[]> {
  const names = await readdir(layout.sockets).catch(() => [] as string[]);
  const found = await Promise.all(
    names
      .filter((name) => name.endsWith(".sock"))
      .map(async (name): Promise<LiveSocket | null> => {
        const path = join(layout.sockets, name);
        try {
          const reply = await request(path, "hello", {}, HELLO_TIMEOUT_MS);
          const hello = reply.result as BrowserConnection | null;
          return hello === null || hello === undefined ? null : { path, hello };
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === "ECONNREFUSED" || code === "ENOENT") await unlink(path).catch(() => undefined);
          return null;
        }
      }),
  );
  return found.filter((entry): entry is LiveSocket => entry !== null);
}

export async function bridgeState(layout: BridgeLayout, runtime: string): Promise<BrowserBridgeState> {
  const installed = layout.supported && (await exists(layout.script)) && (await exists(layout.launcher));
  if (installed) await refreshLauncher(layout, runtime);
  const browsers = await Promise.all(
    layout.browsers.map(async (browser) => ({
      id: browser.id,
      name: browser.name,
      detected: await exists(browser.userDataDir),
      registered: await exists(manifestPath(browser)),
    })),
  );
  const connections = installed ? (await liveSockets(layout)).map((entry) => entry.hello) : [];
  return { supported: layout.supported, installed, browsers, connections };
}

/** Sends one method to the extension in the chosen (or only) connected browser. */
export async function callBrowser(
  layout: BridgeLayout,
  method: string,
  params: Record<string, unknown>,
  options: { browser?: string; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<BrowserCallResult> {
  if (!layout.supported) return { ok: false, code: "unsupported", message: "The browser extension works on macOS and Linux." };
  if (!(await exists(layout.script))) {
    return { ok: false, code: "not_installed", message: "The browser bridge is not installed on this machine." };
  }
  const live = await liveSockets(layout);
  if (live.length === 0) {
    return {
      ok: false,
      code: "not_connected",
      message: "No browser with the Browser Bridge for bb extension is connected. The browser may be closed, or the extension not installed.",
    };
  }
  // A blank browser name counts as none given.
  const wanted = options.browser?.trim().toLowerCase() || undefined;
  const matches = wanted ? live.filter((entry) => entry.hello.browser.toLowerCase() === wanted) : live;
  if (matches.length === 0) {
    return {
      ok: false,
      code: "no_such_browser",
      message: `${options.browser} is not connected. Connected: ${live.map((entry) => entry.hello.browser).join(", ")}.`,
    };
  }
  if (matches.length > 1 && wanted === undefined) {
    return {
      ok: false,
      code: "several_browsers",
      message: `Several browsers are connected (${live.map((entry) => entry.hello.browser).join(", ")}). Pass browser to choose one.`,
    };
  }
  const target = matches[0]!;
  try {
    const reply = await request(target.path, method, params, options.timeoutMs ?? CALL_TIMEOUT_MS, options.signal);
    if (reply.error !== undefined) {
      return { ok: false, code: String(reply.error.code ?? "failed"), message: String(reply.error.message ?? "The extension refused.") };
    }
    return { ok: true, browser: target.hello.browser, result: reply.result };
  } catch (error) {
    return { ok: false, code: "bridge_failed", message: error instanceof Error ? error.message : String(error) };
  }
}
