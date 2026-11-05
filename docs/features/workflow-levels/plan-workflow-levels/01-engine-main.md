# 01 — Engine: workflows in main

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:
- create `src/plugins/workflow/stages/heavy-contract.ts` · `src/plugins/workflow/stages/heavy-state.ts` · `src/plugins/workflow/stages/heavy-workflow.ts` · `src/plugins/workflow/main/heavy-runtime.ts` · `src/plugins/workflow/main/turn-work.ts`
- modify `src/plugins/workflow/contract.ts` · `src/plugins/workflow/flow.ts` · `src/plugins/workflow/stage-list.ts`
- modify `src/plugins/workflow/main/start.ts` · `src/plugins/workflow/main/flow-store.ts` · `src/plugins/workflow/main/agent-signals.ts` · `src/plugins/workflow/main/countdown.ts` · `src/plugins/workflow/main/actions.ts` · `src/plugins/workflow/main/plan-watch.ts` · `src/plugins/workflow/main/selftest-script.ts`
- modify main stages `src/plugins/workflow/stages/index.ts` · `src/plugins/workflow/stages/{closed,idle,plan-ready,review,primer,explore,make}/main.ts`
- modify page readers `src/plugins/workflow/stages/stage-parts.ts` · `src/plugins/workflow/stages/{closed,make,review,fix,plan-ready}/page.ts` · `src/plugins/workflow/page/workflow-view.ts` · `src/plugins/workflow/page/preview.ts`
- test: create `src/plugins/workflow/stages/heavy-state.test.ts` · `src/plugins/workflow/main/turn-work.test.ts`
- test: modify `src/plugins/workflow/flow.test.ts` · `src/plugins/workflow/stage-list.test.ts` · `src/plugins/workflow/main/{start,flow-store,countdown,actions,agent-signals,plan-watch}.test.ts` · `src/plugins/workflow/stages/{main-stages,reported-steps,page-stages}.test.ts` · `src/plugins/workflow/stages/{idle,primer,explore,make,review,plan-ready,closed}/main.test.ts` · `src/plugins/workflow/page/{workflow-view,preview}.test.ts`

Consumes (all tree members):
- `startsSkill`, `reportsStep`, `isBusy`, `IDLE_STAGE`, `MainStage`, `WorkflowSignal` in `src/plugins/workflow/contract.ts`
- `BUILT_IN_MAIN_STAGES` in `src/plugins/workflow/stages/index.ts`
- `PlanProgress`, `PlanTaskLine` in `src/plugins/workflow/plan-reader.ts`
- `AgentEvent`, `MAIN_AGENT_ID` in `src/contracts/agent.ts`
- `callEach` in `src/shared/call-each.ts`

Produces:

In `src/plugins/workflow/contract.ts`, word for word from plan.md: `WorkflowId`, `ChecklistItem`, `SessionFlow`, `MainWorkflow`, the signal `{ type: 'checklistReported'; items: readonly ChecklistItem[] }`, and `MainStage.finishes?: boolean`. Added for task 05:

```ts
// signal added: { type: 'custom'; event: unknown }
// signals removed from the union: planChanged, planGone, handedOff, dismissed
// MainStage loses: autoCommand, clearsPlan, recordsReviewRounds
export type SignalOrigin = 'live' | 'replay' | 'observed';
export interface FoldEvent {
  sessionId: string;
  before: SessionFlow;
  after: SessionFlow;
  signal: WorkflowSignal;
  origin: SignalOrigin;
  whole: boolean;   // false: a replayed event at or before savedAt, running state only
}
export interface WorkflowObserver {
  folded(event: FoldEvent): void;      // after every apply, also when the flow did not change
  opened(flow: SessionFlow): void;     // after the store opened the session's flow
  closed(sessionId: string): void;     // the session ended, or forgetFlows forgot it
  replaying(sessionId: string): void;  // a replayed agent event arrived, before its signals fold
}
export interface WorkflowSelfTestHooks {  // moved from main/start.ts, members unchanged
  forgetFlows(projectDir: string): void;
  onMainTurnEnded(listener: (sessionId: string) => void): Disposable;
  callStepTool(sessionId: string, step: string): void;
}
export interface WorkflowMainExports {
  addWorkflow(workflow: MainWorkflow): Disposable;
  ready: Promise<void>;                  // the load of flows.json settled
  signal(sessionId: string, signal: WorkflowSignal, origin: 'live' | 'observed'): void;
  flowOf(sessionId: string): SessionFlow | null;
  flows(): readonly SessionFlow[];
  setState(sessionId: string, state: unknown): void;  // no fold; keeps savedAt; sends flows
  observe(observer: WorkflowObserver): Disposable;
  layoutTypes: string;                   // the engine's layout.d.ts, raw
  selfTestHooks: WorkflowSelfTestHooks | null;
}
```

