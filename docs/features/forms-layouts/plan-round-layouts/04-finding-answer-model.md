# 04 — Finding answer model on the page

Status: not started
Type: Task
Wave: 4 · Depends on: 02, 03
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/forms/finding-pick.ts` · test `src/plugins/forms/finding-pick.test.ts`
           modify `src/plugins/forms/main/round.ts` · test `src/plugins/forms/main/round.test.ts`
           modify `src/plugins/forms/page/form-state.ts` · test `src/plugins/forms/page/form-state.test.ts`
           modify `src/plugins/forms/page/forms-commands.ts` · test `src/plugins/forms/page/forms-commands.test.ts`
           modify `src/plugins/forms/manifest.ts` · modify `src/plugins/keymap.ts`
           modify `src/plugins/forms/page/view-model.ts` · test `src/plugins/forms/page/view-model.test.ts`
           modify `src/plugins/forms/page/round-view.ts`
           modify `src/plugins/forms/page/kinds/finding/finding-card.ts` · test `src/plugins/forms/page/kinds/card-input.test.ts`
           modify `src/plugins/forms/page/kinds/card-parts.ts`
           modify `src/plugins/forms/page/layout/card-kit.ts` · test `src/plugins/forms/page/layout/layout-actions.test.ts`
           test `src/plugins/forms/page/layout/card-answer.test.ts`
           modify `src/plugins/forms/layouts/layout.d.ts` · modify `src/plugins/forms/layouts/default/layout.js`

Consumes:  `FindingChoice { text: string; reason: string; action: FindingAction }` ← 02 (`src/plugins/forms/contract.ts`)
           `completeFindingPick(finding, choice, action)` ← 02 (`src/plugins/forms/finding-pick.ts`), rewritten here on `findingEntries`
           `FindingFields.recommend: number | null` ← 02 (`src/plugins/forms/contract.ts`)
           the test round builders in `src/plugins/forms/page/test-rounds.ts` as 02 left them (choices carrying `action`)
           `CompleteLayout`, `LayoutCards` ← 03 (`src/plugins/forms/layouts/layout.d.ts`)
           `actionLabel(origin, action)`, `FINDING_ACTIONS` (tree)

Produces:  in `src/plugins/forms/finding-pick.ts`:
           - `interface FindingEntry { action: FindingAction; choice: number }`
           - `type PickableFinding = Pick<Finding, 'origin' | 'choices'>`
           - `function findingEntries(finding: PickableFinding): FindingEntry[]`
           - `function findingEntryNumber(finding: PickableFinding, choice: number, action: FindingAction | ''): number`
           - `function findingPickIsComplete(finding: PickableFinding, choice: number, action: FindingAction | ''): boolean`
           - `function findingSolution(finding: PickableFinding, choice: number, action: FindingAction | ''): number`
           in `src/plugins/forms/page/form-state.ts`:
           - `ItemAction` member `{ type: 'choose'; number: number }` (replaces `{ type: 'choose'; choice: number }`)
           - `ItemAction` member `{ type: 'chooseAction'; … }` removed
           in `src/plugins/forms/page/view-model.ts`:
           - `ReviewRow.entry: number` added; `ReviewRow.missing` removed
           in `src/plugins/forms/layouts/layout.d.ts`:
           - `interface FindingCardEntry { number: number; action: FindingAction; choice: number }`
           - `FindingCard.entries: FindingCardEntry[]`; `FindingCard.choices: { text: string; reason: string; action: FindingAction }[]`
           - `LayoutAction` member `{ type: 'choose'; number: number }` (replaces `{ type: 'choose'; choice: number }`);
             `{ type: 'chooseAction'; action: FindingAction }` removed
           - `FindingKit.actionRow` removed
           in `src/plugins/forms/page/kinds/card-parts.ts`:
           - `function buildChoiceList(list: HTMLElement, choices: { text: string; number: number }[], recommended: number | null, pick: (number: number) => void, deps: Pick<CardDeps, 'markdown' | 'keysFor' | 'platform'>): ChoiceList`

Decisions:
- One pick (interview): a finding's answer is one pick `{ choice, action }`; `choice` is 0 for a bare header. No pick
  is `{ choice: 0, action: '' }`. `FindingAnswer` and `FindingAnswerEntry` keep their shape, so the saved body and
  the payload keep the `choice` and `action` keys (design review). What a pick means changes (a header pick is
  `choice` 0 and complete), so retro's reading of it changes in 06.
- Entry order (checked against `finding-origins.ts`): the actions the origin offers, in `FINDING_ACTIONS` order
  (`fix_now`, `follow_up`, `leave_it`; a nit has no `follow_up`). For each action, its choices in wire order, each
  `{ action, choice: <1-based index into finding.choices> }`; an action with no choices gives one entry
  `{ action, choice: 0 }`. Entry N is position N, 1-based. Example: caused choices `[A fix_now, B fix_now]` gives
  `1 fix_now/1, 2 fix_now/2, 3 follow_up/0, 4 leave_it/0` (the user's "Fix Now / 1. xxx / 2. yyy / Plan (3) /
  Drop (4)"). A choice whose action the origin does not offer gives no entry (02's parser rejects it).
- `findingEntryNumber` is the 1-based position of `{ choice, action }` in `findingEntries`, 0 when it is none.
  `findingPickIsComplete` is `findingEntryNumber > 0`. `findingSolution` is `choice` when the pick is complete, else
  0 (a header pick gives 0; a `leave_it` choice gives its choice).
- `choose` with `number` N (keys `1`…`9`, `<Leader>a1`…`<Leader>a9`, raw `choose1`…`choose9`): on a question it
  picks choice N as today; on a finding it picks entry N, setting choice and action together. The pick held again
  clears to no pick. A number past the entries changes nothing; not applicable locks it (unchanged).
- `clearChoice` (`c`, `<Leader>ac`) clears a finding's whole pick to no pick; a question as today.
- Accept (`acceptRecommendation`, Enter) on a finding sets `{ action: recommend_action, choice: recommend ?? 0 }`:
  the header entry when `recommend` is null (02 sends null only when that action has no choices). It is a no-op
  when that pick is held. The question rule is unchanged.
- Lone-solution pinning is removed (`pinsLoneSolution`, `holdsPinnedSolution`): each entry is a whole pick, so a
  one-choice finding needs nothing pinned. A finding with no draft entry starts with no pick, so it counts as
  untouched until the user picks or accepts (Decided; it started on `fix_now` before).
- A draft entry restores its pick only when `findingEntryNumber(finding, choice, action) > 0`; any other saved pick
  restores as no pick, keeping notes, Not applicable and Don't ask.
- The `fixNow`/`followUp`/`leaveIt` commands of the plan are `actFixNow`, `actFollowUp`, `actLeaveIt` in
  `manifest.ts`. All three go, with their handlers (`act`, `findingLackingAction`, `defectActionWord`,
  `activeFindingActionWord`, `findingAction` in `forms-commands.ts`), their box binds `<Leader>af`, `<Leader>au`,
  `<Leader>as` and their raw binds `f`, `u`, `s` in `forms.forms` (`keymap.ts`). `docs/keymap.md` already reads so.
- The choose commands' label becomes `pick the numbered choice or action (again clears)`.
- Log lines (08's self-test reads them): a finding pick logs `chose <N> on finding <i>`, the same shape as a question's
  (`chose 3 on finding 1`), since 08's self-test pins that shape; a cleared finding pick logs `cleared the choice on finding <i>`. Question lines
  are unchanged (`chose 2 on question 1`). The line `finding <i> offers no <action>` goes with `act`.
- `FindingCard` gains `entries` and each choice's `action` here, not in 05, since the kit numbers the card from them
  in this task. `entries[i]` is `{ number: i + 1, ...findingEntries(finding)[i] }`.
- The kit, until 05 replaces it with `choiceGroups`: the finding `choiceList` draws each choice with its entry
  number (number, key hint and click all use it) and the Recommended tag on the entry `{ recommend_action,
  recommend }`; a choice is selected when the pick is that entry. The leave_it dimming (`is-dimmed`) and
  `buildActionRow`, `ACTION_COMMANDS` and `FindingKit.actionRow` go; the default layout's finding card drops its
  `kit.actionRow(answer)` line. Between this task and 05 a bare header has a number and a key but no control on the
  card; 05 draws it.
- `buildChoiceList` takes each choice's shown `number` (a question passes `i + 1`) and `recommended`, the number it
  tags; `pick` receives that number.
- Review rows (`reviewRows`): `entry` is the pick's number down the card (a question's choice; 0 for none);
  `choice` stays the payload's choice (0 for a header pick); `actionLabel` the card word. `recommended`: a question
  whose choice is its `recommend`; a finding whose pick equals `{ recommend_action, recommend ?? 0 }`.
  `tookRecommendation` is `choice > 0 && choice === recommend`. `missing` goes: a pick is whole or absent.
  `buildReviewRow` in `round-view.ts` shows `row.entry` in `.choice-number`, drops `MISSING_HINTS`, and shows the
  status label when the row has neither an action nor a choice.
- Main's payload (`findingResult` in `main/round.ts`) keeps reading the pick through 02's `completeFindingPick`;
  this task rewrites `completeFindingPick` on `findingEntries` with the same results 02 pins (a pick is complete
  exactly when it is one of the card's entries), so main and page share one rule. No payload field changes.
- The self-test group "finding actions" (`selftest-script.ts`) still presses `f`, `u`, `s`; 08 rewrites it. This
  task leaves that file alone.

GIVEN a caused finding with choices `[A fix_now, B fix_now]`
WHEN the user presses `3`
THEN the pick is `{ action: 'follow_up', choice: 0 }`, the item is answered, and the log reads
`chose 3 on finding 1`

GIVEN that finding with `recommend: 2`, `recommend_action: 'fix_now'`
WHEN the user presses Enter, then Enter again
THEN the pick is `{ action: 'fix_now', choice: 2 }` both times, and the second press logs nothing

GIVEN a design finding with choices `[A fix_now, B follow_up]`, `recommend: null`, `recommend_action: 'leave_it'`
WHEN Accept runs
THEN the pick is `{ action: 'leave_it', choice: 0 }`, entry 3 of `1 fix_now/1, 2 follow_up/2, 3 leave_it/0`

Tests:
- `finding-pick.test.ts` (replaces the `findingPickIsComplete` and `findingSolution` cases):
  - `findingEntries_GroupsByActionInTableOrder` — caused `[A follow_up, B fix_now, C follow_up]` gives
    `[fix_now/2, follow_up/1, follow_up/3, leave_it/0]`
  - `findingEntries_ActionWithoutChoices_OneHeaderEntry` — caused `[A fix_now, B fix_now]` gives
    `[fix_now/1, fix_now/2, follow_up/0, leave_it/0]`
  - `findingEntries_Nit_SkipsFollowUp` — nit `[A fix_now]` gives `[fix_now/1, leave_it/0]`
  - `findingEntryNumber_PickOrNone` — over the first case: `(3, 'follow_up')` is 3, `(0, 'leave_it')` is 4,
    `(0, 'fix_now')` is 0, `(1, 'fix_now')` is 0, `(0, '')` is 0
  - `findingPickIsComplete_OnlyEntries` — over the first case: `(0, 'leave_it')` true; `(0, 'fix_now')` false, since
    `fix_now` has choices (02's parser gives every finding a `fix_now` choice, so a `fix_now` header pick is never
    complete); `(3, 'follow_up')` true; `(3, 'leave_it')` false
  - `findingSolution_ChoiceOrZero` — a `leave_it` choice gives its choice; a header pick gives 0; no entry gives 0
  - `isFindingAction` case unchanged
- `form-state.test.ts`:
  - `choose` group: `picks the numbered entry, setting choice and action` (entry 2 of `[fix_now/1, fix_now/2,
    follow_up/0, leave_it/0]` holds `{ choice: 2, action: 'fix_now' }`); `picks a bare header as choice 0`
    (entry 4 holds `{ choice: 0, action: 'leave_it' }`); `clears the pick when the same number is picked again`;
    `changes nothing past the last entry` (number 5); `changes nothing while not applicable`; the question cases
    stay
  - `clearChoice` group: `clears a finding's whole pick`; the question case stays; the one-solution cases go
  - `chooseAction` and `chooseAction by origin` groups go
  - `acceptRecommendation` group: `sets the recommended choice and action as one pick`; `sets the recommended
    action's header when recommend is null` (`{ choice: 0, action: 'leave_it' }`); `does nothing when the answer
    already holds the recommended pick`; the question case stays; the two leave_it-keeps-solution cases go
  - `restoring a draft` group: `starts a finding with no draft entry with no pick` (`{ choice: 0, action: '' }`,
    status untouched), replacing the fix_now/lone-solution case; `restores a saved pick that is an entry`;
    `restores a saved pick that is no entry as none, keeping its notes` (`{ choice: 1, action: 'leave_it' }` on a
    finding whose leave_it has no choices); the unknown-action and not-offered cases stay
  - status cases: `leaves a finding untouched with an action and no entry` becomes `a finding with no pick and no
    notes is untouched`; `answers a finding with a header pick`
