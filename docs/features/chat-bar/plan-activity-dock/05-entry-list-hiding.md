# 05 — Entry list hides activity rows and drops the working block

Status: not started
Type: Batch (the `activityInTranscript` hiding; the working block's removal — one file, one test file)
Wave: 3 · Depends on: 01, 02
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/page/entry-list.ts` · test `src/plugins/chat/page/entry-list.test.ts`
Consumes:  `isActivityInTranscript(shown: ShownLayouts<ChatLayout>): boolean` ← 02 · `isStep` in
           `activity-runs.ts` (exists)
Produces:  `createEntryList(deps: EntryListDeps): EntryList` in `src/plugins/chat/page/entry-list.ts` — same
           signature; `EntryList` keeps every member (`setWorking` still marks the last run live)
Decisions: hiding rule lives in the layout; false builds no slot and no stop for runs, steps and `result`
           entries (decision 5) · the working block leaves the list, its data moves to the dock (decision 4) · flag
           read at each rebuild (D5)

## What changes

Hiding:

- `createEntryList` reads `isActivityInTranscript(deps.layouts.shown())` into a list-local flag when it runs, and
  `rebuild` reads it again before it builds (the initial `rebuild` from `createTab` reads it too). A list that only
  `put`s, as the tests' `setUpList` does, so uses the flag of the layouts shown at creation (D5). While the flag is
  false, the list works from the session's
  entries with every step (`isStep`) and every `result` entry left out: `put` of such an entry builds and redraws
  no slot, `rebuild` builds none, and `changed` computes `listRows` and `cursorStops` from the kept entries, so no
  run, step or result is a row or a stop. While the flag is true, the list does what it does today.
- `toggleFocused`, `focusedStop` and the rest need no change: a hidden kind has no slot to focus.
- A hidden `put` still calls `changed()`, and while working `followWorking` still arms the 1 s tick though no live
  run slot exists under the flag false. Leave that as it is: add no flag guard there (it would change the
  `armed.size` the `runs_LiveTick_…` rows assert), and no test asserts `armed.size` under the flag false.

Working block removed:

- Remove `workingSlot`, `workingPart`, `putWorking`, `removeWorking`, `isWorkingChanged`, the working update in
  `runTick`, the working cleanup in `rebuild` and `dispose`, `SlotPartInputs.working`, and the imports of
  `workingInput`, `isTurnEmpty` and `WorkingInput`.
- `entryPlace` becomes the first pending row's element, else the end (`firstQueuedElement`); new entry slots go
  there.
- Keep: `setWorking` (a last run is live only while working), the 1 s tick for the live run's line, `timers` and
  `clock` in `EntryListDeps`, and `followWorking`, which still arms the live run's tick.
- Comments: the `EntryListDeps` comment, the `EntryList` interface comment, `rebuild`, `setQueued`, `setWorking`,
  `dispose` and `putQueued` drop "the working block" and state the flag rule.

GIVEN the default layout and entries user, tool, thinking, assistant, permission, result, notice WHEN the list
rebuilds THEN it holds slots for user, assistant, permission, notice only, in that order, and the cursor stops are
those four ids
GIVEN a user layout `{ activityInTranscript: true }` and the same entries WHEN the list rebuilds THEN it holds
today's slots: the activity line before its steps, and the result's own slot
GIVEN the default layout WHEN a tool entry is put, then put again with its result THEN no slot is built and no
entry is drawn for it
GIVEN the default layout and a pending row WHEN an assistant entry is put THEN its slot sits before the pending row

Tests:     add a helper beside `defaultShown()`:
           `activityShown(user: ChatLayout = {}, name = 'activity')`, returning
           `withUser(defaultLayout, { ...user, activityInTranscript: true }, name)`. The flag must sit in the shown
           user layout itself, since `isActivityInTranscript` reads only the user layout and `default` ·
           build over `activityShown()`: every existing test in `describe('activity lines')`, every `pending rows`
           test that builds a run, and every `buildEntry: $name` row and other test whose entries hold a step or a
           `result` that it expects drawn · build over `activityShown(<its user layout>, <its name>)`, keeping each
           custom builder: the `buildEntry: $name` rows `shown layout draws`, `shown layout leaves the kind out` and
           `shown layout throws` (`fancyLayout()`, `fancy`), `recordingActivity(calls)` and the tests that use it
           (`runs_LastRunSetWorkingThenAnswered…`, `runs_LiveTick…`, `runs_PutInAnotherRow…`),
           `runs_UserToolBuilder_StepSlotsDrawWithIt` and `runs_UserActivityUpdateThrows_RedrawsWithDefault` ·
           delete `describe('working block')` and its tests
           (`working_SetWorkingThenIdle_SlotAfterEntriesThenGone`, the `it.each` cases after it,
           `working_PutWhileWorking_EntrySlotGoesBeforeTheBlock`, the `startedAt` table,
           `working_CursorSkipsTheBlock`, and the `recordingWorking` helper with its `WorkingCall` type once no
           remaining test uses them): their
           behaviour now lives in `activity-dock.test.ts` (04) and the composer tests (06) ·
           add `hidden_ActivityNotInTranscript ($case)` over `defaultShown()`: one table over the first three
           GIVENs above. Each row asserts the slots as `slotClasses(list.element)` plus each slot's entry kind, read
           from its first child's class (`chat-user`, `chat-assistant`, …), in order; and the stops by `first()`,
           then `move(1)` until `isAtLastStop()`, collecting each `focused()` entry id. The third row asserts
           `slotClasses(list.element)` is `[]` after both puts and `focused()` is null ·
           `pending_EntryPutAfterRows_SlotsSitBeforeRows` pins the last GIVEN on `defaultShown()`: change its put
           from `tool('t1')` to `assistant('a1')`, expecting `['chat-entry-slot' (user), 'chat-entry-slot'
           (assistant), 'chat-entry-slot chat-queued-slot', 'chat-entry-slot chat-queued-slot is-cursor']`; the
           run variant it held moves to `activityShown()` as a second test,
           `pending_RunPutAfterRows_SlotsSitBeforeRows`, with today's expected slots
Done when: `npm run typecheck` passes; the test gate runs `entry-list.test.ts`
Commit:    one commit for the group

## Proof

