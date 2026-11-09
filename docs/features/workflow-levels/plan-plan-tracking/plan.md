# Plan copy tracking — plan

Feature: workflow levels · Implements: none · Ticket: none
Target: main (wigley-ai-gui and wigley-ai-marketplace) · Written: 2026-11-09

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

Large's plan checklist and Backlog show the progress of the plan copy a run really writes. Today the app picks the copy
with the newest file modified time. Every new worktree checks the plan out with fresh times, so a stale copy wins: the
runtime loader run showed 0 of 16 while its worktree held 15 of 16.

After this plan:

- A run reports its plan folder. `plan.py` reports on every progress write. The agent reports through the new
  `set_workflow_plan` tool. The latest report wins. The app reads a reported folder alone.
- With no report, or when the reported folder holds no `plan.md`, the app reads the **moved copy**: a copy whose
  progress differs from the main tree's copy, the most recently modified of them when several differ, else the main
  tree's copy. Backlog uses the same rule.

## Architecture

Systems touched:

- `src/shared/plan-copies.ts` — the plan reader that Large and Backlog share.
- `src/plugins/workflow-large/` — Large's state, its plan watch, and two new report sources: the tool and the
  report-file watch.
- `src/plugins/backlog/main/start.ts` — one caller of the shared reader.
- `wigley-ai-marketplace` `plugins/wigley/scripts/plan/plan.py` — writes the report file.

```
 plan.py (session shell) ──writes──▶ <endpoint dir>/plan-runs/<row id>.json  {"planDir": "/abs/plan-x"}
                                              │ Files.watch (plan-reports.ts)
                                              ▼
 agent ──set_workflow_plan{folder}──▶ plan-tool.ts ──┐
                                                     ▼
                          workflow.signal(row id, planReported{planDir})
                                                     ▼
                     foldLargeState: planDir = planDir, planReported = true
                                                     ▼
                     start.ts followPlan ─▶ planWatch.follow(row id, planDir, planReported)
                                                     ▼
            read: planReported and <planDir>/plan.md exists ─▶ readCopyAt(planDir)
                  otherwise                                  ─▶ readMovedCopy(planDir)
                                                     ▼
                                  planChanged{progress} ─▶ checklist
 Backlog readPlan ─▶ readMovedCopy(planDir)
```

## Preconditions

Each claim was checked on 2026-11-09 with the command beside it. `wigley:make` runs each command again before the
first dispatch.

- Every app-started Claude session has `WIGLEY_SESSION_ROW` set to its row id, and the row id is the flow's
  `sessionId`: `grep -n "SESSION_ROW_ENV\] = request.rowId" src/main/claude-code/claude-launch.ts` and
  `grep -n "rowId: session.sessionId" src/plugins/chat/main/chat-sessions.ts` each print one line.
- Every app-started Claude session has `WIGLEY_AI_GUI_ENDPOINT_DIR` set to the app instance's endpoint folder:
  `grep -n "WIGLEY_AI_GUI_ENDPOINT_DIR: appEndpointDir" src/main/main.ts` prints one line.
- `appEndpointDir(paths, homeDir, instanceId)` is in `src/shared/app-endpoint-dir.ts`, and `MainServices` holds
  `appInstance` and `homeDir`: `grep -n "export function appEndpointDir" src/shared/app-endpoint-dir.ts` and
  `grep -n "  appInstance: AppInstance;" src/contracts/plugin.ts` each print one line.
- `newestPlanCopy` has two callers: `grep -rln "newestPlanCopy" src --include='*.ts'` prints
  `src/shared/plan-copies.ts`, `src/shared/plan-copies.test.ts`, `src/plugins/workflow-large/main/plan-watch.ts` and
  `src/plugins/backlog/main/start.ts`.
- `GitWorktree` has `isMain`: `grep -n "readonly isMain: boolean" src/contracts/git.ts` prints one line.
- `isSameJson` is in `src/shared/json.ts`: `grep -n "export function isSameJson" src/shared/json.ts` prints one line.
- In the marketplace, `plan.py`'s `main(argv)` returns 0 after the edits of a command that ran:
  `grep -n "^def main(argv: list | None = None) -> int:" plugins/wigley/scripts/plan/plan.py` prints one line.
- The marketplace plugin version is `2.0.2` in both manifests: `python3 scripts/check_manifests.py` passes.

## Docs written ahead

