# 05 — Chat heading part and section row input

Status: done
Type: Task
Wave: 2 · Depends on: 04
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/layouts/layout.d.ts` · modify `src/plugins/chat/layouts/default/layout.js` · modify `src/plugins/chat/page/read-chat-layout.ts` · modify `src/plugins/chat/page/picker.ts` · test `src/plugins/chat/layouts/default/layout.test.ts`
Consumes:  `section` and `drawHeading` on `ListPickerRequest` ← 04
Produces:  `section?(item: T): string | null` on `PickerRequest<T>` in `src/plugins/chat/page/picker.ts`
           `pickerHeading?(parent: HTMLElement, input: { title: string }, kit: PickerHeadingKit): PartView<{ title: string }>` on the chat Layout contract in `src/plugins/chat/layouts/layout.d.ts`
           this `PickerItemInput` member in `src/plugins/chat/layouts/layout.d.ts`: `{ list: 'folder' | 'session'; kind: 'section'; title: string; detail: string; at: number }`
Decisions: the heading draws through a layout part, because every surface draws through a layout (`AGENTS.md` § Intent) · the title takes the row's label place and the details take the row primitive's `detail`, which is already dim: the user picked this look from a mock (a title in full colour, details dimmed at the row's end) · `picker.ts` has no test file and its fakes would restate the wiring, so task 10's first drive check is the check that `section` and `drawHeading` reach the list

- The default `pickerHeading` calls `kit.sectionHeader(parent, input.title)`, where `parent` is the picker's heading `li`, and returns the element. Set `PickerHeadingKit` to the base kit, as `activity` takes it.
- The default `pickerRow` reads `input.item`. When `kind` is `section`, it passes `label: input.item.title` and `detail: input.item.detail` to `kit.row`. Every other row draws as today.
- `input.label` stays the joined text the filter matches and the tooltip shows.
- `createPicker` passes `section` to the list and passes `drawHeading` that draws `pickerHeading` through `deps.layouts.draw`, as `drawPickerRow` does.

GIVEN a `section` row input WHEN the default `pickerRow` draws THEN the row's label is the title and its detail is `detail`
GIVEN a `new` session row input WHEN the default `pickerRow` draws THEN the row has only its label
GIVEN a title WHEN the default `pickerHeading` draws THEN it appends a section header holding the title
Tests:     add to `layout.test.ts`: `pickerRow_SectionRow_DrawsTitleAndDetail`, `pickerHeading_Default_DrawsTitle`. Add `pickerHeading: true` to the part table in `layout.test.ts` and `read-chat-layout.ts`.
Done when: compiles; lint and the layout contract test pass; the test gate runs the tests above
Commit:    one commit for the group

## Proof

Commit 27b4edd7 · proof: diff read; scoped typecheck clean; layout and layout-contract tests pass · concerns: picker wiring of section and drawHeading has no test, by the task's decision, so drive check 1 of task 10 proves it; the h3 inside the heading li has not been seen on screen; the comment on PickerItemInput rests on task 06's plan text
