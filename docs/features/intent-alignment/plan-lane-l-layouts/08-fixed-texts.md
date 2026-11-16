# 08 — Fixed texts in layout slots

Status: not started
Type: Parallel
Wave: 3 · Depends on: 04, 07
Plan: [plan.md](plan.md)

Today a layout places a slot, and the app writes fixed text or app-built key hints into it. After this task, that
text and those hints are part input, and the layout draws them. The app still decides which prompt actions show and
which status text shows. Task 07 lands first and edits the same contract and default files (`dialogFrame`); keep its
parts as they are. The primer's prompt is task 09's. Ticking master-plan.md and removing the follow-up is task 10's.

## Reference pattern

Consumes: `interface PromptActionInput { command: string; label: string }` in
`src/shared/page/layout-host/kit.d.ts` ← 04. Import it in each owner's `layout.d.ts` from
`'../../../shared/page/layout-host/kit'`, beside `BaseKit`.

**Cursor-row prompt.** The app builds the shown actions as `PromptActionInput[]`, each `command` a qualified id
(`<plugin>.<command>`), each `label` the word the old anchor drew. The layout draws each action with
`kit.keyHint(parent, action.command, { label: action.label, className })` inside one prompt `span` that keeps the old
prompt's class. An empty list draws no prompt span. The app deletes its prompt element, its anchors, its
`hidden`/move code and the kit slot that placed the prompt. A hint's `className` is the one each row names (backlog
`backlog-hint`, notes `notes-hint`); docs, sessions, settings and chat pass none, as their old anchors had none. A CSS
rule whose selector named the old bare hint element is rewritten to match the element `kit.keyHint` draws.

**A layout that leaves the input out.** A user part that draws no prompt or no status shows none: the app no longer
places a prompt or a status for it (`placeIfLeftOut` goes with the slots), as for the primer's columns. Say so in each
owner's `layout.d.ts` comment on the part. No test pins a fallback.

**Comments that go untrue.** Every comment that names a removed slot, prompt element or `cursorEnd` is rewritten to
the new shape, in each owner's `layout.d.ts`, default `layout.js`, parts module and view, and in
`src/contracts/list-picker.ts` (find them with `command grep -rn 'cursorPrompt\|cursorActions\|cursorEnd\|status slot\|placed twice' <owner dirs>`).
A parameter left unused by the deletions (`mountSidebarView`'s and `createTreeView`'s `anchor`, `LeaderMenuDeps.anchor`)
is removed with its callers' argument.

Two shapes, by whether the owner's rows draw again when the cursor moves:

