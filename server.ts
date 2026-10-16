import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  META_TOOLS,
  PERMISSIVE_SCHEMA,
  agentToolName,
  driverToolName,
  overridableSchema,
  forwardableArguments,
} from "./src/catalog.js";
import { cuaCli } from "./src/cli.js";
import { errorMessage } from "./src/errors.js";
import { BROWSER_TOOLS, BROWSER_TOOL_NAMES, browserToolResult, type BrowserTool } from "./src/browser-tools.js";
import {
  IDLE_INSTALL_STATE,
  browserBridgeStateSchema,
  catalogToolSchema,
  driverStatusSchema,
  hostContract,
  hostSignals,
  installStateSchema,
  type CatalogTool,
  type DriverGrant,
  type BrowserBridgeState,
  type DriverStatus,
  type InstallState,
  type ToolCallResult,
} from "./src/contract.js";
import { diffCatalogs, driftView, formatDrift, hasDrift, summarizeDrift, type DriftReport } from "./src/drift.js";
import { firstSentence, isReadOnly, normalizeDriverTools, type DriverCatalog, type DriverTool } from "./src/driver-tools.js";
import {
  EXPOSURES,
  TOOL_GROUPS,
  defaultExposure,
  groupOf,
  isManaged,
  mayAskFirst,
  normalizeOverrides,
  presentationFor,
  requestsExistingProfile,
  resolveExposure,
  sensitiveAction,
  type Exposure,
  type ExposureInputs,
  type ToolGroup,
} from "./src/exposure.js";
import {
  DEFAULT_POLICY,
  PROVIDER_OVERRIDES,
  ROUTING_MODES,
  describeDecision,
  hasNativeComputerUse,
  normalizeProviderOverrides,
  parseRoutingMode,
  resolveProviderDecision,
  type ProviderOverride,
  type RoutingMode,
  type RoutingPolicy,
} from "./src/policy.js";
import { CUA_INSTALL_DOCS_URL, UNPACKED_EXTENSION_ID, manualInstallCommands } from "./src/links.js";
import { SNAPSHOT_CATALOG, TESTED_DRIVER_VERSION } from "./src/snapshot.js";

const MODE_KEY = "routing-mode";
/** On only when the user turns the optional browser extension on in the Browser extension section. */
const BROWSER_EXTENSION_KEY = "browser-extension";
const OVERRIDES_KEY = "policy-overrides";
const EXPOSURE_KEY = "tool-exposure";
const STATUS_KEY_PREFIX = "driver-status:";
const CATALOG_KEY_PREFIX = "catalog:";
const SKILL_NAME = "cua-computer-use";
const REALTIME_CHANNEL = "state-changed";
const SESSION_LABEL_MAX = 125;
const STATUS_FRESH_MS = 30_000;
const SETTINGS_PATH = "/settings/plugins/computer-use";
/** bb's limits: tool ids per selection, and bytes per kv value. */
const SELECTION_MAX_IDS = 256;
const KV_VALUE_MAX_BYTES = 256 * 1024;
const AGENT_TOOL_NAME = /^[a-zA-Z0-9_-]+$/;
/** The app's pendingInteraction renderer for approving a sensitive call. */
export const APPROVAL_RENDERER = "approve-tool";
const APPROVAL_TIMEOUT_MS = 10 * 60_000;
const APPROVAL_ARGUMENTS_MAX = 2_000;

const INSTALL_INSTRUCTIONS = [
  `Install Cua Driver ${TESTED_DRIVER_VERSION} (the version this plugin was tested with) on the machine that runs this thread:`,
  `  From bb: open ${SETTINGS_PATH}, expand the machine, and select Install Cua Driver; or run \`bb cua install --yes\`.`,
  `  macOS/Linux: ${manualInstallCommands(TESTED_DRIVER_VERSION).posix}`,
  `  Windows:     ${manualInstallCommands(TESTED_DRIVER_VERSION).windows}`,
  "Then run `cua-driver doctor`. On macOS also run `cua-driver permissions grant` and approve Accessibility and Screen Recording.",
  `Docs: ${CUA_INSTALL_DOCS_URL}`,
].join("\n");

const providerViewSchema = z
  .object({
    id: z.string(),
    displayName: z.string(),
    available: z.boolean(),
    native: z.boolean(),
    override: z.enum(PROVIDER_OVERRIDES),
    decision: z.enum(["cua", "native", "off"]),
    decisionLabel: z.string(),
  })
  .strict();

const driftViewSchema = z
  .object({
    testedVersion: z.string().nullable(),
    driverVersion: z.string().nullable(),
    added: z.array(z.string()),
    removed: z.array(z.string()),
    changed: z.array(z.object({ name: z.string(), details: z.array(z.string()) }).strict()),
    drifted: z.boolean(),
    summary: z.string(),
  })
  .strict();

const hostViewSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    status: z.enum(["connected", "disconnected"]),
    driver: driverStatusSchema.nullable(),
    install: installStateSchema,
    /** Null until the plugin has read this machine's own tool list. */
    drift: driftViewSchema.nullable(),
  })
  .strict();

const toolViewSchema = z
  .object({
    name: z.string(),
    group: z.enum(TOOL_GROUPS),
    exposure: z.enum(EXPOSURES),
    defaultExposure: z.enum(EXPOSURES),
    source: z.enum(["reviewed", "unreviewed"]),
    override: z.enum(EXPOSURES).nullable(),
    groupEnabled: z.boolean(),
    readOnly: z.boolean(),
    /** True when calls ask the user first (Ask before sensitive actions is on). */
    asksFirst: z.boolean(),
    summary: z.string(),
  })
  .strict();

const stateSchema = z
  .object({
    mode: z.enum(ROUTING_MODES),
    groups: z.object({ browser: z.boolean(), clipboard: z.boolean() }).strict(),
    testedVersion: z.string(),
    providers: z.array(providerViewSchema),
    hosts: z.array(hostViewSchema),
    tools: z.array(toolViewSchema),
  })
  .strict();

const hostInput = z.object({ hostId: z.string().min(1) }).strict();


const browserViewSchema = z
  .object({
    enabled: z.boolean(),
    extensionId: z.string(),
    /** The unpacked extension folder when the plugin runs from a local checkout. */
    extensionDir: z.string().nullable(),
    hosts: z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          bridge: browserBridgeStateSchema.nullable(),
          error: z.string().nullable(),
        })
        .strict(),
    ),
  })
  .strict();

