# 16 — Scheduled runs section

Status: in progress
Type: Task
Wave: 3 · Depends on: 12
Plan: [plan.md](plan.md)

Read first, beyond plan.md § Mandatory Reads: `src/plugins/auto-retro/page/start.ts`, the pattern for a section that
claims the rows a main slot lists and is added again when they change.

Files:
- create `src/plugins/scheduling/page/run-rows.ts` · test `src/plugins/scheduling/page/run-rows.test.ts`
- modify `src/plugins/scheduling/page/start.ts` (starts `startRunRows`, feeds it each `schedulingStateSlot` change,
  disposes it in the part's `dispose`)
- modify `src/plugins/scheduling/page/start.test.ts` (one wiring case)

Consumes:
- `SchedulingState` (`runRows`, `unviewedRows`) and `schedulingStateSlot` in `src/plugins/scheduling/contract.ts` ← 03
- `schedulingPagePart` in `src/plugins/scheduling/page/start.ts` ← 12
- tree: `SessionsPageExports.addSection(section: SidebarSection): Disposable` and
  `SessionsPageExports.setActivity(sessionId, sourceId, activity: RowActivity | null)`, `SidebarSection`,
  `RowActivity`, `sessionsPageKey` (`src/plugins/sessions/contract.ts`)

Produces, in `src/plugins/scheduling/page/run-rows.ts`:
```ts
// A finished scheduled run the user has not viewed: outranks chat's `done` (rank 10), under working (20).
export const SCHEDULED_RUN_DONE: RowActivity = { word: 'done', tone: 'success', rank: 15, emphasis: 'raised' };
export interface RunRowsDeps {
  sessions: Pick<SessionsPageExports, 'addSection' | 'setActivity'>;
  log(line: string): void;
}
// Adds the Scheduled runs section and sets the done activity on each unviewed run row. `changed` takes the slot's
// value after each change; `dispose` removes the section and every activity it set.
export function startRunRows(deps: RunRowsDeps, state: SchedulingState): { changed(state: SchedulingState): void; dispose(): void };
```

Decisions:
- **Section** (the user's pick, rounds 2 and 6): `addSection({ id: 'scheduling', label: 'Scheduled runs', order: 900,
  claims: (row) => state.runRows.includes(row.sessionId) })`, no `header`. Order 900 sits before auto-retro's Retro
  (1000): a scheduled run is the user's own work; a retro is housekeeping. Sessions reads no change of `claims`, so a
  change of `runRows` (by content and order) disposes the section and adds it again, as auto-retro does; any other
  change adds nothing.
- **Ids**: `runRows`, `unviewedRows` and a history entry's `rowId` hold the sessions row's `sessionId`, the id
  `chat.adopt` resolves to. Task 17 writes them in that form; a different form is a concern to report.
- **Done mark**: source id `scheduling`. Each row in `unviewedRows` gets `SCHEDULED_RUN_DONE`; each row that leaves
  `unviewedRows` gets `null`. The first state sets every listed row, since every page load starts with no
  activities. Main owns which rows are unviewed (`sessions.selection` naming the row clears it) and the Dock badge
  count; the page only mirrors the slot. The mark persists across an app restart through the history entry's
  `viewed` flag (17 writes it, plan.md § Shared names), so a reload's first state sets the marks again.
- **Dispose** sets `null` on each row it marked and disposes the section, so a plugin stop or reload leaves no mark.
- **Layout**: the section's rows draw through the sessions layout, as every `addSection` section's rows do; the
  section needs no layout part of its own. So this task changes no file under `src/plugins/scheduling/layouts/`.
- **Page log lines** (through `services.log`, which prefixes `[scheduling]`; task 19 waits on them): `run rows: <n>`
  each time the section is added, `run row done: <sessionId>` on each mark, `run row viewed: <sessionId>` on each
  `null` a leave from `unviewedRows` causes (not on dispose).

GIVEN `runRows` `['a', 'b']` WHEN the part starts THEN one section `Scheduled runs` is added whose `claims` is true for
rows `a` and `b` only
GIVEN `runRows` changes from `['a']` to `['a', 'c']` WHEN `changed` runs THEN the old section is disposed and a new
one claims `a` and `c`
GIVEN `unviewedRows` changes from `['a']` to `['b']` WHEN `changed` runs THEN `setActivity('a', 'scheduling', null)`
and `setActivity('b', 'scheduling', SCHEDULED_RUN_DONE)` run, and nothing else
GIVEN a first state whose `unviewedRows` is `['a', 'b']` WHEN the part starts THEN `a` and `b` each get
`SCHEDULED_RUN_DONE`, in that order
GIVEN a started section with row `b` marked WHEN `dispose` runs THEN `b` gets `null` and the section is disposed

Tests:
- `src/plugins/scheduling/page/run-rows.test.ts`, `describe('startRunRows')`, over a fake `sessions` that records each
  `addSection` (with its disposed flag) and each `setActivity` call:
  - the section: label `Scheduled runs`, order 900, `claims` over rows `a`, `b`, `z` → true, true, false. Catches a
    section that claims the wrong rows.
  - `it.each` slot changes → the exact recorded calls: `runRows` same content → no re-add; `runRows` changed → one
    dispose and one add; `unviewedRows` `[]` → `['a']`, `['a']` → `['b']`, `['a', 'b']` → `[]`, each with its literal
    `setActivity` list. Catches a mark left on a viewed row, or a mark never set.
  - the first state: `startRunRows(deps, { unviewedRows: ['a', 'b'], … })` → `setActivity('a', 'scheduling',
    SCHEDULED_RUN_DONE)` then the same for `b`, in that order, and `run row done: a`, `run row done: b` logged.
    Catches a restart or reload whose marks never come back.
  - `dispose` clears every mark and the section.
- `src/plugins/scheduling/page/start.test.ts`: one case: the slot's `runRows` reaches the fake sessions export's
  `addSection` (the wiring once; the rules stay in `run-rows.test.ts`).

Done when: `npm run lint` and `npm run typecheck` exit 0; the test gate runs the tests above. The live section and
mark are checked by task 19's self-test and task 21 (Final verification).

Commit: one commit for the group — "Add the Scheduled runs side bar section and the done mark on unviewed run rows".

## Proof
