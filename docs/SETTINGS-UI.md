# Settings UI

Where: **Settings → Plugins → Computer Use**.

bb renders the declarative configuration form first. The plugin then registers
six sibling settings cards so each concern has its own boundary instead of
appearing as a nested card inside one large group:

1. **Routing mode** keeps the three routing choices visible because this is the
   primary decision.
2. **Provider overrides** starts collapsed and expands to the provider list.
3. **Agent tools** explains the three exposures (dedicated tool, through
   `cua_call`, off), notes unreviewed tools from a newer driver, and expands to
   every driver tool with a select per row (default, tool, call, off). The
   summary line counts each exposure.
4. **Cua Driver on your machines** gives every enrolled machine an expandable
   setup checklist, including whether its driver is the tested version and
   what drifted. Machines needing attention open automatically; manual setup
   and troubleshooting commands stay collapsed beneath the list.
5. **Browser extension** is the optional Browser Bridge for bb. A checkbox
   (off by default) offers the `browser_*` tools; only when it is on does the
   card show each machine's bridge (Install bridge / Remove bridge, which
   browsers are set up and connected), the Load unpacked steps with the
   extension folder and a Copy button, and the extension id. Like the routing
   mode, the checkbox lives in plugin storage so it appears once.
6. **About Computer Use** credits Cua AI and links to the official Cua Driver
   documentation and source repository.

Rows stay on one line. Where a routing mode or checklist item has extra detail,
a `?` icon slides in when the row is hovered and shows the detail in a tooltip
on hover or keyboard focus. `bb cua tools` prints the same tool list.

The routing mode is not a declared setting. bb renders every declared setting
in its configuration form and has no way to hide one, so a declared mode would
appear twice: as that form's select and as the radio card. The mode lives in
plugin storage instead; the card and `bb cua mode` both write it.

## Installer dialog

**Install Cua Driver…** opens a modal instead of expanding a terminal under the
machine row. It has four states:

- **Confirmation:** explains the official script and target machine, links to
  Cua's installation docs, and requires an explicit **Run installer** action.
- **Running:** shows a spinner, phase label, and progress bar estimated from the
  installer phase. Raw output is available under **Installation details**.
- **Failed:** marks the progress as failed, opens the output details, and offers
  **Retry installation**.
- **Complete:** confirms readiness and keeps the output available for review.

The dialog can be closed while installation continues. The machine panel changes
to **View progress**, which reopens the same live state without restarting the
installer.

## Checklist per machine

The collapsed header shows the platform, online state, overall status, and
completed required checks. Expanding it shows:

- bb machine connection,
- Cua Driver installation and version,
- driver service availability or its automatic start behavior,
- macOS Accessibility and Screen Recording grants,
- macOS direct-capture consent, which may be requested on the first screenshot.

Every row includes text status in addition to its icon; per-row guidance sits
behind the hover `?` hint rather than a second line. Missing or unconfirmed
required permissions expose **Grant macOS permissions**; a missing driver
exposes **Install Cua Driver…**; every online machine exposes **Check setup**.
The panel also surfaces the latest driver error without hiding it in logs.

**Check setup** is disabled when the machine is offline or its installer is running.
Results persist in kv and refresh through the `state-changed` realtime channel;
installer lines arrive as host signals and are not persisted.

## Compact viewport

Cards and machine panels stack without a horizontal table. Controls keep a
minimum 40 px target, and the installer dialog stays within the viewport with
its content scrolling internally when needed.

## Thread-level surfaces (not in v0.1)

- A thread header chip showing "Cua: connected on <machine>" with a stop button
  that ends the thread's session. Candidate for v0.2 using
  `experimental_threadHeaderAction`.
- A recording panel (`threadPanelAction`) to start/stop trajectory recording
  and open the rendered MP4.

## CLI equivalents

```text
bb cua status [--host <id>] [--json]
bb cua mode <prefer-native|cua-everywhere|off>
bb cua policy [<providerId> <cua|native|off|inherit>] [--json]
bb cua tools [--host <id>]
bb cua call <tool> [<json-args>] [--host <id>]
bb cua expose run_script call
bb cua browser [status|install|uninstall|on|off] [--host <id>] [--json]
bb cua browser call browser_tabs '{}'
bb plugin config computer-use set browserTools false
```
