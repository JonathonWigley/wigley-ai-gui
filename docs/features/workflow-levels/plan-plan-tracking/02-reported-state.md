# 02 — Large state records a reported plan

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/workflow-large/contract.ts` · modify `src/plugins/workflow-large/large-state.ts` · test `src/plugins/workflow-large/large-state.test.ts` · modify `src/plugins/workflow-large/page/preview.ts` and each `LargeState` literal in the tests
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
  same state). A report of the held folder with the mark clear keeps `progress` and sets the mark.
- Test fixtures: `SessionFlow.state` is `unknown`, so the compiler does not find a state literal that lacks
  `planReported`, and such a literal reads as the empty state. Add `planReported` to `flowWith` in
  `large-state.test.ts` (destructured, default `false`), and grep the tests for `reviewRoundsAtMake:` to find every
  other state literal (`flow-store`, page, `stages/*`, `main/actions` tests among them).

GIVEN a flow in make with `planDir` `/r/p/plan-a` and `planReported: false` WHEN `planReported` `/w/p/plan-a`
arrives THEN `planDir` is `/w/p/plan-a`, `planReported` is true, and `progress` and `reviewRoundsAtMake` are null.
GIVEN a flow with `planDir` `/w/p/plan-a`, progress set and `planReported: false` WHEN `planReported` `/w/p/plan-a`
arrives THEN `planReported` is true and `progress` is kept.
GIVEN a flow with `planDir` `/w/p/plan-a` and `planReported: true` WHEN `skillStarted` of `wigley:make` names
`/r/p/plan-a` THEN `planDir` is `/r/p/plan-a` and `planReported` is false (the latest signal wins).
GIVEN a flow with `planReported: true` WHEN the plan clears THEN `planReported` is false.
GIVEN a flow with `planDir` `/w/p/plan-a` and `planReported: true` WHEN a `fileWritten` of `/r/p/plan-a/plan.md`
arrives THEN `planDir` is `/r/p/plan-a` and `planReported` is false.
GIVEN a flow with `planDir` `/w/p/plan-a` and `planReported: true` WHEN a `fileWritten` of `/w/p/plan-a/plan.md`
arrives THEN the state is unchanged.

Tests:     add the six rows above to the existing `FOLD_ROWS` table in `large-state.test.ts` (`foldFlow over Large`).
           Add one row to the `sameLargeState` table: two states that differ only in `planReported` are not the same.
           Add two rows to the `largeStateOf` table: a state with no `planReported`, and one whose `planReported` is
           `"yes"`, each read as the empty state.
Done when: `npm test -- src/plugins/workflow-large` passes; `npm run lint` passes.
Commit:    one commit for the group

## Proof

Commit df8e5262 · proof: diff read; typecheck clean outside task 01's in-progress files; worker ran workflow-large tests (471) and lint · concerns: design.md Signals not updated for planReported — left to task 06
