# 03 — Entry list working slot

Status: not started
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/page/entry-list.ts` · test `src/plugins/chat/page/entry-list.test.ts`
Consumes:  `workingInput(entries, now)` in `working-turn.ts` ← 01 · `WorkingInput` and the `working?` part ← 01
Produces:  no new export. `EntryList`'s interface comment states the working slot.
Decisions: block after the last entry, before the pending rows (Decided) · not a cursor stop (Decided) · goes when
           the turn ends (round 1)

The working slot is one more part slot, built the way the pending rows' slots are (`PartSlot`, `drawSlotPart`,
`updatePartSlot`):

- Add `working: WorkingInput` to `SlotPartInputs`, and a `SlotPartDraws<'working'>` made with
  `chatPartDraws(deps.layouts, 'working', deps.log)`.
- The slot is `li.chat-entry-slot.chat-working-slot`. It exists only while `working` is true. `changed()` creates it
  when missing, updates it when its input changed, and disposes and removes it when `working` is false.
- Place: after the last entry slot and before the first pending row. A new entry slot from `put` goes before the
  working slot when it exists, else before the first pending row, else last. `putQueued` appends the pending rows
  after it.
- Changed means: `state`, `startedAt`, or any step replaced, added or gone. `now` alone changes only on a tick.
- The tick: arm it while `working` is true, not only while a live run exists. Each tick updates the live run slot
  (as today) and the working slot, each with the new `now`. `followLiveRun` becomes the rule "tick while working".
- The slot is never in `order`: `move`, `first`, `latest` and `focusedStop` do not know it. `lastStopId` is
  unchanged.
- `rebuild` disposes and builds it again with the shown layouts; `dispose` disposes it. `slotSizes` observes it, so
  a following focus scrolls to the bottom as it grows.
- Update the `EntryList` interface comment and `EntryListDeps`' `timers`/`clock` comment for the working slot.

GIVEN a list with one user entry and a pending row WHEN `setWorking(true)` runs THEN one working slot sits after the
user entry and before the pending row, and `move(1)` from the user entry lands on the pending row.

Tests:     `entry-list.test.ts`, a new `describe('working block')`:
           · `working_SetWorkingThenIdle_SlotAfterEntriesThenGone` — slot present after `setWorking(true)`, at the
             place above; gone after `setWorking(false)`.
           · `working_PutWhileWorking_EntrySlotGoesBeforeTheBlock`.
           · `working_Tick_UpdatesTheBlockWithNow` — with fake timers, one tick updates the working part with the
             clock's new time, no other entry redraws.
           · `working_CursorSkipsTheBlock` — `move` walks entries and pending rows only.
           Extend the existing `runs_LiveTick_UpdatesOnlyTheLiveRun` expectations only if the shared tick changes
           its update count; keep its claim.
Done when: compiles; `npm test` passes on `entry-list.test.ts`
Commit:    one commit for the group

## Proof
