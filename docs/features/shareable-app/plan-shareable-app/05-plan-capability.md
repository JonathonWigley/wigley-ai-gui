# 05 — Plan capability in the workflow plugin

Status: not started
Type: Task
Rung: deep · crosses async file watches, git worktree listing and the flow fold; a wrong guess loses a run's plan
Wave: 4 · Depends on: 04
Plan: [plan.md](plan.md)

Paths are under `wigley-ai-gui/`.

Files:
- create `src/plugins/workflow/plan/read-plan.ts` · test `src/plugins/workflow/plan/read-plan.test.ts`
- create `src/plugins/workflow/plan/plan-copies.ts` · test `src/plugins/workflow/plan/plan-copies.test.ts`
- create `src/plugins/workflow/plan/plan-watch.ts` · test `src/plugins/workflow/plan/plan-watch.test.ts`
- create `src/plugins/workflow/plan/plan-fold.ts` · test `src/plugins/workflow/plan/plan-fold.test.ts`
- create `src/plugins/workflow/plan/plan-pane.ts` · test `src/plugins/workflow/plan/plan-pane.test.ts`
- create `src/plugins/workflow/plan/plan-tool.ts` · test `src/plugins/workflow/plan/plan-tool.test.ts`
- create `src/plugins/workflow/plan/plan-report.ts` · test `src/plugins/workflow/plan/plan-report.test.ts`
- create `src/plugins/workflow/plan/plan-reports.ts` · test `src/plugins/workflow/plan/plan-reports.test.ts`
- create `src/plugins/workflow/plan/plan-capability.ts` · test `src/plugins/workflow/plan/plan-capability.test.ts`
- create `src/plugins/workflow/plan/plan-fixtures.test-support.ts`
- modify `src/plugins/workflow/main/start.ts` · modify `src/plugins/workflow/page/start.ts`

Consumes:
- `SessionFlow.plan`, `PlanState`, `PlanProgress`, `PlanTaskLine`, `DeclaredWorkflow`, and the `WorkflowSignal` variants `{ type: 'planChanged'; progress: PlanProgress }`, `{ type: 'planGone' }`, `{ type: 'planReported'; planDir: string }` in `src/plugins/workflow/contract.ts` ← 04
- `PlanFold`, `NO_PLAN_FOLD` in `src/plugins/workflow/declared/plan-fold.ts` ← 04
- `PlanPane`, `NO_PLAN_PANE` in `src/plugins/workflow/declared/plan-pane.ts` ← 04
- `usesPlan(decl: WorkflowDecl): boolean` in `src/plugins/workflow/declared/uses-plan.ts` ← 04
- `enabledWorkflows(): readonly DeclaredWorkflow[]` and `onWorkflowsChanged(listener): Disposable` in `src/plugins/workflow/declared/workflows-reader.ts` ← 04
- `PlanFormat` in `src/contracts/contributions.ts` ← 03

Produces:
- `readPlan(text: string, taskDocs: ReadonlyMap<string, string>, format: PlanFormat): PlanProgress` in `src/plugins/workflow/plan/read-plan.ts`
- `planFileName(format: PlanFormat | null): string` (gives `format.file ?? 'plan.md'`) and `isPlanFilePath(path: string, format: PlanFormat | null): boolean` and `planDirOfArgs(argsPath: string | null, format: PlanFormat | null): string | null` in `src/plugins/workflow/plan/read-plan.ts`
- `createPlanFold(): PlanFold` in `src/plugins/workflow/plan/plan-fold.ts`
- `createPlanPane(): PlanPane` in `src/plugins/workflow/plan/plan-pane.ts`
- `createPlanWatch(deps): PlanWatch` in `src/plugins/workflow/plan/plan-watch.ts`
- `SET_WORKFLOW_PLAN_TOOL = 'set_workflow_plan'` in `src/plugins/workflow/plan/plan-tool.ts`
- `PLAN_RUNS_FOLDER = 'plan-runs'` in `src/plugins/workflow/plan/plan-reports.ts`
- `startPlanCapability(deps: PlanCapabilityDeps): Disposable` in `src/plugins/workflow/plan/plan-capability.ts`

