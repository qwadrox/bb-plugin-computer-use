/**
 * The native messaging host for the Browser Bridge for bb extension, written to
 * disk by the host worker and started by the browser. It relays between the
 * extension (length-prefixed JSON on stdin/stdout) and the host worker
 * (newline-delimited JSON on a Unix socket only this user can open). It exits
 * when the browser closes stdin. Node built-ins only.
 */
export const BRIDGE_SCRIPT = String.raw`// Browser Bridge for bb native host. Written by the Computer Use bb plugin; do not edit.
import { createServer } from "node:net";
import { chmodSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const socketDir = process.env.AGENT_BRIDGE_SOCKETS;
if (!socketDir) process.exit(2);
mkdirSync(socketDir, { recursive: true, mode: 0o700 });
const socketPath = join(socketDir, process.pid + ".sock");
const pending = new Map();
let hello = null;
let sequence = 0;
let input = Buffer.alloc(0);

function toExtension(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([header, body]));
}

function toClient(socket, message) {
  if (!socket.destroyed) socket.write(JSON.stringify(message) + "\n");
}

function fromExtension(message) {
  if (message && message.type === "hello") {
    hello = { browser: String(message.browser), version: String(message.version), extension: String(message.extension), pid: process.pid };
    return;
  }
  if (!message || typeof message.id !== "string") return;
  const entry = pending.get(message.id);
  if (!entry) return;
  pending.delete(message.id);
  toClient(entry.socket, message.error ? { id: entry.id, error: message.error } : { id: entry.id, result: message.result });
}

process.stdin.on("data", (chunk) => {
  input = Buffer.concat([input, chunk]);
  while (input.length >= 4) {
    const length = input.readUInt32LE(0);
    if (input.length < 4 + length) break;
    const body = input.subarray(4, 4 + length);
    input = input.subarray(4 + length);
    try {
      fromExtension(JSON.parse(body.toString("utf8")));
    } catch {}
  }
});

function fromClient(socket, line) {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return;
  }
  if (request.method === "hello") {
    toClient(socket, { id: request.id, result: hello });
    return;
  }
  sequence += 1;
  const id = "b" + sequence;
  pending.set(id, { socket, id: request.id });
  toExtension({ id, method: String(request.method), params: request.params || {} });
}

const server = createServer((socket) => {
  socket.setEncoding("utf8");
  let text = "";
  socket.on("data", (chunk) => {
    text += chunk;
    let index;
    while ((index = text.indexOf("\n")) >= 0) {
      const line = text.slice(0, index);
      text = text.slice(index + 1);
      if (line.trim() !== "") fromClient(socket, line);
    }
  });
  socket.on("close", () => {
    for (const [id, entry] of pending) if (entry.socket === socket) pending.delete(id);
  });
  socket.on("error", () => {});
});

function shutdown() {
  try {
    server.close();
  } catch {}
  try {
    unlinkSync(socketPath);
  } catch {}
  process.exit(0);
}
process.stdin.on("end", shutdown);
process.stdin.on("error", shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

for (const name of readdirSync(socketDir)) {
  const pid = Number(name.replace(/\.sock$/, ""));
  if (!Number.isInteger(pid) || pid === process.pid) continue;
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (error && error.code === "ESRCH") {
      try {
        unlinkSync(join(socketDir, name));
      } catch {}
    }
  }
}

try {
  unlinkSync(socketPath);
} catch {}
server.listen(socketPath, () => {
  try {
    chmodSync(socketPath, 0o600);
  } catch {}
  toExtension({ type: "ready" });
});
`;
