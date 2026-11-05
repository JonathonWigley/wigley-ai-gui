# 04 — Run log

Status: in progress
Type: Task
Wave: 4 · Depends on: 03
Plan: [plan.md](plan.md)

Files:
- create `src/plugins/workflow/main/run-log.ts` · `src/plugins/workflow/main/run-meter.ts`
- modify `src/plugins/workflow/main/start.ts` · `src/plugins/workflow/stages/closed/main.ts` · `src/plugins/workflow/stages/heavy-state.ts` · `src/plugins/workflow/stages/heavy-workflow.ts`
- modify `src/plugins/chat/contract.ts` · `src/plugins/chat/main/start.ts`
- test: create `src/plugins/workflow/main/run-log.test.ts` · `src/plugins/workflow/main/run-meter.test.ts`
- test: modify `src/plugins/workflow/main/start.test.ts` · `src/plugins/workflow/stages/closed/main.test.ts` · `src/plugins/workflow/stages/heavy-state.test.ts` · `src/plugins/chat/main/start.test.ts`

Consumes:
- `MainWorkflow.fixCycles`, `MainStage.finishes`, `SessionFlow`, `addWorkflow`, `heavyMainWorkflow`, `heavyStateOf`, `heavySignal` ← 01
- `apply` and the `chat.agentEvent` listener in `src/plugins/workflow/main/start.ts`, as task 03 leaves them ← 03
- `MainApi.data` (`Files.append`) in `src/contracts/plugin.ts` and `src/contracts/files.ts`, `AgentEvent` and `MAIN_AGENT_ID` in `src/contracts/agent.ts`, `ActiveTime` in `src/contracts/active-time.ts`, `activeMsAt` in `src/shared/active-time.ts`, `chat.sessions()` in `src/plugins/chat/main/chat-sessions.ts` (tree members)

Produces:
- In `src/plugins/chat/contract.ts`: `ChatMainExports.activeTime(sessionId: string): ActiveTime | null`, the same member `ChatPageExports` has.
- In `src/plugins/workflow/main/run-log.ts`:
  - `RUNS_FILE = 'runs.jsonl'`
  - `interface RunLogLine { at: number; sessionId: string; projectDir: string; workflow: WorkflowId; movedUpFrom: WorkflowId | null; activeMs: number; costUsd: number | null; fixCycles: number }`
  - `interface RunLog { append(line: RunLogLine): void }`
  - `createRunLog(deps: { files: Files; log: PluginLog }): RunLog`
- In `src/plugins/workflow/main/run-meter.ts`:
  - `interface RunMeter { note(sessionId: string, event: AgentEvent): void; cleared(sessionId: string): void; read(sessionId: string): { activeMs: number; costUsd: number | null }; finished(sessionId: string): void; forget(sessionId: string): void }`
  - `createRunMeter(deps: { activeMsOf(sessionId: string): number }): RunMeter`
- In `src/plugins/workflow/stages/heavy-state.ts`: `heavyFixCycles(flow: SessionFlow): number`. On `heavyMainWorkflow`: `fixCycles: heavyFixCycles`. On `closedMainStage`: `finishes: true`.

Decisions:

Where each value is read in main. Checked against the tree:
- Active time. `src/plugins/chat/contract.ts` has `activeTime` on `ChatPageExports` only, and `ChatMainExports` has no read. Main holds it in `ChatSessionState.activeTime`. This task adds the main export: in `src/plugins/chat/main/start.ts`, `activeTime: (sessionId) => chat.sessions().find((held) => held.sessionId === sessionId)?.activeTime ?? null`. `workflow` reads it with `activeMsAt(time, clock.now())`, and a null time reads 0.
- Spend. The `usage` plugin exports nothing in main, only `usagePageKey`. No new export is needed: `chat.agentEvent`, which `workflow` already hears, carries each `UsageAgentEvent`. Its `spendUsd` with `agentId` `MAIN_AGENT_ID` is the process's cumulative `total_cost_usd`, null before the first result. `src/main/claude-code/session-usage.ts` keeps that total.

