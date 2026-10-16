import { execFile, spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";
import { createInterface } from "node:readline";
import {
  experimental_defineHostEntry,
  type ExperimentalHostWorkerLease,
} from "@get-bb/plugin-sdk/host";
import {
  IDLE_INSTALL_STATE,
  hostContract,
  hostSignals,
  type CatalogTool,
  type DriverGrant,
  type DriverStatus,
  type InstallState,
  type ToolCallResult,
  type ToolContentPart,
} from "./src/contract.js";
import { bridgeLayout, bridgeState, callBrowser, installBridge, uninstallBridge } from "./src/browser-host.js";
import { INSTALLER_LAYOUT, TESTED_INSTALLER, installerFiles, releaseTag, sha256Hex, type InstallerRecord } from "./src/installer.js";
import { McpStdioClient, type McpChild, type McpContentPart } from "./src/mcp-client.js";
import { CUA_INSTALL_DOCS_URL, INSTALL_SCRIPT_URLS } from "./src/links.js";
import packageJson from "./package.json";

export const PLUGIN_VERSION = packageJson.version;
const BINARY_CACHE_MS = 60_000;
const PROBE_TIMEOUT_MS = 8_000;
const GRANT_TIMEOUT_MS = 120_000;
const DAEMON_START_TIMEOUT_MS = 10_000;
const DEFAULT_IDLE_DISCONNECT_MS = 10 * 60_000;
const STRUCTURED_TEXT_LIMIT = 200_000;
const INSTALL_TAIL_LINES = 80;


export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface ProcessChild {
  readonly stdout: NodeJS.ReadableStream | null;
  readonly stderr: NodeJS.ReadableStream | null;
  once(event: "exit" | "error", listener: (...args: unknown[]) => void): this;
}

export interface HostDependencies {
  readonly platform: NodeJS.Platform;
  readonly env: NodeJS.ProcessEnv;
  readonly homeDir: string;
  /** The runtime this worker runs on; the browser bridge's native host runs on it too. */
  readonly runtimePath: string;
  readonly uid: number | null;
  readonly idleDisconnectMs?: number;
  /** The installer checksums recorded for the tested driver; tests swap in their own. */
  readonly installer?: InstallerRecord;
  now(): number;
  sleep(ms: number): Promise<void>;
  fileExists(path: string): Promise<boolean>;
  exec(command: string, args: readonly string[], timeoutMs: number): Promise<ExecResult>;
  spawnMcp(command: string, args: readonly string[]): McpChild;
  fetchBytes(url: string, signal: AbortSignal): Promise<Uint8Array>;
  makeDir(path: string): Promise<void>;
  writeFile(path: string, content: Uint8Array): Promise<void>;
  /** `env` is added to the host's own environment. */
  spawnProcess(command: string, args: readonly string[], env?: Readonly<Record<string, string>>): ProcessChild;
}

interface InstallContext {
  experimental_retainWorker(): ExperimentalHostWorkerLease;
  experimental_paths: { tempDir: string };
  lifecycle: { signal: AbortSignal };
}

export function candidateBinaryPaths(deps: Pick<HostDependencies, "platform" | "env" | "homeDir">): string[] {
  const isWindows = deps.platform === "win32";
  const path = isWindows ? win32 : posix;
  const executable = isWindows ? "cua-driver.exe" : "cua-driver";
  const candidates: string[] = [];
  const explicit = deps.env.CUA_DRIVER_PATH;
  if (explicit !== undefined && explicit.length > 0) candidates.push(explicit);
  const pathEntries = (deps.env.PATH ?? "").split(path.delimiter).filter((entry) => entry.length > 0);
  for (const entry of pathEntries) candidates.push(path.join(entry, executable));
  if (isWindows) {
    const localAppData = deps.env.LOCALAPPDATA;
    if (localAppData !== undefined && localAppData.length > 0) {
      candidates.push(path.join(localAppData, "Programs", "Cua", "cua-driver", "bin", executable));
    }
  } else {
    candidates.push(path.join(deps.homeDir, ".local", "bin", executable));
  }
  return [...new Set(candidates)];
}

function normalizePlatform(platform: NodeJS.Platform): DriverStatus["platform"] {
  return platform === "darwin" || platform === "linux" || platform === "win32" ? platform : "other";
}

function findBoolean(value: unknown, keyPattern: RegExp, depth = 0): boolean | null {
  if (depth > 4 || typeof value !== "object" || value === null) return null;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (keyPattern.test(key)) {
      if (typeof entry === "boolean") return entry;
      if (typeof entry === "string") {
        if (/^(granted|authorized|true|yes|ok)$/i.test(entry)) return true;
        if (/^(denied|not_granted|false|no|missing)$/i.test(entry)) return false;
      }
      if (typeof entry === "object" && entry !== null) {
        const nested = findBoolean(entry, /^(granted|authorized|status)$/i, depth + 1);
        if (nested !== null) return nested;
      }
    }
  }
  for (const entry of Object.values(value as Record<string, unknown>)) {
    const nested = findBoolean(entry, keyPattern, depth + 1);
    if (nested !== null) return nested;
  }
  return null;
}

