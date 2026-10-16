# Changelog

## Unreleased

- **Clearer wording in agent messages, approval cards and `bb cua browser`.**
  Refusals name the **Agent tools** card and the **Offer `browser_*` tools
  (extension)** switch. Approval cards no longer repeat the tool name in their
  text, and an extension approval is titled "Allow agents in your browser?"
  and says it covers every `browser_*` tool in the thread. Activity rows read
  "the browser" throughout, and extension scrolling reads "Scrolling the page".
  `bb cua browser` says "set up" and "not supported on this system", prints the
  Web Store id and the unpacked build id on separate lines, and shows the
  extension version as `v0.1.1`. A missing bridge tells the agent to press
  **Install bridge** in the **Browser extension** card.
- **Settings page:** tools in a group that is off (browser window or clipboard
  tools) can't be changed in **Agent tools** until the group is on. **Provider's
  own** is disabled for providers without their own computer use. The
  **Browser extension** card shows setup steps only while setup is incomplete,
  and no longer repeats the connected browser.
- **New icons:** the plugin icon is a window with a pointer and the letters
  "bb"; the Browser Bridge for bb extension uses the same design on a purple
  tile (store screenshot re-rendered).
- **The two browser tool sets are told apart.** The **Browser tools** setting
  is now **Browser window tools (Cua Driver)**: its `cua_browser_*` tools work
  in a Chrome, Edge, Brave or Electron window without an extension. The
  extension's switch reads **Offer `browser_*` tools (extension)**, and its
  card says why the extension is the better choice for web pages: agents use
  the browser you are signed in to, in any tab, without extra grants or
  bringing it to the front, and **Pause agents** in the toolbar stops them.
- **The Browser extension card comes third** in the settings page, right after
  the routing cards and before Agent tools.
- **Provider overrides say less twice.** The collapsed row names the providers
  with their own routing instead of repeating the card title, a row shows its
  result only while it follows the mode, and "Harness-native" is now
  "Provider's own", matching **Prefer provider tools**.
- **The settings page notices a closed driver connection.** It updates when a
  machine's driver connection closes on idle timeout, after a grant change or
  update, or on a disconnect request.
- **Session labels keep the thread part** when the session prefix is very long.
- **The browser extension shows where an agent works.** A purple cursor
  glides to each click, field and option in the tab, ripples on a click and
  fades when the agent goes idle. It stays out of the agent's page outlines
  and screenshots. **Show the agent's cursor** in the extension's popup turns
  it off.
- **Browser extension fixes.** It acts on elements inside shadow DOM, recovers
  after a pause instead of failing with "not attached", and accepts lowercase
  key names such as `arrowdown`. Its package no longer ships a `.DS_Store`.

## 0.4.1 - 2026-10-16

- **The plugin icon shows up.** bb draws plugin icons as a mask in the theme
  colour, so the 0.4.0 icon (a filled purple square) appeared as a blank
  tile. It is now a single-colour glyph.

## 0.4.0 - 2026-10-16

- **New name and icon: Desktop & Browser Agent.** The plugin is listed in
  the bb store apart from the older Computer Use plugin, so it needs its
  own name. The id stays `computer-use`, so installs, settings
  and the `/settings/plugins/computer-use` link keep working. The new icon is
  original artwork and replaces the one derived from Cua's logo.