In `src/plugins/workflow/flow.ts`:
- `newFlow(sessionId: string, projectDir: string): SessionFlow`
- `foldFlow(flow: SessionFlow, signal: WorkflowSignal, workflows: readonly MainWorkflow[]): SessionFlow`
- `foldRunningState(flow: SessionFlow, signal: WorkflowSignal): SessionFlow`
- `markMissedLevel(flow: SessionFlow): SessionFlow`
- `isPlanFile` and `planDirOf` leave this file.

In `src/plugins/workflow/stages/heavy-contract.ts`. Task 05 moves this file's members to `workflow-heavy/contract.ts`, word for word:
- `HEAVY_WORKFLOW_ID`, value `'workflow-heavy'`
- `interface HeavyState { planDir: string | null; progress: PlanProgress | null; reviewRoundsAtMake: number | null; countdownEndsAt: number | null }`
- `EMPTY_HEAVY_STATE: HeavyState`
- `heavyStateOf(flow: SessionFlow): HeavyState`
- `withHeavyState(flow: SessionFlow, patch: Partial<HeavyState>): SessionFlow`
- `type HeavyEvent = { type: 'planChanged'; progress: PlanProgress } | { type: 'planGone' } | { type: 'handedOff' } | { type: 'dismissed' }`
- `heavySignal(event: HeavyEvent): WorkflowSignal`
- `heavyEventOf(signal: WorkflowSignal): HeavyEvent | null`
- `interface HeavyMainStage extends MainStage { autoCommand?: string; clearsPlan?: boolean; recordsReviewRounds?: boolean }`

In `src/plugins/workflow/stages/heavy-state.ts`. Task 05 moves this file to `workflow-heavy/heavy-state.ts`:
- `isPlanFile(path: string): boolean`, `planDirOf(path: string): string`
- `foldHeavyState(flow: SessionFlow, signal: WorkflowSignal): unknown`
- `sameHeavyState(a: unknown, b: unknown): boolean`

In `src/plugins/workflow/stages/heavy-workflow.ts`. Task 05 moves it to `workflow-heavy/heavy-workflow.ts`: `heavyMainWorkflow: MainWorkflow`.

In `src/plugins/workflow/main/heavy-runtime.ts`. Task 05 moves its body to `workflow-heavy/main/start.ts` and deletes it:
- `startHeavyRuntime(deps: HeavyRuntimeDeps): { run(sessionId: string, command: string): Promise<boolean>; cancelCountdown(sessionId: string): void; dispose(): void }`
- `interface HeavyRuntimeDeps { workflow: Pick<WorkflowMainExports, 'signal' | 'flowOf' | 'flows' | 'setState' | 'observe' | 'ready'>; chat: Pick<ChatMainExports, 'send' | 'clear' | 'launch' | 'profileOf'>; label(sessionId: string): string | null; files: Files; timers: Timers; clock: Clock; log: PluginLog; paths: Paths; settings(): { autoClearAndMake: boolean; autoStartSeconds: number } }`
- The settings log and its cancel stay in `main/start.ts`'s `onSettingsChanged` until task 05, through `workflow.flows()` and a `cancelCountdown` member of the returned object.

In `src/plugins/workflow/main/turn-work.ts`: `interface TurnWork { note(sessionId: string, event: AgentEvent): void; worked(sessionId: string): boolean; forget(sessionId: string): void }` and `createTurnWork(): TurnWork`.

In `src/plugins/workflow/main/start.ts`: the exports above. `addStage` of main is gone. `WorkflowSelfTestHooks` leaves this file.

Decisions:

