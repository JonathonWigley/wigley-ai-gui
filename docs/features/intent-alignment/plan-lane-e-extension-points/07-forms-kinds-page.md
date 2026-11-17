# 07 — Forms item kinds register on the page

Status: not started
Type: Task
Wave: 2 (Part A) and 3 (Part B) · Depends on: 06
Plan: [plan.md](plan.md)

The page's closed per-kind tables become one registration per kind, `PageKind`, made through
`FormsPageExports.registerKind`. The three built-in kinds register through the same call in forms' own page start.
A forms layout keeps its `question`, `finding` and `notice` cards and gains a `kinds` record and an `other` card.

**Size.** This document is past one implementer's reading (measured at plan time: about 517k bytes of code and
tests in the Files line, Part A about 384k of it; re-verify). Part A stays one group however large: it is one type
change and the call sites it ripples to, which must compile together. `wigley:make` may run it as two groups in order: **Part A** (state, registry, contract,
kinds, boxes, review model, start) and then **Part B** (layout contract, `default` layout, kit, card host, resolver,
reader, panes). Each Files entry below is tagged A or B. Part B consumes Part A's Produces. When it runs as one
group, the order of work is A, then B.

Files:
- A · modify `src/plugins/forms/contract.ts` — `ItemKind` widened, `Round.items`, `Round.bodyKeys`,
  `PageKind` and the types it references, `ItemAnswer` moved in, `FormsPageExports.registerKind`, `FormsItemRef.kind`
- A · modify `src/plugins/forms/main/round.ts`, `main/round-type.ts` — `KindRound` folded into `Round`,
  `parseRound` fills `Round.bodyKeys` (not hashed) · test `main/round.test.ts`, `main/round-type.test.ts`; and
  `main/mcp-wording.ts` with its test when they name `KindRound` after 06 (see the second item below)
- A · create `src/plugins/forms/page/kinds/page-kinds.ts` — the registry and the kind table
- A · test `src/plugins/forms/page/kinds/page-kinds.test.ts` (create)
- A · modify `src/plugins/forms/page/kinds/formats.ts` — `FORMATS` becomes `BUILT_IN_PAGE_KINDS`; `itemLabel`
- A · modify `src/plugins/forms/page/kinds/item-format.ts` — `ItemFormat`, `AnswerableFormat`, `PageFormats`
  deleted; `CardInputs`, `CardKits` keyed by the three built-in card names
- A · modify `src/plugins/forms/page/kinds/question/question-card.ts`, `kinds/finding/finding-card.ts`,
  `kinds/notice/notice-card.ts` — each exports its `PageKind`
- A · modify `src/plugins/forms/page/form-state.ts`, `page/boxes.ts`, `page/view-model.ts`, `page/forms-commands.ts`,
  `page/forms-events.ts`, `page/start.ts`, `page/test-rounds.ts`; the call sites in `page/forms-view.ts`,
  `page/round-view.ts`, `page/autosave.ts`
- A · test `page/form-state.test.ts`, `page/boxes.test.ts`, `page/view-model.test.ts`, `page/forms-events.test.ts`,
  `page/start.test.ts`, `page/kinds/formats.test.ts`, `page/kinds/card-input.test.ts`, and each other page test
  that calls `apply`, `initialState` or a reader whose argument changes (measured at plan time: `autosave.test.ts`,
  `forms-commands.test.ts`, `forms-view.test.ts`, `round-view.test.ts`, `layout/card-answer.test.ts`; re-verify)
- B · modify `src/plugins/forms/layouts/layout.d.ts`, `src/plugins/forms/layouts/default/layout.js`
- B · modify `src/plugins/forms/page/layout/card-kit.ts`, `layout/layout-cards.ts`, `layout/layout-resolver.ts`,
  `layout/read-layout.ts`, `layout/layout-panes.ts`
- B · test `page/layout/card-kit.test.ts`, `layout/layout-cards.test.ts`, `layout/layout-resolver.test.ts`,
  `layout/read-layout.test.ts`, `layout/layout-panes.test.ts`

