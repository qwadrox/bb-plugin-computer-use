import { z } from "zod";

/** Agent-facing tools are the driver's names with this prefix. */
export const TOOL_PREFIX = "cua_";

/**
 * Arguments the plugin supplies itself. `session` carries the thread's Cua
 * session label, so an agent never names (or borrows) another thread's session.
 */
export const PLUGIN_MANAGED_ARGUMENTS: readonly string[] = ["session"];

/** Registered schema for a driver tool before a machine's own schema is known. */
export const PERMISSIVE_SCHEMA: Record<string, unknown> = { type: "object", additionalProperties: true };

export function agentToolName(driverName: string): string {
  return `${TOOL_PREFIX}${driverName}`;
}

/** Accepts `click` or `cua_click`; returns the driver's name. */
export function driverToolName(name: string): string {
  return name.startsWith(TOOL_PREFIX) ? name.slice(TOOL_PREFIX.length) : name;
}

/** Cua Driver's schema as agents should see it: without the arguments the plugin owns. */
export function advertisedSchema(schema: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const properties =
    typeof schema.properties === "object" && schema.properties !== null
      ? { ...(schema.properties as Record<string, unknown>) }
      : {};
  for (const key of PLUGIN_MANAGED_ARGUMENTS) delete properties[key];
  const required = Array.isArray(schema.required)
    ? schema.required.filter((key): key is string => typeof key === "string" && !PLUGIN_MANAGED_ARGUMENTS.includes(key))
    : [];
  const next: Record<string, unknown> = { ...schema, type: "object", properties };
  if (required.length > 0) next.required = required;
  else delete next.required;
  return next;
}

/** bb's cap on a schema that configure() returns for one tool. */
const SCHEMA_OVERRIDE_MAX_BYTES = 128 * 1024;

function hasReference(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasReference);
  if (value === null || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) => key === "$ref" || key === "$dynamicRef" || hasReference(child));
}

/**
 * A machine's schema as a per-session override, or null to keep the
 * registered one. bb rejects an override that is too large or has a recursive
 * reference, and one rejected override drops every tool the plugin selected
 * for that session, so anything doubtful falls back. Arguments are forwarded
 * untouched either way.
 */
export function overridableSchema(schema: Readonly<Record<string, unknown>>): Record<string, unknown> | null {
  const advertised = advertisedSchema(schema);
  if (hasReference(advertised)) return null;
  const bytes = new TextEncoder().encode(JSON.stringify(advertised)).byteLength;
  return bytes > SCHEMA_OVERRIDE_MAX_BYTES ? null : advertised;
}

export interface MetaTool {
  name: string;
  description: string;
  parameters: z.ZodObject<z.ZodRawShape>;
  labels: { pending: string; completed: string };
}

export const META_TOOLS: readonly MetaTool[] = [
  {
    name: "cua_call",
    description:
      "Call a Cua Driver tool by name with a JSON argument object. Use it for tools that have no dedicated cua_* tool; cua_describe lists them and shows each schema. Tools turned off in Computer Use settings are refused.",
    parameters: z.object({
      tool: z.string().min(1).describe("Driver tool name such as get_screen_size"),
      arguments: z.record(z.string(), z.unknown()).default({}),
    }),
    labels: { pending: "Calling Cua Driver", completed: "Called Cua Driver" },
  },
  {
    name: "cua_describe",
    description:
      "List every Cua Driver tool on this machine with how agents may reach it (dedicated tool, cua_call, or off), or return one tool's full description and JSON input schema.",
    parameters: z.object({ tool: z.string().min(1).optional() }),
    labels: { pending: "Describing Cua tools", completed: "Described Cua tools" },
  },
  {
    name: "cua_status",
    description:
      "Report whether Cua Driver is installed, running, permitted, and the version this plugin was tested with on this thread's machine, with setup instructions when it is not ready.",
    parameters: z.object({}),
    labels: { pending: "Checking Cua Driver", completed: "Checked Cua Driver" },
  },
];

export const META_TOOL_NAMES: ReadonlySet<string> = new Set(META_TOOLS.map((tool) => tool.name));