## What this task does

The plan capability is generic code. Its only parameter is the declaring plugin's `planFormat` (`DeclaredWorkflow.planFormat`, null for the plain-checklist defaults). It replaces the plan code in `src/plugins/workflow-large/` and `src/shared/plan-progress.ts`, `src/shared/plan-copies.ts`.

This task creates new files and leaves the old ones in place. Task 06 deletes `src/plugins/workflow-large/` and the two `src/shared/` files. Reason: `workflow-large` still imports them until 06, and the tree must compile after each group. The new files are the old files moved and given the format parameter, so copy each old file first and then edit it, to keep its comments and its watch and guard logic.

04 already does these, from the matched trigger and stage: `clearsPlan` sets `plan: null`, `records` snapshots, `enteredFrom`, the reopen rule, every plan predicate, every `{plan…}` template, `openPlan`, `{plan.build}`, and the countdown. This task does not touch them.

### readPlan (`read-plan.ts`)

Start from `src/shared/plan-progress.ts`. Every format-specific constant becomes a `PlanFormat` knob. Rules not named here stay as `plan-progress.ts` has them: fence skipping (`linesOutsideFences`, `fenceAfterLine`), `CHECKBOX`, `MARKDOWN_LINK`, `~~` removal, CRLF handling.

| Knob | Present | Left out |
|---|---|---|
| `tasksSection` | Only boxes between the heading whose `trimEnd()` text equals it and the next heading of the same level or higher count. | Every box in the file counts. |
| `groupHeading` | Inside the counted region, a heading exactly one level below the tasks section heading sets the current group: capture 1 of `new RegExp(pattern)` as a number, or `null` when the heading does not match. Deeper headings leave the group unchanged. With no `tasksSection`, a `##` heading sets the group. | Every task has `group: null`. |
| `titleSuffix` | Dropped from the end of the first `# ` heading. | The heading text, trimmed. |
| `counters` | Each counter counts the lines that start with `itemPrefix` after the heading whose `trimEnd()` text equals `heading`, until the next heading of the same level or higher. With `section`, the heading counts only inside that section (bounded as `tasksSection` is). | `counters: {}`. |
| `taskDocs` | A task's `file` is its first link target when that target ends in `.md` and holds none of `/ \ : #`. Its `status` is the value of the first line matching `^(\*\*)?<statusField>:(\*\*)?\s*(.+)$` in the first `statusLines` lines outside fences, kept only when it is one of `statuses`, else null. | `file: null`, `status: null`. |
| `verificationTask` | The last task whose document was read and holds no line matching `^<lastTaskDocLacking>(?: \([^)\n]*\))?:` outside fences gets `verification: true`. | No task is the verification task. |

`PlanProgress.wave` is the `group` of the first open task whose group is not null, else null. `checked` and `total` count every task. Escape `statusField` and `lastTaskDocLacking` before they go into a regular expression.

`planFileName`, `isPlanFilePath` and `planDirOfArgs` replace `PLAN_FILE`, `PLAN_FOLDER_NAME`, `isPlanFile`, `planDirOf` and `planDirOfArgsPath` in `workflow-large/large-state.ts`:

- `format.folder` is a glob on the plan folder's name. Its only wildcard is `*`, which matches one or more characters that are not `/` or `\`. Every other character matches itself. Reason: today's `plan-[^\\/]+` and `^plan-.` both need a character after `plan-`.
- `isPlanFilePath` is true for a path, either separator, whose last segment is `planFileName(format)` and whose parent folder's name matches `format.folder`. With no `format.folder` it is always false.
- `planDirOfArgs` gives the folder of a plan file path, or a path whose trimmed folder name matches `format.folder`; else null. With no `format.folder` it is always null.

### Plan copies (`plan-copies.ts`)

