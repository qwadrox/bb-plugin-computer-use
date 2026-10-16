import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import type { PluginAgentToolResult } from "@get-bb/plugin-sdk";
import { describe, expect, it, vi } from "vitest";
import plugin, { isPermissionFailure } from "./server.js";
import type { CatalogTool, DriverStatus, ToolCallResult } from "./src/contract.js";
import { TESTED_DRIVER_VERSION } from "./src/snapshot.js";
import testedDriver from "./src/driver-snapshot.json";

/** The tested driver's raw tools/list, as a machine running it reports. */
const TESTED_TOOLS = testedDriver.tools as unknown as CatalogTool[];

function context(providerId: string, hostId = "host_9") {
  return {
    thread: { id: "thr_1", title: null, parentThreadId: null, sourceThreadId: null },
    project: { id: "proj_1", kind: "standard" as const, name: "demo", gitRemoteUrl: null },
    environment: { id: "env_1", name: null, path: "/repo", workspaceProvisionType: "unmanaged" as const, branchName: null },
    host: { id: hostId, name: "laptop" },
    provider: { id: providerId, model: "m", capabilities: { supportsNativeUserQuestion: false } },
    origin: { kind: null, pluginId: null },
  };
}

function structured(result: PluginAgentToolResult): { content: Array<{ type: string; text?: string }>; isError?: boolean } {
  if (typeof result === "string") throw new Error(`expected structured result, got ${result}`);
  return result;
}

function text(result: PluginAgentToolResult | ReturnType<typeof structured>): string {
  const value = typeof result === "string" ? structured(result) : result;
  return value.content.map((part) => ("text" in part ? (part.text ?? "") : "")).join("\n");
}

function names(configuration: { tools: Array<{ name: string }> }): string[] {
  return configuration.tools.map((tool) => tool.name);
}

function readyStatus(overrides: Partial<DriverStatus> = {}): DriverStatus {
  return {
    platform: "darwin",
    installed: true,
    binaryPath: "/Applications/CuaDriver.app/Contents/MacOS/cua-driver",
    version: TESTED_DRIVER_VERSION,
    daemonRunning: true,
    permissions: { accessibility: true, screenRecording: true, directCapture: "not_checked" },
    connected: false,
    latestVersion: null,
    updateAvailable: null,
    toolCount: 60,
    error: null,
    checkedAt: new Date().toISOString(),
    ...overrides,
  };
}

const object = (properties: Record<string, unknown> = {}, required?: string[]) => ({
  type: "object",
  properties,
  ...(required === undefined ? {} : { required }),
});

/** A small driver whose click gained an argument, plus one new read-only and one new acting tool. */
const NEWER_DRIVER: CatalogTool[] = [
  {
    name: "click",
    description: "Click an element.\n\nLong detail.",
    inputSchema: object({ pid: { type: "integer" }, brand_new_arg: { type: "string" }, session: { type: "string" } }, ["pid", "session"]),
    annotations: { readOnlyHint: false },
  },
  { name: "run_steps", description: "Run steps.", inputSchema: object({ steps: { type: "array" } }, ["steps"]), annotations: { readOnlyHint: false } },
  { name: "list_windows", description: "List windows.", inputSchema: object({ node: { $ref: "#" } }), annotations: { readOnlyHint: true } },
  { name: "run_script", description: "Run AppleScript.", inputSchema: object({ source: { type: "string" } }), annotations: { readOnlyHint: false } },
  { name: "peek_menu_bar", description: "Read the menu bar.", inputSchema: object(), annotations: { readOnlyHint: true } },
  { name: "wipe_window", description: "Close every window.", inputSchema: object(), annotations: { readOnlyHint: false } },
  { name: "start_session", description: "Start.", inputSchema: object({ session: { type: "string" } }), annotations: {} },
];

