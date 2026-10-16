# Computer Use for bb

Computer use for [bb](https://getbb.app) agents, powered by
[Cua Driver](https://cua.ai/docs) from Cua AI, Inc.

Agents running in bb threads get `cua_*` tools that observe and operate native
desktop apps and Chromium browser windows **on the machine that runs the
thread**, in the background, without stealing focus. Routing is per provider:
harnesses that ship their own computer use (Codex today) can keep it while
Claude Code, Pi, ACP agents, and everything else use Cua Driver. Or force Cua
Driver everywhere, or turn it off.

This is a community plugin. It is not affiliated with or endorsed by Cua AI,
Inc. or the bb team. See [NOTICE.md](NOTICE.md) for attribution.

## What you get

| Surface | Details |
| --- | --- |
| Agent tools | Read from each machine's own Cua Driver (`tools/list`), so a newer driver's tools and arguments reach agents without a plugin release. With Cua Driver 0.36.0: 32 dedicated `cua_*` tools (desktop, browser, clipboard, and `cua_run_steps`, the driver's default way to act), 17 more through `cua_call`, and 9 off until you enable them. Plus `cua_call`, `cua_describe` and `cua_status`. Screenshots come back as images the model can see. |
| Exposure policy | Every driver tool is a dedicated tool, reachable only through `cua_call`, or off. Code execution (`run_script`), `kill_app`, recording, driver configuration and extension installs start off. A tool new to this plugin is reachable through `cua_call` if the driver marks it read-only, and off otherwise. `cua_call` obeys the same policy. |
| Drift report | The plugin compares each machine's driver with the one it was tested with and names new, removed and changed tools in `bb cua status`, `bb cua drift`, the settings page, and one line in agent instructions. |
| Pinned installs | Install and update target the tested driver by default. The plugin downloads that release's installer files from GitHub and runs them only if each matches a checksum recorded in this repo. The newest release is a separate, explicitly untested choice. |
| Agent skill | `cua-computer-use`: the upstream Cua Driver 0.36 loop (narrow reads, `run_steps` with `observe`, verify at checkpoints) plus bb rules: what to do when a tool is off, and when to stop and ask before sending or deleting. |
| Settings UI | Routing mode, per-provider overrides, an **Agent tools** card with per-tool exposure, and a setup checklist per machine with install, permission and drift state. |
| Browser extension (optional) | **Browser Bridge for bb**, a Chromium extension in this repo. Off by default. When you turn it on, agents get `browser_*` tools that work in the tabs of your everyday browser (Brave, Chrome, Edge, Chromium), in background tabs, while you keep browsing. See [Browser extension](#browser-extension-optional). |
| CLI | `bb cua status`, `drift`, `tools`, `expose`, `call`, `policy`, `mode`, `install`, `update`, `grant`, `browser`. |
| Multi-machine | Tool calls run on the host that owns the thread's environment through bb's host RPC, so remote enrolled machines work the same as the local one. |

## Requirements

- bb `>=0.39` with plugin SDK `>=0.4.16`.
- **Cua Driver on each machine that should be driven.** The plugin never
  installs it silently: click **Install Cua Driver…** next to a machine in the
  plugin settings, or run `bb cua install --yes`, or install it yourself.
  macOS 14+, Windows 10/11, or Linux x86_64 with X11 or XWayland plus AT-SPI 2.
  The tested release, by hand:

  ```sh
  # macOS / Linux
  CUA_DRIVER_RS_VERSION=0.36.0 /bin/bash -c "$(curl -fsSL https://cua.ai/driver/install.sh)"
  cua-driver doctor
  # macOS only: grant Accessibility + Screen Recording, then relaunch CuaDriver.app
  cua-driver permissions grant
  ```

  ```powershell
  # Windows
  $env:CUA_DRIVER_RS_VERSION="0.36.0"; irm https://cua.ai/driver/install.ps1 | iex
  cua-driver autostart kick
  ```

  Leave the variable out for the newest release. Install docs:
  <https://cua.ai/docs/how-to-guides/driver/install>.

## Install

```sh
bb plugin install https://github.com/qwadrox/bb-plugin-computer-use
# or pin a release range
bb plugin install git:https://github.com/qwadrox/bb-plugin-computer-use.git@^0.3.0
```

From a checkout:

```sh
npm install
bb plugin install .
```

## Staying current with Cua Driver

Each plugin release is tested against one Cua Driver release, recorded in
`src/driver-snapshot.json` (its `tools/list`) and `src/driver-installer.json`
(the sha256 of its installer files). Both come from one command:

```sh
npm run sync:tools                                   # cua-driver on PATH
CUA_DRIVER_BIN=/path/to/cua-driver npm run sync:tools
```

How a newer driver is noticed, without anything scheduled on your Mac:

- **On each machine:** after the driver connects, the plugin reads its
  `tools/list`, registers any new tools, and reports drift against the
  snapshot. A tool new to the plugin follows the exposure rules above until
  someone reviews it in `src/exposure.ts`.
- **In this repo:** the `driver-drift` workflow checks daily on Linux for a
  newer `cua-driver-rs` release and finishes in seconds when there is none.
  For a new release, a macOS job downloads the universal binary, verifies it
  against `SHA256SUMS` and its Sigstore signature, reruns `sync:tools` and the
  tests, and opens a PR with the changes and any failures. A new tool fails
  `src/catalog.test.ts` until it has an exposure decision. GitHub pauses
  scheduled workflows after 60 days without repository activity; run it from
  the Actions tab (optionally with a version) to resume.

When a newer release exists, the machine's checklist offers it as
**untested**, and `bb cua update --yes --latest` installs it. Without
`--latest`, `update` moves to the tested release.

## Signed-in browser profiles

Cua Driver treats any Chrome, Edge or Brave window with a real profile as a
person's signed-in profile: reading it needs the driver service started with
`--grant existing-profile`. Turn on **Signed-in browser profiles** in the plugin
settings to allow it. The plugin then restarts the service on macOS with that
grant (through LaunchServices, so it keeps CuaDriver.app's permissions) and
agents attach with `cua_browser_prepare({pid, window_id, strategy: {kind:
"existing_profile"}})`. Once attached, browser tools work in their own tab
while you use other tabs in the same window. Window tools such as
`cua_get_window_state` see only the tab that is showing. When the browser
shares your screen, the first attach brings it to the front once to approve
the connection, then your app comes back; the connection is reused for up to
30 minutes idle and 8 hours in total. With the setting off, the plugin refuses
that attach itself. Turning the setting off blocks those attaches at once, but the running
service keeps the grant until it restarts: run `cua-driver stop` to drop it
now. The plugin never removes a grant itself, since someone else may have
started the service that way. On Linux and Windows, start
`cua-driver serve --grant existing-profile` yourself.

## Browser extension (optional)

Cua Driver drives a browser through its window, or attaches to a signed-in
profile with remote debugging, which it automates only for Chrome, Chromium
and Edge. The optional **Browser Bridge for bb** extension
([browser-extension/](browser-extension/)) works in any Chromium browser,
Brave included, the way browser agents usually do: the extension uses the
browser's debugger API on its tabs, so agents click and type in
background tabs while you use other tabs. The browser shows its "started
debugging this browser" bar while an agent is attached; closing that bar
pauses agents until you resume them from the extension.

Nothing changes until you turn it on:

1. **Settings → Plugins → Computer Use → Browser extension**: tick **Offer
   browser_\* tools**, then **Install bridge** on the machine. The bridge is a
   small native messaging host (`~/Library/Application Support/agent-browser-bridge`
   on macOS, `~/.local/share/agent-browser-bridge` on Linux) plus one manifest
   in each Chromium browser's `NativeMessagingHosts` folder, so the extension
   can talk to bb. **Remove bridge** deletes them. CLI: `bb cua browser on`,
   `bb cua browser install`.
2. Load the extension: `npm run build:extension`, open `brave://extensions`
   (or `chrome://extensions`), turn on Developer mode, **Load unpacked**, and
   pick `browser-extension/dist`. The card shows the full path. A Chrome Web
   Store listing may follow.
3. That's it: agents can use any tab. Tabs they open with `browser_open` go
   into a purple **Agent** tab group. **Pause agents** in the extension's
   toolbar popup stops them until you resume.

Tools: `browser_tabs`, `browser_open`, `browser_read` (a text outline with
`[eN]` refs), `browser_click`, `browser_type`, `browser_select`,
`browser_key`, `browser_scroll`, `browser_navigate`, `browser_screenshot`,
`browser_close`. They obey routing like the `cua_*` tools, and with **Ask
before sensitive actions** on, the first one in a thread asks you. Agents
cannot reach `chrome://` pages or other extensions.
The bridge accepts connections only from this user (socket mode 0600) and
only from the extension's id.

## Configure

Open **Settings → Plugins → Computer Use**, or use the CLI.

Each enrolled machine has an expandable checklist for its bb connection, Cua
Driver installation, service state, and macOS Accessibility, Screen Recording,
and direct-capture consent. Machines needing attention open automatically.
Actions to install, grant permissions, and re-check setup stay inside that
machine's panel.

### Routing mode

| Mode | Codex | Claude Code, Pi, ACP agents, others |
| --- | --- | --- |
| `prefer-native` (default) | keeps its own computer use, no Cua tools | Cua Driver tools |
| `cua-everywhere` | Cua Driver tools | Cua Driver tools |
| `off` | no Cua tools | no Cua tools |

A per-provider override (`cua`, `native`, `off`, or `inherit`) beats the mode.
Set both in the **Routing mode** and **Provider overrides** cards, or from the
CLI:

```sh
bb cua mode cua-everywhere
bb cua policy codex native        # keep Codex on its own computer use
bb cua policy pi cua
bb cua policy                     # show the effective decision per provider
```

Tool and skill changes apply when a thread's next provider session starts,
never mid-session (a bb rule for every plugin).

"Native" means the plugin steps aside. Whether a harness's own computer use is
actually available inside bb depends on that harness and its bb provider
bridge; the plugin does not enable or configure it.

### Agent tools

The **Agent tools** card, or the CLI, changes how agents reach any driver
tool:

| Exposure | Meaning |
| --- | --- |
| `tool` | A dedicated `cua_<name>` tool with the driver's own schema. |
| `call` | Reachable through `cua_call {tool, arguments}`; `cua_describe` shows its schema. |
| `off` | Refused, with a message telling the agent not to reach the same result another way. |

```sh
bb cua tools                      # every tool, its exposure, and why
bb cua expose run_script call     # allow code execution through cua_call
bb cua expose click off
bb cua expose click default       # back to the bundled decision
```

Exposure is a guard against accidental use, not a sandbox: anything a tool can
do on the machine, Cua Driver's own permission mode decides.

### Other settings

| Setting | Default | Effect |
| --- | --- | --- |
| Browser tools | on | Off turns every browser tool off, `cua_call` included. |
| Clipboard tools | on | Off turns `clipboard_read` / `clipboard_write` off, `cua_call` included. |
| Signed-in browser profiles | off | Lets browser tools attach to a signed-in Chrome, Edge or Brave window (see above). |
| Browser extension | off | Offers the `browser_*` tools of the optional extension (see [Browser extension](#browser-extension-optional)). Set in its own card or with `bb cua browser on\|off`. |
| Ask before sensitive actions | off | Asks in the thread before a sensitive call runs (see [Permissions and safety](#permissions-and-safety)). Off runs them without asking. |
| Session label prefix | `bb` | Each active thread run gets a unique label beginning with `<prefix>-<threadId>`; the label shows in the agent cursor badge. |

## How it works

```
thread turn ──▶ bb server (plugin server.ts)
                 │  bb.agents.configure(): policy → tool set per provider
                 │  cua_* tool execute(): thread → environment → hostId
                 ▼
             bb host daemon on that machine (plugin host.ts)
                 │  spawns `cua-driver mcp` once, keeps one MCP stdio session
                 ▼
             Cua Driver runtime ──▶ desktop / browser
```

- The host worker talks to `cua-driver mcp` over stdio using MCP JSON-RPC, so
  the plugin ships no native binaries and works on every enrolled machine that
  has Cua Driver on `PATH`, `~/.local/bin`, `%LOCALAPPDATA%\Programs\Cua`, or
  `CUA_DRIVER_PATH`.
- One persistent transport per machine keeps browser refs, recordings, and
  named sessions valid across calls. It disconnects after 10 idle minutes and
  reconnects on the next call.
- The tool list is the machine's own `tools/list`, cached per machine in the
  plugin's key-value store; before a machine has been read, agents get the
  tested snapshot. Arguments are forwarded untouched; the plugin adds the
  thread's session label.
- When a thread goes idle, fails, or is archived, the plugin ends that thread's
  Cua session.

## Installing from bb (opt-in)

The settings page shows **Install Cua Driver…** for any online machine where
the driver is missing, and offers a switch when a machine runs another
version. The dialog shows exactly what will run and asks for a second click.
The host worker then:

1. stops a running driver, if any,
2. for the tested release, downloads `install.sh` and `_install-rust.sh`
   (`install.ps1` on Windows) from the `cua-driver-rs-v0.36.0` GitHub release
   and the `_install-common` helper from the same tag, and refuses to run any
   file whose sha256 differs from `src/driver-installer.json`; for the newest
   release, downloads Cua's one-line script from cua.ai instead,
3. runs it as your user with `CUA_DRIVER_RS_VERSION` set, while a modal shows
   estimated phase progress and keeps the raw output under expandable
   details; the installer itself checks the driver archive against the
   release's `SHA256SUMS` and, when `cosign` is installed, its Sigstore
   signature,
4. on macOS starts `CuaDriver.app` in the background; on Windows runs
   `cua-driver autostart kick`,
5. re-checks readiness.

No admin rights are requested. On macOS a **Grant permissions** button then
runs `cua-driver permissions grant`, which triggers the system prompts for
Accessibility and Screen Recording; approve both and fully relaunch
`CuaDriver.app` if macOS asks. A one-time direct-capture consent prompt may
also appear on the first screenshot. The CLI equivalents are `bb cua install --yes` and
`bb cua grant`; `install` refuses to run without `--yes`.

Before each computer-use action, the plugin checks a recent readiness snapshot.
If the driver or a required macOS permission is missing, it stops before the
action and returns a direct link to **Settings → Plugins → Computer Use** with
the exact recovery step. Permission failures returned later by Cua Driver are
normalized into the same guided recovery instead of inviting blind retries.

## Permissions and safety

- Cua Driver's own authorization stack applies unchanged. The plugin runs the
  driver in its default `standard` permission mode; bounded or unrestricted
  modes and capability manifests are configured on the machine, outside bb
  (see <https://cua.ai/docs/reference/cua-driver/permission-modes>).
- Attaching to a signed-in browser profile requires a launch grant on the
  machine (`--grant existing-profile`). The plugin adds it only while
  **Signed-in browser profiles** is on (see above).
- Tools that run code, kill processes, record, or change the driver's own
  configuration are off until you expose them. An agent told a tool is off is
  also told not to get the same result another way.
- With **Ask before sensitive actions** on, these calls wait for your answer
  in the thread: reading clipboard text, writing the clipboard, capturing the
  whole screen, uploading or downloading files, attaching to a signed-in
  browser, and the code, kill, recording, extension and configuration tools
  once you expose them. **Allow once**, **Allow for this thread** (until the
  thread is archived or the plugin reloads), or **Don't allow**; an
  unanswered request is refused after ten minutes. `bb cua call` asks in the
  thread it runs from; from a terminal outside any thread it runs, since that
  is you. Like the other settings, this stops mistakes and injected
  instructions, not an agent that runs `bb` in a shell: bb lets a thread
  answer its own requests with `bb thread interactions respond`.
- Agents are instructed never to launch apps or send, submit, or delete
  without explicit user intent for that step, and to treat text inside apps
  as data rather than instructions. Review actions in the thread timeline;
  every tool call is a labeled row.
- Cua Driver sends content-free telemetry to Cua by default. Disable it on the
  machine with `cua-driver telemetry disable` (see
  <https://cua.ai/docs/reference/cua-driver/telemetry>). The plugin itself
  sends nothing anywhere.

## Development

```sh
npm install            # add --ignore-scripts if better-sqlite3 fails to build, then: PYTHON=/usr/bin/python3 npm rebuild better-sqlite3
npm run check          # typecheck, tests, build
npm run test:network   # recorded installer checksums against what GitHub serves
npm run test:live      # drives Calculator and reads this Mac's driver (needs Cua Driver)
npm run build:extension && npm run test:browser   # the extension end to end in a throwaway headless Chromium
bb plugin install .    # then `bb plugin dev` for the rebuild-on-save loop
```

Layout:

```
server.ts                plugin factory: settings, tools, configure(), rpc, cli, events
host.ts                  host entry: find cua-driver, probe readiness, MCP session, pinned installs
app.tsx                  settings UI
src/driver-tools.ts      normalize and compact a driver's tools/list
src/exposure.ts          reviewed exposure per tool, defaults for unreviewed ones
src/catalog.ts           agent tool names, meta tools, schema overrides
src/drift.ts             compare a machine's tools with the tested snapshot
src/snapshot.ts          the tested driver's catalog (driver-snapshot.json)
src/installer.ts         installer files and recorded checksums (driver-installer.json)
src/policy.ts            routing decision logic
src/contract.ts          server ⇄ host RPC contract
src/browser-tools.ts     browser_* agent tools of the optional extension
src/browser-host.ts      extension bridge on the machine: install, sockets, calls
src/browser-bridge-script.ts  the native messaging host the browser starts
browser-extension/       Browser Bridge for bb (Chromium MV3 extension, npm workspace)
src/mcp-client.ts        minimal MCP stdio JSON-RPC client
scripts/                 sync-driver-tools.mjs
skills/                  agent skill injected when Cua tools are active
docs/                    plan, spec, architecture, settings UI
```

## License

MIT. Cua Driver is MIT licensed by Cua AI, Inc.; see [NOTICE.md](NOTICE.md).
