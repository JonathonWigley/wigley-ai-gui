# 10 — Split form-state.ts and rename the screen union

Status: not started
Type: Task
Wave: 5 · Depends on: 07, 08
Plan: [plan.md](plan.md)

A pure refactor. No behaviour changes. The risks are a lost export and an import cycle.

Paths below are relative to `src/plugins/forms/`. Facts below were measured at plan time (2026-11-09, tip
`4db26eee`), before 07 and 08 landed. Re-verify each one before the first edit.

**Before the first edit.** Read the 07 and 08 commits on `page/form-state.ts`
(`git log --oneline -- src/plugins/forms/page/form-state.ts`). Then list today's exports
(`grep -n "^export" src/plugins/forms/page/form-state.ts`) and today's importers
(`grep -rln "form-state'" src`). Place each member by the Member table below. A member that 07 or 08 removed is
skipped. A member that 07 or 08 added, or one the table does not name, goes by the responsibility rules in Decisions;
name each such member in the Proof concerns.

Files:
- create `page/round-model.ts` · `page/round-answers.ts` · `page/round-draft.ts` ·
  `page/kinds/finding/finding-answer.ts` (see Decisions for when 07 already holds a module for this)
- modify `page/form-state.ts` (keeps the session state, the actions and `apply`)
- modify `contract.ts` (the union rename)
- modify the importers of `form-state` known at plan time (14 sources, 11 tests besides `form-state.test.ts`; 07 and
  08 may add or remove some — the grep above is the list):
  - sources: `page/view-model.ts`, `page/forms-commands.ts`, `page/forms-events.ts`, `page/forms-view.ts`,
    `page/autosave.ts`, `page/start.ts`, `page/round-view.ts`, `page/boxes.ts`, `page/kinds/item-format.ts`,
    `page/kinds/formats.ts`, `page/layout/card-kit.ts`, `page/layout/layout-cards.ts`,
    `page/layout/layout-panes.ts`, `page/layout/layout-resolver.ts`
  - tests: `page/view-model.test.ts`, `page/forms-commands.test.ts`, `page/forms-events.test.ts`,
    `page/round-view.test.ts`, `page/layout/card-answer.test.ts`, `page/layout/card-kit.test.ts`,
    `page/layout/layout-panes.test.ts`, `page/layout/layout-cards.test.ts`. These three import only `form-state.ts`
    members and do not change: `page/autosave.test.ts`, `page/boxes.test.ts`, `page/forms-view.test.ts`.
- modify the users of the union `FormsView` (plan time): `contract.ts` (324, 363), `page/forms-commands.ts` (26, 643),
  `page/view-model.ts` (12, 292, 325), `page/round-view.ts` (13, 115, 184), `page/layout/layout-panes.ts`
  (31, 110, 349, 439), `page/view-model.test.ts` (3, 591), `page/forms-commands.test.ts` (17, 1194)
- test: modify `page/form-state.test.ts` · create `page/round-model.test.ts` · `page/round-answers.test.ts` ·
  `page/round-draft.test.ts` · `page/form-state.test-support.ts`