Fold order. `foldFlow` runs these steps, in this order:
1. Copy the flow. Apply the running state as today.
2. On `cleared`, set `missedLevel` to false. `workflow`, `movedUpFrom`, `stage`, `checklist` and `state` stay.
3. Claim. Take the first entry in `workflows` whose `claims(signal)` is true. The caller keeps `workflows` sorted by `order`. If the claimer's id differs from `flow.workflow`, set `movedUpFrom` to `flow.workflow` (null stays null), `workflow` to the claimer's id, `stage` to `firstStage`, `state` to null, `checklist` to null and `missedLevel` to false. If the claimer is the current workflow, change nothing.
4. Find the current workflow: the entry in `workflows` with the id `next.workflow`. With no such entry (null, or a saved id with no plugin), steps 5 to 7 do not run.
5. On `checklistReported`, set `checklist` to `signal.items`. Keep the current array when the items are equal, as `sameProgress` keeps a progress object today.
6. Set `state` to `current.foldState(next, signal)` when the workflow has `foldState`. On a new claim, `foldState` sees `flow.stage === firstStage` and `flow.state === null`.
7. Ask each entry of `current.stages`, in array order. The first non-null `enter` answer sets `stage`. Stage rules of any other workflow never run.
8. Compare with `sameFlow`. It adds `workflow`, `movedUpFrom`, `checklist` (by reference), `missedLevel`, and `state` through `current.sameState` when present, else by reference. It drops the plan and countdown fields.

A replayed signal past the flow's save time folds through `foldFlow`, so it claims. A replayed signal at or before the save time takes `foldRunningState`, so it does not claim.

The "stepFold" of the brief. The tree holds no symbol of this name. This task reads it as the fold of `stepReported`: step 7 runs it with the current workflow's rules only, so a `stepReported` on a flow with a null workflow changes nothing. Task 03 maps the tool's `step` value to a stage of the current workflow.

Signals. The engine holds no plan word. `planChanged`, `planGone`, `handedOff` and `dismissed` leave `WorkflowSignal`. `heavySignal` wraps a `HeavyEvent` in `{ type: 'custom', event }`. `heavyEventOf` returns the event of a `custom` signal whose `event` has one of those four `type` values, else null. The rules `closed`, `idle`, `plan-ready` and `review` read them through `heavyEventOf`, and no rule condition changes in any other way. `plan-watch.ts`'s two signals and `actions.ts`'s two signals go through `heavySignal`. `applyBookkeeping` of `flow.ts` keeps only the running state and `checklistReported`.

