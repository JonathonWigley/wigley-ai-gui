# 06 — Entry list draws activity lines, commands read stops

Status: not started
Type: Batch
Wave: 3 · Depends on: 04, 05
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/page/entry-list.ts` · test `src/plugins/chat/page/entry-list.test.ts` · modify `src/plugins/chat/page/chat-commands.ts` · test `src/plugins/chat/page/chat-commands.test.ts`
Consumes:  `listRows`, `cursorStops`, `runIdOf`, `isStep`, `StepEntry`, `ListRow`, `ListStop` in `src/plugins/chat/page/activity-runs.ts` ← 04
           `focusAfterClose` in `src/plugins/chat/page/entry-focus.ts` ← 04
           `ActivityInput`, `ChatLayout.activity` in `src/plugins/chat/layouts/layout.d.ts` ← 05
           `chatPartDraws`, `surfaceBaseKit`, `ChatLayouts` in `src/plugins/chat/page/chat-layouts.ts` (in the tree)
Produces:  in `src/plugins/chat/page/entry-list.ts`:
           `EntryListDeps.layouts: ChatLayouts` (was `Pick<ChatLayouts, 'shown'>`)
           `EntryList.setWorking(working: boolean): void`
           `EntryList.move(step: 1 | -1): ListStop | null`
           `EntryList.first(): ListStop | null`
           `EntryList.focused(): ListStop | null`
           `EntryList.toggleFocused(): { stop: ListStop; result: ToggleResult } | null`
Decisions: **rows and stops**: the list keeps the last `entries`, a `working` flag (false at creation) and `openRuns: Set<string>`. After each `put`, `rebuild`, `setWorking` and toggle it computes `listRows(entries, working)`, then `order = cursorStops(rows, openRuns)`, then the focus as today (`focusAfterChange` over `order`). `following` and every scroll rule act on stops as they act on entries today
           **slots**: every entry keeps its own slot, built and redrawn as today. A step's slot also carries `chat-step-slot` and `hidden` while its run is not in `openRuns`. Each run row has one slot `li.chat-entry-slot.chat-activity-slot`, keyed by its `runId`, inserted right before its first step's slot when the run first appears. A run slot's id is a stop id, so `is-cursor` and `scrollIntoView` reach it as they reach an entry slot
           **the part**: the run slot draws the layout's `activity` part through one `chatPartDraws(deps.layouts, 'activity', deps.log)` the list makes at creation, with a `surfaceBaseKit(deps.kit, 'chat', rollback)` kit, and the input `{ steps, current: steps.at(-1), live, open }` (the `StepEntry` values pass as `StepInput`; `read-chat-layout.ts` already checks each variant fits its input). On each recompute a run whose input changed runs `update`; `'none'` or `'threw'` draws the part again into its slot, disposing the old draw. A `default` draw that throws is logged as `default layout activity failed: <error>` and leaves `div.chat-entry.chat-raw` reading `activity` (plan.md § Decisions)
           **open and close**: `toggleFocused` on a run stop flips its id in `openRuns`, shows or hides its step slots, redraws its part with the new `open`, and on close applies `focusAfterClose(focus, runId, stepIds)` before recomputing the stops; it returns `'expanded'` or `'collapsed'`. On an entry stop it does what it does today. A `click` listener on the run slot runs the same flip without moving the focus
           **open state lifetime**: `rebuild` keeps `openRuns`; a run turning from live to finished keeps its open state; `dispose` clears it and disposes every run slot's draw
           **`setWorking(working)`**: stores the flag and recomputes; it redraws nothing when the live run did not change
           **`ListStop`** for the focused stop: an entry slot's `{ kind: 'entry', entry }`, a run slot's `{ kind: 'activity', runId, steps }`
           **commands** (`chat-commands.ts`, in this group because the new return types break its compile): `moveEntry` logs `focused activity line` for an activity stop and `focused <kind> entry` for an entry stop, `no entries in <name>` for null, as today. `toggleEntry` opens the image viewer only for an entry stop whose entry is a user entry with images; otherwise it calls `toggleFocused` and logs `<result> activity line` for an activity stop (`expanded activity line`, `collapsed activity line`), and for an entry stop what it logs today (`<result> <kind> entry`, `<kind> entry has nothing to expand`). `firstEntry`'s log lines do not change. `ChatSession.entries` in `chat-view.ts` picks the same member names and needs no edit
GIVEN entries user, tool, tool, assistant WHEN the list builds them THEN its children are the user slot, one activity slot, two hidden step slots, the assistant slot, and `move(-1)` twice from the latest gives the activity stop
GIVEN the focus on an activity stop WHEN `toggleFocused` runs twice THEN the first returns `expanded` and unhides the step slots, `move(1)` then gives the first step's entry stop, and the second toggle (after `move(-1)`) returns `collapsed` and hides them
GIVEN an open run with the focus on its second step WHEN the run closes by a click on its slot THEN the focus is on the run's stop
GIVEN a run that is the last row WHEN `setWorking(true)` runs THEN the part's input has `live: true`, and after a `put` of an assistant entry it has `live: false`
GIVEN a user layout whose `tool` builder draws `div.fancy` WHEN a run opens THEN its step slots hold `div.fancy` (the user's answer: a layout redrawing a step kind keeps working)
GIVEN a run open WHEN `rebuild` runs with the same entries THEN the run is still open
Tests:     `entry-list.test.ts`: one new `describe('activity lines')` holding one test per GIVEN above, named `runs_<Case>_<Outcome>` (for example `runs_UserToolToolAssistant_OneActivitySlotBeforeHiddenSteps`); the list is built with `createChatLayouts(log)` set to the shown layouts, in place of `{ shown }`
           `entry-list.test.ts`, the existing `buildEntry` table: rows whose puts hold a `tool`, `thinking` or `raw` entry now also expect the activity slot before the step slot; update their expected slot lists, and switch the deps to `createChatLayouts` as above
           `chat-commands.test.ts`: the `focusedOn(entry)` helper answers `{ kind: 'entry', entry }` stops and `{ stop, result }` toggles; add `toggleEntry_activityLine_logsExpandedActivityLine` — a focused activity stop toggles once and logs `[chat] expanded activity line`; add a row or test that `nextEntry` on an activity stop logs `[chat] focused activity line`
Done when: compiles; the test gate runs `entry-list.test.ts` and `chat-commands.test.ts`
Commit:    one commit for the group

## Proof

