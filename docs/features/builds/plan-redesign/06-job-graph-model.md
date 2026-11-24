# 06 — Job graph model

Status: not started
Type: Task
Rung: hard · adds the `job-graph.ts` contract that 07 consumes, and its cycle rule is a choice no pattern settles
Wave: 2 · Depends on: 02
Plan: [plan.md](plan.md)

Files:     create `src/plugins/builds/page/job-graph.ts` · test `src/plugins/builds/page/job-graph.test.ts`
Consumes:  `BuildJob` with `dependsOn: string[]` ← 02 (plan.md File Structure) · `buildJob(overrides)` in `src/plugins/builds/contract.test-support.ts` (exists; 02 gives it the new fields)
Produces:  in `src/plugins/builds/page/job-graph.ts`:
           `export interface JobEdge { from: string; to: string }` — `from` is the prerequisite's id, `to` the id of the job that waits on it
           `export interface JobGraph { columns: string[][]; edges: JobEdge[] }`
           `export type GraphMove = 'left' | 'right' | 'up' | 'down'`
           `export function jobGraph(jobs: readonly BuildJob[]): JobGraph`
           `export function defaultJob(jobs: readonly BuildJob[], graph: JobGraph): string | null`
           `export function movedJob(graph: JobGraph, job: string | null, move: GraphMove): string | null`

Decisions:
- The module is pure: it imports only types from `../contract`. It reads no clock, no DOM and no slot.
- **Columns** (plan.md Design Overview). A job's column is the length of its longest chain of used prerequisites. A
  job with no used prerequisite is in column 0. Otherwise its column is 1 + the largest column among its used
  prerequisites. `columns[c]` holds the ids of every job in column `c`, in their order in `jobs`. `columns` has no
  empty column, and it is `[]` for no jobs.
- **Used prerequisites.** For each job, walk its `dependsOn` in order. Skip an id that names no job in `jobs`. Skip
  an id that the job already listed earlier in its `dependsOn`. Skip an id that closes a cycle (next bullet). Every
  other id is a used prerequisite.
- **Cycles.** Compute the columns by one depth-first walk. The walk visits the jobs in `jobs` order, and each job's
  `dependsOn` in its order. A `dependsOn` id that names a job on the walk's current path (the job itself included) is
  a back edge: skip it as a prerequisite. So a cycle never hangs and every job gets one column. Example:
  `a.dependsOn = ['b']`, `b.dependsOn = ['a']`. The walk starts at `a`, goes to `b`, and finds `a` on the path. `b`
  is in column 0, `a` in column 1, and the only edge is `{ from: 'b', to: 'a' }`.
- **Edges** (plan.md: arrows join a job only to its direct prerequisites). One `JobEdge` per used prerequisite, and
  none for a skipped id. Order: the jobs in `jobs` order, and for each job its used prerequisites in `dependsOn` order.
- **Default job** (plan.md Design Overview). The id of the first job in `jobs` order with `state` `running`. Else the
  first with `result` `failure`. Else the last id of the last column. Null for no jobs. A job with `state`
  `finished` and `result` `failure` counts as failed; a running job never has a result, so the order of the two checks
  decides nothing else.
- **Moves.** Find the column `c` and the row `r` (index in `columns[c]`) of `job`.
  - `job` null, or an id the graph does not hold: every move returns `columns[0][0]`, or null for no jobs.
  - `up`: the job at row `r - 1` of column `c`. At row 0 it stays on `job`.
  - `down`: the job at row `r + 1` of column `c`. At the last row it stays on `job`.
  - `right`: in the last column it stays on `job`. Else, in column `c + 1`, the first job (column order) that has an
    edge from `job`. Else the job at row `min(r, columns[c + 1].length - 1)` of column `c + 1`.
  - `left`: in column 0 it stays on `job`. Else, in column `c - 1`, the first job (column order) that has an edge to
    `job`. Else the job at row `min(r, columns[c - 1].length - 1)` of column `c - 1`.
  - So a column change follows an arrow when one joins the two columns, and keeps the row (clamped) when none does.

