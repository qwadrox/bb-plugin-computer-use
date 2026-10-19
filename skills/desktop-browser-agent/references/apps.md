# App notes

How particular macOS apps behave under the `cua_*` tools. Read the section of
the app you are about to use.

## Slack

- With no text field focused, typed text lands in the message composer, and
  Return sends it. Check that the intended field has focus before Return.
- Fill the composer with `cua_set_value`: a newline in it stays a newline,
  while a newline sent through `cua_type_text` can send the message.
  Markdown goes in verbatim; Cmd+Shift+F formats it.
- Return or Shift+Return may send, depending on the user's settings. Once the
  composer holds a few characters, a hint below it in a channel or direct
  message names the key that adds a new line; the other one sends. Thread
  replies and edits show no hint.
- When the tree looks wrong, trust a screenshot.

## Notion

- A page is made of blocks. Return starts editing the selected block.
- A new page's title shows the placeholder "New page"; Return after the
  title moves into the body.
- Enter one line at a time, each followed by Return. Markdown syntax formats
  as you type; `|` makes a quote and `>` a toggle.
- Return at the end of a list item starts the next item with its bullet; do
  not type the bullet. Return on an empty item ends the list.
- Placeholders ("New page", "List", "To-do", "Write, …") disappear when you
  type. Do not select or delete them.
- In a code block, Return adds a line inside it and Shift+Return leaves it.
  In a quote block it is the other way round.
- Cmd+A selects the block's content, and pressed again the whole page. To
  reach the top or bottom, select the whole page, press Up or Down, then
  Return.

## Numbers

- One click selects a cell to fill or append to; a triple click on the
  cell's pixels (`cua_click` with `x`, `y` and `count: 3`) replaces its
  content.
- Type one row at a time with tabs between cells. Several rows, or several
  formulas, in one `cua_type_text` fail.
- A cell keeps its value without Return. A checkbox cell takes 0 or 1.

## Music

- Search: click Search in the sidebar, then `cua_set_value` on the search
  field; results load by themselves. If the field is missing, scroll the
  sidebar to the top. The filter field filters the current view only.
- A sidebar item can open a sub-view; the back button returns.
- Double-click a track (`cua_double_click`) to play it. To queue it, use
  its More button (or a right-click) and Play Next or Play Last.

## Spotify

- Playback state updates late: after a play click, read again before
  clicking again.
- Focus the search field before pressing Return; otherwise Return can
  affect playback.
- Search may say "no results" while results are loading. Read again before
  changing course.

## Clock

- Timer: check whether one is running or paused first, and offer to cancel
  it instead of starting a second. Durations above 23:59:59 are not
  possible. Click each of the hour, minute and second fields and type the
  value (at most two digits) rather than setting it.
- Stopwatch: the Start/Stop button's title tells whether it is running.
- Alarm: set the time on the date and time field in the format of its
  current value; the AM/PM control follows. The seven day toggles choose the
  repeat days.
- World Clock: the cities under the world map do not update when clocks are
  removed; read the list of clocks instead.

## iPhone Mirroring

- Cmd+1 goes to the Home Screen, Cmd+2 to the App Switcher, Cmd+3 to
  Spotlight.
- Scroll with `cua_scroll`, not a drag.
- Click the centre of an app icon, not its label.
