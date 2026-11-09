# 01 — Paused run row label

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/workflow/contract.ts` · create `src/plugins/workflow/contract.test.ts` · modify `src/plugins/workflow-large-page.test.ts`
Consumes:  `NEEDS_YOU_ACTIVITY` in `src/plugins/sessions/contract.ts` (exists) · `isBusy`, `PageStage.status`, `PageStage.rowActivity`, `STAGE_ACTIVITY_RANK` in `src/plugins/workflow/contract.ts` (exist)
Produces:  `export const PAUSED_RUN_ACTIVITY: RowActivity` in `src/plugins/workflow/contract.ts`
           `export function shownRowActivity(stage: PageStage, flow: SessionFlow): RowActivity | null` in `src/plugins/workflow/contract.ts` (signature unchanged, new branch)
Decisions: label is Needs you, the same word, tone and emphasis as `NEEDS_YOU_ACTIVITY` (round 1) · rank 18, between chat's working (20) and the stage labels (15) (round 2 notice) · a stage's own `rowActivity` wins (round 2, Q1) · no clear on view (round 2, Q2) · the rule reads `stage.status(flow) === 'paused'`, with no new stage field (design review)

Pinned values:
- `PAUSED_RUN_ACTIVITY` is `{ ...NEEDS_YOU_ACTIVITY, rank: 18 }`. Spread the sessions constant, so the word, tone and
  emphasis keep one home.
- One-line comment above it, in the style of the `STAGE_ACTIVITY_RANK` comment: under chat's working and error,
  above a stage's own label.
- `shownRowActivity` order: busy → `null`; else `stage.rowActivity` when set; else `PAUSED_RUN_ACTIVITY` when
  `stage.status(flow) === 'paused'`; else `null`.
- Rewrite the `PageStage.rowActivity` comment and the `shownRowActivity` comment so they say a paused stage with no
  `rowActivity` shows `PAUSED_RUN_ACTIVITY`.

GIVEN a Small, Medium or Large flow at a stage whose status is paused (no turn, no subagent) WHEN the workflow page draws the row THEN the row activity is `needs you` at rank 18
GIVEN the same flow with a turn or a subagent running WHEN the row draws THEN the workflow sets no row activity
GIVEN plan ready or closed, not busy WHEN the row draws THEN the row keeps `ready to make` or `closed`
GIVEN a done stage, or Large's idle stage WHEN the row draws THEN the workflow sets no row activity

Tests:
- `src/plugins/workflow/contract.test.ts`: one `it.each` table, `shownRowActivity_StatusAndRowActivity_TheRowsActivity`.
  Build each `PageStage` in the test with only the fields the rule reads (`status`, `rowActivity`), and each flow with
  the repo's flow fixture (search for an existing `newFlow` or flow builder used by `workflow-view.test.ts`, and reuse
  it). Rows, each with the expected activity as a literal (`word` and `rank`, or `null`):
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

Done when: `npm run lint` passes; the test gate runs the two test files above.
Commit:    one commit for the group

## Proof

