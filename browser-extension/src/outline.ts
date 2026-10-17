import type { PageChanges } from "./shared.js";

/** An action's change lists stop at this many lines each. */
const CHANGE_LINES = 40;
/** The new outline an action reports when most of the page changed. */
const OUTLINE_CHARS = 4_000;

/** Compares outlines line by line, as multisets, so a moved line is not a change. */
export function diffOutline(before: string[] | null, after: string[], navigated: boolean): PageChanges {
  const outline = (): PageChanges => {
    const text = after.join("\n");
    return { added: [], removed: [], outline: text.slice(0, OUTLINE_CHARS), ...(text.length > OUTLINE_CHARS ? { truncated: true } : {}) };
  };
  if (before === null) return outline();
  const left = new Map<string, number>();
  for (const line of before) left.set(line, (left.get(line) ?? 0) + 1);
  const added: string[] = [];
  for (const line of after) {
    const count = left.get(line) ?? 0;
    if (count > 0) left.set(line, count - 1);
    else added.push(line);
  }
  const removed: string[] = [];
  for (const line of before) {
    const count = left.get(line) ?? 0;
    if (count > 0) {
      removed.push(line);
      left.set(line, count - 1);
    }
  }
  // Another page, or a view that replaced most of this one: its outline says more than the lists.
  if (added.length > 0 && (navigated || added.length + removed.length > CHANGE_LINES) && added.length * 2 > after.length) return outline();
  const truncated = added.length > CHANGE_LINES || removed.length > CHANGE_LINES;
  return { added: added.slice(0, CHANGE_LINES), removed: removed.slice(0, CHANGE_LINES), ...(truncated ? { truncated: true } : {}) };
}
