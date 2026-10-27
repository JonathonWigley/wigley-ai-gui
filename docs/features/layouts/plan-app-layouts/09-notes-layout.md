# 09 — Notes layout

Status: in progress
Type: Task
Wave: 2 · Depends on: 02
Plan: [plan.md](plan.md)

The note popup draws through a notes layout: its field rows and their values, the image entries, the action
buttons, the discard confirmation, the markup toolbar and the rows of its list picker. The markup editor and the
picker's panel stay app-owned.

Files:
- create `src/plugins/notes/layouts/layout.d.ts` — the notes Layout contract
- create `src/plugins/notes/layouts/default/layout.js` — the built-in `default` layout, `// @ts-check`
- create `src/plugins/notes/page/layout/read-notes-layout.ts` · test `read-notes-layout.test.ts`
- create `src/plugins/notes/page/layout/notes-parts.ts` — the kits and the part drawing over the host ·
  test `notes-parts.test.ts`
- modify `src/plugins/notes/page/popup.ts`, `src/plugins/notes/page/markup-view.ts`, `src/plugins/notes/page/start.ts`
- modify `src/plugins/notes/main/start.ts`, `src/plugins/notes/manifest.ts`

Consumes (← 02, names as `02-layout-core.md` § Produces writes them):
- main `api.layouts.register(options: { layoutTypes: string }): Disposable`
- page `api.layouts.show<L>(options: ShowLayoutOptions<L>): LayoutShow`, `ShownLayouts<L>`, `LayoutShow`; the show
  refreshes on a change of notes' settings by itself
- `readLayoutModule(module: unknown, name: string): Record<string, unknown>`, `isRecord`
- `drawPart<L extends object, B, R extends { element: HTMLElement }>(options: DrawPartOptions<L, B, R>):
  { built: R; layoutName: string; dispose(): void }`, whose options take `owner: LayoutOwner` (required, `'notes'`) and whose
  `build(builder, parent, rollback: RollbackDeps): R` gets a fresh recorder for each attempt; `RollbackDeps`,
  `requireElementIn(parent, element, partName)`. `drawPart` sets `data-layout` and `data-layout-owner` on each part
  root and logs a throwing part once per layout object and part. `dispose` disposes every anchor and box recorded
  through the successful attempt's `rollback`, once.
- `pickLayout<L>(chain, layouts, defines): PartPick<L>`
- `createBaseKit(deps: BaseKitDeps): BaseKit`, `BaseKitDeps` (`keys.keysFor` returns `string | null`; `scope` is a
  qualified scope, or null), `KitCommands { exists(id): boolean; run(id): void }`,
  `commandRunner(qualifiedId, commands): () => void`
- `BaseKit` (`keyHint(parent, command, options?: { className?, label? })`, `statusDot`, `setDotStatus`, `row`,
  `emptyState`, `keyPrompt`) and `KitRowOptions`, imported in the repo's `layout.d.ts` as
  `import type { BaseKit, KitRowOptions } from '../../../shared/page/layout-host/kit';`. The registry rewrites that
  specifier to `'../kit'` in the user's copy.
- the list picker's `drawRow?(parent, item, { label, trailing, recordAnchor })` and `redraw()` (`src/shared/page/list-picker.ts`);
  only 02 edits that file
- the `LAYERS` entries for `src/plugins/notes/layouts` and its use from `notes/main` and `notes/page` (02)

