# Live view

**Contents**

- **What it is** — the hub's Live section and who drives it.
- **The agent's tools** — `show_live_view` and `hide_live_view`, their arguments and replies.
- **The playtest watch** — the app opening and closing Live on a session's Unity playtest commands.
- **The Game View probe** — how the app's opening finds the Game View: the script, the CLI, the call, retries.
- **Finding the window** — the editor's process, the window that holds the Game View, the crop.
- **The ScreenCapture service** — the core service, its per-OS adapters, and Screen Recording access.
- **The section** — what it shows, its height, when it streams, its lines.
- **Settings** — the frame rate and the layout.
- **The sample** — the preview and the self-test stream.
- **Rejected** — approaches the spike and the interview turned down.

## What it is

The `live-view` plugin adds a **Live** section to each session's hub, directly under Main agent. It streams a Unity
editor's Game View, cut out of the editor's window, so the user watches the game beside the chat while the agent plays
it. The agent starts and stops it, and the app also opens it when the session starts a Unity playtest and closes the
view it opened when the playtest stops (§ The playtest watch). The section
has no pick or stop button, and it stays hidden until the agent or the playtest watch shows it. The summary names what streams: `Game View · <project folder>`, or `Editor · <project folder>` for the whole
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

## The playtest watch

The app opens a session's Live section on its own when that session starts
a Unity playtest, so the user never asks the agent for the stream. It works for any Unity project the `unity` CLI
drives, and knows nothing of a particular project.