export const rpcContract = defineRpcContract({
  getState: { input: z.null(), output: stateSchema },
  setMode: { input: z.object({ mode: z.enum(ROUTING_MODES) }).strict(), output: stateSchema },
  setOverride: {
    input: z.object({ providerId: z.string().min(1), override: z.enum(PROVIDER_OVERRIDES) }).strict(),
    output: stateSchema,
  },
  setExposure: {
    input: z.object({ tool: z.string().min(1), exposure: z.enum([...EXPOSURES, "default"]) }).strict(),
    output: stateSchema,
  },
  refreshStatus: { input: hostInput, output: driverStatusSchema },
  listTools: { input: hostInput, output: z.object({ tools: z.array(catalogToolSchema) }).strict() },
  installDriver: {
    input: z.object({ hostId: z.string().min(1), target: z.enum(["tested", "latest"]) }).strict(),
    output: installStateSchema,
  },
  installState: { input: hostInput, output: installStateSchema },
  grantPermissions: { input: hostInput, output: z.object({ ok: z.boolean(), output: z.string() }).strict() },
  browserState: { input: z.null(), output: browserViewSchema },
  setBrowserExtension: { input: z.object({ enabled: z.boolean() }).strict(), output: browserViewSchema },
  browserSetup: {
    input: z.object({ hostId: z.string().min(1), action: z.enum(["install", "uninstall"]) }).strict(),
    output: browserViewSchema,
  },
});

/** What the settings app reads: getState and browserState. */
export type State = z.infer<typeof stateSchema>;
export type ToolView = z.infer<typeof toolViewSchema>;
export type BrowserView = z.infer<typeof browserViewSchema>;

interface SettingsSnapshot {
  browserTools: boolean;
  clipboardTools: boolean;
  signedInBrowserProfiles: boolean;
  confirmSensitiveTools: boolean;
  sessionPrefix: string;
}

/** A machine's catalog with a name index and its drift from the tested release. */
export interface IndexedCatalog {
  catalog: DriverCatalog;
  byName: Map<string, DriverTool>;
  /** Null for the bundled snapshot, which is not any machine's own list. */
  drift: DriftReport | null;
}

/** A machine's own catalog, as its driver reported it, so its drift is known. */
interface MachineCatalog extends IndexedCatalog {
  drift: DriftReport;
}

function indexByName(catalog: DriverCatalog): Map<string, DriverTool> {
  return new Map(catalog.tools.map((tool) => [tool.name, tool]));
}

function indexMachineCatalog(catalog: DriverCatalog): MachineCatalog {
  return { catalog, byName: indexByName(catalog), drift: diffCatalogs(SNAPSHOT_CATALOG, catalog) };
}

const SNAPSHOT_INDEX: IndexedCatalog = { catalog: SNAPSHOT_CATALOG, byName: indexByName(SNAPSHOT_CATALOG), drift: null };

/** `<prefix>-<suffix>` within the label limit. The prefix gives way, so the suffix that makes the label unique stays whole. */
function sessionLabel(prefix: string, suffix: string): string {
  const tail = suffix.replace(/[^A-Za-z0-9._-]+/g, "-");
  const head = prefix.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, Math.max(0, SESSION_LABEL_MAX - tail.length - 1));
  return head.length > 0 ? `${head}-${tail}` : tail;
}

function missingMacPermissions(status: DriverStatus): string[] {
  if (status.platform !== "darwin" || !status.installed) return [];
  const missing: string[] = [];
  if (status.permissions?.accessibility !== true) missing.push("Accessibility");
  if (status.permissions?.screenRecording !== true) missing.push("Screen Recording");
  return missing;
}

function readinessLine(status: DriverStatus | null): string {
  if (status === null) {
    return `Cua Driver readiness on this machine is unknown; call cua_status before the first desktop action. Setup: ${SETTINGS_PATH}`;
  }
  if (!status.installed) return `Cua Driver is NOT installed on this machine. ${INSTALL_INSTRUCTIONS}`;
  const version = status.version ?? "(unknown version)";
  const parts = [
    status.version === TESTED_DRIVER_VERSION
      ? `Cua Driver ${version} is installed (the version this plugin was tested with).`
      : `Cua Driver ${version} is installed; this plugin was tested with ${TESTED_DRIVER_VERSION}.`,
  ];
  const missing = missingMacPermissions(status);
  if (missing.length > 0) {
    parts.push(
      `macOS permissions are missing or unconfirmed: ${missing.join(", ")}. Open ${SETTINGS_PATH}, expand this machine, and select Grant macOS permissions.`,
    );
  }
  if (status.daemonRunning === false) parts.push("The driver service was not running at last check; the first call starts it on demand.");
  return parts.join(" ");
}

function updateLine(status: DriverStatus): string | null {
  if (!status.installed) return null;
  if (status.version !== TESTED_DRIVER_VERSION) {
    return `Install the tested version with \`bb cua update --yes\`, or keep this one.`;
  }
  if (status.updateAvailable === true && status.latestVersion !== null) {
    return `Cua Driver ${status.latestVersion} is available but untested with this plugin (\`bb cua update --latest --yes\`).`;
  }
  return null;
}

function setupGuidance(status: DriverStatus, hostId: string): string | null {
  if (!status.installed) {
    return [
      "Desktop & Browser Agent setup is required because Cua Driver is not installed on this machine.",
      `[Open Desktop & Browser Agent settings](${SETTINGS_PATH}), expand this machine, and select **Install Cua Driver**.`,
      `CLI alternative: \`bb cua install --yes --host ${hostId}\`. Retry the tool after the checklist shows Ready.`,
    ].join("\n\n");
  }
  const missing = missingMacPermissions(status);
  if (missing.length === 0) return null;
  return [
    `Desktop & Browser Agent setup is required. macOS permissions are missing or unconfirmed: **${missing.join(", ")}**.`,
    `[Open Desktop & Browser Agent settings](${SETTINGS_PATH}), expand this machine, and select **Grant macOS permissions**. Approve the system prompts; a one-time direct-capture prompt may also appear on the first screenshot.`,
    `CLI alternative: \`bb cua grant --host ${hostId}\`. Retry the tool after the checklist shows Ready.`,
  ].join("\n\n");
}

function toolResultText(result: ToolCallResult): string {
  const content = result.content.map((part) => (part.type === "text" ? part.text : "")).join("\n");
  if (result.structured === undefined) return content;
  try {
    return `${content}\n${JSON.stringify(result.structured)}`;
  } catch {
    return content;
  }
}

/** Who a driver call is for (its thread, which sets the session and approvals) and the caller's abort signal. */
export interface CallOptions {
  threadId?: string;
  signal?: AbortSignal;
}

/** Options for a host call to one machine. The signal is passed only when there is one. */
function hostCallOptions(hostId: string, signal?: AbortSignal): { hostId: string; signal?: AbortSignal } {
  return { hostId, ...(signal === undefined ? {} : { signal }) };
}

/** Cua Driver ends a session with its transport; reusing the label is then refused. */
function isEndedSessionFailure(result: ToolCallResult): boolean {
  return result.isError && /session '[^']*' has ended/i.test(toolResultText(result));
}

/** The driver's refusal code, from its structured content or its `refused (<code>)` text. */
function refusalCode(result: ToolCallResult): string | null {
  const refusal = (result.structured as { refusal?: { code?: unknown } } | null | undefined)?.refusal;
  if (typeof refusal?.code === "string") return refusal.code;
  return /refused \(([a-z_]+)\)/.exec(toolResultText(result))?.[1] ?? null;
}

/**
 * A macOS privacy grant is missing. Other refusals carry their own next step
 * and often mention the accessibility tree, so they are passed through as-is.
 */
