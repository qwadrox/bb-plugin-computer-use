# Browser Bridge for bb

An optional Chromium extension (Manifest V3) for the Desktop & Browser Agent bb plugin.
It lets coding agents in bb work in your browser tabs, in
the background, while you keep using the browser. Works in Brave, Chrome, Edge
and Chromium on macOS and Linux.

An unofficial community extension, not affiliated with or endorsed by bb or
Cua AI. "bb" in the name only says which app it works with; the icon is this
project's own.

## How it works

```
agent ─▶ bb plugin server ─▶ host worker ─▶ Unix socket ─▶ bridge.mjs ─▶ extension ─▶ tab
                                             (0600, per browser)   (native messaging)   (chrome.debugger)
```

- The plugin's **Install bridge** writes a native messaging host and registers
  it with each Chromium browser found on the machine. The browser starts it
  when the extension connects; it listens on a socket only this user can open
  and relays requests to the extension.
- Agents may use any tab. Tabs they open with `browser_open` go into a
  purple tab group named **Agent**. **Pause agents** in the toolbar popup
  stops them until you resume.
- Pages are read in an isolated world as a text outline with `[eN]` refs.
  Clicks, typing and keys go through `chrome.debugger` as trusted input, so
  they work in background tabs. While attached, the browser shows its
  debugging bar; closing it pauses agents until you press **Resume** in the
  popup. The debugger detaches after a minute of inactivity (not while a
  dialog it reported waits for an answer).
- A ref stays with its element while the element is unchanged; refs are
  never reused within a tab. Each action answers with the outline lines it
  changed, and with any dialog, new tab or file picker it opened. A file
  picker opened during an agent action is held back for `browser_upload`;
  outside agent actions pickers open as usual.
- A purple cursor glides to where an agent clicks, types or chooses an
  option, with a ripple on each click, and fades after five idle seconds. It
  is drawn in the page, outside `<body>` and in a closed shadow root, so it
  never takes a click, page outlines skip it, and agent screenshots leave it
  out. In a background tab it moves without animating. **Show the agent's
  cursor** in the popup turns it off.
- Only `http`, `https` and `about:blank` pages are opened or navigated to.

## Build and load

```sh
npm install                 # from the repository root (npm workspace)
npm run build:extension     # writes browser-extension/dist
```

Open `brave://extensions` or `chrome://extensions`, turn on Developer mode,
choose **Load unpacked**, and pick `browser-extension/dist`. The manifest's
`key` pins the unpacked id to `apeidchlabamkkpmahikoiingkhdcagf`, which the
bridge's `allowed_origins` names. Then, in bb under **Settings → Plugins → Desktop & Browser Agent**, turn on
**Offer browser_* tools (extension)** in the **Browser extension** card and
install the bridge there.

`npm run test:browser` (from the root, after the build) runs the extension end
to end in a throwaway headless Chromium profile.

## Permissions

| Permission | Why |
| --- | --- |
| `debugger` | Trusted clicks, hovers, typing and keys, screenshots, and answering a page's dialogs, in background tabs |
| `nativeMessaging` | Talk to the bridge that bb installs on the same machine |
| `tabs`, `tabGroups` | List and open tabs, and group the tabs agents open |
| `storage` | Remember whether agents are paused and whether to show their cursor |
| `alarms` | Reconnect to the bridge after bb or the browser restarts |
| `file:///*` host access | Attach a file an agent uploads to a page's file input. The browser allows it only once you turn on **Allow access to file URLs**; the extension never opens or reads `file://` pages |

**Privacy.** The extension makes no network requests of its own, has no
analytics, and collects nothing for its developer. It hands page text, tab
titles and URLs, and screenshots only to the bb agent on the same computer
that asked for them, through the local bridge. That agent is a coding agent
the user runs, and it sends what it reads to the AI model provider the user
chose in bb (such as Anthropic or OpenAI), under that provider's terms. A file
an agent uploads goes only to the page whose file input it fills. Data
is not sold or used for anything but the agent's task. **Pause agents** in
the popup stops all access.

## Publishing to the Chrome Web Store

```sh
npm run package --workspace browser-extension   # browser-bridge-for-bb-<version>.zip, without "key"
```

The store item is [`aaidacbpcgjigclcoffjlcpnkmpnpgcc`](https://chromewebstore.google.com/detail/aaidacbpcgjigclcoffjlcpnkmpnpgcc);
`EXTENSION_IDS` in `src/links.ts` lists it next to the unpacked id, so
the bridge's native messaging manifests allow both. Bump
`version` in `static/manifest.json` and `package.json` together.

The store listing text, permission reasons and privacy answers are in
[`store/LISTING.md`](store/LISTING.md), with the 1280x800 screenshot
(`node scripts/render-screenshot.mjs <chrome-headless-shell>` renders it).

Later versions go out through `.github/workflows/publish-extension.yml`: bump
the version, commit, and push a tag `extension-v<version>` (plugin releases use
`v*`). The workflow checks the tag against both files, packages the zip and
uploads it with the repository secrets `EXTENSION_ID`, `PUBLISHER_ID`,
`CLIENT_ID`, `CLIENT_SECRET` and `REFRESH_TOKEN` (a Chrome Web Store API OAuth
client of the publisher account). A manual run (Actions → publish-extension →
Run workflow) builds the chosen branch or tag and can upload a draft without
submitting it for review.

Icons are in `static/icons`;
`icon.svg` is the source, and `node scripts/render-icons.mjs <chrome-headless-shell>`
renders the PNGs.
