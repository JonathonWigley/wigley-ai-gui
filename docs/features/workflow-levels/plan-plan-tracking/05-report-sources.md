# 05 — The report sources: tool and report file

Status: not started
Type: Batch
Wave: 3 · Depends on: 02, 04
Plan: [plan.md](plan.md)

Files:     create `src/plugins/workflow-large/main/plan-tool.ts` · test `src/plugins/workflow-large/main/plan-tool.test.ts` · create `src/plugins/workflow-large/main/plan-reports.ts` · test `src/plugins/workflow-large/main/plan-reports.test.ts` · modify `src/plugins/workflow-large/main/start.ts` · modify `src/plugins/workflow-large/main/selftest-script.ts`
Consumes:  `largeSignal({ type: 'planReported', planDir })` ← 02 · `follow(sessionId, planDir, reported)` ← 04 (through
           the fold) · the report file shape ← 03 · `sessions.contributeTools(definitions, start, { mainAgentOnly: true })`
           (tree) · `appEndpointDir(paths, homeDir, instanceId)` (tree)
Produces:  `export const SET_WORKFLOW_PLAN_TOOL = 'set_workflow_plan';` in `plan-tool.ts`
           `export function planToolDefinition(): ToolDefinition` in `plan-tool.ts`
           `export function startPlanTool(deps: PlanToolDeps): (session: Pick<AgentSession, 'id'>) => ToolSession` in `plan-tool.ts`
           `export const PLAN_RUNS_FOLDER = 'plan-runs';` in `plan-reports.ts`
           `export function createPlanReports(deps: PlanReportsDeps): Disposable` in `plan-reports.ts`
Decisions: the tool is Large's, main-agent-only, and refuses a folder with no `plan.md` (Decided notice) · the latest
           report wins: both sources signal on arrival (round 3) · the report watch applies a report only when its
           file changes, with no scan at start, and deletes no file (plan.md Design Overview)

## The tool (`plan-tool.ts`)

Follow the shape of `src/plugins/workflow/main/step-tool.ts`.

- Definition: name `set_workflow_plan`. Description: "Set the plan folder this session's run writes, so the app
  shows that copy's progress. Call it once the run knows its folder, and again when the run moves to another copy."
  Input: `folder` (string, required, "The plan folder's absolute path: the folder holding plan.md."),
  `additionalProperties: false`.
- `PlanToolDeps`: `paths: Paths`, `files: Pick<Files, 'stat'>`, and
  `reportPlan(sessionId: string, planDir: string): Promise<boolean>` — folds the report and resolves whether a Large
  flow holds the session.
- A call:
  - `folder` not a string, or not absolute (`paths.isAbsolute`): `errorResult('folder must be an absolute path.')`.
  - `<folder>/plan.md` is not a file: `errorResult(\`${folder} holds no plan.md.\`)`.
  - `reportPlan` resolves false: `textResult('Ignored: this session runs no Large workflow.')`.
  - Otherwise `textResult(\`Plan folder set to ${folder}.\`)`.
- `start.ts` contributes it with `sessions.contributeTools([planToolDefinition()], startPlanTool(...), { mainAgentOnly: true })`.
  `reportPlan` waits on `workflow.ready`, returns false when `workflow.flowOf(sessionId)?.workflow` is not
  `LARGE_WORKFLOW_ID`, and otherwise calls
  `workflow.signal(sessionId, largeSignal({ type: 'planReported', planDir }), 'live')` and returns true.

## The report watch (`plan-reports.ts`)

- `PlanReportsDeps`: `files: Pick<Files, 'read' | 'watch'>`, `paths: Paths`, `log: PluginLog`, `folder: string` (the
  `plan-runs` folder), `report(rowId: string, planDir: string): void`.
- `createPlanReports` watches `folder` with `files.watch(folder, onChange, { recursive: false, onError })`. On a change
  to an entry named `<row id>.json`, it reads the file and parses JSON. When the JSON is an object whose `planDir` is
  a non-empty string, it calls `report(rowId, planDir)`. A read failure, a missing file, bad JSON or a bad shape logs
  one line `report <name> not read: <reason>` and calls nothing. A watch error logs one line and is not reopened.
- The returned `Disposable` disposes the watch.
- `start.ts` builds `folder` as
  `paths.join(appEndpointDir(paths, services.homeDir, services.appInstance.id), PLAN_RUNS_FOLDER)` and passes `report`
  as: when `workflow.flowOf(rowId)?.workflow` is `LARGE_WORKFLOW_ID`, call
  `workflow.signal(rowId, largeSignal({ type: 'planReported', planDir }), 'observed')`; otherwise do nothing. The part's
  `dispose` disposes it with the plan watch.

GIVEN a flow in make WHEN `set_workflow_plan` names a folder holding `plan.md` THEN the flow's `planDir` is that folder
and `planReported` is true.
GIVEN a folder with no `plan.md` WHEN `set_workflow_plan` runs THEN the result is an error naming the folder and the
flow is unchanged.
GIVEN a session whose flow is Small WHEN `set_workflow_plan` runs with a good folder THEN the result says it was
ignored.
GIVEN the report watch WHEN `plan-runs/s1.json` is written with `{"planDir": "/w/p/plan-a"}` THEN `report('s1',
'/w/p/plan-a')` is called once.
GIVEN the report watch WHEN `plan-runs/s1.json` holds `{"planDir": 3}` or `not json` THEN `report` is not called and
one line is logged.

Tests:     `plan-tool.test.ts`: one `it.each` table over the first three rows plus the non-absolute row, at the
           `startPlanTool` seam with a fake `reportPlan` and memory files (follow `step-tool.test.ts`).
           `plan-reports.test.ts`: one `it.each` table over the last two GIVEN lines, with memory files and their
           watch.
           Self-test: add one group `reported plan` to `selftest-script.ts` after `clear and make`. Its `why`: "A
           report file moves the checklist to the reported copy." It writes, with a step's `writeFile`, a second copy
           of the fixture plan with one more ticked box in a folder of its own, then
           `<temp home>/.agents/<instance id>/plan-runs/<fixture row>.json` naming that folder, and expects the
           checklist line the new count logs. Read the script's existing groups for the fixture row id, the log line
           and the endpoint folder of the self-test run.
Done when: `npm test -- src/plugins/workflow-large` passes; `npm run lint` passes;
           `npm run selftest -- --plugin workflow-large` passes.
Commit:    one commit for the group

## Proof

