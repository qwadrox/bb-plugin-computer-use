# Contributing

Thanks for helping. This plugin follows bb's community conventions.

## Before you open a pull request

- Open an issue first for features and UI changes; bug fixes can go straight
  to a PR.
- Run `npm run check` (typecheck, tests, plugin and extension builds). CI runs
  those too, plus `npm run test:network` against the recorded installer
  checksums. The opt-in suites are not in CI: `npm run test:live` needs Cua
  Driver on a Mac, and `npm run test:browser` needs a Chromium binary in
  `CHROMIUM`. Run them when your change touches what they cover.
- Keep pure logic in `src/` and unit-test it. Server and host behavior is
  tested with `@get-bb/plugin-sdk/testing`; do not mock the fake host's
  storage.
- Never bundle Cua Driver binaries or call the installer from the plugin. The
  user installs and grants permissions on each machine.
- Any new bb SDK surface you rely on must exist in the `@get-bb/plugin-sdk`
  version pinned in `package.json`; bump `engines.bbPluginSdk` when you raise
  it.

## Tool catalog changes

Each upstream Cua Driver tool has a reviewed exposure in `src/exposure.ts`;
`src/catalog.ts` holds agent tool names and schema overrides. When you add or
change an entry, cite the upstream reference
(<https://cua.ai/docs/reference/cua-driver/mcp-tools>) in the PR and keep
parameter names identical to upstream so `cua_call` and the typed tools agree.

## Commit messages and PR body

Explain the root cause, what changed, and how you verified it. If an agent
wrote the PR, end the body with `> AGENT GENERATED`.
