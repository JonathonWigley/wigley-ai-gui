# 02 — Layout contract, the kit, the card host and the default layout

Status: in progress
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     create `src/plugins/forms/layouts/layout.d.ts` · create `src/plugins/forms/layouts/default/layout.js`
           · create `src/plugins/forms/page/layout/card-kit.ts` · create `src/plugins/forms/page/layout/layout-cards.ts`
           · modify `src/plugins/forms/page/kinds/item-format.ts`, `kinds/formats.ts`, `kinds/card-parts.ts`,
             `kinds/question/question-card.ts`, `kinds/notice/notice-card.ts`, `kinds/finding/finding-card.ts`
           · modify `src/plugins/forms/page/round-view.ts`, `src/plugins/forms/page/forms-view.ts`
           · modify `src/plugins/forms/page/editor-boxes.ts` · test `src/plugins/forms/page/editor-boxes.test.ts` (extend)
           · test `src/plugins/forms/page/kinds/card-input.test.ts` · test `src/plugins/forms/page/layout/layout-actions.test.ts`
           · test `src/plugins/forms/page/layout/card-answer.test.ts`
Consumes:  the page `ItemFormat` table, `card-parts.ts`, the verdict and action row in `finding-card.ts` (in the tree)
Produces:  the types below in `src/plugins/forms/layouts/layout.d.ts`
           `export default layout` (a `Layout`) in `src/plugins/forms/layouts/default/layout.js`
           `export function buildLayoutCard(layout: Layout, layoutName: string, parent: HTMLElement, round: RoundState, item: RailItem, position: number, deps: CardDeps): ItemCard`
             in `src/plugins/forms/page/layout/layout-cards.ts`
           `cardInput(round: Round, index: number): <the kind's card input>` on each page format, in place of `buildCard`
           `export interface RoundView { element: HTMLElement; update(round: RoundState, view: FormsView): void; setLayout(layout: Layout, layoutName: string, round: RoundState): void }`
             in `round-view.ts`
           `setLayout(layout: Layout, layoutName: string): void` on what `mountFormsView` returns, in `forms-view.ts`
           `export function layoutActions(action: LayoutAction, position: number): FormsAction[]` in `card-kit.ts`
           `export function cardAnswer(round: RoundState, item: AnswerableItem): CardAnswer` in `layout-cards.ts`
Decisions: the layout gets the built-in cards' contract plus the kit, and returns `{ element, update }` (round 2) ·
           cards may show the round heading and overview, which they get as data (round 2 note) · the built-in look is
           the `default` layout in `// @ts-check` JS (round 2) · `layout.d.ts` is the single source of the types
           (design review) · kit parts update themselves (design review, depth)
Commit:    one commit for the group

## The contract — `layout.d.ts`, pinned

It is copied to the user's layouts folder as is, so it imports nothing and declares every type it names. The app's
TS imports these types from it, so the compiler checks the app's card input against them structurally.