Start from `src/shared/plan-copies.ts`. `PlanCopyDeps` gains `format: PlanFormat | null`. Changes:

- `plan.md` becomes `planFileName(format)` in `copyAt`, `readPlanCopy` and `newestChange`.
- `readPlanProgress` becomes `readPlan(..., format ?? {})`.
- `STATUS_RANK` becomes each status's index in `format.taskDocs.statuses`. A status outside that list, or no `taskDocs`, is never behind.
- `newestChange` drops `TASK_DOCUMENT` (`^\d{2}-.+\.md$`). It takes the newest modified time of the plan file and each task document the read plan links (`tasks[].file`) that exists. Reason: the `NN-` file name is the `wigley:feature` convention, and the links are what `taskDocs` already reads. For the user's plans the set of files is the same.

`isMovedFromMain` and `newestRead` stay as they are.

### Plan watch (`plan-watch.ts`)

Move `src/plugins/workflow-large/main/plan-watch.ts` unchanged in logic. Changes:

- `FollowedPlan` becomes `{ dir: string | null; reported: boolean; unreportedDir: string | null; format: PlanFormat | null }`. A `follow` whose `format` changed opens the watch again, as a changed `dir` does.
- `largeSignal({ type: 'planChanged', progress })` becomes `{ type: 'planChanged', progress }`, and `planGone` likewise.
- The comment's "since `wigley:make` names a folder before its `plan.md` exists" becomes "since a skill argument may name a folder before its plan file exists".
- `MAX_WATCH_REOPENS` stays `3`.

### Plan fold (`plan-fold.ts`)

`createPlanFold()` takes no deps: the fold is pure. (04's brief wrote `createPlanFold(deps)`; this task settles that it needs none.) It ports `applySignal`, `followPlanDir`, `reportPlanDir`, `setPlanDir`, `featureAndPlanNameOf` and `sameProgress` from `workflow-large/large-state.ts`. `fold(flow, signal, workflow, planFromArgs)` returns `flow.plan` itself when nothing changed, and reads a null `flow.plan` as `{ dir: null, reported: false, unreportedDir: null, progress: null, snapshots: {} }`.

| Signal | Effect |
|---|---|
| `fileWritten` whose path `isPlanFilePath` with the workflow's format | follow its folder |
| `skillStarted` with `planFromArgs` true, whose `argsPath` gives a folder by `planDirOfArgs` | follow that folder |
| `planReported` | report that folder |
| `planChanged` | replace `progress` unless `sameProgress` holds, then fill each snapshot still absent for a counter that the current stage's `records` names, from `progress.counters` |
| any other | no change |

- **follow**: a new folder sets `dir`, drops `progress` to null and `snapshots` to `{}`, and sets `reported: false`, `unreportedDir: null`. The folder already held changes nothing.
- **report**: as `reportPlanDir`. A new folder keeps the unreported folder it moves away from while that folder's last two segments equal the reported folder's last two segments, else `unreportedDir` is null. It then sets `dir` as follow does and `reported: true`.
- `sameProgress` compares every `PlanProgress` field by value, `counters` and every `PlanTaskLine` field included.

The fold runs for a flow whose workflow `usesPlan`. 04's engine calls it; it calls nothing else.

### Plan pane (`plan-pane.ts`)

Ports `workflow-large/page/checklist.ts`. `checklist(flow, format)`:

- `flow.plan?.progress` null: `defaultChecklist(flow)`.
- Else `{ title: progress.title, checked: progress.checked, total: progress.total, groups }`. Groups are in first-appearance order. A group's title is `format.groupHeading.title` with `{1}` replaced by the group number; a null group, or no `groupHeading`, is `Tasks`. An item is `running` when `format.taskDocs` is set and its `status` equals `format.taskDocs.running`.

### set_workflow_plan and plan reports

Move `plan-tool.ts`, `plan-report.ts` and `plan-reports.ts` from `workflow-large/main/`. Changes:

- The reporter signals `{ type: 'planReported', planDir }` live when the session's flow's workflow `usesPlan`, and resolves false otherwise.
- The tool checks for `planFileName(format)` of the session's flow's workflow, not `plan.md`. A session whose workflow keeps no plan gets `textResult('Ignored: this session's workflow keeps no plan.')`. The unknown-tool error reads `no workflow tool "<name>"`.
- The tool description stays word for word, except "the folder holding plan.md" becomes "the folder holding the plan file".
- `normalPlanDir(paths, folder)` keeps its rule: the folder with no trailing separator, symlinks kept.

### Wiring (`plan-capability.ts`)

`startPlanCapability(deps)` ports the plan half of `workflow-large/main/start.ts`. `PlanCapabilityDeps` holds `git`, `files`, `paths`, `log`, `homeDir`, `appInstance`, `sessions` (for `contributeTools`), the engine's `signal`, `flowOf`, `flows`, `observe`, `ready`, and `enabledWorkflows`, `onWorkflowsChanged`, `workflowOf(flow)` (the flow's `DeclaredWorkflow` or null). It returns one `Disposable`.

