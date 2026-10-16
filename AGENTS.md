# AGENTS.md

A bb plugin (`computer-use`) that gives bb agents Cua Driver computer use,
plus an optional Chromium extension in `browser-extension/` (npm workspace).

## Commands

```sh
npm install            # if better-sqlite3 fails: --ignore-scripts, then PYTHON=/usr/bin/python3 npm rebuild better-sqlite3
npm run check          # typecheck (plugin + extension), tests, plugin build, extension build; CI runs the same
npm run test:network   # recorded installer checksums against what GitHub serves
npm run test:live      # drives Calculator through this Mac's Cua Driver
npm run build:extension && npm run test:browser   # extension end to end in a throwaway headless Chromium
npm run sync:tools     # refresh the tested driver snapshot and installer checksums
```

A local checkout runs in bb from its path: after a change, `npm run build`
then `bb plugin reload computer-use`. Agent tools, skills and instructions
change only in sessions that start afterwards.

## Where things live

```
server.ts                plugin factory: settings, tools, configure(), rpc, cli, events
host.ts                  host worker: find cua-driver, readiness, MCP session, installs, browser bridge
app.tsx                  settings cards and the approval card
src/exposure.ts          reviewed exposure per driver tool; the sensitive-action list
src/catalog.ts           agent tool names, meta tools, schema overrides
src/policy.ts            routing decision
src/contract.ts          server ⇄ host RPC contract
src/driver-tools.ts      normalize a driver's tools/list
src/drift.ts             compare a machine's tools with the tested snapshot
src/snapshot.ts, src/installer.ts   tested driver catalog and installer checksums
src/mcp-client.ts        MCP stdio JSON-RPC client
src/browser-tools.ts     browser_* agent tools of the extension
src/browser-host.ts      extension bridge: install, sockets, calls
src/browser-bridge-script.ts  native messaging host the browser starts
skills/cua-computer-use/ agent skill injected when the tools are offered
docs/REFERENCE.md        user-facing behaviour in full (settings, routing, safety)
docs/SPEC.md, docs/ARCHITECTURE.md, docs/SETTINGS-UI.md   design notes
```

## Rules that are easy to break

- **A setting with its own card lives in `bb.storage.kv`, not
  `bb.settings.define`.** bb renders every declared setting in its form and
  cannot hide one, so a declared routing mode or browser-extension switch
  would show twice.
- **A new driver tool needs a reviewed exposure in `src/exposure.ts`.**
  `src/catalog.test.ts` fails until it has one. Keep parameter names
  identical to upstream so typed tools and `cua_call` agree.
- **Safety switches default to the permissive choice and stay switchable**
  (the user prefers automation); new risky tools still start off.
- **The extension's ids are pinned.** The native host name must match
  `browser-extension/src/shared.ts`. `EXTENSION_IDS` in `src/browser-host.ts`
  lists the unpacked id (fixed by the manifest `key`); add the Web Store id
  there once published. Installed paths stay `agent-browser-bridge`.
- **Branding:** the extension is "Browser Bridge for bb" with its own icon.
  Use no bb or Cua logo or artwork.
- Never bundle Cua Driver binaries; installs run only on the user's request.
- Server and host behaviour is tested with `@get-bb/plugin-sdk/testing`;
  pure logic lives in `src/` with unit tests.

User-visible changes go in `CHANGELOG.md` under **Unreleased**, and into
`docs/REFERENCE.md` when they change behaviour. Keep the README short:
features and getting started only.
