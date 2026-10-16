# bb marketplace listing

Registry: <https://github.com/get-bb/marketplace> (`bb-community`). Its README
is the source of truth for the entry format and checks.

This plugin is listed on its own as **Desktop & Browser Agent**, id
`computer-use` (`entries/computer-use.json`), category `agents-and-providers`.
The name and icon keep it apart from the older **Computer Use** entry
(`cua-driver`).

## Files in the marketplace repo

- `entries/computer-use.json`: `source.git.url` is this repository with
  `range: "^0.4.0"`, so bb offers every `v0.x.y` tag from 0.4.0 on.
  `author.github` must be the account that opens the PR (`qwadrox`).
- `icons/computer-use-<hash>.svg`: a copy of `icons/desktop-browser-agent.svg`,
  named with the first 8 hex chars of its SHA-256.
- `overview/computer-use.md`: at most 4000 characters, absolute https links,
  no HTML, images or tables.
- `screenshots/computer-use/` (optional): at most 6, PNG/JPEG/WebP, at least
  1200 px wide, at most 2 MiB. Keep personal thread titles out of them.

## Releasing

A plugin release is a `vX.Y.Z` tag on `main` (`extension-v*` tags belong to
the browser extension and do not match the range). Bump `package.json`,
date the CHANGELOG section, run `npm run check`, then tag and push. Users see
the update on the next catalog refresh; nothing installs automatically.

A new marketplace PR is needed only to change the entry's source, name or
branding. Run `npm ci && npm run build && npm test && npm run gate:v1 && npm
run check` in the marketplace repo before opening it; `check` needs the tag
to be public already.
