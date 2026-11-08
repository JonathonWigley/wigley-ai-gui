# 01 — Question summary field

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Paths are relative to the gui worktree. `F` = `src/plugins/forms`.

Files:     modify `F/contract.ts` · modify `F/main/kinds/question/question-format.ts` · modify `F/main/round.ts` (comment only) ·
           modify `F/page/kinds/question/question-card.ts` (one line, compile fix) · modify `F/page/test-rounds.ts` ·
           modify `F/main/preview/preview-round.ts` · modify `src/plugins/chat/main/selftest-script.ts` ·
           test `F/main/kinds/question/question-format.test.ts` · test `F/main/round.test.ts` ·
           test `F/main/round-type.test.ts` · test `F/main/tool-definitions.test.ts` · test `F/page/form-state.test.ts`
Consumes:  none
Produces:  `export interface Question { title: string; summary: string; context: string; choices: string[]; recommend: number; rationale: string; layout: string | null }` in `F/contract.ts`
           `const QUESTION_FIELDS = ['title', 'summary', 'context', 'choices', 'recommend', 'rationale']` in `F/main/kinds/question/question-format.ts`
           `questionFormat.fingerprintContent` returns `{ title, summary, context, choices, recommend, rationale }` (key `summary`) in `F/main/kinds/question/question-format.ts`
           `questionFormat.arraySchema.items.properties.summary: { type: 'string', description: … }`, with `summary` in `required` and no `question` property, in `F/main/kinds/question/question-format.ts`
           `question(title, overrides)` in `F/page/test-rounds.ts` sets `summary: \`${title} summary\``
Do not touch: `F/main/selftest-script.ts`. Task 07 owns it.

## Decisions

- `summary` replaces `question` in `Question` (plan.md § Shared names). Keep the field order `title, summary, context,
  choices, recommend, rationale, layout`. Add a one-line comment over `summary`: "The card's headline: what the user
  is asked to decide, and why now."
- The schema requires `summary`. `additionalProperties: false` stays. The schema has no `question` property
  (user, round 1).
- `parseQuestion` reads a legacy `question` as the summary when `summary` is absent. This keeps saved round files
  with the old shape loadable (round 1, Decided). The rules, in this order:
  1. The item has both `summary` and `question`: throw a `RoundError` with the pinned "both" text below. Do this check
     before the missing-field check.
  2. Missing fields: `fieldsMissing(item, QUESTION_FIELDS)`, then drop `summary` from the list when
     `Object.hasOwn(item, 'question')`.
  3. Unknown fields: the known list is `[...QUESTION_FIELDS, 'question', 'layout']`. Name the legacy field in one
     constant, `LEGACY_SUMMARY_FIELD = 'question'`, with a comment that says why it is accepted.
  4. `summary = requireText(Object.hasOwn(item, 'summary') ? item.summary : item.question, 'summary', where)`. A
     blank legacy `question` fails as a blank `summary`.
  5. The returned object holds `summary` and no `question`.
- The parse cannot tell a saved file from a live call. An agent on an old schema that sends `question` also passes.
  That is accepted: the one tolerance the user chose (plan.md § Architecture notes).
- `fingerprintContent` hashes the summary under the key `summary`, in place of `question` (round 1, Decided). Every
  question round now hashes to a new value. A round saved before this change does not re-attach to a re-send. The
  user accepted this when the summary joined the fingerprint.
- `F/main/round.ts`, the comment over `fingerprint()`: it says a round the Python server could send "hashes the same
  and its saved rounds match". After this change that holds for a round with no questions only. Change the comment
  to say so. Change no code in `round.ts`.
- `F/page/kinds/question/question-card.ts` reads `question.question`, and the `Question` type loses that member.
  Change the one line to `question: question.summary` so the tree compiles at the end of Wave 1. Task 02 renames the
  card field to `summary`. Change nothing else in that file.
- The schema descriptions are prose inside code, so they land with this task. They match
  `/Users/jonathonwigley/Documents/ai-dev/.worktrees/wigley-agents-forms-rundown/forms.md` § Questions. Read that
  section first.