- wigley-ai-gui `0318c8da`, `f6eb0327` and `fa90eb4c` (branch `plan-watch-tracking`): `docs/features/workflow/design.md` §
  Large's stages and § Signals and § Decisions, `docs/features/workflow-levels/design.md`,
  `docs/features/backlog/design.md` § Plans and features, `AGENTS.md` (the `workflow-large/` and `plan-copies.ts`
  lines).
- wigley-ai-marketplace `828be71` (branch `plan-tracking`): `plugins/wigley/skills/make/SKILL.md` step 1.7.

## Mandatory Reads

- wigley-ai-gui `AGENTS.md` § Architecture (A plugin, A registration, A slot, An MCP tool, An ambient service, A path)
  and § Running and testing (the self-test bullet).
- wigley-ai-gui `docs/features/workflow/design.md` § Large's stages and § Signals.
- wigley-ai-marketplace `AGENTS.md` (Changing a plugin, Done).
- `wigley:writing-code` and `wigley:writing-tests` (TypeScript: `typescript-vitest.md`).

## Design Overview

Decisions:

- `plan.py` and `set_workflow_plan` both report. The latest report wins (round 3).
- The report file is `<WIGLEY_AI_GUI_ENDPOINT_DIR>/plan-runs/<WIGLEY_SESSION_ROW>.json`, content
  `{"planDir": "<absolute folder>"}`. `plan.py` writes it only when both variables are set.
- A failed report write prints a warning to stderr. It never changes the command's exit code.
- `plan.py close` writes no report.
- `set_workflow_plan` is contributed by `workflow-large`, main-agent-only, and refuses a folder that holds no
  `plan.md`.
- A report sets `planDir` and `planReported: true`. Every other change of `planDir` sets `planReported: false`.
- The plan watch reads a reported folder alone while it holds `plan.md`. Otherwise it reads the moved copy. It signals
  `planGone` only when no copy is left, as today.
- The moved copy replaces `newestPlanCopy` in Large and Backlog. A worktree copy with fewer ticked boxes than the
  main tree's is behind main and never the moved copy.
- Every source carries the folder in one form: absolute, normalized, symlinks kept (`os.path.abspath` in `plan.py`,
  `paths.parent(paths.join(folder, 'plan.md'))` in the app), the form `fileWritten` gives, so the fold's
  same-folder check holds.
- A reported worktree folder removed after its merge reads the main tree's copy the watch last listed. After an app
  restart with the folder already gone, the watch signals `planGone` (accepted).
- A report that lands before the row's flow is Large is dropped; the run's next `plan.py` command reports again.
- The report watch applies a report only when its file changes. It does no scan at start: `flows.json` keeps the
  reported folder across a restart.
- The app does not delete report files: the live `Files.trash` moves files to the user's Trash.
- `LargeState` gets the new field with no migration (`AGENTS.md` § Intent, one user). A saved Large state from before
  this change fails `isLargeState` and reads as the empty state until the next plan signal.

Out of scope:

- The stale `workflow-heavy` flow in `flows.json`.
- Terminal sessions: they carry no row id. The moved copy covers them.

## File Structure

Modified:

- `src/shared/plan-copies.ts` — `PlanCopy` gets `isMainTree`; `newestPlanCopy` is replaced by `readMovedCopy` and
  `readCopyAt`.
- `src/shared/plan-copies.test.ts`
- `src/plugins/backlog/main/start.ts` — `readPlan` calls `readMovedCopy`.
- `src/plugins/workflow-large/contract.ts` — `LargeState.planReported`, `LargeEvent` `planReported`.
- `src/plugins/workflow-large/large-state.ts`, `src/plugins/workflow-large/large-state.test.ts`
- `src/plugins/workflow-large/main/plan-watch.ts`, `src/plugins/workflow-large/main/plan-watch.test.ts`
- `src/plugins/workflow-large/main/start.ts`
- `src/plugins/workflow-large/main/selftest-script.ts`
- `src/plugins/workflow-large/page/preview.ts` and every test fixture that builds a `LargeState` literal (task 02 says
  how to find the untyped ones).
- `src/plugins/backlog/main/start.test.ts` — rows of the newest-timestamp rule move to the moved-copy rule.
- marketplace `plugins/wigley/scripts/plan/plan.py`, `plugins/wigley/scripts/plan/tests/test_plan.py`,
  `plugins/wigley/.claude-plugin/plugin.json`, `plugins/wigley/.codex-plugin/plugin.json`.

New:

