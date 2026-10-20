# bb marketplace listing

Registry: <https://github.com/get-bb/marketplace> (`bb-community`). Its README
is the source of truth for the entry format and checks.

This plugin is listed on its own as **Desktop & Browser Agent**, id
`desktop-browser-agent` (`entries/desktop-browser-agent.json`), category `agents-and-providers`.
The name and icon keep it apart from the older **Computer Use** entry
(`cua-driver`).

## Files in the marketplace repo

- `entries/desktop-browser-agent.json`: `source.git.url` is this repository with
  `range: "^0.5.0"`, so bb offers every `v0.x.y` tag from 0.5.0 on (earlier tags carry the old id `computer-use`).
  `author.github` must be the account that opens the PR (`qwadrox`).
- `icons/desktop-browser-agent-<hash>.svg`: a copy of `icons/desktop-browser-agent.svg`,
  named with the first 8 hex chars of its SHA-256.
- `overview/desktop-browser-agent.md`: a copy of `PLUGIN_OVERVIEW.md`; at most 4000
  characters, absolute https links, no HTML, images or tables.
- `screenshots/desktop-browser-agent/` (optional): at most 6, PNG/JPEG/WebP, at least
  1200 px wide, at most 2 MiB. Keep personal thread titles out of them.
  Copy `docs/screenshots/*.png`; `node docs/screenshots/frame.mjs
  <chrome-headless-shell>` renders them from the settings captures in
  `docs/screenshots/src/`.

## Releasing

A plugin release is a `vX.Y.Z` tag on `main` (`extension-v*` tags belong to
the browser extension and do not match the range). Bump `package.json`,
date the CHANGELOG section, run `npm run check`, then tag and push. Users see
the update on the next catalog refresh; nothing installs automatically.

The `release` workflow then publishes the tag's GitHub release, with that
version's CHANGELOG section as its notes (`node scripts/release-notes.mjs
vX.Y.Z` prints them). It fails when the section is missing; a manual run with
a tag (re)publishes that release from `main`'s changelog.

A new marketplace PR is needed only to change the entry's source, name or
branding. Run `npm ci && npm run build && npm test && npm run gate:v1 && npm
run check` in the marketplace repo before opening it; `check` needs the tag
to be public already.