- **Open:** a Bash call of any agent of the session, the lead or a subagent (a subagent's calls arrive under the
  lead's row), whose command runs `unity command editor.playmode start` (Pipeline 0.9 and above), `unity command
  editor_play` (0.8) or `capture.py start`, once the call succeeds: a denied or failed call opens nothing. A chained
  command counts (`cd <dir> && unity command editor_play --project-path <dir>`); `echo`, text inside quotes, a
  subshell, `bash -c`, another `unity command`, and `capture.py stop` do not.
  A heredoc's body does not count either: a command written into a file with `cat > play.sh <<'EOF'` never ran.
- **Live calls only:** a replayed or restored entry never acts. The watch reads the call's full command from
  chat's `chat.entries` list, since a `toolStarted` event's summary is cut to 80 characters, and counts the entry as
  live only when chat's `agentEvent` `toolStarted` for its `toolUseId` came with `replayed: false`. A restore writes
  the list whole (a `replace`, which never acts) and fires no `toolStarted`. Each call acts once, and chat's layout
  preview row is left out.
- **Project folder:** the command's `--project-path <dir>`, else for a `unity command` the `UNITY_PROJECT_PATH` the
  same command line sets (`export UNITY_PROJECT_PATH=…;` before it, or `UNITY_PROJECT_PATH=… unity command …`), else
  the folder the line `cd`s into, as the CLI itself falls back (a folder with no editor opens nothing). The agent
  names its editor in the command that starts the playtest, as the `wigley:unity-playtest` skill does; the app
  guesses no folder. When one command names `--project-path` more than once, the last non-empty value counts; an
  empty or missing value keeps an earlier one. `$NAME` and `${NAME}` in the path, the program or the capture script
  expand from plain assignments (`P=<dir>`, `export P=<dir>`) and `cd <dir>` (as `$PWD`) in earlier segments of the
  same command, since agents hold the folder in a variable; a variable the line never assigns, an assignment in the
  same segment, and a command substitution read as no path. A trigger command with no project folder, a relative path, a folder with no editor (no
  `Library/EditorInstance.json` with a `process_id`), or no editor window writes no pick, only a log line; all but
  the last are checked before the probe below, so they run no `unity` call.
- **What streams:** the Game View, `Game View · <project folder>`, cut out as for an agent's `gameRect` (§ Finding
  the window). The app finds the rect itself, by running the `probe` action of the `wigley:unity-playtest` skill's
  `WigleyCapture.cs` in that editor (§ The Game View probe). When the probe finds no rect, or the rect lies in none
  of the editor's windows, the whole editor window streams, `Editor · <project folder>`, as `show_live_view` with no
  `gameRect` does, and the log line names why. The agent's later `show_live_view` replaces either, as the skill
  calls it after `capture.py start`. With Screen Recording off, the section shows that line and its button, as for
  the agent's call.
- **Close:** a Bash call running `unity command editor.playmode stop` or `editor_stop` that succeeds closes a view the
  app opened, when its project folder, read as for an opening, names the project the app opened the view for (one
  trailing `/` ignored); a stop with no folder closes nothing. The agent's `hide_live_view` and the session ending
  close any view.
- **The agent's pick wins:** the app opens the view only when the session has no pick. The agent's `show_live_view`
  replaces an app-opened pick and makes the pick the agent's, so a later stop leaves it. An app opening
  still waiting on the probe or the window list writes nothing when a pick, a hide, a stop, a later app opening,
  the agent's `show_live_view` or the session's end came first, and its probe makes no further call.
- No setting turns it off.

## The Game View probe

The app's opening reads the editor's Game View rect with the same script the `wigley:unity-playtest` skill's
`capture.py` runs, so both read one rect: `WigleyCapture.cs`'s `probe` reply's `window`, `[x, y, width, height]` in
top-left global screen points.

- **The script:** `skills/unity-playtest/unity/WigleyCapture.cs` in the first wigley plugin install among the
  registered profiles' installs (`locateWigleyFile`, `src/shared/wigley-install.ts`, which also finds docs'
  `docs_index.py`). The file runs as it is: its Recorder code compiles only under a define `capture.py` adds, and
  the probe needs none.
- **The CLI:** `services.processes.resolveProgram('unity')`, `unity` on the PATH main swaps in from the login
  shell, else `~/.unity/bin/unity`, as `capture.py` looks it up.
- **The call:** `unity command script run --file <script> --entry Wigley.WigleyCapture.Run --args '["{\"action\":\"probe\"}"]'
  --timeout 8 --json --project-path <dir>`; on a com.unity.pipeline pin below 0.9 (the project's
  `Packages/manifest.json`, read as `capture.py` reads it) `unity command run_script` with `--timeout_ms 8000
  --timeout 23`. The run is killed 15 seconds past the CLI's `--timeout`, as
  `capture.py`'s `client_timeout_s` does: 23 seconds grouped, 38 legacy. The CLI gets the folder's real path, as
  `capture.py` passes it. The reply is the first value holding `ok`, under `result` keys
  and JSON strings, whatever the pin prints.
- **Retries:** `probe` reads the Game View whether or not the editor plays, and Play Mode's own layout change (a
  maximized Game View) lands after the start command returns. So the app probes up to 3 times, a second apart:
  a failed call, a reply with no window, or one from an editor not yet playing tries again, and the third takes
  a window either way. A missing script or CLI runs no call. The opening runs beside the watch, which never waits
  on it.
- **No probe:** with no wigley install holding the script, as in the self-test, the opening streams the whole
  editor.

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
  the whole frame shows with no scrollbar. It never shrinks below 160 px of body (`chat.side-shrinks-last-floor`):
  past that the whole hub scrolls. Chat offers this as a side part option, `shrinksLast`.
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
section with no Unity editor and no Screen Recording grant. The self-test launches its session with the fake agent's
playtest text, a Bash call running `unity command editor_play` on the self-test's project folder, checks that the
watch opened the whole-editor pick `Editor · <project folder>` (its fixture installs hold no `WigleyCapture.cs`, so
no probe runs), then shows the Game View as the agent would.

## Rejected

- **Pick window and Stop buttons for the user** — the user wants the agent, and the app on a session's playtest
  commands, to start and stop Live, never a button.
- **A setting to turn the playtest watch off** — the user wants none.
- **Guessing the playtest's project folder** from the session's unity-pool clone or its project folder — a Unity
  project can sit in a subfolder of its clone; the agent names the folder in the command instead.
- **A Live tab beside the Chat tab** — the user wants the stream beside the agent's work, not a tab away.
- **Finding the editor by its window title** (`[<folder> …`) — a floating Game View has its own title; the editor's
  process finds every window it owns.
- **Trimming the toolbar strip by a fixed number of points** — the strip comes from the probe's rect, so the probe
  is fixed at its cause.
- **A 60vh cap on the video** — it still left the hub scrolling.
