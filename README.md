# Desktop & Browser Agent for bb

Lets [bb](https://getbb.app) agents use desktop apps and browsers on your
machine, in the background, powered by [Cua Driver](https://cua.ai/docs) from
Cua AI.

A community plugin, not affiliated with or endorsed by Cua AI, Inc. or the bb
team. See [NOTICE.md](NOTICE.md).

## Features

- **Desktop and browser control.** Agents read and operate native apps and
  Chromium windows without taking over your screen.
- **Your everyday browser (optional).** The bundled **Browser Bridge for bb**
  extension lets agents work in Brave, Chrome or Edge tabs while you keep
  browsing.
- **Per-provider routing.** Providers with their own computer use, such as
  Codex, keep it; everything else gets Cua Driver. You can also force Cua
  Driver everywhere or turn it off.
- **You decide what agents may do.** Risky tools (running code, killing apps,
  recording) start off. **Ask before sensitive actions** makes agents wait
  for your OK in the thread.
- **One-click setup.** Install Cua Driver, grant macOS permissions and check
  each machine from the settings page. Installs are pinned to the tested
  driver version and verified by checksum.
- **Keeps up with Cua Driver.** New driver tools reach agents without a
  plugin release, and the settings page shows what changed.
- **Works on every machine.** Each thread runs on the machine that owns its
  environment, remote ones included.

## Get started

1. Install the plugin:

   ```sh
   bb plugin install https://github.com/qwadrox/bb-plugin-computer-use
   ```

2. Open **Settings → Plugins → Desktop & Browser Agent**, select **Install Cua Driver…**
   next to your machine, and on macOS select **Grant macOS permissions**.
3. Start a new thread and ask the agent to do something in an app.

Needs bb 0.39 or later, and macOS 14+, Windows 10/11, or Linux (X11). For
manual installs, see the [reference](docs/REFERENCE.md#requirements).

## Two ways to work in a browser

| | Browser window tools | Browser extension (optional) |
| --- | --- | --- |
| Tools | `cua_browser_*` | `browser_*` |
| Runs through | Cua Driver, no extension | Browser Bridge for bb extension |
| Reaches | one Chrome, Edge, Brave or Electron window | any tab of your everyday browser |
| Your signed-in profile | only with **Signed-in browser profiles** on | always |
| Default | on | off |

Both work in the background. With the extension on, agents prefer it for web
pages; the window tools remain for Electron apps and browsers without the
extension.

## Browser extension (optional)

Off until you turn it on:

1. In **Settings → Plugins → Desktop & Browser Agent → Browser extension**, tick **Offer
   browser_\* tools (extension)** and select **Install bridge**.
2. Add [Browser Bridge for bb](https://chromewebstore.google.com/detail/aaidacbpcgjigclcoffjlcpnkmpnpgcc) from the Chrome Web
   Store (it works in Brave and Edge too). To run a local build instead, run
   `npm run build:extension`, open `brave://extensions` or
   `chrome://extensions`, turn on Developer mode, select **Load unpacked**
   and choose `browser-extension/dist`.
3. Agents can now use your tabs. Tabs they open go into a purple **Agent**
   group. **Pause agents** in the extension's popup stops them.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| Routing mode | Prefer provider tools | Which providers get Cua Driver tools |
| Agent tools | reviewed defaults | Turn individual tools on or off |
| Browser window tools, Clipboard tools | on | Turn Cua Driver's `cua_browser_*` or clipboard tools off |
| Signed-in browser profiles | off | Let the browser window tools attach to your logged-in browser |
| Browser extension | off | Offer the extension's `browser_*` tools |
| Ask before sensitive actions | off | Ask in the thread before sensitive calls |

Everything is also available from the terminal: `bb cua help`.

## More

- [Reference](docs/REFERENCE.md): every setting, routing, safety model, and
  how it works.
- [Browser extension](browser-extension/README.md): permissions, privacy, and
  publishing.
- [AGENTS.md](AGENTS.md): for development.

## License

MIT. Cua Driver is MIT licensed by Cua AI, Inc.; see [NOTICE.md](NOTICE.md).
