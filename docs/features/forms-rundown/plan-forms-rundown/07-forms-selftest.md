# 07 — Forms self-test

Status: not started
Type: Task
Wave: 5 · Depends on: 01, 02, 04, 05, 06
Plan: [plan.md](plan.md)

Paths are relative to the gui worktree `/Users/jonathonwigley/Documents/ai-dev/.worktrees/wigley-ai-gui-forms-rundown`.
`F` = `src/plugins/forms`.

Files:     modify `F/main/selftest-script.ts` (only this file)
Consumes:  `Question.summary` (raw `ask_round` arg `summary` replaces `question`) ← 01
           `QuestionCard.summary` (the `selftest` layout's question card reads it) ← 02
           `railItems(round)`: findings, questions, then `{ kind: 'notices' }` ← 04
           `forms.nextLine` / `forms.prevLine` bound to `j` / `k` in `forms.forms`; `<CR>` stays
           `forms.acceptRecommendation` and toggles the cursor line on the notices stop; `a` (`forms.editNotes`) on the
           notices stop opens the cursor line and focuses its comment box; `k` on the first line moves focus to the
           item before the stop ← 04
           the `notices` pane, each line's body drawn by `cards.notice` through the item chain ← 05
           `PREVIEW_ROUND_ARGS.notices` holds three notices (Applied, Dispatched, Decided) ← 06 (screenshot content
           only; 06 lands in Wave 2)
Produces:  the self-test steps below, and the `notice comments` group, in `F/main/selftest-script.ts`
Decisions: notices page last (round 3) · notices page keys (round 4, choice 1) · answers unchanged, notices match by
           index (round 4, Decided) · one new step proves a notice comment reaches the result (map § 6, Live)

## Facts the steps rest on

Read from the tree at plan time. The implementer re-checks each one in the landed code of 04 and 05.

- The page logs every bound key as `[page] <keys> ran <command id>` (`src/shared/command-router.ts:74`). So after
  task 04 every `j` and `k` in `forms.forms` logs `[page] j ran forms.nextLine` and `[page] k ran forms.prevLine`.
  `<C-h>` still logs `[page] <C-h> ran forms.prevItem`.
- A focused box logs `[forms] focused <box>` (`src/shared/page/editor-boxes.ts:102`). A notice comment box is
  named `comment on notice <n>` (`F/page/boxes.ts:45`). So `a` on notice 1 logs `[forms] focused comment on notice 1`.
- `NoticeResult.comment?: string` (`F/contract.ts:200`). `payload.notices[i]` matches `round.notices[i]`.
- A step's `expect` matches the first such line logged after the step began. Two keys in one step that log the same
  line race the next step. Each walk below therefore moves one item per step where a screenshot follows.

When task 04 or 05 logs a different line than these facts give (for example a line for the toggle), use the landed
line, and record the change under the group's Proof as a concern.

## Edits

### 1. Raw question arguments: `question` → `summary`

Rename the key, keep the value:

| Where | Now | After |
|---|---|---|
| `fixtureRound` question 1 | `question: \`Pick one of ${LONG_WORD}.\`` | `summary: \`Pick one of ${LONG_WORD}.\`` |
| `fixtureRound` question 2 | `question: 'Pick one.'` | `summary: 'Pick one.'` |
| `secondRound` `waiting` | `question: 'Pick one.'` | `summary: 'Pick one.'` |
| `layoutsRound` `question` | `question: 'Pick one.'` | `summary: 'Pick one.'` |
| `SELFTEST_LAYOUT` text, `cards.question` | `kit.section(article, 'Question', input.question);` | `kit.section(article, 'Question', input.summary);` |

The last row is layout source inside a template string, so the compiler does not check it. `unknownLayoutRound`
holds no question.

### 2. Every `j` and `k` expect line in `forms.forms`

Replace `'[page] j ran forms.nextItem'` with `'[page] j ran forms.nextLine'`, and `'[page] k ran forms.prevItem'` with
`'[page] k ran forms.prevLine'`, in every step that presses a plain `j` or `k` on the form. At plan time these are in
PREVIEW_ROUND_STEPS, FINDING_PICKS_STEPS, QUESTION_BOXES_STEPS, CHOICES_STEPS, SECOND_SESSION_STEPS and
ROUND_LAYOUTS_STEPS. Leave `PAGE_BINDS` (`q a x y` → `forms.nextItem`) and the `<C-h>` step unchanged.

### 3. PREVIEW_ROUND_STEPS (rewrite)

The preview round has 3 findings, 2 questions and 3 notices. It now opens on the Defect, position 0, and the notices
stop is last. The `k` step to the notice goes. The new walk, step by step:

| # | `keys` | `expect` | other fields |
|---|---|---|---|
| 1 | `[' ', 'z', 'l', 'o']` | `'[sessions] activated Layout preview'` | `checksFit: true`, `screenshot: 'preview-defect'`, `why: 'A round opens on its first finding, the Defect.'` |
| 2 | `['j']` | `'[page] j ran forms.nextLine'` | `checksFit: true`, `screenshot: 'preview-decision'` |
| 3 | `['j']` | `'[page] j ran forms.nextLine'` | `checksFit: true`, `screenshot: 'preview-nit'` |
| 4 | `['j']` | `'[page] j ran forms.nextLine'` | `checksFit: true`, `screenshot: 'preview-question'`, `why: 'The question card draws its summary as the headline, then the context, then the choices with the rationale under the recommended one, and no section label.'` |
| 5 | `['j']` | `'[page] j ran forms.nextLine'` | — |
| 6 | `['j']` | `'[page] j ran forms.nextLine'` | `checksFit: true`, `screenshot: 'preview-notices'`, `why: 'The notices stop is last: one line per notice, badged Applied, Dispatched and Decided, each closed.'` |
| 7 | `['Enter']` | `'[page] Enter ran forms.acceptRecommendation'` | `checksFit: true`, `screenshot: 'preview-notice'`, `why: 'Enter on the notices stop opens the line under the cursor, the Applied notice, to its context and comment box.'` |

`preview-question` is a new screenshot (Decided: the label-free card gets a capture of its own). The old
`preview-notice` name now holds the open notice line.

Update the `preview round` group's `why` to end: `…, its Nit recommends a bare Leave it header with its reason, its
question card draws no section labels, and its notices page, the last stop, opens a line with Enter.`

### 4. FINDING_PICKS_STEPS, the first step

The fixture round now opens on finding 1, position 0, so `Space k k` finds no item before it, and the old `j` would
land on finding 2. Replace the first two steps with three:

| # | `keys` | `expect` | other fields |
|---|---|---|---|
| 1 | `[' ', 'k', 'k']` | `'[page] k ran forms.prevLine'` | `checksFit: true`, `why: 'Space k then k breaks Space k s, so the first k replays; the round opens on finding 1, its first stop, so neither k finds an item before it.'` |
| 2 | `['j']` | `'[page] j ran forms.nextLine'` | `why: 'j moves to finding 2, so the next k has an item to return to.'` |
| 3 | `['k']` | `'[page] k ran forms.prevLine'` | `checksFit: true`, `screenshot: 'round'`, `why:` the old `j` step's why, verbatim (`'Fix now holds choices 1 and 2, then Follow-up and Leave it sit as bare headers drawn as choice rows, numbered 3 and 4 in their span.choice-number.'`) |

The steps after it (`2` chose 2 on finding 1, …) stay as they are, with edit 2 applied.

### 5. ROUND_LAYOUTS_STEPS, the walk to question 2

The layouts round is: the Nit (0), question 1 (1), question 2 (2), the notices stop (3). It still opens on the Nit.
Replace the `k` step (screenshot `round-layout-notice`) and the `['j', 'j', 'j', '1']` step with:

| # | `keys` | `expect` | other fields |
|---|---|---|---|
| 1 | `['j']` | `'[page] j ran forms.nextLine'` | — |
| 2 | `['j']` | `'[page] j ran forms.nextLine'` | `alsoExpect: [/layout selftest question card update failed: selftest update throw/]`, `why: "j shows question 2 first here. It names no layout, so the round's selftest draws it, and its update throws, logged once per card."` |
| 3 | `['j']` | `'[page] j ran forms.nextLine'` | `checksFit: true`, `why: 'Question 2 is the last question, so the third j reaches the notices stop.'` |
| 4 | `['Enter']` | `'[page] Enter ran forms.acceptRecommendation'` | `checksFit: true`, `screenshot: 'round-layout-notice'`, `why: "The round's selftest notice card mounts a box a notice lacks, so the open line's body draws in default."` |
| 5 | `['k', '1']` | `'[forms] chose 1 on question 2'` | `why: "k on the first notice line moves focus to question 2, the item before the stop, and 1 picks its first choice."` |

The steps after it (`1` cleared the choice on question 2, the layout saves, the settings writes) stay as they are.
The save steps still expect `notice card failed: notice card has no notes box` and `selftest-user notice card
failed: selftest user throw`: each notice body is still a `cards.notice` (05).

### 6. New group `notice comments`, between `round layouts` and `review`

It starts where `round layouts` ends: the fixture round, focus on question 2. Add a const `NOTICE_COMMENT_STEPS` and
the group:

- `name: 'notice comments'`
- `why: "On the round's last stop, the notices page, Enter opens the line under the cursor, a focuses its comment box, the text typed there reaches the result as the notice's comment, and k on the first line returns to the last question."`

| # | `keys` | `expect` | other fields |
|---|---|---|---|
| 1 | `['j']` | `'[page] j ran forms.nextLine'` | `checksFit: true`, `screenshot: 'round-notices'`, `why: 'Question 2 is the last question, so j reaches the notices stop.'` |
| 2 | `['Enter']` | `'[page] Enter ran forms.acceptRecommendation'` | `why: 'Enter on the notices stop opens notice 1, the line under the cursor.'` |
| 3 | `['a']` | `'[forms] focused comment on notice 1'` | `why: 'a focuses the open line's comment box in INSERT, so the next step types at once.'` |
| 4 | `[...'reconsider', 'Escape', 'Escape']` | `'[forms] left the box'` | `checksFit: true`, `screenshot: 'round-notice-comment'`, `why: 'The first Esc goes to NORMAL, the second leaves the box; the comment is checked in the result once the round is sent.'` |
| 5 | `['k']` | `'[page] k ran forms.prevLine'` | `why: 'k on the first notice line moves focus to question 2, where the review group starts.'` |

Update the `<C-k>` step's `why` in REVIEW_STEPS. Now it begins `"Ctrl+k reaches the review's round: the round
layouts group left the main column at the top (its last redraw of this round, the nosuch settings write, and its last
j both scroll it there), …"`. After: `"Ctrl+k reaches the review's round: the notice comments group left the main
column at the top (its last k moves the focus, which scrolls it there), …"`, the rest unchanged.

### 7. The result check

In `payloadProblems`, after the `payload.notices.length === 1` row, add:

```ts
// "reconsider" proves a comment typed on the notices page reaches the
// result as the notice's comment.
[
  payload.notices[0]?.comment === 'reconsider',
  `notice 1 comment ${JSON.stringify(payload.notices[0]?.comment)}`,
],
```

`payload.summary` is unchanged: it counts findings and questions only (`F/main/round.ts:367`).

GIVEN the fixture round on its notices stop WHEN the user presses Enter, `a`, types `reconsider` and leaves the box,
then sends the round THEN `payload.notices[0].comment` is `'reconsider'`.

## Other steps checked at plan time

No other step relies on notices first. QUESTION_BOXES (`j` finding 3 → question 1), BROKEN_BIND (`j` → question 2),
CHOICES (`<C-h>` → question 1, `j` → question 2), SECOND_SESSION (no notices), SIDE_BAR, CANCELLED_PREVIEW, REVIEW
and SAMPLE_ROUND_AGAIN keep their positions; only edit 2 touches their expect lines.

Tests:     none in Vitest. The self-test steps are the live proof, and they run in task 10.
Done when: compiles (`npm run typecheck`); `npm run lint` passes. The self-test runs in task 10.
Commit:    one commit for the group, in the gui worktree.

## Proof