- **Watch.** One `createPlanWatch`, signalling through `signal(sessionId, s, 'observed')`. Only flows whose workflow `usesPlan` are watched.
- **Observer**, for such a flow, on a `whole` fold:
  - `turnEnded` runs `check`.
  - While the flow sits in a stage with `finishes` and `reopens` and `plan.dir` is set, every `turnStarted`, `turnEnded`, `subagentStarted` and `subagentFinished` runs `check` and `follow`.
  - A `fileWritten` that `isPlanFilePath`, or a change of `plan.dir`, `plan.reported` or `plan.unreportedDir`, runs `follow`.
  - A flow that leaves a plan workflow, a closed flow and a stop each `follow` with `dir: null`.
  - `opened` follows; at start, every held flow follows, since a restarted part hears no `opened`.
- **Tool and reports.** While at least one of `enabledWorkflows()` `usesPlan`, the capability contributes `set_workflow_plan` (`mainAgentOnly: true`, `offline: { set_workflow_plan: WORKFLOW_OFFLINE_ANSWER }`) and runs `createPlanReports` on `<appEndpointDir>/plan-runs`. On `onWorkflowsChanged` it disposes or starts both to match, in the same way `main/start.ts` re-contributes the step tool today.

`main/start.ts` passes `createPlanFold()` where 04 passes `NO_PLAN_FOLD`, starts `startPlanCapability` after flows load, and disposes it on stop. `page/start.ts` passes `createPlanPane()` where 04 passes `NO_PLAN_PANE`.

## Decisions