```ts
export interface RoundInfo { heading: string; overview: string }

export interface QuestionCard {
  label: string; title: string; question: string; context: string;
  choices: string[]; recommend: number; rationale: string; round: RoundInfo;
}
export interface NoticeCard {
  label: string; title: string; context: string; badge: string; round: RoundInfo;
}
export type FindingAction = 'fix_now' | 'follow_up' | 'leave_it';
export interface FindingCard {
  label: string; title: string;
  card: 'defect' | 'decision' | 'nit';
  origin: 'caused' | 'pre_existing' | 'design' | 'nit';
  severity: 'critical' | 'important' | 'minor' | null;
  // The card's own words: its kind label and the titles of its two sections.
  words: { kind: string; finding: string; proof: string };
  originChip: string; severityChip: string | null;
  impact: string; finding: string; proof: string;
  choices: { text: string; reason: string }[]; recommend: number;
  recommendAction: FindingAction;
  // The actions the origin offers, in the card's words.
  actions: { action: FindingAction; label: string }[];
  round: RoundInfo;
}

export interface CardAnswer {
  status: 'answered' | 'not_applicable' | 'untouched';
  choice: number | null; notApplicable: boolean; dontAsk: boolean;
  action: FindingAction | null;
}

export type LayoutAction =
  | { type: 'choose'; choice: number }
  | { type: 'chooseAction'; action: FindingAction }
  | { type: 'toggleNotApplicable' } | { type: 'toggleDontAsk' }
  | { type: 'accept' } | { type: 'focus' };

// Every part appends itself to `parent` and returns what it appended.
export interface HeadKit {
  el(parent: HTMLElement, tag: string, className?: string, text?: string): HTMLElement;
  markdown(parent: HTMLElement, text: string, className?: string): HTMLElement;
  inlineMarkdown(parent: HTMLElement, text: string, className?: string): HTMLElement;
  section(parent: HTMLElement, label: string, text: string): HTMLElement | null;
  // The keys bound to a forms command (its short name, as `choose1`) in the forms view; null when unbound or unknown.
  keys(command: string): string | null;
}
export interface Kit extends HeadKit {
  // `header.item-head` holding the kind label and the status chip, which updates itself; returns the header.
  // A card that leaves it out still gets `data-status` on its element.
  itemHead(parent: HTMLElement, kind: string): HTMLElement;
  // Mounts the item's text box for `field`. Each box mounts once per card. Any box the card leaves unmounted, the
  // app appends in its default field at the end of the card, so the box keys always reach it.
  textBox(parent: HTMLElement, field: 'notes' | 'dontAskReason' | 'comment'): HTMLElement;
  // Focuses this card's item, then runs the action.
  run(action: LayoutAction): void;
}
export interface AnswerKit extends Kit {
  // `div.answer` with its 'Your answer' label and `ol.choices`; returns the `div.answer`, which `actionRow` and
  // `answerControls` may be appended to. 'recommended': the recommended choice's reason under it (a question's
  // rationale as 'Why recommended'; a finding's choice reason as 'Why'). 'all': every choice's reason as 'Why'; on a
  // question the same as 'recommended'. A blank reason draws nothing. On a finding card the list dims while the
  // action is leave_it.
  choiceList(parent: HTMLElement, reasons: 'recommended' | 'all' | 'none'): HTMLElement;
  // The Notes box, the Not applicable and Don't ask toggles, and the reason box.
  answerControls(parent: HTMLElement): HTMLElement;
}
export interface FindingKit extends AnswerKit {
  verdict(parent: HTMLElement): HTMLElement;
  actionRow(parent: HTMLElement): HTMLElement;
}

// `update` runs with the item's current answer while its card shows; the kit's parts update themselves.
export interface LayoutCard { element: HTMLElement; update?(answer: CardAnswer): void }

export interface Layout {
  cards: {
    question(parent: HTMLElement, input: QuestionCard, kit: AnswerKit): LayoutCard;
    finding(parent: HTMLElement, input: FindingCard, kit: FindingKit): LayoutCard;
    notice(parent: HTMLElement, input: NoticeCard, kit: Kit): LayoutCard;
  };
  // Drawn above the cards in the forms view, once per round.
  head?(parent: HTMLElement, round: RoundInfo, kit: HeadKit): void;
}
```

A notice card's `update` is never called: a notice takes no answer. `textBox` on a notice card accepts `comment`
alone, and on an answerable card `notes` and `dontAskReason`; the wrong field throws naming the kind and the field.

## The default layout

`layouts/default/layout.js` opens with `// @ts-check` and types its export with
`/** @type {import('../layout').Layout} */`. It draws exactly today's DOM: the same elements, classes and order as
`question-card.ts`, `notice-card.ts` and `finding-card.ts` draw now, so `forms.css` and the self-test hold unchanged.
It has no `head`. Questions use `choiceList(…, 'recommended')`, findings `'all'`.

## The page side

- **Kinds**: each page format drops `buildCard` and gains `cardInput`, which maps the round item to its card type.
  The finding's comes from `verdictOf` (chips, impact), `CARD_TEXT` (words) and `actionLabel` (actions). The compiler
  checks a new kind needs a card input and a `cards` entry: type `PageFormats` against `Layout['cards']`'s keys.
- **Kit** (`card-kit.ts`): builds a card's kit over `CardDeps` from `card-parts.ts` and the finding card's verdict and
  action row, which move into kit parts unchanged. Each part that shows answer state (status chip, choice list, answer
  controls, action row) registers an updater, and the card host runs them all on `update`. `run` maps each
  `LayoutAction` to today's `FormsAction` after `focusItem`, as the card's clicks do now (`accept` →
  `acceptRecommendation`, `toggleDontAsk` → `deps.toggleDontAsk()`).
- **Card host** (`buildLayoutCard`): builds through `layout.cards[kind]`. When the builder throws, it removes what the
  builder appended, builds the default layout's card in its place, and logs
  `layout <layoutName> <kind> card failed: <errorText>` with source `forms` (shown as `[forms] layout …`). It returns an `ItemCard` whose `update` runs the
  kit's updaters, then the layout card's `update` with the item's `CardAnswer`. A throw from the layout's `update` is
  logged once per card as `layout <layoutName> <kind> card update failed: <errorText>`, and the kit's updaters
  still run.
