/**
 * Cua Driver tools as the plugin keeps them: the driver's own `tools/list`
 * entries, compacted so a whole machine's catalog fits in one kv value and
 * every advertised schema stays small enough for each session's prompt.
 */

export interface DriverToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface DriverTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: DriverToolAnnotations;
}

/** A machine's catalog as last read from its driver. */
export interface DriverCatalog {
  driverVersion: string | null;
  tools: DriverTool[];
}

const PROPERTY_DESCRIPTION_LIMIT = 200;
const TOOL_DESCRIPTION_LIMIT = 1_500;
const SUMMARY_LIMIT = 160;
const ANNOTATION_KEYS = ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"] as const;

/** The text up to its first sentence end, bounded; the whole text when it has none. */
/** Words with a dot that do not end a sentence. */
const ABBREVIATION = /(?:^|[\s(])(?:e\.g|i\.e|etc|vs|cf|approx|incl|min|max|ca|no)\.$/i;
/** A first sentence shorter than this keeps the next one. */
const SHORT_SENTENCE = 60;

export function firstSentence(text: string, limit = SUMMARY_LIMIT): string {
  const flat = text.replace(/\s+/g, " ").trim();
  // A sentence ends at . ! or ? before a space, except after an abbreviation such as "e.g.".
  const ends: number[] = [];
  for (const match of flat.matchAll(/[.!?](?=\s|$)/g)) {
    const before = flat.slice(0, match.index + 1);
    if (!ABBREVIATION.test(before)) ends.push(match.index + 1);
  }
  // A short first sentence ("Default false.") says little without the next one.
  let end = ends.find((index) => index >= SHORT_SENTENCE) ?? flat.length;
  if (end > limit) end = ends.filter((index) => index <= limit).pop() ?? end;
  const sentence = flat.slice(0, end);
  return sentence.length > limit ? `${sentence.slice(0, limit - 1)}…` : sentence;
}

/** The driver's description up to its first blank line, bounded. */
export function leadParagraph(text: string, limit = TOOL_DESCRIPTION_LIMIT): string {
  const paragraph = (text.split(/\n\s*\n/)[0] ?? "").replace(/\s+/g, " ").trim();
  return paragraph.length > limit ? `${paragraph.slice(0, limit - 1)}…` : paragraph;
}

/**
 * Schema with property descriptions cut to their first sentence, examples
 * dropped, and keys sorted. Validation keywords are untouched, so the driver
 * accepts exactly what it did before; only the prose shrinks.
 */
export function compactSchema(schema: unknown, insideProperties = false): unknown {
  if (Array.isArray(schema)) return schema.map((entry) => compactSchema(entry));
  if (schema === null || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(schema).sort()) {
    const value = (schema as Record<string, unknown>)[key];
    if (insideProperties) {
      // Keys here are property names, which may be "description" or "examples".
      out[key] = compactSchema(value);
    } else if (key === "description" && typeof value === "string") {
      out[key] = firstSentence(value, PROPERTY_DESCRIPTION_LIMIT);
    } else if (key === "examples") {
      continue;
    } else {
      out[key] = compactSchema(value, key === "properties" || key === "patternProperties" || key === "$defs" || key === "definitions");
    }
  }
  return out;
}

function readAnnotations(value: unknown): DriverToolAnnotations {
  if (typeof value !== "object" || value === null) return {};
  const annotations: DriverToolAnnotations = {};
  for (const key of ANNOTATION_KEYS) {
    const flag = (value as Record<string, unknown>)[key];
    if (typeof flag === "boolean") annotations[key] = flag;
  }
  return annotations;
}

/** One raw `tools/list` entry, compacted; null when it is not a usable tool. */
export function normalizeDriverTool(raw: unknown): DriverTool | null {
  if (typeof raw !== "object" || raw === null) return null;
  const entry = raw as Record<string, unknown>;
  if (typeof entry.name !== "string" || entry.name.length === 0) return null;
  const schema = entry.inputSchema;
  const inputSchema =
    typeof schema === "object" && schema !== null && !Array.isArray(schema)
      ? (compactSchema(schema) as Record<string, unknown>)
      : { type: "object" };
  return {
    name: entry.name,
    description: leadParagraph(typeof entry.description === "string" ? entry.description : ""),
    inputSchema,
    annotations: readAnnotations(entry.annotations),
  };
}

export function normalizeDriverTools(raw: readonly unknown[]): DriverTool[] {
  return raw
    .map(normalizeDriverTool)
    .filter((tool): tool is DriverTool => tool !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function isReadOnly(tool: DriverTool | undefined): boolean {
  return tool?.annotations.readOnlyHint === true;
}