- **Rows that draw again on a cursor move** (backlog, docs, sessions, chat's picker): each row input gains
  `prompt: readonly PromptActionInput[]`, empty on every row but the prompted one.
- **Rows the app keeps across a cursor move** (settings and its Leader menu, notes): the owner gains a
  `cursorPrompt` part with input `{ actions: … }`, drawn into the slot the app already keeps on the cursor row. A
  cursor move draws that small part again and draws no row again, so no row redraw moves an open box or a focused
  text box.

**Scope.** `kit.keyHint` anchors in the scope of the kit that draws it (`base-kit.ts` `keyHint` →
`anchorOptions(deps.scope, …)`), and the core hides an anchor, keeping its space, while its scope is not in force.
So each prompt's kit must be built in the scope the old anchors named; each row below names that scope. A test per
owner asserts the recorded anchor's scope.

**Placement check.** A hint drawn by `kit.keyHint` is an anchor (`deps.keys.anchor`), so the self-test placement
check (AGENTS.md **Key hints**, "Every other bind has an anchor") counts it. One change: the old prompts kept a
hidden hint connected for an action the row did not show, and the check counted it. Now an action draws only on a
row that shows it. For each action in your owner's row, find a step in that owner's
`src/plugins/<id>/main/selftest-script.ts` that puts the cursor on a row showing the action while the page loads. Where
no step does, add one that moves the cursor there. Name the step for each action in the Proof.

**Status text.** The app hands the text as input (`string | null`, null for no status), and the layout draws it and
draws nothing visible for null. The class the old element carried stays on the drawn root, so the self-test's
`.docs-status` selectors (`src/plugins/docs/main/selftest-script.ts` `SCROLLS_ITSELF`,
`src/plugins/forms/main/selftest-script.ts` ~L983) still find it.

**CSS.** A rule for an element the layout now draws moves from the page CSS to the owner's
`layouts/default/layout.css`, unchanged except for selectors that named a removed slot. A rule for a slot the app
keeps stays in the page CSS.

**Every part this task adds** is defined in the owner's `default` layout and added to the owner's reader table.

## Rows

### backlog

Rewritten 2026-11-16 for the rebuilt Backlog page (ai commit `ba762a069`: one table of follow-ups, a review pane, a
chunk strip; plan.md § Decisions, round 2). Line numbers from that day.

Files: modify `src/plugins/backlog/page/backlog-view.ts` · `src/plugins/backlog/layouts/layout.d.ts` ·
`src/plugins/backlog/layouts/default/layout.js` · `src/plugins/backlog/layouts/default/layout.css` ·
`src/plugins/backlog/page/backlog.css` · `src/plugins/backlog/page/layout/read-layout.ts` ·
`src/plugins/backlog/main/selftest-script.ts` (only if a step is missing) · test
`src/plugins/backlog/page/backlog-view.test.ts`.

Produces, in `src/plugins/backlog/layouts/layout.d.ts`:
- `TableRowInput.prompt: readonly PromptActionInput[]`
- `RowKit` loses `cursorActions` (`export interface RowKit extends BacklogKit {}`)
- `export interface TableStatusInput { text: string | null }`
- in `BacklogLayout`, beside `empty`: `tableStatus?(parent: HTMLElement, input: TableStatusInput, kit: BacklogKit): HTMLElement;`
- `TableKit.status` now places `div.backlog-status-slot`, the slot the app draws `tableStatus` into

Decisions:
- **Rows draw again on every render** (`render` → `drawRows`, which empties `rowsList` and draws each visible row), so
  the prompt is row input, as docs' and sessions' are.
- Prompt actions: `cursorCommands(shown)` (`backlog-state.ts`) still decides which show and their order. Each label is
  today's `CURSOR_LABELS` entry (`activate` → `session`, `mark` → `mark`, `addToChunk` → `chunk`, `removeFromChunk`
  → `unchunk`, `startChunk` → `start`, `toggleHeadless` → `headless`, `renameChunk` → `rename`, `toggleCommits` →
  `commits`); each `command` is `backlog.<command>`. The row where `shown.key === state.selectedKey` (today's
  `placeCursorPrompt` target) gets the list; every other row gets `[]`.
- Scope: `tableRow` draws with `kitFor('table', …)`, scope `backlog.table`, the old anchors' scope
  (`anchored(command, 'table', …)`).
- Delete in `backlog-view.ts`: `cursorPrompt`, `cursorHints`, `placeCursorPrompt`, the `actions` parameter of
  `drawRow` with its `actionsSlot` and `placeIfLeftOut`, the `selected` tracking and the per-row
  `backlog-row-actions-slot` element in `drawRows`, and `anchored` once nothing else calls it (grep first).
- **Status, a small part drawn into a slot the app keeps**, as docs' `treeStatus`: a load message can arrive while the
  filter box holds focus, and the `table` pane (filter bar, filter box, rows) must not draw again for it. The `status`
  element becomes `element('div', 'backlog-status-slot')`, still placed by the `table` pane through `TableKit.status`.
  `drawStatus` (~L461) computes the text as today (`state.message ??` `'No features homes found'` when loaded with no
  homes, else null) and, only when it differs from the text last drawn, disposes the last `tableStatus` draw and
  draws `tableStatus` into the slot with `{ text }`. `drawPanes` (a layout change) draws `tableStatus` again with the
  last text after the `table` pane draws. The view's dispose disposes the drawn status part. The first render draws
  it once, with `{ text: null }` when there is no status.
- `read-layout.ts`: `LAYOUT_PARTS` gains `tableStatus: true`. Its kit is `kitFor('table', …)`.
- Default `tableStatus`: `kit.el(parent, 'div', 'backlog-status', input.text ?? '')`, its `title` the same text,
  `hidden` when `input.text` is null. Default `tableRow`: where `kit.cursorActions(row)` sits now (~L202), a
  `span.backlog-row-actions` holding one `kit.keyHint(span, action.command, { label: action.label, className:
  'backlog-hint' })` per action, drawn only when `input.prompt` is not empty. Default `table` keeps `kit.status(root)`.