- The preview round's two questions take the rundown style: a summary, a prose context, and `:::details Sources` in
  place of `:::details Full text`. They show the new look in `Space z l o`. `F/main/preview/preview-round.test.ts`
  pins no question text, so it does not change. Task 06 edits the notices in the same file in Wave 2.
- `F/main/kinds/fields.test.ts` builds no raw question (it passes only the `'Question 1: '` prefix). It does not
  change.

## Pinned values

Missing-field error, after `${where}missing ${missing.join(', ')}. `:

```
All six fields are required: title, summary, context, choices, recommend, rationale.
```

Both-fields error:

```
${where}has both summary and question. Send summary alone: question is its old name.
```

Schema descriptions, verbatim (each string may wrap across `+` joins as the file does today):

- `QUESTIONS_DESCRIPTION`: `Open decisions that are not review findings — one object per question. Each draws as its own card after the findings and before the notices page: the summary, the context, then the choices with the rationale under the recommended one. The card draws no section labels.`
- `title`: `A short name for the decision. It is the item's name in the rail, and the card does not draw it.`
- `summary` (new property, placed after `title`): `One or two plain sentences: what the user is asked to decide, and why it needs deciding now. It is the card's headline, drawn first, so it stands alone; the context does not repeat it. Inline markdown.`
- `context` (`QUESTION_CONTEXT_DESCRIPTION`): ``The rundown: what the user needs to know to answer, in a few short paragraphs of plain prose with no headings and no labelled parts. Add a visual only when the question is about a shape, such as a flow or a layout. Put the evidence last, in a `:::details Sources` block. A question about concrete changes opens instead with a `:::changes` block for a few changes, or a `:::tree` block when they span several places. Close each block with a line holding only `:::`. Markdown. Wording: ~/wigley-agents/forms.md § Questions.``
- `choices`: unchanged.
- `recommend`: unchanged.
- `rationale`: `Why the recommended choice, in a sentence or two. It draws under that choice with no label, so it reads on from the choice and does not repeat it.`

Preview round questions in `F/main/preview/preview-round.ts`. Keep the titles, choices, recommend values and the
rationale of each. Replace `question` and `context` with:

- Question 1, `Card width`:
  - `summary`: `Pick how wide a card draws. Every card in the Form tab takes this width, so it sets how long each line of context runs.`
  - `context`: `'Cards fill the main area today. On a wide window a line of context runs past a hundred characters, and the eye loses its place at the start of the next line.\n\nA cap keeps each line short. The rail and the space around the card stay as they are.\n\n:::details Sources\n- the forms view: a card takes the full width of the main area\n:::'`
- Question 2, the long title:
  - `summary`: `Choose which round the Form tab shows when the user comes back to a session that has several rounds waiting.`
  - `context`: the text below, with the existing `ts` fence moved inside the Sources block:

    ~~~~
    Each session keeps at most one open round. A round waiting behind it opens only once the open one finishes, so
    the Form tab never holds two rounds of one session. The user can still switch to another session halfway
    through an answer and come back.

    Switching sessions keeps every answer typed so far, and a re-sent round is pre-filled from its saved answers. So
    nothing is lost either way; the choice is only which round greets the user on the way back.

    :::details Sources
    - the rail lists every item of the open round
    - `FormsSession.open`:

    ```ts
    interface FormsSession {
      open(args: unknown, toolUseId: string | null, signal: AbortSignal): Promise<AnswersPayload>;
    }
    ```
    :::
    ~~~~

    The line breaks inside each paragraph above are for this document only: each paragraph is one line in the
    string, and paragraphs join with `\n\n`.

Chat self-test (`src/plugins/chat/main/selftest-script.ts`, `chatRound`): the one question replaces
`question: 'Pick one.'` with `summary: 'Pick one.'`.

Test builders: each raw-question helper replaces `question: …` with `summary: …` and keeps its text:
`F/main/round.test.ts` `question()`, `F/main/round-type.test.ts` `question()` and its `PLACEMENT_ARGS` override,
`F/main/tool-definitions.test.ts` (the `questions` sample item), `F/main/kinds/question/question-format.test.ts`
`question()`, and `F/page/form-state.test.ts` `question()` (typed `Question`). `F/page/test-rounds.ts` `question()`
sets `summary: \`${title} summary\``. The inline raw question in `F/main/round.test.ts`'s
`equals the Python server's fingerprint for the same round` (`question: 'Which name should win?'`) becomes
`summary: 'Which name should win?'` too, so the pinned hash covers the new shape, not the legacy path.