Consumes (← 06, word for word with plan.md and 06's document):
- `type BuiltInItemKind = 'notice' | 'finding' | 'question'`; `ItemKindSpec { id; argsKey; bodyKey; resultKey;
  fingerprintJoinsWhenEmpty; answerable }` in `contract.ts` ← 06
- `BUILT_IN_KIND_SPECS: Readonly<Record<BuiltInItemKind, ItemKindSpec>>` in `src/plugins/forms/item-kinds.ts` ← 06.
  Each built-in `PageKind.spec` is its entry there.
- `KindRound extends Round { items: Readonly<Record<string, readonly unknown[]>> }` in `main/round.ts`, and
  `parseRound` filling both `items` and the named `questions`, `notices`, `findings` ← 06
- `FormBody` and `AnswersPayload` keep their named members plus an index signature: a kind's draft entries sit at
  its `spec.bodyKey` (`answers`, `finding_answers`, `notice_comments`, a plugin kind's own key) ← 06. This stays the
  edge shape the store saves and the page sends, so saved files keep their bytes.

This task finishes what 06 left closed (06 kept the page compiling on the old shapes):
- **Widen `ItemKind`** to `string` in `contract.ts` (06 left it the closed union). The page's `[K in ItemKind]`
  mapped types and `AnswerOf[K]` go with the tables they index (see "What each closed table becomes").
- **Move the record into `Round`.** The contract `Round` gains `items: Readonly<Record<ItemKind, readonly
  unknown[]>>` and drops `questions`, `notices` and `findings`. Main's `KindRound` goes: `parseRound` returns
  `Round`, and 06's copy of the built-ins into the named lists is deleted. Every main file that names `KindRound`
  changes to `Round` (measured at plan time from 06's document: `main/round.ts`, `main/round-type.ts` and their
  tests; since Lane H's Structured round results, also `main/mcp-wording.ts` and `main/mcp-wording.test.ts` when
  06's ruling on its Open B passes a `KindRound` there; re-verify with `grep -rn KindRound src`).
  `main/mcp-wording.test.ts` and `main/forms-tools.golden.txt` pin every wire text: they keep their literals. A kind with no items may have no key; the page reads
  `round.items[kind] ?? []`. The built-in items keep their types (`Question`, `Notice`, `Finding`).
- **Draft entries by `bodyKey`.** The page reads a kind's saved entries as `body[kind.spec.bodyKey]` and
  `buildBody` writes each kind's `restore.encode` result there, with `note` first and the keys in the order 06's
  `readFormBody` writes them. A kind with no registration keeps its entries under its key unchanged (`heldEntries`
  below is keyed by kind id; the key it writes back to is the held kind's `bodyKey`, so `heldEntries` holds the
  `bodyKey` with the entries — `Readonly<Record<ItemKind, { bodyKey: string; entries: readonly unknown[] }>>`).
  A held kind's `bodyKey` comes from main: the page cannot know it without the registration, so the contract
  `Round` carries `bodyKeys: Readonly<Record<ItemKind, string>>`, filled in `parseRound` from the registered kinds'
  specs and left out of the fingerprint and of the body. A kind registered after the round parsed has no items and
  no key in it.

Produces (A), in `src/plugins/forms/contract.ts`. Every function member is a method signature, so a built-in typed
as `PageKind<Finding, FindingAnswer, FindingCard>` assigns to `PageKind` (method parameters are bivariant):

```ts
// Moved unchanged from page/form-state.ts.
export interface ItemAnswer { choice: number; notApplicable: boolean; notes: string; dontAsk: boolean; dontAskReason: string }

// One text box an item's card mounts. `keys` is the command whose keys the field's label shows; null for none.
export interface KindBox { field: string; label: string; hint: string; className: string; keys: CommandId | null }

export interface KindDraftCodec<Item, Answer> {
  // One answer per item: from the entry whose 1-based `index` names it, else `reduce.untouched(item)`.
  decode(items: readonly Item[], entries: readonly unknown[]): Answer[];
  // One saved entry per answer, `index` 1-based, in the shape `decode` reads.
  encode(answers: readonly Answer[]): unknown[];
}

// Called only while the answer is applicable: forms checks `notApplicable` first. Each returns `answer` itself
// when nothing changes. `number` is 1-based down the card.
export interface KindPick<Item, Answer> {
  choose(item: Item, answer: Answer, number: number): Answer;
  clear(item: Item, answer: Answer): Answer;
  recommended(item: Item, answer: Answer): Answer;
  isComplete(item: Item, answer: Answer): boolean;
  number(item: Item, answer: Answer): number;
  // The choice the agent gets for a complete pick; 0 for a pick with no choice.
  choice(item: Item, answer: Answer): number;
  choiceText(item: Item, choice: number): string;
  // The recommended choice, 1-based; 0 when the recommendation has no choice.
  recommend(item: Item): number;
  // Whether a complete pick earns the review's Recommended badge.
  isRecommended(item: Item, answer: Answer): boolean;
}

export interface KindReduce<Item, Answer> {
  untouched(item: Item): Answer;
  text(answer: Answer, field: string): string;
  withText(answer: Answer, field: string, value: string): Answer;
  // Given exactly when `spec.answerable`; then `Answer` extends `ItemAnswer`.
  pick?: KindPick<Item, Answer>;
}

export interface KindBoxes<Answer> {
  // Every box an item's card mounts, in default order.
  fields: readonly KindBox[];
  // The fields of `fields` the user can reach now, in Tab order.
  shown(answer: Answer): readonly string[];
}

export interface KindCardInput<Item, Input> {
  // The item number's prefix on its card head, the rail and the review.
  railPrefix: string;
  title(item: Item): string;
  // The layout the item names; null for none.
  layout(item: Item): string | null;
  // The data a layout builds the item's card from. `index` is 1-based within the kind.
  input(item: Item, index: number, round: Round): Input;
}

export interface PageKind<Item = unknown, Answer = unknown, Input = unknown> {
  spec: ItemKindSpec;
  restore: KindDraftCodec<Item, Answer>;
  reduce: KindReduce<Item, Answer>;
  boxes: KindBoxes<Answer>;
  cardInput: KindCardInput<Item, Input>;
  // The kind's place among rail stops, ascending, ties in registration order; null only for `notice`, whose items
  // draw on the notices stop.
  railOrder: number | null;
}

// FormsPageExports gains:
registerKind(kind: PageKind): Disposable;

// FormsItemRef.kind becomes ItemKind.
```

Produces (A), in `src/plugins/forms/page/kinds/page-kinds.ts`:

```ts
export interface PageKindTable {
  get(id: ItemKind): PageKind | undefined;
  // The registered kinds with a rail order, by rail order, ties in registration order.
  readonly railKinds: readonly PageKind[];
}
export interface PageKinds {
  register(kind: PageKind): Disposable;
  table(): PageKindTable;
  onChanged(listener: () => void): Disposable;
}
export function createPageKinds(): PageKinds;
export function pageKindTable(kinds: readonly PageKind[]): PageKindTable;
```

Produces (A), elsewhere:
- `export const BUILT_IN_PAGE_KINDS: readonly PageKind[]` in `page/kinds/formats.ts`, in the order `notice`,
  `finding`, `question`.
- `noticePageKind`, `findingPageKind`, `questionPageKind` in their `…-card.ts` modules, replacing `noticeFormat`,
  `findingFormat`, `questionFormat`.
- `export function itemLabel(kinds: PageKindTable, item: RoundItem): string` in `page/kinds/formats.ts`.
- In `page/form-state.ts`:
  - `export function createFormsState(kinds: () => PageKindTable): { apply: FormsReducer; initialState(rounds:
    PresentedRound[], activeSessionId: string | null): FormsState }` and
    `export type FormsReducer = (state: FormsState, action: FormsAction) => FormsState`, replacing the module
    constants `apply` and `initialState`.
  - `RoundState` loses `answers`, `findingAnswers`, `noticeComments` and gains `kinds: PageKindTable`,
    `itemAnswers: Readonly<Record<ItemKind, readonly unknown[]>>` (each registered kind's answers, one per item) and
    `heldEntries: Readonly<Record<ItemKind, { bodyKey: string; entries: readonly unknown[] }>>` (each unregistered
    kind's draft entries, unchanged, with the key they write back to).
  - `export type RoundItem = { kind: ItemKind; index: number }`; `export type AnswerableItem = RoundItem`;
    `export type NoticesStop = { kind: 'notices' }`; `export type RailItem = RoundItem | NoticesStop`;
    `export function isNoticesStop(item: RailItem): item is NoticesStop`.
  - `export type TextTarget = { field: 'note' } | { field: string; item: RoundItem }`.
  - The action `{ type: 'kindsChanged'; kinds: PageKindTable }` in `FormsOwnAction`, listed in `sendingActions`.
  - `export function kindItems(round: Round, kind: ItemKind): readonly unknown[]`;
    `export function kindAnswer(round: RoundState, item: RoundItem): unknown`;
    `export function unregisteredKinds(round: RoundState): { kind: ItemKind; count: number }[]`.
  - `railItems`, `answerableItems`, `railPosition` take `RoundState` in place of `Round`.
- In `page/layout/layout-resolver.ts`: `itemLayout(round: RoundState, item: RoundItem)` and
  `roundLayoutNames(round: RoundState)`. In `page/view-model.ts`: `railEntryTitle(round: RoundState, item: RailItem)`.

Produces (B), in `src/plugins/forms/layouts/layout.d.ts`:

```ts
// The card of an item whose kind no layout in the chain has a `kinds` builder for.
export interface OtherCard { kind: string; label: string; title: string; round: RoundInfo }
// A plugin kind's card kit: `answerControls` is present when the kind takes an answer.
export interface KindKit extends Kit { answerControls?(parent: HTMLElement): HTMLElement }
export type KindCardBuilder = (parent: HTMLElement, input: unknown, kit: KindKit) => LayoutCard;
// LayoutCards gains:
kinds?: Readonly<Record<string, KindCardBuilder>>;
other(parent: HTMLElement, input: OtherCard, kit: KindKit): LayoutCard;
// Kit.textBox's field becomes string; RailEntryInput.kind and ReviewRowInput.kind become string.
```

Produces (B), in `page/layout/layout-resolver.ts`: `export type LayoutPart = { card: ItemKind } | { pane: LayoutPane }`,
and `LayoutPane` exported.

Decisions:
- **Where PageKind lives.** `PageKind` and every type it names sit in forms' `contract.ts`. No member names a DOM or
  layout-kit type: the kit stays forms' own, and `cardInput.input` returns plain data typed `unknown` at the contract.
  So the contract imports only `src/contracts` (`CommandId`, `Disposable`), as the layer rules allow. The built-in
  kind modules in `page/kinds/` type their `Input` with `layout.d.ts`'s card types, which `page/` may import.
- **The registry.** `createPageKinds().register` throws, registering nothing, for: an id already registered, the
  id `notices`, a `railOrder` of null on any id but `notice`, and `reduce.pick` given when `spec.answerable` is false
  or missing when it is true. Its `Disposable` removes the kind and notifies once; a second dispose does nothing.
  `onChanged` hears each register and each removal.
- **Built-ins register the same way.** `formsPagePart.start` calls `kinds.register` for each of
  `BUILT_IN_PAGE_KINDS`, then creates the store. Disposing these is part of `dispose`. `exports(consumer)` gives
  `registerKind: (kind) => consumer.track(kinds.register(kind))`.
- **Rail order.** `notice`: null. `finding`: 10. `question`: 20. Today's order (findings, then questions, then the
  notices stop) does not change. A plugin kind at 15 sits between them.
- **Rail, review and progress.** `railItems` gives one stop per item of each kind in `railKinds`, then the notices
  stop when the round has notice items. `answerableItems` gives the stops of the answerable kinds, in rail order:
  the review rows and the progress count. A stop of a kind with `answerable: false` has no review row, no progress
  count and no answer keys: `choose`, `clearChoice`, `acceptRecommendation`, `toggleNotApplicable` and `toggleDontAsk`
  change nothing on it. Its rail entry's status is `none`: `data-status="none"`, an idle dot, never flagged.
- **The notices stop stays forms' own** for the kind `notice`: `openNotices`, `noticeLine`, the notices pane, the
  notice commands and `RoundPlace.noticeLine` keep their behaviour. Notice comments become the notice kind's answers
  (`{ comment: string }`), boxed as `{ field: 'comment', item: { kind: 'notice', index } }`. A box target with no
  rail order kind focuses with `focusNotice`; any other with `focusItem`.
- **The reducer reads kinds.** `createFormsState(kinds)` builds the reducer; `formShown` restores with `kinds()` at
  that action. Each round holds the table it was derived with (`RoundState.kinds`), so every reader takes the
  `RoundState`. Start dispatches `{ type: 'kindsChanged', kinds: kinds.table() }` from `kinds.onChanged`, then calls
  `view.rebuild()`. Tests build `createFormsState(() => pageKindTable(BUILT_IN_PAGE_KINDS))`.
- **kindsChanged** re-derives every open round. A kind that left: its answers are encoded with the leaving kind's
  `restore.encode` into `heldEntries`. A kind that arrived: its held entries decode with `restore.decode`. A kind
  replaced under the same id: encode with the old kind, decode with the new one. The focused stop is kept when it is
  still on the rail; else focus clamps to the last stop. `reviewRow` clamps to the last review row. `revision` does
  not change: a re-derive is not an edit.
- **A round naming a kind the page has no registration for.** Main rejects an unknown kind at parse (06), but the page
  can still hold one: the kind's plugin page part stops or reloads (a switch-off stops page parts before main parts; a
  user plugin's reload stops its page part), or its page part fails to start while its main part runs. The page then
  keeps that kind's draft entries in `heldEntries` and gives its items no rail stop, review row, card or progress
  count. `buildBody` writes the held entries back unchanged, so autosave and a send lose nothing. Start logs and
  toasts once per round and kind, on the first store change that shows it: log
  `round <roundId> holds <count> <kind> items with no page kind`, toast
  `<count> <kind> item(s) in <label> wait for the plugin that draws them`. When the kind registers, kindsChanged
  restores its answers from the held entries.
- **Draft codec and saved drafts.** Each built-in kind's `restore` keeps today's rules: `restoreAnswer`,
  `restoreFindingAnswer` and the notice comment read move into the built-in `restore.decode`; `answerEntry`,
  `findingAnswerEntry` and the notice comment write move into `restore.encode`. `encode` writes today's key order:
  `index, choice, not_applicable, notes, dont_ask, dont_ask_reason`, then `action` on a finding; a notice
  `index, comment`. A draft autosaved before this change restores after it, since the body keeps its `bodyKey`
  arrays.
- **Built-in pick rules.** The question kind's `pick` holds today's `choose`, the clear in `clearChoice`, and its
  `RECOMMENDED_PICKS` branch. The finding kind's `pick` calls `chooseEntry`, `clearFindingPick` and `holdsPick`,
  which stay in `form-state.ts` and become exported: they are task 08's and task 10's to move. `isRecommended`:
  question `answer.choice === item.recommend`; finding `answer.action === item.recommend_action &&
  findingSolution(item, answer.choice, answer.action) === (item.recommend ?? 0)`. `choice`: question
  `answer.choice`; finding `findingSolution(...)`.
- **What stays as it is.** `findingActionOf`, `findingActionWord`, `actionLabel`, `ORIGIN_CHIPS`, `CARD_TEXT`, the
  review row's `action`, `actionLabel` and `tookActionRecommendation`, and `cardAnswer`'s `action` stay finding-specific
  for task 08; they read finding items and answers through `kindItems` and `itemAnswers.finding`. `FindingAnswer`
  stays in `form-state.ts`. `forms-commands.ts`'s `ANSWER_FIELDS` (`notes`, `comment`) and the `dontAskReason` focus
  stay: they name box fields, not kinds.
- **What each closed table becomes** (names and locations verified at plan time):

  | Today | After |
  |---|---|
  | `ANSWERABLE_ORDER` (form-state.ts) | `PageKind.railOrder` through `PageKindTable.railKinds` |
  | `ROUND_ITEMS` (form-state.ts) | `kindItems(round, kind)` |
  | `ANSWER_ARRAYS`, `AnswerOf`, `KindItem`, `AnswerArray` (form-state.ts) | `RoundState.itemAnswers`; deleted |
  | `PICK_ANSWERS`, `pickNumber`'s branch (form-state.ts) | `reduce.pick.isComplete`, `reduce.pick.number` |
  | `RECOMMENDED_PICKS` (form-state.ts) | `reduce.pick.recommended` |
  | `TextTarget` union (form-state.ts) | the two-member `TextTarget` above; `setText` calls `reduce.withText` |
  | `buildBody`, `restoreRound` per-kind code (form-state.ts) | `restore.encode`, `restore.decode` |
  | `FORMATS`, `PageFormats`, `ItemFormat`, `AnswerableFormat` (kinds/) | `BUILT_IN_PAGE_KINDS`, `PageKind.cardInput`, `reduce.pick` |
  | `itemBoxes`, `focusActionFor` kind branches (boxes.ts) | `boxes.shown`; rail order null → `focusNotice` |
  | `reviewRows`, `pickedChoice`, `railEntryLabel` (view-model.ts) | `cardInput`, `reduce.pick`; the notice kind's `railPrefix` |
  | `FIELD_CAPTIONS` (card-kit.ts) | each kind's `boxes.fields`, captions verbatim |
  | `KIT_BUILDERS` (card-kit.ts) | every kind: base `Kit`; answerable: plus `answerControls`; `question` and `finding` add today's extras from a table keyed by those two ids |
  | `answerableOf` (card-kit.ts) | `spec.answerable` |
  | `CARD_KINDS` (read-layout.ts) | `question`, `finding`, `notice`, `other`; `kinds` read on its own |
  | `LayoutPart`, `PART_READS` (layout-resolver.ts) | `{ card: ItemKind } \| { pane: LayoutPane }` and one read per part |
  | `CardBuilders`, `CARD_INPUTS` (layout-cards.ts) | the picked builder and `cardInput.input`, or `OtherCard` |
  | `item.kind === 'notices'` (round-view.ts, layout-panes.ts, forms-commands.ts) | `isNoticesStop`; "answerable" checks read `spec.answerable` |

- **A card's text boxes.** `itemTextBoxes` reads `boxes.fields` and `reduce.text`. Each mounted box's field hides
  while its field is not in `boxes.shown(answer)`: this is today's reason box rule, made general. Built-in fields,
  verbatim from `FIELD_CAPTIONS`: `notes` — className `field-notes`, label `Notes`, hint
  `Optional. Your own answer or your reasoning, sent to the agent.`, keys `formsCommand('editNotes')`;
  `dontAskReason` — `field-reason`, `Why not ask this`, `Optional. Sent to the agent with your answer.`, keys null;
  `comment` — `field-comment`, `Comment`, `Optional. Say if this needs a second look.`, keys
  `formsCommand('editNotes')`. Question and finding: fields `notes`, `dontAskReason`; shown `['notes']`, plus
  `dontAskReason` while `dontAsk`. Notice: field `comment`; shown `['comment']`.
- **Which layout draws a plugin kind's card.** Two passes over the item's chain: the first layout whose
  `cards.kinds[id]` is a function; when none does, the first whose `cards.other` is a function (`default` defines
  it). A `kinds` builder gets the kind's own `cardInput.input`; `other` gets `OtherCard` (`kind` the id, `label`
  from `itemLabel`, `title` from `cardInput.title`, `round` the round's heading and overview). A builder that throws
  falls back to `default`, which draws `other`. A built-in kind reads `cards.question`, `cards.finding` or
  `cards.notice` as today.
- **`default`'s `other` card**, pinned:
  ```js
  other(parent, input, kit) {
    const card = kit.card(parent, 'item other');
    kit.itemHead(card, input.kind);
    kit.inlineMarkdown(card, input.title, 'item-summary');
    if (kit.answerControls !== undefined) {
      kit.answerControls(card);
    }
    return { element: card };
  },
  ```
  The kind's boxes the card leaves unmounted are appended at its end, as today. The header comment of `layout.js`
  gains the `other` card in its list of what a layout may leave out.
- **readLayout.** `cards.kinds`, when present, must be an object whose values are functions or undefined. Errors:
  `layout <name>: cards.kinds is not an object`; `layout <name>: cards.kinds.<id> is not a function`.
- `contributions.cardParts(kind)` and `FormsCardPart.kinds` take any kind id; a plugin kind's card gets its parts.
- If `AnswerableKind` is still in `contract.ts` after 06, delete it and use `ItemKind`; if a main file still imports
  it, leave it and report a concern. On Lane H's branch (2026-11-17), `main/round-type.ts` (`ANSWER_LISTS`, which 06
  removes) and `main/mcp-wording.ts` (`summarise`, which 06's Open B ruling settles) import it.

GIVEN the three built-in kinds registered WHEN a round with findings, questions and notices shows THEN the rail,
review rows, boxes, card inputs and saved body equal today's.
GIVEN a saved draft whose entries are today's `AnswerEntry`, `FindingAnswerEntry` and `NoticeComment` shapes WHEN
the round restores THEN each answer and comment restores as today, and `buildBody` returns those entries unchanged.
GIVEN a registered kind already holding id `x` WHEN `registerKind` gets another kind `x` THEN it throws
`page kind x is already added`.
GIVEN `registerKind` with id `notices` THEN it throws `page kind id notices is reserved for the notices stop`.
GIVEN `registerKind` with a null `railOrder` on id `x` THEN it throws
`page kind x has no rail order: only notice draws on the notices stop`.
GIVEN `registerKind` with `spec.answerable` true and no `reduce.pick`, or false and a `pick` THEN it throws
`page kind x: reduce.pick is given exactly when spec.answerable is true`.
GIVEN an answerable plugin kind at rail order 15 WHEN a round holds one finding, one item of it and one question THEN
the rail is F1, the plugin item, then the question, and the review lists all three.
GIVEN a plugin kind with `answerable: false` WHEN its item is focused THEN the choose and toggle keys change nothing,
its kind's shown boxes are reachable, and it has no review row and no progress count.
GIVEN an open round with answers on a plugin kind WHEN the kind's registration is disposed THEN its items leave the
rail, the body still carries their entries, and `revision` is unchanged; WHEN the kind registers again THEN the
answers are back and no `answerChanged` fires.
GIVEN a round holding a kind with no registration WHEN it first shows THEN the page logs and toasts once, with the
texts pinned above.
GIVEN a dependent that called `registerKind` WHEN the dependent stops THEN the kind is gone and the open rounds rebuild.
GIVEN a plugin kind and no layout defining `cards.kinds[id]` WHEN its card draws THEN `default`'s `other` card
draws, with `answerControls` when the kind is answerable.
GIVEN a user layout defining `cards.other` and a later layout in the chain defining `cards.kinds[id]` WHEN the card
draws THEN the `kinds` builder draws it, with the kind's own input.

Tests:
- `page-kinds.test.ts` (new): `register_RejectsEachBadKind` — a table of the four throws and their messages;
  `register_Dispose_RemovesOnceAndNotifiesOnce`; `railKinds_ByRailOrderThenRegistrationOrder` — orders 20, 10, 15, 15
  registered in that order give 10, 15 (first), 15 (second), 20.
- `form-state.test.ts`: rows in `restoring a draft` keep their drafts and values; a new row `restores a draft in the saved shapes of before kinds registered`, with literal entries; a new
  `buildBody` row asserting today's literal entries and key order; `railItems` rows: a plugin kind at 15 sits
  between findings and questions, a non-answerable plugin kind takes stops and no review rows, an unregistered kind
  takes no stop; a new `kindsChanged` describe: leave, return, replace under the same id, focus kept, focus clamped,
  revision unchanged; `choose`, `clearChoice`, `acceptRecommendation` and `toggleNotApplicable` each gain a row on a
  fake answerable plugin kind; `setText` writes a notice comment through its item target.
- `boxes.test.ts`: `shownBoxes` row for a plugin kind's `boxes.shown`; `focusActionFor` row for a comment box with an
  item target; `boxKey` row tells a plugin kind's box from a built-in one.
- `view-model.test.ts`: a `reviewRows` row for an answerable plugin kind reading `title`, `choiceText`, `recommend`
  and `isRecommended` from its kind; the existing rows keep their values.
- `forms-events.test.ts`: row — `kindsChanged` with the same answers emits no `answerChanged`.
- `start.test.ts`: a `registerKind` row in the `a dependent's contribution leaves when the dependent stops` table;
  a row for the log and toast of a round holding an unregistered kind.
- `kinds/formats.test.ts`, `kinds/card-input.test.ts`: the existing rows call `itemLabel(table, …)` and
  `cardInput.input(item, index, round)`; values unchanged.
- `layout/read-layout.test.ts`: rows for `cards.kinds` of functions accepted, `cards.other` accepted, and the two
  errors above.
- `layout/layout-resolver.test.ts`: `pickLayout` rows take `{ card: … }` and `{ pane: … }`; new rows
  `pickCard_PluginKind_KindsBuilderBeatsAnEarlierOther` and `pickCard_PluginKind_NoKindsBuilder_TakesFirstOther`.
- `layout/layout-cards.test.ts`: rows — a plugin kind with no `kinds` builder draws `default`'s `other`
  (`div.item.other`, head tag the kind id, the title); a `kinds` builder gets the kind's own input; an answerable
  kind's kit has `answerControls`, a non-answerable kind's has none.
- `layout/card-kit.test.ts`: rows — a plugin kind's box mounts with its `KindBox` caption, and hides while its field
  is not in `boxes.shown`.
- `layout/layout-panes.test.ts`: a rail entry and a review row of a plugin kind carry its kind id; a non-answerable
  stop's entry carries `data-status="none"`.

Done when: compiles; `npm run lint` passes the layer rules with `PageKind` in `contract.ts`; the test gate runs the
tests above. Live checks defer to task 12 ("Final verification").

Commit: one commit for the group (or one per part when run as Parts A and B).

## Rulings from the plan's cold read

Where the text above and these differ, these win.

- **Parts by compile closure.** Part A is everything the state, registry, reducer and signature change touches,
  including the call-site edits in `layout/card-kit.ts`, `layout/layout-cards.ts`, `layout/layout-panes.ts`,
  `layout/layout-resolver.ts` and their tests, and `itemLayout`, `roundLayoutNames` and `pickRoundLayouts`. The tree
  compiles and the tests pass after Part A alone. Part B is only the new layout surface: `layout.d.ts` (`kinds`,
  `other`, `OtherCard`, `KindKit`, the string widenings), `default/layout.js`'s `other`, `read-layout.ts`, the
  two-pass resolver pick, the builder choice in `layout-cards.ts` and the plugin-kind kit in `card-kit.ts`.
- **A kind change rebuilds before it updates.** `RoundView` rebuilds a round whose `RoundState.kinds` differs from
  the table its parts were built with, before any update runs; start dispatches `kindsChanged` and calls no
  `view.rebuild()` of its own. Test: a `round-view` row where a kind leaves while its card is shown throws nothing
  and drops the card.
- **Layout picks follow the rail.** `pickRoundLayouts(round: RoundState, user, loaded)`: `RoundPicks.cards` is over
  the non-notices stops of `railItems(round)` in rail order, `noticeCards` over `kindItems(round.round, 'notice')`,
  and `roundLayoutNames` over every registered kind's items.
- **A plugin card's builder and input.** The pick returns `{ builder, input: 'kind' | 'other' }`: a `kinds[id]`
  builder gets `cardInput.input(...)`, an `other` builder gets an `OtherCard`. A throwing `kinds` builder falls
  back to `default`'s `other` with an `OtherCard`. Test row for that fallback.
- **`KindKit.answerControls`** mounts the toggles always, and the text boxes of `notes` and `dontAskReason` only
  when the kind's `boxes.fields` holds them.
- **Answer events across a kind change.** `answerChanges` compares only items present in both states'
  `itemAnswers`, and `statusAndPick` skips a departed item; a plugin kind's `Answer` holds primitives only (stated
  on `PageKind`). `forms-events.test.ts` rows: a kind arrives, leaves, and is replaced under the same id, each with no
  `answerChanged`.
- **Focus keeps the item.** On `kindsChanged`, `focus` stays on the same item (kind, index) at its new rail
  position while it is still on the rail, else clamps to the last stop; `reviewRow` likewise keeps the same item's
  row, else clamps. Test: kinds at 15 and 5 arrive ahead of a focused question; focus stays on that question.
- **Body key order.** `PageKindTable` gains `kinds(): readonly PageKind[]` (registration order). `buildBody` writes
  `note`, then the registered kinds in reverse registration order, then the held kinds in `round.bodyKeys` order;
  the `buildBody` row pins it.
- **Stop order.** Forms' page `dispose` disposes the `kinds.onChanged` listener first, then the view, then the
  built-in registrations. A `start.test.ts` row: disposing the part throws nothing and rebuilds nothing.
- **An unregistered kind is logged, and toasted only when it leaves.** At a round's first show, a kind with no
  registration is logged once per round (`round <roundId> holds <count> <kind> items with no page kind`), with no
  toast, since at app start a dependent's page part may register after the round arrives. When a registered kind
  leaves while a round holds its items, the page toasts once per round and kind for that round's life:
  `1 <kind> item in <label> waits for the plugin that draws it` / `<count> <kind> items in <label> wait for the plugin
  that draws them`. The GIVEN with the toast text above follows this.
- **Spec mismatch.** At restore, a registered kind whose `spec.bodyKey` differs from `round.bodyKeys[id]` logs once
  per round (`page kind <id> body key <a> differs from main's <b>`) and reads its entries from main's key.
- **More test rows.** A non-answerable plugin kind: `choose`, `clearChoice`, `acceptRecommendation`,
  `toggleNotApplicable` and `toggleDontAsk` each change nothing (one `it.each`). A round that starts with a kind
  unregistered: `buildBody` writes its entries back unchanged. The `boxKey` rows state their keys: a comment box is
  `<roundId>/notice/<n>/comment`, a plugin kind's `<roundId>/<kind>/<n>/<field>` (or the shape the implementer
  derives from today's `boxKey`, written in the row before the test runs).
- **Comments that go false**, rewritten in the part that changes them: in `layout.d.ts`, `LayoutCard.update`,
  `Kit.contributedParts`, `Layout`'s card-lookup sentence, `RailEntryInput.label` and the `kind` unions,
  `ReviewRowInput` (B); in `contract.ts`, `FormsItemRef`, `FormsPageEvents.answerChanged`, `FormsCardPartItem` (A);
  in `forms-events.ts`, the "answers hold only primitives" note (A).

## Proof