async function load(options: {
  settings?: Record<string, string | boolean>;
  /** Values bb still stores for keys the plugin no longer declares. */
  storedSettings?: Record<string, string | boolean>;
  status?: DriverStatus;
  toolResult?: ToolCallResult;
  /** Consumed in order before falling back to toolResult. */
  toolResults?: ToolCallResult[];
  tools?: CatalogTool[];
  driverVersion?: string | null;
} = {}) {
  const hostCalls: Array<{ method: string; input: unknown; hostId: string }> = [];
  const { bb, harness } = createFakePluginHost({
    pluginId: "computer-use",
    settings: options.settings ?? {},
    agentSkillIds: ["cua-computer-use"],
    sdk: {
      threads: { get: async () => ({ ...makeThreadResponse({ id: "thr_1" }), environmentId: "env_1" }) },
      environments: { get: async () => ({ id: "env_1", hostId: "host_9" }) },
      hosts: { list: async () => [{ id: "host_9", name: "laptop", status: "connected" }] },
      providers: {
        list: async () => [
          { id: "codex", displayName: "Codex", available: true },
          { id: "claude-code", displayName: "Claude Code", available: true },
          { id: "pi", displayName: "Pi", available: false },
        ],
      },
      plugins: {
        updateSettings: async () => ({}),
        getSettings: async () => ({ ok: true, schema: {}, values: options.storedSettings ?? {} }),
      },
    },
    experimental_callHostRpc: async ({ method, input, hostId }) => {
      hostCalls.push({ method, input, hostId });
      if (method === "callTool") {
        return options.toolResults?.shift() ?? options.toolResult ?? { content: [{ type: "text", text: "ok" }], isError: false };
      }
      if (method === "status") return options.status ?? readyStatus();
      if (method === "listTools") {
        return {
          tools: options.tools ?? TESTED_TOOLS,
          driverVersion: options.driverVersion === undefined ? (options.status ?? readyStatus()).version : options.driverVersion,
        };
      }
      if (method === "install" || method === "installState") {
        return { running: method === "install", ok: null, exitCode: null, step: "starting", tail: [], startedAt: null, finishedAt: null };
      }
      if (method === "grantPermissions") return { ok: true, output: "Requested." };
      return { disconnected: false };
    },
  });
  await plugin(bb);
  const toolCalls = () => hostCalls.filter((call) => call.method === "callTool").map((call) => call.input as {
    name: string;
    arguments: Record<string, unknown>;
    session?: string;
    grants: string[];
  });
  return { bb, harness, hostCalls, toolCalls };
}

