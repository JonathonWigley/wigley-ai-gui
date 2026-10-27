# 04 — Form tab and review

Status: in progress
Type: Task
Wave: 2 · Depends on: 01, 02
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/forms/page/start.ts` · modify `src/plugins/forms/page/forms-view.ts` ·
           modify `src/plugins/forms/page/round-view.ts` · modify `src/plugins/forms/page/view-model.ts` ·
           modify `src/plugins/forms/page/layout/card-kit.ts` · modify `src/plugins/forms/page/layout/layout-panes.ts` ·
           modify `src/plugins/forms/page/kinds/card-parts.ts` · modify `src/plugins/forms/page/kinds/item-format.ts` ·
           modify `src/plugins/forms/page/forms.css` · modify `src/plugins/forms/layouts/layout.d.ts` (comments only) ·
           test `src/plugins/forms/page/view-model.test.ts` · test `src/plugins/forms/page/layout/card-kit.test.ts` ·
           test `src/plugins/forms/page/layout/layout-panes.test.ts` · test `src/plugins/forms/page/round-view.test.ts` ·
           test `src/plugins/forms/page/forms-view.test.ts` · test `src/plugins/forms/page/layout/layout-cards.test.ts` (each test's `keys` fake gains `anchor`)
Consumes:  `anchor(element: HTMLElement, command: CommandId, options?: AnchorOptions): Disposable` on `KeysPageExports` ← 01 ·
           `AnchorOptions { scope?: ViewScope; where?: HintWhere; label?: boolean | string }` ← 01 · the `ui-key-prompt` root class ← 01 ·
           the class `ui-key-chevron` ← 01 ·
           `ConfirmKeys { anchor(element: HTMLElement, command: CommandId, options?: { scope?: ViewScope }): Disposable }`
           in `src/shared/page/confirm-prompt.ts`, already fitted by `keys: deps.keys` in `forms-view.ts` ← 01 ·
           `ConfirmPromptDeps.onBaseChanged` optional: `onBaseChanged?(): void` ← 01 ·
           `export interface StatusLineContent { save: string; saveState: string }` and
           `export interface StatusLine { element: HTMLElement; update(isShown: boolean, content: StatusLineContent): void }`
           and `export function createStatusLine(): StatusLine` in `src/shared/page/status-line.ts` ← 02 ·
           `progress`, `unansweredItem`, `focusedItem`, `railItems` (`form-state.ts`, now) · `itemLabel`
           (`kinds/formats.ts`, now) · `roundSaveLabel`, `roundSaveState` (`view-model.ts`, now) ·
           `layoutActions` (`layout/card-kit.ts`, now) · `kbd` (`src/shared/page/ui/kbd.ts`, now)
Produces:  `export function railHeadText(counts: Progress): string` in `src/plugins/forms/page/view-model.ts`
           `export function hasOtherUnanswered(round: RoundState): boolean` in `src/plugins/forms/page/view-model.ts`
           `export function pagerText(round: RoundState): string` in `src/plugins/forms/page/view-model.ts`
           `HeadKitDeps.anchor(element: HTMLElement, command: CommandId, label?: boolean | string): void` in `layout/card-kit.ts`
           `RoundViewDeps.keys`, `PaneDeps.keys`, `CardDeps.keys`: `Pick<KeysPageExports, 'keysFor' | 'anchor'>`
           (`RoundViewDeps.keys` also keeps `'onChanged'`)
           `FormsViewDeps.areas: Pick<PluginAreas, 'overlay'>`; `FormsViewDeps.onViewChanged` deleted

Decisions:
- **Binds and anchors.** Every non-leader bind in the forms scopes gets an anchor, scoped to the scope it fires
  in (user, 2026-10-27). Task 10's self-test gate reads this table.

  | Scope | Bind | Command | Anchor element | Options |
  |---|---|---|---|---|
  | `forms.forms` | `1`…`9` | `forms.choose1`…`choose9` | each choice's pick, and each bare action header's pick, as today | `{ scope }` |
  | `forms.forms` | `x` | `forms.toggleNotApplicable` | Not applicable button | `{ scope }` |
  | `forms.forms` | `d` | `forms.toggleDontAsk` | Don't ask me this button | `{ scope }` |
  | `forms.forms` | `a` | `forms.editNotes` | Notes field label; Comment field label on a notice | `{ scope }` |
  | `forms.forms` | `<CR>` | `forms.acceptRecommendation` | Accept button (a vim key the view anchors) | `{ scope }` |
  | `forms.forms` | `c` | `forms.clearChoice` | new Clear button in the Your answer header | `{ scope }` |
  | `forms.forms` | `<A-p>` | `forms.prevUnanswered` | rail header pair | `{ scope }`; a `◂` chevron after it → `⌥P ◂` |
  | `forms.forms` | `<A-n>` | `forms.nextUnanswered` | rail header pair | `{ scope }`; a `▸` chevron before it → `▸ ⌥N` |
  | `forms.forms` | `<C-h>` | `forms.prevItem` | item pager start | `{ scope }`; a `‹` chevron after it → `⌃H ‹` |
  | `forms.forms` | `<C-l>` | `forms.nextItem` | item pager end | `{ scope }`; a `›` chevron before it → `› ⌃L` |
  | `forms.forms` | `<C-p>` `<C-n>` | `forms.prevBox`, `forms.nextBox` | box keys on each card box | `{ scope }` |
  | `forms.forms` | `<Leader><Leader>` | `forms.openReview` | Review button in the rail foot | `{ scope }` → `Space Space` |
  | `forms.review` | `<D-Enter>` | `forms.submit` | Send answers button | `{ scope }` |
  | `forms.review` | `C` | `forms.askCancel` | Cancel round button | `{ scope }` |
  | `forms.review` | `o` | `forms.editNote` | Round note field label | `{ scope }` |
  | `forms.review` | `<CR>` | `forms.reviewJump` | cursor prompt on the cursor row | `{ scope, label: true }` → `↩ go to the item` |
  | `forms.review` | `<C-p>` `<C-n>` | `forms.prevBox`, `forms.nextBox` | box keys on the round note box | `{ scope }` |
  | `forms.confirm` | `y` `n` | `forms.confirmCancel`, `forms.dismissConfirm` | the confirm prompt's buttons | task 01 owns these |

  Vim's own keys get no anchor: `j` `k` (`nextItem`, `prevItem`, `reviewNext`, `reviewPrev`), `<C-j>` `<C-k>`
  `<C-S-j>` `<C-S-k>`, `<Esc>` (`closeReview`, `dismissConfirm`, the box `leaveBox`). The box binds `<Leader>x`,
  `<Leader>a1`…`a9`, `<Leader>ac` and `<Leader><Leader>` are leader binds, which which-key shows.
- **The prompt shows `⌃H` and `⌃L`, not `k` and `j`.** `forms.prevItem` and `forms.nextItem` bind `k`/`j` first in
  `forms.forms`. Task 01's anchor draws the first bind that is not a vim key, so the pager names its anchors with no
  extra option.
- **Chevrons.** Each chevron in the table is a `span.ui-key-chevron` (task 01) that the view places next to its anchor
  element, on the side the table names. Task 01's rule hides it while its anchor is hidden.
- **Choice keys `5`…`9`.** A pick for `forms.choose5`…`choose9` exists only on a card with that many choices. Task 01
  counts a bind as placed once the page load named its anchor, so these binds count once a card with that many
  choices draws. Task 10 adds that card to the self-test fixture. This task adds no anchor for a choice the card does
  not draw.
- **One recording `keys` per build.** `buildRoundParts` makes a list of Disposables and passes down a `keys` whose
  `anchor` calls `deps.keys.anchor` and pushes the Disposable it returns onto that list; `keysFor` passes through.
  `RoundParts` gains `dispose()`, which disposes that list. `rebuild` calls `parts.dispose()` before it builds again;
  `RoundView.dispose` calls it and disposes the head's list and `keysChange`. The cards, panes, rail header, pager
  and rail foot all anchor through the recording `keys`, so no part disposes its own anchors.
- **The kit keeps its shape** (plan.md, Decisions). `HeadKitDeps` gains `anchor`; `headKitDepsFor(deps, scope)`
  builds it as `deps.keys.anchor(element, command, { scope, label })`. `kit.keyHint(parent, command, className)`
  appends the `span` as now and anchors it to `formsCommandNamed(command)`; an unknown name anchors nothing and leaves
  the span empty. `kit.keys` and `kit.keysFor` are unchanged. `kit.kbd` and `kit.button({ keys })` draw a static hint
  for the keys string through `kbd`, as now, with no `key-hint.ts` import. `createUpdatingHeadKit` is deleted: its only
  change from `createHeadKit` was the `keyHint` redraw, so the cards and panes use `createHeadKit`.
- **Control hints.** `appendCardKeys(card, control, command)` appends a `span` to the control and anchors it through
  `card.headDeps.anchor`; it pushes no updater. `buildChoiceList` takes `anchor(element: HTMLElement, command:
  CommandId): void` in place of `keysFor`, anchors each pick, and `ChoiceList` loses `updateKeys`. The bare header pick
  in `choiceGroups` anchors the same way. `appendReviewButton` appends a `span` to the button and anchors it.
- **Clear button.** `appendAnswerArea` takes the card and draws `sectionHeader('Your answer', clear)`. `clear` is a
  ghost `textButton('Clear', …)` with its `forms.clearChoice` anchor. A click dispatches the card's focus action (the
  first action `layoutActions({ type: 'focus' }, card.position)` returns), then `{ type: 'clearChoice' }`, as
  Accept's click focuses before it acts. `LayoutAction` does not change.
- **Field labels.** The Notes and Comment fields (`FIELD_CAPTIONS`) and the Round note field each carry an anchor
  `span.field-keys` right after the label text, before the hint: `forms.editNotes` on Notes and Comment, and
  `forms.editNote` in `forms.review` on the Round note. The Why not ask field carries none.
- **Box hints.** Every mounted box field (notes, the Don't ask reason, comment, round note) gets a `span.box-keys`
  after its input frame, holding the `prevBox` then the `nextBox` anchor in the field's scope, so it reads `⌃P ⌃N`.
  `forms.css` sets it on the frame's bottom edge at the right end, `visibility: hidden`, and `visible` under
  `.field:focus-within`. The anchors inside carry no `visibility` of their own, so they inherit the box rule and
  `is-hint-hidden` still wins over it. Put a helper `appendBoxKeys(field, anchor)` in `kinds/card-parts.ts`, where
  `anchor` is `(element: HTMLElement, command: CommandId) => void`.
- **Rail header.** The app draws it, not the layout: `buildRoundParts` appends a `header.rail-head` to `split.start`
  before `buildRailPane`. It holds `span.rail-head-text` with `railHeadText(progress(round))`, then the
  `createStatusLine()` element, then a `span.rail-edge` pair: the `prevUnanswered` anchor, the `◂` chevron, the `▸`
  chevron and the `nextUnanswered` anchor. A ` · ` separator goes between the text and the save state, so the header
  reads `Items · 3 open · Saved   ⌥P ◂ ▸ ⌥N`. `RoundView.update` sets the text, calls
  `statusLine.update(true, { save: roundSaveLabel(round), saveState: roundSaveState(round) ?? '' })`, and sets the
  pair's `is-no-target` class (`visibility: hidden`) while `hasOtherUnanswered(round)` is false. The line passes
  `true` because the round view itself hides with its tab. AGENTS.md § Architecture
  (forms layout) says the app keeps the rail header's open count and saved state, so the layout contract gains no
  field.
- **`railHeadText(counts)`** returns `Items · ${counts.untouched} open`, `0` included.
- **`hasOtherUnanswered(round)`** is true when `unansweredItem(round, 1)` is not null and is not the focused item. It
  mirrors `jumpToUnanswered`, which logs "no other unanswered item" in that case.
- **Item pager.** The app draws a `div.item-pager` in the main column, after the layout head and before the items
  pane, so it sits as the card's header strip for every layout and every item kind, notices included. It holds the
  `prevItem` anchor, the `‹` chevron, `span.item-pager-text` with `pagerText(round)`, the `›` chevron, and the
  `nextItem` anchor: `⌃H ‹ F1 of 6 › ⌃L`. The pager is a sibling of `itemsPane`, not a child, so it does not scroll with the cards. `update` sets
  `pager.hidden` beside the line that hides the items pane outside the forms view. Its two anchor cells
  (each anchor with its chevron) carry `is-no-target` while the round holds fewer
  than two rail items. The agent chose an app strip over the kit's `itemHead`, because the default notice card and a
  user's card can leave `itemHead` out, and the keys must always have a place.
- **`pagerText(round)`** returns `${itemLabel(focused)} of ${railItems(round.round).length}`, and `''` when no item is
  focused.
- **Rail foot.** `buildRoundParts` appends a `footer.rail-foot` to `split.start` after the rail pane, holding a ghost
  `Review` button that runs `forms.openReview` through `deps.run`, with its `forms.openReview` anchor. `forms.css`
  lays out `split.start` as three rows (`auto minmax(0, 1fr) auto`); the layout's rail pane takes the middle row and
  scrolls.
- **Review cursor prompt.** `drawReview` makes one `span.review-jump-prompt` and anchors it once. `drawReviewRow`
  appends it to the cursor row's pick, which moves it, in place of the `keyHint` it draws now.
- **Keymap changes.** Anchors redraw themselves. The round view's `onChanged` listener only draws the layout head
  again, disposing the head's anchors first, because `layout.d.ts` promises a head drawn again after each keymap change
  for text it drew from `kit.keys`. `ReviewPane.forgetRows` and the listener's `view.update` call are deleted.
- **Status bar.** `forms-view.ts` drops `createStatusLine`, `statusContent`, `updateStatus`,
  `areas.statusBar.contribute`, `boxes.onChange(updateStatus)` and `deps.onViewChanged`. Task 02 already removed the
  `modeLabel` import and the `boxes` parameter of `statusContent`. The confirm prompt's deps omit `onBaseChanged`
  (optional since task 01), and its comment line goes. `start.ts` drops the `onViewChanged` wiring.
- **`layout.d.ts`.** Only comments change: `keyHint` reads "an anchor for `command` in the scope of the part drawing;
  it shows while that scope is in force and the hints setting is on, and follows keymap changes"; `rail` reads "the
  rail beside the cards, under the app's rail header and over its Review button, built once per round". No member
  changes, so a user layout keeps working. `layouts/default/layout.js` does not change.

GIVEN a round with three untouched items WHEN the rail header draws THEN its text reads `Items · 3 open`
GIVEN every item answered except the focused one WHEN the view updates THEN the `⌥P ◂ ▸ ⌥N` pair carries
`is-no-target`
GIVEN a round of one notice WHEN the view updates THEN the pager reads `N1 of 1` and its anchors carry `is-no-target`
GIVEN the review with the cursor on row 2 WHEN the rows draw THEN the jump prompt sits in row 2's pick and in no other
row
GIVEN a layout set change that rebuilds the round WHEN `rebuild` runs THEN every anchor of the first build is disposed
GIVEN the scope is `forms.review` WHEN the rail shows THEN the unanswered pair and the Review button's hint are hidden
and keep their space (task 01 behaviour; task 12 check "Hints follow the scope")

Tests:     in `view-model.test.ts`:
           `railHeadText counts the untouched items` — untouched 3 → `'Items · 3 open'`; untouched 0 → `'Items · 0 open'`
           `hasOtherUnanswered is false with every item responded, false with only the focused item untouched, and true
           with another item untouched`
           `pagerText reads the focused item's label of the rail count` — a round of two findings and one question,
           focused on the first finding → `'F1 of 3'`
           in `card-kit.test.ts`:
           `kitKeyHint_NamedCommand_AnchorsInTheCardScope` — `anchor` called with the returned span,
           `'forms.toggleDontAsk'`, `{ scope: 'forms.forms' }`; `kitKeyHint_UnknownName_AnchorsNothing` — no `anchor`
           call, the span is empty
           `answerControls_AnchorsNotApplicableAndDontAsk` — calls for `'forms.toggleNotApplicable'` and
           `'forms.toggleDontAsk'`, each with `{ scope: 'forms.forms' }`
           `choiceList_AnchorsEachChoice` — a two-choice question anchors `'forms.choose1'` and `'forms.choose2'`
           `clearButton_Click_FocusesTheItemThenClears` — `dispatch` called with `{ type: 'focusItem', item: <position> }`,
           then `{ type: 'clearChoice' }`
           in `layout-panes.test.ts`: `reviewKit_KeyHint_AnchorsInTheReviewScope` replaces
           `reviewKit_KeysAndKeyHint_ReadTheReviewScope` — `anchor` called with `'forms.askCancel'`,
           `{ scope: 'forms.review' }`, and never with `{ scope: 'forms.forms' }`;
           `reviewRow_CursorRow_HoldsTheJumpPrompt` — one `review-jump-prompt` in the cursor row, none in the others, and
           one `anchor` call with `'forms.reviewJump'`, `{ scope: 'forms.review', label: true }`
           in `round-view.test.ts`: `rebuild_DisposesTheFirstBuildsAnchors` — every Disposable the fake `anchor` returned
           before `rebuild` is disposed after it; `dispose_DisposesEveryAnchor`
           The look of the rail header, the pager and the box keys is task 12's checks "Edge prompts" and "Hints follow
           the scope".
Done when: compiles; lint passes; the test gate runs the tests above;
           `grep -rnE "key-hint'|appendKeyHint|keyHint\(keys|createUpdatingHeadKit|statusBar" src/plugins/forms/page`
           prints nothing.
Commit:    one commit for the group

## Proof
