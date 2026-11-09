# 02 — Large state records a reported plan

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/workflow-large/contract.ts` · modify `src/plugins/workflow-large/large-state.ts` · test `src/plugins/workflow-large/large-state.test.ts` · modify `src/plugins/workflow-large/page/preview.ts` and each test fixture the compiler names for a `LargeState` literal
Consumes:  none
Produces:  `planReported: boolean` on `LargeState` in `src/plugins/workflow-large/contract.ts`
           `| { type: 'planReported'; planDir: string }` in `LargeEvent` in `src/plugins/workflow-large/contract.ts`
Decisions: a report sets the folder and marks it reported; every other folder change clears the mark (Decided
           notice "A reported folder is read alone") · no migration of a saved state (plan.md Design Overview)

## What changes

- `LargeState` gets `planReported: boolean`, with the doc comment "True when the run reported `planDir` through
  `plan.py` or `set_workflow_plan`: the plan watch then reads that folder alone." `EMPTY_LARGE_STATE` sets it to
  `false`. `isLargeState` requires it to be a boolean.
- `LargeEvent` gets `{ type: 'planReported'; planDir: string }`, and `LARGE_EVENT_TYPES` gets `'planReported'`.
- `foldLargeState`'s `applySignal`:
  - `custom` with `planReported`: `setPlanDir(next, event.planDir)`, then `next.planReported = true`.
  - `fileWritten` of a plan file and `skillStarted` of `wigley:make` with a plan path: when the folder differs from
    `next.planDir`, set the folder and `next.planReported = false`. When the folder is the same, keep the mark.
- `clearPlan` sets `planReported` to `false`.
- `sameLargeState` compares `planReported`.
- A report of the folder the flow already holds, with the mark already set, changes nothing (the fold returns the
  same state).

GIVEN a flow in make with `planDir` `/r/p/plan-a` and `planReported: false` WHEN `planReported` `/w/p/plan-a`
arrives THEN `planDir` is `/w/p/plan-a`, `planReported` is true and `progress` is null.
GIVEN a flow with `planDir` `/w/p/plan-a` and `planReported: true` WHEN a `fileWritten` of `/r/p/plan-a/plan.md`
arrives THEN `planDir` is `/r/p/plan-a` and `planReported` is false.
GIVEN a flow with `planDir` `/w/p/plan-a` and `planReported: true` WHEN a `fileWritten` of `/w/p/plan-a/plan.md`
arrives THEN the state is unchanged.

Tests:     add the three rows above to the existing `FOLD_ROWS` table in `large-state.test.ts` (`foldFlow over Large`).
           Add one row to the `sameLargeState` table: two states that differ only in `planReported` are not the same.
           Add one row to the `largeStateOf` table: a state with no `planReported` reads as the empty state.
Done when: `npm test -- src/plugins/workflow-large` passes; `npm run lint` passes.
Commit:    one commit for the group

## Proof

