# 07 — Backlog counts from the newest copy

Status: done
Type: Task
Wave: 3 · Depends on: 01, 02
Plan: [plan.md](plan.md)

Read first: `docs/features/backlog/design.md` § Plans and features, § Git and § Seams, and the plan's Mandatory Reads
(the `backlog/` src tree entry and the "A path" bullet included).

Files:     modify `src/plugins/backlog/main/start.ts` · test `src/plugins/backlog/main/start.test.ts`
Consumes:  `Git.worktrees(root: string): Promise<GitWorktree[]>;` ← 02
           `export interface PlanCopyDeps { readonly git: Pick<Git, 'topLevel' | 'worktrees'>; readonly files: Pick<Files, 'read' | 'modified' | 'list' | 'realPath' | 'stat'>; readonly paths: Paths }` ← 02
           `export function newestPlanCopy(planDir: string, deps: PlanCopyDeps): Promise<PlanCopy | null>;` ← 02
           `export function readPlanCopy(copy: PlanCopy, deps: PlanCopyDeps): Promise<PlanProgress | null>;` ← 02
           `export interface PlanTaskLine { readonly wave: number | null; readonly text: string; readonly done: boolean; readonly file: string | null; readonly status: TaskStatus | null }` ← 01
Produces:  `BacklogDeps.files: Pick<Files, 'read' | 'modified' | 'list' | 'realPath' | 'stat'>` in
           `src/plugins/backlog/main/start.ts` (was `Pick<Files, 'realPath' | 'list'>`)

## Decisions

Design review: one shared reader in `src/shared/`; Backlog counts the boxes under `## Tasks` only, as Heavy does.

- The index still says which plans and which tasks exist. `homes.ts` (`groupHomes`, `attachTasks`) does not change: it
  keeps the index meta counts and statuses, which `readPlan` now replaces. Features (`checklist.md`) keep the index
  meta counts: this plan changes plans only.
- `readPlan(deps, plan)` in `start.ts`:
  1. Read the header as today: `deps.docs.readDoc(plan.path)` and `planHeader`. The title, target and written date
     stay the index copy's.
  2. `copy = await newestPlanCopy(deps.paths.parent(plan.path), deps)`; `progress = copy === null ? null : await readPlanCopy(copy, deps)`.
  3. When `progress` is not null: `checked = progress.checked`, `total = progress.total`, and each task's `status` is
     the `status` of the progress line whose `file` equals `deps.paths.base(task.path)`. A task that no line names
     keeps its index status. A line whose status is null (the copy has no such document, or its `Status:` line holds
     a value other than the three) also keeps the index status, so a raw value such as `blocked` still shows.
     The task rows stay the index's list. The count comes from the copy, so it can differ from the number of rows
     when a worktree copy added or removed a task line; the next index load brings the rows level.
  4. When `progress` is null (the plan.md went away between the index read and this read), keep the index meta counts
     and statuses.
  5. A rejection of `newestPlanCopy` or `readPlanCopy` takes the existing `catch`: `logSkipped` names `plan.path`, and
     the plan is left out of the home, as an unreadable plan is today.
- `BacklogDeps.files` widens to what `PlanCopyDeps` needs. `createBacklogMain`'s caller already passes
  `services.files`, which holds every member. `deps` passes to `newestPlanCopy` and `readPlanCopy` as it is: its
  `git`, `files` and `paths` fit `PlanCopyDeps`.
- Backlog does not watch plan copies. Counts and statuses refresh at its next load (`docs.indexLoaded` or a rescan),
  as the main clone's plan does today.
- Each plan runs `git rev-parse` and `git worktree list` once per load. Keep it per plan: do not cache across loads,
  since a worktree added between loads must count.
- The Backlog self-test fixture (`src/plugins/backlog/main/selftest-fixture.ts`) does not change. Its plan holds two
  boxes under `## Tasks`, one ticked (1/2), and its two task documents read `Status: done` and
  `Status: not started`. The docs fixture's plan meta (`src/plugins/docs/main/selftest-fixture.ts`,
  `checked: 1, total: 2`) gives the same count. The fixture repo has no worktree, so its plan has one copy.
- `start.test.ts` `startBacklog`: seed the memory `Files` (`listed`) with every `disk` file, and hand its `read`,
  `modified`, `stat` and `list` to `services.files`. `realPath` stays on `links`. `startBacklog` builds
  `listed = createMemoryFiles({ now: () => time })` over a local `let time = 0`, and returns `setTime(n)`. A row gives
  its files as `[path, time]` pairs, which the helper writes in order, calling `setTime` before each; the `disk` files
  are written at time 0. Every path the fake `worktrees` returns lies under `CLONE`; the tests that re-script
  `topLevel` to another root keep the index counts, and their expected values say so. The `fakeGit` members `worktrees` and `commonDir` come from 02.

GIVEN an index plan entry with `checked: 0, total: 9` and a `plan.md` whose `## Tasks` holds three boxes, one ticked,
and one ticked box under `## Preconditions` WHEN Backlog loads THEN the plan reads `checked: 1, total: 3`.

GIVEN a plan whose main copy reads 0/2 and a worktree copy, written later, that reads 1/2 with its `01-a.md` at
`Status: in progress` WHEN Backlog loads THEN the plan reads `checked: 1, total: 2` and task `01-a.md` reads
`status: 'in progress'`, while the index meta says `not started`.

## Tests

- `src/plugins/backlog/main/start.test.ts`, one `it.each` `load_PlanProgress_FromTheNewestCopy ($name)`, each row a
  plan entry with meta that disagrees with the files, the files written (path, time), the fake git's `worktrees`, and
  the expected `checked`, `total` and task statuses:
  - `boxes under Tasks only` — the GIVEN above → `1/3`, meta `0/9` ignored. Catches the index's count of every box.
  - `a newer worktree copy` — the second GIVEN above. Catches a reader of the index copy alone.
  - `an equal-time worktree copy` — both copies at time 10, main 0/2, worktree 1/2 → `0/2`. Catches a tie that goes
    to the worktree.
  - `a task no line names keeps its index status` — the index lists `09-extra.md` (status `done`) that no plan line
    links → `'done'`.
  - `an unreadable copy status keeps the index status` — the copy's `01-a.md` reads `Status: blocked`, the index meta
    says `blocked` → `'blocked'`. Catches null replacing a raw index value.
- `load_PlanHeading %j_Title %s`: the plan entry's meta stays `checked: 2, total: 9`; the expected plan reads
  `checked: 0, total: 0`, since its text holds no `## Tasks`. This row now also proves the meta is not read.
- `load_PlanCopyFails_LoggedAndSkipped` — the memory files' `list` rejects with an `EACCES` error for the plan folder; the home lists no plan and `logged` holds one
  line naming the plan path. Catches a failure that breaks the whole load.

Done when: `npm test` passes and `npm run lint` passes. `npm run selftest -- --plugin backlog` passes. The test gate runs
the tests above.
Commit:    one commit for the group

## Proof

Commit 45db9863 · proof: diff read: BacklogDeps.files widened; readPlan counts and statuses from newestPlanCopy/readPlanCopy, header from index copy; backlog tests pass; backlog self-test owed to the test gate · concerns: listed memory seed relies on memory-files storing before its first await