function findString(value: unknown, keyPattern: RegExp, depth = 0): string | null {
  if (depth > 4 || typeof value !== "object" || value === null) return null;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (keyPattern.test(key) && typeof entry === "string") return entry;
  }
  for (const entry of Object.values(value as Record<string, unknown>)) {
    const nested = findString(entry, keyPattern, depth + 1);
    if (nested !== null) return nested;
  }
  return null;
}

export function parsePermissions(stdout: string): DriverStatus["permissions"] {
  try {
    const parsed: unknown = JSON.parse(stdout);
    return {
      accessibility: findBoolean(parsed, /accessibility/i),
      screenRecording: findBoolean(parsed, /screen[_-]?recording/i),
      directCapture: findString(parsed, /direct[_-]?capture[_-]?status/i),
    };
  } catch {
    return { accessibility: null, screenRecording: null, directCapture: null };
  }
}

/** Reads `cua-driver check-update --json`; unknown shapes report nothing rather than guess. */
export function parseUpdateCheck(stdout: string): { latestVersion: string | null; updateAvailable: boolean | null } {
  try {
    const parsed: unknown = JSON.parse(stdout);
    if (typeof parsed !== "object" || parsed === null) return { latestVersion: null, updateAvailable: null };
    const record = parsed as Record<string, unknown>;
    return {
      latestVersion: typeof record.latest_version === "string" ? record.latest_version : null,
      updateAvailable: typeof record.update_available === "boolean" ? record.update_available : null,
    };
  } catch {
    return { latestVersion: null, updateAvailable: null };
  }
}

/**
 * Grants a running `cua-driver serve` daemon was started with, read from its
 * command line (`ps -axo command=`); null when no daemon is running. Grants
 * belong to the daemon: `cua-driver mcp --grant` is refused while one listens.
 */
export function parseDaemonGrants(psOutput: string): string[] | null {
  const line = psOutput.split("\n").find((entry) => /cua-driver\s+serve(\s|$)/.test(entry));
  if (line === undefined) return null;
  return [...line.matchAll(/--grant(?:=|\s+)(\S+)/g)].map((match) => match[1] ?? "").filter(Boolean).sort();
}

export function mapContent(parts: McpContentPart[], structured: unknown): ToolContentPart[] {
  const mapped: ToolContentPart[] = [];
  for (const part of parts) {
    if (part.type === "text" && typeof part.text === "string") {
      mapped.push({ type: "text", text: part.text });
    } else if (part.type === "image" && typeof part.data === "string") {
      mapped.push({ type: "image", data: part.data, mimeType: part.mimeType ?? "image/png" });
    } else {
      mapped.push({ type: "text", text: JSON.stringify(part) });
    }
  }
  if (structured !== null && structured !== undefined) {
    const json = JSON.stringify(structured);
    mapped.push({
      type: "text",
      text:
        json.length > STRUCTURED_TEXT_LIMIT
          ? `structuredContent (truncated):\n${json.slice(0, STRUCTURED_TEXT_LIMIT)}`
          : `structuredContent:\n${json}`,
    });
  }
  if (mapped.length === 0) mapped.push({ type: "text", text: "(empty result)" });
  return mapped;
}

