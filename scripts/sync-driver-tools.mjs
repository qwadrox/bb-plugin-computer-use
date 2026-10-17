#!/usr/bin/env node
/**
 * Regenerates src/driver-snapshot.json from a cua-driver binary by asking its
 * MCP server for tools/list. The snapshot is the catalog this plugin release
 * was tested against: the plugin offers it before a machine's own driver has
 * been read, and reports drift against it.
 *
 * It also records src/driver-installer.json: the sha256 of each installer file
 * of that release. Release assets are checked against the release's SHA256SUMS
 * first; the `_install-common` helpers are not release assets and are read
 * from the release tag. The plugin refuses to run installer files that differ.
 *
 *   npm run sync:tools                         # cua-driver on PATH
 *   CUA_DRIVER_BIN=/path/to/cua-driver npm run sync:tools
 *   npm run sync:tools -- --summary out.md     # also write a Markdown change summary
 *   npm run sync:tools -- --direct             # macOS without CuaDriver.app (CI)
 *
 * Reading tools/list needs no macOS permissions. On macOS, `cua-driver mcp`
 * proxies to CuaDriver.app and launches it when needed; `--direct` runs the
 * driver inside the MCP process instead, for a machine without the app.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const binary = process.env.CUA_DRIVER_BIN ?? "cua-driver";
const sourceDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const outputPath = join(sourceDir, "driver-snapshot.json");
const installerPath = join(sourceDir, "driver-installer.json");
// The values the plugin uses, kept here because this script runs under plain Node and
// cannot import src/*.ts. src/installer.test.ts and src/mcp-client.test.ts assert they match.
export const PROTOCOL_VERSION = "2025-06-18";
const RELEASE_DOWNLOAD_BASE = "https://github.com/trycua/cua/releases/download";
const SOURCE_BASE = "https://raw.githubusercontent.com/trycua/cua";
const RELEASE_ASSETS = ["install.sh", "_install-rust.sh", "install.ps1"];
const TAGGED_SOURCES = ["_install-common.sh", "_install-common.psm1"];
const summaryFlag = process.argv.indexOf("--summary");
const summaryPath = summaryFlag >= 0 ? process.argv[summaryFlag + 1] : undefined;
const mcpArgs = process.argv.includes("--direct") ? ["mcp", "--direct"] : ["mcp"];
const TIMEOUT_MS = 60_000;

function listTools() {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, mcpArgs, { stdio: ["pipe", "pipe", "inherit"] });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${binary} ${mcpArgs.join(" ")} did not answer within ${TIMEOUT_MS / 1000}s`));
    }, TIMEOUT_MS);
    const pending = new Map();
    let nextId = 1;
    const send = (method, params) =>
      new Promise((done, fail) => {
        const id = nextId++;
        pending.set(id, { done, fail });
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      });
    createInterface({ input: child.stdout }).on("line", (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      const waiter = pending.get(message.id);
      if (waiter === undefined) return;
      pending.delete(message.id);
      if (message.error) waiter.fail(new Error(message.error.message ?? "MCP error"));
      else waiter.done(message.result);
    });
    child.once("error", reject);
    (async () => {
      const init = await send("initialize", {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "bb-plugin-desktop-browser-agent-sync", version: "0" },
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);
      const tools = [];
      let cursor;
      do {
        const result = await send("tools/list", cursor === undefined ? {} : { cursor });
        tools.push(...(result.tools ?? []));
        cursor = typeof result.nextCursor === "string" ? result.nextCursor : undefined;
      } while (cursor !== undefined);
      return { version: init?.serverInfo?.version ?? null, tools };
    })().then(
      (value) => {
        clearTimeout(timer);
        child.stdin.end();
        child.kill();
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        child.kill();
        reject(error);
      },
    );
  });
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]));
}

/** Only what the plugin reads; capabilities, risk and output schemas churn without affecting it. */
function keep(tool) {
  return sortKeys({
    name: tool.name,
    description: tool.description ?? "",
    inputSchema: tool.inputSchema ?? { type: "object" },
    annotations: tool.annotations ?? {},
  });
}

function summarize(previous, next) {
  const before = new Map((previous?.tools ?? []).map((tool) => [tool.name, JSON.stringify(tool)]));
  const after = new Map(next.tools.map((tool) => [tool.name, JSON.stringify(tool)]));
  const added = [...after.keys()].filter((name) => !before.has(name));
  const removed = [...before.keys()].filter((name) => !after.has(name));
  const changed = [...after.keys()].filter((name) => before.has(name) && before.get(name) !== after.get(name));
  const list = (names) => (names.length === 0 ? "none" : names.map((name) => `\`${name}\``).join(", "));
  return [
    `Cua Driver ${previous?.driverVersion ?? "(none)"} → ${next.driverVersion ?? "(unknown)"}: ${next.tools.length} tools.`,
    "",
    `- Added: ${list(added)}`,
    `- Removed: ${list(removed)}`,
    `- Changed: ${list(changed)}`,
  ].join("\n");
}

async function download(url) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

const sha256 = (content) => createHash("sha256").update(content).digest("hex");

export function releaseTag(version) {
  return `cua-driver-rs-v${version}`;
}

/**
 * The installer files of one release, with where each comes from. `released`
 * files are listed in the release's SHA256SUMS; the others are read from the tag.
 */
export function installerSources(version) {
  const tag = releaseTag(version);
  return [
    ...RELEASE_ASSETS.map((name) => ({ name, url: `${RELEASE_DOWNLOAD_BASE}/${tag}/${name}`, released: true })),
    ...TAGGED_SOURCES.map((name) => ({
      name,
      url: `${SOURCE_BASE}/${tag}/libs/cua-driver/scripts/${name}`,
      released: false,
    })),
  ];
}

async function installerChecksums(version) {
  const tag = releaseTag(version);
  const published = new Map(
    (await download(`${RELEASE_DOWNLOAD_BASE}/${tag}/SHA256SUMS`))
      .toString("utf8")
      .split("\n")
      .map((line) => line.trim().split(/\s+\*?/))
      .filter((parts) => parts.length === 2)
      .map(([hash, name]) => [name, hash.toLowerCase()]),
  );
  const checksums = {};
  for (const { name, url, released } of installerSources(version)) {
    const actual = sha256(await download(url));
    if (released && published.get(name) !== actual) {
      throw new Error(`${tag}/${name} does not match the release's SHA256SUMS`);
    }
    checksums[name] = actual;
  }
  return { driverVersion: version, sha256: sortKeys(checksums) };
}

async function main() {
  const { version, tools } = await listTools();
  if (typeof version !== "string") throw new Error(`${binary} did not report its version; cannot record installer checksums`);
  const snapshot = {
    driverVersion: version,
    tools: tools.map(keep).sort((a, b) => a.name.localeCompare(b.name)),
  };
  const previous = existsSync(outputPath) ? JSON.parse(readFileSync(outputPath, "utf8")) : null;
  const installer = await installerChecksums(version);
  writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  writeFileSync(installerPath, `${JSON.stringify(installer, null, 2)}\n`);
  const summary = `${summarize(previous, snapshot)}\n\nInstaller checksums recorded for ${Object.keys(installer.sha256).join(", ")}.`;
  if (summaryPath !== undefined) writeFileSync(summaryPath, `${summary}\n`);
  console.log(summary);
}

// Importing the module (the tests do) must not run a sync.
const isEntryPoint = process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntryPoint) await main();