- **Optional browser extension.** Browser Bridge for bb
  (`browser-extension/`, Chromium MV3) lets agents work in the tabs of your own browser
  in Brave, Chrome, Edge or Chromium, in background tabs, through the
  browser's debugger API, so Brave no longer needs Cua Driver's
  remote-debugging attach. Off by default: turn it on in the new **Browser
  extension** card (or `bb cua browser on`), install the native messaging
  bridge there (`bb cua browser install`), and add the extension from the
  [Chrome Web Store](https://chromewebstore.google.com/detail/aaidacbpcgjigclcoffjlcpnkmpnpgcc)
  (or load a local build unpacked; the bridge accepts both ids). New versions
  are published by the `publish-extension` workflow on an `extension-v*` tag.
  Adds the `browser_*` tools (tabs, open, read, click, type, select, key,
  scroll, navigate, screenshot, close). Agents may use any tab; tabs they
  open go into a purple **Agent** group. The toolbar popup pauses agents,
  and so does closing the debugging bar. With **Ask before sensitive actions** on, the first call in a
  thread asks.

- **Ask before sensitive actions** (setting, off by default). When on, reading
  clipboard text, writing the clipboard, whole-screen capture, file uploads
  and downloads, attaching to a signed-in browser, and the code, kill,
  recording, extension and configuration tools wait for the user's approval
  in the thread: allow once, allow for the thread, or don't allow. Built on
  `bb.ui.requestInput` with an `approve-tool` pending-interaction card; the
  Agent tools list marks these tools "asks first".
- **Routing mode appears once.** It was a declared setting, so bb's
  Configuration form showed a second `Routing mode` select above the plugin's
  own card. The mode now lives in plugin storage; set it in the Routing mode
  card or with `bb cua mode`. A mode saved by 0.3.0 carries over.
  `bb plugin config computer-use set mode …` no longer applies.
- **Browser refusals are no longer reported as missing permissions.** A
  refusal that mentioned the accessibility tree was turned into "blocked by a
  system permission" and cut short, hiding the driver's next step. Only
  macOS privacy failures (`permissions_pending`, `tcc_*`, "not granted") get
  the permission guidance now.
- **Work alongside the user in the browser.** The skill now attaches to a
  signed-in browser once with `delivery_mode: "foreground"` when a background
  attach is refused, then works in its own tab by `tab_id` while the user
  keeps using other tabs, instead of falling back to window tools that only
  see the tab that is showing.

## 0.3.0

Released as **Computer Use** (plugin id
`computer-use`). Tested against Cua Driver 0.36.0 on macOS, with live reads of
Outlook, Teams and a Brave window.

- **Each machine's own tools.** The plugin reads the driver's `tools/list` on
  every machine, caches it, and registers tools that a newer driver adds,
  without a plugin release. The tested 0.36.0 catalog (60 tools, including
  `run_steps`) is the fallback before a machine has been read.
- **Exposure policy.** Every driver tool is a dedicated `cua_*` tool,
  reachable only through `cua_call`, or off. Code execution, `kill_app`,
  recording, driver configuration and extension installs start off; an
  unreviewed tool is reachable through `cua_call` only if the driver marks it
  read-only. `cua_call` obeys the policy instead of bypassing it. New
  **Agent tools** settings card, `bb cua expose`, and `bb cua tools`. The
  **Passthrough tools** setting is gone.
- **Drift report.** `bb cua status`, `bb cua drift`, the machine checklist,
  and a line in agent instructions name the tools that differ from the tested
  driver.
- **Pinned, checksum-verified installs.** Install and update target the tested
  release by default. The host downloads that release's installer files from
  GitHub and runs them only if each matches a sha256 recorded in
  `src/driver-installer.json`. The newest release stays available as an
  explicit, untested choice (`--latest`).
- **CI.** `driver-drift` checks daily for a new Cua Driver release on Linux;
  for one, a macOS job verifies the binary's checksum and Sigstore signature,
  regenerates the snapshot and checksums, runs the tests, and opens a PR. `ci`
  pins actions by commit and checks the recorded installer checksums.
- **Skill.** Rewritten from the upstream 0.36 skill pack: narrow reads,
  `run_steps` with `observe`, `since: "latest"`, verification at checkpoints,
  what to do when a tool is off, and when to stop and ask.
- `bb cua call --json` replaces image data with its size so large screenshots
  fit bb's CLI output limit.

## 0.2.0 (never tagged)

Validated live against Cua Driver 0.28.2 on macOS.

- Tool schemas now come from Cua Driver itself (`npm run sync:schemas`), and
  arguments are forwarded untouched. The hand-written 0.1.0 schemas had
  drifted: they rejected the valid `scroll` `by: "line"` and `"page"`, and
  silently dropped newer parameters such as `click` `target` and `from_zoom`,
  `browser_prepare` `profile` and `strategy`, and `launch_app`
  `creates_new_application_instance`.
- A machine whose driver version differs from the bundled snapshot advertises
  its own `tools/list` to agents.
- New tools: `cua_browser_download`, `cua_browser_set_input_files`,
  `cua_get_accessibility_tree`.
- Sessions: a dropped driver connection ends every session it carried, and
  Cua Driver refuses a reused label ("session … has ended"). The plugin now
  forgets a machine's session labels when its connection drops and retries a
  refused call once with a fresh label.
- **Signed-in browser profiles** setting: restarts the driver service with
  `--grant existing-profile` on macOS when on; refuses existing-profile
  attaches when off. (`cua-driver mcp --grant` is refused while a daemon
  listens, so the grant belongs to the service.)
- Update awareness: status reports the newest release, the machine checklist
  offers **Update to vX…**, and `bb cua update --yes` stops the driver before
  running the installer so the new binary is the one that restarts.
- The skill covers 0.28 browser behavior: `input_route: "dom_event"` for
  background clicks on macOS, refusals returned as ordinary results, and
  approved download folders.
- `live.test.ts` (`npm run test:live`) drives Calculator and an attached Chrome
  through the plugin's own server and host code.

## 0.1.0 - 2026-09-04

- First release: 30 `cua_*` agent tools, `cua-computer-use` skill, per-provider
  routing (`prefer-native`, `cua-everywhere`, `off` plus overrides), driver
  readiness per machine, `bb cua` CLI, multi-machine execution through the bb
  host daemon and one persistent `cua-driver mcp` session per machine.
- Opt-in installer and macOS permission request from the settings page and
  the CLI (`bb cua install --yes`, `bb cua grant`); never runs without an
  explicit confirmation.
- Settings use separate cards for routing, provider overrides, machines, and
  Cua attribution. Secondary lists and commands are collapsible, and row
  details sit behind a hover `?` tooltip so every row stays on one line. The
  tool list is available from `bb cua tools`.
- The installer runs in a reopenable progress dialog with phase estimates,
  status animation, retry states, and expandable terminal output.
- Machine setup is now an expandable checklist with install, service, and
  macOS permission state, including direct-capture guidance. Tool calls preflight
  readiness and link permission failures directly back to the settings panel.
- Resuming an idle thread now starts a fresh Cua session label instead of
  reusing the ended label from the previous turn.
- The user-facing plugin name is **Computer Use**; Cua Driver and Cua AI remain
  credited and linked in the listing, settings, README, and notice.