A run spans a clear. `/clear` starts a new process and sets the active time to 0, and the new process's spend starts again. A Heavy run usually spans one, through Clear & make, and the log exists to judge Heavy. So `createRunMeter` adds across clears:
- `note`: on a `usage` with `agentId` `MAIN_AGENT_ID` and a non-null `spendUsd`, store it as the process's spend. On every event, store `activeMsOf(sessionId)` as the last sample. Both live and replayed events go to `note`, before their signals fold.
- `cleared`: add the process's spend and the last sample to the carried totals; set the process's spend to null and the sample to 0. The last sample, not a read at this moment, is what adds: `chat` may have set the clock to 0 before the host change arrives.
- `read`: `activeMs` is carried time plus `activeMsOf(sessionId)`, minus the baseline. `costUsd` is carried spend plus the process's spend (null counts 0), minus the baseline, and is null when no `spendUsd` was stored for this session since the last `forget`.
- `finished`: set the baseline to the two totals, so a second run in one session logs its own values.
- `forget`: drop the session.

The meter keeps its totals in memory only. After a relaunch, a line counts spend from the new process and clears since the relaunch, and active time from `chat`'s restored total. An approximate line is better than a new persistent file: the line is evidence for tuning, not an account. `costUsd` is `null`, not 0, when no spend is known.

When a line goes out. In `apply`, after `putFlow`, for every origin. Heavy's `closed` comes from `planGone`, whose origin is `observed`, and a replay past the save time is a real new step. The saved flow's `stage` stops a repeat. The condition is `next.stage !== flow.stage`, and the stage of `next` in the current workflow's `stages` has `finishes === true`. Then, in this order:
1. Call `runMeter.read(sessionId)`.
2. Call `runLog.append` with `at` `clock.now()`, `sessionId`, `projectDir` and `workflow` and `movedUpFrom` from `next`, `activeMs` and `costUsd` from the read, and `fixCycles` as `workflow.fixCycles?.(next) ?? 0`.
3. Call `runMeter.finished(sessionId)`.

`next.workflow` is non-null here, because a stage came from a workflow. A stage entered again after leaving writes a new line: a second Heavy make run that closes is a second run.

`createRunLog`. `append` writes `JSON.stringify(line)` with the keys in plan.md's order (`at`, `sessionId`, `projectDir`, `workflow`, `movedUpFrom`, `activeMs`, `costUsd`, `fixCycles`), plus `\n`, through `files.append(RUNS_FILE, text)` on `api.data`. `Files.append` is not atomic, so appends chain on one promise, as `flow-store.ts` chains writes. A failure logs `runs.jsonl not written: <error>`, and the next line still goes. A failure never reaches the fold. Nothing reads the file in the app, and no page or channel message changes.

Call sites in `main/start.ts`:
- The `chat.agentEvent` listener calls `runMeter.note(sessionId, event)` first, before the flow check.
- The `sessions.hostSessionChanged` handler calls `runMeter.cleared(id)` before it applies `cleared`.
- `sessions.ended` and `forgetFlows` call `runMeter.forget`.
- `activeMsOf` is `(id) => { const time = chat.activeTime(id); return time === null ? 0 : activeMsAt(time, clock.now()); }`.

Heavy's values. `heavyFixCycles` is `heavyStateOf(flow).progress?.reviewRounds ?? 0`, the number the fix stage already shows as its cycle. `planGone` leaves `progress` in the state, so it holds at `closed`. `closedMainStage` gets `finishes: true`. Tasks 07 and 08 set it on their `done` stages. Light and Medium leave out `fixCycles` unless their tasks say otherwise; left out gives 0.

Heavy keeps. This task only reads the flow. It must not change:
- The fold's result, the `flows` push or the save time.
- `closed`'s entry rule, or its row activity.
- `dismissed` to idle after closed.
- A failed append leaves the stage at `closed`.
- `Clear & make` still clears and sends `/wigley:make <planDir>`.

Pinned after the cold read.
- `costUsd` is spend through the last finished turn. Spend only updates at a turn's result, and `done` or `closed` lands mid-turn, so a run's own last turn is not in the number, and a one-turn run logs null. Accepted: the log tunes levels, so being one turn behind does not change a comparison.
- The meter's baseline resets at `finished` and when a flow's `workflow` goes from null to a claim, so work before the first claim does not count. A move up does not reset it: a moved-up run counts its lower part, and `movedUpFrom` says so.
- `note` keeps the larger of the sample and the stored value until `cleared`, because an old process's events can be handled after `chat.clear` reset the clock.
- `workflow` in a line is the workflow id (`workflow-light`), as `movedUpFrom` is.