- The capability lives in the `workflow` plugin under `plan/` (plan.md File Structure).
- New files in this task, old ones deleted in 06, so each wave compiles (this task's settling; see report).
- `planFormat` left out means plain-checklist defaults and no plan from writes or arguments, reports only (design.md § Section: planFormat).
- No migration of a saved `LargeState`: intent.md, Local, does not care about backwards compatibility.

## Tests

Move each old test file next to its new source, rename its imports and fields (`planDir` → `dir`, `reviewRounds` → `counters.reviewRounds`, `wave` → `group`), and keep every row. `plan-fixtures.test-support.ts` exports `USER_PLAN_FORMAT` (the user's `planFormat` from design.md § Section: planFormat, verbatim) and `planWorkflowFixture(): DeclaredWorkflow`, a two-stage plan workflow with `sidePane.kind: 'plan'`, a `make` stage with `planFromArgs` and `records: ['reviewRounds']`, and a `closed` stage with `finishes` and `reopens`. Old rows run with `USER_PLAN_FORMAT`.

- `read-plan.test.ts` (rows of `src/shared/plan-progress.test.ts`), add:
  - `readPlan_NoFormat_CountsEveryBoxWithNoGroups` — boxes in two H2 sections both count; every `group` null; title from `# `.
  - `readPlan_GroupHeadingDeeperHeading_KeepsTheGroup` — a `####` under `### Wave 2` leaves its boxes in group 2.
  - `readPlan_CounterOutsideItsSection_NotCounted` — `- ` lines under `### Review rounds` outside `## Run log` give 0.
  - `readPlan_StatusOutsideStatuses_ReadsNull`.
  - `readPlan_VerificationField_FromFormat` — with `lastTaskDocLacking: 'Tier'`, the last doc with no `Tier:` is the verification task.
- `plan-copies.test.ts` (rows of `src/shared/plan-copies.test.ts`), add:
  - `readMovedCopy_StatusRank_FromFormat` — with `statuses: ['a', 'b']`, a worktree copy at `a` is behind main's `b`.
  - `planCopies_ChangedAt_TakesLinkedTaskDocs` — an unlinked `.md` file in the folder modified later does not move `changedAt`.
  - `planCopies_PlanFileName_FromFormat` — with `file: 'tasks.md'`, a folder holding only `plan.md` lists no copy.
- `plan-watch.test.ts` (rows of `workflow-large/main/plan-watch.test.ts`), add `follow_FormatChanged_OpensAgain`.
- `plan-fold.test.ts` (plan rows of `workflow-large/large-state.test.ts` `foldLargeState` and `sameLargeState`), add:
  - `fold_NoFolderKnob_WritesAndArgsSetNothing`.
  - `fold_GlobNeedsACharacterAfterStar` — a write of `.../plan-/plan.md` sets no plan.
  - `fold_FirstRead_FillsTheRecordedSnapshotOnce` — in `make`, the first `planChanged` with `reviewRounds: 2` sets `snapshots.reviewRounds` to 2, and a later one with 3 keeps 2.
  - `fold_SameProgress_KeepsThePlanByReference`.
- `plan-pane.test.ts` (rows of `workflow-large/page/checklist.test.ts`), add `checklist_GroupTitle_FromFormat` and `checklist_NoTaskDocs_NothingRuns`.
- `plan-tool.test.ts`, `plan-report.test.ts`, `plan-reports.test.ts`: the old rows, with `Ignored: this session's workflow keeps no plan.`.
- `plan-capability.test.ts`, ported from the plan rows of `src/plugins/workflow-large-main.test.ts` over `planWorkflowFixture()`: `turnEndedChangingNoField_StillChecksThePlan`, `planFileWrittenAfterPlanGone_ReadsThePlanAgain`, `planFolderBackReadIdle_NextTurnStartReopens`, `PlanTool_ContributedForTheMainAgentOnly`, `restartOverAReportedFolderGone_ReadsTheUnreportedMainCopy`, `startWithFlowsHeld_FollowsTheirPlans`, `subagentPlanWrite_NamesThePlanAndWatchesIt`, `checklistWorkflowFlow_IsNotWatched` (from `flowOfAnotherWorkflow_IsNotWatched`), `FlowLeavingAPlanWorkflow_StopsItsWatch`. Add:
  - `PlanTool_NoEnabledPlanWorkflow_NotContributed`.
  - `PlanTool_PlanWorkflowSwitchedOn_Contributed` — after `onWorkflowsChanged` names one, the tool is contributed once.

The rows of `workflow-large-main.test.ts` that test the countdown, the run log and `MissedLevel` are not this task's: 06 ports them onto 04's engine.

## Done when

- `npm run typecheck` and `npm run lint` pass in `wigley-ai-gui/`.
- `npm test -- src/plugins/workflow` passes.
- `grep -rn "wigley\|plan\.py\|Rung\|Wave" src/plugins/workflow/plan --include='*.ts' | grep -v '\.test\|test-support'` prints nothing: no personal name or format constant in the capability's code.
- `grep -n "NO_PLAN_FOLD\|NO_PLAN_PANE" src/plugins/workflow/main/start.ts src/plugins/workflow/page/start.ts` prints nothing.
- The live checks (a real `/wigley:feature` run reaching Make · ready, the plan pane over a worktree copy) are task 18's.

Commit: one commit for the group.

## Proof
