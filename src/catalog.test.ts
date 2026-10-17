import { describe, expect, it } from "vitest";
import { META_TOOLS, advertisedSchema, agentToolName, driverToolName, overridableSchema } from "./catalog.js";
import { diffCatalogs, formatDrift, hasDrift, summarizeDrift } from "./drift.js";
import { compactSchema, firstSentence, leadParagraph, normalizeDriverTool, normalizeDriverTools, type DriverTool } from "./driver-tools.js";
import { REVIEWED_TOOLS, defaultExposure, groupOf, normalizeOverrides, resolveExposure } from "./exposure.js";
import { SNAPSHOT_CATALOG, TESTED_DRIVER_VERSION } from "./snapshot.js";

function tool(name: string, schema: Record<string, unknown> = { type: "object" }, readOnly?: boolean): DriverTool {
  return { name, description: name, inputSchema: schema, annotations: readOnly === undefined ? {} : { readOnlyHint: readOnly } };
}

const allGroups = { overrides: {}, enabledGroups: new Set(["desktop", "browser", "clipboard"] as const) };

describe("tested snapshot", () => {
  it("records the driver version and its full tool list", () => {
    expect(TESTED_DRIVER_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(SNAPSHOT_CATALOG.tools.length).toBeGreaterThan(40);
    expect(SNAPSHOT_CATALOG.tools.map((entry) => entry.name)).toContain("run_steps");
  });

  // A driver release that adds or renames tools fails here until someone
  // decides how agents should reach each one (src/exposure.ts).
  it("has a reviewed exposure for every tool of the tested driver", () => {
    const unreviewed = SNAPSHOT_CATALOG.tools.map((entry) => entry.name).filter((name) => REVIEWED_TOOLS[name] === undefined);
    expect(unreviewed).toEqual([]);
    const stale = Object.keys(REVIEWED_TOOLS).filter((name) => !SNAPSHOT_CATALOG.tools.some((entry) => entry.name === name));
    expect(stale).toEqual([]);
  });

  it("fits bb's limits: one kv value per machine, and every dedicated schema as an override", () => {
    const bytes = new TextEncoder().encode(JSON.stringify(SNAPSHOT_CATALOG)).byteLength;
    expect(bytes).toBeLessThan(256 * 1024);
    const dedicated = SNAPSHOT_CATALOG.tools.filter((entry) => resolveExposure(entry.name, entry, allGroups) === "tool");
    expect(dedicated.length).toBeGreaterThan(20);
    for (const entry of dedicated) expect(overridableSchema(entry.inputSchema), entry.name).not.toBeNull();
    const prompt = dedicated.reduce((sum, entry) => sum + JSON.stringify(advertisedSchema(entry.inputSchema)).length, 0);
    expect(prompt).toBeLessThan(80_000);
  });

  it("keeps progress labels and summaries short", () => {
    for (const [name, reviewed] of Object.entries(REVIEWED_TOOLS)) {
      if (reviewed.labels !== undefined) {
        expect(reviewed.labels.pending.length, name).toBeLessThanOrEqual(80);
        expect(reviewed.labels.completed.length, name).toBeLessThanOrEqual(80);
      }
      if (reviewed.summary !== undefined) expect(reviewed.summary.length, name).toBeLessThanOrEqual(600);
    }
  });
});

describe("driver tools", () => {
  it("compacts prose but keeps every validation keyword", () => {
    const compacted = compactSchema({
      type: "object",
      description: "The first sentence, which is plenty long enough to stand alone. Second sentence with detail.",
      examples: [{ pid: 1 }],
      properties: {
        description: { type: "string", description: "A property named description, long enough to stand on its own. More." },
        pid: { type: "integer", minimum: 1, description: "Process id." },
      },
      required: ["pid"],
    });
    expect(compacted).toEqual({
      type: "object",
      description: "The first sentence, which is plenty long enough to stand alone.",
      properties: {
        description: { type: "string", description: "A property named description, long enough to stand on its own." },
        pid: { type: "integer", minimum: 1, description: "Process id." },
      },
      required: ["pid"],
    });
  });

  it("cuts at a sentence's end, not at an abbreviation, and keeps what a short sentence needs", () => {
    expect(firstSentence("Targets by role, e.g. button or link, and name. More detail follows here.")).toBe(
      "Targets by role, e.g. button or link, and name. More detail follows here.",
    );
    expect(firstSentence("Default false. When true, the window is activated and the pointer may move. Other detail.")).toBe(
      "Default false. When true, the window is activated and the pointer may move.",
    );
    expect(firstSentence("A sentence that is long enough to be the whole summary by itself. Then more.")).toBe(
      "A sentence that is long enough to be the whole summary by itself.",
    );
    expect(firstSentence("x".repeat(300), 20)).toBe(`${"x".repeat(19)}…`);
  });

  it("normalizes raw tools/list entries and skips unusable ones", () => {
    expect(normalizeDriverTool({ description: "no name" })).toBeNull();
    const normalized = normalizeDriverTool({
      name: "zoom",
      description: "Zoom in.\n\nLong detail.",
      inputSchema: { type: "object" },
      annotations: { readOnlyHint: true, title: "ignored" },
    });
    expect(normalized).toEqual({ name: "zoom", description: "Zoom in.", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } });
    expect(normalizeDriverTools([{ name: "b" }, { name: "a" }, null]).map((entry) => entry.name)).toEqual(["a", "b"]);
    expect(leadParagraph("x".repeat(2_000)).length).toBe(1_500);
  });
});

