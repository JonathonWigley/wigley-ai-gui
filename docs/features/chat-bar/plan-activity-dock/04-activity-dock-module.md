# 04 — The activity dock module

Status: done
Type: Task
Wave: 3 · Depends on: 02
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/page/working-turn.ts` · create `src/plugins/chat/page/activity-dock.ts` ·
           test `src/plugins/chat/page/working-turn.test.ts` · create `src/plugins/chat/page/activity-dock.test.ts`
Consumes:  `LiveWorkingInput`, `DoneWorkingInput`, `WorkingInput` in `src/plugins/chat/layouts/layout.d.ts` ← 02 ·
           `ChatEntry` `tool` `agentId` ← 01 · `MAIN_AGENT_ID` in `src/contracts/agent.ts` (exists) ·
           `Clock`, `Timers` in `src/contracts/ambient.ts` (exist) · `isStep` in `activity-runs.ts` (exists)
Produces:  in `src/plugins/chat/page/working-turn.ts`:
           `export function workingInput(entries: readonly ChatEntry[], now: number): LiveWorkingInput`
           `export function isTurnEmpty(entries: readonly ChatEntry[]): boolean` (unchanged)
           `export function doneInput(entries: readonly ChatEntry[]): DoneWorkingInput | null`
           in `src/plugins/chat/page/activity-dock.ts`, verbatim from plan.md § File Structure:
           `export interface ActivityDockDeps` · `export interface ActivityDock` ·
           `export function createActivityDock(deps: ActivityDockDeps): ActivityDock`
Decisions: one deep module owns the dock's data, the tick and the held rule (decision 4) · finished-line rules
           (decision 3) · finished time from the user's message, live timer from today's turn start (D1) ·
           subagents' tool steps filtered here, and the `working` state word reads main-agent tools only (D2) · no
           result, no line (D3) · no `now` on done (D4) · this task edits no `layout.d.ts` comment; task 06 writes the
           filtered-steps and held-start wording (D12)

## Rules

`working-turn.ts` (pure):

- `workingInput`: as today, with `steps` leaving out every `tool` step whose `agentId` is not `MAIN_AGENT_ID`.
  Its turn and `startedAt` keep today's rule (`turnStart`: the later of the last `user` entry and the first entry
  after the last `result`). `turnState`'s `working` rule (a tool with no result) reads only the turn's tool entries
  whose `agentId` is `MAIN_AGENT_ID`; its other rules read the whole turn as today (D2).
- `doneInput`: the turn is every entry from the last `user` entry on (every entry when the list holds no `user`
  entry). This is not `turnStart`'s turn: a result before the last one stays inside it (D1). Null when the turn
  holds no `result` entry. Otherwise:
  - `startedAt` — the turn's first entry's `at` (the user entry's)
  - `endedAt` — the last `result` entry's `at`
  - `stopReason` — the last `result` entry's `stopReason`
  - `costUsd` — the sum of every `result` entry's `costUsd` in the turn, null ones skipped; null when every one is
    null
  - `steps` — the turn's steps (`isStep`) in entry order, leaving out subagents' tool steps, as `workingInput` does
- The module's head comments name the dock in place of "the running turn's block".

`activity-dock.ts` (state, clock, timers):

- `set(entries, working)`:
  - `working` and the dock shows a live input and `isTurnEmpty(entries)` holds: keep the shown input (the held
    rule); call nothing.
  - `working` otherwise: next = `workingInput(entries, clock.now())`. Call `changed(next)` when the dock showed no
    live input, or when the steps changed (any step replaced, added or gone, by identity), the state or `startedAt`
    changed. Arm the tick when it is not armed.
  - not `working`: clear the tick. next = `doneInput(entries)`. Call `changed(next)` when it differs from the shown
    input: null against non-null, live against done, or for two done inputs any of `steps` (by identity),
    `startedAt`, `endedAt`, `stopReason`, `costUsd`.
- The tick: every 1000 ms (`TICK_MS`, moved here from `entry-list.ts`'s working use; the entry list keeps its own
  for the live run) while the shown input is live, `changed({ ...shown, now: clock.now() })`, and the shown input
  takes the new `now`. Done and null never tick. `Timers.set` runs its callback once, so the tick re-arms itself
  as `entry-list.ts` `runTick` does: the callback sets the held timer to null, calls `changed`, then calls
  `timers.set` again only while the shown input is still live.
- `input()` returns the shown input. `dispose()` clears the tick.
- The interface comment states the rules above in one paragraph, as `EntryList`'s comment does for the list.

GIVEN working with a user entry at 100 and a running main tool WHEN `set` runs THEN `changed` gets a live input,
state `working`, startedAt 100, steps [the tool]
GIVEN a live dock WHEN a `result` entry lands while still working THEN `changed` is not called and the dock keeps
its live input; the next tick sends it with a new `now`
GIVEN a done dock (idle after a result) WHEN `set(entries, true)` runs with the last entry still that result THEN
`changed` gets a live input with startedAt = now and steps []
GIVEN idle with user at 100, a result at 900 cost 0.25, a later `success` result at 1500 cost null WHEN `set` runs
THEN `changed` gets done with startedAt 100, endedAt 1500, stopReason `success`, costUsd 0.25
GIVEN idle with no result after the last user entry WHEN `set` runs THEN `changed(null)` (when the dock showed
something) and `input()` is null
GIVEN a live dock WHEN the session goes idle THEN the tick is cleared and no later timer fires `changed`
GIVEN a live dock with a user entry at 100 WHEN a `result` lands and the session goes idle THEN `changed` gets the
done input and the tick is cleared
GIVEN a done dock WHEN the user sends (a new `user` entry, no result after it) and `set(entries, false)` runs THEN
`changed(null)`
GIVEN any shown input WHEN `set` runs again with the same entries array and the same flag THEN `changed` is not
called
GIVEN a live dock WHEN `set` runs with one more main tool step THEN `changed` gets the new live input; WHEN `set`
runs with a new entries array whose steps, state and turn start are the same THEN `changed` is not called
GIVEN a done dock (result at 900) WHEN a later `result` lands at 1500 while still idle THEN `changed` gets a second
done input with endedAt 1500 (decision 3: the line updates in place)
GIVEN entries user at 100, a result at 900, a tool at 1000 with no result WHEN `set(entries, true)` runs THEN the
live input's startedAt is 1000 (today's turn start); WHEN that tool's result and a `result` at 1500 land and
`set(entries, false)` runs THEN the done input's startedAt is 100 (D1: the two starts differ)
GIVEN working with a running `Agent` call answered at once (its tool entry holds a result) and a subagent tool with
no result WHEN `set` runs THEN the live state is `thinking`, not `working`, and the steps hold only the `Agent` call

Tests:     `workingInput state with $given → $expected` (`working-turn.test.ts`): add a row — a main tool with a
           result and a subagent's tool with no result → `thinking` (D2) · the startedAt/steps
           table (`it.each` at the second `describe` block, rows such as `a second user turn`): add a row with a
           subagent's tool step between two main tool steps → steps hold the main ones only · new
           `doneInput ($given)` table in `working-turn.test.ts`, literal expected per row: one result with cost;
           two results, one null cost → the other's cost; every cost null → `costUsd` null; last stop reason
           `max_tokens` → `stopReason: 'max_tokens'`; no `user` entry → startedAt from the first entry; no result
           after the last user (a result only before it) → null; a subagent tool in the turn → left out of steps;
           user at 100, result at 900, an entry at 1000, result at 1500 → startedAt 100, endedAt 1500 (where the
           live turn would start at 1000).
           Extend the file's spec builder with a mark for a subagent's tool and a result's cost and stop reason ·
           new `activity-dock.test.ts` with a fake clock and fake timers built in the file, as
           `entry-list.test.ts` builds its own: `dock_Set ($case)` as one table over sequences of `set` calls,
           each row asserting the full list of `changed` inputs (or null) and `input()`, one row per GIVEN above
           but the tick ones (the first row is the first GIVEN; the transitions live→done, done→null, the repeat
           `set`, the steps-changed and nothing-changed live `set`, the second done input, the two starts and the
           subagent state each get their own row) · `dock_Tick_LiveSendsNowEachSecondAndStopsWhenIdle` (one test:
           two ticks send `now` 2000 and 3000, which needs the re-arm; idle clears the timer; `dispose` clears an
           armed one)
Done when: `npm run typecheck` passes; the test gate runs the tests above
Commit:    one commit for the group

## Proof

Commit c3a7867b · proof: diff read: workingInput, isTurnEmpty, doneInput, ActivityDockDeps, ActivityDock, createActivityDock present as planned; typecheck green · concerns: isStepsChanged now duplicated in activity-dock.ts and entry-list.ts; LiveWorkingInput.startedAt comment still says held block (task 06)