GIVEN a Heavy flow with progress `reviewRounds` 2, spend 1.25 before a clear and 2.5 after it WHEN `planGone` closes it THEN `runs.jsonl` gains one line with `workflow` `'workflow-heavy'`, `costUsd` 3.75 and `fixCycles` 2.
GIVEN a flow already in a `finishes` stage WHEN another signal folds THEN no line goes out.
GIVEN an append that fails WHEN the next run finishes THEN that line still goes, and the flow's stage is unaffected.
GIVEN a session with no main `usage` seen WHEN a run finishes THEN `costUsd` is null.

Tests:
- `main/run-meter.test.ts`, a stub `activeMsOf` returning a set value, table of steps and expected read:
  | steps | activeMs | costUsd |
  |---|---|---|
  | clock 4000; `usage(main, 0.5)` | 4000 | 0.5 |
  | clock 4000; `usage('sub-1', 0.5)` | 4000 | null |
  | clock 4000; `usage(main, null)` | 4000 | null |
  | clock 4000; `usage(main, 0.5)`; clock 0; `cleared`; clock 1500; `usage(main, 0.25)` | 5500 | 0.75 |
  | clock 4000; `usage(main, 0.5)`; `finished`; clock 6000; `usage(main, 0.75)` | 2000 | 0.25 |
  | clock 4000; `usage(main, 0.5)`; `forget`; clock 0 | 0 | null |
- `main/run-log.test.ts`:
  - `Append_WritesOneJsonLine`: a line gives exactly `{"at":10,"sessionId":"s1","projectDir":"/r","workflow":"workflow-light","movedUpFrom":null,"activeMs":2000,"costUsd":0.25,"fixCycles":0}\n` in `runs.jsonl`.
  - `Append_InOrder`: two appends with the first held open write in call order.
  - `Append_Failure_LogsAndGoesOn`: the first append rejects with `boom`; the log has `runs.jsonl not written: boom`; the second line is written.
- `main/start.test.ts`:
  - `RunLog_HeavyClosed`: a `wigley:make` start with a plan path first, so the flow can close, then the first GIVEN's values, with chat's fake `activeTime` at `{totalMs:4000,since:null}` before the clear and `{totalMs:1500,since:null}` after it, a `clock` of 90000, gives one line `{"at":90000,"sessionId":"s1","projectDir":"/r","workflow":"workflow-heavy","movedUpFrom":null,"activeMs":5500,"costUsd":3.75,"fixCycles":2}`.
  - `RunLog_MovedUp`: a stub `light`, then `wigley:feature`, then a Heavy close, gives `movedUpFrom` `"light"`.
  - `RunLog_OnlyOnEntry`: another `heavySignal({type:'planGone'})` at `closed` adds no line.
  - `RunLog_SpendAfterTheStep`: spend 1 at the finishing step, then a `usage` of 2 gives a line with `costUsd` 1.
  - `RunMeter_BaselineAtClaim`: activity of 3000 and spend 1 before the first claim, then 2000 and 1 more, gives `activeMs` 2000 and `costUsd` 1. A move up keeps the baseline.
  - `RunMeter_NoteKeepsTheLargest`: clock 4000, `usage`, clock 0, another event, `cleared`, clock 1500, `usage` gives 5500.
  - `RunLog_StubWorkflowWithNoFixCycles`: a stub stage with `finishes` gives `fixCycles` 0.
  - `RunLog_NoFinishesStage_NoLine`: a stage change to `make` adds no line.
- `stages/closed/main.test.ts`: `closedMainStage.finishes` is true.
- `stages/heavy-state.test.ts` `heavyFixCycles_ReadsTheRounds`: progress null gives 0; `reviewRounds` 2 gives 2; 2 after `planGone` gives 2.
- `plugins/chat/main/start.test.ts`: `exports.activeTime` of a held session returns its `activeTime`; of `'none'` returns null.

Done when: compiles; `scripts/check-layers.mts` passes; the test gate runs the tests above. A real `runs.jsonl` from a finished run goes to task 12.
Commit: one commit for the group.

## Proof

