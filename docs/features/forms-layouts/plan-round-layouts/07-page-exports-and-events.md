# 07 — Forms page exports and events

Status: done
Type: Task
Wave: 6 · Depends on: 05
Plan: [plan.md](plan.md)

The follow-up taken into this work: the forms page tells other plugins what it shows and lets them hook it. Today the
forms page part exports nothing and emits nothing (`src/plugins/forms/page/start.ts` returns only `commands`, and its
`PageApi` events type is `Record<never, never>`).

Files:     modify `src/plugins/forms/contract.ts` · create `src/plugins/forms/page/forms-events.ts` ·
           test `src/plugins/forms/page/forms-events.test.ts` · create `src/plugins/forms/page/contributions.ts` ·
           test `src/plugins/forms/page/contributions.test.ts` · create `src/plugins/forms/page/layout/kit-commands.ts` ·
           test `src/plugins/forms/page/layout/kit-commands.test.ts` · modify `src/plugins/forms/page/start.ts` ·
           modify `src/plugins/forms/page/form-state.ts` · modify `src/plugins/forms/page/forms-view.ts` ·
           modify `src/plugins/forms/page/round-view.ts` · modify `src/plugins/forms/page/forms-commands.ts` ·
           modify `src/plugins/forms/page/view-model.ts` · modify `src/plugins/forms/page/kinds/item-format.ts` ·
           modify `src/plugins/forms/page/layout/card-kit.ts` · modify `src/plugins/forms/page/layout/layout-cards.ts` ·
           modify `src/plugins/forms/layouts/layout.d.ts` · modify `src/plugins/forms/page/layout/layout-panes.ts`
           (05's pane host, where the rail and review kits and the review-row part are built) ·
           test `src/plugins/forms/page/layout/card-kit.test.ts` (05 creates it) · test (create)
           `src/plugins/forms/page/layout/layout-cards.test.ts` · test (create)
           `src/plugins/forms/page/layout/layout-panes.test.ts` ·
           modify `docs/features/followups.md` (one stale clause, below)
Consumes:  `FormsState`, `RoundState`, `apply`, `activeRound(state)`, `buildBody(round)`, `answerStatus(round, item)`,
           `railItems`, `AnswerableItem` in `src/plugins/forms/page/form-state.ts` ← the tree (04 changes the finding
           answer inside them; this task reads them as 04 left them)
           `FormsStore.subscribe` / `get` in `src/plugins/forms/page/forms-store.ts` ← the tree
           the Layout contract of 05 in `src/plugins/forms/layouts/layout.d.ts`: the base kit every card and pane kit
           extends (today `HeadKit`), the card kit (today `Kit`), the review pane's row part (AGENTS.md, A forms
           layout: "review row"), and `FormsView.setLayouts` / `RoundView.setLayouts`, whose rebuild body this task
           lifts into `rebuild()` (`forms-view.ts`, `round-view.ts`) ← 05, 03
           `PaneDeps`, `buildRailPane`, `buildReviewPane` in `src/plugins/forms/page/layout/layout-panes.ts` ← 05
           `CardDeps` in `src/plugins/forms/page/kinds/item-format.ts` and `hostCard` / `buildCardOf` in
           `src/plugins/forms/page/layout/layout-cards.ts` ← the tree, as 05 left them
           `api.keys.command(id): CommandInfo | undefined`, `api.commands.run(id)`, `KeysPageExports.keysFor(command,
           scope)`, `api.events.emit` ← the tree