/** Waits for the startup status probe and the catalog read it triggers. */
async function settled(hostCalls: Array<{ method: string }>): Promise<void> {
  await vi.waitFor(() => expect(hostCalls.some((call) => call.method === "listTools")).toBe(true));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("routing", () => {
  it("offers cua tools to claude-code and pi but not to codex in prefer-native mode", async () => {
    const { harness } = await load();
    const claude = await harness.behavior.resolveAgentConfiguration(context("claude-code"));
    expect(names(claude)).toEqual(expect.arrayContaining(["cua_call", "cua_describe", "cua_status", "cua_run_steps", "cua_get_window_state", "cua_browser_click"]));
    expect(claude.skills).toEqual(["cua-computer-use"]);
    expect(claude.instructions).toMatch(/cua_describe lists every tool/);

    const codex = await harness.behavior.resolveAgentConfiguration(context("codex"));
    expect(codex.tools).toEqual([]);
    expect(codex.skills).toEqual([]);

    const pi = await harness.behavior.resolveAgentConfiguration(context("pi"));
    expect(names(pi).length).toBeGreaterThan(20);
  });

  it("honours cua-everywhere, off, and per-provider overrides from the CLI", async () => {
    const { harness } = await load();
    expect((await harness.behavior.runCli(["mode", "cua-everywhere"])).stdout).toBe("mode: cua-everywhere");
    expect(names(await harness.behavior.resolveAgentConfiguration(context("codex")))).toContain("cua_click");

    const set = await harness.behavior.runCli(["policy", "codex", "native"]);
    expect(set.exitCode).toBe(0);
    expect(set.stdout).toMatch(/codex\s+native\s+override=native/);
    expect(names(await harness.behavior.resolveAgentConfiguration(context("codex")))).toEqual([]);

    await harness.behavior.runCli(["mode", "off"]);
    expect(names(await harness.behavior.resolveAgentConfiguration(context("claude-code")))).toEqual([]);
    const rejected = await harness.behavior.runCli(["policy", "codex", "bogus"]);
    expect(rejected.exitCode).toBe(1);
  });

  it("keeps the mode out of bb's Configuration form and carries an old setting over", async () => {
    const { bb, harness } = await load({ storedSettings: { mode: "off" } });
    expect(Object.keys(harness.registrations.settingsDescriptors)).not.toContain("mode");
    expect(names(await harness.behavior.resolveAgentConfiguration(context("claude-code")))).toEqual([]);
    expect(await bb.storage.kv.get("routing-mode")).toBe("off");
  });
});

describe("exposure policy", () => {
  it("offers reviewed tools as dedicated tools and keeps risky ones off by default", async () => {
    const { harness } = await load();
    const tools = names(await harness.behavior.resolveAgentConfiguration(context("claude-code")));
    expect(tools).toEqual(expect.arrayContaining(["cua_click", "cua_run_steps", "cua_clipboard_read"]));
    for (const hidden of ["cua_run_script", "cua_kill_app", "cua_set_config", "cua_get_screen_size", "cua_start_session"]) {
      expect(tools).not.toContain(hidden);
    }
  });

  it("gates cua_call with the same policy as dedicated tools", async () => {
    const { harness, toolCalls } = await load();

    const allowed = structured(await harness.behavior.callAgentTool("cua_call", { tool: "get_screen_size", arguments: {} }));
    expect(allowed.isError).toBe(false);
    expect(toolCalls()[0]).toMatchObject({ name: "get_screen_size" });

    const prefixed = structured(await harness.behavior.callAgentTool("cua_call", { tool: "cua_click", arguments: { pid: 1 } }));
    expect(prefixed.isError).toBe(false);
    expect(toolCalls()[1]).toMatchObject({ name: "click", arguments: { pid: 1 } });

    const refused = structured(await harness.behavior.callAgentTool("cua_call", { tool: "run_script", arguments: { source: "x" } }));
    expect(refused.isError).toBe(true);
    expect(text(refused)).toMatch(/run_script is turned off.*Do not reach the same capability another way/s);
    expect(text(refused)).toContain("bb cua expose run_script call");

    const managed = structured(await harness.behavior.callAgentTool("cua_call", { tool: "start_session", arguments: {} }));
    expect(managed.isError).toBe(true);
    expect(text(managed)).toMatch(/managed by the Computer Use plugin/);
    expect(toolCalls()).toHaveLength(2);
  });

  it("lets the user change one tool's exposure from the CLI or the app", async () => {
    const { harness, toolCalls } = await load();
    const exposed = await harness.behavior.runCli(["expose", "run_script", "call"]);
    expect(exposed).toMatchObject({ exitCode: 0 });
    expect(exposed.stdout).toMatch(/run_script: call/);
    await harness.behavior.callAgentTool("cua_call", { tool: "run_script", arguments: { source: "x" } });
    expect(toolCalls()[0]).toMatchObject({ name: "run_script" });

    await harness.behavior.runCli(["expose", "cua_click", "off"]);
    expect(names(await harness.behavior.resolveAgentConfiguration(context("claude-code")))).not.toContain("cua_click");
    const refused = structured(await harness.behavior.callAgentTool("cua_click", { pid: 1 }));
    expect(refused.isError).toBe(true);
    expect(toolCalls()).toHaveLength(1);

    const state = (await harness.behavior.callRpc("setExposure", { tool: "click", exposure: "default" })) as {
      tools: Array<{ name: string; exposure: string; override: string | null }>;
    };
    expect(state.tools.find((tool) => tool.name === "click")).toMatchObject({ exposure: "tool", override: null });
    expect(names(await harness.behavior.resolveAgentConfiguration(context("claude-code")))).toContain("cua_click");

    expect((await harness.behavior.runCli(["expose", "start_session", "tool"])).exitCode).toBe(1);
    expect((await harness.behavior.runCli(["expose", "click", "sideways"])).exitCode).toBe(1);
  });

  it("turns a whole group off, cua_call included", async () => {
    const { harness, toolCalls } = await load({ settings: { browserTools: false, clipboardTools: false } });
    const tools = names(await harness.behavior.resolveAgentConfiguration(context("pi")));
    expect(tools).not.toContain("cua_browser_click");
    expect(tools).not.toContain("cua_clipboard_read");
    expect(tools).toEqual(expect.arrayContaining(["cua_call", "cua_status", "cua_click"]));
    const refused = structured(await harness.behavior.callAgentTool("cua_call", { tool: "clipboard_read", arguments: {} }));
    expect(refused.isError).toBe(true);
    expect(text(refused)).toMatch(/Clipboard tools/);
    expect(toolCalls()).toHaveLength(0);
  });

  it("applies the policy to `bb cua call` too", async () => {
    const { harness, toolCalls } = await load();
    const refused = await harness.behavior.runCli(["call", "kill_app", '{"pid":1}']);
    expect(refused.exitCode).toBe(1);
    expect(refused.stdout).toMatch(/kill_app is turned off/);
    const allowed = await harness.behavior.runCli(["call", "get_screen_size", "--json"]);
    expect(allowed.exitCode).toBe(0);
    expect(toolCalls().map((call) => call.name)).toEqual(["get_screen_size"]);

    const { harness: screenshots } = await load({
      toolResult: { content: [{ type: "image", data: "A".repeat(2_000_000), mimeType: "image/png" }], isError: false },
    });
    const shot = await screenshots.behavior.runCli(["call", "get_window_state", '{"pid":1}', "--json"]);
    expect(JSON.parse(shot.stdout ?? "").content).toEqual([{ type: "image", mimeType: "image/png", base64Chars: 2_000_000 }]);
  });
});

describe("live catalog", () => {
  it("reads a newer driver's own tools, offers its schemas, and reports the drift", async () => {
    const { harness, hostCalls, toolCalls } = await load({ status: readyStatus({ version: "9.0.0" }), tools: NEWER_DRIVER });
    await settled(hostCalls);

    const configuration = await harness.behavior.resolveAgentConfiguration(context("claude-code"));
    expect(names(configuration).sort()).toEqual(["cua_call", "cua_click", "cua_describe", "cua_list_windows", "cua_run_steps", "cua_status"]);
    const click = configuration.tools.find((tool) => tool.name === "cua_click");
    expect(click?.inputSchema).toEqual({ type: "object", properties: { brand_new_arg: { type: "string" }, pid: { type: "integer" } }, required: ["pid"] });
    // A schema bb would refuse as an override falls back to a permissive one.
    expect(configuration.tools.find((tool) => tool.name === "cua_list_windows")?.inputSchema).toEqual({ type: "object", additionalProperties: true });
    expect(configuration.instructions).toMatch(/Cua Driver 9\.0\.0 is untested \(plugin tested with .*\): 2 new \(peek_menu_bar, wipe_window\)/);

    // New read-only tools are reachable through cua_call; new acting tools are not.
    expect(structured(await harness.behavior.callAgentTool("cua_call", { tool: "peek_menu_bar", arguments: {} })).isError).toBe(false);
    const refused = structured(await harness.behavior.callAgentTool("cua_call", { tool: "wipe_window", arguments: {} }));
    expect(refused.isError).toBe(true);
    expect(toolCalls().map((call) => call.name)).toEqual(["peek_menu_bar"]);

    const drift = await harness.behavior.runCli(["drift"]);
    expect(drift.stdout).toMatch(/2 new \(peek_menu_bar, wipe_window\)/);
    expect(drift.stdout).toMatch(/~ click: new arguments: brand_new_arg/);
    const state = (await harness.behavior.callRpc("getState", null)) as { hosts: Array<{ drift: { drifted: boolean; added: string[] } | null }> };
    expect(state.hosts[0]?.drift).toMatchObject({ drifted: true, added: ["peek_menu_bar", "wipe_window"] });
  });

  it("registers a tool first seen on a machine so its exposure can be raised", async () => {
    const { harness, hostCalls, toolCalls } = await load({ status: readyStatus({ version: "9.0.0" }), tools: NEWER_DRIVER });
    await settled(hostCalls);
    await harness.behavior.runCli(["expose", "peek_menu_bar", "tool"]);
    expect(names(await harness.behavior.resolveAgentConfiguration(context("claude-code")))).toContain("cua_peek_menu_bar");
    await harness.behavior.callAgentTool("cua_peek_menu_bar", {});
    expect(toolCalls().map((call) => call.name)).toEqual(["peek_menu_bar"]);
  });

  it("keeps a machine's catalog across plugin reloads", async () => {
    const { harness, hostCalls } = await load({ status: readyStatus({ version: "9.0.0" }), tools: NEWER_DRIVER });
    await settled(hostCalls);
    const reloaded = await harness.lifecycle.reload(plugin);
    const configuration = await reloaded.harness.behavior.resolveAgentConfiguration(context("claude-code"));
    expect(names(configuration)).toContain("cua_list_windows");
    expect(names(configuration)).not.toContain("cua_zoom");
  });

  it("asks the driver again before refusing an unknown tool name", async () => {
    const { harness, hostCalls } = await load();
    await settled(hostCalls);
    const before = hostCalls.filter((call) => call.method === "listTools").length;
    const result = structured(await harness.behavior.callAgentTool("cua_call", { tool: "not_a_tool", arguments: {} }));
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/no tool named not_a_tool/);
    expect(hostCalls.filter((call) => call.method === "listTools").length).toBe(before + 1);
  });

  it("stays quiet about drift on the tested driver", async () => {
    const { harness, hostCalls } = await load();
    await settled(hostCalls);
    const configuration = await harness.behavior.resolveAgentConfiguration(context("claude-code"));
    expect(configuration.instructions).not.toMatch(/untested/);
    expect(configuration.instructions).toMatch(/the version this plugin was tested with/);
    const state = (await harness.behavior.callRpc("getState", null)) as { hosts: Array<{ drift: { drifted: boolean } | null }> };
    expect(state.hosts[0]?.drift).toMatchObject({ drifted: false });
    expect((await harness.behavior.runCli(["drift"])).stdout).toMatch(/is the version this plugin was tested with/);
  });

  it("describes tools by how agents reach them", async () => {
    const { harness, hostCalls } = await load({ status: readyStatus({ version: "9.0.0" }), tools: NEWER_DRIVER });
    await settled(hostCalls);
    const described = text(await harness.behavior.callAgentTool("cua_describe", {}));
    expect(described).toMatch(/^Cua Driver 9\.0\.0 is untested/);
    expect(described).toMatch(/Dedicated tools \(call them directly\):\n- cua_click: Click an element by element_token/);
    expect(described).toMatch(/Through cua_call \{tool, arguments\}:\n- peek_menu_bar/);
    expect(described).toMatch(/Turned off by the user.*\n- run_script: .*\n- wipe_window/s);
    expect(described).not.toMatch(/^- (cua_)?start_session/m);

    const one = text(await harness.behavior.callAgentTool("cua_describe", { tool: "cua_click" }));
    expect(one).toMatch(/^click \(Call it as cua_click\.\)/);
    expect(one).toContain("Long detail.");
  });
});

