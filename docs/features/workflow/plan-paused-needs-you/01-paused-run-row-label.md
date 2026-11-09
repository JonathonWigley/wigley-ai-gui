# 01 — Paused run row label

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/workflow/contract.ts` · create `src/plugins/workflow/contract.test.ts` · modify `src/plugins/workflow-large-page.test.ts` · modify `src/plugins/workflow-small/layouts/default/layout.js` and `layout.test.ts` · modify `src/plugins/workflow-medium/layouts/default/layout.js` and `layout.test.ts`
Consumes:  `NEEDS_YOU_ACTIVITY` in `src/plugins/sessions/contract.ts` (exists) · `isBusy`, `PageStage.status`, `PageStage.rowActivity`, `STAGE_ACTIVITY_RANK` in `src/plugins/workflow/contract.ts` (exist)
Produces:  `export const PAUSED_RUN_ACTIVITY: RowActivity` in `src/plugins/workflow/contract.ts`
           `export function shownRowActivity(stage: PageStage, flow: SessionFlow): RowActivity | null` in `src/plugins/workflow/contract.ts` (signature unchanged, new branch)
Decisions: label is Needs you, the same word, tone and emphasis as `NEEDS_YOU_ACTIVITY` (round 1) · rank 18, between chat's working (20) and the stage labels (15) (round 2 notice) · a stage's own `rowActivity` wins (round 2, Q1) · no clear on view (round 2, Q2) · the rule reads `stage.status(flow) === 'paused'`, with no new stage field (design review) · Small's and Medium's chips leave out the stage tag when `onRowLabel` is true, as Large's does and as `docs/features/workflow/design.md` § Row chip already says of every built-in layout (cold read)

Pinned values:
- `PAUSED_RUN_ACTIVITY` is `{ ...NEEDS_YOU_ACTIVITY, rank: 18 }`. Spread the sessions constant, so the word, tone and
  emphasis keep one home.
- One-line comment above it, in the style of the `STAGE_ACTIVITY_RANK` comment: under chat's working and error,
  above a stage's own label.
- `shownRowActivity` order: busy → `null`; else `stage.rowActivity` when set; else `PAUSED_RUN_ACTIVITY` when
  `stage.status(flow) === 'paused'`; else `null`.
- Rewrite the `PageStage.rowActivity` comment and the `shownRowActivity` comment so they say a paused stage with no
  `rowActivity` shows `PAUSED_RUN_ACTIVITY`.
- Small's and Medium's default `layout.js` `chip` wrap `kit.stageTag(chip, input.label, input.status)` in
  `if (!input.onRowLabel)`, the same guard as `src/plugins/workflow-large/layouts/default/layout.js:111`. Today they
  draw the tag always, so a paused Small or Medium row would show Needs you and the chip's `Build` tag together.

GIVEN a Small, Medium or Large flow at a stage whose status is paused (no turn, no subagent) WHEN the workflow page draws the row THEN the row activity is `needs you` at rank 18
GIVEN the same flow with a turn or a subagent running WHEN the row draws THEN the workflow sets no row activity
GIVEN plan ready or closed, not busy WHEN the row draws THEN the row keeps `ready to make` or `closed`
GIVEN a done stage, or Large's idle stage WHEN the row draws THEN the workflow sets no row activity
GIVEN a Small, Medium or Large chip with `onRowLabel` true WHEN the chip draws THEN it draws the badge and no stage tag

The first GIVEN reaches real Small and Medium stages through the precondition grep (each mid-run stage uses
`busyStatus`), not a test; the Large page test proves the wiring once.

Tests:
- `src/plugins/workflow/contract.test.ts`: one `it.each` table, `shownRowActivity_StatusAndRowActivity_TheRowsActivity`.
  Build each `PageStage` in the test with only the fields the rule reads (`status`, `rowActivity`), and each flow with
  `newFlow('a', '/p')` from `./flow` (`src/plugins/workflow/flow.ts`, as `workflow-view.test.ts` uses it), spread with
  `{ turnRunning: true }` for a running turn or `{ runningSubagents: ['agent-1'] }` for a running subagent (the
  values of `BUSY` in `workflow-large-page.test.ts`). Rows, each with the expected activity as a literal (`word` and `rank`, or `null`):
  - status `'paused'`, no `rowActivity`, not busy → `needs you`, rank 18
  - status `'paused'`, no `rowActivity`, turn running → `null`
  - status `'paused'`, no `rowActivity`, a subagent running → `null`
  - status `'running'`, no `rowActivity` → `null`
  - status `'done'`, no `rowActivity` → `null`
  - status `null`, no `rowActivity` → `null`
  - status `'ready'`, a `rowActivity` of rank 15 → that activity
  - status `'paused'`, a `rowActivity` of rank 15 → that activity (a stage's own label wins)
- `src/plugins/workflow-large-page.test.ts`, table `setFlow_$stage_RowLabelReads$word`: change the row
  `{ stage: 'make', fields: {}, word: null, tag: true }` to `{ stage: 'make', fields: {}, word: 'needs you', tag: false }`,
  and add `{ stage: 'make', fields: BUSY.turn, word: null, tag: true }`. These rows prove the wiring once.
- `src/plugins/workflow-small/layouts/default/layout.test.ts` and the Medium one: turn `chip_DrawsBadgeFirst` into an
  `it.each` over `onRowLabel`, in the shape of Large's `chip_DrawsTheBadgeFirst onRowLabel $onRowLabel`: `false` draws
  the badge then the `Build` tag (the current assertions), `true` draws the badge alone.

Done when: `npm run lint` passes; the test gate runs the four test files above.
Commit:    one commit for the group

## Proof