Produces:  in `src/plugins/forms/contract.ts`:
             `export type FormsView = 'forms' | 'review' | 'confirm' | 'idle'` (moved from `page/form-state.ts`)
             `export interface OpenRound { roundId: string; sessionId: string; label: string; round: Round }`
             `export interface FormsItemRef { kind: AnswerableKind; index: number }` — `index` 1-based in its kind's
             array, as `AnswerableItem`
             `export type RoundFinishOutcome = 'submitted' | 'cancelled' | 'closed'`
             `export interface FormsPageEvents extends EventShape {`
             `  roundShown: OpenRound;`
             `  answerChanged: { roundId: string; item: FormsItemRef; status: AnswerStatus };`
             `  roundFinished: { roundId: string; sessionId: string; outcome: RoundFinishOutcome; body: FormBody };`
             `  viewChanged: { view: FormsView; roundId: string | null };`
             `}`
             `export interface FormsCardPartItem { roundId: string; kind: ItemKind; index: number }`
             `export interface FormsCardPart { id: string; kinds: readonly ItemKind[];`
             `  build(parent: HTMLElement, item: FormsCardPartItem): { update?(): void } }`
             `export interface FormsReviewColumn { id: string; title: string;`
             `  cell(roundId: string, item: FormsItemRef): string }`
             `export interface FormsPageExports {`
             `  activeRound(): OpenRound | null;`
             `  answers(roundId: string): FormBody | null;`
             `  addCardPart(part: FormsCardPart): Disposable;`
             `  addReviewColumn(column: FormsReviewColumn): Disposable;`
             `}`
           in `src/plugins/forms/page/forms-events.ts`:
             `export type FormsPageEvent = { [K in keyof FormsPageEvents]: { name: K; data: FormsPageEvents[K] } }[keyof FormsPageEvents]`
             `export function formsEventsBetween(previous: FormsState, next: FormsState): FormsPageEvent[]`
             `export function startFormsEvents(store: FormsStore, emit: (event: FormsPageEvent) => void): void`
           in `src/plugins/forms/page/contributions.ts`:
             `export interface FormsContributions { addCardPart(part: FormsCardPart): Disposable;`
             `  addReviewColumn(column: FormsReviewColumn): Disposable; cardParts(kind: ItemKind): FormsCardPart[];`
             `  reviewColumns(): FormsReviewColumn[]; onChanged(listener: () => void): Disposable }`
             `export function createFormsContributions(): FormsContributions`
           in `src/plugins/forms/page/layout/kit-commands.ts`:
             `export function commandRunner(qualifiedId: CommandId, commands: { exists(id: CommandId): boolean; run(id: CommandId): void }): () => void`
           in `src/plugins/forms/layouts/layout.d.ts`, on the base kit every card and pane kit extends:
             `command(qualifiedId: string): () => void` and `keysFor(qualifiedId: string): string | null`
           and on the card kit: `contributedParts(parent: HTMLElement): HTMLElement`
           in `src/plugins/forms/page/forms-view.ts`: `FormsView.rebuild(): void` — rebuilds every open round view
             (the loop `setLayouts` runs, with no picks check)
           in `src/plugins/forms/page/round-view.ts`: `RoundView.rebuild(round: RoundState): void` — today's rebuild
             body (destroy the round's boxes, empty both panes, build with the picks it holds, update), with no
             `picksEqual` check; `setLayouts` calls it when the picks changed
           in `src/plugins/forms/page/layout/layout-panes.ts`: `PaneDeps` gains the same command lookup and runner as
             `CardDeps`; the head kit's deps in `round-view.ts` gain them too
           the forms page part's `exports: FormsPageExports`, and its `PageApi` events type `FormsPageEvents`
Decisions: events and queries follow `sessions`: the payload types live in the publisher's `contract.ts`, the page
           emits from a diff of the state before and after each store change (as `sessions` diffs rows with
           `rowChanges`), and a late plugin reads the queries (AGENTS.md, An event; A plugin talks)
           "card parts and review columns" are registrations, not exported builders: another plugin adds a part to
           every card of the kinds it names, and a column to every review row. Reason: AGENTS.md Intent, "a closed
           list … is an extension point waiting to become a registration"; each `add` returns a `Disposable`, so a
           plugin reload undoes it
           a layout keeps control of where a part goes: `kit.contributedParts(parent)` places them; a card that never
           calls it gets them appended at the end of its element, after the unmounted boxes, the same way
           `appendUnmountedBoxes` treats boxes
           `FormsView` moves into the contract, since an event payload names it and the contract imports nothing from
           `page/`; every page module that imports it from `form-state.ts` imports it from `../contract` (or
           `../../contract`) instead, with no re-export left in `form-state.ts`
           `roundFinished` fires once when a round leaves the page's state, for every reason: `outcome` is the
           `RoundState.sending` kind when the page's finish closed it, else `closed` (main closed it: a disconnect, a
           host cancel). Reason: a listener that keeps per-round state must hear every round leave, and the four
           pinned names hold no fifth event
           `answerChanged` covers questions' and findings' answers, notes and reason text included (one event per
           text change, as `setText` dispatches); a notice comment and the round note are not answers and emit
           nothing; `answers(roundId)` still returns them in the body
           a newly shown round emits `roundShown` and no `answerChanged` for its restored draft; a round shown again
           while open changes no state and emits nothing
           `kit.keysFor` reads the keys in the scope of the part drawing: `forms.forms` for cards, the head and the
           rail, `forms.review` for the review pane; it reads once, when called, as `kit.keys` does
           `kit.command(id)` checks the id while the card or pane builds and throws `no command <id>` for an id no
           plugin registers, so the throw falls back to `default` like any throwing card; the runner it returns runs
           `api.commands.run(id)` on each call and never at build
           a card part or review column that throws is logged (`card part <id> failed: <error>`, `review column <id>
           failed: <error>`, source `forms`) and draws nothing; the card or row still draws
           adding or disposing a part or column rebuilds every open round view: `contributions.onChanged` calls
           `FormsView.rebuild()`, which rebuilds each round view with no picks check (03's `setLayouts` rebuilds only
           when a pick changed, and a new part or column changes no pick), so the part shows at once and answers
           and boxes survive
           the page logs each event it emits, source `forms`, so a drive run reads them in the page log, as
           `sessions` logs `activated <label>` beside `activeChanged`: `event roundShown <roundId>`,
           `event answerChanged <roundId> <kind> <index> <status>`, `event roundFinished <roundId> <outcome>`,
           `event viewChanged <view> <roundId or none>`. This is the live log, with no test-only path. The
           `answerChanged` line logs only when the answer's status or pick changes, not on each notes edit, so
           typing notes adds no log line per key; the event itself still fires on every change