GIVEN jobs `a` (no prerequisites), `b` (dependsOn `a`), `c` (dependsOn `a`, `b`) WHEN `jobGraph` runs THEN columns are `[['a'], ['b'], ['c']]` and edges are `a→b`, `a→c`, `b→c` in that order
GIVEN a job whose `dependsOn` names `x`, which is not among the jobs WHEN `jobGraph` runs THEN the job is in column 0 and no edge names `x`
GIVEN two jobs that depend on each other WHEN `jobGraph` runs THEN it returns, each job is in one column, and only the edge that does not close the cycle is kept
GIVEN no job runs and none failed WHEN `defaultJob` runs THEN it returns the last id of the last column, not the last job in `jobs`
GIVEN the cursor on row 2 of column 0 and column 1 holding one job joined to it by no edge WHEN `right` THEN the cursor lands on row 0 of column 1

Tests:     `job-graph.test.ts`, `describe('jobGraph')`, one `it.each` table over the rows below. Each row builds its jobs
           with `buildJob({ id, dependsOn })` and asserts `columns` and `edges` with `toEqual`.

           | case | jobs (id: dependsOn) | columns | edges (from→to) |
           |---|---|---|---|
           | no jobs | — | `[]` | `[]` |
           | independent jobs keep their order | `b: []`, `a: []` | `[['b','a']]` | none |
           | longest chain sets the column | `a: []`, `b: ['a']`, `c: ['a','b']` | `[['a'],['b'],['c']]` | `a→b`, `a→c`, `b→c` |
           | a job listed before its prerequisite | `d: ['e']`, `e: []` | `[['e'],['d']]` | `e→d` |
           | a missing id is ignored | `a: ['x']`, `b: ['a']` | `[['a'],['b']]` | `a→b` |
           | a repeated id gives one edge | `a: []`, `b: ['a','a']` | `[['a'],['b']]` | `a→b` |
           | a two-job cycle | `a: ['b']`, `b: ['a']` | `[['b'],['a']]` | `b→a` |
           | a self-dependency | `a: ['a']` | `[['a']]` | none |
           | a three-job cycle | `a: ['c']`, `b: ['a']`, `c: ['b']` | `[['b'],['c'],['a']]` | `c→a`, `b→c` |

           Each edges cell is the exact array order. In the three-job cycle the walk goes `a → c → b`, and `b`'s `a` is
           the back edge: `b` column 0, `c` column 1, `a` column 2. The edges keep jobs order: `a`'s used prerequisite
           `c` (`c→a`), then `c`'s `b` (`b→c`); `b` has no used prerequisite.

           `describe('defaultJob')`, one `it.each` table; each row asserts the returned id.

           | case | jobs (id, state, result, dependsOn) | expected |
           |---|---|---|
           | no jobs | — | `null` |
           | the first running job wins over a failed one before it | `f` finished failure; `r1` running; `r2` running | `r1` |
           | the first failed job when none runs | `s` finished success; `f1` finished failure; `f2` finished failure | `f1` |
           | else the last job of the last column | `a` finished success `[]`; `b` finished success `['a']`; `c` finished success `[]` | `b` |
           | a queued build | `a` queued `[]`; `b` queued `['a']` | `b` |

           `describe('movedJob')`, one `it.each` table over one graph built from `a: []`, `b: []`, `c: []`,
           `d: ['b']`, `e: ['c']`: columns `[['a','b','c'], ['d','e']]`. Each row asserts the returned id.

           | from | move | expected | why |
           |---|---|---|---|
           | `b` | `up` | `a` | |
           | `a` | `up` | `a` | held at the top |
           | `b` | `down` | `c` | |
           | `c` | `down` | `c` | held at the bottom |
           | `b` | `right` | `d` | follows the edge `b→d` |
           | `c` | `right` | `e` | follows the edge `c→e`, not row 1 clamped |
           | `a` | `right` | `d` | no edge: row 0 |
           | `e` | `left` | `c` | follows the edge `c→e` |
           | `d` | `left` | `b` | follows the edge `b→d`, not row 0 |
           | `a` | `left` | `a` | held in column 0 |
           | `e` | `right` | `e` | held in the last column |
           | `null` | `down` | `a` | no cursor: the first job |
           | `zz` | `left` | `a` | an id the graph lacks: the first job |

           The table takes its graph as a row field, so two more rows use other graphs:

           | graph | from | move | expected | why |
           |---|---|---|---|---|
           | `a: []`, `b: []`, `c: []`, `z: ['a']` | `c` | `right` | `z` | no edge from `c`; row 2 clamps to row 0 |
           | no jobs | `null` | `down` | `null` | empty graph |

Done when: compiles; the test gate runs `job-graph.test.ts`.
Commit:    one commit for the group

## Proof

