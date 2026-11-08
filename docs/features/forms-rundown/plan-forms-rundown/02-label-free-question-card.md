# 02 — Label-free question card

Status: not started
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Paths are relative to the gui worktree. `F` = `src/plugins/forms`.

Files:     modify `F/page/kinds/question/question-card.ts` · modify `F/layouts/layout.d.ts` (`QuestionCard`, `QuestionKit` comment) ·
           modify `F/page/kinds/card-parts.ts` · modify `F/page/layout/card-kit.ts` ·
           modify `F/layouts/default/layout.js` (question card, header comment) · modify `F/layouts/default/layout.css` ·
           modify `F/page/forms.css` · test `F/page/kinds/card-input.test.ts` · test `F/page/layout/card-kit.test.ts`
Consumes:  `Question.summary: string` in `F/contract.ts` ← 01
           `question(title, overrides)` in `F/page/test-rounds.ts`, which sets `summary: \`${title} summary\`` ← 01
           `kit.inlineMarkdown(parent, text, className)` and `kit.markdown(parent, text, className)` — base kit members
           the tree holds (`src/shared/page/layout-host/base-kit.ts`)
Produces:  `export interface QuestionCard { label: string; title: string; summary: string; context: string; choices: string[]; recommend: number; rationale: string; round: RoundInfo }` in `F/layouts/layout.d.ts`
           `export function buildChoiceReason(label: string | null, text: string, deps: { markdown: MarkdownRenderer; mount: MarkdownMount }): HTMLElement` in `F/page/kinds/card-parts.ts`
           `function appendAnswerArea(parent: HTMLElement, card: CardContext, label: string | null): HTMLElement` (module-private) in `F/page/layout/card-kit.ts`
           `function appendChoiceReason(entry: HTMLElement, label: string | null, text: string, card: CardContext)` (module-private) in `F/page/layout/card-kit.ts`
           CSS class `.item-summary` (the question card's headline) and `.answer-head` (the Clear row with no label)

Keep this task to the question card. Task 04 (Wave 3) edits `layout.d.ts` (`RailEntryInput.kind`). Task 05 (Wave 4)
edits `layout.d.ts`, `layout.js` and the CSS for the notices pane and the notice card. Do not touch the finding card,
the notice card, the rail or the review.

## Decisions

- `QuestionCard.summary` replaces `QuestionCard.question` (plan.md § Shared names). In `question-card.ts`,
  `cardInput` sets `summary: question.summary` in place of the line task 01 left (`question: question.summary`).
  Keep the field order of `Produces`.
- The question card draws no section labels: no Question, Context, Why recommended or Your answer (round 4,
  Decided). Finding cards keep all their labels.
- `buildChoiceReason(label: string | null, …)`: a string draws `div.choice-reason-label` as today. `null` draws no
  label element: `div.choice-reason` holds only `div.choice-reason-body md`. Its comment says so.
- `appendChoiceReason` takes `label: string | null` and passes it through. The question `choiceList` passes `null`.
  The finding's `appendGroupChoices` keeps `'Why'`.
- `appendAnswerArea(parent, card, label: string | null)` is the narrowest change for the `Your answer` header. It is
  module-private and has two callers:
  - The finding's `buildChoiceGroups` passes `'Your answer'`. Its output does not change:
    `sectionHeader('Your answer', clear)`.
  - The question's `choiceList` passes `null`. It draws `div.answer-head` that holds only the Clear button, in place
    of the `h3.ui-section-header`. The Clear button, its click and its keys do not change, so the mouse can still
    clear a pick.
  - Update the function comment: the header holds the label when one is given; with `null` the row holds the Clear
    button alone.
- `F/layouts/default/layout.js`, `cards.question`, in this order:
  1. `const card = kit.card(parent, 'item question');`
  2. `kit.itemHead(card, 'Question');` — the kicker tag with the status. It stays.
  3. `kit.inlineMarkdown(card, input.summary, 'item-summary');`
  4. `kit.markdown(card, input.context, 'context-body md');`
  5. `const answer = kit.choiceList(card, 'recommended');`
  6. `kit.answerControls(answer);`
  7. `return { element: card };`

  The question card makes no `kit.section` call. `summary` and `context` are required non-empty strings (task 01),
  so the card draws both with no blank check.
- `layout.js` header comment: add one bullet that says the question card draws no section labels — the summary is
  its headline, and the context, the choices and the rationale follow with no label. Keep the other lines.
- `layout.d.ts` comments:
  - `QuestionKit.choiceList`: `div.answer` holds the Clear button row and `ol.choices`, with no label. `'recommended'`
    and `'all'` draw the rationale under the recommended choice with no label; `'none'` draws no reason. A blank
    rationale draws nothing.
  - `FindingKit.choiceGroups` keeps its `'Your answer'` and `'Why'` text: it stays true.
- CSS for the summary goes in `F/layouts/default/layout.css`, because the default layout picks the class. CSS for
  `.answer-head` goes in `F/page/forms.css`, because the kit draws it.
- The not-applicable dim rule (`layout.css`, `.item[data-status='not_applicable'] .context`) also dims the question
  card's unlabelled context and its summary. Use the direct-child selector for the context, so a finding's
  `section.context > .context-body` is not dimmed twice. The summary dims too, because the old Question section it
  replaces was dimmed.

## Pinned values

`F/layouts/default/layout.css`, under `/* Items */`:

```
:where(.form-tab) .item-summary {
  display: block;
  font-size: var(--wg-text-16);
  font-weight: var(--wg-weight-semibold);
  line-height: var(--wg-leading-prose);
  margin-bottom: var(--wg-space-2);
}
```

`--wg-text-16` is the step above `--wg-text-prose` that `src/shared/page/markdown.css` gives a heading.

The dim rule becomes three selectors with `opacity: 0.6`:

```
:where(.form-tab) .item[data-status='not_applicable'] .context,
:where(.form-tab) .item[data-status='not_applicable'] > .context-body,
:where(.form-tab) .item[data-status='not_applicable'] .item-summary
```

The inline-code rule `:where(.form-tab) .round-overview code` also selects `:where(.form-tab) .item-summary code`.

`F/page/forms.css`, after the `.answer` rule:

```
:where(.form-tab) .answer-head {
  display: flex;
  justify-content: flex-end;
}
```

## Behaviour

GIVEN a question card WHEN `choiceList(parent, 'recommended')` draws THEN the recommended choice holds a
`choice-reason` with no `choice-reason-label`, and the answer area holds no `ui-section-header`.
GIVEN a finding card WHEN `choiceGroups(parent, 'all')` draws THEN each choice reason holds a `choice-reason-label`,
and the answer area holds its `ui-section-header`.

## Tests

In `F/page/kinds/card-input.test.ts`:

- `questionCardInput_CarriesRationaleAndRound` — rename to `questionCardInput_CarriesSummaryRationaleAndRound`. Add
  `expect(input.summary).toBe('Beta summary')`. Break: `cardInput` drops the summary or copies the context into it.

In `F/page/layout/card-kit.test.ts`, `describe('card kit')`:

- `choiceReason_LabelByCardKind` — new `it.each`, one row per kind. Each row draws the kind's answer area with
  reasons shown and counts the elements by class with `findAll`:
  - row `question`: `questionKit(deps)`, `kit.choiceList(parent, 'recommended')` — expects one `choice-reason` and
    zero `choice-reason-label`. Break: the question kit passes a label again, or `buildChoiceReason` ignores `null`.
  - row `finding`: `findingKit(deps)`, `kit.choiceGroups(parent, 'all')` — expects one `choice-reason-label` per
    `choice-reason`, and at least one. Break: the `null` label leaks into the finding card.
- `answerArea_HeaderByCardKind` — new `it.each`, one row per kind, over the same two calls with reasons `'none'`:
  - row `question`: zero `ui-section-header` directly in the returned `div.answer`, and one `answer-head`. Break: the
    question card draws the `Your answer` header again.
  - row `finding`: one `ui-section-header` as the first child of the returned `div.answer`. Break: the finding card
    loses its header.
- `clearButton_Click_FocusesTheItemThenClears` — unchanged. It runs on the question kit, so it now proves the Clear
  button still works inside `div.answer-head`.

No test reads `layout.js` or the CSS. The look of the question card (headline size, no labels, the dim while not
applicable, the Clear row) belongs to "10 — Final verification".

Done when: `npm run typecheck` and `npm run lint` pass; the test gate runs the tests above.
Commit:    one commit for the group

## Proof