Produces:
- in `layouts/layout.d.ts`:
  - `export type NoteField = 'target' | 'title' | 'body' | 'tags' | 'images' | 'session'`
  - `export type NoteAction = 'discard' | 'appendFollowup' | 'sendSession' | 'sendFollowup'`
  - `export type ConfirmAction = 'confirmNo' | 'confirmYes'`
  - `export type MarkupTool = 'select' | 'pen' | 'text' | 'arrow' | 'box'`
  - `export type MarkupColour = 'red' | 'yellow' | 'green' | 'blue'`
  - `export type MarkupCommand = 'undo' | 'redo' | 'closeMarkup'`
  - `export interface NoteRowInput { field: NoteField; label: string }`
  - `export interface TargetInput { text: string | null }` — the home label, or null for no target
  - `export interface TagsInput { tags: string[] }`
  - `export interface ImagesInput { count: number }`
  - `export interface NoteImageInput { position: number; src: string; alt: string; hasMarkup: boolean;
    isSelected: boolean }` — `position` counts from 1: 1 is the first image, as in the alt text `Image <n>` and in
    `MarkupView.open(id, pos)`
  - `export interface SessionInput { text: string | null }` — `sessionChipText`, or null for no session
  - `export interface NotesPart { element: HTMLElement }`
  - `export interface NotesKit extends BaseKit {}`
  - `export interface RowKit extends NotesKit { valueSlot(parent: HTMLElement): HTMLElement;
    pickHint(parent: HTMLElement): HTMLElement }`
  - `export interface ImagesKit extends NotesKit { image(parent: HTMLElement, position: number): HTMLElement }` —
    `position` counts from 1, as in `NoteImageInput`
  - `export interface ImageKit extends NotesKit { removeButton(parent: HTMLElement): HTMLButtonElement }`
  - `export interface SessionKit extends NotesKit { sessionChip(parent: HTMLElement, text: string): HTMLElement;
    removeButton(parent: HTMLElement): HTMLButtonElement }`
  - `export interface ActionsKit extends NotesKit { actionButton(parent: HTMLElement, action: NoteAction):
    HTMLButtonElement }`
  - `export interface ConfirmKit extends NotesKit { actionButton(parent: HTMLElement, action: ConfirmAction):
    HTMLButtonElement }`
  - `export interface PickerRowInput { picker: 'Target' | 'Tags' | 'Session' | 'Follow-up'; label: string }` — the
    open picker's title and the row's line
  - `export interface PickerRowKit extends NotesKit { trailing(): HTMLElement | null }` — the app's element for the
    end of the cursor row, or null on every other row; pass it as `KitRowOptions.trailing`
  - `export interface MarkupKit extends NotesKit { toolButton(parent: HTMLElement, tool: MarkupTool):
    HTMLButtonElement; colourButton(parent: HTMLElement, colour: MarkupColour): HTMLButtonElement;
    colourKeys(parent: HTMLElement): HTMLElement; commandButton(parent: HTMLElement, command: MarkupCommand):
    HTMLButtonElement }`
  - `export interface Layout { row?(parent: HTMLElement, input: NoteRowInput, kit: RowKit): NotesPart;
    target?(parent: HTMLElement, input: TargetInput, kit: NotesKit): NotesPart;
    tags?(parent: HTMLElement, input: TagsInput, kit: NotesKit): NotesPart;
    images?(parent: HTMLElement, input: ImagesInput, kit: ImagesKit): NotesPart;
    image?(parent: HTMLElement, input: NoteImageInput, kit: ImageKit): NotesPart;
    session?(parent: HTMLElement, input: SessionInput, kit: SessionKit): NotesPart;
    actions?(parent: HTMLElement, kit: ActionsKit): NotesPart;
    confirm?(parent: HTMLElement, kit: ConfirmKit): NotesPart;
    markupToolbar?(parent: HTMLElement, kit: MarkupKit): NotesPart;
    pickerRow?(parent: HTMLElement, input: PickerRowInput, kit: PickerRowKit): NotesPart }`
  - `export interface CompleteLayout extends Required<Layout> {}`
- `export function readNotesLayout(module: unknown, name: string): Layout` in `read-notes-layout.ts`
- a `setLayouts(shown: ShownLayouts<Layout>): void` member on the value `createNotePopup` returns, and on
  `MarkupView` in `markup-view.ts`. `createNotePopup` today returns the command record; it returns
  `{ commands: Record<NotesPageCommand, () => void>; setLayouts(shown: ShownLayouts<Layout>): void }` after.
- manifest setting `layout`

Decisions:
- **Parts, from the code:**
  - `row` — one per field in `NOTE_FIELDS` order (`popup.ts` § Rows): the label, the value slot, the pick keys.
  - `target`, `tags`, `session` — the value of their row (`drawTarget`, `drawTags`, `drawSession`), with the quiet
    text `No target`, `No tags`, `No session` when empty.
  - `images` — the strip in the images row (`drawImages`), and the quiet text `No images` when `count` is 0.
  - `image` — one per held image (`div.notes-image`): thumbnail, markup pen mark, remove button.
  - `actions` — the popup's buttons in `dialog.actions` (`POPUP_ACTIONS`).
  - `confirm` — the discard confirmation's body text and buttons (`CONFIRM_ACTIONS`). The confirmation dialog is
    notes' own `createDialog`, so its content is a notes part.
  - `markupToolbar` — the markup view's toolbar (`createMarkupView`): tool buttons, colour buttons and their keys,
    Undo, Redo, Done.
  - `pickerRow` — one row of the notes list picker (the Target, Tags, Session and Follow-up lists the `pick` helper
    opens), drawn through the picker's `drawRow` hook.