## Behaviour

GIVEN a question item with `question` and no `summary` WHEN `questionFormat.parse` runs THEN it returns that text as
`summary`.
GIVEN a question item with both `summary` and `question` WHEN `questionFormat.parse` runs THEN it throws a
`RoundError` that names both.
GIVEN two rounds that differ only in one question's summary WHEN `fingerprint` runs on each THEN the hashes differ.

## Tests

In `F/main/kinds/question/question-format.test.ts`:

- `names every missing question field and the six required names` — make it an `it.each` table over the deleted
  fields. Each row asserts the message starts `Question 1: missing <names>` and contains
  `title, summary, context, choices, recommend, rationale`.
  - row: delete `context` and `rationale` (the existing case) — expects `context, rationale`.
  - row: delete `summary`, with no `question` — expects `missing summary.`. Break: the legacy rule drops `summary`
    from the missing list even when `question` is absent.
- `reads the summary from summary, or from a saved round's question` — new `it.each`, the parsed `summary` per row:
  - row: `summary: 'S'` — expects `'S'`.
  - row: no `summary`, `question: 'Q'` — expects `'Q'`. Break: the legacy fallback removed, so an old saved round no
    longer loads.
- `refuses a blank summary or a blank legacy question, naming summary` — new `it.each`; each row's message matches
  `/^Question 1: summary must be a non-empty string/`:
  - row: `summary: '  '`. Break: `requireText` skipped for the summary.
  - row: no `summary`, `question: '  '`. Break: the fallback reads the legacy text without the blank check.
- `refuses a question with both summary and question, naming both` — new; the message matches
  `/^Question 1: .*summary.*question/`. Break: the both-present check removed, so the parse silently keeps one.
- `refuses an extra question field, naming it` — unchanged. It still catches a known-field list that lets any field
  through.

In `F/main/round.test.ts`, `describe('fingerprint')`:

- `changes with the question text` — rename to `changes with the summary`. Override `summary: 'Which name loses?'`.
  Break: `summary` left out of `fingerprintContent`.
- `hashes a round with no findings as it did before findings existed` (rename to
  `hashes a round with no findings with no findings key`, since the re-pinned hash is no longer the old one) and
  `equals the Python server's fingerprint for the same round` — both pin a hash of a round that holds a question.
  The key rename changes both hashes. Re-pin each from an independent oracle, not from the code under test: run
  `python3 -c` with the standard library only, building the same `{"notices": [...], "questions": [...]}` content
  with the key `summary`. Each item holds the fields its kind's `fingerprintContent` returns (read
  `F/main/kinds/notice/notice-format.ts` for the notice fields). Then compute `hashlib.sha256(json.dumps(content, sort_keys=True, ensure_ascii=False).encode('utf-8')).hexdigest()`.
  Paste each result into its test. Rename the second test to
  `equals Python's json.dumps hash for the same round`, since the Python server never sent `summary`. Break:
  `pythonJsonDumps` drifts from Python's output (key sort, separators, escapes), or the empty findings list joins the
  hash.
- `keeps a valid two-question round in order` (`describe('parseRound')`) — the two overrides set `summary`, and the
  assert reads `round.questions[1].summary`.

In `F/main/tool-definitions.test.ts`: the `questions` row of
`publishes the $argsKey required fields and cap that parseRound enforces` sends `summary` in place of `question`. The
row's delete loop now covers `summary`. It catches a schema `required` list that parse does not enforce.

No other test changes. `F/main/round-type.test.ts`, `F/page/form-state.test.ts` and `F/page/test-rounds.ts` change
only their builders.

Runtime and visual checks (the preview round's look in `Space z l o`) belong to "10 — Final verification".

Done when: `npm run typecheck` and `npm run lint` pass; the test gate runs the tests above. `F/main/selftest-script.ts`
still sends `question` until task 07; the self-test is not part of this gate.
Commit:    one commit for the group

## Proof