- **Round view**: builds cards through `buildLayoutCard`, and calls `layout.head` into a slot above the items pane,
  which shows in the forms view only. The review keeps its built-in head and progress line. `setLayout` keeps the
  view's root element in its tab and rebuilds the view's children: it destroys the round's editor boxes
  (`boxes.destroyRound`), builds the rail, head, cards and review again, and remounts every box from the round state.
  Focus and the shown view stay as the state holds them.
- **Forms view**: starts every round view on the default layout. `setLayout` stores the layout and name, and calls
  each open round view's `setLayout` with its current state; rounds that open later are built with it.

GIVEN a round with a finding whose origin is `design` WHEN its card input is built THEN `card` is `decision`,
`severity` and `severityChip` are null, and `actions` lists the design origin's actions in the Decision words.

Tests:

- `card-input.test.ts` (rounds from `page/test-rounds.ts`):
  - `questionCardInput_CarriesRationaleAndRound`: label, choices, recommend, rationale, and the round's heading and
    overview.
  - `findingCardInput_Decision_HasNoSeverityAndDecisionWords`: the GIVEN/WHEN/THEN above, the action labels read from
    `actionLabel` for the test's own origin.
  - `findingCardInput_Defect_CarriesSeverityChip`.
  - `noticeCardInput_CarriesBadge`.
- `layout-actions.test.ts`, over the pure `layoutActions(action: LayoutAction, position: number): FormsAction[]`
  exported from `src/plugins/forms/page/layout/card-kit.ts` (the kit's `run` dispatches what it returns, and calls
  `deps.toggleDontAsk()` for `toggleDontAsk`, which it returns no `FormsAction` for):
  - `layoutActions_Choose_FocusesThenChooses`: `[{ type: 'focusItem', item: 4 }, { type: 'choose', choice: 2 }]`.
  - `layoutActions_Accept_FocusesThenAcceptsRecommendation`.
  - `layoutActions_Focus_FocusesOnly`.
- `card-answer.test.ts`, over the pure `cardAnswer(round: RoundState, item: AnswerableItem): CardAnswer` exported
  from `layout-cards.ts`:
  - `cardAnswer_Untouched_HasNullChoiceAndAction`.
  - `cardAnswer_FindingWithActionAndChoice_CarriesBoth`.
  - `cardAnswer_NotApplicable_StatusNotApplicable`.

The suite runs in Vitest's `node` environment with no DOM library (`vitest.config.mts`), so the card host's DOM
behaviour — the fallback card, removing what a throwing builder appended, the layout `update` throw logged once,
`textBox`'s wrong-field throw — is proved by task 07's self-test steps, not by unit tests. Adding a DOM test library
is a third-party install and is out of this plan.

Done when: compiles (`npm run typecheck` checks `layout.js` through `// @ts-check`); `npm run lint` passes; the test
gate runs the tests above; the cards draw as before (the self-test's existing steps, run by the test gate or task 07).

## Cold-read rulings

- **Boxes**: `EditorBoxes` gains `destroyBox(box: BoxRef): void` (modify `src/plugins/forms/page/editor-boxes.ts`,
  test `editor-boxes.test.ts`: `destroyBox_ThenMountSameBox_Mounts`). The card host hands the kit a `mountBox` that
  records each box it mounts. When the builder throws, the host destroys those boxes, then removes the DOM and builds
  the default card. A second `textBox` for the same field in one card throws `<kind> card mounted <field> twice`. A
  wrong field throws `<kind> card has no <field> box`. Both throws fall back the same way. After a layout card
  builds, the host appends the default field for each of the item's boxes still unmounted: the Notes and reason
  fields (the reason hidden unless Don't ask is on) or the notice's Comment field.
- **`data-status`**: the host sets `element.dataset.status` on the layout card's element in `update`, as `showAnswer`
  does today.
- **Notice badge**: `itemHead` returns the `header`. The default notice builds `header.item-head` > `span.item-kind` +
  `span.badge.badge-notice[data-badge]` with `el`, and does not call `itemHead`.
- **`label`**: the item number, `labelFor(railPrefix, index)` (`1`, `F2`, `N1`).
- **`keys`**: takes the short command name and qualifies it with `formsCommand`; an unknown name returns null.
- **`layoutActions({ type: 'toggleDontAsk' }, p)`** returns `[{ type: 'focusItem', item: p }]`, and `run` then calls
  `deps.toggleDontAsk()`. Add the test `layoutActions_ToggleDontAsk_FocusesOnly`.
- **Head kit**: `head` gets a `HeadKit` (`el`, `markdown`, `inlineMarkdown`, `section`, `keys`), as typed above.
- **`RoundView.setLayout`**: the round view keeps the last `view` `update` received, and ends `setLayout` with
  `update(round, lastView)`.
- **Self-test**: the fallback, the update-throw line and the wrong-field throw are proved by task 07's steps, with
  the lines pinned there.

## Proof