describe("driver calls", () => {
  it("routes a tool call to the thread's host with a per-thread session label", async () => {
    const { harness, toolCalls, hostCalls } = await load();
    const result = await harness.behavior.callAgentTool("cua_click", { pid: 4, element_token: "s1:2" });
    expect(result).toEqual({ content: [{ type: "text", text: "ok" }], isError: false });
    expect(toolCalls()).toHaveLength(1);
    expect(hostCalls.find((call) => call.method === "callTool")?.hostId).toBe("host_9");
    expect(toolCalls()[0]).toMatchObject({ name: "click", arguments: { pid: 4, element_token: "s1:2" } });
    const firstSession = toolCalls()[0]!.session;
    expect(firstSession).toMatch(/^bb-/);

    await harness.behavior.emitThreadEvent("thread.idle", { thread: makeThreadResponse({ id: "thread-test" }), lastAssistantText: null });
    await vi.waitFor(() => expect(toolCalls().some((call) => call.name === "end_session")).toBe(true));

    await harness.behavior.callAgentTool("cua_click", { pid: 4, element_token: "s1:3" });
    const clicks = toolCalls().filter((call) => call.name === "click");
    expect(clicks[1]!.session).not.toBe(firstSession);
  });

  it("forwards driver arguments untouched but keeps the session plugin-owned", async () => {
    const { harness, toolCalls } = await load();
    await harness.behavior.callAgentTool("cua_click", {
      pid: 4,
      element_token: "s1:2",
      from_zoom: true,
      target: { window_id: 9 },
      session: "someone-elses-session",
    });
    expect(toolCalls()[0]!.arguments).toEqual({ pid: 4, element_token: "s1:2", from_zoom: true, target: { window_id: 9 } });
    expect(toolCalls()[0]!.session).toMatch(/^bb-/);
    expect(toolCalls()[0]!.grants).toEqual([]);
  });

  it("retries once with a fresh session after Cua Driver ended the old one", async () => {
    const ended: ToolCallResult = {
      content: [{ type: "text", text: "session 'bb-thr' has ended; tool call 'click' was rejected." }],
      isError: true,
    };
    const { harness, toolCalls } = await load({ toolResults: [ended] });
    const result = await harness.behavior.callAgentTool("cua_click", { pid: 4, element_token: "s1:2" });
    expect(result).toEqual({ content: [{ type: "text", text: "ok" }], isError: false });
    const sessions = toolCalls().map((call) => call.session);
    expect(sessions).toHaveLength(2);
    expect(sessions[1]).not.toBe(sessions[0]);
  });

  it("forgets a machine's sessions when its Cua connection drops", async () => {
    const { harness, toolCalls } = await load();
    await harness.behavior.callAgentTool("cua_click", { pid: 4, element_token: "s1:2" });
    await harness.behavior.experimental_emitHostSignal("host_9", "connectionChanged", { connected: false, reason: "idle timeout" });
    await harness.behavior.callAgentTool("cua_click", { pid: 4, element_token: "s1:3" });
    const sessions = toolCalls().map((call) => call.session);
    expect(sessions[1]).not.toBe(sessions[0]);
  });

  it("asks Cua Driver for signed-in browser profiles only when the setting is on", async () => {
    const { harness, toolCalls } = await load();
    await harness.behavior.callAgentTool("cua_get_browser_state", {});
    await harness.behavior.setSettings({ signedInBrowserProfiles: true });
    await harness.behavior.callAgentTool("cua_get_browser_state", {});
    expect(toolCalls().map((call) => call.grants)).toEqual([[], ["existing-profile"]]);
  });

  it("refuses to attach to a signed-in browser profile while the setting is off", async () => {
    const { harness, toolCalls } = await load();
    const refused = structured(
      await harness.behavior.callAgentTool("cua_browser_prepare", { pid: 7, window_id: 3, strategy: { kind: "existing_profile" } }),
    );
    expect(refused.isError).toBe(true);
    expect(text(refused)).toMatch(/Signed-in browser profiles/);
    expect(toolCalls()).toHaveLength(0);

    await harness.behavior.setSettings({ signedInBrowserProfiles: true });
    await harness.behavior.callAgentTool("cua_browser_prepare", { pid: 7, window_id: 3, strategy: { kind: "existing_profile" } });
    expect(toolCalls()[0]).toMatchObject({ name: "browser_prepare", grants: ["existing-profile"] });
  });
});

