#!/usr/bin/env node
/**
 * Prints one version's section of CHANGELOG.md: the notes of its GitHub
 * release, which .github/workflows/release.yml publishes on a v* tag.
 *
 *   node scripts/release-notes.mjs v0.5.2
 *
 * Exits 1 when the changelog has no section for that version.
 */
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The body of a version's `## <version>` section, without its heading; null when there is none. */
export function releaseNotes(changelog, version) {
  const wanted = version.replace(/^v/, "");
  const lines = changelog.split("\n");
  const isHeading = (line) => line.startsWith("## ");
  // A heading reads "## 0.5.2 - 2026-10-20", "## 0.3.0" or "## 0.2.0 (never tagged)".
  const start = lines.findIndex((line) => isHeading(line) && line.slice(3).split(/[\s(]/)[0] === wanted);
  if (start === -1) return null;
  const next = lines.findIndex((line, index) => index > start && isHeading(line));
  const body = lines
    .slice(start + 1, next === -1 ? lines.length : next)
    .join("\n")
    .trim();
  return body === "" ? null : body;
}

const isEntryPoint = process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntryPoint) {
  const version = process.argv[2] ?? "";
  const changelog = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "CHANGELOG.md"), "utf8");
  const notes = version === "" ? null : releaseNotes(changelog, version);
  if (notes === null) {
    console.error(`CHANGELOG.md has no section for ${version || "(no version given)"}.`);
    process.exit(1);
  }
  process.stdout.write(`${notes}\n`);
}
