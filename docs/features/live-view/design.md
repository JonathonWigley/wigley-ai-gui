# Live view

**Contents**

- **What it is** — the hub's Live section and who drives it.
- **The agent's tools** — `show_live_view` and `hide_live_view`, their arguments and replies.
- **Finding the window** — the editor's process, the window that holds the Game View, the crop.
- **The ScreenCapture service** — the core service, its per-OS adapters, and Screen Recording access.
- **The section** — what it shows, its height, when it streams, its lines.
- **Settings** — the frame rate and the layout.
- **The sample** — the preview and the self-test stream.
- **Rejected** — approaches the spike and the interview turned down.

## What it is

The `live-view` plugin adds a **Live** section to each session's hub, directly under Main agent. It streams a Unity
editor's Game View, cut out of the editor's window, so the user watches the game beside the chat while the agent plays
it. The agent alone starts and stops it: the section has no pick or stop button, and it stays hidden until the agent
shows it. The summary names what streams: `Game View · <project folder>`, or `Editor · <project folder>` for the whole
editor window. `spike.md` beside this file is the result the spike settled.

## The agent's tools

The plugin contributes two tools to every session, subagents included (not main-agent-only), through
`sessions.contributeTools`:

- **`show_live_view`** takes `projectPath`, the Unity project folder the editor has open, and an optional `gameRect`,
  the Game View's render area as `[x, y, width, height]` in global screen points, top-left origin. The
  `wigley:unity-playtest` skill passes `capture.py start`'s `game_view` reply field. Without `gameRect` the whole
  editor window streams. A call replaces the session's last pick, so the agent calls it again after the Game View moves.
- **`hide_live_view`** takes nothing. It clears the session's pick and hides the section.

A reply says what streams, or what went wrong and what to do next. A failed call leaves the section as it was, except
when Screen Recording is off: the section then shows that line and its button, and the reply says the same. A
session's pick ends with its row.

## Finding the window

1. The plugin reads `<projectPath>/Library/EditorInstance.json`, which a running Unity editor writes, for its
   `process_id`. No file, or no `process_id`, means no editor has the project open.
2. The ScreenCapture service lists the windows the OS can stream, front to back. The plugin keeps the editor process's
   windows.
3. With a `gameRect`, the window is the frontmost of those whose bounds hold the rect, one point of slack on each edge.
   A floating Game View is its own window, in front of the main window, so it wins. With no `gameRect`, the window is
   the process's largest.
4. The crop is the rect as fractions of that window's bounds: `(rect − window origin) / window size`.

The pick is kept in the `live-view.picks` slot, keyed by session id and owned by main, so a page reload draws it again.
A pick holds the capture source id, the window's size at pick time, the crop (null for the whole window), and the
summary's text. Window lookup and the crop are pure functions with their own tests.

## The ScreenCapture service

A core service, `services.screenCapture` (`src/contracts/screen-capture.ts`), lists the windows the OS can stream and
opens the OS's Screen Recording settings. It knows nothing of Unity. One adapter per OS lives in
`src/main/screen-capture/`, picked in main's composition root as `systemStats` is:

- **macOS** lists windows through CoreGraphics (`CGWindowListCopyWindowInfo` in JXA, on-screen windows only, front to
  back, with each owner's pid) and matches each to Electron's `desktopCapturer` source by window number
  (`window:<number>:…`). Screen Recording access is `systemPreferences.getMediaAccessStatus('screen')`: `denied` or
  `restricted` lists no windows and reports access blocked. Settings open at
  `x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture`. macOS applies a new grant only after
  the app restarts.
- **Windows** lists top-level visible windows through PowerShell over user32 (`EnumWindows`, `GetWindowThreadProcessId`,
  `IsWindowVisible`) skipping minimized and cloaked windows, with bounds from `DwmGetWindowAttribute` (`DWMWA_EXTENDED_FRAME_BOUNDS`, no drop
  shadow). The script runs its thread per-monitor-DPI aware, so the bounds are physical pixels; each is then
  multiplied by 96 and divided by its window's `GetDpiForWindow` into points, the unit Unity reports positions in. Sources
  match by window handle (`window:<handle>:…`). Windows has no capture permission, so access is always granted.
- **Linux** gets an adapter whose list rejects, and the tool reply carries that message.

Self-test and drive runs get a fake whose window list is fixed and whose source ids are sample sources.

## The section

- **Height:** Live shrinks last. While it shows, every other section that shares the hub's height (Plan, Skills,
  Context) gives up height first, down to its head and a few lines, scrolling in its own body; a shorter body leaves
  blank down to that floor. Live then takes what is
  left, up to its video's full height at the hub's width, so a portrait Game View shrinks to the hub's free height and
  the whole frame shows with no scrollbar. Chat offers this as a side part option, `shrinksLast`.
- **Streaming:** the stream runs only while the section is on screen: in a shown Chat tab, with the hub shown and the
  section open. Hiding any of these stops the capture. Showing it again starts the same window again. The page asks for
  at most the `frameRate` setting's frames a second.
- **The Game View moved:** the page compares the stream's aspect ratio with the window's at pick time. When the editor
  window is resized, the crop no longer fits, so the section shows the whole editor window with the line
  `The Game View moved. Live shows the whole editor until the agent shows it again.`
- **The stream would not open:** when the source cannot open, the section shows `Live could not start the stream: <error>`
  and no video.
- **The window closed:** when the stream ends because the window went away, the section shows
  `The editor window closed.` and no video.
- **Screen Recording off (macOS):** the section shows `Screen Recording is off for Auri. Turn it on in System Settings,
  then restart Auri.` with an `Open System Settings` button, which runs the `live-view.openScreenSettings` command.
- Each line is one `text-12` `fg-secondary` line above the video, in the live-view layout.

## Settings

| Setting | Default | What it does |
|---|---|---|
| `frameRate` | 30 | The most frames a second the stream asks for |
| `layout` | `default` | The live-view layout the section draws in |

## The sample

Chat's layout preview (`Space z l c`) shows a Live section on its sample session, streaming a sample source: a test
card the page draws on a canvas, at a portrait Game View's shape. A source id starting `sample:` opens that canvas
stream in place of a desktop capture, so the preview and the self-test (which uses the fake ScreenCapture) show the
section with no Unity editor and no Screen Recording grant.

## Rejected

- **Pick window and Stop buttons for the user** — the user wants the agent alone to start and stop Live.
- **A Live tab beside the Chat tab** — the user wants the stream beside the agent's work, not a tab away.
- **Finding the editor by its window title** (`[<folder> …`) — a floating Game View has its own title; the editor's
  process finds every window it owns.
- **Trimming the toolbar strip by a fixed number of points** — the strip comes from the probe's rect, so the probe
  is fixed at its cause.
- **A 60vh cap on the video** — it still left the hub scrolling.
