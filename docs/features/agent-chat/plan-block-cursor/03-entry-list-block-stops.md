# 03 — Entry list block stops

Status: done
Type: Task
Wave: 2 · Depends on: 01, 02
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/page/entry-list.ts` · modify `src/plugins/chat/page/activity-runs.ts` · modify `src/plugins/chat/page/chat.css` · modify `src/shared/page/test-dom.ts` · test `src/plugins/chat/page/entry-list.test.ts` · test `src/plugins/chat/page/activity-runs.test.ts`
Consumes:  `data-md-lines` ← 01 · every `entry-focus.ts` name in 02
Produces, on `EntryList` in `entry-list.ts`:

- `moveToMessage(step: 1 | -1): EntryListStop | null` — the focused stop after the move, unchanged at the first or last message; null only with no stops
- `toggleRange(): void`
- `cancelRange(): boolean` — true when a range was open
- `selectedSource(): { text: string; blockCount: number } | null`
- `focusedBlock(): HTMLElement | null` — the cursor's block element, null on a stop with no blocks

Decisions:

**Stops**

- A slot's blocks are `slot.element.querySelectorAll('[data-md-lines]')`, in document order, for `user` and `assistant` entries only. Other kinds have no blocks.
- Read the blocks after each build and each redraw of that slot only, and hold them on the `Slot`. Do not query every slot in `changed()`: `put` runs per streamed chunk.
- `cursorStops` in `activity-runs.ts` already skips dividers through `isCursorRow`. It takes a new parameter `blockCounts: ReadonlyMap<string, number>` and lists `blockStopId(id, n)` for each block of an entry with a count above 0, else the entry's id.
- `lastStopId` keeps its meaning under task 02: the newest pending row, else the last cursor row's stop. `lastRowId` returns the last block's stop for an entry with blocks.
- `moveToMessage` builds `messageIds` from the `user` and `assistant` entries of `rows`.
- `first()` and `latest()` pass the current `anchorId` to `focusFirst` and `focusLatest`.

**Marks**

- `drawFocus` draws `is-cursor` on the block when the stop is a block, else on the slot.
- Draw `is-range` on each element of `rangeStops` while `anchorId` is not null.
- Hold the elements that carry marks, and clear those. Do not sweep every block on each draw.
- In `chat.css`, the selectors for `.chat-entry-slot.is-cursor` and the box-focused and at-stop rules also match `[data-md-lines].is-cursor`. `is-range` uses `background: var(--wg-accent-tint)`.

**Moves and keys' support**

- `focused()` keeps its return type and returns the entry that holds a block stop.
- `focusedElement()` returns the slot of that entry, as today. `Enter` and the visual plugin depend on this.
- `scrollIntoView({ block: 'nearest' })` runs on the block element for a block stop.

**Scroll**

- In `onListScroll`, while the list is shown, read the visible band: the list's client rect, less the computed `scrollPaddingBottom` at the bottom edge.
- A stop is visible when its element's rect overlaps the band. A block taller than the band stays the cursor while it overlaps.
- Call `nearestVisibleStop`. The direction comes from the change in `scrollTop` since the last event. Hold the last value, starting from the list's `scrollTop` at creation. An unchanged `scrollTop` leaves the focus alone.
- On a non-null result, set the focus with `focusStop`, then set `following` to `isScrolledToEnd(list, 1)`, the value `focusAfterScrollEvent` gives. A list at the bottom keeps following.
- Add the `drawFocus` mode `'marks'`: it draws the marks and does not touch the scroll. The scroll rule and the click rule use it.
- A hidden list (`clientHeight === 0`) does nothing.

**Click**

- One `click` listener on `list`. Remove it in `dispose`.
- Do nothing when `window.getSelection()` is not collapsed, or when `event.target` is inside `a, button, summary, input, textarea, .md-fence`.
- Find the nearest `[data-md-lines]` of the target and its stop id. With none, use the id of the nearest slot.
- When that id is not in `order`, do nothing. This covers a divider, the padding of an entry with blocks, and a pending row that its own click handler removed.
- Otherwise call `focusStop` and draw with `'marks'`. A slot's own click handler still runs first, as the event bubbles to the list.

**Copy**

- `selectedSource` reads `rangeStops`. For a block stop: take the lines `[start, end)` of the entry's `text`, and remove trailing blank lines. For a stop with no blocks: a `user`, `assistant` or `notice` entry gives its `text`, and a pending row gives its message `text`. Every other stop (`activity`, `permission`, `thinking`, `tool`, `raw`) gives nothing.
- A user layout may draw other text. When a block's `end` is past the entry's line count, the entry gives its whole `text`, once.
- Join the parts with `\n\n`. `blockCount` counts the parts. Return null when no part remains.
- A pure helper `sourceOfLines(text: string, start: number, end: number): string` holds the slice.

**Comments**

- Rewrite the header comment of `EntryList` so that it states the block stops, the range, the scroll rule and the click rule. Update the member comments of `move`, `isAtLastStop`, `latest`, `first`, `focused` and `focusedElement`.

GIVEN entries user, assistant with three blocks, result, notice WHEN the list builds THEN the stops are `u#0 a#0 a#1 a#2 n` and no stop names the result
GIVEN a streaming assistant and a following focus WHEN a redraw adds a block THEN the focus is on the new last block
GIVEN an anchor on `a#0` and a cursor on `a#2` WHEN `selectedSource` runs THEN the text is the three blocks' source joined by one blank line, and `blockCount` is 3
GIVEN a fence block WHEN `selectedSource` runs THEN the text holds both fence lines
GIVEN a cursor block above the band WHEN the list scrolls down THEN the cursor moves to the first visible stop below it
GIVEN a non-collapsed selection WHEN the list gets a click THEN the cursor does not move
GIVEN a click inside a link WHEN the list gets it THEN the cursor does not move
GIVEN a click on a block WHEN the list has scrolled up from the bottom THEN the cursor moves and `scrollTop` does not change
GIVEN a click on a divider or a removed pending row WHEN the list gets it THEN the cursor does not move
GIVEN a scroll that lands on the bottom WHEN the cursor moves to a visible stop THEN the list still follows

Tests:     update the `hidden_ActivityNotInTranscript` rows in `entry-list.test.ts`: `result` and `compaction` slots remain, their stops go. Add rows to `cursorStops` in `activity-runs.test.ts` for `blockCounts` and skipped dividers. Add tests to `entry-list.test.ts` for the GIVENs above, one `it.each` per rule. Extend `test-dom.ts`: an attribute selector in `querySelectorAll`, `closest`, and a fake `getSelection`. `innerHTML` does not parse there, so a test layout's assistant builder appends one `div` with `data-md-lines` per paragraph of `input.text`. State the scroll GIVEN with the `rectTop` fake already in `entry-list.test.ts`.
Done when: compiles; the test gate runs the tests above.
Commit:    one commit for the group

## Proof

Commit 5788fdcf · proof: diff read, all Produces present, 104 filtered tests pass, typecheck clean; chat.css staged by hunk past a peer's edits · concerns: pullBack is async, so a click on a pending row moves the cursor onto it and the row's removal then follows the latest stop, and pending_ClickRow_PullsBackWithoutMovingTheCursor only passes because the fake click does not bubble; rectTop lives in test-dom.ts not entry-list.test.ts; SourceLineFakeElement's selector now duplicates the base fake
