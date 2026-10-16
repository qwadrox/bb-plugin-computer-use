# Agent Browser Bridge

An optional Chromium extension (Manifest V3) for the Computer Use bb plugin.
It lets coding agents in bb work in the browser tabs you share with them, in
the background, while you keep using the browser. Works in Brave, Chrome, Edge
and Chromium on macOS and Linux.

Not affiliated with bb or Cua AI. The name and icon are this project's own.

## How it works

```
agent ─▶ bb plugin server ─▶ host worker ─▶ Unix socket ─▶ bridge.mjs ─▶ extension ─▶ tab
                                             (0600, per browser)   (native messaging)   (chrome.debugger)
```

- The plugin's **Install bridge** writes a native messaging host and registers
  it with each Chromium browser found on the machine. The browser starts it
  when the extension connects; it listens on a socket only this user can open
  and relays requests to the extension.
- Agents may use tabs in the tab group named **Agent**, tabs they opened with
  `browser_open` (which join that group), and tabs shared with the toolbar
  button. The popup can widen this to every tab.
- Pages are read in an isolated world as a text outline with `[eN]` refs.
  Clicks, typing and keys go through `chrome.debugger` as trusted input, so
  they work in background tabs. While attached, the browser shows its
  debugging bar; closing it pauses agents until you press **Resume** in the
  popup. The debugger detaches after a minute of inactivity.
- Only `http`, `https` and `about:blank` pages are opened or navigated to.

## Build and load

```sh
npm install                 # from the repository root (npm workspace)
npm run build:extension     # writes browser-extension/dist
```

Open `brave://extensions` or `chrome://extensions`, turn on Developer mode,
choose **Load unpacked**, and pick `browser-extension/dist`. The manifest's
`key` pins the unpacked id to `apeidchlabamkkpmahikoiingkhdcagf`, which the
bridge's `allowed_origins` names. Then turn the extension on in bb under
**Settings → Plugins → Computer Use → Browser extension** and install the
bridge there.

`npm run test:browser` (from the root, after the build) runs the extension end
to end in a throwaway headless Chromium profile.

## Permissions

| Permission | Why |
| --- | --- |
| `debugger` | Trusted clicks, typing and keys, and screenshots, in background tabs |
| `nativeMessaging` | Talk to the bridge that bb installs on the same machine |
| `tabs`, `tabGroups` | List and open tabs, and tell shared tabs (the Agent group) from the rest |
| `storage` | Remember the sharing scope and the paused state |
| `alarms` | Reconnect to the bridge after bb or the browser restarts |

No page content leaves the machine except to the bb agent that asked for it.
The extension makes no network requests of its own and has no analytics.

## Publishing to the Chrome Web Store

```sh
npm run package --workspace browser-extension   # agent-browser-bridge-<version>.zip, without "key"
```

The store assigns its own id. After the first upload, add that id to
`EXTENSION_IDS` in `src/browser-host.ts` and release the plugin; users then
re-run **Install bridge** so the native messaging manifests allow it. Bump
`version` in `static/manifest.json` and `package.json` together.

The store listing needs the permission reasons above and a privacy statement
saying no user data is collected or sold. Icons are in `static/icons`;
`icon.svg` is the source, and `node scripts/render-icons.mjs <chrome-headless-shell>`
renders the PNGs.