describe("asking before sensitive actions", () => {
  /** Waits until the plugin asks, and returns that request. */
  async function asked(harness: Awaited<ReturnType<typeof load>>["harness"]) {
    await vi.waitFor(() => expect(harness.inspection.pendingInteractions).toHaveLength(1));
    return harness.inspection.pendingInteractions[0]!;
  }

  it("runs sensitive tools without asking while the setting is off", async () => {
    const { harness, toolCalls } = await load();
    expect(structured(await harness.behavior.callAgentTool("cua_clipboard_read", { include_text: true })).isError).toBe(false);
    expect(harness.inspection.pendingInteractions).toHaveLength(0);
    expect(toolCalls().map((call) => call.name)).toEqual(["clipboard_read"]);
    const configuration = await harness.behavior.resolveAgentConfiguration(context("claude-code"));
    expect(configuration.instructions).not.toMatch(/wait for the user to approve/);
  });

  it("asks in the thread and runs the call once it is allowed", async () => {
    const { harness, toolCalls } = await load({ settings: { confirmSensitiveTools: true } });
    const pending = harness.behavior.callAgentTool("cua_clipboard_read", { include_text: true }, { threadId: "thr_1" });
    const request = await asked(harness);
    expect(request).toMatchObject({ threadId: "thr_1", rendererId: "approve-tool", title: "Allow cua_clipboard_read?" });
    expect(request.payload).toMatchObject({ tool: "clipboard_read", reason: expect.stringMatching(/copied password/) });
    expect(toolCalls()).toHaveLength(0);

    harness.behavior.submitInteraction(request.id, { allow: "once" });
    expect(structured(await pending).isError).toBe(false);
    expect(toolCalls().map((call) => call.name)).toEqual(["clipboard_read"]);

    // "Once" covers one call; the next one asks again.
    const again = harness.behavior.callAgentTool("cua_clipboard_read", { include_text: true }, { threadId: "thr_1" });
    harness.behavior.submitInteraction((await asked(harness)).id, { allow: "once" });
    await again;
    expect(toolCalls()).toHaveLength(2);
  });

  it("refuses the call when the user does not allow it", async () => {
    const { harness, toolCalls } = await load({ settings: { confirmSensitiveTools: true } });
    const pending = harness.behavior.callAgentTool("cua_get_desktop_state", {}, { threadId: "thr_1" });
    harness.behavior.cancelInteraction((await asked(harness)).id);
    const refused = structured(await pending);
    expect(refused.isError).toBe(true);
    expect(text(refused)).toMatch(/The user did not allow it: get_desktop_state would capture your whole screen.*Do not reach the same result another way/s);
    expect(toolCalls()).toHaveLength(0);
  });

  it("remembers an approval for the rest of the thread, and only that thread", async () => {
    const { harness, toolCalls } = await load({ settings: { confirmSensitiveTools: true } });
    const first = harness.behavior.callAgentTool("cua_browser_set_input_files", { ref: "r1", files: ["/tmp/a.pdf"] }, { threadId: "thr_1" });
    const request = await asked(harness);
    expect(request.payload).toMatchObject({ arguments: expect.stringContaining("/tmp/a.pdf") });
    harness.behavior.submitInteraction(request.id, { allow: "thread" });
    await first;
    await harness.behavior.callAgentTool("cua_browser_set_input_files", { ref: "r2", files: ["/tmp/b.pdf"] }, { threadId: "thr_1" });
    expect(harness.inspection.pendingInteractions).toHaveLength(0);
    expect(toolCalls()).toHaveLength(2);

    const other = harness.behavior.callAgentTool("cua_browser_set_input_files", { ref: "r3", files: ["/tmp/c.pdf"] }, { threadId: "thr_2" });
    harness.behavior.cancelInteraction((await asked(harness)).id);
    expect(structured(await other).isError).toBe(true);

    await harness.behavior.emitThreadEvent("thread.archived", { thread: makeThreadResponse({ id: "thr_1" }) });
    const archived = harness.behavior.callAgentTool("cua_browser_set_input_files", { ref: "r4", files: ["/tmp/d.pdf"] }, { threadId: "thr_1" });
    harness.behavior.cancelInteraction((await asked(harness)).id);
    await archived;
    expect(toolCalls().filter((call) => call.name === "browser_set_input_files")).toHaveLength(2);
  });

  it("asks only for the sensitive form of a tool, through cua_call and `bb cua call` too", async () => {
    const { harness, toolCalls } = await load({ settings: { confirmSensitiveTools: true, signedInBrowserProfiles: true } });
    await harness.behavior.callAgentTool("cua_clipboard_read", {});
    await harness.behavior.callAgentTool("cua_browser_prepare", { allow_launch: true });
    await harness.behavior.callAgentTool("cua_click", { pid: 4, element_token: "s1:2" });
    expect(harness.inspection.pendingInteractions).toHaveLength(0);
    expect(toolCalls()).toHaveLength(3);

    const attach = harness.behavior.callAgentTool("cua_call", {
      tool: "browser_prepare",
      arguments: { pid: 7, window_id: 3, strategy: { kind: "existing_profile" } },
    });
    expect((await asked(harness)).payload).toMatchObject({ reason: expect.stringMatching(/signed-in browser/) });
    harness.behavior.cancelInteraction(harness.inspection.pendingInteractions[0]!.id);
    expect(structured(await attach).isError).toBe(true);

    const fromThread = harness.behavior.runCli(["call", "clipboard_write", '{"text":"x"}'], { threadId: "thr_1" });
    harness.behavior.cancelInteraction((await asked(harness)).id);
    expect((await fromThread).exitCode).toBe(1);
    // Outside any thread the command is the user's own.
    expect((await harness.behavior.runCli(["call", "clipboard_write", '{"text":"x"}'])).exitCode).toBe(0);
    expect(toolCalls()).toHaveLength(4);
  });

  it("tells agents and the settings list which tools ask first", async () => {
    const { harness } = await load({ settings: { confirmSensitiveTools: true } });
    const configuration = await harness.behavior.resolveAgentConfiguration(context("claude-code"));
    expect(configuration.instructions).toMatch(/wait for the user to approve them in the thread/);
    const state = (await harness.behavior.callRpc("getState", null)) as { tools: Array<{ name: string; asksFirst: boolean }> };
    const asking = state.tools.filter((tool) => tool.asksFirst).map((tool) => tool.name);
    expect(asking).toEqual(expect.arrayContaining(["browser_prepare", "browser_set_input_files", "clipboard_read", "get_desktop_state", "run_script"]));
    expect(asking).not.toContain("click");
  });
});

