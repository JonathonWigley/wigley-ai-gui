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
fresh temp home in `.drive/<run-id>/`, beside the user's own app: it never takes the user's screen
or touches their data, so start one whenever a check needs it.

## Loop

1. `npm run drive -- start` returns once the page is ready and prints the run id. `.drive/current`
   names the newest run, so later commands need no `--run`. `--user-config` copies the user's
   `~/.config/wigley-ai-gui` into the temp home, so their theme and keys apply.
2. Seed what the check needs: `npm run drive -- actions` lists every plugin's drive actions, and
   `npm run drive -- do <plugin>.<action> '<json>'` runs one (a session, a round, a chat, docs).
3. Act with `key`, `type`, `click`, `drag`, `resize` and `setting`. Each returns once the page has
   redrawn, with the log lines it caused.
4. Capture and read: `screenshot` saves the window, or one element by selector, under the run
   folder; Read the PNG. `query` returns a selector's text, box and computed style.
5. `npm run drive -- quit` when done. Run folders stay for reading back; `.drive/` is git-ignored.

A page edit hot reloads into a running run. A main-process edit needs `restart`, which keeps the
temp home, so a check that something survives a restart runs the same way.

## Commands

`npm run drive -- help` lists every command with its arguments, and is the source of truth.
Conventions:

- Keys take the self-test's notation: `KeyboardEvent.key` values and vim chords (`<D-w>`,
  `<A-o>`), as a sequence.
- A click or drag lands at the element's box through the real input pipeline, so an element
  covered by another fails the click: that is a finding, not a flake.
- `record start` and `record stop` save an MP4, for transitions and animations.
- `fit` lists what the page cuts off at the minimum width, or at a given width.
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
