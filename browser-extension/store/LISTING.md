# Chrome Web Store listing

Text for the Developer Dashboard. Upload `browser-bridge-for-bb-<version>.zip`
from `npm run package --workspace browser-extension`.

## Store listing

- **Category:** Developer Tools
- **Language:** English
- **Store icon:** `static/icons/icon-128.png`
- **Screenshot:** `store/screenshot-1280x800.png` (source: `store/screenshot.html`,
  render with `node scripts/render-screenshot.mjs <chrome-headless-shell>`)
- **Homepage / support URL:** https://github.com/qwadrox/bb-plugin-computer-use

**Description:**

```
Browser Bridge for bb lets the coding agents in bb work in your own browser tabs, in the background, while you keep using the browser.

Agents can read a page as a text outline, click, type, press keys, scroll, choose options, navigate and take screenshots, in any tab, including tabs that are not in front. Tabs that agents open go into a purple "Agent" tab group so you can see them at a glance, and a purple cursor shows where an agent clicks or types (you can turn it off in the popup).

You stay in control:
• "Pause agents" in the toolbar popup stops them until you resume.
• While an agent is working, the browser shows its debugging bar; closing it pauses agents too.
• The extension only opens or navigates to http, https and about:blank pages.

Requirements: the bb app and its Desktop & Browser Agent plugin, with the browser extension turned on and the bridge installed (Settings → Plugins → Desktop & Browser Agent → Browser extension). The extension talks only to that bridge on your own machine, through native messaging. It makes no network requests of its own and has no analytics.

Works in Brave, Chrome, Edge and Chromium on macOS and Linux.

Unofficial: not affiliated with bb or Cua AI. "bb" in the name only says which app it works with. Source code: https://github.com/qwadrox/bb-plugin-computer-use
```

## Privacy practices

**Single purpose:**

```
Lets coding agents running in the bb app on the user's own computer read and operate the user's browser tabs (read page text, click, type, scroll, navigate, take screenshots), relayed through a local native messaging bridge.
```

**Permission justifications:**

- `debugger`:
  ```
  Agents act through the Chrome DevTools Protocol: it delivers trusted clicks, hovers, key presses and typing, captures screenshots, and answers a page's alert, confirm and prompt dialogs, in tabs that are in the background, which content scripts cannot do. The debugger attaches only to a tab an agent is working in, the browser shows its debugging bar meanwhile, and it detaches after a minute of inactivity. Closing the bar pauses agents.
  ```
- `nativeMessaging`:
  ```
  The extension's only connection is to the native messaging host that the bb Desktop & Browser Agent plugin installs on the same computer. Agent requests arrive and results return through it; nothing goes to a remote server.
  ```
- `tabs`:
  ```
  Agents list the open tabs (id, title, URL) to choose one, open new tabs, and navigate or close them.
  ```
- `tabGroups`:
  ```
  Tabs that agents open are put in a purple "Agent" tab group so the user can see which tabs agents started.
  ```
- `storage`:
  ```
  Remembers whether the user has paused agents, so the pause survives a browser or service worker restart, and whether to show the agent's cursor.
  ```
- `alarms`:
  ```
  Retries the connection to the local bridge periodically after bb or the browser restarts.
  ```
- **Host permissions:** `file:///*`:
  ```
  Agents can attach a file from the user's computer to a page's file input, as choosing it in the file picker would (the DevTools Protocol's DOM.setFileInputFiles). The browser allows that only while the user has turned on "Allow access to file URLs" for the extension; requesting file:// access is what shows that switch. The extension never opens, reads or sends file:// pages; the file goes only to the page the agent is filling in.
  ```

**Remote code:** No, I am not using remote code. (All JavaScript is in the package.)

**Data usage:** tick **Website content**. The page text and screenshots an
agent asks for go to that agent in bb on the user's own computer, which sends
them to the AI model provider the user chose. That is the item's single
purpose, so the certifications below still hold.

Certify all three:

- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** https://github.com/qwadrox/bb-plugin-computer-use/blob/main/browser-extension/README.md#permissions