describe("setup guidance", () => {
  it("explains a missing driver through cua_status, the tools, and the rpc state", async () => {
    const { harness, toolCalls } = await load({
      status: readyStatus({ installed: false, binaryPath: null, version: null, daemonRunning: null, permissions: null, toolCount: null }),
    });
    const status = structured(await harness.behavior.callAgentTool("cua_status", {}));
    expect(status.isError).toBeFalsy();
    expect(text(status)).toMatch(/NOT installed/);
    expect(text(status)).toContain(`CUA_DRIVER_RS_VERSION=${TESTED_DRIVER_VERSION}`);

    const state = (await harness.behavior.callRpc("getState", null)) as {
      providers: Array<{ id: string; decision: string }>;
      hosts: Array<{ id: string; driver: { installed: boolean } | null; drift: unknown }>;
      testedVersion: string;
    };
    expect(state.providers.map((provider) => [provider.id, provider.decision])).toEqual([
      ["codex", "native"],
      ["claude-code", "cua"],
      ["pi", "cua"],
    ]);
    expect(state.hosts[0]).toMatchObject({ id: "host_9", driver: { installed: false }, drift: null });
    expect(state.testedVersion).toBe(TESTED_DRIVER_VERSION);

    const blocked = structured(await harness.behavior.callAgentTool("cua_click", { pid: 4, element_token: "s1:2" }));
    expect(blocked.isError).toBe(true);
    expect(text(blocked)).toContain("[Open Computer Use settings](/settings/plugins/computer-use)");
    expect(text(blocked)).toMatch(/Install Cua Driver/);
    expect(toolCalls()).toHaveLength(0);
  });

  it("blocks desktop actions before macOS permissions are ready and links to setup", async () => {
    const { harness, toolCalls } = await load({
      status: readyStatus({ permissions: { accessibility: true, screenRecording: false, directCapture: "not_checked" } }),
    });
    const result = structured(await harness.behavior.callAgentTool("cua_click", { pid: 4, element_token: "s1:2" }));
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/Screen Recording/);
    expect(text(result)).toMatch(/Grant macOS permissions/);
    expect(toolCalls()).toHaveLength(0);
  });

  it("turns a driver permission failure into the same guided recovery", async () => {
    const { harness, hostCalls, toolCalls } = await load({
      toolResult: {
        content: [{ type: "text", text: "permissions_pending: Screen Recording permission is still pending" }],
        isError: true,
        structured: { exit_code: 75 },
      },
    });
    const result = structured(await harness.behavior.callAgentTool("cua_click", { pid: 4, element_token: "s1:2" }));
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("[Open Computer Use settings](/settings/plugins/computer-use)");
    expect(text(result)).toMatch(/Driver detail:.*permissions_pending/);
    expect(toolCalls()).toHaveLength(1);
    const lastCall = hostCalls.map((call) => call.method).lastIndexOf("callTool");
    expect(hostCalls.slice(lastCall).some((call) => call.method === "status")).toBe(true);
  });

  it("passes other refusals through even when they mention the accessibility tree", async () => {
    const refusal = {
      content: [
        {
          type: "text" as const,
          text: "browser_prepare refused: attaching now would bring the browser in front of the app the user is working in. Use get_window_state on the browser window and act through its accessibility tree, or retry with delivery_mode \"foreground\".",
        },
      ],
      isError: true,
      structured: { refusal: { code: "background_unavailable" } },
    };
    const { harness } = await load({ settings: { signedInBrowserProfiles: true }, toolResult: refusal });
    const result = structured(
      await harness.behavior.callAgentTool("cua_browser_prepare", { pid: 4, window_id: 9, strategy: { kind: "existing_profile" } }),
    );
    expect(text(result)).not.toMatch(/Grant macOS permissions/);
    expect(text(result)).toContain('retry with delivery_mode "foreground"');
  });

  it("tells permission failures from other refusals", () => {
    const failed = (text: string, structured?: unknown) => ({ content: [{ type: "text" as const, text }], isError: true, structured });
    expect(isPermissionFailure(failed("Accessibility permission not granted"))).toBe(true);
    expect(isPermissionFailure(failed("refused (tcc_screen_recording): grant Screen Recording"))).toBe(true);
    expect(isPermissionFailure(failed("x", { refusal: { code: "tcc_accessibility" } }))).toBe(true);
    expect(isPermissionFailure(failed("refused (background_unavailable): act through its accessibility tree"))).toBe(false);
    expect(isPermissionFailure(failed("Permission denied (os error 13)"))).toBe(false);
  });
});

