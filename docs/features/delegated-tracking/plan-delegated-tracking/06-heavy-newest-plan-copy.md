# 06 — Heavy reads the newest plan copy

Status: in progress
Type: Batch
Wave: 3 · Depends on: 01, 02
Plan: [plan.md](plan.md)

Read first: `docs/features/workflow/design.md` § Heavy's stages (the newest-copy paragraph and the `closed` row) and
§ Where it draws (the side pane bullet), and the plan's Mandatory Reads.

Two items: the plan watch follows every copy, then the side pane draws a running task.

Files:     modify `src/plugins/workflow-heavy/main/plan-watch.ts` · test `src/plugins/workflow-heavy/main/plan-watch.test.ts` ·
           modify `src/plugins/workflow-heavy/main/start.ts` · test `src/plugins/workflow-heavy-main.test.ts` ·
           modify `src/plugins/workflow-heavy/heavy-state.ts` · test `src/plugins/workflow-heavy/heavy-state.test.ts` ·
           modify `src/plugins/workflow-heavy/page/checklist.ts` · test `src/plugins/workflow-heavy/page/checklist.test.ts` ·
           modify `src/plugins/workflow-heavy/page/preview.ts` · test `src/plugins/workflow-heavy/page/preview.test.ts` ·
           modify `src/plugins/workflow/contract.ts` · modify `src/plugins/workflow/page/workflow-view.ts` ·
           test `src/plugins/workflow/page/workflow-view.test.ts`
Consumes:  `export type TaskStatus = 'not started' | 'in progress' | 'done';` ← 01
           `export interface PlanTaskLine { readonly wave: number | null; readonly text: string; readonly done: boolean; readonly file: string | null; readonly status: TaskStatus | null }` ← 01
           `export function readPlanProgress(planText: string, taskTexts: ReadonlyMap<string, string>): PlanProgress;` ← 01
           `Git.worktrees(root: string): Promise<GitWorktree[]>;` ← 02
           `Git.commonDir(root: string): Promise<string>;` ← 02
           `export function repoTop(planDir: string, deps: PlanCopyDeps): Promise<string | null>;` ← 02
           `export function planCopies(planDir: string, deps: PlanCopyDeps): Promise<PlanCopy[]>;` ← 02
           `export function newestPlanCopy(planDir: string, deps: PlanCopyDeps): Promise<PlanCopy | null>;` ← 02
           `export function readPlanCopy(copy: PlanCopy, deps: PlanCopyDeps): Promise<PlanProgress | null>;` ← 02
           `services.git`, `services.paths` in `MainServices` (the tree holds them)
Produces:  `ChecklistItem` in `src/plugins/workflow/contract.ts` gains `readonly running?: boolean;`
           `createPlanWatch(deps: { git: Pick<Git, 'topLevel' | 'worktrees' | 'commonDir'>; files: Pick<Files, 'read' | 'modified' | 'list' | 'realPath' | 'stat' | 'watch'>; paths: Paths; log: PluginLog; signal(sessionId: string, signal: WorkflowSignal): void }): PlanWatch`
           in `src/plugins/workflow-heavy/main/plan-watch.ts` (the `PlanWatch` interface does not change)

## Item 1 — the plan watch follows every copy