- CSS: `.backlog-status` and `.backlog-row-actions` move from `backlog.css` to the default `layout.css` (beside its
  `.backlog-table-row .backlog-row-actions` rule); `.ui-row-trailing + .backlog-row-actions-slot > .backlog-row-actions`
  becomes `.ui-row-trailing + .backlog-row-actions`; `.backlog-row-actions-slot` is deleted; `backlog.css` gains
  `.backlog-status-slot { display: contents; }`.
- `layout.d.ts` header comment: the `status` line says the slot is `div.backlog-status-slot`, which the app draws
  `tableStatus` into; the `cursorActions` slot line, its name in the "each place once per draw" list and the line "the
  cursor prompt with no `cursorActions` goes at the end of the row root" go. The parts paragraph names `tableStatus`
  with the parts drawn on every render that changes its text, in scope `backlog.table`, and says each `tableRow` draws
  its prompt from input.

GIVEN a follow-up row selected WHEN the rows draw THEN that row's input `prompt` is its `cursorCommands` in order with
the labels above, every other row's is `[]`, and each drawn hint's anchor has scope `backlog.table`
GIVEN the filter box open and focused WHEN a load message sets `state.message` THEN `tableStatus` draws with that
text, the `table` part does not draw again, and the filter input keeps focus; GIVEN the same text on the next render
THEN `tableStatus` does not draw again

Tests:
- `'a partial layout draws its own rows and default for the rest'` (~L473) — the user `tableRow` drops
  `kit.cursorActions(row)`; the assertions on the slot become: the first user row's recorded input `prompt` is the
  selected row's action list, and no row but the selected one holds a `backlog-row-actions`.
- New `cursorPrompt_SelectedRow_ListsItsActionsInTableScope` — `it.each` over a follow-up in no chunk and one in an
  unstarted chunk, each case's list read from `backlog-state.test.ts`'s `cursorCommands_ByChunkState` table: the
  selected row's `prompt` equals the pinned list with the labels above, each live recorded anchor for a prompt command
  has scope `backlog.table`, and other rows' `prompt` is `[]`.
- New `tableStatus_Changes_DrawOnlyTheStatusPart` — a user `tableStatus` and `table` each counting their calls: no
  homes loaded draws `text: 'No features homes found'`; a second render with the same status adds no `tableStatus`
  call; a `state.message` render draws once more with that message, the `table` count unchanged and the filter input
  still `document.activeElement`; a layout change after it draws the user `tableStatus` with that same text.

### docs

Files: modify `src/plugins/docs/page/tree-view.ts` · `src/plugins/docs/page/layout/docs-parts.ts` ·
`src/plugins/docs/page/layout/read-layout.ts` · `src/plugins/docs/layouts/layout.d.ts` ·
`src/plugins/docs/layouts/default/layout.js` · `src/plugins/docs/layouts/default/layout.css` ·
`src/plugins/docs/page/docs.css` · `src/plugins/docs/main/selftest-script.ts` (only if a step is missing) · test
`src/plugins/docs/page/tree-view.test.ts` · `src/plugins/docs/page/layout/docs-parts.test.ts` ·
`src/plugins/docs/page/layout/read-layout.test.ts`.

Produces, in `src/plugins/docs/layouts/layout.d.ts`:
- `TreeRowInput.prompt: readonly PromptActionInput[]` (`isPrompted` stays: the default marks the row with it)
- `TreeRowKit` loses `cursorPrompt` (`export interface TreeRowKit extends DocsKit {}`)
- `export interface TreeStatusInput { text: string | null }`
- in the docs layout interface, beside `treeLine`:
  `treeStatus?(parent: HTMLElement, input: TreeStatusInput, kit: DocsKit): LayoutPart;`
- `TreePaneKit.status` now places `div.docs-status-slot`, the slot the app draws `treeStatus` into

Decisions:
- Prompt actions: `ALL_PAGES_ROW_ACTIONS` becomes `toggleStar`/`star`, `rename`/`rename`, `trash`/`trash`;
  `WIKI_ROW_ACTIONS` becomes `rename`/`rename`, `trash`/`trash`; each `command` qualified as `docs.<command>`, each
  list typed `readonly PromptActionInput[]`. `rowInput` sets `prompt` to the shown view's list when `isPrompted` is
  true, else `[]`.
- Scope: `treeRow` draws in `docs.tree` (`PART_SCOPES.treeRow: 'tree'`), the old anchors' scope (`scope: 'tree'`).
- Delete in `tree-view.ts`: `rowActionsElement`, `allPagesRowActions`, `wikiRowActions`, the prompt `anchors` array
  and its disposal, and the `cursorPrompt` member built in `drawRow`.
