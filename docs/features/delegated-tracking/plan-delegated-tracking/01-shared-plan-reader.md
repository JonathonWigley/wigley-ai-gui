# 01 — Shared plan reader

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Read first: `docs/features/workflow/design.md` § Heavy's stages and § Where it draws, `docs/features/backlog/design.md`
§ Plans and features and § Seams, and the plan's Mandatory Reads.

Files:     create `src/shared/plan-progress.ts` (moved from `src/plugins/workflow-heavy/plan-reader.ts`) ·
           test `src/shared/plan-progress.test.ts` (moved from `src/plugins/workflow-heavy/plan-reader.test.ts`) ·
           modify `src/plugins/workflow-heavy/contract.ts` · modify `src/plugins/workflow-heavy/heavy-state.ts` ·
           modify `src/plugins/workflow-heavy/main/plan-watch.ts` · modify `src/plugins/workflow-heavy/page/checklist.ts` ·
           modify `src/plugins/workflow-heavy/page/preview.ts` · modify `src/plugins/workflow-heavy/page/start.ts` ·
           modify `scripts/check-layers.mts` ·
           test `src/plugins/workflow-heavy/heavy-state.test.ts` · test `src/plugins/workflow-heavy/main/plan-watch.test.ts` ·
           test `src/plugins/workflow-heavy/page/checklist.test.ts` · test `src/plugins/workflow-heavy/page/start.test.ts` ·
           test `src/plugins/workflow-heavy/stages/reported-steps.test.ts` · test `src/plugins/workflow-heavy/stages/page-stages.test.ts` ·
           test `src/plugins/workflow-heavy/stages/main-stages.test.ts` · test `src/plugins/workflow-heavy/stages/review/main.test.ts` ·
           test `src/plugins/workflow-heavy/stages/closed/main.test.ts` · test `src/plugins/workflow-heavy/stages/plan-ready/main.test.ts` ·
           test `src/plugins/workflow-heavy-main.test.ts` · test `src/plugins/workflow-heavy-page.test.ts`
Consumes:  `fenceAfterLine` in `src/shared/markdown-fence.ts` (the tree holds it)
Produces:  in `src/shared/plan-progress.ts`:
           `export type TaskStatus = 'not started' | 'in progress' | 'done';`
           `export const TASK_STATUSES: readonly TaskStatus[]` — the three values, in that order
           `export interface PlanTaskLine { readonly wave: number | null; readonly text: string; readonly done: boolean; readonly file: string | null; readonly status: TaskStatus | null }`
           `export interface PlanProgress` — the fields of today's `plan-reader.ts`, unchanged
           `export function readPlanProgress(planText: string, taskTexts: ReadonlyMap<string, string>): PlanProgress;`
           `export function readTaskStatus(taskText: string): TaskStatus | null;`

## Decisions

- Move the file. Do not keep a re-export at the old path. `src/plugins/workflow-heavy/plan-reader.ts` and its test go
  away. Use `git mv`, so the history follows the file.
- The counts do not change. `checked`, `total`, `wave`, `reviewRounds`, `title` and each line's `wave`, `text` and
  `done` read as today. Every existing row of the moved test keeps its values and gains only `file` and `status`.
- `file` is the target of the first markdown link in the task line, after the box, trimmed. `file` is null when the
  line holds no link, or when the target holds `/`, `\`, `:` or `#`, or when the target does not end in `.md`. So
  `file` is always a bare file name in the plan folder, and a reader never reads outside the folder.
  Example: `- [x] ~~[Expiry clock](02-expiry-clock.md)~~ — dropped` gives `file: '02-expiry-clock.md'`.
- `status` is `readTaskStatus(taskTexts.get(file))` when `file` is not null and `taskTexts` holds `file`. Else
  `status` is null.
- `readTaskStatus` uses the rule of the docs index (`status_line` in
  `wigley-ai-marketplace/plugins/wigley/scripts/docs-index/markdown.py`), pinned here:
  1. Split the text on `\n`, and remove one trailing `\r` from each line.
  2. Keep the first 15 lines (`STATUS_SEARCH_LINES = 15`). Then drop the fenced lines from those 15, with the fence
     rule `linesOutsideFences` already uses.
  3. Find the first line that matches `/^(\*\*)?Status:(\*\*)?\s*(.+)$/`. Only the first match counts.
  4. Trim group 3. Return it when it is one of `TASK_STATUSES` exactly (case-sensitive). Else return null.
  5. Return null when no line matches.
- `linesOutsideFences` takes lines, so `readPlanProgress` and `readTaskStatus` use one fence reader. Keep it private to
  the module.
- `src/plugins/workflow-heavy/contract.ts`: `isPlanTaskLine` also accepts `file` as a string or null and `status` as
  one of `TASK_STATUSES` or null. It also accepts a line where `file` and `status` are both absent: the workflow
  flow store saves `flow.state`, so a flow saved before this change holds such lines. If the guard refuses them,
  `heavyStateIn` reads the empty state and the session forgets its plan folder. The next plan read replaces the old
  progress. Write this reason in a comment beside the guard. A line with only one of the two fields absent, or with
  another `status` value, fails the guard.
- `src/plugins/workflow-heavy/main/plan-watch.ts`: the read calls `readPlanProgress(text, new Map())`. Task 06
  replaces this read. Do not read task documents in this task.
- `src/plugins/workflow-heavy/page/preview.ts`: each `PREVIEW_TASKS` entry gains `file: null` and `status: null`. The
  type `Omit<PlanTaskLine, 'done'>` stays.
