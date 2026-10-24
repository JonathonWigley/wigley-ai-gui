---
name: drive
description: Driving wigley-ai-gui offscreen — launch it, press keys, click, capture screenshots and video, query styles, seed fixtures. Use when checking a change in the running app, capturing it, or running a live check.
---

# Drive the app

**Contents**

- **Loop** — start a run, seed it, act, capture, read, quit.
- **Commands** — where the command list lives, and the conventions behind it.
- **Checking a screen** — reading captures against `DESIGN.md`, by number where one exists.
- **Real Claude** — when a run uses the real Claude CLI.
- **What stays the user's** — the checks synthetic input cannot reach.

The agent checks every change in the running app itself, as the user would, so the user never
gets a check the agent could have run. A drive run is the app offscreen as an accessory app, on a
fresh temp home in `.drive/<run-id>/home`, beside the user's own app: it never takes the user's screen
or touches their data, so start one whenever a check needs it.

## Loop

1. `npm run drive -- start` returns once the page is ready and prints the run id and folder; a
   dev start first waits up to 10 s for the dev server's startup reload (lock paragraph below).
   `.drive/current` names the newest run, and a command without `--run` goes there; `start --run
   <id>` names a run and reuses its home when the folder exists; a run id is one folder name
   inside `.drive/`, with no `/`, `\` or `..`. When another run may be live —
   a second run of the agent's, or a peer agent's — pass `--run <id>` on every command, since
   any newer `start` moves `.drive/current` to its own run. `--user-config` copies the user's
   `~/.config/wigley-ai-gui` into the temp home, so their theme and keys apply; `start` fails
   when that folder is missing or empty.
2. Seed what the check needs: `npm run drive -- actions` lists every plugin's drive actions, and
   `npm run drive -- do <plugin>.<action> '<json>'` runs one (a session, a round, a chat, docs).
   `chat.start` uses the first profile in chat's `profiles` setting, and only a profile logged in
   to Claude reaches it under `--harness claude`; `{"profile":"<name>"}` picks another.
   `forms.openRound` opens its round in the live session forms itself opened under that
   `sessionId` (a fresh one once that session has ended), so a round for a session row comes
   from `forms.openRound` alone, never from a `sessions.connect` row.
3. Act with `key`, `type`, `click`, `drag`, `resize` and `setting`. Each returns once the page has
   redrawn: `resize` with the size the window took, the others with the log lines they caused
   (`setting` also says whether the config applied). The page holds document focus as the visible app's does,
   so `document.hasFocus()`, `.cm-focused`, `:focus` styles and focus events behave as they do for
   the user. When focus cannot be emulated (another debugger, such as DevTools, holds the page),
   the command still runs, unfocused, and the run's log says why. The self-test emulates the same
   focus, so a focus-dependent check can be kept as a self-test step.
4. Capture and read: `screenshot` saves the window, or one element by selector, under the run
   folder; Read the PNG. `query` returns a selector's text, box and computed style.
5. `npm run drive -- quit` when done; it waits for the ui-state write, part disposal and any
   recording to finish before the app exits. Run folders stay for reading back; `.drive/` is git-ignored.

A page edit hot reloads into a running run. A main-process edit needs `restart`, which keeps the
temp home and the start flags and does not copy the user config again, so a check that something
survives a restart runs the same way. The docs fixture survives a `restart` as the agent left it;
`docs.seed` and `docs.connectSession` rewrite it (`loadStates: true` on either adds one doc per
index load state other than `launch`, under `.claude/load-states/`; `indexDelayMs: <ms>` makes the
stand-in `docs_index.py` wait that long before answering, so an in-app create, rename or trash
keeps the Docs tree's "Claude pending" chip on screen long enough to see; default 0). `docs.openDoc` (`{ path,
line? }`) calls the docs page export `openDoc`: Docs mode shows and opens the doc at that line, or
toasts that the machine index does not list it. A start with an unusable environment (a relative
`WIGLEY_DRIVE_DIR`, a `WIGLEY_DRIVE_HARNESS` other than `fake` or `claude`) exits 1 with the
reason on stderr before any window opens.

The app runs commands one at a time, so a command that never returns blocks every later one, and
the CLI then says the run did not answer. A script the drive runs in the page rejects
(`PageNavigatedError`) when the page navigates under it or its renderer exits, and each wait caps
a check at 2 s and re-polls on that rejection, so a reload during a command costs one poll rather
than the whole 30 s wait. `ready` returns `{ ready: true, load }`, `load` numbering the page load
that is ready: 1 for the first, raised by each reload. Dev starts (`start`, `restart`, `npm run
selftest`) take `.drive/start.lock`, holding the taker's pid, because each `electron-forge start`
empties and rewrites the shared `.vite/build`, which the page's startup reload reads its preload
from. A start holds it from just before the spawn until the app reports load 2, past that reload:
a drive start asks `ready` until it does, the self-test reads its `[selftest] page load <n> starts
its run` lines. The reload is not guaranteed, so a page still on load 1 10 s after it first
reported releases the lock anyway, and a reload later than that can still read another start's
build; the self-test also releases when its child closes, and a packaged drive start skips the
lock. A start waits while a live pid holds it,
printing `Waiting for another dev start (pid <pid>) to finish`, clears a dead holder's lock, and
after 120 s fails naming the lock's absolute path to delete when no start is running. `restart`
and `quit` end a stuck run: `quit` runs beside the stuck command, and the CLI waits up to 60 s for
the app to exit (time for a recording's encode), then terminates it; the app takes that SIGTERM as
a second quit and exits without waiting further. Terminating skips any recorded pid whose process
no longer carries the run's `WIGLEY_DRIVE_DIR` (a pid reused after a crash); on Windows it cannot
check and terminates every live recorded pid.

A run folder holds `home/` (the app's home: config, plugin data, ui-state), `user-data/`
(Chromium's profile), `screenshots/`, `videos/`, `app.log`, and `start.json` and `drive.json`
(the CLI's records of the start and the running app).

## Commands

`npm run drive -- help` lists every command with its arguments, and is the source of truth.
Conventions:

- Keys take the self-test's notation: `KeyboardEvent.key` values and vim chords (`<D-w>`,
  `<A-o>`), as a sequence; a `key` argument splits on spaces, and `Space` stands for the space
  key, so a leader sequence is `key Space k s`; a blank argument such as `' '` is rejected.
- A click or drag presses the centre of the first element the selector matches, hidden ones
  included, through the real input pipeline; `query` returns every match. Scope the selector to
  the visible element (`.session-body:not([hidden]) …`). A click or drag fails, sending nothing,
  when the element has no size (it is not shown) or another element covers its centre, naming the
  cover: that is a finding, not a flake.
- `drag --hold` leaves the left button down at the drag's end point, so `query` and `screenshot`
  can read a style that shows only while the button is held; `release` lifts it there and returns
  the lines it caused. Until `release`, another `drag` or a `click` rejects with `A drag from
  <selector> is held; release it first`; `release` with nothing held rejects with `No drag is
  held; drag --hold first`.
- `wait-log` matches a whole page log line, its source prefix included (`[page] …`), logged after the call starts; a line already in the log does not count.
- `chat.askPermission` returns a `toolUseId` at once; `chat.permissionAnswer` with that id answers
  `{ pending: true }` until the card is answered, then the reply, as `forms.answers` does for a
  round.
- `eval` runs its script in a block of its own: `const`, `let` and `class` end with the call, while
  `var` and `function` reach the page's globals and persist to the next `eval`.
- Flags come before a lone `--`; every argument after it is positional, for a value that begins
  with `--`: `query --run <id> -- :root --wg-accent`.
- `screenshot <name>` takes a lowercase name in words joined by `-` and saves
  `screenshots/<name>.png`.
- `record start [name]` and `record stop` save `videos/<name>.mp4`, for transitions and animations;
  the video starts with the window as captured at `record start` and holds the last frame until
  `record stop`, so a still page records too. It encodes with `ffmpeg` from the app's PATH.
- `fit [width] [selector,…]` lists what the page cuts off at the minimum width, or at a given
  width; a lone non-numeric argument is the list of selectors that scroll themselves.
- `start --packaged` drives the packaged build; run `npm run package` first.

## Checking a screen

Read each screenshot against `DESIGN.md` and the change's intent. Where the claim has a number — a
colour token, a gap, a radius, a width — settle it with `query` against the token's value, since
the eye misjudges 2px and near colours. A check worth keeping as a regression becomes a step in
its plugin's self-test script (`AGENTS.md` § Running and testing).

## Real Claude

`start --harness claude` runs chat over the real Claude CLI with the user's own Claude login, and
its rounds open in the drive run, not in the user's app. It spends tokens, so use it only where a
fixture cannot stand in (real tool cards, real stream shapes), and name it in the report.

## What stays the user's

Synthetic keys never reach a global shortcut, never compose a dead key (macOS Option+n) and never
meet IME composition; an offscreen window shows no native notification or folder dialog. List each
such check in the wrap-up with its steps, and finish the work without waiting on it.
