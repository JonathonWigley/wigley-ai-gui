# 05 — Primer

Status: done
Type: Task
Wave: 2 · Depends on: 01, 02
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/primer/page/start.ts` · modify `src/plugins/primer/page/primer-view.ts` ·
           modify `src/plugins/primer/page/primer-review.ts` · modify `src/plugins/primer/page/primer-state.ts` ·
           modify `src/plugins/primer/page/primer.css` ·
           test `src/plugins/primer/page/primer-state.test.ts` · test `src/plugins/primer/page/primer-view.test.ts` ·
           test `src/plugins/primer/page/primer-review.test.ts`
Consumes:  `anchor(element: HTMLElement, command: CommandId, options?: AnchorOptions): Disposable` on `KeysPageExports` ← 01 ·
           `AnchorOptions { scope?: ViewScope; where?: HintWhere; label?: boolean | string }` ← 01 · the `ui-key-prompt` root class ← 01 ·
           the class `ui-key-chevron` ← 01 ·
           `ConfirmKeys { anchor(element: HTMLElement, command: CommandId, options?: { scope?: ViewScope }): Disposable }`
           in `src/shared/page/confirm-prompt.ts`, already fitted by `keys: deps.keys` in `primer-view.ts` ← 01 ·
           `ConfirmPromptDeps.onBaseChanged` optional: `onBaseChanged?(): void` ← 01 ·
           `export interface StatusLineContent { save: string; saveState: string }` and
           `export interface StatusLine { element: HTMLElement; update(isShown: boolean, content: StatusLineContent): void }`
           and `export function createStatusLine(): StatusLine` in `src/shared/page/status-line.ts` ← 02 ·
           `railRows`, `selectedRow`, `selectedEntry` (`primer-state.ts`, now) · `saveLabel`, `saveState`
           (`src/shared/page/autosave.ts`, now)
Produces:  `export type RowPrompt = 'none' | 'task' | 'extra'` in `src/plugins/primer/page/primer-state.ts`
           `export function rowPrompt(primer: OpenPrimer): RowPrompt` in `src/plugins/primer/page/primer-state.ts`
           `export function renderReview(primer: OpenPrimer): HTMLElement` in `primer-review.ts` (loses its `deps`)
           `export function reviewFooter(deps: ReviewDeps): HTMLElement` in `primer-review.ts`
           `ReviewDeps.keys: Pick<KeysPageExports, 'anchor'>` in `primer-review.ts`
           `PrimerViewDeps.areas: Pick<PluginAreas, 'overlay'>`; `PrimerViewDeps.onViewChanged` deleted

Decisions:
- **Binds and anchors.** Every non-leader bind in the primer scopes gets an anchor, scoped to the scope it fires
  in (user, 2026-10-27). Task 10's self-test gate reads this table.

  | Scope | Bind | Command | Anchor element | Options |
  |---|---|---|---|---|
  | `primer.rail` | `y` | `primer.needYes` | row prompt on the selected task row | `{ scope, label: 'yes' }` |
  | `primer.rail` | `n` | `primer.needNo` | row prompt | `{ scope, label: 'no' }` |
  | `primer.rail` | `u` | `primer.needUnclear` | row prompt | `{ scope, label: 'unclear' }` |
  | `primer.rail` | `D` | `primer.removeExtraTask` | row prompt, on an extra task only | `{ scope, label: 'remove' }` |
  | `primer.rail` | `A` | `primer.addExtraTask` | Extra tasks section header | `{ scope, label: 'add' }` |
  | `primer.rail` | `<A-l>` | `primer.focusCard` | rail header, at the split edge | `{ scope, label: 'card' }`; a `›` chevron after it → `⌥L card ›` |
  | `primer.rail` | `<C-h>` | `primer.prevRow` | rail header pair | `{ scope }`; a `▲` chevron after it → `⌃H ▲` |
  | `primer.rail` | `<C-l>` | `primer.nextRow` | rail header pair | `{ scope }`; a `▼` chevron before it → `▼ ⌃L` |
  | `primer.rail` | `<Leader><Leader>` | `primer.openReview` | Review button in the rail foot | `{ scope }` → `Space Space` |
  | `primer.card` | `x` | `primer.toggleInclude` | each item's include mark, shown on the cursor item | `{ scope }` |
  | `primer.card` | `c` | `primer.editItemComment` | after each item's comment box, as today | `{ scope }` |
  | `primer.card` | `C` | `primer.editTaskComment` | Comment field label | `{ scope }` |
  | `primer.card` | `a` | `primer.addItem` | New item field label | `{ scope }` |
  | `primer.card` | `i` | `primer.editFirstField` | Name field label (extra task, Feature card) | `{ scope }` |
  | `primer.card` | `<A-h>` | `primer.focusRail` | card edge strip, at the split edge | `{ scope }`; a `‹ rail` chevron before it → `‹ rail ⌥H` |
  | `primer.card` | `<C-p>` `<C-n>` | `primer.prevBox`, `primer.nextBox` | box keys on each box | `{ scope }` |
  | `primer.card` | `<Leader><Leader>` | `primer.openReview` | Review button in the rail foot, second anchor | `{ scope }` |
  | `primer.review` | `<D-Enter>` | `primer.submit` | Send button | `{ scope }` |
  | `primer.review` | `C` | `primer.askCancel` | Cancel primer button | `{ scope }` |
  | `primer.review` | `<Esc>` | `primer.closeReview` | Back button (a vim key the view anchors, as today) | `{ scope }` |
  | `primer.confirm` | `y` `n` | `primer.confirmCancel`, `primer.dismissConfirm` | the confirm prompt's buttons | task 01 owns these |

  Vim's own keys get no anchor: `j` `k` (`nextRow`, `prevRow`, `nextItem`, `prevItem`), the four scroll binds of
  `primer.card` and `primer.review`, `<Esc>` (`dismissConfirm`, the box `leaveBox`).
- **The `<C-h>`/`<C-l>` pair is the agent's placement.** The approved list does not name `primer.prevRow` and
  `primer.nextRow` on `<C-h>`/`<C-l>`, and they are not vim's own keys, so they need a place. The agent put them on
  the rail header as an edge prompt, as the session list carries `⌥⇧I ▲ ▼ ⌥⇧O`. `j`/`k` bind first, and task 01's
  anchor draws the first bind that is not a vim key, so the pair shows `⌃H` and `⌃L` with no extra option.
- **Chevrons.** Each chevron in the table is a `span.ui-key-chevron` (task 01) that the view places next to its anchor
  element, on the side the table names. `‹ rail` is one chevron element that holds the word. Task 01's rule hides
  each chevron while its anchor is hidden.
- **Anchor lifetime.** Each primer view makes a list of Disposables and anchors through a `keys` whose `anchor` pushes
  the Disposable it returns onto that list. Each card build keeps its own list the same way. `rebuildCard` disposes the
  card's list before it builds again; `PrimerFormView.dispose` disposes both. `PrimerCard.redrawKeys` is replaced by
  `dispose()`. The view's `keys.onChanged` listener is deleted: anchors redraw themselves, and the rail and review keep
  no key text of their own.
- **Rail structure.** `split.start` holds three parts, built once per view: `header.primer-rail-head`, a
  `div.primer-rail-body` that `drawRail` fills in place of `split.start`, and `footer.primer-rail-foot`.
  `primer.css` lays them out as three rows (`auto minmax(0, 1fr) auto`); the body scrolls.
- **Rail header.** It holds the `createStatusLine()` element, then a `span.primer-rail-edge` pair (the `prevRow`
  anchor, the `▲` chevron, the `▼` chevron, the `nextRow` anchor), then the `focusCard` anchor and its `›` chevron at
  its trailing end, which is the split's edge. `PrimerFormView.update` calls
  `statusLine.update(true, { save: 'Sending…', saveState: 'sending' })` while the primer sends, else
  `statusLine.update(true, { save: saveLabel(saveState(primer), primer.saveError), saveState: saveState(primer) })`,
  as `statusContent` reads them after task 02. The line passes `true` because the primer view itself hides with its
  tab. The pair carries `is-no-target`
  (`visibility: hidden`) while `railRows(primer)` holds fewer than two rows.
- **Row prompt.** The view makes one `span.primer-row-prompt` at mount, holding the `y`, `n`, `u` and `D` anchors,
  each anchored once. `drawRail` appends it to the trailing end of the selected row while `rowPrompt(primer)` is not
  `'none'`, which moves it, and sets `hidden` on the `D` anchor unless `rowPrompt` is `'extra'`. On the Feature row it
  is attached nowhere. It reads `y yes  n no  u unclear`, plus `D remove` on an extra task.
- **`rowPrompt(primer)`** is `'none'` on the Feature row, `'extra'` on a task whose group is `extra`, and `'task'` on
  any other task. The need keys do nothing on the Feature row (`setNeed` returns with no selected entry), so the prompt
  leaves it.
- **Extra tasks header.** The view makes one `span.primer-add-prompt` at mount and anchors it once. `drawRail` passes
  it as `trailing` to `sectionHeader('Extra tasks', …)`. The empty line reads `No extra tasks.` alone, since the header
  now shows the key.
- **Rail foot.** A ghost `Review` button that runs `primer.openReview` through `deps.run`. It holds two anchor spans
  for `primer.openReview`, one in `primer.rail` and one in `primer.card`. `primer.css` puts both spans in one grid
  cell (`grid-area: 1 / 1`), so the hidden one takes no width and the button does not move when the pane changes.
- **Card edge strip.** A `div.primer-card-edge` at the top of `split.end`, before the card pane, holds the `‹ rail`
  chevron and then the `focusRail` anchor at its start, which is the split's edge. It is outside the card pane, so a card rebuild keeps it.
  The view sets `hidden` on it while the review shows.
- **Include mark.** Each item row's leading part is a `span.primer-item-lead` holding the toggle mark, then a
  `span.primer-include-key` anchored to `primer.toggleInclude`. `primer.css` sets the key `visibility: hidden` on an
  item block without `is-cursor`, so only the cursor item shows `x`, and the row text does not move.
- **Box labels.** `appendField` and `mountBox` anchor their `span.primer-field-hint` through the card's `keys`, in
  place of `cardKeyHint`, with the same commands as now. `cardKeyHint` is deleted.
- **Box hints.** `mountFrame` appends a `span.box-keys` after the input frame, holding the `prevBox` then the `nextBox`
  anchor, so it reads `⌃P ⌃N`. `primer.css` sets it on the frame's bottom edge at the right end, `visibility:
  hidden`, and `visible` under `.primer-field:focus-within` and `.primer-item-comment:focus-within`. The anchors inside
  carry no `visibility` of their own, so `is-hint-hidden` still wins.
- **Review.** `renderReview(primer)` draws the review body without the footer. `reviewFooter(deps)` draws the Back,
  Cancel primer and Send buttons, each with a `span` anchored to its command in `primer.review`. The primer view
  builds the footer once and keeps it as the last child of the review pane, after a `div.primer-review-body` that
  `update` fills with `renderReview`.
- **Status bar.** `primer-view.ts` drops `createStatusLine` from the status bar, `statusContent`, `updateStatus`,
  `areas.statusBar.contribute`, `boxes.onChange(updateStatus)` and `deps.onViewChanged`. Task 02 already removed the
  `modeLabel` import and the `boxes` parameter of `statusContent`. The confirm prompt's deps omit `onBaseChanged`
  (optional since task 01), and its comment line goes. `start.ts` drops the `onViewChanged` wiring.
- **Feature card.** The Feature card has no item, item comment, task comment or new item box, so `x`, `c`, `C` and `a`
  have no anchor while it shows. Each of those commands does nothing there. Task 01 counts a bind as placed once the
  page load named its anchor, so these binds count once a task card draws. A task card draws when the rail selects a
  task row, which the self-test does before `⌥L` brings `primer.card` in force. This task adds no anchor on the
  Feature card for them.

GIVEN the rail scope with a Primer task selected WHEN the rail draws THEN the selected row ends with
`y yes  n no  u unclear` and no `D remove`
GIVEN an extra task selected WHEN the rail draws THEN its row also shows `D remove`
GIVEN the Feature row selected WHEN the rail draws THEN no row carries the row prompt
GIVEN the card scope WHEN the user moves the item cursor THEN only the cursor item's include mark shows `x`
GIVEN a primer with no extra tasks WHEN the rail draws THEN the Extra tasks header holds the `primer.addExtraTask`
anchor and the empty line reads `No extra tasks.`
GIVEN a card rebuild WHEN the selected row changes THEN every anchor of the old card is disposed and the card edge
strip keeps its anchor
GIVEN the scope moves from `primer.rail` to `primer.card` WHEN `⌥L` runs THEN the rail's hints hide and keep their
space, and the card's show (task 01 behaviour; task 12 check "Hints follow the scope")

Tests:     in `primer-state.test.ts`: `rowPrompt is none on the Feature row, task on a Primer task, and extra on an
           extra task`
           in `primer-view.test.ts` (its `keys` fake gains `anchor`, returning a Disposable whose `dispose` is a spy):
           `shows only that there are no extra tasks` replaces the two tests that expect `Add one with` and keys; the third empty-line test stays — the line reads
           `'No extra tasks.'`
           `anchors adding a task in the Extra tasks header` — one `anchor` call with an element inside the Extra tasks
           header, `'primer.addExtraTask'`, `{ scope: 'primer.rail', label: 'add' }`
           `moves the row prompt to the selected task and shows remove only on an extra task` — after `selectRow` to an
           extra task the `primer-row-prompt` sits in that row and its `D` anchor is not `hidden`; on a Primer task the
           `D` anchor is `hidden`
           `disposes the old card's anchors on a card rebuild` — every Disposable the first card's anchors returned is
           disposed after `selectRow` moves to another task
           in `primer-review.test.ts`: `reviewFooter anchors Back, Cancel primer and Send in the review scope` —
           `anchor` calls with `'primer.closeReview'`, `'primer.askCancel'` and `'primer.submit'`, each
           `{ scope: 'primer.review' }`
           The look of the rail header, the split edges and the box keys is task 12's checks "Edge prompts" and "Hints
           follow the scope".
Done when: compiles; lint passes; the test gate runs the tests above;
           `grep -rnE "key-hint'|appendKeyHint|keyHint\(|statusBar|redrawKeys" src/plugins/primer/page` prints nothing.
Commit:    one commit for the group

## Proof

Commit 50be002 · proof: diff read, Produces present; typecheck clean in primer files · concerns: textButton doc comment in shared button.ts still says the hint is a kbd (left for 10/11); selected row label may be cut short by the prompt in the 240px rail (task 12 visual)
