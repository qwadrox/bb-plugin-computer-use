// Copies the static files (manifest, popup page, icons) next to the compiled scripts.
import { cp, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
await mkdir(`${root}dist`, { recursive: true });
await cp(`${root}static`, `${root}dist`, { recursive: true, filter: (source) => !source.endsWith(".svg") });