- Status, a small part over an `update` method: `setStatus` fires outside every draw (`docs-view.ts` L1308, 1333,
  1341, 1405). A `treeStatus` part drawn into a slot the app keeps draws again alone: the tree pane, its rows and the
  filter frame stay in place, so the filter box keeps its focus and the rows keep their scroll. An `update` on the
  pane's returned part would make every user `treePane` carry status code, and a user pane without it would show no
  status. The shape is the one `treeLine` already has (`lineSlot`, `drawLine`).
- `tree-view.ts`: the `status` element becomes `element('div', 'docs-status-slot')`, placed by the pane as today.
  `setStatus(text)` stores `text` in `shownStatus`, disposes the drawn status part and draws `treeStatus` into the slot
  with `{ text }`. Where a layout set draws `treeLine` again (~L737–739), draw `treeStatus` again with
  `shownStatus`. The view's dispose disposes the drawn status part. `shownStatus` starts null, drawn once at create.
- `docs-parts.ts`: `PART_SCOPES.treeStatus: 'tree'`. `read-layout.ts`: `treeStatus: true`.
- Default `treeStatus`: `kit.el(parent, 'div', 'docs-status', input.text ?? '')`, its `title` the same text, `hidden`
  when `input.text` is null; returns `{ element }`. Default `treeRow`: where `kit.cursorPrompt(row)` sits now, a
  `span.docs-row-actions` holding one `kit.keyHint` per action, drawn only when `input.prompt` is not empty.
- CSS: `.docs-row-actions`, `.ui-row-trailing + .docs-row-actions` and `.docs-status` move from `docs.css` to the
  default `layout.css`. `docs.css` gains `.docs-status-slot { display: contents; }`.

GIVEN the wiki view with a page row prompted WHEN the rows draw THEN its `prompt` commands are `docs.rename`,
`docs.trash`; GIVEN All pages THEN they are `docs.toggleStar`, `docs.rename`, `docs.trash`; each drawn hint's anchor
has scope `docs.tree`
GIVEN the filter box open and focused WHEN `setStatus('Reading…')` runs THEN `treeStatus` draws with that text, the
`treePane` part does not draw again, and the filter input keeps focus; WHEN `setStatus(null)` runs THEN the drawn
`.docs-status` is hidden

Tests:
- `prompt_PageRowInTheWiki_OffersRenameAndTrashAndNoStar` — reads the prompted row's recorded `prompt` commands
  (`['docs.rename', 'docs.trash']`, then `['docs.toggleStar', 'docs.rename', 'docs.trash']`) instead of the
  `docs-row-actions` children; it also asserts each prompt anchor's scope `docs.tree`.
- New `setStatus_Text_DrawsOnlyTheStatusPart` — `it.each` over `{ text: 'Reading…', hidden: false }` and
  `{ text: null, hidden: true }`: the `.docs-status` text and `hidden`, the `treePane` draw count unchanged, the
  filter input still `document.activeElement`. A third row: set `'Reading…'`, then change the layouts; the new
  layout's `.docs-status` still reads `Reading…`.
- `docs-parts.test.ts` — the row that lists `'docs-status'` (~L114) names `'docs-status-slot'`.
- `read-layout.test.ts` — the reader's part list gains `treeStatus` in the existing table.

### settings (and its Leader menu)

Files: modify `src/plugins/settings/page/settings-view.ts` · `src/plugins/settings/page/row-prompt.ts` ·
`src/plugins/settings/page/row-box.ts` · `src/plugins/settings/page/leader-menu-view.ts` ·
`src/plugins/settings/page/layout/read-layout.ts` · `src/plugins/settings/layouts/layout.d.ts` ·
`src/plugins/settings/layouts/default/layout.js` · `src/plugins/settings/layouts/default/layout.css` ·
`src/plugins/settings/page/settings.css` · `src/plugins/settings/main/selftest-script.ts` (only if a step is
missing) · test `src/plugins/settings/page/settings-view.test.ts` · `src/plugins/settings/page/row-prompt.test.ts` ·
`src/plugins/settings/page/leader-menu-view.test.ts` · `src/plugins/settings/page/layout/read-layout.test.ts`.

