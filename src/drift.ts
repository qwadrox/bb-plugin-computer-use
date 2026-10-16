import type { DriverCatalog, DriverTool } from "./driver-tools.js";

export interface ToolChange {
  name: string;
  details: string[];
}

/** How a machine's driver differs from the one this plugin was tested with. */
export interface DriftReport {
  testedVersion: string | null;
  driverVersion: string | null;
  added: string[];
  removed: string[];
  changed: ToolChange[];
}

function propertyNames(tool: DriverTool): Set<string> {
  const properties = tool.inputSchema.properties;
  return new Set(typeof properties === "object" && properties !== null ? Object.keys(properties) : []);
}

function requiredNames(tool: DriverTool): string[] {
  const required = tool.inputSchema.required;
  return Array.isArray(required) ? required.filter((key): key is string => typeof key === "string").sort() : [];
}

function describeChange(before: DriverTool, after: DriverTool): string[] {
  const details: string[] = [];
  const previous = propertyNames(before);
  const next = propertyNames(after);
  const added = [...next].filter((key) => !previous.has(key)).sort();
  const removed = [...previous].filter((key) => !next.has(key)).sort();
  if (added.length > 0) details.push(`new arguments: ${added.join(", ")}`);
  if (removed.length > 0) details.push(`removed arguments: ${removed.join(", ")}`);
  if (requiredNames(before).join(",") !== requiredNames(after).join(",")) {
    details.push(`required: [${requiredNames(after).join(", ")}]`);
  }
  if (before.annotations.readOnlyHint !== after.annotations.readOnlyHint) {
    details.push(after.annotations.readOnlyHint === true ? "now read-only" : "no longer read-only");
  }
  if (details.length === 0 && JSON.stringify(before.inputSchema) !== JSON.stringify(after.inputSchema)) {
    details.push("argument details changed");
  }
  return details;
}

/** Compares schemas and annotations; description wording alone is not drift. */
export function diffCatalogs(tested: DriverCatalog, live: DriverCatalog): DriftReport {
  const before = new Map(tested.tools.map((tool) => [tool.name, tool]));
  const after = new Map(live.tools.map((tool) => [tool.name, tool]));
  const changed: ToolChange[] = [];
  for (const [name, tool] of after) {
    const previous = before.get(name);
    if (previous === undefined) continue;
    const details = describeChange(previous, tool);
    if (details.length > 0) changed.push({ name, details });
  }
  return {
    testedVersion: tested.driverVersion,
    driverVersion: live.driverVersion,
    added: [...after.keys()].filter((name) => !before.has(name)).sort(),
    removed: [...before.keys()].filter((name) => !after.has(name)).sort(),
    changed: changed.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export function hasDrift(report: DriftReport): boolean {
  return report.added.length > 0 || report.removed.length > 0 || report.changed.length > 0;
}

function listNames(names: readonly string[], limit: number): string {
  if (names.length <= limit) return names.join(", ");
  return `${names.slice(0, limit).join(", ")}, and ${names.length - limit} more`;
}

/** One line for status output and agent instructions; long name lists are cut after `limit` names. */
export function summarizeDrift(report: DriftReport, limit = 8): string {
  const tested = report.testedVersion ?? "unknown";
  const version = report.driverVersion ?? "unknown";
  if (!hasDrift(report)) {
    return version === tested
      ? `Cua Driver ${version} is the version this plugin was tested with.`
      : `Cua Driver ${version} differs from the tested ${tested}, but its tools are unchanged.`;
  }
  const parts: string[] = [];
  if (report.added.length > 0) parts.push(`${report.added.length} new (${listNames(report.added, limit)})`);
  if (report.removed.length > 0) parts.push(`${report.removed.length} removed (${listNames(report.removed, limit)})`);
  if (report.changed.length > 0) {
    parts.push(`${report.changed.length} changed (${listNames(report.changed.map((change) => change.name), limit)})`);
  }
  return `Cua Driver ${version} is untested (plugin tested with ${tested}): ${parts.join("; ")}.`;
}

/** Every name, plus one line per changed tool, for the CLI. */
export function formatDrift(report: DriftReport): string {
  const lines = [summarizeDrift(report, Number.POSITIVE_INFINITY)];
  for (const change of report.changed) lines.push(`  ~ ${change.name}: ${change.details.join("; ")}`);
  return lines.join("\n");
}

/** A report with its verdict and one-line summary, as the settings page and `bb cua drift --json` show it. */
export function driftView(report: DriftReport): DriftReport & { drifted: boolean; summary: string } {
  return { ...report, drifted: hasDrift(report), summary: summarizeDrift(report) };
}
