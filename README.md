# Computer Use for bb

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

2. Open **Settings → Plugins → Computer Use**, select **Install Cua Driver…**
   next to your machine, and on macOS select **Grant macOS permissions**.
3. Start a new thread and ask the agent to do something in an app.

Needs bb 0.39 or later, and macOS 14+, Windows 10/11, or Linux (X11). For
manual installs, see the [reference](docs/REFERENCE.md#requirements).

## Browser extension (optional)

Off until you turn it on:

1. In **Settings → Plugins → Computer Use → Browser extension**, tick **Offer
   browser_\* tools** and select **Install bridge**.
2. Run `npm run build:extension` in this repository. Then open
   `brave://extensions` or `chrome://extensions`, turn on Developer mode,
   select **Load unpacked** and choose `browser-extension/dist`.
3. Agents can now use your tabs. Tabs they open go into a purple **Agent**
   group. **Pause agents** in the extension's popup stops them.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| Routing mode | Prefer provider tools | Which providers get Cua Driver tools |
| Agent tools | reviewed defaults | Turn individual tools on or off |
| Browser tools, Clipboard tools | on | Turn whole tool groups off |
| Signed-in browser profiles | off | Let Cua Driver attach to your logged-in browser |
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