- `sameProgress` in `heavy-state.ts` does not change in this task. Task 06 adds `file` and `status` to it.
- Update every import of `plan-reader` to `src/shared/plan-progress` (the relative path from each file). The list is in
  Files above. Each test that builds a `PlanTaskLine` by hand adds `file: null, status: null`, or the link target when
  the row reads a plan text with a link.
- `scripts/check-layers.mts`: remove every `src/plugins/workflow-heavy/plan-reader.ts` entry:
  - from `HEAVY_SUBLAYERS` (it keeps `'src/plugins/workflow-heavy/stages'` alone)
  - from `HEAVY_FOLD_TEST_RULE.layers`
  - from the `workflow-heavy` `contract` layers (it keeps `'src/shared'`)
  - the `sublayers` entry keyed by `plan-reader.ts`
  - from the `stages` sublayer, the `page/start.test.ts` sublayer, and the `src/plugins/workflow-heavy-main.test.ts`
    and `src/plugins/workflow-heavy-page.test.ts` rules
  Add no new entry. Each rule above that loses `plan-reader.ts` must still hold `'src/shared'`; add `'src/shared'` to a
  rule that does not hold it yet (the `stages` sublayer holds only `src/contracts` and plugin layers today). The new
  module imports only `src/shared/markdown-fence.ts` and has no `node:` import (plan.md § Boundary rules).

## Behaviour

GIVEN a plan line `- [ ] [03 — Claim grants](03-claim-grants.md) — after 01` and task texts that map
`03-claim-grants.md` to a text with `Status: in progress` on line 3 WHEN `readPlanProgress` runs THEN that line reads
`{ wave, text: '03 — Claim grants — after 01', done: false, file: '03-claim-grants.md', status: 'in progress' }`.

GIVEN a task text whose first `Status:` line sits on line 16 WHEN `readTaskStatus` runs THEN it returns null.

GIVEN a flow state saved before this change, whose task lines hold no `file` and no `status` WHEN `heavyStateOf` reads
it THEN it returns that state object.

## Tests

- `src/shared/plan-progress.test.ts`, `describe('readPlanProgress')`, the moved row table: each row's `expected.tasks`
  gains `file` and `status`. Each row gains an optional `taskTexts` (default an empty map). The `TWO_WAVE_PROGRESS`
  lines read `file: '00-spike.md'`, `'01-reward-grant-seam.md'`, `'02-expiry-clock.md'`, `'03-claim-grants.md'`, each
  `status: null`. New rows:
  - `a linked task document's Status line is the line's status` — two linked lines; the texts map gives one
    `Status: done` and one `**Status:** in progress`; statuses `'done'` and `'in progress'`. Catches a reader that
    reads the status from the plan line, or keys the map by the line text.
  - `a linked file the texts lack has a null status` — catches a reader that defaults the status to `not started`.
  - `a task line with no link has a null file` — catches a reader that takes the line text as the file.
  - `a link target with a folder, a colon or a fragment has a null file` — three lines:
    `[A](../a.md)`, `[B](https://x.md)`, `[C](03-c.md#proof)`. Catches a reader that reads outside the plan folder.
  - `a link target that is not a .md file name has a null file` — three lines: `[D](03-d.txt)`, `[E](03-e)`,
    `[F](a\b.md)`. Catches a reader that drops the `.md` or separator rule.
  - `only the first link of a line is its file` — `[A](01-a.md) see [B](02-b.md)` gives `'01-a.md'`.
- `src/shared/plan-progress.test.ts`, `describe('readTaskStatus')`, one `it.each`
  `readTaskStatus_FirstStatusLine_ReadsOneOfThreeValues ($name)`, rows (text → expected):
  - `Status: in progress` on line 3 → `'in progress'`
  - `**Status:** done` → `'done'`
  - `Status:not started` (no space) → `'not started'`
  - `Status: done   ` (trailing spaces) → `'done'`
  - `Status: done\r` (CRLF) → `'done'`
  - `Status: Done` → null (case-sensitive)
  - `Status: blocked` → null
  - `Status: blocked` then `Status: done` on the next line → null (only the first match counts)
  - ` Status: done` (leading space) → null
  - `Status: done` inside a backtick fence, and no other → null
  - `Status: done` inside a fence, then `Status: in progress` after it → `'in progress'`
  - `Status: done` on line 16 → null
  - `Status: done` on line 15 → `'done'`
  - a closed fence on lines 1 to 3, then `Status: done` on line 17 → null. Catches a reader that drops fenced lines
    before it takes the first 15.
  - empty text → null
  Catches a reader that drifts from the docs index rule.
- `src/plugins/workflow-heavy/heavy-state.test.ts`, `heavyStateOf_BadShape_ReadsEmpty`: add the rows
  `a task line with a status not a task status` (`status: 'paused'`) and `a task line with file but no status`.
  Add a row to the valid-state test (make it an `it.each` if it is a single `it`):
  `a task line saved before file and status` reads as that object. Catches the guard that drops a saved plan.
- Every other test in Files: no new case. It changes only its import and its hand-built lines.

Done when: `npm test` passes and `npm run lint` passes (it runs `scripts/check-layers.mts`). No file imports
`plan-reader`. The test gate runs the tests above.
Commit:    one commit for the group

## Proof

Commit dde8194a · proof: diff read: TaskStatus, TASK_STATUSES, PlanTaskLine (file, status), PlanProgress, readPlanProgress(planText, taskTexts), readTaskStatus in src/shared/plan-progress.ts; plan-reader.ts gone; heavy + plan-progress tests pass (472); check-layers clean for its files · concerns: git mv staged the renames; oxfmt not yet run (lint gate at wave end); test helpers UNLINKED/linked() instead of literal rows
