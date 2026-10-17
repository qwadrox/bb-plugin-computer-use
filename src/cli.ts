import type { PluginCliRegistration } from "@get-bb/plugin-sdk";
import { BROWSER_TOOLS, BROWSER_TOOL_NAMES, type BrowserTool } from "./browser-tools.js";
import { driverToolName, forwardableArguments } from "./catalog.js";
import type { BrowserBridgeState, DriverStatus, InstallState, ToolCallResult } from "./contract.js";
import { driftView, formatDrift, type DriftReport } from "./drift.js";
import { errorMessage } from "./errors.js";
import { EXPOSURES, type Exposure } from "./exposure.js";
import { EXTENSION_STORE_URL, STORE_EXTENSION_ID, UNPACKED_EXTENSION_ID } from "./links.js";
import { PROVIDER_OVERRIDES, ROUTING_MODES, parseRoutingMode, type ProviderOverride, type RoutingMode } from "./policy.js";
import { TESTED_DRIVER_VERSION } from "./snapshot.js";
import type { CallOptions, IndexedCatalog, State, ToolView } from "../server.js";

/**
 * The `bb cua` command. It parses argv and formats output; each action is a
 * plugin function passed in as `deps`, so the CLI shares its gates with the
 * agent tools.
 */

const USAGE = [
  "Usage:",
  "  bb cua status [--host <id>] [--json]          Driver readiness, tested version, and drift",
  "  bb cua drift [--host <id>] [--json]           Re-read the machine's tools and compare them with the tested driver",
  "  bb cua tools [--host <id>] [--json]           Every driver tool and how agents reach it",
  "  bb cua expose <tool> <tool|call|off|default>  Change how agents reach one tool",
  "  bb cua call <tool> [<json-args>] [--host <id>]",
  "  bb cua policy [<providerId> <cua|native|off|inherit>] [--json]",
  "  bb cua mode <prefer-native|cua-everywhere|off>",
  `  bb cua install --yes [--latest] [--host <id>] Install Cua Driver ${TESTED_DRIVER_VERSION} (or the newest release)`,
  `  bb cua update --yes [--latest] [--host <id>]  Move to Cua Driver ${TESTED_DRIVER_VERSION} (or the newest release)`,
  "  bb cua grant [--host <id>]                    Request macOS Accessibility + Screen Recording",
  "  bb cua browser [status|install|uninstall|on|off] [--host <id>] [--json]  The optional browser extension and its bridge",
  "  bb cua browser call <tool> [<json-args>] [--host <id>]  Call a browser_* tool (same rules as agents)",
].join("\n");


/** The plugin functions the `bb cua` command runs. server.ts supplies them. */
export interface CuaCliDeps {
  readCatalog(hostId: string): Promise<{ drift: DriftReport }>;
  hasCatalog(hostId: string): boolean;
  catalogIsStale(hostId: string): boolean;
  /** A machine's own catalog, or the bundled snapshot when its tool list has not been read. */
  catalogFor(hostId: string): IndexedCatalog;
  toolViews(catalogs?: IndexedCatalog[], summaryLimit?: number): ToolView[];
  statusReport(hostId: string, status: DriverStatus): string;
  refreshStatus(hostId: string, probeDaemon: boolean): Promise<DriverStatus>;
  refreshHost(hostId: string): Promise<DriverStatus>;
  resolveHostId(threadId: string): Promise<string>;
  primaryHostId(): Promise<string>;
  buildState(): Promise<State>;
  saveOverride(providerId: string, override: ProviderOverride): Promise<void>;
  saveMode(mode: RoutingMode): Promise<void>;
  saveExposure(tool: string, exposure: Exposure | "default"): Promise<void>;
  saveBrowserExtension(enabled: boolean): Promise<void>;
  browserExtensionOn(): boolean;
  extensionDir(): Promise<string | null>;
  bridgeOn(hostId: string, action: "status" | "install" | "uninstall"): Promise<BrowserBridgeState>;
  setupBridge(hostId: string, action: "install" | "uninstall"): Promise<BrowserBridgeState>;
  callConfiguredDriver(hostId: string, name: string, args: Record<string, unknown>, options: CallOptions): Promise<ToolCallResult>;
  callBrowserTool(hostId: string, tool: BrowserTool, args: Record<string, unknown>, options: CallOptions): Promise<ToolCallResult>;
  startInstall(hostId: string, version: string | null): Promise<InstallState>;
  readInstallState(hostId: string): Promise<InstallState>;
  grantPermissions(hostId: string): Promise<{ ok: boolean; output: string }>;
}