- **App-owned, not parts:** the dialog frames and titles (`createDialog('Note')`, `createDialog('Discard this
  note?')`); the title box and the body editor with their input frames and box hints; the markup editor host
  (`notes-markup-host`) and the Fabric adapter; the cursor prompt (`editBox`, `remove` hints), which the app moves to
  the selected row's element; `is-cursor` on row elements; `is-box-focused` on the fields container; the fields
  container and its show and hide against the markup view; the picker's panel, title, filter (with its
  `headerEnd` filter hint), cursor and lifecycle (`createListPicker`, a shared module).
- **The list picker's rows:** the `pick` helper in `popup.ts` is the one place that opens the picker. Its
  `picker.open` passes `drawRow: (list, item, { label, trailing, recordAnchor }) =>` a `drawPart` of `pickerRow` into `list` with
  input `{ picker: title, label }` and a kit whose `trailing()` returns `trailing` and whose key anchor calls hand
  each anchor to `recordAnchor`; `drawRow` returns the built element. The picker sets `title`, `is-selected`, `is-cursor` and the click on the row root, so the row gives
  `kit.row` no `onClick`; a `trailing` the row leaves out the app appends at the end of the row root. The picker
  disposes the recorded anchors before each draw pass and when it closes, so the popup tracks no row anchor.
- **Value slots:** `kit.valueSlot(parent)` appends `div.notes-row-value` and returns it. A row that leaves it out
  gets one appended at the row's end. The app fills each slot: the title row with the title frame, the body row
  with the body frame, the other rows with their value part. `notes-row-value--one-line` stays on the session
  slot, set by the app.
- **Pick keys:** `kit.pickHint(parent)` anchors the row's `ROW_COMMANDS` command with label `pick` in scope
  `notes.popup`. For a field with no command it appends an empty `span`.
- **Where the dialog parts draw:** `confirm` draws into `confirm.body`, as task 14 does for chat's dialogs. The app
  leaves `confirm.actions` empty. The `default` `confirm` draws the text `p.notes-confirm-text` and then the buttons in
  a `div.ui-dialog-actions` through `kit.actionButton`, so the look stays the same. `actions` draws into
  `dialog.actions` of the Note dialog. `markupToolbar` draws into the app-owned `div.notes-markup-toolbar`
  (`createMarkupView`), before `notes-markup-host`.
- **Buttons the layout leaves out are appended:** after `actions`, `confirm` and `markupToolbar` draw, the app
  appends each button of that part the layout did not draw, in today's order, at the end of the part's element. So
  every command keeps a placed anchor. `markupToolbar` does the same for `colourKeys`. The app appends them inside
  `build`, after the part returns, so their anchors go into the same attempt's `rollback` as the rest of the part.
- **Kit buttons keep themselves up to date:** each `toolButton` and `colourButton` registers with the markup view,
  and `markActive` toggles `is-active` on every registered button. `actionButton` draws today's label, variant and
  hint stack (`actionHint`), and runs `notes.<action>` on click. `removeButton` on an image runs
  `removeImageAt(position - 1)` (`removeImageAt` counts from 0); on the session it runs `removeSession`.
  `sessionChip` runs `notes.pickSession` on click.
- **Scopes:** the app makes one BaseKit per part draw. Its qualified `scope` is `notes.popup` for rows, values,
  images and actions; `notes.confirm` for `confirm`; `notes.markup` for `markupToolbar`; `notes.picker` for
  `pickerRow`. `commandNamed(short)` returns `qualify('notes', short)` when `short` is a key of
  `notesManifest.commands`, else null. The kit records each anchor through the `rollback` that `drawPart` hands to
  `build` for that attempt.
- **Disposing a part on a redraw:** the popup keeps the `dispose` of each part's last draw: one per row, per value
  slot, per image, and one each for `images`, `actions`, `confirm` and `markupToolbar`. It calls that `dispose` before
  it draws the same part again (a changed value in `render`, every part on `setLayouts`) and before it drops the
  part's element. So a part that calls `kit.keyHint` holds one anchor however often it draws. Each `markupToolbar`
  draw also replaces the markup view's list of registered tool and colour buttons. The popup never calls the
  `dispose` of a `pickerRow` draw: the picker disposes the anchors given to `recordAnchor`.
- **Kit commands:** `page/start.ts` builds `KitCommands` as `{ exists: (id) => api.keys.command(id) !== undefined,
  run: (id) => api.commands.run(id) }` and hands it to the popup for every BaseKit.
- **Pick chain:** `[shown.user, 'default']`. Fallback per part through `drawPart` with `owner` `notes`,
  `logSource` `notes` and `partName` the part's key. A user layout's CSS selects under
  `[data-layout-owner="notes"][data-layout="<name>"]`.
- **Redraw rule stays:** `render` still redraws a value part only when its state changed (typing never rebuilds
  the strip). On `setLayouts` the app clears the `drawn` record, redraws every part, and calls `picker.redraw()`,
  which draws an open picker's rows again and does nothing while it is closed.
