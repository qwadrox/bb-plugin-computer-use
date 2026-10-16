# Plan: Desktop & Browser Agent rebuild

Starting point: `068c7ef` (unreleased 0.2.0, built against Cua Driver 0.28.2).
Plugin id `computer-use`, package `bb-plugin-computer-use`.

## Why the rebuild

- Cua Driver ships a release every 1–3 days (12 stable releases between
  2026-09-30 and 2026-10-16). The last commit before the rebuild was 2026-09-23,
  and 0.2.0 was never tagged, so the marketplace still serves 0.1.0.
- 0.2.0 still treats a hand-maintained catalog plus a bundled schema snapshot
  as the source of truth. On driver 0.36.0 that catalog exposes 32 of 60 tools
  and misses `run_steps`, which the driver now calls "the default way to act".
- `cua_call` forwards to any driver tool with no gate, so `run_script`,
  `kill_app`, `install_extension`, and `set_config` are reachable even though
  no setting mentions them.

## Facts this design relies on

Checked against bb 0.46.1 (`start-server.js`) and Cua Driver 0.36.0 on
2026-10-16.

| Fact | Evidence |
| --- | --- |
| `configure()` parameter overrides are only shape-checked: object root, JSON-serializable, ≤ 128 KiB, no recursive `$ref`. Not checked for narrowing. | `normalizePluginAgentToolParameters` |
| `bb.agents.registerTool` works after plugin load (only guarded by `assertLive`), and `resolveAgentConfiguration` re-reads every plugin's tool list per resolution, so a late registration reaches the next session. Undocumented; the SDK docs say "statically registered". | `registerTool`, `collectAgentTools` |
| A plugin can reload itself through `bb.sdk.plugins.reload({ pluginId })`. Fallback if late registration ever stops working. | SDK `PluginsArea.reload` |
| The only complete source of the macOS tool list is the driver binary's MCP `tools/list`. It needs no TCC permission and answers in about 1 s. | Compared on 0.36.0: binary 60 tools; `libs/cua-driver/contract/manifest.json` 29 tools (portable subset, missing macOS-only properties such as `pid`, `window_id`); TS SDK has no schemas. |
| Each driver tool carries `annotations` (read-only, destructive, idempotent, open-world) and `risk.class` r0–r3. `risk.class` measures data sensitivity (screenshots are r3), not danger: `run_script` is r1. | `tools/list` on 0.36.0 |
| The installer pins a version with `CUA_DRIVER_RS_VERSION`. Stable tags are `cua-driver-rs-vX.Y.Z`; GitHub marks them all "Pre-release" by convention. | `_install-rust.sh` |
| GitHub-hosted standard runners, macOS included, are free on public repositories. | [GitHub docs](https://docs.github.com/en/billing/reference/actions-runner-pricing) |

## Design

### 1. The driver's `tools/list` is the catalog

- On first connection to a machine, read `tools/list` and cache it in kv under
  `catalog:<hostId>`, with the driver version it came from.
- Register one bb tool per driver tool (`cua_<name>`) with a permissive schema
  (`{type: "object", additionalProperties: true}`); `configure()` hands each
  session the driver's exact schema for that machine. The driver stays the only
  validator.
- Newly seen tool names are registered on the fly. Tools a machine does not
  report are left out of that machine's selection.
- A bundled snapshot (`src/driver-snapshot.json`) is used only before
  the first successful `tools/list`, so a fresh install still offers tools.
- Curated text (short descriptions, progress labels, group) stays as an
  optional overlay keyed by tool name. A tool without an overlay uses the
  driver's first sentence.

### 2. Exposure policy

Three tiers, decided by the plugin, not by `risk.class`:

- **On by default:** read and act tools a person would expect (`list_*`,
  `get_window_state`, `click`, `type_text`, `run_steps`, browser tools, …).
- **Opt-in (setting per tool):** `run_script`, `kill_app`, `install_extension`,
  `install_ffmpeg`, `set_config`, `replay_trajectory`, `start_recording` /
  `stop_recording`, `page`, plus signed-in browser profiles (already a setting).
- **New, unreviewed tools:** read-only ones (`annotations.readOnlyHint`) are on;
  anything else stays off until the user enables it or the bundled policy
  lists it.

`cua_call` applies the same policy; it no longer bypasses it.

### 3. Drift detection without scheduled jobs on the user's Mac

- **In the plugin:** on connect, diff the live `tools/list` against the
  snapshot this release was tested with. `bb cua status` and the settings page
  show "Driver 0.37.0 is untested: +2 tools, `browser_click` changed, −`zoom`";
  agents get a one-line note.
- **In CI (public repo, free runners):** a daily Linux job checks for a new
  `cua-driver-rs-v*` tag and exits in seconds when there is none. On a new tag,
  a macOS job downloads the signed `darwin-universal-binary` tarball, verifies
  its checksum, reads `tools/list`, and opens a PR with the schema diff and
  the regenerated snapshot. No permissions or GUI needed.
- **Locally, on demand:** `npm run sync:tools` against the installed driver.

### 4. Pinned driver installs

- Each plugin release records the driver version it was tested with
  (`TESTED_DRIVER_VERSION`, from the snapshot).
- Install runs the official installer with `CUA_DRIVER_RS_VERSION` set to that
  version. "Update" offers the tested version, or "latest (untested)" as an
  explicit second choice.

### 5. Skill

- Track the upstream skill pack (`cua-driver-rs-vX.Y.Z-skills.tar.gz` release
  asset) in the same CI PR, and keep `skills/cua-computer-use/SKILL.md` as a
  short bb-specific layer on top: tool prefix, `run_steps` first, the
  exposure policy, and stop-and-ask rules for sending or deleting.

## Phases

All seven shipped in 0.3.0 (see CHANGELOG.md). Two changes from the design
above: the macOS CI job reads tools with `cua-driver mcp --direct`, since a
runner has no CuaDriver.app; and pinned installs also check each installer
file against a sha256 recorded in `src/driver-installer.json` before running
it.

1. **Rename and baseline.** Package, plugin id, settings path, docs. Tests green.
2. **Live catalog.** Dynamic registration from `tools/list`, kv cache,
   overlay, bundled fallback; regenerate the snapshot from 0.36.0.
3. **Exposure policy.** Tiers, per-tool opt-in settings, `cua_call` gating.
4. **Drift report.** Diff module, status/CLI/settings output, agent note.
5. **Pinned installs.** `CUA_DRIVER_RS_VERSION`, tested-version update path.
6. **CI.** Typecheck/test/build workflow; the two-stage drift workflow.
7. **Skill refresh** and README. Tag `v0.3.0`.

Live verification on this Mac after phases 2, 3 and 5: read-only checks in
Outlook and Teams, then a harmless Brave tab.