Produces:
- in `src/plugins/settings/layouts/layout.d.ts`:
  - `export interface CursorPromptInput { actions: readonly PromptActionInput[] }`
  - `cursorPrompt?(parent: HTMLElement, input: CursorPromptInput, kit: SettingsKit): HTMLElement;`
  - `export interface BoxMessageInput { text: string }`
  - `boxMessage?(parent: HTMLElement, input: BoxMessageInput, kit: SettingsKit): HTMLElement;`
  - `RowKit.rowActions` stays; its comment says the app draws `cursorPrompt` into it while the row is the cursor row
- in `src/plugins/settings/page/row-prompt.ts`: `export function rowPromptActions(actions: RowActions): PromptActionInput[]`
- in `src/plugins/settings/page/row-box.ts`: `RowBoxDeps.drawMessage(parent: HTMLElement, text: string): () => void`
  (draws the message, returns its dispose) and `RowBox.redrawMessage(): void`

Decisions:
- Row prompt actions: `rowPromptActions` keeps its filter and order and returns `{ command, label }`;
  `PROMPT_LABELS` moves from `settings-view.ts` into `row-prompt.ts` (`open` → `reassign`, `edit` → `edit`,
  `addBind` → `add key`, `removeBind` → `clear`, `reset` → `reset`); commands are `settings.<action>`.
- `placeRowPrompt` draws `cursorPrompt` with `{ actions: rowPromptActions(row.actions) }` into the cursor row's
  `actions` slot through `parts.draw`, as `buildEntry` draws an entry, in the scope the row was drawn in (`rows`). It
  keeps the drawn prompt's slot element and actions, and draws again only when either changed (compare each action's
  `command` and `label`). With no cursor row it disposes the drawn prompt. A `drawRows` or `redrawRowsPane` that
  replaces the rows disposes it first, since its slot is gone, and so do `draw(true)` from `setLayouts` and the
  view's dispose. In `LeaderMenuView`, the disposer `drawPrompt` returns runs before each pane redraw (`draw`,
  `redraw`, `reset`, a layout change replacing its row slots), when the menu closes, and on its destroy: no prompt
  anchor outlives its row.
- Leader menu: `GROUP_HINTS` and `ITEM_HINTS` values become `PromptActionInput` with commands qualified as
  `settings.<command>` and the labels they hold now (`ITEM_HINTS` keeps both `changeAction` and `open`, each
  `settings.open`, labelled `change action` and `open`). `placePrompt` draws `cursorPrompt` with the row's `hints`
  in order, into the cursor row's `actions` slot, in the pane's scope (`leaderGroups` or `leaderItems`), with the same
  draw-only-on-change rule. `promptHints`, `groupPrompt` and `itemPrompt` are deleted. `LeaderMenuDeps` gains
  `drawPrompt(parent: HTMLElement, actions: readonly PromptActionInput[], scope: 'leaderGroups' | 'leaderItems'): () => void`,
  which `settings-view.ts` fills with the `cursorPrompt` draw; `LeaderMenuDeps.anchor` goes when the prompt was its
  only use.
- Box message: `createRowBox` replaces `div.settings-box-message` with an app-kept slot
  `div.settings-box-message-slot`, appended where the message sits now (after the frame of a document box; after the
  preview slot of a line box). `showMessage(text)` stores `text`, runs the stored dispose, and calls
  `deps.drawMessage(slot, text)`. `redrawMessage()` does the same with the stored text and does nothing before the
  first message. `destroy()` runs the stored dispose. The editor, its frame and the preview stay the app's.
- `settings-view.ts` passes `drawMessage` drawing `boxMessage` with `{ text }` through `parts.draw` in scope `rows`.
  `setLayouts` calls `openBox?.box.redrawMessage()` after `draw(true)`. The two `showMessage` callers (~L880
  `showUnderBox`, ~L998 `boxProblem`) stay as they are.
- `read-layout.ts`: `cursorPrompt: true`, `boxMessage: true`.
- Default `cursorPrompt`: `kit.el(parent, 'span', 'settings-row-actions')` holding one `kit.keyHint` per action;
  returns the span. Default `boxMessage`: `kit.el(parent, 'div', 'settings-box-message', input.text)`.