describe("install and update", () => {
  it("installs the tested driver version unless --latest is passed", async () => {
    const { harness, hostCalls } = await load();
    const refused = await harness.behavior.runCli(["install"]);
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toMatch(new RegExp(`Cua Driver ${TESTED_DRIVER_VERSION.replace(/\./g, "\\.")}.*--latest.*--yes`, "s"));
    expect(hostCalls.some((call) => call.method === "install")).toBe(false);

    const started = (await harness.behavior.callRpc("installDriver", { hostId: "host_9", target: "tested" })) as { running: boolean };
    expect(started.running).toBe(true);
    expect(hostCalls.at(-1)).toMatchObject({ method: "install", hostId: "host_9", input: { version: TESTED_DRIVER_VERSION } });
    await harness.behavior.callRpc("installDriver", { hostId: "host_9", target: "latest" });
    expect(hostCalls.at(-1)).toMatchObject({ method: "install", input: { version: null } });
  });

  it("moves a machine to the tested version, or the newest release on request", async () => {
    const current = await load();
    const same = await current.harness.behavior.runCli(["update"]);
    expect(same).toMatchObject({ exitCode: 0 });
    expect(same.stdout).toMatch(/already installed/);

    const newest = await load({ status: readyStatus({ latestVersion: TESTED_DRIVER_VERSION, updateAvailable: false }) });
    expect((await newest.harness.behavior.runCli(["update", "--latest"])).stdout).toMatch(/already the newest/);

    const behind = await load({ status: readyStatus({ version: "0.20.0", latestVersion: "99.0.0", updateAvailable: true }) });
    const unconfirmed = await behind.harness.behavior.runCli(["update"]);
    expect(unconfirmed.exitCode).toBe(1);
    expect(unconfirmed.stderr).toMatch(/--yes/);
    expect(behind.hostCalls.some((entry) => entry.method === "install")).toBe(false);

    await behind.harness.behavior.runCli(["update", "--yes"]);
    expect(behind.hostCalls.find((entry) => entry.method === "install")?.input).toEqual({ version: TESTED_DRIVER_VERSION });
    await behind.harness.behavior.runCli(["update", "--latest", "--yes"]);
    expect(behind.hostCalls.filter((entry) => entry.method === "install").at(-1)?.input).toEqual({ version: null });
  });

  it("mirrors install progress from host signals and refreshes status when it finishes", async () => {
    const { harness, hostCalls } = await load();
    await harness.behavior.experimental_emitHostSignal("host_9", "installChanged", {
      running: true, ok: null, exitCode: null, step: "install", tail: ["$ /bin/bash x.sh", "Installing"], startedAt: null, finishedAt: null,
    });
    let state = (await harness.behavior.callRpc("getState", null)) as { hosts: Array<{ install: { running: boolean; tail: string[] } }> };
    expect(state.hosts[0]?.install).toMatchObject({ running: true, tail: ["$ /bin/bash x.sh", "Installing"] });

    const before = hostCalls.filter((call) => call.method === "status").length;
    await harness.behavior.experimental_emitHostSignal("host_9", "installChanged", {
      running: false, ok: true, exitCode: 0, step: "done", tail: ["done"], startedAt: null, finishedAt: null,
    });
    await vi.waitFor(() => expect(hostCalls.filter((call) => call.method === "status").length).toBeGreaterThan(before));
    state = (await harness.behavior.callRpc("getState", null)) as typeof state;
    expect(state.hosts[0]?.install).toMatchObject({ running: false });

    const grant = (await harness.behavior.callRpc("grantPermissions", { hostId: "host_9" })) as { ok: boolean };
    expect(grant.ok).toBe(true);
  });
});