Decisions (design review: Heavy lists worktrees again at each plan check and when git's worktrees folder changes):

- `follow(sessionId, planDir)` keeps its rules: the same folder twice does nothing unless `planGone` closed it; null
  closes the watch. The opening step changes:
  1. `copies = await planCopies(planDir, deps)`.
  2. The watched folders are `planDir` when `files.stat(planDir)` reports a folder, plus each copy's `planDir`, with
     no folder twice (`paths.samePath`). `planDir` itself is watched while it holds no `plan.md`, since `wigley:make`
     names a folder before its `plan.md` exists.
  3. When the watched folders are empty, signal `planGone` (as today for a missing folder) and stop.
  4. Watch each folder with `{ recursive: false, onError: () => read(…) }`. `stat` each folder first and skip one that
     is not a folder: `Files.watch` creates a missing folder.
  5. When `top = await repoTop(planDir, deps)` (02) is not null, watch `await git.commonDir(top)` the same way (stat
     first, non-recursive). Its `onChange(path)` lists the copies again only when `path === 'worktrees'`. Every other
     change in git's folder (index, refs, `HEAD`) does nothing. Also watch `<commonDir>/worktrees` itself
     (non-recursive) when it exists: its direct entries are the worktree folders, so a second worktree added or one
     removed reports there, which a non-recursive watch of the git folder may not see. Any change there lists again.
     When the git-folder watch reports `worktrees` and no `worktrees` watch is open, open it. The turn-end `check`
     stays the fallback.
  6. Read once.
- **List again** means: run `planCopies` again, dispose the copy watches, and watch the new set of folders (step 2
  and step 4), then read. The commonDir watch stays. A list that settles after the session's watch moved or closed,
  or after a newer list of the session started, is dropped, as a late read is today.
- `check(sessionId)` lists again when the watch is open (today it only reads). The turn-end signal calls it, so a
  worktree an agent added during the turn is found at turn end.
- A read: `copy = await newestPlanCopy(planDir, deps)`, then `progress = copy === null ? null : await readPlanCopy(copy, deps)`.
  - `progress` not null → signal `planChanged` with it.
  - `progress` null → `files.stat(planDir)`; when it is null and no copy is left, signal `planGone` and close every
    watch of the session. Else signal nothing (as today: a folder with no `plan.md` waits).
  Keep the late-read rule: a read that settles after the watch moved or closed, or after a newer read started, is
  dropped.
- `planGone` signals only when no copy is left. A deleted main copy with a live worktree copy reads the worktree copy.
- A failure of `planCopies`, `newestPlanCopy` or `readPlanCopy` is logged with the existing `logFailure` line
  (`plan.md not read in <planDir>: <error>`). A failure while the watch opens disposes every watch that attempt
  opened (copy watches and git watches), then forgets the watch, so the next `follow` tries again. A failed list
  again logs and keeps the watches it had. `close`, a move to another folder and `dispose` dispose the copy watches
  and the git watches together.
- Update the `PlanWatch` comment at the top of `plan-watch.ts`: it watches every copy's folder and git's folder, and
  `check` lists the copies again.
- `main/start.ts`: pass `git: services.git` and `paths: services.paths` to `createPlanWatch`.
- `heavy-state.ts` `sameProgress`: each task also compares `file` and `status`. A status change alone then reaches
  the page.

GIVEN a session that follows `/r/docs/features/f/plan-a`, and a worktree `/w` whose copy holds a newer tick WHEN the
worktree's `plan.md` changes THEN the watch signals `planChanged` with `/w`'s progress.

GIVEN the session's watch is open and the copy list holds only `/r` WHEN git's folder reports a change to `worktrees`
and `/w` now holds a newer copy THEN the watch watches `/w`'s copy and signals `planChanged` with `/w`'s progress.

GIVEN two copies WHEN the `/r` copy's folder is deleted THEN the watch signals `/w`'s progress and no `planGone`; WHEN
the `/w` copy's folder is deleted too THEN it signals `planGone` once.

Tests:

- `src/plugins/workflow-heavy/main/plan-watch.test.ts`: `startWatch` gains a fake `git` and `posixPaths`. The default
  fake's `topLevel` returns null, so every existing test keeps one copy and its expected signals.
  `changed(text)` becomes `readPlanProgress(text, taskTexts)` with an optional map. The memory files take a clock the
  test sets before each write. New tests, each a whole assertion over the signal list:
  - `follow_PlanInTwoCheckouts_SignalsTheNewestCopy` — fake git: `topLevel` → `/r` for a path under `/r` or `/w`,
    `worktrees` → `/r` (main) and `/w`, `commonDir` → `/r/.git`. Write `/r`'s plan at 10 and `/w`'s ticked plan at 20,
    follow, then write `/w`'s plan with both ticks at 30, then write `/r`'s plan with all three ticks at 40 → signals
    `[changed(W_TICKED), changed(W_BOTH), changed(R_ALL)]`. Catches a watch that watches only the named folder.
  - `follow_TaskDocumentStatusChanges_SignalsItsStatus` — the plan links `01-a.md`; writing `01-a.md` with
    `Status: in progress` signals progress whose line has `status: 'in progress'`. Catches a watch that reads only
    `plan.md`.
  - one `it.each` `listAgain_WorktreeAdded_WatchesTheNewCopy ($by)`, rows `by: 'a change to git worktrees folder'`
    (write `/r/.git/worktrees/w/gitdir`) and `by: 'check'` (call `watch.check('s1')`). Before the step the fake lists
    only `/r`; the step adds `/w` to the list; then a write to `/w`'s copy at a later time signals its progress.
    Add a third row `by: 'another change in git folder'` (write `/r/.git/index`) whose expected list holds no `/w`
    progress. Add a fourth row `by: 'a second worktree in the worktrees folder'`: the fake already lists `/w`, the
    step writes `/r/.git/worktrees/w2/gitdir` and adds `/w2` to the list. Catches a watch that never lists again,
    lists on every git write, or misses the second worktree.
  - `follow_OneCopyDeleted_PlanGoneOnlyWhenNoneLeft` — two copies: `/r`'s plan with one tick at 20, `/w`'s with two
    ticks at 10. Follow, then `files.remove` `/r`'s plan folder, then `/w`'s → signals
    `[changed(R_ONE), changed(W_TWO), planGone]` in that order and nothing after. Catches `planGone` on the first deleted copy.
  - `follow_OpenFails_DisposesWhatItOpened` — `commonDir` rejects; the copy watch opened before it is disposed (a
    later write to the copy signals nothing), and a second `follow` opens again. Catches a leaked watch.
- `src/plugins/workflow-heavy-main.test.ts`: `startHeavy`'s `services` gains `git` with `topLevel: async () => null`
  (the other members unused). No new case: the plan watch's rules are pinned in `plan-watch.test.ts`.
- `src/plugins/workflow-heavy/heavy-state.test.ts`: add rows to the fold table beside
  `planChanged with a changed task line replaces progress`: `planChanged with a changed task status replaces progress`
  and `planChanged with a changed task file replaces progress`. Catches a `sameProgress` that drops a status change.

## Item 2 — the side pane draws a running task

Decisions (round 1, design review: the existing running mark; the layout contract does not change):

- `page/checklist.ts`: each Heavy item is `{ text, done, running: task.status === 'in progress' }`. So every Heavy item
  carries `running` as `true` or `false`.
- `src/plugins/workflow/contract.ts` `ChecklistItem` gains `readonly running?: boolean`, with the comment: set by a
  workflow that knows which open items run; left out, an open item shows the stage's state.
- `src/plugins/workflow/page/workflow-view.ts` `sideGroup`: an item's `state` is, in this order:
  1. `item.done` → `'done'`
  2. `item.running === true` → `'running'`
  3. `item.running === false` → `'pending'`
  4. else `openItemState` (as today)
  Light's and Medium's items carry no `running`, so they draw as today. `layout.d.ts` does not change: `MarkState`
  already holds `'running'` and `'pending'`.
- `page/preview.ts`: the preview samples of `make`, `review` and `fix` set `status: 'in progress'` on their first open
  task, and `'done'` on each done task; every other sample task keeps `status: null`. So the layout preview
  (`Space z l w`) shows the running mark. Update `preview.test.ts` only where a row asserts the tasks.

GIVEN Heavy's plan with a done task, an open task whose document reads `Status: in progress` and an open task that
reads `Status: not started`, in the make stage WHEN the side pane draws THEN the items' states are `done`, `running`
and `pending`.

GIVEN Light's checklist with an open item and a stage that runs tasks with status `running` WHEN the side pane draws
THEN the open item's state is `running`, as today.

Tests:

- `src/plugins/workflow-heavy/page/checklist.test.ts` `heavyChecklist_MapsThePlan`: `planOf` takes
  `[wave, done, status]` per task. Every existing row's items gain `running: false`. New row
  `a task in progress runs` — tasks `[1, true, 'done']`, `[1, false, 'in progress']`, `[1, false, 'not started']`,
  `[1, false, null]` → items `running` `false`, `true`, `false`, `false`. Catches a mapping that reads `done` or a
  null status as running.
- `src/plugins/workflow/page/workflow-view.test.ts`: one `it.each` `SidePane_ItemRunning_PicksTheMark ($name)` over a
  stub workflow whose `checklist` returns one group of the row's items, in a stage with `runsTasks` whose status is
  `'running'`. Rows (item → state): `{ done: false, running: true }` → `'running'`;
  `{ done: false, running: false }` → `'pending'`; `{ done: false }` → `'running'` (the stage's state);
  `{ done: true, running: true }` → `'done'`. Assert the side pane input's `currentGroup.items`. Catches a view that
  ignores the flag, or lets it win over `done`.
- The drawn mark in the running app is checked live; the live check is in 10.

Self-test: no new step in `src/plugins/workflow-heavy/main/selftest-script.ts`, and no change to
`src/shared/fake-agent-harness.ts` or `FAKE_WORKFLOW_PLAN_PATH`. The self-test proves key behaviours through log lines.
The side pane logs no line per item state, so a step cannot see the running mark. The `progress` lines the steps
check do not change, since the counts do not change. A worktree copy needs a real git worktree the fake harness does
not make. Each rule has its test at the seam that owns it, and task 10 checks the drawn mark live. The self-test's
project folder is not in a git clone, so its plan has one copy and the Heavy groups run as today.

Done when: `npm test` passes and `npm run lint` passes. `npm run selftest -- --plugin workflow-heavy` passes. The test
gate runs the tests above.
Commit:    one commit for the group

## Proof
