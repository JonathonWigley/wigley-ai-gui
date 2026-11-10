# 03 — Sessions split picker rows

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/sessions/layouts/layout.d.ts` · modify `src/plugins/sessions/layouts/default/layout.js` ·
           modify `src/plugins/sessions/page/layout/sessions-parts.ts` ·
           modify `src/plugins/sessions/page/layout/read-sessions-layout.ts` ·
           modify `src/plugins/sessions/page/sessions-view.ts` · modify `src/plugins/sessions/page/sidebar-view.ts` ·
           modify `src/plugins/sessions/page/start.ts` ·
           test `src/plugins/sessions/page/layout/sessions-parts.test.ts` · test `src/plugins/sessions/page/start.test.ts`
Consumes:  `ListPickerRequest.drawRow?(parent, item, input: DrawRowInput): DrawnPickerRow` and `ListPicker.redraw()`
           (tree, `src/contracts/list-picker.ts`) · `shownTitle`, `titleLimit` (tree, `src/plugins/sessions/session-title.ts`) ·
           `harnessText` (tree, `src/plugins/sessions/page/tabs.ts`) · `PluginPartHarness.showLayouts` and
           `withUser` (tree, test support)
Produces:  in `src/plugins/sessions/layouts/layout.d.ts`:
           `export interface ActivityInput { word: string; tone: DotStatus; emphasis: 'raised' | 'urgent' | null }`
           (`SessionRowInput.activity` becomes `ActivityInput | null`, the same members)
           `export type PickerItemInput = { kind: 'session'; sessionId: string; title: string | null; label: string; project: string; harness: string; activity: ActivityInput | null } | { kind: 'new' };`
           `export interface PickerRowInput { item: PickerItemInput; label: string }`
           `export interface PickerRowKit extends SessionsKit { trailing(): HTMLElement | null }`
           `Layout` gains `pickerRow?(parent: HTMLElement, input: PickerRowInput, kit: PickerRowKit): SessionsPart`
           in `src/plugins/sessions/page/layout/sessions-parts.ts`:
           `SessionsParts.pickerRow(parent: HTMLElement, input: PickerRowInput, trailing: HTMLElement | null): DrawnPart<SessionsPart>`
           in `src/plugins/sessions/page/sessions-view.ts`:
           `SessionsView.pickerItem(row: SessionRow): PickerItemInput` (always the `session` variant);
           `SessionsView.parts` becomes `Pick<SessionsParts, 'renameDialog' | 'pickerRow'>`
           in `src/plugins/sessions/page/sidebar-view.ts`:
           `export function activityInput(activity: RowActivity | null): ActivityInput | null` (`RowActivity` from
           `src/plugins/sessions/contract.ts`)
Decisions: the input says session or New session, and the kit hands `trailing`, mirroring chat's `pickerRow`
           (round 1 notice) · the part name is `pickerRow`, as chat, docs, backlog, notes and settings name it · the part
           returns `SessionsPart`, as every sessions part does · a session item carries what its side-bar row shows:
           the shown title, the folder label, the project, the harness and the top activity (this task) · `default`
           draws the row as the built-in picker row looks today: `label` alone (this task)
GIVEN the split picker open WHEN it draws its rows THEN each row draws through the sessions layout's `pickerRow`, a
      session row with `item.kind` `session`, the last row with `item.kind` `new` when `chat.newSession` is a command
GIVEN the split picker open WHEN the sessions layouts change THEN the picker draws its rows again with the new layout
GIVEN a cursor row WHEN `pickerRow` draws it THEN `kit.trailing()` returns the picker's trailing element; the picker
      appends it when the layout leaves it out
Tests:     `pickerRow_Draw_HandsTheItemAndTrailing ($case)` (new `it.each`, `sessions-parts.test.ts`) — a user layout
           `mine` whose `pickerRow` records each input and calls `kit.trailing()` once. Rows: a session item (title
           `Fix toasts`, label `gamma 2`, project `gamma`, harness `Claude Code`, activity `{ word: 'running', tone:
           'running', emphasis: null }`) with a trailing `FakeElement` → the recorded input equals the input given and
           `kit.trailing()` returned that element; the `new` item (label `New session`) with trailing null →
           `kit.trailing()` returned null. Every row: the root carries `data-layout="mine"` and
           `data-layout-owner="sessions"`.
           `splitPicker_LayoutsChange_RedrawsTheOpenRows` (new, `start.test.ts`) — start with sessions `s1`, `s2` and
           `chat.newSession` known; one pane shows `s1`; run `splitRight`. The picker's rows are drawn by `default`
           (`data-layout="default"`, `data-layout-owner="sessions"`), their item kinds `['session', 'new']` and the
           session row's text `s2`'s label. Then `setup.harness.showLayouts(withUser<Layout>(defaultLayout, {
           pickerRow }))` with a `pickerRow` that draws `li.mine-row`: the open picker's rows are now `li.mine-row`
           with `data-layout="mine"`, and the picker stays open.
           No row in `readSessionsLayout_BadShape_ThrowsNamingIt`: the reader's `Record<keyof Layout, true>` fails to
           compile without `pickerRow`, and the shape rule does not change.
Done when: `npm run lint` and the typecheck pass; the test gate runs the tests above, the existing
           `sessions-parts.test.ts`, `read-sessions-layout.test.ts`, `sessions-view.test.ts`, `start.test.ts` and `src/shared/layouts/layout-contracts.test.ts`. Live check: task 15.
Commit:    one commit for the group: `src/plugins/sessions/layouts/layout.d.ts`
           `src/plugins/sessions/layouts/default/layout.js` `src/plugins/sessions/page/layout/sessions-parts.ts`
           `src/plugins/sessions/page/layout/sessions-parts.test.ts`
           `src/plugins/sessions/page/layout/read-sessions-layout.ts` `src/plugins/sessions/page/sessions-view.ts`
           `src/plugins/sessions/page/sidebar-view.ts` `src/plugins/sessions/page/start.ts`
           `src/plugins/sessions/page/start.test.ts`

## Approach

- **Contract** (`layout.d.ts`).
  - Move the inline type of `SessionRowInput.activity` into `ActivityInput`; `SessionRowInput.activity` becomes
    `ActivityInput | null`. The members do not change.
  - Add `PickerItemInput`, `PickerRowInput`, `PickerRowKit` and the `pickerRow` part, after `renameDialog`. Comments:
    `PickerItemInput` is one choice of the split picker (`Show session`): a session no pane shows, with what its side-bar
    row shows (`title` as the row shows it, null for none; `label` the folder label; `project`; `harness`, '' for none;
    `activity` its top activity, null for none), or `new`, the New session row, listed last when chat can start a
    session. `PickerRowInput.label` is the line the picker filters on and the row's tooltip shows: the session's
    folder label, or `New session`. `PickerRowKit.trailing()`: the app's element for the end of the cursor row, or
    null; pass it as `KitRowOptions.trailing`. The `pickerRow` part comment: one row of the split picker, drawn through
    `kit.row(parent, { density: 'list', tag: 'li', … })`.
  - In the header comment's "The app keeps" list, add: the list picker sets `title`, `is-selected`, `is-cursor` and the
    click on a `pickerRow` root, and appends `trailing` when the row leaves it out. In § Dialogs of the header, add one
    sentence: `pickerRow` draws each row of the split picker each time the picker draws its rows, and again when the
    layouts change while it is open.
- **Default** (`default/layout.js`). `pickerRow(parent, input, kit)` returns `{ element: kit.row(parent, { density:
  'list', tag: 'li', label: input.label, trailing: kit.trailing() }) }`, which is what the list picker's built-in row
  draws today. No CSS rule is added: the row keeps the kit row's look.
- **Reader** (`read-sessions-layout.ts`). Add `pickerRow: true` to `LAYOUT_PARTS`.
- **Parts** (`sessions-parts.ts`). Add `pickerRow(parent, input, trailing)`: `parts.draw('pickerRow', parent, …)` with
  kit `{ ...sessionsKit(rollback), trailing: () => trailing }`, returning the builder's part. Add its line to the
  `SessionsParts` comment: `trailing` is the picker's element for the cursor row's end, null on other rows.
- **Activity helper** (`sidebar-view.ts`). Move the `activity` mapping from `drawRow`'s input (`word`, `tone`,
  `emphasis ?? null`) into an exported `activityInput(activity)`, and call it from `drawRow`.
- **View** (`sessions-view.ts`). Add `pickerItem(row)`: `{ kind: 'session', sessionId: row.sessionId, title:
  shownTitle(row.titles, titleLimit(deps.titleMaxLength())), label: row.label, project: row.project, harness:
  harnessText(row.harness), activity: activityInput(activities.top(row.sessionId)) }` — the same values the side-bar
  row draws for that session. Widen `parts` to `Pick<SessionsParts, 'renameDialog' | 'pickerRow'>`. Add one sentence
  for `pickerItem` to the `SessionsView` comment.
- **Picker** (`start.ts`).
  - Move `const picker = api.services.picker.create({ filter: true })` above the `api.layouts.show` call, so the
    `setLayouts` callback never reads `picker` before it is made.
  - In `setLayouts`, after `renameDialog.redraw()`, call `picker.redraw()` (it does nothing while the picker is closed).
  - In `openSplitPicker`'s `picker.open` request, add `drawRow(list, choice, input)`: draw
    `view.parts.pickerRow(list, { item: choice.kind === 'row' ? view.pickerItem(choice.row) : { kind: 'new' }, label:
    input.label }, input.trailing)` and return `{ element: drawn.built.element, dispose: drawn.dispose }`, as backlog's
    `drawPickerRow` does. `label`, `chosen` and `cancelled` do not change.
- No doc edit: the sessions Adopters row in `docs/features/layouts/design.md` was written ahead. Ticking the master-plan
  box and removing the follow-up ride in task 10.

## Proof

