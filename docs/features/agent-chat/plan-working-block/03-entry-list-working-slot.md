# 03 — Entry list working slot

Status: done
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/page/entry-list.ts` · modify `src/plugins/chat/page/chat-view.ts` (one comment) ·
           test `src/plugins/chat/page/entry-list.test.ts`
Consumes:  `workingInput(entries, now)` in `working-turn.ts` ← 01 · `WorkingInput` and the `working?` part ← 01
Produces:  no new export. `EntryList`'s interface comment states the working slot.
Decisions: block after the last entry, before the pending rows (Decided) · not a cursor stop (Decided) · goes when
           the turn ends (round 1)

The working slot is one more part slot, built the way the pending rows' slots are (`PartSlot`, `drawSlotPart`,
`updatePartSlot`):

- Add `working: WorkingInput` to `SlotPartInputs`, and a `SlotPartDraws<'working'>` made with
  `chatPartDraws(deps.layouts, 'working', deps.log)`. Hold the slot as `PartSlot<'working'> | null`.
- The slot is `li.chat-entry-slot.chat-working-slot`. It exists only while `working` is true. `changed()` computes
  `workingInput(entries, deps.clock.now())` and:
  - creates the slot when it is missing: inserted before the first pending row (else last), and observed by
    `slotSizes`;
  - updates it with `updatePartSlot` when its input changed;
  - when `working` is false: disposes the drawn part, unobserves the element, removes it and sets the slot to null.
- Changed means: `state`, `startedAt`, or any step replaced, added or gone (by identity, as `isActivityChanged`
  compares steps). `now` alone changes only on a tick.
- Place: a new entry slot from `put` goes before the working slot when it exists, else before the first pending
  row, else last. `putQueued` appends the pending rows after the working slot.
- The tick is armed while `working` is true, not only while a live run exists; `followLiveRun` becomes that rule.
  Each tick updates the live run slot (as today, guarded by `drawn !== null`) and the working slot, guarded the same
  way, each with the new `now`.
- The slot is never in `order`: `move`, `first`, `latest` and `focusedStop` do not know it. `lastStopId` is
  unchanged.
- `rebuild`: dispose the slot's drawn part and set the slot to null before `list.replaceChildren()`; `changed()` then
  creates it again after the pending rows are put, before them in the list. `dispose` disposes it.
- Update the `EntryList` interface comment, the `EntryListDeps` comment on `timers` and `clock`
  (`entry-list.ts` line 56) and the matching comment in `chat-view.ts` (line 113, "`timers` and `clock` tick a live
  activity line's time") to name the working block too.

GIVEN a list with one user entry and a pending row WHEN `setWorking(true)` runs THEN one working slot sits after the
user entry and before the pending row, and `move(1)` from the user entry returns the pending stop.

Tests:     `entry-list.test.ts`, a new `describe('working block')`. The tests draw through a recording user layout
           with a `working` part (like `recordingActivity`), which records each draw and update input, and a
           recording `activity` part where a test asserts what else redraws.
           · `working_SetWorkingThenIdle_SlotAfterEntriesThenGone` — after `setWorking(true)` the list's children
             end with the user slot, then `chat-entry-slot chat-working-slot`, then the pending row; after
             `setWorking(false)` no working slot remains.
           · `working_Changes_UpdateOnlyOnStepsOrState` — table: put a running tool → one update with that step in
             `steps` and `state: 'working'`; put the same tool with a result → one update, `state: 'thinking'`;
             `setQueued` with one message → no update, the block stays before the row; `rebuild` with the same
             entries → one working slot, drawn once more.
           · `working_PutWhileWorking_EntrySlotGoesBeforeTheBlock`.
           · `working_Tick_UpdatesTheBlockWithNow` — with the fake timers, set `clock.time = 7000` and fire: the
             working part gets one update with `now: 7000`; no entry slot redraws.
           · `working_CursorSkipsTheBlock` — with entries `user` and a pending row, `move(1)` from the user entry
             returns the pending stop, and `move(-1)` returns the user entry.
           Keep `runs_LiveTick_UpdatesOnlyTheLiveRun`'s claim; change its armed-timer counts only if the shared tick
           changes them.
Done when: `npm run typecheck`, `npm test` and `npm run lint` pass
Commit:    one commit for the group

## Proof

Commit f12a2964 · proof: diff read: slot, place, tick, rebuild and dispose per spec; worker ran src/plugins/chat/page 265 pass and lint; typecheck errors only in 02's in-progress layout.test.ts, full compile re-run after 02 · concerns: none in its own files
