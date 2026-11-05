# 04 — List picker headings

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/shared/page/list-picker.ts` · modify `src/shared/page/list-picker.css` · test `src/shared/page/list-picker.test.ts`
Consumes:  none
Produces:  `section?(item: T): string | null` on `ListPickerRequest<T>` in `src/shared/page/list-picker.ts`
           `drawHeading?(parent: HTMLElement, title: string): DrawnPickerRow` (`parent` is the heading's `li`) on `ListPickerRequest<T>` in `src/shared/page/list-picker.ts`
Decisions: a heading is not an item, so the cursor, `cursorIndex` and `list-picker-state.ts` do not change and the cursor cannot land on one · headings hide while a filter is typed, because a filter ranks across the groups · the caller keeps a section's items together; the picker does not sort

`draw` does this, only when the trimmed filter is empty:

- Before each row, it reads `section(item)`.
- When the value is not null and differs from the previous drawn row's value, it appends a heading first. The first row's previous value is null. A null value counts as a value, so A, null, A draws two A headings.
- The picker appends an `li` with class `ui-picker-heading`, so the list holds only `li` children. `drawHeading` draws inside that `li`. With no `drawHeading`, the title is the `li`'s text.
- A heading has no click. Its `mousedown` takes no focus.

`disposeRows` also disposes each heading's draw. `redrawRow` keeps its place, because it inserts before the next element, heading or row. A request with no `section` draws as it does today.

GIVEN items in sections A, A, B WHEN the list draws THEN the order is heading A, row, row, heading B, row
GIVEN that list WHEN `down` moves over the section edge THEN the cursor moves to the next item and `cursorIndex` gives its item index
GIVEN that list WHEN a filter is typed THEN no heading draws, and clearing the filter draws them again
GIVEN `section` returns null for every item WHEN the list draws THEN no heading draws
GIVEN sections A, null, A WHEN the list draws THEN the order is heading A, row, row, heading A, row
Tests:     add to `list-picker.test.ts`: `open_Sections_DrawsHeadingsAtEachEdge`, `down_OverAHeading_MovesToNextItem`, `filter_Typed_HidesHeadings`, `open_NullSections_DrawsNoHeadings` (rows: all null; A, null, A), `redraw_DrawnHeading_DisposesItsDraw`
Done when: compiles; lint and the style check pass; the test gate runs the tests above
Commit:    one commit for the group

## Proof