`signalOf`. `fileWritten` goes out for every agent's write, because the engine has no `isPlanFile`. The `agent-signals.test.ts` row `a subagent's fileWritten of another file gives nothing` now expects the signal. `foldHeavyState` ignores a path that is no plan, so a Heavy flow does not change on it.

Heavy until task 05. Heavy registers through `addWorkflow`, from a definition inside the workflow folder, and its running parts become one observer. So every later move is a move of whole files:
- `main/start.ts` replaces its `for` over `BUILT_IN_MAIN_STAGES` with `addWorkflow(heavyMainWorkflow)`, then calls `startHeavyRuntime` with its own exports. `dispose` calls the runtime's `dispose`.
- `heavyMainWorkflow` holds: `id` `HEAVY_WORKFLOW_ID`, `order` 30, `firstStage` `'explore'`, `stages` `BUILT_IN_MAIN_STAGES`, `foldState` `foldHeavyState`, `sameState` `sameHeavyState`.
- `BUILT_IN_MAIN_STAGES` is typed `readonly HeavyMainStage[]`. `primer`, `explore`, `make` and `plan-ready` are typed `HeavyMainStage`.
- `claims` is true when `startsSkill` matches `wigley:feature`, `wigley:feature-primer` or `wigley:make`. `wigley:review` claims nothing.
- `firstStage` `'explore'` matches task 05. Every claiming skill has a stage rule, so step 7 corrects `primer` and `make` in the same fold.
- `WORKFLOW_COMMANDS` and the settings stay in `workflow/manifest.ts` until task 05. The channel `runAction` stays on `WorkflowChannel`, and `main/start.ts` handles it by `ready`, then `runtime.run`.

`foldHeavyState(flow, signal)`. It takes all plan bookkeeping out of `flow.ts`, with the same rules:
1. Read `heavyStateOf(flow)`. On `turnStarted` and `cleared` set `countdownEndsAt` to null. On `fileWritten` of a plan file, and on a `wigley:make` start whose `argsPath` names a plan, run today's `setPlanDir`. On a `planChanged` event run today's progress step and fill a null `reviewRoundsAtMake`.
2. Ask `BUILT_IN_MAIN_STAGES` in order, with `{ ...flow, state: <that state> }`. Take the first non-null answer. `foldFlow` step 7 gets the same answer: the rules that clear state (`idle`, `primer`, `explore`, `make`) read no state for the signals these effects follow.
3. Apply today's `applyStageRules` effects to the state, comparing the answer with `flow.stage`. A different stage sets `countdownEndsAt` to null. Entering `IDLE_STAGE` clears `planDir` and `progress`. A `clearsPlan` stage on a `skillStarted` clears both. A `recordsReviewRounds` stage sets `reviewRoundsAtMake` to `progress?.reviewRounds ?? null`.
4. Return `flow.state` itself when `sameHeavyState(heavyStateOf(flow), next)` is true. Otherwise return `next`.

`sameHeavyState` compares `planDir`, `reviewRoundsAtMake`, `countdownEndsAt` and the `progress` reference, each through `heavyStateOf`'s shape check of its argument.

`heavyStateOf`. It returns `flow.state` itself when the shape is valid. It returns `EMPTY_HEAVY_STATE` for null or a bad shape. It does not read `flow.workflow`. `isPlanProgress` and `isPlanTaskLine` move from `flow-store.ts` to `heavy-contract.ts`.

`startHeavyRuntime`. It holds `createPlanWatch`, `createCountdown`, `createWorkflowActions`, the set `replayedTurnEnds`, and today's `cancelCountdown` and `fireCountdown`, with their bodies and log texts unchanged. Each write goes through `workflow.setState`, which keeps `savedAt`, as `putKeepingSavedAt` does today. It calls `workflow.observe` once. The observer does what `05-workflow-heavy.md` pins, in that order:
- `folded`, for a flow whose `after.workflow` is `HEAVY_WORKFLOW_ID`:
  1. A `replay` `turnEnded` adds the session to `replayedTurnEnds`. A `live` `turnStarted` or `turnEnded` deletes it. This step also runs when `whole` is false.
  2. When `whole` is true and the signal is `turnEnded`, call `planWatch.check`.
  3. When `whole` is true and the signal is `fileWritten` of a plan file, call `planWatch.follow(sessionId, after planDir)`.
  4. When `whole` is true and `planDir` changed, call `planWatch.follow`.
  5. Start the countdown when all of these hold: `origin` is not `replay`; the session is not in `replayedTurnEnds`; `after.stage` differs from `before.stage`; the entered stage has `autoCommand`; `countdownEndsAt` is null; `autoClearAndMake` is on. `countdownEndsAt` is `clock.now() + Math.max(1, autoStartSeconds) * 1000`.
  6. Call `countdown.sync` with the flow as it is now.
- `folded`, when `before.workflow` is `HEAVY_WORKFLOW_ID` and `after.workflow` is not: call `planWatch.follow(sessionId, null)`, `countdown.stop`, and delete the session from `replayedTurnEnds`.
- `opened`: call `planWatch.follow` with the flow's `planDir`. When a saved `countdownEndsAt` is not null, clear it through `setState`. `flow-store.load` no longer can, since the store does not read `state`.
- `closed`: call `countdown.stop`, `planWatch.follow(sessionId, null)`, and delete the session from `replayedTurnEnds`.
- `replaying`: clear a running countdown through `setState`.

A countdown now reaches the page in a second `flows` push, after the fold's push, in the same tick. No test of today's reads the push between them. Assert on the last push.

Engine `apply`. It keeps its name and its null-flow return. It holds `store`, `putFlow`, `sendFlows` and `foldFlow` over `workflows.all()`. It no longer touches `planWatch` or `countdown`. It calls `folded` on every observer, through `callEach`, after any put and send, with `whole` true, also when the flow did not change. `applyReplayed` keeps its `savedAt` test. Its running-state branch calls `folded` with `whole` false and `origin` `'replay'`. In `chat.agentEvent`, a replayed event calls `replaying` on every observer before `signalOf`. `chat.sessionOpened` calls `opened` before `sendFlows`. `sessions.ended` and `forgetFlows` call `closed`. `exports.signal` calls `apply`. `SignalOrigin`'s `'observed'` is today's `'planRead'`: it does not stamp `savedAt`. `exports.setState` returns on a null flow, else calls `store.putKeepingSavedAt({ ...flow, state })` and `sendFlows`. `exports.flows` is `store.all`. `exports.selfTestHooks` is the object today's `start` builds when `services.selfTest` is not null, else null. `exports.layoutTypes` is the `?raw` import.

`withHeavyState` and mechanical reads. Each `flow.planDir`, `flow.progress`, `flow.reviewRoundsAtMake` and `flow.countdownEndsAt` in the files listed above reads through `heavyStateOf(flow)`. This covers `Countdown.sync`, `requirePlanDir`, and the page stages, the view and the preview, so the tree compiles at this commit. Task 02 removes the view's reads. `previewFlow` sets `workflow` `HEAVY_WORKFLOW_ID`, `movedUpFrom` null, `checklist` null, `missedLevel` false, and `state` with `reviewRoundsAtMake` null. These modules stay at their paths, so task 05 can move them whole.

`missedLevel`. The fold stays pure and has no live or replay input, so `main/start.ts` sets the flag.
- `createTurnWork` holds, per session, `worked` and `afterCompaction`, both false at first. `note` applies these rules. `turnStarted` sets both false. `compactionEnded` sets `afterCompaction` true. A `toolStarted` with `agentId` `MAIN_AGENT_ID` sets `worked` true. A `usage` with `agentId` `MAIN_AGENT_ID` sets `afterCompaction` false when it was true, and otherwise sets `worked` true. Every other event changes nothing.
- The reason for `usage`: a session that only answers calls no tool, but `usage` goes out for its reply. A local command's turn repeats the last usage, and the adapter drops a repeat. The first `usage` after a compaction carries the after-size of a `/compact`, not a reply.
- In the `chat.agentEvent` listener, each event with `replayed` false goes to `note`, before its signals fold. A replayed event does not go to `note`.
- After a live `turnEnded` signal is applied, and before the turn-ended listeners run: when `worked(sessionId)` is true, read the flow and take `markMissedLevel(flow)`. If that is a new flow, call `putFlow(next, 'live')`.
- `markMissedLevel` returns a copy with `missedLevel` true when `workflow` is null and `missedLevel` is false. Otherwise it returns `flow`.
- A `turnEnded` that `signalOf` makes from a `sessionEnded` is a live turn end and takes the same path.
- `sessions.ended` and `forgetFlows` call `forget`.

Flow store. `isSessionFlow` requires: `sessionId`, `projectDir`, `stage` strings; `workflow`, `movedUpFrom` string or null; `checklist` null or an array of `{ text: string, done: boolean }`; `state` present, of any shape; `missedLevel` boolean; `turnRunning` boolean; `runningSubagents` string list. It reads no plan field. A file of the old shape fails it, so the file reads as `flows.json unreadable; starting with no flows`. There is no migration (plan.md). `load` clears `turnRunning` and `runningSubagents`.

`addWorkflow` in main. It adds to one `createStageList<MainWorkflow>()`, which sorts by `order`. It stores a copy whose `stages` is sorted by `order`, equal orders keeping array order. It contributes the step tool again when the workflow has a stage with `reportedAs`, and again on dispose. The step tool's `stages()` dep returns the stages of every workflow, joined in workflow order, until task 03. The engine's `stageOf` is gone: only Heavy read it, through `autoCommand`.

`createStageList` throws `<id> is already added`. The word `stage` leaves the text because the list now also holds workflows.

Heavy keeps, each pinned by a moved test row:
- A subagent's write of `plan-<x>/plan.md` names the plan.
- `wigley:make` with a plan path sets `planDir`. A new folder drops `progress` and `reviewRoundsAtMake`.
- `wigley:make` with no argument keeps the plan the flow holds.
- `planChanged` with equal contents keeps the current `progress` object.
- `wigley:feature` and `wigley:feature-primer` starts clear the plan. A reported `explore` does not.
- Entering idle clears `planDir` and `progress`, and leaves `reviewRoundsAtMake`.
- Each make start records the review rounds, a restart in make included.
- A review round lights review only above the recorded rounds.
- `planGone` closes only a read plan, from make, review or fix.
- `countdownEndsAt` goes null on a stage change, `turnStarted` and `cleared`.
- A flow read from `flows.json` runs no countdown.
- A replayed turn end starts no countdown. A replayed event at or before the save time folds running state only.
- A running countdown stops on a replayed event.
- A plan read does not stamp `savedAt`.
- A host change keeps stage and plan.
- `planWatch.check` runs on each `turnEnded`, whether or not a field changed. `planWatch.follow` runs on each plan change and on a plan write after `planGone`.

Dropped rows, with this reason in the commit message: a flow with no `reviewRoundsAtMake` field cannot load, since plan.md gives flow shapes no migration. They are `planChanged fills a reviewRoundsAtMake left out (a flow saved before the field)` in `flow.test.ts`, and `a flow saved before reviewRoundsAtMake counts its rounds from the first read` in `stages/review/main.test.ts`.

Accepted change for a flow that is not yet Heavy: a `plan.md` written while `workflow` is null sets no `planDir`, because no workflow folds the signal. Today it sets `planDir` under idle, which draws nothing. A `wigley:make` that names the folder still sets it. A `wigley:make` with no argument in such a session has no plan. A Heavy flow is not affected: every Heavy session starts with a claiming skill.

Accepted: after Heavy's Dismiss or Make in new session the flow keeps `workflow` `'workflow-heavy'` at idle. No `No workflow` tag draws on it. A later skill of another workflow sets `movedUpFrom` to `'workflow-heavy'`, as plan.md's rule says.

Replay and writes, pinned.
- `applyReplayed`'s running-state branch calls `folded` with `whole` false for every replayed event at or before `savedAt`, whether or not `foldRunningState` changed the flow, because `replayedTurnEnds` must note an unchanged replayed `turnEnded`. It still puts only a changed flow.
- Every write of the Heavy runtime patches `heavyStateOf(workflow.flowOf(id))` through `setState`, then calls `countdown.sync(workflow.flowOf(id))`, so timers always equal `countdownEndsAt`. It reads a fresh flow, not `FoldEvent.after`, because `planWatch.check` and `follow` can signal re-entrantly. This covers `cancelCountdown`, `fireCountdown`, the countdown start, `opened` and `replaying`.
- Each of those paths acts only when `flow.workflow === HEAVY_WORKFLOW_ID` and `countdownEndsAt` is not null, so it never writes Heavy state over another workflow's.
- `foldFlow` step 6 and `setState` turn an `undefined` state into `null`, because JSON drops `undefined` and the next load would drop every flow.
- `newFlow` gives `stage` `IDLE_STAGE`, `workflow`, `movedUpFrom`, `checklist` and `state` null, `missedLevel` and `turnRunning` false, `runningSubagents` `[]`.

GIVEN a new flow WHEN `wigley:light` starts THEN `workflow` is the claimer, `stage` is its `firstStage`, and `movedUpFrom` is null.
GIVEN a Light flow with a checklist WHEN `wigley:medium` starts THEN `movedUpFrom` is `'light'`, `state` and `checklist` are null, and `stage` is Medium's first stage.
GIVEN a Medium flow WHEN a `stepReported` names a stage id that Light also holds THEN only Medium's rule runs.
GIVEN a null workflow WHEN a live turn with agent work ends THEN `missedLevel` is true and the page gets the flow.
GIVEN a null workflow WHEN a turn with no agent work ends, or a replayed turn ends THEN `missedLevel` stays false.
GIVEN `missedLevel` true WHEN a claiming skill starts or `cleared` folds THEN `missedLevel` is false.
GIVEN a replayed event at or before `savedAt` WHEN it arrives THEN the observer's `folded` gets `whole` false, and only running state changes.
GIVEN a Heavy flow WHEN any signal of the moved rows folds THEN the stage, plan fields and countdown equal today's result.

Tests:
- `flow.test.ts` `foldFlow_Workflows` table, with stub workflows `light` (order 10, claims `wigley:light`, `firstStage` `'scope'`, stage `build`) and `medium` (order 20, claims `wigley:medium`, `firstStage` `'interview'`, stage `build`):
  | flow | signal | expected |
  |---|---|---|
  | new, `missedLevel` true | skill `wigley:light` | `workflow` `'light'`, `stage` `'scope'`, `movedUpFrom` null, `missedLevel` false |
  | light at `build`, checklist `[{text:'a',done:true}]`, state `{n:1}` | skill `wigley:medium` | `workflow` `'medium'`, `stage` `'interview'`, `movedUpFrom` `'light'`, `state` null, `checklist` null |
  | light at `build` | skill `wigley:light` | the same flow object |
  | light at `build` | skill `wigley:review` | the same flow object |
  | new | `stepReported` `build` | the same flow object |
  | medium at `interview` | `stepReported` `build` | `stage` `'build'`; the `enter` spy of light has 0 calls |
  | light | `checklistReported` `[{text:'a',done:false}]` | `checklist` equals those items |
  | light, checklist `[{text:'a',done:false}]` | `checklistReported` of an equal array | the same flow object |
  | new | `checklistReported` `[{text:'a',done:false}]` | the same flow object |
  | light, `missedLevel` true, state `{n:1}` | `cleared` | `workflow` `'light'`, `stage` and `state` unchanged, `missedLevel` false |
  | `workflow` `'gone'` at `build` | `turnStarted` | `turnRunning` true, `stage` `'build'` |
- `flow.test.ts` `foldFlow_FoldState`: a stub `foldState` returning `{n:2}` runs before the stage rules (a rule that reads `state.n` answers `'b'` only when `n` is 2); on a new claim the stub sees `stage` `firstStage` and `state` null; a `sameState` returning true gives the same flow object.
- `flow.test.ts` `foldFlow_Workflows` adds a row: two workflows that both claim a skill give the lower `order`'s id. `foldFlow` adds a row: a `foldState` returning `undefined` gives `state` null.
- `flow.test.ts` `markMissedLevel` table: null workflow and false gives true; null workflow and true gives the same object; `'light'` gives the same object.
- `stages/heavy-state.test.ts`:
  - The bookkeeping rows that `flow.test.ts` holds today move here, with the values they have, run through `foldFlow` over `[heavyMainWorkflow]` and read through `heavyStateOf`. Their `planChanged`, `planGone`, `handedOff` and `dismissed` go through `heavySignal`.
  - `heavyStateOf_BadShape_ReadsEmpty`: state null and `{planDir:3}` give `EMPTY_HEAVY_STATE`; a valid state gives that object.
  - `foldHeavyState_NoChange_ReturnsFlowState`: a `turnEnded` on a flow with state null, and on a flow with a valid state, returns `flow.state` by reference.
  - `heavyEventOf` table: `heavySignal({type:'planGone'})` gives `{type:'planGone'}`; `{type:'custom',event:{type:'other'}}` gives null; `{type:'turnEnded'}` gives null.
- `stages/reported-steps.test.ts` and `stages/main-stages.test.ts`: the rows keep their values, with flows of `workflow` `'workflow-heavy'` and `foldFlow` over `[heavyMainWorkflow]`. New row: a new flow plus skill `wigley:feature` gives `workflow` `'workflow-heavy'`, `stage` `'explore'`, `movedUpFrom` null. New row: `wigley:make /r/plan-f` gives `stage` `'make'`, `heavyStateOf(...).planDir` `'/r/plan-f'`.
- `main/agent-signals.test.ts`: the row `a subagent's fileWritten of another file gives nothing` becomes `a subagent's fileWritten gives its path`, expecting `[{type:'fileWritten',path}]`.
- `main/turn-work.test.ts` table, events in order, expected `worked`: `turnStarted, usage(main)` true; `turnStarted, toolStarted(main)` true; `turnStarted` false; `turnStarted, usage('sub-1')` false; `turnStarted, toolStarted('sub-1')` false; `turnStarted, compactionEnded, usage(main)` false; `turnStarted, compactionEnded, usage(main), usage(main)` true; `turnStarted, usage(main), turnStarted` false.
- `main/start.test.ts`:
  - `MissedLevel_LiveTurnWithWork_SetsAndPushes`: a live `turnStarted`, `usage`, `turnEnded` on a new flow gives `missedLevel` true in the last `flows` push.
  - `MissedLevel_LiveTurnWithNoWork_StaysFalse`: `turnStarted`, `turnEnded` gives false.
  - `MissedLevel_ReplayedTurn_StaysFalse`: the three events with `replayed` true give false.
  - `MissedLevel_ClaimedInTurn_StaysFalse`: `turnStarted`, skill `wigley:feature`, `usage`, `turnEnded` gives false and `workflow` `'workflow-heavy'`.
  - `Observer_Folded` table: a live signal that changes nothing calls `folded` with `before` equal to `after`, `origin` `'live'`, `whole` true; a replayed event past `savedAt` gives `origin` `'replay'`, `whole` true; a replayed event at `savedAt` gives `origin` `'replay'`, `whole` false.
  - `Observer_Folded` adds a row: a replayed `turnEnded` at `savedAt` over a flow with `turnRunning` false still calls `folded`, `whole` false.
  - `Countdown_CancelStopsTheTimer`: `cancelCountdown` on a running countdown leaves 0 live timers. `cancelCountdown` on a stub workflow's flow leaves its `state` the same object.
  - `MissedLevel_SessionEnded_Sets`: `turnStarted`, `usage`, `sessionEnded` on a null workflow gives `missedLevel` true. `TurnWork_ForgottenOnEnd`: after `sessions.ended` and `forgetFlows`, a later turn with no work gives `missedLevel` false.
  - `Observer_Members`: `opened` gets the flow on `chat.sessionOpened`; `closed` gets the id on `sessions.ended` and on `forgetFlows`; `replaying` gets the id before `folded` for a replayed event.
  - `Exports_SetState_KeepsSavedAtAndSends`: `setState('s1',{n:1})` gives `flowOf('s1').state` `{n:1}`, `savedAtOf` unchanged, one `flows` push, and no `folded` call.
  - `Exports_Signal_ObservedKeepsSavedAt`: origin `'observed'` leaves `savedAtOf` unchanged; `'live'` stamps it.
  - `Open_SavedCountdown_RunsNone`: a saved Heavy state with `countdownEndsAt` 9000 opens with `countdownEndsAt` null, `savedAtOf` unchanged, and 0 live timers.
  - `FlowLeavingHeavy_StopsItsWatchAndCountdown`: a running countdown, then a stub workflow's claim, leaves 0 live timers.
  - The rows `exports_ConsumerDisposed_FreesTheStageId`, `stepTool_StageAddedByAPlugin_JoinsTheToolUntilDisposed` and `savedFlowInAStageNoLongerRegistered_OpensAndFoldsWithoutThrowing` stay here, reworked to `addWorkflow`: a disposed stub's id can be added again; a stub's `reportedAs` joins the tool until disposed; a saved stage the workflow does not hold opens and folds with no throw.
  - Every other existing row keeps its values through `heavyStateOf`, and asserts on the last `flows` push.
- `main/flow-store.test.ts` `Load_InvalidFlow_DropsAll` table of one bad field each: `workflow: 7`, `movedUpFrom: 7`, `checklist: [{text:1,done:true}]`, `missedLevel: 'x'`, `state` left out, and the old shape `{planDir:null,progress:null,countdownEndsAt:null}` with no `workflow`. Each gives no flows and the log line `flows.json unreadable; starting with no flows`. `Load_ValidFlow_RoundTrips`: `workflow` `'light'`, `state` `{n:1}`, `checklist` `[{text:'a',done:true}]` opens with those values, `turnRunning` false and `runningSubagents` `[]`. A row that holds `state` `{planDir:3}` loads with that value: the store does not check it.
- `stage-list.test.ts`: the duplicate row expects `build is already added`.
- `main/{countdown,actions,plan-watch}.test.ts`, the `stages/*/main.test.ts` files, `stages/page-stages.test.ts`, `page/workflow-view.test.ts` and `page/preview.test.ts` keep their rows and values, with flows built through a Heavy state and events through `heavySignal`.

Done when: compiles; `scripts/check-layers.mts` passes; the test gate runs the tests above. A runtime check of a Heavy run belongs to task 12.
Commit: one commit for the group.

## Proof

Commit a5b319c0 · proof: diff read against the spec; every Produces present; typecheck and lint clean · concerns: TurnWork.worked survives cleared, so a sessionEnded right after a clear on a null workflow re-marks missedLevel; private isRecord copies in heavy-contract; check-layers still allows contract to import plan-reader; step-tool enum may repeat a value until task 03; a self-test hello turn sets missedLevel until the skill claims