export function createCuaHostEntry(deps: HostDependencies) {
  const idleDisconnectMs = deps.idleDisconnectMs ?? DEFAULT_IDLE_DISCONNECT_MS;
  let binaryCache: { path: string | null; at: number } | null = null;
  let client: McpStdioClient | null = null;
  let connecting: Promise<McpStdioClient> | null = null;
  let connectedGrants: string | null = null;
  let tools: CatalogTool[] = [];
  let serverVersion: string | null = null;
  let lease: ExperimentalHostWorkerLease | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let lifecycleBound = false;
  let emitConnection: ((connected: boolean, reason: string) => void) | null = null;
  let emitInstall: ((state: InstallState) => void) | null = null;
  let installState: InstallState = { ...IDLE_INSTALL_STATE, tail: [] };

  async function resolveBinary(): Promise<string | null> {
    if (binaryCache !== null && deps.now() - binaryCache.at < BINARY_CACHE_MS) {
      return binaryCache.path;
    }
    let found: string | null = null;
    for (const candidate of candidateBinaryPaths(deps)) {
      if (await deps.fileExists(candidate)) {
        found = candidate;
        break;
      }
    }
    binaryCache = { path: found, at: deps.now() };
    return found;
  }

  function clearIdleTimer(): void {
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = null;
  }

  function armIdleTimer(): void {
    clearIdleTimer();
    idleTimer = setTimeout(() => disconnect("idle timeout"), idleDisconnectMs);
  }

  /** Forgets the live connection (client, tools, grants, idle timer, worker lease) and returns the client that was live. */
  function clearConnection(): McpStdioClient | null {
    clearIdleTimer();
    const active = client;
    client = null;
    tools = [];
    connectedGrants = null;
    const activeLease = lease;
    lease = null;
    void activeLease?.dispose();
    return active;
  }

  /**
   * Ends the live connection, if any, and tells the server once. Teardown
   * that comes from the worker's own lifecycle passes `notify` as false: the
   * server is no longer listening then.
   */
  function disconnect(reason: string, notify = true): boolean {
    const active = clearConnection();
    if (active === null) return false;
    // Cleared first, so the close listener sees a client that is no longer current and stays quiet.
    active.close(reason);
    if (notify) emitConnection?.(false, reason);
    return true;
  }

  /**
   * Makes sure the daemon carries every requested grant, restarting it with
   * them on macOS. Never removes a grant: someone else may have started the
   * daemon that way for another client.
   */
  async function ensureDaemonGrants(binary: string, grants: readonly DriverGrant[]): Promise<void> {
    if (grants.length === 0) return;
    const listing = await deps.exec("ps", ["-axo", "command="], PROBE_TIMEOUT_MS);
    const current = listing.code === 0 ? parseDaemonGrants(listing.stdout) : null;
    if (current !== null && grants.every((grant) => current.includes(grant))) return;
    const flags = [...new Set([...(current ?? []), ...grants])].sort().flatMap((grant) => ["--grant", grant]);
    if (deps.platform !== "darwin") {
      throw new Error(
        `Signed-in browser profiles need the Cua Driver service started with ${flags.join(" ")}. Run \`cua-driver stop\` and then \`cua-driver serve ${flags.join(" ")}\` on this machine.`,
      );
    }
    if (current !== null) await deps.exec(binary, ["stop"], PROBE_TIMEOUT_MS);
    // LaunchServices, so the daemon keeps CuaDriver.app's own macOS permissions.
    await deps.exec("open", ["-n", "-g", "-a", "CuaDriver", "--args", "serve", ...flags], PROBE_TIMEOUT_MS);
    const deadline = deps.now() + DAEMON_START_TIMEOUT_MS;
    while (deps.now() < deadline) {
      const status = await deps.exec(binary, ["status"], PROBE_TIMEOUT_MS);
      if (status.code === 0) return;
      await deps.sleep(250);
    }
    throw new Error(`The Cua Driver service did not come back after restarting it with ${flags.join(" ")}.`);
  }

  async function connect(
    context: { experimental_retainWorker(): ExperimentalHostWorkerLease },
    grants: readonly DriverGrant[],
  ): Promise<McpStdioClient> {
    const wanted = [...grants].sort().join(",");
    // A newly required grant means restarting the daemon, which drops this connection.
    if (client !== null && !client.isClosed && connectedGrants !== wanted && grants.length > 0) {
      disconnect("driver grants changed");
    }
    if (client !== null && !client.isClosed) {
      armIdleTimer();
      return client;
    }
    if (connecting !== null) return connecting;
    connecting = (async () => {
      const binary = await resolveBinary();
      if (binary === null) {
        throw new Error(
          `cua-driver is not installed on this machine. Install it from ${CUA_INSTALL_DOCS_URL} and run \`cua-driver doctor\`.`,
        );
      }
      await ensureDaemonGrants(binary, grants);
      const child = deps.spawnMcp(binary, ["mcp"]);
      const next = new McpStdioClient(child);
      next.onClose((reason) => {
        // A client that is no longer current was ended by disconnect(), which has already reported it.
        if (client !== next) return;
        clearConnection();
        emitConnection?.(false, reason);
      });
      try {
        serverVersion = await next.initialize("bb-plugin-computer-use", PLUGIN_VERSION);
        tools = await next.listTools();
      } catch (error) {
        const stderr = next.recentStderr;
        next.close("initialize failed");
        throw new Error(
          `cua-driver mcp did not start: ${error instanceof Error ? error.message : String(error)}${
            stderr.length > 0 ? `\n${stderr}` : ""
          }`,
        );
      }
      client = next;
      connectedGrants = wanted;
      lease ??= context.experimental_retainWorker();
      armIdleTimer();
      emitConnection?.(true, "connected");
      return next;
    })();
    try {
      return await connecting;
    } finally {
      connecting = null;
    }
  }

  function bindLifecycle(signal: AbortSignal): void {
    if (lifecycleBound) return;
    lifecycleBound = true;
    signal.addEventListener("abort", () => disconnect("worker disposed", false), { once: true });
  }

  /** A probe whose arguments execFile refuses (it throws) reports a failed run instead of rejecting. */
  function safeExec(binary: string, args: readonly string[]): Promise<ExecResult> {
    return deps.exec(binary, args, PROBE_TIMEOUT_MS).catch(
      (error: unknown): ExecResult => ({
        code: null,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
      }),
    );
  }

  async function probeStatus(probeDaemon: boolean): Promise<DriverStatus> {
    const platform = normalizePlatform(deps.platform);
    const checkedAt = new Date(deps.now()).toISOString();
    const binary = await resolveBinary();
    const base: DriverStatus = {
      platform,
      installed: binary !== null,
      binaryPath: binary,
      version: null,
      daemonRunning: null,
      permissions: null,
      connected: client !== null && !client.isClosed,
      latestVersion: null,
      updateAvailable: null,
      toolCount: tools.length > 0 ? tools.length : null,
      error: null,
      checkedAt,
    };
    if (binary === null) return base;
    const errors: string[] = [];
    const version = await safeExec(binary, ["--version"]);
    if (version.code === 0) {
      base.version = version.stdout.trim().replace(/^cua-driver\s+/i, "") || null;
    } else {
      errors.push(`--version failed: ${version.stderr.trim() || String(version.code)}`);
    }
    if (probeDaemon) {
      const status = await safeExec(binary, ["status"]);
      base.daemonRunning = status.code === 0;
      // cua-driver caches this answer on disk for 20 hours, so probing often is cheap.
      const update = await safeExec(binary, ["check-update", "--json"]);
      if (update.code === 0) Object.assign(base, parseUpdateCheck(update.stdout));
    }
    if (platform === "darwin") {
      const permissions = await safeExec(binary, ["permissions", "status", "--json"]);
      base.permissions =
        permissions.code === 0
          ? parsePermissions(permissions.stdout)
          : { accessibility: null, screenRecording: null };
    }
    base.error = errors.length > 0 ? errors.join("; ") : null;
    return base;
  }

  function pushInstallLine(line: string, step?: string): void {
    const tail = [...installState.tail, line].slice(-INSTALL_TAIL_LINES);
    installState = { ...installState, tail, ...(step === undefined ? {} : { step }) };
    emitInstall?.(installState);
  }

  function runStep(
    command: string,
    args: readonly string[],
    step: string,
    env?: Readonly<Record<string, string>>,
  ): Promise<number | null> {
    return new Promise((resolve, reject) => {
      const prefix = Object.entries(env ?? {}).map(([key, value]) => `${key}=${value} `).join("");
      pushInstallLine(`$ ${prefix}${[command, ...args].join(" ")}`, step);
      let child: ProcessChild;
      try {
        child = env === undefined ? deps.spawnProcess(command, args) : deps.spawnProcess(command, args, env);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      for (const stream of [child.stdout, child.stderr]) {
        if (stream === null) continue;
        createInterface({ input: stream }).on("line", (line) => {
          if (line.trim().length > 0) pushInstallLine(line);
        });
      }
      child.once("error", (error) => reject(error instanceof Error ? error : new Error(String(error))));
      child.once("exit", (code) => resolve(typeof code === "number" ? code : null));
    });
  }

  async function downloadNewest(context: InstallContext): Promise<string> {
    const isWindows = deps.platform === "win32";
    const url = isWindows ? INSTALL_SCRIPT_URLS.windows : INSTALL_SCRIPT_URLS.posix;
    pushInstallLine(`Downloading ${url} (newest release, not checksum-pinned)`, "download");
    const script = await deps.fetchBytes(url, context.lifecycle.signal);
    const scriptPath = (isWindows ? win32 : posix).join(
      context.experimental_paths.tempDir,
      isWindows ? "cua-driver-install.ps1" : "cua-driver-install.sh",
    );
    await deps.writeFile(scriptPath, script);
    return scriptPath;
  }

  /**
   * Downloads the release's own installer files and refuses to run any whose
   * sha256 differs from the one recorded when this plugin was tested. The
   * installer then checks the driver archive against the release's SHA256SUMS
   * (and its Sigstore signature when cosign is installed).
   */
  async function downloadPinned(context: InstallContext, version: string): Promise<string> {
    const isWindows = deps.platform === "win32";
    const record = deps.installer ?? TESTED_INSTALLER;
    const files = installerFiles(isWindows ? "windows" : "posix", version, record);
    if (files === null) {
      throw new Error(
        `this plugin has no recorded installer checksums for Cua Driver ${version} (it records ${record.driverVersion})`,
      );
    }
    const path = isWindows ? win32 : posix;
    const dir = path.join(context.experimental_paths.tempDir, releaseTag(version));
    await deps.makeDir(dir);
    for (const file of files) {
      pushInstallLine(`Downloading ${file.url}`, "download");
      const content = await deps.fetchBytes(file.url, context.lifecycle.signal);
      const actual = sha256Hex(content);
      if (actual !== file.sha256) {
        throw new Error(
          `${file.name} does not match the checksum recorded for ${version} (expected ${file.sha256}, got ${actual}); refusing to run it`,
        );
      }
      await deps.writeFile(path.join(dir, file.name), content);
    }
    pushInstallLine(`Verified ${String(files.length)} installer files against the checksums recorded for ${version}.`, "verify");
    return path.join(dir, INSTALLER_LAYOUT[isWindows ? "windows" : "posix"].entry);
  }

  async function runInstall(context: InstallContext, version: string | null): Promise<void> {
    const installLease = context.experimental_retainWorker();
    const isWindows = deps.platform === "win32";
    try {
      const existing = await resolveBinary();
      if (existing !== null) {
        // Updating in place: release the old binary before the installer replaces it.
        disconnect("updating cua-driver");
        await runStep(existing, ["stop"], "stop-service").catch(() => null);
      }
      const scriptPath = version === null ? await downloadNewest(context) : await downloadPinned(context, version);
      // The official installer's own pin: an exact release instead of the newest.
      const env = version === null ? undefined : { CUA_DRIVER_RS_VERSION: version };
      const code = isWindows
        ? await runStep("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath], "install", env)
        : await runStep("/bin/bash", [scriptPath], "install", env);
      if (code !== 0) {
        installState = { ...installState, exitCode: code };
        throw new Error(`installer exited with ${String(code)}`);
      }
      binaryCache = null;
      const binary = await resolveBinary();
      if (binary === null) {
        throw new Error("installer finished but cua-driver was not found on PATH or in the installer location");
      }
      if (isWindows) {
        await runStep(binary, ["autostart", "kick"], "autostart").catch(() => null);
      } else if (deps.platform === "darwin") {
        await runStep("open", ["-n", "-g", "-a", "CuaDriver", "--args", "serve"], "start-service").catch(() => null);
      }
      installState = {
        ...installState,
        running: false,
        ok: true,
        exitCode: 0,
        step: "done",
        finishedAt: new Date(deps.now()).toISOString(),
      };
      pushInstallLine("Install finished. On macOS, grant Accessibility and Screen Recording next.");
    } catch (error) {
      installState = {
        ...installState,
        running: false,
        ok: false,
        step: "failed",
        finishedAt: new Date(deps.now()).toISOString(),
      };
      pushInstallLine(`Install failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      void installLease.dispose();
    }
  }

  function startInstall(context: InstallContext, version: string | null): InstallState {
    if (installState.running) return installState;
    if (normalizePlatform(deps.platform) === "other") {
      throw new Error(`Cua Driver has no installer for platform ${deps.platform}.`);
    }
    installState = {
      running: true,
      ok: null,
      exitCode: null,
      step: "starting",
      tail: [],
      startedAt: new Date(deps.now()).toISOString(),
      finishedAt: null,
      target: version,
    };
    emitInstall?.(installState);
    void runInstall(context, version);
    return installState;
  }

  function acceptsSession(name: string): boolean {
    const descriptor = tools.find((entry) => entry.name === name);
    if (descriptor === undefined) return true;
    const properties = descriptor.inputSchema.properties;
    return typeof properties === "object" && properties !== null && "session" in properties;
  }

  const browserLayout = bridgeLayout(deps.platform, deps.homeDir, deps.uid);

  return experimental_defineHostEntry({
    contract: hostContract,
    experimental_signals: hostSignals,
    handlers: {
      install(input, context) {
        bindLifecycle(context.lifecycle.signal);
        emitInstall ??= (state) => {
          void context.experimental_emitSignal("installChanged", state);
        };
        return startInstall(context, input.version);
      },
      installState() {
        return installState;
      },
      async grantPermissions(_input, context) {
        bindLifecycle(context.lifecycle.signal);
        if (deps.platform !== "darwin") {
          return { ok: false, output: "Permission grants are only needed on macOS." };
        }
        const binary = await resolveBinary();
        if (binary === null) return { ok: false, output: "cua-driver is not installed." };
        const result = await deps.exec(binary, ["permissions", "grant"], GRANT_TIMEOUT_MS);
        const output = `${result.stdout}${result.stderr}`.trim().slice(-4000);
        if (output.length > 0) return { ok: result.code === 0, output };
        return {
          ok: result.code === 0,
          output:
            result.code === 0
              ? "Requested. Approve the macOS prompts, then fully relaunch CuaDriver.app."
              : `permissions grant exited with ${String(result.code)}`,
        };
      },
      async status(input, context) {
        bindLifecycle(context.lifecycle.signal);
        return probeStatus(input.probeDaemon);
      },
      async listTools(input, context) {
        bindLifecycle(context.lifecycle.signal);
        emitConnection ??= (connected, reason) => {
          void context.experimental_emitSignal("connectionChanged", { connected, reason });
        };
        await connect(context, input.grants);
        return { tools, driverVersion: serverVersion };
      },
      async callTool(input, context): Promise<ToolCallResult> {
        bindLifecycle(context.lifecycle.signal);
        emitConnection ??= (connected, reason) => {
          void context.experimental_emitSignal("connectionChanged", { connected, reason });
        };
        const active = await connect(context, input.grants);
        const args: Record<string, unknown> = { ...input.arguments };
        if (input.session !== undefined && acceptsSession(input.name) && !("session" in args)) {
          args.session = input.session;
        }
        const result = await active.callTool(input.name, args, context.signal);
        armIdleTimer();
        return {
          content: mapContent(result.content, result.structuredContent),
          isError: result.isError,
          ...(result.structuredContent !== null ? { structured: result.structuredContent } : {}),
        };
      },
      disconnect() {
        return { disconnected: disconnect("disconnect requested") };
      },
      async browserBridge(input) {
        if (input.action === "install") await installBridge(browserLayout, deps.runtimePath);
        if (input.action === "uninstall") await uninstallBridge(browserLayout);
        return bridgeState(browserLayout, deps.runtimePath);
      },
      browserCall(input, context) {
        return callBrowser(browserLayout, input.method, input.params, {
          signal: context.signal,
          ...(input.browser !== undefined ? { browser: input.browser } : {}),
        });
      },
    },
    dispose() {
      disconnect("host entry disposed", false);
    },
  });
}

function execCommand(command: string, args: readonly string[], timeoutMs: number): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      command,
      [...args],
      { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        const code =
          error === null
            ? 0
            : typeof (error as { code?: unknown }).code === "number"
              ? ((error as { code: number }).code)
              : null;
        resolve({ code, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

export default createCuaHostEntry({
  platform: process.platform,
  env: process.env,
  homeDir: homedir(),
  runtimePath: process.execPath,
  uid: process.getuid?.() ?? null,
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  fileExists: (path) => access(path).then(() => true, () => false),
  exec: execCommand,
  spawnMcp(command, args) {
    return spawn(command, [...args], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  },
  async fetchBytes(url, signal) {
    const response = await fetch(url, { signal, redirect: "follow" });
    if (!response.ok) throw new Error(`download failed: HTTP ${String(response.status)} for ${url}`);
    return new Uint8Array(await response.arrayBuffer());
  },
  makeDir: (path) => mkdir(path, { recursive: true, mode: 0o700 }).then(() => undefined),
  writeFile: (path, content) => writeFile(path, content, { mode: 0o700 }),
  spawnProcess(command, args, env) {
    return spawn(command, [...args], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env, CI: "1", ...env },
    });
  },
});