- `forms-commands.test.ts`: `picks an entry on the focused finding and logs its number` — `3` logs
  `chose 3 on finding 1`; `logs the clear when the same entry is picked again` — `cleared the choice on
  finding 1`; the `actFixNow`, Decision word, and Nit-lacking cases go; `logs nothing when an action command runs
  on a question` goes
- `view-model.test.ts`: `lists a finding's header pick with its action word and no choice` (`entry` 4, `choice` 0,
  `actionLabel` `Leave it`); `lists a finding's choice pick with its entry number` (choices `[A follow_up,
  B fix_now]`, pick `fix_now/2`: `entry` 1, `choice` 2, `choiceText` `B`); `recommends a finding whose pick is the
  recommended pick`; `recommends a finding that took a null recommend's header`; the `missing` cases, the one-solution
  cases and `does not recommend a finding with the recommended solution but another action` (a choice now carries
  one action) go; the question cases stay
- `card-input.test.ts`: `findingCardInput_Entries_NumberDownTheCard` — caused `[A follow_up, B fix_now]` gives
  entries `[{1, fix_now, 2}, {2, follow_up, 1}, {3, leave_it, 0}]` and choices carrying their `action`
- `card-answer.test.ts`: `cardAnswer_Untouched_HasNullChoiceAndAction` (replaces the fix_now case);
  `cardAnswer_HeaderPick_NullChoiceWithAction` (entry 4: `choice: null`, `action: 'leave_it'`, status answered);
  `cardAnswer_FindingWithActionAndChoice_CarriesBoth` over `choose` alone
- `layout-actions.test.ts`: `layoutActions_Choose_FocusesThenChooses` over `{ type: 'choose', number: 2 }`
- `round.test.ts` (the finding payload cases): `answers a header pick with choice 0 and its action`;
  `reports a leave_it choice with its choice and text`; `leaves a finding untouched whose action has choices but
  none picked` (replaces the two-solution case); the one-solution and leave-it-drops-solution cases go; the
  recommendation and not-applicable cases stay

Done when: `npm run typecheck`, `npm run lint` and `npm test` pass with the tests above (`round-view.ts`,
`card-kit.ts` and `default/layout.js` have no unit test, so only the compiler checks them); `grep -rn "actFixNow\|actFollowUp\|actLeaveIt\|
chooseAction\|actionRow\|pinsLoneSolution" src` finds nothing.
Commit:    one commit for the group

## Proof