export function isPermissionFailure(result: ToolCallResult): boolean {
  if (!result.isError) return false;
  const code = refusalCode(result);
  if (code !== null) return /permission|^tcc_/.test(code);
  return /permissions?_pending|tcc_(?:accessibility|screen_recording)|(?:accessibility|screen recording)(?: permission)? (?:is )?not granted|AX is not trusted|direct[_ -]?capture/i.test(
    toolResultText(result),
  );
}

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    browserTools: {
      type: "boolean",
      label: "Browser window tools (Cua Driver)",
      description:
        "Offer Cua Driver's cua_browser_* tools, which work in a Chrome, Edge, Brave or Electron window without an extension. Off turns the group off, cua_call included. The extension's browser_* tools have their own switch under Browser extension.",
      default: true,
    },
    clipboardTools: {
      type: "boolean",
      label: "Clipboard tools",
      description: "Offer cua_clipboard_read and cua_clipboard_write. Off turns them off, cua_call included.",
      default: true,
    },
    signedInBrowserProfiles: {
      type: "boolean",
      label: "Signed-in browser profiles",
      description:
        "Let the browser window tools (Cua Driver) attach to an existing, signed-in Chrome, Edge, or Brave window and work in a tab while you use other tabs. The first attach brings the browser to the front once. The browser extension does not need this. On macOS this restarts Cua Driver with --grant existing-profile. Turning it off blocks those attaches at once; the running service keeps the grant until it restarts (cua-driver stop).",
      default: false,
    },
    confirmSensitiveTools: {
      type: "boolean",
      label: "Ask before sensitive actions",
      description:
        "Ask in the thread before an agent reads clipboard text, writes the clipboard, captures the whole screen, uploads or downloads files, attaches to a signed-in browser, first uses the browser extension in a thread, or uses a tool that runs code, force-quits apps, records the screen, or changes the driver. Off runs them without asking.",
      default: false,
    },
    sessionPrefix: {
      type: "string",
      label: "Session label prefix",
      description: "Each active bb thread run gets its own Cua session label beginning with <prefix>-<threadId>, shown in the agent cursor badge.",
      default: "bb",
    },
  });

  function toSnapshot(values: {
    browserTools: boolean;
    clipboardTools: boolean;
    signedInBrowserProfiles: boolean;
    confirmSensitiveTools: boolean;
    sessionPrefix: string;
  }): SettingsSnapshot {
    return {
      browserTools: values.browserTools,
      clipboardTools: values.clipboardTools,
      signedInBrowserProfiles: values.signedInBrowserProfiles,
      confirmSensitiveTools: values.confirmSensitiveTools,
      sessionPrefix: values.sessionPrefix.trim().length > 0 ? values.sessionPrefix.trim() : "bb",
    };
  }

  let settingsNow: SettingsSnapshot = toSnapshot(await settings.get());
  settings.onChange((next) => {
    settingsNow = toSnapshot(next);
    bb.realtime.publish(REALTIME_CHANNEL, { reason: "settings" });
  });

  /**
   * Up to 0.3 the mode was a declared setting, which bb also rendered in its
   * Configuration form next to the Routing mode card. Carry a stored value over.
   */
  async function legacyMode(): Promise<RoutingMode | null> {
    try {
      const { values } = await bb.sdk.plugins.getSettings({ pluginId: bb.pluginId });
      const legacy = parseRoutingMode(values.mode);
      if (legacy !== null) await bb.storage.kv.set(MODE_KEY, legacy);
      return legacy;
    } catch (error) {
      bb.log.debug(`reading the old mode setting failed: ${errorMessage(error)}`);
      return null;
    }
  }

  /** The routing policy in force. Changes replace it; nothing mutates it in place. */
  let routing: RoutingPolicy = {
    mode: parseRoutingMode(await bb.storage.kv.get<unknown>(MODE_KEY)) ?? (await legacyMode()) ?? DEFAULT_POLICY.mode,
    overrides: normalizeProviderOverrides(await bb.storage.kv.get<unknown>(OVERRIDES_KEY)),
  };
  let exposureOverrides = normalizeOverrides(await bb.storage.kv.get<unknown>(EXPOSURE_KEY));
  let browserExtension = (await bb.storage.kv.get<unknown>(BROWSER_EXTENSION_KEY)) === true;
  const statusCache = new Map<string, DriverStatus>();
  const statusRefreshedAt = new Map<string, number>();
  const installByHost = new Map<string, InstallState>();
  const hostByThread = new Map<string, string>();
  const activeSessions = new Map<string, { hostId: string; label: string }>();
  /** Each machine's own catalog, once read; machines not read yet use the bundled snapshot. */
  const hostCatalogs = new Map<string, IndexedCatalog>();
  /** The last raw tools/list per machine, for full descriptions in cua_describe. */
  const rawTools = new Map<string, Map<string, CatalogTool>>();
  const catalogReads = new Map<string, Promise<MachineCatalog>>();
  const registered = new Set<string>();
  /** Sensitive actions the user allowed for the rest of a thread. */
  const approvedForThread = new Map<string, Set<string>>();
  const sessionEpoch = Date.now().toString(36);
  let sessionCounter = 0;

  function grants(): DriverGrant[] {
    return settingsNow.signedInBrowserProfiles ? ["existing-profile"] : [];
  }

  function enabledGroups(): Set<ToolGroup> {
    const groups = new Set<ToolGroup>(["desktop"]);
    if (settingsNow.browserTools) groups.add("browser");
    if (settingsNow.clipboardTools) groups.add("clipboard");
    return groups;
  }

  function exposureInputs(): ExposureInputs {
    return { overrides: exposureOverrides, enabledGroups: enabledGroups() };
  }

  /** A dropped connection ended every session it carried; mint new labels next time. */
  function forgetHostSessions(hostId: string): void {
    for (const [threadId, session] of activeSessions) {
      if (session.hostId === hostId) activeSessions.delete(threadId);
    }
  }

  /** Records whether a machine is connected, and keeps it so a restart does not show a stale connection. */
  function setConnected(hostId: string, connected: boolean): void {
    const cached = statusCache.get(hostId);
    if (cached === undefined) return;
    const next = { ...cached, connected };
    statusCache.set(hostId, next);
    void bb.storage.kv.set(`${STATUS_KEY_PREFIX}${hostId}`, next);
  }

  function failure(text: string): ToolCallResult {
    return { content: [{ type: "text", text }], isError: true };
  }

  function catalogFor(hostId: string): IndexedCatalog {
    return hostCatalogs.get(hostId) ?? SNAPSHOT_INDEX;
  }

  /** True when the machine runs a driver whose tool list the plugin has not read. */
  function catalogIsStale(hostId: string): boolean {
    const status = statusCache.get(hostId);
    if (status === undefined || !status.installed) return false;
    const own = hostCatalogs.get(hostId);
    return own === undefined || (status.version !== null && own.catalog.driverVersion !== status.version);
  }

  /**
   * Registers `cua_<name>` for a driver tool. Registration is cheap and does
   * not reach any prompt: configure() decides per session which tools to
   * offer and hands each one that machine's exact schema.
   */
  function registerDriverTool(tool: DriverTool): void {
    if (isManaged(tool.name)) return;
    const name = agentToolName(tool.name);
    if (registered.has(name) || !AGENT_TOOL_NAME.test(name)) return;
    const presentation = presentationFor(tool.name, tool);
    try {
      bb.agents.registerTool({
        name,
        description: presentation.description,
        parameters: PERMISSIVE_SCHEMA,
        presentation: { label: presentation.labels },
        execute: (rawArgs, context) => runDriverTool(tool.name, rawArgs, context, "tool"),
      });
      registered.add(name);
    } catch (error) {
      bb.log.warn(`could not register ${name}: ${errorMessage(error)}`);
    }
  }

  async function storeCatalog(hostId: string, catalog: DriverCatalog): Promise<MachineCatalog> {
    const indexed = indexMachineCatalog(catalog);
    const previous = hostCatalogs.get(hostId);
    hostCatalogs.set(hostId, indexed);
    for (const tool of catalog.tools) registerDriverTool(tool);
    const bytes = new TextEncoder().encode(JSON.stringify(catalog)).byteLength;
    if (bytes <= KV_VALUE_MAX_BYTES) {
      await bb.storage.kv.set(`${CATALOG_KEY_PREFIX}${hostId}`, catalog);
    } else {
      bb.log.warn(`catalog for ${hostId} is ${bytes} bytes, over the kv limit; keeping it in memory only`);
    }
    if (previous?.catalog.driverVersion !== catalog.driverVersion) {
      const log = hasDrift(indexed.drift) ? bb.log.info : bb.log.debug;
      log(`host ${hostId}: ${summarizeDrift(indexed.drift)}`);
    }
    bb.realtime.publish(REALTIME_CHANNEL, { reason: "catalog", hostId });
    return indexed;
  }

  /** Reads a machine's tools/list and keeps it as that machine's catalog. Concurrent calls share one read. */
  function readCatalog(hostId: string): Promise<MachineCatalog> {
    const pending = catalogReads.get(hostId);
    if (pending !== undefined) return pending;
    const read = (async () => {
      const result = await host.call("listTools", { grants: grants() }, { hostId });
      rawTools.set(hostId, new Map(result.tools.map((tool) => [tool.name, tool])));
      return storeCatalog(hostId, {
        driverVersion: result.driverVersion ?? statusCache.get(hostId)?.version ?? null,
        tools: normalizeDriverTools(result.tools),
      });
    })().finally(() => catalogReads.delete(hostId));
    catalogReads.set(hostId, read);
    return read;
  }

  function readCatalogIfStale(hostId: string): void {
    if (!catalogIsStale(hostId) || catalogReads.has(hostId)) return;
    void readCatalog(hostId).catch((error: unknown) =>
      bb.log.debug(`reading tools/list from ${hostId} failed: ${errorMessage(error)}`),
    );
  }

  for (const key of await bb.storage.kv.list(STATUS_KEY_PREFIX)) {
    const parsed = driverStatusSchema.safeParse(await bb.storage.kv.get<unknown>(key));
    if (parsed.success) statusCache.set(key.slice(STATUS_KEY_PREFIX.length), parsed.data);
  }
  for (const key of await bb.storage.kv.list(CATALOG_KEY_PREFIX)) {
    const stored = await bb.storage.kv.get<{ driverVersion?: unknown; tools?: unknown }>(key);
    if (stored === null || stored === undefined || !Array.isArray(stored.tools)) continue;
    hostCatalogs.set(
      key.slice(CATALOG_KEY_PREFIX.length),
      indexMachineCatalog({
        driverVersion: typeof stored.driverVersion === "string" ? stored.driverVersion : null,
        tools: normalizeDriverTools(stored.tools),
      }),
    );
  }

  const host = bb.hosts.experimental_client({ contract: hostContract, experimental_signals: hostSignals });

  host.experimental_onSignal("connectionChanged", ({ hostId, payload }) => {
    if (!payload.connected) forgetHostSessions(hostId);
    setConnected(hostId, payload.connected);
    bb.realtime.publish(REALTIME_CHANNEL, { reason: "connection", hostId });
  });
  host.experimental_onSignal("installChanged", ({ hostId, payload }) => {
    const previous = installByHost.get(hostId);
    installByHost.set(hostId, payload);
    bb.realtime.publish(REALTIME_CHANNEL, { reason: "install", hostId });
    if (previous?.running === true && !payload.running) {
      bb.log.info(`Cua Driver install on host ${hostId} finished: ${payload.ok ? "ok" : "failed"}`);
      void refreshStatus(hostId, true).catch((error: unknown) =>
        bb.log.warn(`status refresh after install failed on ${hostId}: ${errorMessage(error)}`),
      );
    }
  });
  host.experimental_onWorkerExit(({ hostId }) => {
    forgetHostSessions(hostId);
    setConnected(hostId, false);
    const install = installByHost.get(hostId);
    if (install?.running === true) {
      installByHost.set(hostId, {
        ...install,
        running: false,
        ok: false,
        step: "failed",
        tail: [...install.tail, "bb lost contact with this machine while the installer was running."],
      });
    }
    bb.realtime.publish(REALTIME_CHANNEL, { reason: "worker-exit", hostId });
  });

  async function refreshStatus(hostId: string, probeDaemon: boolean, signal?: AbortSignal): Promise<DriverStatus> {
    const status = await host.call("status", { probeDaemon }, hostCallOptions(hostId, signal));
    statusCache.set(hostId, status);
    statusRefreshedAt.set(hostId, Date.now());
    await bb.storage.kv.set(`${STATUS_KEY_PREFIX}${hostId}`, status);
    bb.realtime.publish(REALTIME_CHANNEL, { reason: "status", hostId });
    readCatalogIfStale(hostId);
    return status;
  }

  async function resolveHostId(threadId: string): Promise<string> {
    const cached = hostByThread.get(threadId);
    if (cached !== undefined) return cached;
    const thread = await bb.sdk.threads.get({ threadId });
    if (thread.environmentId === null) {
      throw new Error("This thread has no environment, so there is no machine to drive.");
    }
    const environment = await bb.sdk.environments.get({ environmentId: thread.environmentId });
    hostByThread.set(threadId, environment.hostId);
    if (hostByThread.size > 512) {
      const oldest = hostByThread.keys().next().value;
      if (oldest !== undefined) hostByThread.delete(oldest);
    }
    return environment.hostId;
  }

  async function primaryHostId(): Promise<string> {
    const hosts = await bb.sdk.hosts.list();
    const connected = hosts.find((entry) => entry.status === "connected") ?? hosts[0];
    if (connected === undefined) throw new Error("No bb host is available.");
    return connected.id;
  }

  function sessionFor(threadId: string, hostId: string): string {
    const active = activeSessions.get(threadId);
    if (active?.hostId === hostId) return active.label;
    sessionCounter += 1;
    const label = sessionLabel(settingsNow.sessionPrefix, `${threadId}-${sessionEpoch}-${sessionCounter.toString(36)}`);
    activeSessions.set(threadId, { hostId, label });
    return label;
  }

  async function callDriver(hostId: string, name: string, args: Record<string, unknown>, options: CallOptions): Promise<ToolCallResult> {
    const send = (label: string | undefined) =>
      host.call(
        "callTool",
        { name, arguments: args, grants: grants(), ...(label === undefined ? {} : { session: label }) },
        hostCallOptions(hostId, options.signal),
      );
    if (options.threadId === undefined) return send(undefined);
    const result = await send(sessionFor(options.threadId, hostId));
    if (!isEndedSessionFailure(result)) return result;
    // The driver ended this thread's session (for example after an idle
    // disconnect); a fresh label starts a new one. Retry exactly once.
    activeSessions.delete(options.threadId);
    return send(sessionFor(options.threadId, hostId));
  }

  async function statusForTool(hostId: string, signal?: AbortSignal): Promise<DriverStatus> {
    const cached = statusCache.get(hostId);
    const refreshedAt = statusRefreshedAt.get(hostId);
    if (cached !== undefined && refreshedAt !== undefined && Date.now() - refreshedAt < STATUS_FRESH_MS) return cached;
    return refreshStatus(hostId, true, signal);
  }

  /** Why a tool that is turned off is refused, and what the agent should do instead. */
  function offMessage(driverName: string): string {
    const group = groupOf(driverName);
    if (!enabledGroups().has(group)) {
      return `${driverName} belongs to the ${group} tools, which are turned off in Desktop & Browser Agent settings. Do not reach the same capability another way; if the task needs it, ask the user to turn on **${group === "browser" ? "Browser window tools (Cua Driver)" : "Clipboard tools"}** in [Desktop & Browser Agent settings](${SETTINGS_PATH}).`;
    }
    return `${driverName} is turned off for agents in Desktop & Browser Agent settings. Do not reach the same capability another way; if the task needs it, ask the user to allow it under **Agent tools** in [Desktop & Browser Agent settings](${SETTINGS_PATH}) or with \`bb cua expose ${driverName} call\`.`;
  }

  /**
   * While **Ask before sensitive actions** is on, asks in the thread before a
   * sensitive call; returns the refusal when the user does not allow it. A
   * `bb cua call` from a terminal outside any thread is the user's own.
   */
  async function approvalRefusal(
    name: string,
    args: Record<string, unknown>,
    options: CallOptions,
    action: { key: string; reason: string; title?: string } | null = sensitiveAction(name, args),
    shownName = agentToolName(name),
  ): Promise<ToolCallResult | null> {
    if (!settingsNow.confirmSensitiveTools || options.threadId === undefined) return null;
    if (action === null || approvedForThread.get(options.threadId)?.has(action.key)) return null;
    const shown = JSON.stringify(args, null, 2);
    const outcome = await bb.ui.requestInput(
      {
        threadId: options.threadId,
        rendererId: APPROVAL_RENDERER,
        title: action.title ?? `Allow ${shownName}?`,
        payload: {
          tool: name,
          shownName,
          reason: action.reason,
          arguments: shown.length > APPROVAL_ARGUMENTS_MAX ? `${shown.slice(0, APPROVAL_ARGUMENTS_MAX)}…` : shown,
        },
        timeoutMs: APPROVAL_TIMEOUT_MS,
      },
      options.signal ? { signal: options.signal } : undefined,
    );
    if (outcome.outcome === "submitted") {
      const allow = (outcome.value as { allow?: unknown } | null)?.allow;
      if (allow === "thread") {
        const approved = approvedForThread.get(options.threadId) ?? new Set<string>();
        approved.add(action.key);
        approvedForThread.set(options.threadId, approved);
      }
      if (allow === "once" || allow === "thread") {
        bb.log.info(`${name} approved ${allow === "thread" ? "for thread" : "once in thread"} ${options.threadId}`);
        return null;
      }
    }
    const why =
      outcome.outcome === "cancelled" && outcome.reason === "timeout"
        ? "No one answered the approval request in time"
        : outcome.outcome === "cancelled" && outcome.reason !== "user"
          ? `The approval request was cancelled (${outcome.reason})`
          : "The user did not allow it";
    return failure(
      `${why}: ${name} would ${action.reason}. Do not reach the same result another way; continue without it, or ask the user what to do.`,
    );
  }

  /**
   * Every driver call goes through here: dedicated tools, cua_call, and
   * `bb cua call` share one exposure gate.
   */
  async function callConfiguredDriver(
    hostId: string,
    name: string,
    args: Record<string, unknown>,
    options: CallOptions,
  ): Promise<ToolCallResult> {
    if (isManaged(name)) {
      return failure(`${name} is managed by the Desktop & Browser Agent plugin: every thread gets its own Cua session automatically.`);
    }
    const known = catalogFor(hostId).byName.get(name);
    if (known !== undefined && resolveExposure(name, known, exposureInputs()) === "off") return failure(offMessage(name));
    if (!settingsNow.signedInBrowserProfiles && requestsExistingProfile(name, args)) {
      return failure(
        `Attaching to a signed-in browser profile is turned off. Ask the user to turn on **Signed-in browser profiles** in [Desktop & Browser Agent settings](${SETTINGS_PATH}) if they want this, or work in a separate browser.`,
      );
    }
    const status = await statusForTool(hostId, options.signal);
    const guidance = setupGuidance(status, hostId);
    if (guidance !== null) return failure(guidance);
    if (known === undefined) {
      // The driver may have changed since its tools were last read.
      const tool = (await readCatalog(hostId).catch(() => null))?.byName.get(name);
      if (tool === undefined) {
        return failure(`Cua Driver on this machine has no tool named ${name}. cua_describe lists the tools it has.`);
      }
      if (resolveExposure(name, tool, exposureInputs()) === "off") return failure(offMessage(name));
    }
    const refusal = await approvalRefusal(name, args, options);
    if (refusal !== null) return refusal;

    const result = await callDriver(hostId, name, args, options);
    if (!isPermissionFailure(result)) return result;

    const refreshed = await refreshStatus(hostId, true, options.signal).catch(() => status);
    const recovery =
      setupGuidance(refreshed, hostId) ??
      [
        "Desktop & Browser Agent was blocked by a system permission while using Cua Driver.",
        `[Open Desktop & Browser Agent settings](${SETTINGS_PATH}), expand this machine, run **Grant macOS permissions**, and retry after the checklist shows Ready.`,
        `CLI alternative: \`bb cua grant --host ${hostId}\`.`,
      ].join("\n\n");
    return failure(`${recovery}\n\nDriver detail: ${toolResultText(result).trim().slice(0, 500)}`);
  }

  async function withHost(
    toolName: string,
    context: { threadId: string },
    run: (hostId: string) => Promise<ToolCallResult>,
  ): Promise<ToolCallResult> {
    let hostId: string;
    try {
      hostId = await resolveHostId(context.threadId);
    } catch (error) {
      return failure(errorMessage(error));
    }
    try {
      return await run(hostId);
    } catch (error) {
      const message = errorMessage(error);
      bb.log.warn(`${toolName} failed on host ${hostId}: ${message}`);
      return failure(
        `${message}\n\n[Open Desktop & Browser Agent settings](${SETTINGS_PATH}), expand this machine, check its setup, and retry.`,
      );
    }
  }

  function runDriverTool(
    driverName: string,
    rawArgs: unknown,
    context: { threadId: string; signal: AbortSignal },
    via: "tool" | "call",
  ): Promise<ToolCallResult> {
    const args = forwardableArguments(via === "tool" ? agentToolName(driverName) : driverName, rawArgs);
    if (!args.ok) return Promise.resolve(failure(args.error));
    return withHost(agentToolName(driverName), context, (hostId) =>
      callConfiguredDriver(hostId, driverName, args.value, context),
    );
  }

  function describeCatalog(hostId: string): string {
    const indexed = catalogFor(hostId);
    const inputs = exposureInputs();
    const buckets: Record<Exposure, string[]> = { tool: [], call: [], off: [] };
    for (const tool of indexed.catalog.tools) {
      if (isManaged(tool.name)) continue;
      const exposure = resolveExposure(tool.name, tool, inputs);
      const name = exposure === "tool" ? agentToolName(tool.name) : tool.name;
      buckets[exposure].push(`- ${name}: ${firstSentence(presentationFor(tool.name, tool).description)}`);
    }
    const lines: string[] = [];
    if (indexed.drift === null) {
      lines.push(`This machine's own tool list has not been read yet; showing the tested Cua Driver ${TESTED_DRIVER_VERSION}.`);
    } else if (hasDrift(indexed.drift)) {
      lines.push(summarizeDrift(indexed.drift));
    }
    lines.push("", "Dedicated tools (call them directly):", ...buckets.tool);
    lines.push("", "Through cua_call {tool, arguments}:", ...(buckets.call.length > 0 ? buckets.call : ["(none)"]));
    lines.push(
      "",
      "Turned off by the user (refused; ask the user if a task needs one):",
      ...(buckets.off.length > 0 ? buckets.off : ["(none)"]),
      "",
      "cua_describe {tool} returns one tool's full description and input schema.",
    );
    return lines.join("\n").trim();
  }

  async function describeTool(hostId: string, requested: string): Promise<ToolCallResult> {
    const driverName = driverToolName(requested);
    if (!rawTools.get(hostId)?.has(driverName)) await readCatalog(hostId).catch(() => null);
    const raw = rawTools.get(hostId)?.get(driverName);
    const tool = catalogFor(hostId).byName.get(driverName);
    if (raw === undefined && tool === undefined) return failure(`Cua Driver on this machine has no tool named ${driverName}.`);
    const exposure = isManaged(driverName) ? "managed by the plugin" : resolveExposure(driverName, tool, exposureInputs());
    const reach =
      exposure === "tool"
        ? `Call it as ${agentToolName(driverName)}.`
        : exposure === "call"
          ? `Call it through cua_call {tool: "${driverName}", arguments: {...}}.`
          : exposure === "off"
            ? "It is turned off for agents; ask the user if the task needs it."
            : "The plugin supplies session arguments itself; do not call it.";
    const schema = raw?.inputSchema ?? tool?.inputSchema ?? {};
    const description = raw?.description ?? tool?.description ?? "";
    return {
      content: [
        {
          type: "text",
          text: [
            `${driverName} (${reach})`,
            "",
            description.trim(),
            "",
            "Input schema (the plugin supplies `session`):",
            JSON.stringify(schema, null, 2),
          ].join("\n"),
        },
      ],
      isError: false,
    };
  }

  function statusReport(hostId: string, status: DriverStatus): string {
    const lines = [readinessLine(status)];
    const update = updateLine(status);
    if (update !== null) lines.push(update);
    const drift = hostCatalogs.get(hostId)?.drift;
    if (drift !== undefined && drift !== null && hasDrift(drift)) lines.push(formatDrift(drift));
    return lines.join("\n");
  }

  const metaHandlers: Record<string, (args: Record<string, unknown>, context: { threadId: string; signal: AbortSignal }) => Promise<ToolCallResult>> = {
    cua_call: (args, context) => {
      const driverName = driverToolName(typeof args.tool === "string" ? args.tool : "");
      return runDriverTool(driverName, args.arguments ?? {}, context, "call");
    },
    cua_describe: (args, context) =>
      withHost("cua_describe", context, async (hostId) => {
        if (typeof args.tool === "string") return describeTool(hostId, args.tool);
        if (catalogIsStale(hostId) || !hostCatalogs.has(hostId)) await readCatalog(hostId).catch(() => null);
        return { content: [{ type: "text", text: describeCatalog(hostId) }], isError: false };
      }),
    cua_status: (_args, context) =>
      withHost("cua_status", context, async (hostId) => {
        const status = await refreshStatus(hostId, true, context.signal);
        if (catalogIsStale(hostId)) await readCatalog(hostId).catch(() => null);
        return {
          content: [{ type: "text", text: `${statusReport(hostId, status)}\n\n${JSON.stringify(status, null, 2)}` }],
          isError: false,
        };
      }),
  };

  for (const meta of META_TOOLS) {
    const handler = metaHandlers[meta.name];
    if (handler === undefined) throw new Error(`Meta tool ${meta.name} has no handler.`);
    bb.agents.registerTool({
      name: meta.name,
      description: meta.description,
      parameters: meta.parameters,
      presentation: { label: meta.labels },
      execute: (args, context) => handler(args as Record<string, unknown>, context),
    });
    registered.add(meta.name);
  }
  // One approval covers every browser_* tool in the thread, so the title does not name one.
  const BROWSER_ACTION = {
    key: "browser_extension",
    title: "Allow agents in your browser?",
    reason:
      "work in the tabs of your own signed-in browser, through the Browser Bridge for bb extension. One answer covers every browser_* tool in this thread",
  };

  /** One browser_* call: the setting, the approval, then the extension on the thread's machine. */
  async function callBrowserTool(
    hostId: string,
    tool: BrowserTool,
    args: Record<string, unknown>,
    options: CallOptions,
  ): Promise<ToolCallResult> {
    if (!browserExtension) {
      return failure(
        `The browser extension is turned off. Do not reach the same capability another way; if the task needs it, ask the user to turn on **Offer \`browser_*\` tools (extension)** in the **Browser extension** card of [Desktop & Browser Agent settings](${SETTINGS_PATH}).`,
      );
    }
    const refusal = await approvalRefusal(tool.name, args, options, BROWSER_ACTION, tool.name);
    if (refusal !== null) return refusal;
    const { browser, ...params } = args;
    const reply = await host.call(
      "browserCall",
      { method: tool.method, params, ...(typeof browser === "string" && browser !== "" ? { browser } : {}) },
      hostCallOptions(hostId, options.signal),
    );
    return browserToolResult(tool, reply, SETTINGS_PATH);
  }

  for (const tool of BROWSER_TOOLS) {
    bb.agents.registerTool({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      presentation: { label: tool.labels },
      execute: (args, context) =>
        withHost(tool.name, context, (hostId) => callBrowserTool(hostId, tool, args as Record<string, unknown>, context)),
    });
    registered.add(tool.name);
  }
  for (const tool of SNAPSHOT_CATALOG.tools) registerDriverTool(tool);
  for (const indexed of hostCatalogs.values()) for (const tool of indexed.catalog.tools) registerDriverTool(tool);

  /** Dedicated tools for one machine, each with that machine's own schema. */
  function dedicatedSelections(hostId: string, reserved: number): Array<{ name: string; parameters: Record<string, unknown> }> {
    const inputs = exposureInputs();
    const selections: Array<{ name: string; parameters: Record<string, unknown> }> = [];
    for (const tool of catalogFor(hostId).catalog.tools) {
      if (resolveExposure(tool.name, tool, inputs) !== "tool") continue;
      const name = agentToolName(tool.name);
      if (!registered.has(name)) continue;
      selections.push({ name, parameters: overridableSchema(tool.inputSchema) ?? PERMISSIVE_SCHEMA });
    }
    return selections.slice(0, SELECTION_MAX_IDS - META_TOOLS.length - reserved);
  }

  bb.agents.configure((context) => {
    const decision = resolveProviderDecision(routing, context.provider.id);
    if (decision !== "cua") return { tools: [], skills: [] };
    const hostId = context.host.id;
    const status = statusCache.get(hostId) ?? null;
    readCatalogIfStale(hostId);
    const drift = hostCatalogs.get(hostId)?.drift ?? null;
    const instructions = [
      `Cua Driver computer use is available on ${context.host.name} through the cua_* tools.`,
      readinessLine(status),
    ];
    if (drift !== null && hasDrift(drift)) {
      instructions.push(`${summarizeDrift(drift)} New tools that are not read-only stay off until the user allows them.`);
    }
    instructions.push(
      "Some driver tools have no dedicated cua_* tool and are reached through cua_call; cua_describe lists every tool and how to reach it.",
      "A tool refused as turned off was disabled by the user: do not reach the same capability another way (a shell, AppleScript, another tool); ask the user.",
    );
    if (settingsNow.confirmSensitiveTools) {
      instructions.push(
        "Sensitive actions (clipboard text, whole-screen capture, file uploads and downloads, attaching to a signed-in browser, the browser_* tools) wait for the user to approve them in the thread. If one is not allowed, continue without it.",
      );
    }
    instructions.push(
      `If a tool reports that setup is required, stop and give the user its ${SETTINGS_PATH} link instead of retrying.`,
      "Follow the cua-computer-use skill: snapshot with cua_get_window_state before element actions, act with cua_run_steps, and verify afterwards.",
    );
    const browserTools = browserExtension ? BROWSER_TOOL_NAMES : [];
    if (browserTools.length > 0) {
      instructions.push(
        "For web pages in the user's own browser, prefer the browser_* tools (Browser Bridge for bb extension) over cua_* browser and desktop tools: they work in background tabs while the user keeps using the browser. Start with browser_tabs or browser_open, read with browser_read, and act by ref. If one reports that setup is needed, tell the user instead of switching to cua_* tools.",
      );
    }
    return {
      tools: [...META_TOOLS.map((meta) => meta.name), ...browserTools, ...dedicatedSelections(hostId, browserTools.length)],
      skills: [SKILL_NAME],
      instructions: instructions.join("\n"),
    };
  });

  /**
   * The settings view of each tool in these catalogs, sorted by name. A name
   * listed by several catalogs takes the last one's entry.
   */
  function toolViews(catalogs: IndexedCatalog[] = [SNAPSHOT_INDEX, ...hostCatalogs.values()], summaryLimit?: number): ToolView[] {
    const known = new Map<string, DriverTool>();
    for (const indexed of catalogs) for (const tool of indexed.catalog.tools) known.set(tool.name, tool);
    const inputs = exposureInputs();
    const views: ToolView[] = [];
    for (const [name, tool] of known) {
      if (isManaged(name)) continue;
      const fallback = defaultExposure(name, tool);
      views.push({
        name,
        group: groupOf(name),
        exposure: resolveExposure(name, tool, inputs),
        defaultExposure: fallback.exposure,
        source: fallback.source === "unreviewed" ? "unreviewed" : "reviewed",
        override: exposureOverrides[name] ?? null,
        groupEnabled: inputs.enabledGroups.has(groupOf(name)),
        readOnly: isReadOnly(tool),
        asksFirst: settingsNow.confirmSensitiveTools && mayAskFirst(name),
        summary: firstSentence(presentationFor(name, tool).description, summaryLimit),
      });
    }
    return views.sort((a, b) => a.name.localeCompare(b.name));
  }

  async function buildState(): Promise<State> {
    const current = routing;
    const [providers, hosts] = await Promise.all([bb.sdk.providers.list(), bb.sdk.hosts.list()]);
    return {
      mode: current.mode,
      groups: { browser: settingsNow.browserTools, clipboard: settingsNow.clipboardTools },
      testedVersion: TESTED_DRIVER_VERSION,
      providers: providers.map((provider) => {
        const decision = resolveProviderDecision(current, provider.id);
        return {
          id: provider.id,
          displayName: provider.displayName,
          available: provider.available,
          native: hasNativeComputerUse(provider.id),
          override: current.overrides[provider.id] ?? "inherit",
          decision,
          decisionLabel: describeDecision(decision),
        };
      }),
      hosts: hosts.map((entry) => {
        const drift = hostCatalogs.get(entry.id)?.drift ?? null;
        return {
          id: entry.id,
          name: entry.name,
          status: entry.status === "connected" ? "connected" : "disconnected",
          driver: statusCache.get(entry.id) ?? null,
          install: installByHost.get(entry.id) ?? IDLE_INSTALL_STATE,
          drift: drift === null ? null : driftView(drift),
        };
      }),
      tools: toolViews(),
    };
  }

  async function saveOverride(providerId: string, override: ProviderOverride): Promise<void> {
    const next = { ...routing.overrides };
    if (override === "inherit") delete next[providerId];
    else next[providerId] = override;
    routing = { ...routing, overrides: next };
    await bb.storage.kv.set(OVERRIDES_KEY, next);
    bb.realtime.publish(REALTIME_CHANNEL, { reason: "policy" });
  }

  async function saveExposure(tool: string, exposure: Exposure | "default"): Promise<void> {
    const name = driverToolName(tool);
    if (isManaged(name)) throw new Error(`${name} is managed by the plugin and cannot be exposed.`);
    const next = { ...exposureOverrides };
    if (exposure === "default") delete next[name];
    else next[name] = exposure;
    exposureOverrides = normalizeOverrides(next);
    await bb.storage.kv.set(EXPOSURE_KEY, exposureOverrides);
    bb.log.info(`tool exposure: ${name} → ${exposure}`);
    bb.realtime.publish(REALTIME_CHANNEL, { reason: "exposure" });
  }

  async function saveMode(next: RoutingMode): Promise<void> {
    await bb.storage.kv.set(MODE_KEY, next);
    routing = { ...routing, mode: next };
    bb.realtime.publish(REALTIME_CHANNEL, { reason: "policy" });
  }

  /** Status, then the machine's tool list when its driver version changed. */
  async function refreshHost(hostId: string): Promise<DriverStatus> {
    const status = await refreshStatus(hostId, true);
    if (catalogIsStale(hostId)) {
      await readCatalog(hostId).catch((error: unknown) =>
        bb.log.debug(`reading tools/list from ${hostId} failed: ${errorMessage(error)}`),
      );
    }
    return status;
  }

  /** The unpacked extension folder, when bb runs this plugin from a local checkout. */
  async function extensionDir(): Promise<string | null> {
    try {
      const source = await bb.sdk.plugins.getSource({ pluginId: bb.pluginId });
      const root = [source.resolved, source.requested]
        .map((value) => (value.startsWith("path:") ? value.slice("path:".length) : value))
        .find((value) => value.startsWith("/"));
      if (root === undefined) return null;
      const base = source.subdirectory ? `${root.replace(/\/+$/, "")}/${source.subdirectory}` : root.replace(/\/+$/, "");
      return `${base}/browser-extension/dist`;
    } catch (error) {
      bb.log.debug(`reading the plugin source failed: ${errorMessage(error)}`);
      return null;
    }
  }

  async function bridgeOn(hostId: string, action: "status" | "install" | "uninstall"): Promise<BrowserBridgeState> {
    return host.call("browserBridge", { action }, { hostId });
  }

  async function buildBrowserView(): Promise<BrowserView> {
    const [hosts, dir] = await Promise.all([bb.sdk.hosts.list(), extensionDir()]);
    return {
      enabled: browserExtension,
      extensionId: UNPACKED_EXTENSION_ID,
      extensionDir: dir,
      hosts: await Promise.all(
        hosts
          .filter((entry) => entry.status === "connected")
          .map(async (entry) => {
            try {
              return { id: entry.id, name: entry.name, bridge: await bridgeOn(entry.id, "status"), error: null };
            } catch (error) {
              return { id: entry.id, name: entry.name, bridge: null, error: errorMessage(error) };
            }
          }),
      ),
    };
  }

  async function saveBrowserExtension(enabled: boolean): Promise<void> {
    await bb.storage.kv.set(BROWSER_EXTENSION_KEY, enabled);
    browserExtension = enabled;
    bb.log.info(`browser extension tools ${enabled ? "on" : "off"}`);
    bb.realtime.publish(REALTIME_CHANNEL, { reason: "settings" });
  }

  async function setupBridge(hostId: string, action: "install" | "uninstall"): Promise<BrowserBridgeState> {
    const state = await bridgeOn(hostId, action);
    bb.log.info(`browser bridge ${action} on host ${hostId} (user-initiated)`);
    bb.realtime.publish(REALTIME_CHANNEL, { reason: "browser", hostId });
    return state;
  }

  bb.rpc.register(rpcContract, {
    getState: buildState,
    async setMode({ mode }) {
      await saveMode(mode);
      return buildState();
    },
    async setOverride({ providerId, override }) {
      await saveOverride(providerId, override);
      return buildState();
    },
    async setExposure({ tool, exposure }) {
      await saveExposure(tool, exposure);
      return buildState();
    },
    refreshStatus: ({ hostId }) => refreshHost(hostId),
    async listTools({ hostId }) {
      await readCatalog(hostId);
      return { tools: [...(rawTools.get(hostId)?.values() ?? [])] };
    },
    installDriver: ({ hostId, target }) => startInstall(hostId, target === "tested" ? TESTED_DRIVER_VERSION : null),
    installState: ({ hostId }) => readInstallState(hostId),
    grantPermissions: ({ hostId }) => grantPermissions(hostId),
    browserState: buildBrowserView,
    async setBrowserExtension({ enabled }) {
      await saveBrowserExtension(enabled);
      return buildBrowserView();
    },
    async browserSetup({ hostId, action }) {
      await setupBridge(hostId, action);
      return buildBrowserView();
    },
  });

  async function startInstall(hostId: string, version: string | null): Promise<InstallState> {
    const state = await host.call("install", { version }, { hostId });
    installByHost.set(hostId, state);
    bb.log.info(`Cua Driver install of ${version ?? "the newest release"} started on host ${hostId} (user-initiated)`);
    bb.realtime.publish(REALTIME_CHANNEL, { reason: "install", hostId });
    return state;
  }

  async function readInstallState(hostId: string): Promise<InstallState> {
    const state = await host.call("installState", null, { hostId });
    installByHost.set(hostId, state);
    return state;
  }

  async function grantPermissions(hostId: string): Promise<{ ok: boolean; output: string }> {
    const result = await host.call("grantPermissions", null, { hostId });
    await refreshStatus(hostId, true).catch(() => null);
    return result;
  }

  bb.cli.register(
    cuaCli({
      readCatalog,
      hasCatalog: (hostId) => hostCatalogs.has(hostId),
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
      browserExtensionOn: () => browserExtension,
      extensionDir,
      bridgeOn,
      setupBridge,
      callConfiguredDriver,
      callBrowserTool,
      startInstall,
      readInstallState,
      grantPermissions,
    }),
  );

  function endSession(threadId: string): void {
    const active = activeSessions.get(threadId);
    if (active === undefined) return;
    activeSessions.delete(threadId);
    void host
      .call(
        "callTool",
        { name: "end_session", arguments: { session: active.label }, grants: grants() },
        { hostId: active.hostId },
      )
      .catch((error: unknown) => bb.log.debug(`end_session for ${threadId} failed: ${errorMessage(error)}`));
  }
  bb.events.on("thread.idle", ({ thread }) => endSession(thread.id));
  bb.events.on("thread.failed", ({ thread }) => endSession(thread.id));
  bb.events.on("thread.archived", ({ thread }) => {
    endSession(thread.id);
    approvedForThread.delete(thread.id);
  });
  bb.events.on("thread.deleted", ({ thread }) => {
    endSession(thread.id);
    hostByThread.delete(thread.id);
    approvedForThread.delete(thread.id);
  });

  // Learn each connected machine's driver version in the background, so a
  // changed driver is read (and its drift reported) before the next session.
  void bb.sdk.hosts
    .list()
    .then((hosts) =>
      Promise.all(
        hosts
          .filter((entry) => entry.status === "connected")
          .map((entry) =>
            refreshStatus(entry.id, false).catch((error: unknown) =>
              bb.log.debug(`startup status for ${entry.id} failed: ${errorMessage(error)}`),
            ),
          ),
      ),
    )
    .catch((error: unknown) => bb.log.debug(`startup host listing failed: ${errorMessage(error)}`));

  bb.onDispose(() => {
    activeSessions.clear();
    hostByThread.clear();
    approvedForThread.clear();
    statusRefreshedAt.clear();
  });
}