- `src/plugins/workflow-large/main/plan-tool.ts` and `plan-tool.test.ts` — the `set_workflow_plan` tool. It follows
  `src/plugins/workflow/main/step-tool.ts`.
- `src/plugins/workflow-large/main/plan-reports.ts` and `plan-reports.test.ts` — the watch of `plan-runs/`.

Shared names (every task uses them as written here):

- `export interface ReadCopy { readonly copy: PlanCopy; readonly progress: PlanProgress }` in
  `src/shared/plan-copies.ts`.
- `export async function readMovedCopy(planDir: string, deps: PlanCopyDeps): Promise<ReadCopy | null>`
- `export async function readCopyAt(planDir: string, deps: PlanCopyDeps): Promise<ReadCopy | null>`
- `LargeState.planReported: boolean`; `LargeEvent` member `{ type: 'planReported'; planDir: string }`.
- `PlanWatch.follow(sessionId: string, planDir: string | null, reported: boolean): void`
- `export const SET_WORKFLOW_PLAN_TOOL = 'set_workflow_plan';`
- `export const PLAN_RUNS_FOLDER = 'plan-runs';` in `plan-reports.ts`.
- `export function largePlanReporter(workflow: Pick<WorkflowMainExports, 'ready' | 'flowOf' | 'signal'>): (sessionId: string, planDir: string) => Promise<boolean>` in `plan-tool.ts`.
- `WorkflowLargeSelfTestDeps.planRunsFolder: string` in `selftest-script.ts`.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [The moved-copy reader](01-moved-copy-reader.md)
- [x] [Large state records a reported plan](02-reported-state.md)
- [x] [plan.py reports its folder](03-plan-py-report.md)

### Wave 2
- [x] [The plan watch reads the reported copy](04-watch-reported-copy.md) — after 01, 02

### Wave 3
- [x] [The report sources: tool and report file](05-report-sources.md) — after 02, 04

### Wave 4
- [ ] [Doc re-read](06-doc-re-read.md) — after 05, 03

### Wave 5
- [ ] [Final verification](07-final-verification.md) — after 06

## Run log

Review base: 12745c21

### Groups
- 02 · df8e5262 · diff read; typecheck clean outside task 01's in-progress files; worker ran workflow-large tests (471) and lint · concerns: design.md Signals not updated for planReported — left to task 06
- 03 · marketplace 7270a1d · diff read; plan tests 32 OK with and without the real env vars, no plan-runs leak; check_manifests passes · concerns: report test lives in a new class for the close row's features-home layout
- 01 · d27b84e5 · diff read; typecheck clean; worker ran named tests (262) and lint · concerns: plan watch now stats planDir and may signal planGone when every copy's plan.md reads null (old code stayed silent); task 04 rewrites the read
- 04 · 92e00206 · diff read; typecheck clean; worker ran workflow-large tests (475) and lint · concerns: all-null read signals planGone only when planDir is gone; a removed reported folder whose remembered main copy also lost plan.md signals planGone though the main folder exists
- 05 · 58a4dc8c · diff read; typecheck clean; worker ran workflow-large tests (486), lint, and selftest --plugin workflow-large 12/12 · concerns: macOS FSEvents can drop the rename target of plan.py's .json.tmp atomic write, so a report is lost until the next write; tool path has no fold-level test (self-test covers the file path); workflow-large-main.test.ts services gained homeDir and appInstance
### Contract changes
### Rulings
- fileWritten and make args go through followPlanDir (new folder clears the mark, held folder keeps it); the planReported event calls setPlanDir and sets the mark · group 02
- plan_folder no longer resolves anything; the folder argument goes to report_plan_folder as given and is abspath'd there · group 03
- readMovedCopy reads copies in parallel, one failed read rejects the call as planCopies does · group 01
- follow_PlanInTwoCheckouts_SignalsTheMovedCopy gained a step (main rewritten at time 40, same progress) to pin the moved-copy rule over timestamps; backlog's equal-time worktree row now returns the worktree copy · group 01
- cloneGit test fake's topLevel now answers each checkout's own top folder (/r, /w) as git does, so a followed /w folder is a worktree copy · group 04
- self-test writes the report with files.append, not files.write, since the temp-file rename lost the target name 1 run in 5 · group 05
- plan.py writes its report file directly, with no temp file and rename: the app's watcher on macOS can miss the rename's target name (task 05's self-test lost it 1 run in 5), and a direct write reports under the real name; a torn read logs one line and the write's own event reads again — cost if wrong: a rare bad-JSON log line · lead
### Review rounds
### Test gate
