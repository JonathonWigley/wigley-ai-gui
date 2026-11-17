# 03 — Self-test runs a playtest command

Status: not started
Type: Task
Rung: hard · async wait on a slot in the self-test fixture, and a new fake harness turn other scripts may meet
Wave: 3 · Depends on: 02
Plan: [plan.md](plan.md)

Files:     modify `wigley-ai-gui/src/shared/fake-agent-harness.ts` · modify `wigley-ai-gui/src/plugins/live-view/main/selftest-script.ts` · modify `wigley-ai-gui/src/plugins/live-view/main/start.ts`
Consumes:  `playtestStarted(sessionId: string, projectPath: string): Promise<void>` on `LiveTools` ← 02 (reached through the real chat plugin, not called directly)
           `createPlaytestWatch(deps: PlaytestWatchDeps): PlaytestWatch` ← 02 (wired in `main/start.ts`)
Produces:  `export const FAKE_PLAYTEST_TEXT = 'fake: playtest'` in `…/src/shared/fake-agent-harness.ts`
Decisions: Self-test: yes, through `open` and `problems` (plan, Decided) · AGENTS.md § Running and testing: a key
           behaviour gets a self-test step

## Why

The unit tests in 02 fake chat's slot and event. Only a self-test runs a real chat row over the fake agent harness,
so only it proves the real chat plugin's live Bash entry and its `toolStarted` reach live-view's watch. The page side
of an app-opened pick (a whole-editor stream) is existing behaviour, so the page steps stay as they are.

## A. The fake harness's playtest turn

- Add `FAKE_PLAYTEST_TEXT = 'fake: playtest'`, exported, with a comment in the style of `FAKE_TOOL_TEXT`'s: a send of
  this text runs one Bash tool of the main agent whose command is `unity command editor_play --result-only`, finished
  with result `{ text: 'Entered Play Mode.', isError: false }`, then the reply `fake agent entered Play Mode` and the
  turn's end.
- It follows `emitToolTurn` exactly (entry, `toolStarted`, finished entry, `toolFinished`, assistant entry,
  `emitTurnEnd`); the `summary` is the command text. Reuse `emitToolTurn` with the call's command, result and reply as
  arguments rather than a second copy, keeping `FAKE_TOOL_TEXT`'s values the same.
- Add its branch beside `text === FAKE_TOOL_TEXT` in the send handler.

## B. The live-view self-test

- `LiveViewSelfTestDeps` gains the picks reader: `picks: Pick<KeyedSlotReader<LivePick>, 'get' | 'on'>`. `main/start.ts`
  passes `api.state.read(livePicksSlot)`.
- `open()`:
  1. Launch the session as now, with `message: { text: FAKE_PLAYTEST_TEXT, images: [] }` in place of
     `'live-view self-test'`.
  2. Wait for the session's pick: read `picks.get(sessionId)` first, else wait on `picks.on` for that key, for at most
     10 000 ms. Dispose the listener when the wait ends.
  3. Then call `show` with `FAKE_GAME_RECT`, as now (the agent's call after `capture.py start`).
  4. `result` resolves to `{ playtestPick: LivePick | null, shown: ToolResult }`: the pick the wait saw, or null when
     it timed out.
- `problems(result)` lists, in this order, each that holds:
  - `playtestPick` null: `the playtest command opened no Live view`
  - `playtestPick` not a stream, or its summary is not `Editor · selftest-unity`:
    `the playtest command's Live view shows <summary, or Screen Recording off>`
  - `shown.isError`: `show_live_view failed: <text>` (as now)
- The `live section` group's `why`: `The session's playtest command opens Live on the whole editor by itself (the
  script's result checks it); the agent's show_live_view then streams the fake editor's Game View into the session
  hub's Live section, which streams only while it is on screen.`
- Update the comment above `liveViewSelfTestScript` to say the run launches with the playtest text and waits for the
  app's pick before the agent's show.

No new step: the steps' lines are the page's, and the page streams the agent's Game View pick by the time the first
step widens the window. If the first step logs `streaming Editor · selftest-unity` first, its `expect` still waits for
the Game View line.

## GIVEN / WHEN / THEN

- GIVEN the self-test's project folder holds `Library/EditorInstance.json` naming the fake editor's pid WHEN the
  script launches its session with `fake: playtest` THEN the session's pick becomes `Editor · selftest-unity` within
  10 s, and the script's `problems` is empty.
- GIVEN live-view's watch is not wired (02 reverted) WHEN the self-test runs THEN `problems` holds
  `the playtest command opened no Live view`. (Checked by reading, not run.)

## Tests

- No new Vitest test: the behaviour is the self-test's. `npm run selftest -- --plugin live-view` runs it; task 05
  carries that run.

Done when: compiles; `npm run typecheck` passes.
Commit:    one commit for the group

## Proof

<written by wigley:make: commit sha, proof result, concerns; empty until the group lands>
