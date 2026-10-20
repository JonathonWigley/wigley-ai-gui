# 07 — Self-test steps for layouts and the preview

Status: in progress
Type: Task
Wave: 5 · Depends on: 05, 06
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/forms/main/selftest-script.ts` · modify `src/plugins/forms/main/start.ts` (only to write
           the fixture layout and hand the script what it needs)
Consumes:  the page log lines `layout <name> shown (<reason>, revision <n>)` ← 05 ·
           `layout <layoutName> <kind> card failed: <errorText>` and `… card update failed: <errorText>` ← 02 ·
           keys `Space z l n` / `p` / `o` ← 05 · the preview and its `SessionInfo` ← 06 · `api.data` ← 03
Produces:  self-test steps only
Decisions: a key behaviour the agent adds gets a self-test step (AGENTS.md, Running and testing) · the card host's DOM
           behaviour is proved here, since the unit suite has no DOM (task 02) · log lines are written with source
           `forms`, so a step expects `[forms] …`
Commit:    one commit for the group

## Fixture

Forms' main `start` writes one fixture layout through `api.data` in the self-test only (`services.selfTest` not null),
before the script is handed over, and keeps the promise. The temp data folder (task 03) makes the write safe, and
rewriting it on a reload writes the same text. The file is `layouts/selftest/layout.js`:

- `question`: builds through the kit (`itemHead`, sections, `choiceList`, `answerControls`). Its `update` throws
  `Error('selftest update throw')`.
- `finding`: throws `Error('selftest throw')` at once.
- `notice`: calls `kit.textBox(parent, 'notes')`, which throws `notice card has no notes box`.

No `layout.css`. The registry lists the folder because it holds `layout.js`.

## Steps

The steps are inserted **before the existing step that opens the review** of the first fixture round, while that
round is open with its findings, questions and notices unanswered. The existing steps after them run unchanged on the
default layout, which step 5 restores.

1. `Space z l n` → `[forms] layout selftest finding card failed: selftest throw`. The card host logs it when
   `setLayout` builds the cards.
2. No keys → `[forms] layout selftest notice card failed: notice card has no notes box`.
3. No keys → `[forms] layout selftest shown (cycled, revision <n>)`, with `<n>` as the landed registry gives it.
4. A key that picks a choice on a question (the existing choose key, with focus on a question) →
   `[forms] layout selftest question card update failed: selftest update throw`. Picking a second choice adds no
   second line: the script's existing line checks show a step's added lines.
5. `Space z l p` → `[forms] layout default shown (cycled, revision <n>)`.

Then, after the existing steps end:

6. `Space z l o` → `[forms] round shown: Layout preview · Layout preview`, the line main's channel presenter logs
   for the preview round.

If the driver cannot read a line already logged by an earlier step's keys (steps 2 and 3), merge those expects into
step 1 in the order the page logs them, following the driver's semantics in `src/main/selftest.ts`. Note it in the
run log.

Done when: `npm run selftest` passes with the new steps (the test gate or this task's proof runs it; the user allows
the agent to run it any time).

## Proof
