// Zips dist/ for the Chrome Web Store. The store assigns its own key, so the
// development "key" is dropped from the packaged manifest.
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, "dist", "manifest.json"), "utf8"));
delete manifest.key;
const work = mkdtempSync(join(tmpdir(), "extension-"));
try {
  cpSync(join(root, "dist"), work, { recursive: true });
  writeFileSync(join(work, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const out = join(root, `agent-browser-bridge-${manifest.version}.zip`);
  rmSync(out, { force: true });
  execFileSync("zip", ["-qr", out, "."], { cwd: work });
  console.log(out);
} finally {
  rmSync(work, { recursive: true, force: true });
}
