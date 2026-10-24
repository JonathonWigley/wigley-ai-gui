# 05 — Layout contract: panes, grouped choices, default layout

Status: not started
Type: Task
Wave: 5 · Depends on: 03, 04
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/forms/layouts/layout.d.ts` · modify `src/plugins/forms/layouts/default/layout.js`
           create `src/plugins/forms/page/layout/layout-panes.ts`
           modify `src/plugins/forms/page/layout/card-kit.ts` · test `src/plugins/forms/page/layout/card-kit.test.ts` (create)
           modify `src/plugins/forms/page/round-view.ts`
           modify `src/plugins/forms/page/layout/read-layout.ts` · test `src/plugins/forms/page/layout/read-layout.test.ts`
           modify `src/plugins/forms/page/layout/layout-resolver.ts` · test `src/plugins/forms/page/layout/layout-resolver.test.ts`
           modify `src/plugins/forms/page/kinds/finding/finding-card.ts` · test `src/plugins/forms/page/kinds/card-input.test.ts`
           modify `src/plugins/forms/page/view-model.ts` · test `src/plugins/forms/page/view-model.test.ts`
           modify `src/plugins/forms/page/forms.css`

Consumes:  `FindingFields.actionReasons: Partial<Record<'follow_up' | 'leave_it', string>>` ← 02 (`src/plugins/forms/contract.ts`)
           `FindingFields.recommend: number | null` ← 02
           `Layout`, `LayoutCards`, `CompleteLayout`, `LayoutPart`, `LayoutPick`, `pickLayout`, `RoundPicks`,
           `pickRoundLayouts`, `readLayout` ← 03
           `createRoundView(attach, round, shown, deps)`, `RoundView.setLayouts(shown, round)` ← 03 (`src/plugins/forms/page/round-view.ts`)
           `FindingCardEntry`, `FindingCard.entries`, `FindingCard.choices[].action`, `LayoutAction` `{ type: 'choose'; number: number }` ← 04 (`layout.d.ts`)
           `findingEntries`, `findingEntryNumber` ← 04 (`src/plugins/forms/finding-pick.ts`)
           `buildChoiceList(list, choices, recommended, pick, deps)` ← 04 (`src/plugins/forms/page/kinds/card-parts.ts`)
           `ReviewRow` with `entry` and no `missing`, `reviewRows`, `reviewRowsChanged`, `pickRailItem`, `railDotStatus`, `progressText` ← 04 / tree (`view-model.ts`)

Produces:  in `src/plugins/forms/layouts/layout.d.ts`:
           - `interface Layout { cards?: Partial<LayoutCards>; head?(parent: HTMLElement, round: RoundInfo, kit: HeadKit): void; rail?(parent: HTMLElement, input: RailInput, kit: RailKit): LayoutPane; review?(parent: HTMLElement, input: ReviewInput, kit: ReviewKit): LayoutPane }`
           - `interface CompleteLayout extends Layout { cards: LayoutCards; rail(parent: HTMLElement, input: RailInput, kit: RailKit): LayoutPane; review(parent: HTMLElement, input: ReviewInput, kit: ReviewKit): LayoutPane }`
           - `interface LayoutPane { element: HTMLElement }`
           - `interface RailEntryInput { position: number; kind: 'question' | 'finding' | 'notice'; label: string; title: string }`
           - `interface RailInput { round: RoundInfo; items: RailEntryInput[] }`
           - `interface RailKit extends HeadKit { entry(parent: HTMLElement, position: number): HTMLElement }`
           - `interface ReviewRowInput { row: number; kind: 'question' | 'finding'; label: string; title: string }`
           - `interface ReviewInput { round: RoundInfo; rows: ReviewRowInput[] }`
           - `interface ReviewKit extends HeadKit { row(parent: HTMLElement, row: number): HTMLElement; progress(parent: HTMLElement): HTMLElement; summary(parent: HTMLElement): HTMLElement; roundNote(parent: HTMLElement): HTMLElement; sendButton(parent: HTMLElement): HTMLButtonElement; cancelButton(parent: HTMLElement): HTMLButtonElement }`
           - `interface AnswerKit extends Kit { answerControls(parent: HTMLElement): HTMLElement }` (`choiceList` moves out)
           - `interface QuestionKit extends AnswerKit { choiceList(parent: HTMLElement, reasons: 'recommended' | 'all' | 'none'): HTMLElement }`
           - `interface FindingKit extends AnswerKit { verdict(parent: HTMLElement): HTMLElement; choiceGroups(parent: HTMLElement, reasons: 'recommended' | 'all' | 'none'): HTMLElement }`
           - `LayoutCards.question(parent: HTMLElement, input: QuestionCard, kit: QuestionKit): LayoutCard`
           - `FindingCard.actionReasons: { follow_up?: string; leave_it?: string }`; `FindingCard.recommend: number | null`
           in `src/plugins/forms/page/layout/card-kit.ts`:
           - `interface ChoiceGroup { action: FindingAction; label: string; reason: string | null; number: number | null; isRecommended: boolean; choices: { number: number; choice: number; text: string; reason: string; isRecommended: boolean }[] }`
           - `function choiceGroupsOf(input: FindingCard): ChoiceGroup[]`
           in `src/plugins/forms/page/layout/layout-panes.ts`:
           - `interface PaneDeps { markdown: MarkdownRenderer; platform: Platform; log: Log; keys: Pick<KeysPageExports, 'keysFor'>; dispatch(action: FormsAction): void; getState(): FormsState; run(command: CommandId): void; mountBox(parent: HTMLElement, target: TextTarget, text: string): void; destroyBox(target: TextTarget): void; shownView(): FormsView }`
           - `interface RailPane { element: HTMLElement; update(round: RoundState, view: FormsView): void; showEntry(position: number): void }`
           - `interface ReviewPane { element: HTMLElement; update(round: RoundState, isNewlyShown: boolean): void; forgetRows(): void }`
           - `function buildRailPane(pick: LayoutPick, parent: HTMLElement, round: RoundState, deps: PaneDeps): RailPane`
           - `function buildReviewPane(pick: LayoutPick, parent: HTMLElement, round: RoundState, deps: PaneDeps): ReviewPane`
           in `src/plugins/forms/page/view-model.ts`:
           - `function reviewSummaryText(counts: Progress): string`

Decisions:
- Layouts draw the whole forms view (interview): a layout defines any of `cards.question`, `cards.finding`,
  `cards.notice`, `head`, `rail`, `review`; `CompleteLayout` (the built-in `default`) defines all but `head`, which
  stays optional. The app keeps which item is selected, the keys, the scrolling, the split and its width, the status
  bar line and the cancel dialog (interview).
- Resolver: the `rail` and `review` rows of 03's part table read `layout.rail` and `layout.review`; each pane resolves
  with `layoutChain(null, round.layout, userLayout)`. `readLayout` adds `rail` and `review` to the known parts and
  throws `layout <name>: rail is not a function` / `layout <name>: review is not a function`.
- Every pane kit part keeps itself up to date, as card parts do: each registers an updater that the pane's `update`
  runs with the current round; the round view updates the rail on every update and the review while it shows; a
  keymap change already updates the shown view. Pane kits extend `HeadKit`, so `el`, `markdown`, `tag`, `button`
  and the rest are the same parts the head and cards use.
- Rail kit `entry(parent, position)`: the Row primitive (`row`, density `list`, `li`, class `rail-entry`, title as
  label and tooltip), leading `span.rail-lead` with a StatusDot and `span.rail-number` holding the item's label.
  Its updater sets `data-status` (`notice` on a notice), `is-selected` on the focused item, `is-flagged` on an
  untouched item while the review or the cancel prompt shows, and the dot by `railDotStatus`. A click runs
  `pickRailItem` with the item's review row, as today. Each entry is recorded by position; `RailPane.showEntry`
  scrolls the recorded entry into view (`block: 'nearest'`), and the round view calls it on each focus change, as
  today. A rail drawn without `entry` scrolls nothing.
- Review kit parts, all moved from `round-view.ts` with today's classes and text:
  - `row(parent, row)`: `li.review-row` for review row `row` (0-based); it redraws its own contents from
    `reviewRows(current)[row]` whenever `reviewRowsChanged` is true for the pane (one check per update for all
    rows), keeping today's content: label, title, action word, `—`, the entry number in `.choice-number` with the
    choice text, the Recommended tag, the status label when it shows no pick, the review-scope jump keys on the
    cursor row, the Notes and Don't-ask detail lines. A click dispatches `reviewJump` for its row. The pane scrolls
    the cursor row into view when the rows changed or the review is newly shown, as today.
  - `progress(parent)`: `p.round-progress` holding `progressText(progress(current))`.
  - `summary(parent)`: `p.review-summary` holding `reviewSummaryText(progress(current))`.
  - `roundNote(parent)`: the `field-note` field, label `Round note`, hint
    `Optional. Anything about the round as a whole.`, its box mounted once with target `{ field: 'note' }`. A
    second call throws `review pane mounted note twice`. When the pane leaves it out, the host appends it at the end
    of the pane's element, so `o` always reaches a box.
  - `sendButton(parent)`: `Send answers`, variant primary, runs `submit`; `cancelButton(parent)`: `Cancel round`,
    runs `askCancel`; each shows the review scope's keys for its command and redraws them on each update.
- `reviewSummaryText(counts)` returns `${progressText(counts)}.` and, when `counts.untouched > 0`,
  ` ${counts.untouched} not answered; they are sent as untouched.` after it (today's text, moved out of
  `round-view.ts`).
- The round head (heading, overview, progress), drawn by the app today in review and confirm only, becomes part of
  the review pane: the default review pane draws it above the review, and the pane shows in the same views. The
  app-drawn `buildHead`, `buildRailEntry`, `updateRailEntry`, `buildReview`, `buildReviewRow`, `reviewKeysFor` and
  `reviewRowsByRailPosition` leave `round-view.ts` (the last two move into `layout-panes.ts`).
- Pane host (`layout-panes.ts`), the pane twin of `buildLayoutCard`: build through the pick's pane; require an
  `HTMLElement` appended to `parent` (`rail pane returned no element`, `rail pane's element is not appended to
  parent`, the same for `review`); set `data-layout="<pick name>"` on it. On a throw, destroy the boxes it mounted,
  remove what it appended, log `layout <name> rail failed: <error>` (or `review failed`) and build with
  `defaultLayout.rail` / `defaultLayout.review`; the pane that fell back carries `data-layout="default"`, the layout
  that drew it (03's rule for cards), so the throwing layout's CSS does not style it. The round view hides and shows
  the review pane's element and the items pane, as today.
- Round view: `buildRoundParts` builds `buildRailPane(picks.panes.rail, split.start, …)`, then in `split.end` the
  head slot (`picks.panes.head`), the items pane, and `buildReviewPane(picks.panes.review, split.end, …)`.
- Finding answers grouped (interview): `choiceGroups(parent, reasons)` draws `div.answer` with the `Your answer`
  header, then one `section.choice-group` (`data-action="<action>"`) per `choiceGroupsOf(input)` group:
  - a group with choices: a SectionHeader with the card word (`label`), the `action_reasons` text when present, then
    `ol.choices` drawn by `buildChoiceList` with each choice's entry `number`; choice reasons follow `reasons` as the
    question list does ('all': each choice's reason as `Why`; 'recommended': the recommended choice's only; 'none').
  - a group with no choices: `div.choice-group-head` holding one `button.choice-pick.choice-group-pick` with the
    card word, then a space and its number in `span.choice-number` with literal parentheses: the span's text is
    `(3)`, so the header reads `Follow-up (3)` ("Plan (3) Drop (4)" in the user's example). Then the Recommended tag
    when it is the recommended pick, and the keys of `choose<N>` (none past 9); then the `action_reasons` text when
    present. A click runs `{ type: 'choose', number }`. A choice's number in `ol.choices` keeps today's form, with no
    parentheses.
  - Numbers run down the card in `entries` order; the Recommended tag sits only on the recommended pick (the choice
    `recommend` names, or the header when `recommend` is null).
  - Its updater marks the picked entry `is-selected` (choice `li` or header pick) and toggles `is-locked` on every
    group while not applicable.
- `choiceGroupsOf(input)`: one group per entry run of one action, in `input.entries` order; `label` from
  `input.actions`; `reason` the `actionReasons` text for the action, null when absent or blank; `number` the
  header's entry number when the group has no choices, else null; `isRecommended` on the group when its action is
  `recommendAction`; on a choice when it is `recommend` under `recommendAction`.
- `action_reasons` text draws in `div.choice-group-reason md` as block markdown under the group's header, in
  `fg-secondary`.
- `FindingCard.actionReasons` copies `finding.actionReasons`; `FindingCard.recommend` is `finding.recommend`
  (null allowed). The finding kit no longer offers `choiceList`; the question kit keeps it unchanged.
- `default` layout (`layouts/default/layout.js`, typed `CompleteLayout`): the question and notice cards as today;
  the finding card as today with `kit.choiceGroups(card, 'all')` in place of `kit.choiceList(card, 'all')`, and
  `kit.answerControls` appended to the `div.answer` it returns. `rail`: `nav.rail` (`aria-label` `Items`) holding
  `ol.rail-list` with one `kit.entry` per `input.items`. `review`: `div.review-pane` holding `header.round-head`
  (`h1.round-heading` with the heading, the overview through `kit.inlineMarkdown` with class `round-overview` when
  not blank, `kit.progress`), then `section.review` (`h2.review-title` `Review`, `kit.summary`, `ol.review-rows`
  with one `kit.row` per `input.rows`, `kit.roundNote`, `div.review-actions` with `kit.sendButton` and
  `kit.cancelButton`). Its header comment names the parts each card and pane may leave out.
- `forms.css` (tokens only, `DESIGN.md` § Tokens and themes; kit-part rules stay global under `:where(.form-tab)`,
  since any layout's kit parts draw them):
  - remove `.finding-actions`, `.action-picks`, `.action-picks.is-locked`, `.action-picks.is-locked .ui-button` and
    `.choices.is-dimmed`
  - add `.choice-group + .choice-group { margin-top: var(--wg-space-3) }`; `.choice-group-reason` with
    `color: var(--wg-fg-secondary)` and the `.choice-reason` left margin; `.choice-group-pick` as `.choice-pick`
    plus the selected and recommended number rules of `.choice` (`.choice-group-pick.is-selected`,
    `.choice-group-pick.is-recommended .choice-number`); `.choice-group.is-locked { opacity: 0.55 }` and
    `.choice-group.is-locked .choice-pick { pointer-events: none }`
  - the rail, round head and review rules stay as they are (the kit parts keep the classes)
- The selftest layout's question card (`selftest-script.ts`) calls `kit.choiceList`, which the question kit keeps;
  08 owns that file.

GIVEN a caused finding with choices `[A fix_now, B fix_now]`, `recommend: 1`, and `action_reasons.follow_up` `Needs a
spike first`
WHEN the default layout draws its card
THEN it reads `Fix now` / `1 A` (Recommended) / `2 B` / `Follow-up (3)` with `Needs a spike first` under it /
`Leave it (4)`, each header's `(3)` / `(4)` in its `span.choice-number`, and no Action row

GIVEN a user layout `mine` defining only `rail`, named by the round
WHEN the round shows
THEN the rail comes from `mine` with `data-layout="mine"`, and the cards and the review from `default`

GIVEN a layout whose `review` throws
WHEN the round view builds
THEN the log holds `layout mine review failed: <error>` and the default review shows with its note box, its root
carrying `data-layout="default"`

Tests:
- `card-kit.test.ts` (new):
  - `choiceGroupsOf_ActionWithoutChoices_HeaderTakesNumber` — caused `[A fix_now, B fix_now]`: groups
    `fix_now` (choices numbered 1, 2; `number` null), `follow_up` (`number` 3, no choices), `leave_it` (`number` 4)
  - `choiceGroupsOf_ChoicesOutOfWireOrder_NumberDownTheCard` — `[A follow_up, B fix_now]`: `fix_now` choice `B` is
    number 1 with `choice` 2; `follow_up` choice `A` is number 2 with `choice` 1
  - `choiceGroupsOf_ActionReasons_OnTheirGroup` — `actionReasons { leave_it: 'Out of scope' }` puts
    `Out of scope` on the `leave_it` group and null on the others; a blank text gives null
  - `choiceGroupsOf_RecommendNull_TagsTheHeader` — `recommend: null`, `recommendAction: 'leave_it'`: the `leave_it`
    group is recommended and no choice is
  - `choiceGroupsOf_Recommend_TagsOnlyThatChoice` — `recommend: 2` under `fix_now`: choice 2 is recommended,
    choice 1 is not
- `read-layout.test.ts`: `readLayout_OnlyRail_ReturnsIt`; `readLayout_RailNotFunction_Throws`
  (`layout mine: rail is not a function`); `readLayout_ReviewNotFunction_Throws`
- `layout-resolver.test.ts`: `pickLayout_Rail_PicksFirstDefiningIt` (replaces `pickLayout_RailAndReview_PickDefault`);
  `pickRoundLayouts_PanesSkipTheItemLayout` — an item's layout defining `review` does not draw the review
- `card-input.test.ts`: `findingCardInput_ActionReasonsAndNullRecommend` — the input carries the finding's
  `actionReasons` and `recommend: null`
- `view-model.test.ts`: `reviewSummaryText_WithUntouched_AddsTheSentence` — `{ answered: 1, notApplicable: 0,
  untouched: 2, total: 3 }` gives `1 of 3 answered. 2 not answered; they are sent as untouched.`;
  `reviewSummaryText_NoneUntouched_EndsAtTheCount` gives `3 of 3 answered.`

Approach: Vitest runs in `node`, so no test builds DOM; what the default layout draws, the pane hosts and the CSS are
checked live by 08's self-test steps and screenshots and by the final verification (10).

Done when: `npm run lint` (layers and styles) and `npm test` pass with the tests above; `grep -n "buildReviewRow\|
buildRailEntry\|buildHead" src/plugins/forms/page/round-view.ts` finds nothing; `layouts/default/layout.js`
type-checks as `CompleteLayout`.
Commit:    one commit for the group

## Proof

