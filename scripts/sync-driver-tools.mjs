#!/usr/bin/env node
/**
 * Regenerates src/driver-snapshot.json from a cua-driver binary by asking its
 * MCP server for tools/list. The snapshot is the catalog this plugin release
 * was tested against: the plugin offers it before a machine's own driver has
 * been read, and reports drift against it.
 *
 *   npm run sync:tools                         # cua-driver on PATH
 *   CUA_DRIVER_BIN=/path/to/cua-driver npm run sync:tools
 *   npm run sync:tools -- --summary out.md     # also write a Markdown change summary
 *
 * The binary needs no macOS permissions and no running service for this.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const binary = process.env.CUA_DRIVER_BIN ?? "cua-driver";
const outputPath = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "driver-snapshot.json");
const summaryFlag = process.argv.indexOf("--summary");
const summaryPath = summaryFlag >= 0 ? process.argv[summaryFlag + 1] : undefined;
const TIMEOUT_MS = 60_000;

function listTools() {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ["mcp"], { stdio: ["pipe", "pipe", "inherit"] });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${binary} mcp did not answer within ${TIMEOUT_MS / 1000}s`));
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
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "bb-plugin-computer-use-sync", version: "0" },
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

const { version, tools } = await listTools();
const snapshot = {
  driverVersion: version,
  tools: tools.map(keep).sort((a, b) => a.name.localeCompare(b.name)),
};
const previous = existsSync(outputPath) ? JSON.parse(readFileSync(outputPath, "utf8")) : null;
writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`);
const summary = summarize(previous, snapshot);
if (summaryPath !== undefined) writeFileSync(summaryPath, `${summary}\n`);
console.log(summary);