- **Reload keeps work:** the title input, the body editor and their frames are made once and never rebuilt. A
  redraw moves the same elements into the new value slots. Before a redraw the app reads which box has focus
  (`focusedBox`) and focuses it again after. The draft lives in the store and in main, so no field, image or
  markup is lost. An open picker keeps its cursor and filter, and only its rows redraw; an open markup session is
  not touched; an open confirmation keeps its scope.
- **`default` layout** reproduces today's look with today's class names (`notes-row`, `notes-row-label`,
  `notes-row-value`, `notes-row-keys`, `notes-empty`, `notes-target`, `notes-strip`, `notes-image`,
  `notes-image-thumbnail`, `notes-image-pen`, `notes-image-remove`, `notes-session`, `notes-confirm-text`,
  `notes-markup-group`, `notes-colour`, `notes-swatch`, `notes-markup-keys`), so `notes.css` keeps working unchanged.
  The confirmation body text stays today's copy, verbatim from `popup.ts`. Its `pickerRow` is
  `kit.row(parent, { density: 'list', tag: 'li', label: input.label, trailing: kit.trailing() })`, the row the
  picker draws today.
- **Main:** `start` imports `../layouts/layout.d.ts?raw`, calls `api.layouts.register({ layoutTypes })` and disposes
  it in `dispose`.
- **Page:** `start` calls `api.layouts.show<Layout>({ defaultLayout, read: readNotesLayout, userLayout: () =>
  api.settings().layout, setLayouts: (shown) => popup.setLayouts(shown) })`. It does not call `refresh()` from
  `onSettingsChanged`: the show refreshes on a change of notes' settings by itself. Before the first set the popup
  draws with `default` alone.
- **Setting:** manifest `settings` adds `layout: 'default'`; `settingInfo.layout`: label `Layout`, description
  `"The notes layout the note popup draws in: a folder name in notes' layouts folder, or default."`

GIVEN a user notes layout whose `image` throws WHEN the popup shows two images THEN both draw with `default`, each
with `data-layout="default"`, and the throw is logged with source `notes`.
GIVEN a user `actions` that draws only Discard WHEN the popup opens THEN Append to follow-up, Start session and Add
follow-up are appended after it, each with its key hint.
GIVEN the body box focused in insert mode with typed text WHEN the notes layout file is saved THEN the body is the
same editor with the same text and has focus again.
GIVEN the Target picker open with typed filter text WHEN a notes layout that defines `pickerRow` is saved THEN the
picker stays open with its filter text, and each visible row carries `data-layout="<name>"`.

Tests:
- `readNotesLayout_BadShape_ThrowsNamingIt` — `it.each` rows: default export missing; not an object; key `fields`
  (no such part); `image: 'x'` (not a function). Each asserts the message names the layout and the key. Catches a
  reader that lets a bad layout reach drawing.
- `notesParts_PartFails_DrawsWithDefault` — `it.each` rows: `row` throws; `image` throws; `confirm` returns an
  element not in `parent`; `pickerRow` throws. Each asserts `data-layout="default"` on the part's root. Catches a missing fallback.
- `notesParts_PieceLeftOut_AppendsIt` — `it.each` rows: `row` without `valueSlot` (a `div.notes-row-value` ends the
  row); `actions` with only `discard` (the other three buttons follow, in order); `confirm` with only its text (No
  and Yes follow, in order, inside the part's element in `confirm.body`); `markupToolbar` with no `colourButton` (four
  colour buttons follow). Catches a lost slot or an unplaced command.
- `notesParts_Redraw_LeavesOneAnchorPerHint` — a recording `anchor` double. A user `target` that calls
  `kit.keyHint` draws, then the target changes and `render` draws it again; then `setLayouts` draws `actions` again.
  Asserts one live anchor for the target's hint and one per action. Catches a redraw that leaks an anchor on each
  state change or reload.
- `notesParts_Relayout_MovesTheSameBoxes` — draw the title and body rows with one layout, then with another, passing
  the same title and body frame elements. Asserts each new value slot holds the same element instance. Catches a
  redraw that rebuilds a box and loses its text.
- `markupView_ToolButtonFromLayout_MarksTheToolInUse` — a user `markupToolbar` draws the tool buttons in a new
  order; after `open` over a fake `MarkupEditor` (the view ignores tool calls until its editor opens),
  `setTool('arrow')` marks only the Arrow button `is-active`. Catches kit buttons the view no longer updates.

Done when: `npm run lint` and the type check pass; the test gate runs the tests above. Runtime and visual checks are
task 17's (Final verification).

Commit: one commit for the group.

## Proof