- CSS: `.settings-row-actions` (`settings.css` L32) and `.settings-box-message` (L106) move to the default
  `layout.css`; `.settings-row-actions-slot` stays in `settings.css`; `settings.css` gains
  `.settings-box-message-slot { display: contents; }`. The default's existing `.settings-key-row
  .settings-row-actions` rules stay.
- Scope: `rows`, `leaderGroups`, `leaderItems`, the old anchors' scopes (`anchored(…, 'rows', …)`,
  `promptHints(…, 'leaderGroups' | 'leaderItems', …)`).

GIVEN the cursor on a setting row WHEN the cursor moves to a key row THEN `cursorPrompt` draws once more, into the key
row's slot, with the key row's actions (`settings.open`/`reassign`, `settings.addBind`/`add key`,
`settings.removeBind`/`clear`, `settings.reset`/`reset`, each one the row has), no row part draws again, and each
hint's anchor has scope `settings.rows`; WHEN the layouts change after THEN the sheet still holds one
`settings-row-actions`
GIVEN an open box WHEN a write is refused twice THEN the box holds one `.settings-box-message` with the second text;
WHEN the layouts change THEN the message draws again in the new layout and the box keeps focus

Tests:
- `row-prompt.test.ts` — the existing table's expected values become the `{ command, label }` lists.
- `'a row that leaves out its slots still gets the prompt and the box'` — the prompt it finds is the drawn
  `cursorPrompt` part in the slot appended at the row's end.
- New `cursorPrompt_CursorMove_DrawsOnTheReachedRowOnly` — `it.each` over a setting row and a key row: the actions,
  the anchor scopes, the row part draw count unchanged, one `settings-row-actions` in the sheet.
- New `boxMessage_DrawsThroughTheLayout` — `it.each` over `{ case: 'first message' }`,
  `{ case: 'a second message replaces the first' }`, `{ case: 'a layout reload draws it in the user layout' }`
  (`data-layout` the user layout's name; the box input still focused).
- `leader-menu-view.test.ts` — fakes only: its fake `RowBox` (~L197) gains `redrawMessage`; its deps fake (~L129)
  loses `anchor` and gains `drawPrompt`.
- `settings-view.test.ts` `leaderMenu_RowClickAndMoves_MoveItsPaneCursorAndReportIt` (~L1127) gains rows asserting the
  drawn prompt's actions and scope for a group row and an item row.
- `cursorPrompt_CursorMove_DrawsOnTheReachedRowOnly` also changes the layouts after the move and asserts one
  `settings-row-actions` remains.
- `read-layout.test.ts` — the part list gains `cursorPrompt` and `boxMessage`.

### notes

Files: modify `src/plugins/notes/page/popup.ts` · `src/plugins/notes/page/layout/notes-parts.ts` ·
`src/plugins/notes/page/layout/read-notes-layout.ts` · `src/plugins/notes/layouts/layout.d.ts` ·
`src/plugins/notes/layouts/default/layout.js` · `src/plugins/notes/layouts/default/layout.css` ·
`src/plugins/notes/page/notes.css` · `src/plugins/notes/main/selftest-script.ts` (only if a step is missing) · test
`src/plugins/notes/page/popup.test.ts` ·
`src/plugins/notes/page/layout/notes-parts.test.ts` · `src/plugins/notes/page/layout/read-notes-layout.test.ts`.

Produces, in `src/plugins/notes/layouts/layout.d.ts`:
- `export interface NotesPromptActionInput extends PromptActionInput { hasTarget: boolean }`
- `export interface CursorPromptInput { actions: readonly NotesPromptActionInput[] }`
- in `Layout`: `cursorPrompt?(parent: HTMLElement, input: CursorPromptInput, kit: NotesKit): NotesPart;`

Decisions:
- The notes prompt always shows both actions and dims the one with no target (`is-no-target`), keeping its space.
  The input keeps that: both actions in order, `{ command: 'notes.editBox', label: 'edit', hasTarget }` with
  `hasTarget` true on `title` and `body`, and `{ command: 'notes.remove', label: 'remove', hasTarget }` with
  `hasTarget` true on `images` holding an image or `session` holding a session (today's `placeCursorPrompt` rules).
- `notes-parts.ts` gains `cursorPrompt(parent: HTMLElement, input: CursorPromptInput): HTMLElement`, a
  single-instance part (a second draw disposes and removes the first root, as the `NotesParts` comment describes for
  single-instance parts), with the kit of scope `popup` (`notes.popup`, the old anchors' scope).
- `popup.ts`: `placeCursorPrompt` draws `cursorPrompt` at the end of the selected field's row root, and draws again
  only when the field or a `hasTarget` changed, or when `drawRows` drew new rows (it disposes the drawn prompt). Rows
  do not draw again on a field move, so the title and body boxes stay where they are and keep focus. Delete
  `cursorPrompt`, `editHint`, `removeHint`.
- `read-notes-layout.ts`: `cursorPrompt: true`.
- Default `cursorPrompt`: `kit.el(parent, 'span', 'notes-cursor-prompt')` holding one
  `kit.keyHint(span, command, { label, className: 'notes-hint' })` per action, with `is-no-target` added on the hint
  when `hasTarget` is false; returns `{ element: span }`.
- CSS: the `notes.css` rules that name `.notes-cursor-prompt` (L20–35) move to the default `layout.css` unchanged.

GIVEN the field on `title` WHEN the popup renders THEN `cursorPrompt` draws at the title row's end with edit
`hasTarget: true` and remove `hasTarget: false`, each anchor in scope `notes.popup`
GIVEN focus in the title box WHEN focus moves to the body box THEN the prompt draws on the body row, no `row` part
draws again, and the body input keeps focus

Tests:
- New `cursorPrompt_FieldMove_DrawsOnTheFieldRowWithItsTargets` — `it.each` over title, body, images with one image,
  images with none, session set, session null: the row the prompt sits in, each action's `hasTarget`, the anchor
  scopes.
- New `cursorPrompt_BoxToBox_KeepsTheFocusedBox` — the case in the second GIVEN above.
- `read-notes-layout.test.ts` — the part list gains `cursorPrompt`.

### sessions (beyond the follow-up's list; Decided in plan.md)

Files: modify `src/plugins/sessions/page/sidebar-view.ts` · `src/plugins/sessions/page/layout/sessions-parts.ts` ·
`src/plugins/sessions/layouts/layout.d.ts` · `src/plugins/sessions/layouts/default/layout.js` ·
`src/plugins/sessions/main/selftest-script.ts` (only if a step is missing) · test
`src/plugins/sessions/page/sessions-view.test.ts` · `src/plugins/sessions/page/layout/sessions-parts.test.ts`. The
reader gains no part. `.session-row-actions` already sits in the default `layout.css`.

Produces:
- in `src/plugins/sessions/layouts/layout.d.ts`: `SessionRowInput.prompt: readonly PromptActionInput[]`
  (`isPrompted` stays); `RowKit` loses `cursorPrompt`
- in `src/plugins/sessions/page/layout/sessions-parts.ts`:
  `row(parent: HTMLElement, input: SessionRowInput): DrawnPart<SessionsPart>` (the `cursorPrompt` parameter goes)

Decisions:
- Prompt actions: on a favorite project's row `FAVORITE_ROW_ACTIONS` (`listFavorite`/`unfavorite`,
  `listMoveUp`/`up`, `listMoveDown`/`down`, `listRename`/`rename`, `listClose`/`close`), on any other row
  `OTHER_ROW_ACTIONS` (`listFavorite`/`favorite`, `listRename`/`rename`, `listClose`/`close`); commands
  `sessions.<command>`; typed `readonly PromptActionInput[]`. `promptOf` returns `{ isPrompted, prompt }` with
  `prompt` the list when `isPrompted`, else `[]`.
- Scope: the old anchors fire in `sessions.sidebar`, but `sessionsKit` builds every part with no scope (comment at
  `sessions-parts.ts` ~L156). The `row` part's kit is built with scope `sidebar`
  (`ownerBaseKitDeps(sessionsManifest, deps, 'sidebar', rollback)`), so its hints hide out of that scope as the old
  prompt did. Every other part keeps no scope; the comment says so.
- Delete in `sidebar-view.ts`: `rowActionsElement`, `promptAnchors`, `favoritePrompt`, `otherPrompt` and the prompt
  element passed to `parts.row`.
- Default `row`: where `kit.cursorPrompt(element)` sits now, a `span.session-row-actions` holding one `kit.keyHint`
  per action, drawn only when `input.prompt` is not empty.
- Task 03 adds `pickerRow` to the same files in Wave 1; keep it.

GIVEN the cursor on a favorite project's row WHEN the side bar draws THEN that row's `prompt` is the five favorite
actions and each hint's anchor has scope `sessions.sidebar`; GIVEN a Recent row THEN it is the three other actions

Tests:
- `sessionList_EntryMovesAndLeave: $case` — rows unchanged: `keys` stays 5 on a favorite project's row and 3
  elsewhere, since the default draws one child per action.
- `sessions-parts.test.ts` — the `row` cases drop the prompt argument; a new row in its row table asserts the hint
  anchors' scope `sessions.sidebar`.

### chat's picker rows (beyond the follow-up's list; Decided in plan.md)

Files: modify `src/plugins/chat/page/picker.ts` · `src/plugins/chat/layouts/layout.d.ts` ·
`src/plugins/chat/layouts/default/layout.js` · `src/contracts/list-picker.ts` ·
`src/shared/page/list-picker.ts` · `src/plugins/chat/main/selftest-script.ts` (only if a step is missing) · test
`src/shared/page/list-picker.test.ts` · `src/plugins/chat/page/start-prompt.test.ts`.

Produces:
- in `src/contracts/list-picker.ts`: `DrawRowInput.isCursor: boolean` — true on the row at the cursor
- in `src/plugins/chat/layouts/layout.d.ts`: `PickerRowInput.prompt: readonly PromptActionInput[]`;
  `PickerRowKit` loses `cursorEnd` (`export interface PickerRowKit extends BaseKit {}`)

Decisions:
- The list picker already draws only the row the cursor left and the row it reached on a move, so the row input
  carries the prompt. `drawRow` gets no cursor today, so `list-picker.ts` `drawRowAt` passes
  `{ label, trailing, isCursor: atCursor }`.
- `picker.ts`: the resume picker stops passing `cursorEnd`; `cursorPrompts` and its anchors are deleted.
  `drawPickerRow` sets `prompt` to `[{ command: 'chat.toggleArchive', label: 'archive' }]` for an archive state
  `live` and `label: 'restore'` for `archived`, only when `row.isCursor`, the scope is `resume` and
  `next.archiveState?.(item)` is not null; else `[]`.
- Scope: `drawPickerRow` builds the kit with `surfaceBaseKit(deps, scope, …)`, `chat.resume` on that picker, the
  old anchors' scope (`anchored('toggleArchive', 'resume', …)`).
- `ListPickerRequest.cursorEnd` stays in the contract with no caller after this task, kept for later pickers; the
  `trailing` every picker row reads (notes, settings, backlog, task 03's sessions `kit.trailing()`) is then null,
  which those rows already handle.
- Default `pickerRow`: `trailing` is a `span.chat-picker-key` holding one `kit.keyHint` per action when
  `input.prompt` is not empty, else nothing.
- Every test fake that builds a `DrawRowInput` adds `isCursor`.

GIVEN the resume picker with the cursor on a live session WHEN the row draws THEN its `prompt` is
`chat.toggleArchive` / `archive`, the hint's anchor scope is `chat.resume`, and other rows' `prompt` is `[]`; GIVEN
an archived session THEN the label is `restore`

Tests:
- `drawRow_DrawsEachVisibleItemAndKeepsCursorAndClick` — asserts each recorded `DrawRowInput.isCursor`, true at the
  cursor only, before and after a move.
- New `resumePicker_CursorRow_PromptNamesArchiveOrRestore` in `start-prompt.test.ts` — `it.each` over a live
  session (`archive`), an archived one (`restore`), a non-cursor row (`[]`), an `archiveState` returning null (`[]`)
  and the `picker` scope (`[]`); the live row also asserts the recorded anchor's scope `chat.resume`. The file holds
  no resume-picker test today: build the picker through `picker.ts`'s exported entry with fake deps and a fake
  `archiveState`, recording `drawRow` inputs.

## Done when

Compiles: `npm run lint` and the typecheck pass. The test gate runs every test named above, filtered to these files.
Each owner's `default` defines every part its contract adds, and each reader table lists it. The Proof names, per
owner, the self-test step that shows each prompt action. Live check: task 15.

## Commit

One commit for the group, pathspecs: `src/plugins/backlog/` `src/plugins/docs/` `src/plugins/settings/`
`src/plugins/notes/` `src/plugins/sessions/` `src/plugins/chat/page/picker.ts`
`src/plugins/chat/page/start-prompt.test.ts` `src/plugins/chat/main/selftest-script.ts` `src/plugins/chat/layouts/` `src/contracts/list-picker.ts`
`src/shared/page/list-picker.ts` `src/shared/page/list-picker.test.ts`.

## Proof