describe("catalog", () => {
  it("prefixes agent tool names and accepts either form back", () => {
    expect(agentToolName("click")).toBe("cua_click");
    expect(driverToolName("cua_click")).toBe("click");
    expect(driverToolName("click")).toBe("click");
    expect(META_TOOLS.map((meta) => meta.name)).toEqual(["cua_call", "cua_describe", "cua_status"]);
  });

  it("drops the plugin-owned session argument but keeps the rest of the required list", () => {
    const plain = { type: "object", properties: { pid: { type: "integer" }, session: { type: "string" } }, required: ["pid", "session"] };
    expect(overridableSchema(plain)).toEqual({ type: "object", properties: { pid: { type: "integer" } }, required: ["pid"] });
    const onlySession = { type: "object", properties: { session: { type: "string" } }, required: ["session"] };
    expect(overridableSchema(onlySession)).toEqual({ type: "object", properties: {} });
  });

  it("refuses an override bb would reject", () => {
    expect(overridableSchema({ type: "object", properties: { node: { $ref: "#" } } })).toBeNull();
    expect(overridableSchema({ type: "object", properties: { pid: { type: "integer", description: "x".repeat(130 * 1024) } } })).toBeNull();
  });
});

describe("exposure", () => {
  it("keeps code execution, process control, and driver configuration off by default", () => {
    for (const name of ["run_script", "kill_app", "install_extension", "set_config", "replay_trajectory"]) {
      expect(defaultExposure(name, tool(name)).exposure, name).toBe("off");
    }
    expect(defaultExposure("run_steps", tool("run_steps")).exposure).toBe("tool");
    expect(defaultExposure("get_screen_size", tool("get_screen_size")).exposure).toBe("call");
  });

  it("lets only read-only unreviewed tools through, and only through cua_call", () => {
    expect(defaultExposure("brand_new_reader", tool("brand_new_reader", undefined, true))).toEqual({ exposure: "call", source: "unreviewed" });
    expect(defaultExposure("brand_new_writer", tool("brand_new_writer", undefined, false))).toEqual({ exposure: "off", source: "unreviewed" });
    expect(defaultExposure("brand_new_unknown", undefined)).toEqual({ exposure: "off", source: "unreviewed" });
  });

  it("applies user overrides, group switches, and never exposes the managed session tools", () => {
    const inputs = { overrides: { run_script: "call" as const, click: "off" as const }, enabledGroups: new Set(["desktop"] as const) };
    expect(resolveExposure("run_script", tool("run_script"), inputs)).toBe("call");
    expect(resolveExposure("click", tool("click"), inputs)).toBe("off");
    expect(resolveExposure("browser_click", tool("browser_click"), inputs)).toBe("off");
    expect(resolveExposure("browser_brand_new", tool("browser_brand_new", undefined, true), inputs)).toBe("off");
    expect(groupOf("clipboard_brand_new")).toBe("clipboard");
    expect(resolveExposure("start_session", tool("start_session"), { ...inputs, overrides: { start_session: "tool" } })).toBe("off");
    expect(normalizeOverrides({ start_session: "tool", click: "sideways", zoom: "off", "": "off" })).toEqual({ zoom: "off" });
  });
});

describe("drift", () => {
  const tested = {
    driverVersion: "1.0.0",
    tools: [
      tool("click", { type: "object", properties: { pid: { type: "integer" } }, required: ["pid"] }, false),
      tool("zoom", { type: "object", properties: { scale: { type: "number" } } }, true),
      tool("gone", { type: "object" }),
    ],
  };

  it("reports added, removed, and changed tools but not description wording", () => {
    const live = {
      driverVersion: "1.1.0",
      tools: [
        { ...tool("click", { type: "object", properties: { pid: { type: "integer" }, x: { type: "number" } }, required: ["pid", "x"] }, false), description: "reworded" },
        tool("zoom", { type: "object", properties: { scale: { type: "number", minimum: 1 } } }, true),
        tool("fresh", { type: "object" }, true),
      ],
    };
    const report = diffCatalogs(tested, live);
    expect(report.added).toEqual(["fresh"]);
    expect(report.removed).toEqual(["gone"]);
    expect(report.changed).toEqual([
      { name: "click", details: ["new arguments: x", "required: [pid, x]"] },
      { name: "zoom", details: ["argument details changed"] },
    ]);
    expect(hasDrift(report)).toBe(true);
    expect(summarizeDrift(report)).toBe(
      "Cua Driver 1.1.0 is untested (plugin tested with 1.0.0): 1 new (fresh); 1 removed (gone); 2 changed (click, zoom).",
    );
    expect(formatDrift(report)).toContain("  ~ click: new arguments: x; required: [pid, x]");
    expect(summarizeDrift({ ...report, added: ["a", "b", "c"] }, 2)).toMatch(/3 new \(a, b, and 1 more\)/);
  });

  it("calls an identical catalog clean, whatever its version", () => {
    expect(summarizeDrift(diffCatalogs(tested, tested))).toBe("Cua Driver 1.0.0 is the version this plugin was tested with.");
    const relabeled = diffCatalogs(tested, { ...tested, driverVersion: "1.0.1" });
    expect(hasDrift(relabeled)).toBe(false);
    expect(summarizeDrift(relabeled)).toMatch(/differs from the tested 1\.0\.0, but its tools are unchanged/);
  });
});
