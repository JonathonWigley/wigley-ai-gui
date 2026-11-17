# 05 — Final verification

Status: not started
Type: Task
Wave: 4 · Depends on: 01 (checked live), 02 (checked live), 03 (its self-test runs)
Plan: [plan.md](plan.md)

Files:     none
Consumes:  `FAKE_PLAYTEST_TEXT` ← 03
Produces:  nothing

`wigley:make` runs this task once, after its test gate, in its live session. Every other task defers its live checks
here. The app's live check route is the self-test and the `drive` skill (`wigley-ai-gui/.claude/skills/drive/SKILL.md`);
the user does no browser testing.

## Checks

1. **Self-test, live-view only** — `npm run selftest -- --plugin live-view` (from `wigley-ai-gui/`, Node per
   `.nvmrc`). Expected: passes. The script's `problems` is empty, so the real chat row's `fake: playtest` Bash call
   opened `Editor · selftest-unity`, and the agent's `show` then replaced it; the `live section` group's steps pass
   and save `.selftest/screenshots/live-view-live-section.png` and `live-view-crowded-hub.png`. Read both screenshots
   against `wigley-ai-gui/DESIGN.md`: the Game View crop shows whole inside the hub, as before this change.
   Confidence: expected — the fake harness puts the entry before its `toolStarted`, a path 02's tests cover.
2. **Self-test, chat** — `npm run selftest -- --plugin chat`. Expected: passes. It guards the shared fake harness
   change in 03 (a new send text, and `emitToolTurn` taking its call as arguments). Confidence: expected — the change
   keeps `FAKE_TOOL_TEXT`'s values.

## Dropped

- Pairing orders, replays, restores, folder order, precedence and interrupted shows: pinned by 02's tests
  (`playtestStart_OpensTheWholeEditor_given`, `playtestCommand_WritesNoPick_given`,
  `editorStop_ClosesOnlyTheAppsPick_given`, `playtestShow_InterruptedWhileTheWindowsList_given`).
- Command forms: pinned by 01's `parsePlaytestCommand_ReadsTheSignal_given`.
- A drive run of the Live section: the page part is unchanged, and check 1's screenshots cover the section.

## For the user's wrap-up (low-confidence, needs a real editor and Screen Recording)

A real Unity playtest in the installed app, after `npm run install-app` from a ref holding this change, is the only
check of the Claude Code harness's real entry and event order and of a real editor window. The wrap-up lists it with
its steps: in a session whose project is a Unity project with the editor open, ask the agent to playtest; the Live
section opens on the whole editor at `unity command editor_play`, crops to the Game View when the agent calls
`show_live_view`, and closes at `hide_live_view`. Low-confidence because the agent cannot grant the dev app Screen
Recording, and the self-test and drive runs use the fake ScreenCapture.

## Proof

<written by wigley:make: commit sha, proof result, concerns; empty until the group lands>
