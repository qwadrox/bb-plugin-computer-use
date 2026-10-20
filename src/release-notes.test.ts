import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { releaseNotes } from "../scripts/release-notes.mjs";

const CHANGELOG = `# Changelog

## Unreleased

- Coming.

## 0.5.2 - 2026-10-20

- Two.
- More of two.

## 0.3.0

- Three.

## 0.2.0 (never tagged)

- Old.
`;

describe("release notes", () => {
  it("take a version's section without its heading, with or without the tag's v", () => {
    expect(releaseNotes(CHANGELOG, "0.5.2")).toBe("- Two.\n- More of two.");
    expect(releaseNotes(CHANGELOG, "v0.5.2")).toBe("- Two.\n- More of two.");
    expect(releaseNotes(CHANGELOG, "0.3.0")).toBe("- Three.");
    expect(releaseNotes(CHANGELOG, "0.2.0")).toBe("- Old.");
  });

  it("are missing for an unknown version or a version that only starts the same", () => {
    expect(releaseNotes(CHANGELOG, "0.4.0")).toBeNull();
    expect(releaseNotes(CHANGELOG, "0.5")).toBeNull();
  });

  it("exist for this package's version, so its tag gets a release", () => {
    const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    expect(releaseNotes(readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8"), version)).not.toBeNull();
  });
});