Consumes:  `PageKind.reduce`, `PageKind.restore` and `PageKind.railOrder` ← 07 (by the names 07's Produces gives) ·
           the origin-spec reads behind `findingActionWord` and `findingActionOf` ← 08
Produces:  in `page/round-model.ts`: types `RoundItem`, `AnswerableItem`, `RailItem`, `ItemAnswer`, `FindingAnswer`,
           `RoundState`, `TextTarget`; values `ROUND_ITEMS`, `railItems`, `answerableItems`, `railPosition`,
           `focusedItem`, `sameRailItem` (now exported; `unansweredItem` calls it)
           in `page/round-answers.ts`: type `Progress`, type `AnswerAction`; `itemAnswer`, `pickIsComplete`,
           `pickNumber`, `answerStatus`, `unansweredItem`, `progress`,
           `applyAnswerAction(round: RoundState, action: AnswerAction): RoundState`,
           `setText(round: RoundState, target: TextTarget, value: string): RoundState`
           in `page/round-draft.ts`: `buildBody`, `restoreRound(presented: PresentedRound): RoundState`
           in `page/kinds/finding/finding-answer.ts`: `findingActionOf`, `findingActionWord` (each one that 08 left in
           `form-state.ts`), type `FindingPick`, `NO_PICK`, `holdsPick`, `chooseEntry`, `clearFindingPick`
           in `page/form-state.ts`: types `FormsState`, `ItemAction`, `FormsAction`, `FormsStore`; `initialState`,
           `apply`, `roundPlace`
           in `contract.ts`: `export type FormsScreen = 'forms' | 'review' | 'confirm' | 'idle';` and
           `viewChanged: { view: FormsScreen; roundId: string | null }`

**Member table** (today's names; "internal" stays unexported):

| Module | Members |
|---|---|
| `round-model.ts` | the exported types above; `ROUND_ITEMS`; `ANSWERABLE_ORDER` (internal); `railItems`, `answerableItems`, `railPosition`, `sameRailItem`, `focusedItem` |
| `round-answers.ts` | `Progress`; internal `AnswerOf`, `KindItem`, `AnswerArray`, `AnswerChange`, `ANSWER_ARRAYS`, `PICK_ANSWERS`, `RecommendedPick`, `RECOMMENDED_PICKS`, `choose`, `acceptRecommendation`, `acceptRecommendationOn`, `updateFocusedFinding`, `updateFocusedAnswer`, `updateItemAnswer`, `hasItem`, `withItemAnswer`; exported `itemAnswer`, `pickIsComplete`, `pickNumber`, `answerStatus`, `unansweredItem`, `progress`, `setText`, `AnswerAction`, `applyAnswerAction` |
| `round-draft.ts` | internal `UNTOUCHED`, `UNTOUCHED_FINDING`, `answerEntry`, `findingAnswerEntry`, `restoreAnswers`, `restoreFindingAnswer`, `restoreAnswer`; exported `buildBody`, `restoreRound` |
| `kinds/finding/finding-answer.ts` | `findingActionOf`, `findingActionWord`, `FindingPick`, `NO_PICK`, `holdsPick`, `chooseEntry`, `clearFindingPick` |
| `form-state.ts` | `FormsState`, `ItemAction`, `FormsOwnAction` (internal), `FormsAction`, `FormsStore`, `initialState`, `apply`, `applyOwn`, `roundPlace`, `restorePlace`, `restoredNoticeLine`, `openReview`, `moveReviewRow`, `placeReviewRow`, `jumpToReviewRow`, `jumpToRailItem`, `applyItemAction`, `isNoticeInRange`, `toggleNotice`, `moveNoticeLine`, `focusNotice`, `moveFocus`, `focusAt` |

Decisions:
- **Responsibility rules** (for a member the table does not name):
  - `form-state.ts`: the session's state, its actions and `apply` — the view, the review cursor, rail focus, the
    notices line cursor, and the restored place.
  - `round-model.ts`: the page's round record types and rail positions. It holds no answer logic.
  - `round-answers.ts`: reads and writes of the round's answers, note and notice comments, and the dispatch to
    `PageKind.reduce`.
  - `round-draft.ts`: the saved body and the draft codec — `buildBody`, `restoreRound` and the restore helpers,
    and the dispatch to `PageKind.restore`.
  - `kinds/finding/finding-answer.ts`: pure finding rules over a `FindingAnswer`, a `Finding` or the `RoundState`
    fields. A finding rule that calls a `round-answers.ts` function (`updateFocusedFinding` calls `updateItemAnswer`)
    stays in `round-answers.ts`, so the import order below holds.
  - A rule that 07 already moved into a page kind module stays where 07 put it.
- **Finding module location.** When 07 created a module in `page/kinds/finding/` that holds the finding's
  `reduce` or `restore`, the finding rules join that module and `finding-answer.ts` is not created. Otherwise create
  `finding-answer.ts`. Record which in the Proof.
- **`form-state.ts` keeps its name.** It keeps the session state, so the importers of `apply`, `initialState`,
  `FormsState`, `FormsAction`, `FormsStore` and `roundPlace` do not change.
- **No barrel.** `form-state.ts` re-exports nothing. Every importer imports each member from the module that holds
  it. This follows the autosave split (`0f412323`): the shared lifecycle moved to `src/shared/page/session-forms.ts`
  and `src/shared/page/autosave.ts`, and importers (`form-state.test.ts` reads `saveState` and `activeForm` there)
  import from them directly. At plan time no file in `src/plugins/forms/page` has an `export … from`.
- **`applyItemAction` splits by responsibility.** `form-state.ts` keeps its switch for the navigation and notice
  cases (`nextItem`, `prevItem`, `firstItem`, `lastItem`, `focusItem`, `toggleNotice`, `moveNoticeLine`,
  `focusNotice`). The answer cases (`choose`, `clearChoice`, `acceptRecommendation`, `toggleNotApplicable`,
  `toggleDontAsk`) move unchanged into `applyAnswerAction` in `round-answers.ts`. `AnswerAction` is the union of those
  five members, moved from `ItemAction`; `ItemAction` becomes `AnswerAction` or the navigation and notice members.
  Each case body, guard and comment moves as it is. `applyOwn`'s `setText` case calls `setText` from
  `round-answers.ts`.
- **Import order** (value imports, top imports below): `form-state.ts` → `round-draft.ts`, `round-answers.ts` →
  `kinds/finding/finding-answer.ts` → `round-model.ts`. `round-draft.ts` may import `round-answers.ts` and
  `finding-answer.ts` (it needs `NO_PICK`). No module imports a value from a module above it. `round-model.ts` imports
  no `page/` module except the 07 registry that `railOrder` comes from, when 07 makes the rail read it. A type-only
  import back up the order is allowed only from `page/kinds/` to `round-model.ts` (as `kinds/item-format.ts` imports
  `RoundState` and `TextTarget` today). The lint layer check has no cycle rule (all of `page/` is one layer), so the
  Done-when greps check this.
- **Moved code is unchanged.** Each member keeps its body and its comments. Only the imports and the `export`
  keyword on `sameRailItem`, `restoreRound`, `setText` and the finding rules change, plus `applyAnswerAction`'s
  wrapper. A comment that names `form-state.ts` or a member's old place is updated to the new module.
- **The union rename.** `FormsView` in `contract.ts` becomes `FormsScreen` at the definition, in the `viewChanged`
  payload and at every use. The type name changes; nothing else does. The page interface `FormsView` and
  `mountFormsView` in `page/forms-view.ts` keep their names. The `viewChanged` event keeps its name and its payload
  key `view`. Variable, parameter and field names (`view`, `shownView`, `confirmReturnView`, `formsView` in
  `page/start.ts`) do not change.
- **Key scopes do not change.** `forms-view.ts` calls `deps.setScope(state.view)` and `start.ts` passes the value to
  `api.keys.setScope`, so a scope id is the union's value, qualified by the manifest id (`forms.forms`,
  `forms.review` in `src/plugins/keymap.ts`). The rename changes no value, so the scope ids and `keymap.ts` do not
  change.
- **Tests move by describe block.** A `describe` moves whole, with each `it` in it unchanged: no test is added,
  dropped or rewritten. A finding case inside a mixed `describe` (`choose`, `clearChoice`, `acceptRecommendation`)
  stays in that block. A describe that 07 or 08 added goes to the test file of the module that holds the member it
  pins.
- **Test helpers.** The helpers at the top of `form-state.test.ts` (`question`, `notice`, `presented`, `entry`,
  `findingEntry`, `draft`, `run`, `active`, `mixedRound`, `findingRound`, `twoFixRound`, `onNotices`, `untouched`)
  move unchanged. A helper that one test file uses moves into that file; a helper that two or more use goes to
  `page/form-state.test-support.ts`, exported. `test-rounds.ts` does not change.
- Lane L's forms items wait for this task (plan.md precondition 3). AGENTS.md text that names `form-state.ts` tables
  is task 11's.

GIVEN any round and action WHEN `apply` runs after the split THEN it returns the same state as before the split
GIVEN a saved draft WHEN `restoreRound` restores it and `buildBody` writes it THEN the body equals the body before the
split
GIVEN the forms view changes WHEN forms emits its event THEN the event is `viewChanged` with payload key `view`, and
the log line reads `event viewChanged <view> <roundId>`
GIVEN the review is shown WHEN forms sets its key scope THEN the scope is `forms.review`, as before

Tests (moves only; describe counts measured at plan time, 25 blocks and 117 `it`/`it.each`):
- `page/form-state.test.ts` keeps: `initialState`, `item navigation`, `notice lines`, `sessionActivated`, `review`,
  `cancel`, `sending`, `formShown`, `formClosed`, `item actions outside the forms view`, `saveState`, `apply`,
  `placeRestored`
- `page/round-model.test.ts`: `railItems`
- `page/round-answers.test.ts`: `choose`, `clearChoice`, `acceptRecommendation`, `answerStatus`,
  `toggleNotApplicable`, `toggleDontAsk`, `setText`, `unansweredItem`, `progress`
- `page/round-draft.test.ts`: `restoring a draft`, `buildBody`
- The other forms page tests run unchanged, with their imports moved.

Done when:
- `npm run typecheck` passes; `npm run lint` passes (the layer check included).
- The moved tests and every forms page test pass: `npm test -- src/plugins/forms` (`wigley:make`'s gate runs it).
- The whole-tree checks, each run from the repo root:
  - `grep -rn "form-state'" src` lists only importers of the `form-state.ts` Produces members.
  - `grep -rn "\bFormsView\b" src --include='*.ts'` prints only the two `page/forms-view.ts` lines that name the
    page interface (its definition and `mountFormsView`'s return type, 111 and 128 at plan time).
  - `grep -n "from '\.\./\.\./form-state'\|from '\.\./\.\./round-answers'\|from '\.\./\.\./round-draft'" src/plugins/forms/page/kinds/finding/*.ts`
    prints nothing; `grep -n "from '\./form-state'\|from '\./round-draft'" src/plugins/forms/page/round-answers.ts src/plugins/forms/page/round-model.ts`
    prints nothing; `grep -n "from '\./form-state'" src/plugins/forms/page/round-draft.ts` prints nothing;
    `grep -n "from '\./round-answers'\|from '\./kinds/finding" src/plugins/forms/page/round-model.ts` prints nothing.
  - `grep -n "export .* from" src/plugins/forms/page/form-state.ts` prints nothing.
  - The four test files together hold the same count of `describe(` and of `it(`/`it.each` lines as
    `form-state.test.ts` held before the move.
- Live checks defer to [12 — Final verification](12-final-verification.md).

Commit: one commit for the group: the split and the rename together.

## Proof