/** A tool result as CLI text. Images are described: their base64 would flood a terminal. */
function contentText(result: ToolCallResult): string {
  return result.content
    .map((part) => (part.type === "text" ? part.text : `[image ${part.mimeType}, ${part.data.length} base64 chars]`))
    .join("\n");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function cuaCli(deps: CuaCliDeps): PluginCliRegistration {
  const {
    readCatalog,
    hasCatalog,
    catalogIsStale,
    catalogFor,
    toolViews,
    statusReport,
    refreshStatus,
    refreshHost,
    resolveHostId,
    primaryHostId,
    buildState,
    saveOverride,
    saveMode,
    saveExposure,
    saveBrowserExtension,
    browserExtensionOn,
    extensionDir,
    bridgeOn,
    setupBridge,
    callConfiguredDriver,
    callBrowserTool,
    startInstall,
    readInstallState,
    grantPermissions,
  } = deps;

  return {
    name: "cua",
    summary: "Desktop & Browser Agent: Cua Driver readiness, tool exposure, routing policy, and raw tool calls",
    commands: [
      { name: "status", summary: "Show Cua Driver readiness, tested version, and drift for a machine", usage: "bb cua status [--host <id>] [--json]" },
      { name: "drift", summary: "Compare a machine's driver tools with the version this plugin was tested with", usage: "bb cua drift [--host <id>] [--json]" },
      { name: "tools", summary: "List every Cua Driver tool and how agents reach it", usage: "bb cua tools [--host <id>] [--json]" },
      { name: "expose", summary: "Offer a tool as a dedicated tool, through cua_call, or not at all", usage: "bb cua expose <tool> <tool|call|off|default>" },
      { name: "call", summary: "Call a Cua Driver tool with JSON arguments (same exposure rules as agents)", usage: "bb cua call <tool> [<json-args>] [--host <id>]" },
      { name: "policy", summary: "Show or set per-provider routing overrides", usage: "bb cua policy [<providerId> <cua|native|off|inherit>] [--json]" },
      { name: "mode", summary: "Set the routing mode", usage: "bb cua mode <prefer-native|cua-everywhere|off>" },
      { name: "install", summary: `Install Cua Driver ${TESTED_DRIVER_VERSION} with Cua's official installer (requires --yes)`, usage: "bb cua install --yes [--latest] [--host <id>]" },
      { name: "update", summary: `Move Cua Driver to ${TESTED_DRIVER_VERSION}, or the newest release with --latest (requires --yes)`, usage: "bb cua update --yes [--latest] [--host <id>]" },
      { name: "grant", summary: "Request macOS Accessibility and Screen Recording for CuaDriver.app", usage: "bb cua grant [--host <id>]" },
      {
        name: "browser",
        summary: "Set up the optional Browser Bridge for bb extension, or call its browser_* tools",
        usage: "bb cua browser [status|install|uninstall|on|off|call <tool> [<json-args>]] [--host <id>] [--json]",
      },
    ],
    async run(argv, ctx) {
      const flags = new Set(["--json", "--yes", "--latest"]);
      const json = argv.includes("--json");
      const yes = argv.includes("--yes");
      const latest = argv.includes("--latest");
      const hostFlag = argv.indexOf("--host");
      const explicitHost = hostFlag >= 0 ? argv[hostFlag + 1] : undefined;
      const args = argv.filter(
        (arg, index) => !flags.has(arg) && arg !== "--host" && (hostFlag < 0 || index !== hostFlag + 1),
      );
      const [command, ...rest] = args;
      async function targetHost(): Promise<string> {
        if (explicitHost !== undefined) return explicitHost;
        if (ctx.threadId !== undefined) return resolveHostId(ctx.threadId);
        return primaryHostId();
      }
      try {
        if (command === "status") {
          const hostId = await targetHost();
          const status = await refreshHost(hostId);
          const drift = catalogFor(hostId).drift;
          return {
            exitCode: 0,
            stdout: json
              ? JSON.stringify({ status, testedVersion: TESTED_DRIVER_VERSION, drift: drift === null ? null : driftView(drift) })
              : `${statusReport(hostId, status)}\n${JSON.stringify(status, null, 2)}`,
          };
        }
        if (command === "drift") {
          const hostId = await targetHost();
          const status = await refreshStatus(hostId, false);
          if (!status.installed) return { exitCode: 1, stderr: "Cua Driver is not installed on that machine." };
          const { drift } = await readCatalog(hostId);
          return { exitCode: 0, stdout: json ? JSON.stringify(driftView(drift)) : formatDrift(drift) };
        }
        if (command === "tools") {
          const hostId = await targetHost();
          if (!hasCatalog(hostId) || catalogIsStale(hostId)) await readCatalog(hostId).catch(() => null);
          const known = catalogFor(hostId);
          const rows = toolViews([known], 90).map((view) => ({
            name: view.name,
            exposure: view.exposure,
            overridden: view.override !== null,
            unreviewed: view.source === "unreviewed",
            group: view.group,
            summary: view.summary,
          }));
          if (json) return { exitCode: 0, stdout: JSON.stringify(rows) };
          const header = known.drift === null
            ? `Tested catalog (Cua Driver ${TESTED_DRIVER_VERSION}); this machine's own list could not be read.`
            : `Cua Driver ${known.catalog.driverVersion ?? "(unknown)"} on this machine. * = your override, ? = unreviewed new tool.`;
          const lines = rows.map(
            (row) =>
              `${row.name.padEnd(26)} ${row.exposure.padEnd(4)}${row.overridden ? "*" : row.unreviewed ? "?" : " "} ${row.group.padEnd(9)} ${row.summary}`,
          );
          return { exitCode: 0, stdout: [header, "", ...lines].join("\n") };
        }
        if (command === "expose") {
          const [tool, exposure] = rest;
          if (tool === undefined || exposure === undefined || ![...EXPOSURES, "default"].includes(exposure)) {
            return { exitCode: 1, stderr: "Usage: bb cua expose <tool> <tool|call|off|default>" };
          }
          await saveExposure(tool, exposure as Exposure | "default");
          const name = driverToolName(tool);
          const known = toolViews().find((view) => view.name === name);
          const effective = known?.exposure ?? exposure;
          return {
            exitCode: 0,
            stdout: `${name}: ${effective}${known !== undefined && !known.groupEnabled ? ` (its ${known.group} group is turned off in settings)` : ""}. New agent sessions pick this up.`,
          };
        }
        if (command === "policy") {
          if (rest.length === 2) {
            const [providerId, override] = rest;
            if (!PROVIDER_OVERRIDES.includes(override as ProviderOverride)) {
              return { exitCode: 1, stderr: `Override must be one of ${PROVIDER_OVERRIDES.join(", ")}.` };
            }
            await saveOverride(providerId!, override as ProviderOverride);
          } else if (rest.length !== 0) {
            return { exitCode: 1, stderr: USAGE };
          }
          const state = await buildState();
          const lines = state.providers.map(
            (provider) => `${provider.id.padEnd(16)} ${provider.decision.padEnd(7)} override=${provider.override}${provider.native ? " (native computer use)" : ""}`,
          );
          return { exitCode: 0, stdout: json ? JSON.stringify(state) : [`mode: ${state.mode}`, ...lines].join("\n") };
        }
        if (command === "mode") {
          const mode = parseRoutingMode(rest[0]);
          if (mode === null) {
            return { exitCode: 1, stderr: `Mode must be one of ${ROUTING_MODES.join(", ")}.` };
          }
          await saveMode(mode);
          return { exitCode: 0, stdout: `mode: ${mode}` };
        }
        if (command === "call") {
          const [tool, rawArgs] = rest;
          if (tool === undefined) return { exitCode: 1, stderr: USAGE };
          let parsed: Record<string, unknown> = {};
          if (rawArgs !== undefined) {
            const value: unknown = JSON.parse(rawArgs);
            if (typeof value !== "object" || value === null || Array.isArray(value)) {
              return { exitCode: 1, stderr: "Arguments must be a JSON object." };
            }
            parsed = value as Record<string, unknown>;
          }
          const forwarded = forwardableArguments(tool, parsed);
          if (!forwarded.ok) return { exitCode: 1, stderr: forwarded.error };
          const result = await callConfiguredDriver(await targetHost(), driverToolName(tool), forwarded.value, ctx);
          const text = contentText(result);
          // bb caps CLI output at 1 MiB; a screenshot alone can exceed it.
          const printable = {
            ...result,
            content: result.content.map((part) =>
              part.type === "image" ? { type: "image", mimeType: part.mimeType, base64Chars: part.data.length } : part,
            ),
          };
          return { exitCode: result.isError ? 1 : 0, stdout: json ? JSON.stringify(printable) : text };
        }
        if (command === "install" || command === "update") {
          const hostId = await targetHost();
          const target = latest ? null : TESTED_DRIVER_VERSION;
          const targetLabel = target === null ? "the newest Cua Driver release (untested with this plugin)" : `Cua Driver ${target}`;
          if (command === "update") {
            const status = await refreshStatus(hostId, true);
            if (!status.installed) return { exitCode: 1, stderr: "Cua Driver is not installed on that machine; run `bb cua install --yes` first." };
            if (target !== null && status.version === target) {
              return { exitCode: 0, stdout: `Cua Driver ${target} is already installed (the version this plugin was tested with).` };
            }
            if (target === null && status.updateAvailable === false) {
              return { exitCode: 0, stdout: `Cua Driver ${status.version ?? ""} is already the newest release.` };
            }
          }
          if (!yes) {
            return {
              exitCode: 1,
              stderr: [
                `This stops any running Cua Driver and runs Cua's official installer for ${targetLabel} on the target machine${target === null ? " (Cua's unpinned script)" : ", after checking its files against the checksums recorded in this plugin"}.`,
                target === null ? "" : "Pass --latest for the newest release instead.",
                "Re-run with --yes to confirm.",
              ].filter(Boolean).join(" "),
            };
          }
          let state = await startInstall(hostId, target);
          const deadline = Date.now() + 15 * 60_000;
          while (state.running && Date.now() < deadline) {
            await sleep(2_000);
            state = await readInstallState(hostId);
          }
          if (!state.running) await refreshHost(hostId).catch(() => null);
          const summary = state.running
            ? "Installer still running after 15 minutes; check `bb cua status` later."
            : state.ok
              ? "Install finished."
              : "Install failed.";
          return {
            exitCode: state.ok === true ? 0 : 1,
            stdout: json ? JSON.stringify(state) : [summary, ...state.tail].join("\n"),
          };
        }
        if (command === "browser") {
          const [action = "status", tool, rawArgs] = rest;
          if (action === "call") {
            const browserTool = BROWSER_TOOLS.find((entry) => entry.name === tool || entry.method === tool);
            if (browserTool === undefined) {
              return { exitCode: 1, stderr: `Unknown browser tool. One of: ${BROWSER_TOOL_NAMES.join(", ")}.` };
            }
            const value: unknown = rawArgs === undefined ? {} : JSON.parse(rawArgs);
            const parsed = browserTool.parameters.safeParse(value);
            if (!parsed.success) return { exitCode: 1, stderr: `Invalid arguments: ${parsed.error.message}` };
            const result = await callBrowserTool(await targetHost(), browserTool, parsed.data as Record<string, unknown>, ctx);
            return { exitCode: result.isError ? 1 : 0, stdout: contentText(result) };
          }
          if (action === "on" || action === "off") {
            await saveBrowserExtension(action === "on");
            return { exitCode: 0, stdout: `Browser extension tools: ${action}. New agent sessions pick this up.` };
          }
          if (action !== "status" && action !== "install" && action !== "uninstall") return { exitCode: 1, stderr: USAGE };
          const hostId = await targetHost();
          const bridge = action === "status" ? await bridgeOn(hostId, "status") : await setupBridge(hostId, action);
          const dir = await extensionDir();
          if (json) {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ enabled: browserExtensionOn(), extensionId: UNPACKED_EXTENSION_ID, extensionDir: dir, bridge }),
            };
          }
          const lines = [
            `Browser extension tools: ${browserExtensionOn() ? "on" : "off"}`,
            `Bridge: ${!bridge.supported ? "not supported on this system" : bridge.installed ? "installed" : "not installed"}`,
            ...bridge.browsers
              .filter((entry) => entry.detected)
              .map((entry) => `  ${entry.name}: ${entry.registered ? "set up" : "not set up"}`),
            `Connected: ${bridge.connections.length === 0 ? "none" : bridge.connections.map((entry) => `${entry.browser} ${entry.version} (extension v${entry.extension})`).join(", ")}`,
            `Chrome Web Store: ${EXTENSION_STORE_URL}\nWeb Store id: ${STORE_EXTENSION_ID}\nUnpacked build id: ${UNPACKED_EXTENSION_ID}${dir === null ? "" : `\nUnpacked extension: ${dir}`}`,
          ];
          return { exitCode: 0, stdout: lines.join("\n") };
        }
        if (command === "grant") {
          const result = await grantPermissions(await targetHost());
          return { exitCode: result.ok ? 0 : 1, stdout: json ? JSON.stringify(result) : result.output };
        }
        return { exitCode: command === undefined || command === "help" ? 0 : 1, stdout: USAGE };
      } catch (error) {
        return { exitCode: 1, stderr: errorMessage(error) };
      }
    },
  };
}
