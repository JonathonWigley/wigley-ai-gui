# 02 — Cursor model

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/page/entry-focus.ts` · test `src/plugins/chat/page/entry-focus.test.ts`
Consumes:  none
Produces, all in `entry-focus.ts`:

- `export interface EntryFocus { stopId: string | null; following: boolean; anchorId: string | null }`
- `export function blockStopId(entryId: string, blockIndex: number): string`
- `export function entryIdOfStop(stopId: string): string` — the text before the last `#`, else the whole id
- `export function toggleAnchor(focus: EntryFocus): EntryFocus` — sets `anchorId` to `stopId` when it is null, else sets it to null. A null `stopId` changes nothing.
- `export function clearAnchor(focus: EntryFocus): EntryFocus`
- `export function rangeStops(focus: EntryFocus, ids: readonly string[]): string[]` — the ids from anchor to cursor in list order, inclusive. With no anchor, the cursor stop alone. With no cursor, an empty list.
- `export function moveToMessage(focus: EntryFocus, ids: readonly string[], messageIds: readonly string[], step: 1 | -1): EntryFocus` — moves to the first stop of the next or previous message.
- `export function focusStop(focus: EntryFocus, ids: readonly string[], stopId: string): EntryFocus` — moves to `stopId`, keeps `anchorId`, and sets `following` when `stopId` is the last id.
- `export function nearestVisibleStop(ids: readonly string[], current: string, direction: 1 | -1, isVisible: (id: string) => boolean): string | null` — null when `current` is visible or no stop is visible. Otherwise it walks from `current` in `direction`, then the other way, and returns the first visible id.

Decisions:

- Rename `entryId` to `stopId` in `EntryFocus`, and update every reference in this file. Task 03 updates `entry-list.ts`.
- `START_FOCUS` holds `anchorId: null`.
- `moveFocus`, `focusAfterScroll`, `focusAfterScrollEvent` and `focusAfterClose` keep `anchorId`.
- `focusFirst(ids, anchorId)` and `focusLatest(latestId, anchorId)` take the anchor as a new parameter, so `G` and `gg` keep an open range. With no ids they return `START_FOCUS`.
- `focusAfterChange`: an `anchorId` that is no longer in `ids` becomes null.
- `focusAfterChange` keeps its parameters. `lastStopId` keeps today's meaning, the stop a following focus may rest on: the newest pending row, else the last cursor row's stop. That stop is an open run's line for a run, and the last block for an entry with blocks. Update its comment.
- The whole `focusAfterChange` rule, in order:
  1. Listed and not following: keep the stop.
  2. Listed, following, and on `lastStopId`: keep the stop. A following focus on an open last run's line stays on it.
  3. Listed and following otherwise: `focusLatest(ids.at(-1))`. A following focus on the last step of an open run stays on it through a redraw, and one on a middle step moves to the last step.
  4. Not listed and not following, with stops of the same entry listed: when the old stop has no block suffix, the entry gained blocks, so move to its first listed stop. When the old stop has a block suffix, the entry lost blocks, so move to its last listed stop.
  5. Otherwise: `focusLatest(lastStopId)`.
- `entryIdOfStop` removes a trailing `#<digits>` only, so an entry id that holds another `#` stays whole.
- A "message" is a `user` or `assistant` entry. The caller passes `messageIds` in list order.
- `moveToMessage` sets `following` to whether the target is the last id. From a null cursor, step 1 goes to the first message and step -1 changes nothing.
- `moveToMessage` from a stop outside a message: step to the next message in list order after that stop, or the previous one before it. At the first or last message the focus does not change.
- `K` inside a message goes to the first stop of the previous message, not to the first stop of the current message.
- No function reads the DOM.

GIVEN ids `a#0 a#1 b#0 c#0` and an anchor on `a#1` with the cursor on `c#0` WHEN `rangeStops` runs THEN it returns `a#1 b#0 c#0`
GIVEN the same ids and an anchor on `c#0` with the cursor on `a#1` WHEN `rangeStops` runs THEN it returns the same list order
GIVEN messages `a b` and stops `a#0 a#1 n1 b#0` WHEN `moveToMessage` runs with step 1 from `n1` THEN the cursor is `b#0`, and with step -1 from `n1` THEN the cursor is `a#0`
GIVEN a cursor on `a#3` and an entry that now holds `a#0 a#1` WHEN `focusAfterChange` runs THEN the cursor is `a#1`
GIVEN a following focus on an open run's last step WHEN a redraw leaves that step last THEN the focus stays on it
GIVEN a following focus on an open run's line WHEN `lastStopId` is that line THEN the focus stays on it
GIVEN a following focus on an open run's middle step WHEN a redraw runs THEN the focus moves to the last step
GIVEN a cursor on `a1` with no blocks and an entry that now holds `a1#0 a1#1` WHEN `focusAfterChange` runs THEN the cursor is `a1#0`
GIVEN an anchor WHEN `focusFirst` or `focusLatest` runs THEN the anchor stays
GIVEN stops where `current` is hidden and the next two are hidden WHEN `nearestVisibleStop` runs with direction 1 THEN it returns the third stop, and it returns the previous visible stop when none follows

Tests:     add `it.each` tables to `entry-focus.test.ts`, one per new function; change the `focusAfterChange` row `onLine` for a focus on the last step to stay on that step; keep the row for a focus on the run line; add the other `focusAfterChange` rows above; add `anchorId: null` to each focus literal.
Done when: `entry-focus.ts` and its test compile alone. `entry-list.ts` does not compile until task 03 lands; `wigley:make` may land both in one series. The test gate runs `entry-focus.test.ts`.
Commit:    one commit for the group

## Proof

