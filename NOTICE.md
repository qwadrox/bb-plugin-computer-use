# Third-party notices

## Origin

This plugin started as a fork of
[bb-plugin-cua-driver](https://github.com/juanbermudez/bb-plugin-cua-driver)
("Computer Use") by Juan Bermudez, MIT licensed; `LICENSE` keeps that
copyright notice. It is listed separately as **Desktop & Browser Agent**.

## Cua Driver (Cua AI, Inc.)

This plugin is an independent integration for [bb](https://getbb.app) that
drives the **Cua Driver** runtime. It is not affiliated with or endorsed by
Cua AI, Inc.

- Cua Driver, the `cua-driver` CLI, the MCP server, and the SDKs are developed
  by Cua AI, Inc. and released under the MIT License:
  <https://github.com/trycua/cua> (see `LICENSE.md` in that repository).
- "Cua" is a name of Cua AI, Inc.; it is used here only to identify the
  upstream runtime this plugin integrates. The plugin icon
  (`icons/desktop-browser-agent.svg`) is original work of this project and uses
  no Cua or bb artwork. Earlier versions used a logo derived from Cua's.
- The agent skill in `skills/cua-computer-use/SKILL.md` is adapted from the
  upstream Cua Driver skill pack (`libs/cua-driver/rust/Skills/cua-driver/`,
  MIT). Sections on the snapshot-before-action invariant, the
  verify-then-escalate ladder, and the pitfalls list are condensed from that
  source and adjusted to bb's tool names.

## Browser Bridge for bb

The optional browser extension in `browser-extension/` and its icon
(`browser-extension/static/icons/`) are original work of this project, under
the same MIT license. The name uses "bb" only to say which app the extension
works with ("for bb"); it uses no bb or Cua logos or artwork, and its
description says it is unofficial and not affiliated with either.

The plugin never bundles Cua Driver binaries. Users install Cua Driver
separately from <https://cua.ai/docs/how-to-guides/driver/install>.

Apple, macOS, Microsoft, Windows, and Linux are trademarks of their respective
owners.