## When each event fires

`startFormsEvents` subscribes to the store, holds the last state it saw (the store's state at start), and on each
store change emits `formsEventsBetween(previous, next)` in this order, then saves `next`:

1. `roundShown` — once for each `roundId` in `next.rounds` that `previous.rounds` lacks, in `next.rounds` order.
   Payload: the round's `roundId`, `sessionId`, `label` and parsed `round`.
2. `answerChanged` — once for each answerable item (rail order) of a round in both states whose answer differs in
   any field the item's answer type holds (`choice`, `notApplicable`, `notes`, `dontAsk`, `dontAskReason`, and a
   finding's `action`, or the fields 04 left it). `status` is `answerStatus(next round, item)`.
3. `roundFinished` — once for each `roundId` in `previous.rounds` that `next.rounds` lacks. `body` is
   `buildBody(previous round)`, the answers it left with.
4. `viewChanged` — once when `view` or `activeRoundId` differs between the states. Payload: `next.view` and
   `next.activeRoundId`.

The page part wires it in `start.ts` before `listenForRounds`, so the rounds `openRounds` returns at load each emit
`roundShown`: `startFormsEvents(store, emit)`, where `emit` logs the event's line (Decisions), then calls
`api.events.emit(event.name, event.data)`.

## Exports

- `activeRound()` — `activeRound(store.get())` as an `OpenRound`, or `null` when no round is active.
- `answers(roundId)` — `buildBody` of that round, or `null` for a round the page does not hold.
- `addCardPart(part)` / `addReviewColumn(column)` — `createFormsContributions`; each throws
  `card part <id> is already added` / `review column <id> is already added` for an id already held, and its
  `Disposable` removes it. Parts and columns keep add order.

## Kit

- `card-kit.ts`: the base kit gains `command` (through `commandRunner`, with `exists` reading
  `api.keys.command(id) !== undefined` and `run` calling `api.commands.run`) and `keysFor`; the card kit gains
  `contributedParts`, which builds `div.card-parts` holding one `div.card-part` with `data-part="<id>"` per part of the
  card's kind, each built by `part.build(wrapper, { roundId, kind, index })`. `CardDeps` gains what these read: the
  command lookup and runner, and the contributions. `PaneDeps` (`layout-panes.ts`) and the head kit's deps
  (`round-view.ts`) gain the same command lookup and runner, so the rail, review and head kits offer `command` and
  `keysFor` too; `PaneDeps` also gains the contributions, for the review columns.
- `layout-cards.ts` `hostCard`: each part's `update` runs on every card update, after the card's own `update`
  (notices never update, as today). A card that left `contributedParts` uncalled gets it appended at the end of its
  element.
- 05's review-row part (`layout-panes.ts`): after its own cells, one `span.review-cell` with `data-column="<id>"` per column, holding
  `column.cell(roundId, item)` as text.
- `layout.d.ts` comments state each new member's behaviour as the Decisions give it; the file ships to the user's
  layouts folder.

## Doc

`docs/features/followups.md`, the standing-rule item: "and only `sessions` emits; forms, chat and docs shipped
emitting nothing" becomes "and only `sessions` and the forms page emit; chat and docs emit nothing".

GIVEN a state with no rounds WHEN `roundShown` for round r1 applies THEN `formsEventsBetween` returns one
`roundShown` with r1's ids, label and round, and no `answerChanged`
GIVEN round r1 open WHEN question 1 takes choice 2 THEN one `answerChanged` `{ roundId: 'r1', item: { kind:
'question', index: 1 }, status: 'answered' }`
GIVEN round r1 open WHEN the round note's text changes THEN no event
GIVEN r1 sending `submitted` WHEN main's `roundClosed` for r1 applies THEN one `roundFinished` with outcome
`submitted` and the body `buildBody` gave before the close, emitted before the `viewChanged` the close causes
GIVEN a card kit WHEN `command('docs.noSuch')` runs while the card builds THEN it throws `no command docs.noSuch`
Tests:     `forms-events.test.ts` (rounds from `page/test-rounds.ts`, states from `apply`):
           `formsEventsBetween_NewRound_EmitsRoundShownOnly` — one event, name `roundShown`, data equal to the
           presented round's `roundId`, `sessionId`, `label`, `round`
           `formsEventsBetween_SameRoundAgain_EmitsNothing` — applying the same `roundShown` again returns the same
           state, and `formsEventsBetween(state, state)` is `[]`
           `formsEventsBetween_Choose_EmitsAnswerChanged` — the payload above
           `formsEventsBetween_NotesText_EmitsAnswerChanged` — `setText` on question 1's notes: one `answerChanged`,
           status `untouched`
           `formsEventsBetween_RoundNoteText_EmitsNothing` — `setText` on the round note: `[]`
           `formsEventsBetween_FinishedRoundCloses_EmitsRoundFinishedBeforeViewChanged` — names in order
           `['roundFinished', 'viewChanged']`, outcome `submitted`, `body` equal to `buildBody` of the round before
           the close
           `formsEventsBetween_MainClosesRound_EmitsClosed` — `roundClosed` with no `sending`: outcome `closed`
           `formsEventsBetween_OpenReview_EmitsViewChanged` — `{ view: 'review', roundId: 'r1' }`
           `contributions.test.ts`:
           `addCardPart_TakenId_Throws` — message `card part p1 is already added`
           `cardParts_Kind_ListsMatchingPartsInAddOrder` — two finding parts and one question part: `cardParts('finding')`
           ids `['p1', 'p2']`
           `addCardPart_Dispose_RemovesPartAndNotifies` — after `dispose`, `cardParts` lacks it and the `onChanged`
           listener ran once
           `addReviewColumn_Dispose_RemovesColumnAndNotifies` — the same for columns
           `kit-commands.test.ts`:
           `commandRunner_UnknownId_Throws` — message `no command docs.noSuch`, and `run` was not called
           `commandRunner_KnownId_RunsOnEachCall` — no run at creation; two calls run the id twice
           Drawing and kit lookups, against a built fixture: fake elements and a stubbed `document`, as
           `src/plugins/chat/layouts/default/layout.test.ts` and `src/shared/page/ui/split.test.ts` build them (Vitest
           runs in `node`), with fake `CardDeps` / `PaneDeps` holding a contributions object from
           `createFormsContributions`:
           `card-kit.test.ts`:
           `contributedParts_DrawsOnePartPerPartOfTheKind` — two finding parts and one question part: a finding
           card's `contributedParts` holds two `div.card-part`, `data-part` `p1` and `p2`, each built with
           `{ roundId, kind: 'finding', index }`
           `contributedParts_DisposedPart_NotDrawn` — after the part's `Disposable` runs, a kit built next draws no
           `div.card-part` for it
           `contributedParts_PartThrows_LogsAndDrawsTheRest` — logs `[forms] card part p1 failed: <error>`; `p2`
           still draws
           `kitCommand_KnownId_RunsOnlyWhenCalled` — with a fake lookup that knows `demo.run`,
           `kit.command('demo.run')` runs nothing at build; calling the runner runs `demo.run` once
           `kitKeysFor_ReadsTheCardScope` — `kit.keysFor('demo.run')` asks the fake `keysFor` with scope
           `forms.forms` and returns its keys; `null` for an unbound command
           `layout-cards.test.ts`:
           `hostCard_ContributedPartsUncalled_AppendsThemAtTheEnd` — a card that never calls `contributedParts`
           ends with `div.card-parts`
           `hostCard_Update_RunsEachPartUpdateAfterTheCard` — the order of calls is the card's `update`, then each
           part's `update`
           `layout-panes.test.ts`:
           `reviewRow_DrawsOneCellPerColumn` — two columns: the row ends with two `span.review-cell`,
           `data-column` `c1` and `c2`, each holding its `cell(roundId, item)` text
           `reviewRow_ColumnThrows_LogsAndDrawsTheRow` — logs `[forms] review column c1 failed: <error>`; the row
           and `c2` still draw
           `reviewKit_KeysFor_ReadsTheReviewScope` — the review kit's `keysFor` asks with scope `forms.review`
           `forms-events.test.ts` also gains `startFormsEvents_DiffsEachChangeAgainstTheLast` — over a fake store,
           a `roundShown` change, then a `choose` change: `emit` receives `roundShown` once, and the `choose` change
           adds exactly one event, an `answerChanged`
Done when: `npm run typecheck` passes; `npm run lint` passes (forms imports nothing new across a boundary); the test
           gate runs the tests above. These unit tests cover card parts, review columns and `kit.command` /
           `kit.keysFor`; task 10's check 5 reads only the four events' log lines in a live round
Commit:    one commit for the group

## Proof

Commit f443be9a · proof: diff read: every Produces signature present; typecheck passes; worker ran lint and the full suite (2822 tests) green · concerns: AGENTS.md forms layout kit list and events text now stale (09); default layout never calls contributedParts, so parts always go after the boxes; no CSS for .card-parts, .card-part, .review-cell; FormsReviewColumn.title drawn nowhere; each rebuild remounts every editor box in every open round
