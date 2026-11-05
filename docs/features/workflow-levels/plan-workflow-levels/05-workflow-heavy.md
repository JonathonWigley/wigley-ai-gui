# 05 — workflow-heavy

Status: not started
Type: Batch
Wave: 5 · Depends on: 02, 04
Plan: [plan.md](plan.md)

All paths are relative to the wigley-ai-gui repo root. Move each file with `git mv`, so its history stays.

One group, because the tree does not compile with only one half: the commands, the channel and the settings change owner together. Heavy's behaviour does not change in this group, and the engine holds no plan word after it.

## Main half

Files:
- create `src/plugins/workflow-heavy/manifest.ts`, `src/plugins/workflow-heavy/main/start.ts`, `src/plugins/workflow-heavy/layouts/layout.d.ts` if the layer or compile check asks for it
- move what 01 and 02 left in the engine, each under the name the Produces below gives: `workflow/stages/heavy-contract.ts` → `workflow-heavy/contract.ts`; `workflow/stages/heavy-state.ts` and its test → `workflow-heavy/heavy-state.ts`; `workflow/stages/heavy-workflow.ts` → `workflow-heavy/heavy-workflow.ts`
- move the body of `workflow/main/heavy-runtime.ts` into `workflow-heavy/main/start.ts`, then delete the file
- modify `src/plugins/workflow/main/start.ts`: drop `addWorkflow(heavyMainWorkflow)`, `startHeavyRuntime`, the settings log and its cancel, the `runAction` handler
- modify `src/plugins/workflow/manifest.ts`: drop the seven commands, `autoClearAndMake`, `autoStartSeconds`, `layout` and the temporary token `badge`, inline `mainAction` (label `run the stage's next step`, `group: 'workflow'`, `runsIn: 'page'`) now that `stages/index.ts` goes, and drop `docs` from `dependsOn.page`
- modify `src/plugins/workflow/contract.ts`: `WorkflowChannel` loses `runAction`
- move from `src/plugins/workflow/` to `src/plugins/workflow-heavy/`: `plan-reader.ts`, `plan-reader.test.ts`, `main/plan-watch.ts`, `main/plan-watch.test.ts`, `main/actions.ts`, `main/actions.test.ts`, `main/countdown.ts`, `main/countdown.test.ts`, `stages/feature-run.ts`, `stages/main-stages.test.ts`, `stages/reported-steps.test.ts`, `stages/<id>/main.ts` and every `stages/<id>/main.test.ts`, for `<id>` in `idle`, `primer`, `explore`, `interview`, `plan`, `cold-read`, `plan-ready`, `make`, `review`, `fix`, `closed`
- create `src/plugins/workflow-heavy/stages/index.ts`: main and page halves and commands
- delete `src/plugins/workflow/stages/index.ts`
- modify `src/plugins/manifests.ts`, `src/plugins/main.ts`: add the plugin
- modify `scripts/check-layers.mts`: the layer rules
- modify `src/main/drive/drive-commands.ts`: the help text and comment that name `workflow.autoStartSeconds` read `workflow-heavy.autoStartSeconds`
- test `src/plugins/workflow-heavy-main.test.ts` (create), `src/plugins/workflow-heavy/heavy-workflow.test.ts` (create), and the moved `src/plugins/workflow-heavy/heavy-state.test.ts`. Each receives moved rows and new rows, and the Heavy rows 01 added to `workflow/main/start.test.ts` move too (`Open_SavedCountdown_RunsNone`, `FlowLeavingHeavy_StopsItsWatchAndCountdown`). The Tests field names them.

Consumes:
- From plan.md, word for word: `MainWorkflow`, `WorkflowMainExports.addWorkflow`, `SessionFlow.state`, `SessionFlow.workflow`, `MainStage.finishes` ← 01
- Run log reads `MainWorkflow.fixCycles` ← 04
- Scoped step tool reads each workflow's `reportedAs` ← 03
- In `src/plugins/workflow/contract.ts` ← 01:

  ```ts
  // signal added: { type: 'custom'; event: unknown }
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
  // WorkflowMainExports adds:
  ready: Promise<void>;                  // the load of flows.json settled
  signal(sessionId: string, signal: WorkflowSignal, origin: 'live' | 'observed'): void;
  flowOf(sessionId: string): SessionFlow | null;
  flows(): readonly SessionFlow[];
  setState(sessionId: string, state: unknown): void;  // no fold; keeps savedAt; sends flows
  observe(observer: WorkflowObserver): Disposable;
  layoutTypes: string;                   // the engine's layout.d.ts, raw
  ```

- Engine rules ← 01:
  - `foldFlow` applies running state, then the claim, then `foldState`, then the current workflow's stage rules.
  - `foldState` sees `flow.stage === firstStage` and `flow.state === null` on a new claim.
  - `cleared` keeps `workflow`, `stage` and `state`.
  - `signalOf` gives `fileWritten` for every agent's write. The engine has no plan concept, so it cannot keep `isPlanFile`.
  - The store keeps `state` as it is and does not check its shape.
- Tree members: `chatMainKey`, `ChatMainExports` (`send`, `clear`, `launch`, `profileOf`) in `src/plugins/chat/contract.ts`; `sessionsMainKey`, `label` in `src/plugins/sessions/contract.ts`; `isBusy`, `startsSkill`, `reportsStep`, `IDLE_STAGE` in `src/plugins/workflow/contract.ts`.

Produces:
- `export const workflowHeavyManifest` in `workflow-heavy/manifest.ts`
- `export const workflowHeavyMainPart: MainPart<typeof workflowHeavyManifest>` in `workflow-heavy/main/start.ts`
- In `workflow-heavy/contract.ts`:

  ```ts
  export const HEAVY_WORKFLOW_ID = 'workflow-heavy';
  export interface HeavyState {
    planDir: string | null;
    progress: PlanProgress | null;
    reviewRoundsAtMake: number | null;
    countdownEndsAt: number | null;
  }
  export const EMPTY_HEAVY_STATE: HeavyState;
  export function heavyStateOf(flow: SessionFlow): HeavyState;
  export function withHeavyState(flow: SessionFlow, patch: Partial<HeavyState>): SessionFlow;
  export type HeavyEvent =
    | { type: 'planChanged'; progress: PlanProgress }
    | { type: 'planGone' }
    | { type: 'handedOff' }
    | { type: 'dismissed' };
  export function heavySignal(event: HeavyEvent): WorkflowSignal;
  export function heavyEventOf(signal: WorkflowSignal): HeavyEvent | null;
  export interface HeavyMainStage extends MainStage {
    autoCommand?: string;
    clearsPlan?: boolean;
    recordsReviewRounds?: boolean;
  }
  export interface HeavyActionRequest { sessionId: string; command: string }
  export interface WorkflowHeavyChannel extends ChannelShape {
    invoke: { runAction(request: HeavyActionRequest): Promise<void> };
    messages: Record<never, never>;
  }
  ```

- In `workflow-heavy/heavy-state.ts`: `isPlanFile(path: string): boolean`, `planDirOf(path: string): string`, `foldHeavyState(flow: SessionFlow, signal: WorkflowSignal): unknown`, `sameHeavyState(a: unknown, b: unknown): boolean`, `heavyFixCycles(flow: SessionFlow): number`
- In `workflow-heavy/heavy-workflow.ts`: `export const heavyMainWorkflow: MainWorkflow`
- In `workflow-heavy/stages/index.ts`: `export const HEAVY_MAIN_STAGES: readonly HeavyMainStage[]`, `export const HEAVY_COMMANDS`

Decisions:
- **Manifest.**
  - `id` is `workflow-heavy`.
  - `dependsOn.main` is `['workflow', 'chat', 'sessions']`. `dependsOn.page` is `['workflow', 'sessions', 'docs']`.
  - `commands` is `HEAVY_COMMANDS`: `clearAndMake`, `cancelCountdown`, `makeInNewSession`, `resumeMake`, `openPlan`, `retro`, `dismiss`. Each keeps today's `label`, `group: 'workflow'` and `runsIn: 'page'`.
  - `settings` is `{ layout: 'default', autoClearAndMake: false, autoStartSeconds: 10 }`.
  - `settingInfo` keeps today's two auto-start entries word for word. The `layout` label is `Heavy workflow layout`. Its description is `The layout that draws Heavy's status chip, composer strip and side pane: a folder in the layouts/workflow-heavy folder, or default.`
  - `themeTokens` is `{ badge: { kind: 'color', default: 'var(--wg-status-warning)' } }`.
- **Workflow.** `heavyMainWorkflow` has `id: 'workflow-heavy'`, `order: 30`, `firstStage: 'explore'`, `stages: HEAVY_MAIN_STAGES`, `foldState: foldHeavyState`, `sameState: sameHeavyState`, `fixCycles: heavyFixCycles`.
- **Claims.** `claims` is true when `startsSkill` matches `wigley:feature`, `wigley:feature-primer` or `wigley:make`. `startsSkill` keeps the bare names.
- **Stage modules.** Each keeps its `id`, `order` and `reportedAs`. Orders: idle 0, primer 10, explore 20, interview 22, plan 24, coldRead 26, planReady 30, make 40, review 50, fix 55, closed 60. `reportedAs`: `explore`, `interview`, `plan`, `cold_read`, `fix`. `planReady` keeps `autoCommand: 'clearAndMake'`. `explore` and `primer` keep `clearsPlan: true`. `make` keeps `recordsReviewRounds: true`. `closed` keeps the `finishes: true` 04 gave it.
- **State reads.** A rule reads `flow.progress`, `flow.planDir` and `flow.reviewRoundsAtMake` through `heavyStateOf(flow)`. A rule reads `planChanged`, `planGone`, `handedOff` and `dismissed` through `heavyEventOf(signal)`. No rule condition changes in any other way.
- **`heavyStateOf`.** It returns `flow.state` itself when the shape is valid. It returns `EMPTY_HEAVY_STATE` for null or a bad shape. 01 already moved `isPlanProgress` and `isPlanTaskLine` into this file.
- **`foldHeavyState` order.** The stage-entry effects need the stage the rules choose, and plan.md pins `foldState(flow, signal)` as one call before the rules. So `foldHeavyState` works in three steps:
  1. It applies today's `applyBookkeeping` to a copy of the state. `turnStarted` and `cleared` set `countdownEndsAt` to null. `fileWritten` of a plan file calls `setPlanDir`. `wigley:make` with a plan path in `argsPath` calls `setPlanDir`. `planChanged` keeps an equal `progress` object and fills a null `reviewRoundsAtMake`.
  2. It runs `HEAVY_MAIN_STAGES` in order over the flow with that state. The first non-null answer is the entered stage, and the search stops there.
  3. It applies the effects of that answer. When the entered id differs from `flow.stage`, `countdownEndsAt` becomes null, and entering `idle` clears `planDir` and `progress`. A `clearsPlan` stage entered by `skillStarted` clears `planDir` and `progress`. A `recordsReviewRounds` stage sets `reviewRoundsAtMake` to `progress?.reviewRounds ?? null`.
- **Second rule pass.** The engine runs the rules again after `foldState`. The answers do not change, because `idle`, `primer`, `explore` and `make` read no plan field for the signals these effects follow.
- **No-change return.** `foldHeavyState` returns `flow.state` itself when `sameHeavyState(heavyStateOf(flow), next)` is true. `sameHeavyState` compares `planDir`, `reviewRoundsAtMake`, `countdownEndsAt` and the `progress` reference, as `sameFlow` does today.
- **`heavyFixCycles`.** It returns `progress?.reviewRounds ?? 0`. `planGone` keeps `progress`, so the value survives to `closed`.
- **Plan watch input.** `main/start.ts` calls `workflow.observe` once. `createPlanWatch` keeps its interface. Its `signal` dep calls `workflow.signal(sessionId, heavySignal(event), 'observed')`, so a plan read does not stamp `savedAt`, as `planRead` does today. Its `planChanged` and `planGone` signals go through `heavySignal`.
- **`folded` handler.** In this order, for a flow whose `after.workflow` is `workflow-heavy`:
  1. Note the turn boundary, as `noteTurnBoundary` does today. A `replay` `turnEnded` adds the session to `replayedTurnEnds`. A `live` `turnStarted` or `turnEnded` deletes it. This step also runs when `whole` is false.
  2. When `whole` is true and the signal is `turnEnded`, call `planWatch.check`.
  3. When `whole` is true and the signal is `fileWritten` of a plan file, call `planWatch.follow(sessionId, after planDir)`. This reopens a watch that `planGone` closed.
  4. When `whole` is true and `planDir` changed, call `planWatch.follow`.
  5. Start the countdown when all of these hold: `origin` is not `replay`, the session is not in `replayedTurnEnds`, `after.stage` differs from `before.stage`, the entered stage has `autoCommand`, `countdownEndsAt` is null and `autoClearAndMake` is on. `countdownEndsAt` is `clock.now() + Math.max(1, autoStartSeconds) * 1000`. Write it with `workflow.setState`.
  6. Call `countdown.sync` with the flow as it is now.
- **Leaving Heavy.** When `before.workflow` is `workflow-heavy` and `after.workflow` is not, call `planWatch.follow(sessionId, null)`, `countdown.stop` and delete the session from `replayedTurnEnds`.
- **Start with flows held.** Right after `workflow.observe`, walk `workflow.flows()` and run the `opened` body for each flow of this workflow, because a restarted part never hears `opened` for a flow already open.
- **Other observer members.**
  - `opened` calls `planWatch.follow` with the flow's `planDir`, and clears a saved `countdownEndsAt` through `setState`. Today `flow-store.load` clears it.
  - `closed` calls `countdown.stop`, `planWatch.follow(sessionId, null)` and deletes the session from `replayedTurnEnds`.
  - `replaying` clears a running countdown through `setState`.
- **Countdown state.** `cancelCountdown` and `fireCountdown` keep the bodies 01 gave them: each write patches a fresh `flowOf`, goes through `setState`, then calls `countdown.sync`, only for a flow of this workflow with `countdownEndsAt` set. This keeps `savedAt`, as `putKeepingSavedAt` does today. `fireCountdown` logs `ran <command> in <name>` on a run and `auto-start failed: <error>` on a reject. `<name>` is `sessions.label(sessionId)`, else `services.paths.base(projectDir)`.
- **Settings.** `api.onSettingsChanged` logs `settings: autoClearAndMake on|off, autoStartSeconds <n>`, with `n` at least 1. When the setting is off, it cancels every Heavy flow's countdown from `workflow.flows()`. The log prefix becomes `[workflow-heavy]`.
- **Actions.** `createWorkflowActions` keeps its interface and its error texts. `requirePlanDir` reads `heavyStateOf(flow).planDir`. `handedOff` and `dismissed` go through `workflow.signal(sessionId, heavySignal(event), 'live')`. `channel.handle('runAction', …)` waits for `workflow.ready`.
- **Pinned action text.** `/wigley:make <planDir>` goes unquoted. `/wigley:retro`. `The session has no plan`. `The session is not a chat session`. `Unknown workflow command <command>`. `No workflow flow for session <id>`. `clearAndMake`, `resumeMake` and `retro` log and do nothing while `isBusy`.
- **Layout types.** `main/start.ts` calls `api.layouts.register({ layoutTypes: workflow.layoutTypes })`. The user's types file lands in `layouts/workflow-heavy/`.
- **Layer rules.** Add a `workflow-heavy` entry to `PLUGIN_EXTRAS`, with today's `workflow` entry's shape. `HEAVY_SUBLAYERS` is `src/plugins/workflow-heavy/plan-reader.ts` and `src/plugins/workflow-heavy/stages`. `main` also takes `packages: ['node:']`. The `stages` sublayer takes `src/contracts`, `src/plugins/workflow-heavy`, `src/plugins/workflow-heavy/contract.ts`, `src/plugins/workflow-heavy/plan-reader.ts` and `src/plugins/workflow/contract.ts`. Remove `WORKFLOW_SUBLAYERS` and the plan reader and stages entries from `workflow`. Keep `workflow.main.packages: ['node:']` for `agent-signals.ts`.
- **Boundary.** Heavy imports `chat/contract.ts` and `sessions/contract.ts` as well as `workflow/contract.ts`. `layer-rules.mts` allows them through `dependsOn`.
- **No claim, no plan.** A plan write in a flow with `workflow === null` records no plan, since only the current workflow folds its state. Today such a flow holds `planDir` while idle and shows nothing. The only change: `wigley:make` with no argument after such a write shows make with no plan. Every run in today's flows starts with a claiming skill first.
- **Old rows dropped.** A flow with no `reviewRoundsAtMake` field cannot load, since plan.md gives flow shapes no migration. Drop these rows, with this reason in the commit message: `planChanged fills a reviewRoundsAtMake left out (a flow saved before the field)` in `flow.test.ts`, and `a flow saved before reviewRoundsAtMake counts its rounds from the first read` in `stages/review/main.test.ts`.

GIVEN a session with no workflow WHEN `wigley:feature` starts THEN `flow.workflow` is `workflow-heavy`, `stage` is `explore`, and `heavyStateOf(flow)` is empty
GIVEN a feature turn that writes a plan with boxes WHEN the turn ends THEN the stage is `planReady` and, with `autoClearAndMake` on, `countdownEndsAt` is `now + autoStartSeconds * 1000`
GIVEN a running countdown WHEN it ends THEN the session clears and sends `/wigley:make <planDir>`, and the log says `ran clearAndMake in <name>`
GIVEN a subagent writes `/r/plan-a/plan.md` WHEN the engine folds it THEN `planDir` is `/r/plan-a` and the watch reads that folder
GIVEN `wigley:make /r/plan-new` for a folder not written yet WHEN the watch signals `planGone` THEN the stage stays `make`; WHEN `plan.md` is written and later deleted THEN the stage becomes `closed`
GIVEN a replay of a feature turn WHEN it reaches `planReady` THEN no countdown starts, and the plan read that follows the replay starts none; WHEN a live turn ends THEN the countdown starts
GIVEN a replayed event at or before `savedAt` WHEN it arrives THEN only running state changes and `FoldEvent.whole` is false

Tests: every behaviour below keeps its test. A moved test keeps its name and its assertion values. A moved test reads plan fields through `heavyStateOf`. Move the rows of `flow.test.ts` that name plan, progress, rounds or countdown fields into `heavy-state.test.ts`, run through 01's `foldFlow` with `[heavyMainWorkflow]`. Move the rows of `main/start.test.ts` listed below into `src/plugins/workflow-heavy-main.test.ts`. That file starts the real engine part and hands its exports to the heavy part as the `workflow` dependency. Test files under `src/plugins/` may cross plugins, as `agent-form-drive.test.ts` does.

| Behaviour that must survive | Test that pins it |
|---|---|
| Clear & make clears, then sends `/wigley:make <planDir>` | `main/actions.test.ts` row `clearAndMake`; `clearAndMake_ClearRejects_SendsNothingAndRejects` |
| Make in new session launches and signals `handedOff`; the session goes idle and drops its plan | `main/actions.test.ts` row `makeInNewSession`; `stages/idle/main.test.ts` rows `handedOff from make`, `handedOff from planReady`; flow row `returning to idle drops the plan` |
| Resume make runs Clear & make; review waits for a new round | `main/actions.test.ts` row `resumeMake`; `stages/review/main.test.ts` row `Resume make from review waits for a round logged after it` |
| Retro sends `/wigley:retro`; it does nothing while busy | `main/actions.test.ts` rows `retro`, `$command with $busy does nothing` |
| Dismiss returns a closed run to idle, and only a closed run | `stages/idle/main.test.ts` rows `dismissed from closed`, `dismissed from make` |
| Auto-start counts down, runs, logs, and names the session | `featureTurnWritingAPlan_ReachesPlanReady_AndAutoStartsClearAndMake_LoggingTheSessionBy_$name` (`START + 10_000`, `ran clearAndMake in r 2`, `ran clearAndMake in r`) |
| Cancel on a subagent start or the setting turned off | `countdownAfter_RunsNothing ($name)` |
| Replay starts no countdown | `replayedFeatureTurn_ReachesPlanReady_StartsNoCountdown`, `replayBurstOfAFeatureTurn_ItsPlanReadStartsNoCountdown` |
| A live turn end after a replay starts it | `afterAReplay_ALiveTurnEnd_StartsTheCountdown ($name)` |
| A running countdown stops on a replay | the row `an explore flow the open arms before the replay says it runs` in the replay table at `main/start.test.ts:486` |
| Timer per session | `sync_CountingDown_ArmsOneTimerForTheTimeLeft`, `fire_CallsFireOnce_AndTheNextCountdownArmsAgain` |
| Settings log | `settingsChange_LogsTheValuesInUse ($seconds)` (`settings: autoClearAndMake on, autoStartSeconds 3`; seconds 0 logs `autoStartSeconds 1`) |
| Closed on plan gone, in make, review and fix only | `stages/closed/main.test.ts` rows `planGone in make`, `planGone in review`, `planGone in fix`, `planGone in explore`, `planGone in planReady`; `follow_SignalsEachPlanChange_AndPlanGoneOnceWhenDeleted` |
| A turn end checks for a delete the OS missed | `turnEndedChangingNoField_StillChecksThePlan` |
| Review rounds light review only above the recorded count | `stages/review/main.test.ts` rows `planChanged with no review round in make`, `a round logged in fix stays in fix`, `make of an unread plan counts its rounds from the first read`; flow rows `entering a recordsReviewRounds stage records the plan's review rounds`, `re-entering a recordsReviewRounds stage records the rounds again`, `planChanged fills a null reviewRoundsAtMake`, `planChanged keeps a recorded reviewRoundsAtMake` |
| Re-attach replay and `savedAt` | the table at `main/start.test.ts:486`, seven rows, kept with their `saved` and `expected` values in `state`; `stepTool_ReportFromAFeatureRun_MovesTheFlowAndStampsTheSave` |
| A saved flow opens with no countdown | `load_SavedFlowWith_$name_OpensAsSavedWithNoTurnSubagentOrCountdown`: the store keeps its running-state half; the new row `openedFlowWithASavedCountdown_ClearsIt` takes the countdown half |
| A subagent's plan write names the plan | flow rows `fileWritten of a new plan moves planDir and drops progress and reviewRoundsAtMake`, `fileWritten of the same plan keeps progress`, `fileWritten with backslash separators`; the new row below replaces the `agent-signals.test.ts` row `a subagent's fileWritten of a plan.md gives its path` for the heavy half |
| `wigley:make` naming a folder not written yet | `stages/closed/main.test.ts` rows `make of a folder not written yet waits for it`, `make of a folder written after it starts closes once it goes`; `follow_AMissingFolder_SignalsPlanGoneAndMakesNoFolder`; `planFileWrittenAfterPlanGone_ReadsThePlanAgain`; flow rows `wigley:make of a plan folder moves planDir and drops progress`, `make typed by its bare name moves planDir too`, `wigley:make of a plan folder with a trailing separator`, `wigley:make of a plan.md`, `wigley:make of a folder that is no plan changes nothing`, `wigley:make reads argsPath, never args` |
| Plan ready waits for idle and a box | every row of `stages/plan-ready/main.test.ts` |
| Reading the plan | every row of `plan-reader.test.ts`, unchanged |
| Reported steps keep the plan | `back to %s from plan keeps the plan` in `stages/reported-steps.test.ts` |
| Stop leaves nothing live | `stop_LeavesNoLiveRegistration_AndWritesNothing ($state)`, `stopThenStart_StartsAgain` |

Moved with changes: `built-in stage rules name only registered stages` in `stages/main-stages.test.ts` reads `HEAVY_MAIN_STAGES`, and its helper unwraps `heavyEventOf`, so `RULE_ROWS` keep their signal names. These tests stay in the engine under 01 and do not move: `exports_ConsumerDisposed_FreesTheStageId`, `stepTool_StageAddedByAPlugin_JoinsTheToolUntilDisposed`, `savedFlowInAStageNoLongerRegistered_OpensAndFoldsWithoutThrowing`.

Rows 01 and 04 already wrote move here unchanged: `heavyStateOf_BadShape_ReadsEmpty`, `foldHeavyState_NoChange_ReturnsFlowState`, `heavyFixCycles_ReadsTheRounds`, `Open_SavedCountdown_RunsNone`, `FlowLeavingHeavy_StopsItsWatchAndCountdown`.

After this group the engine registers no workflow, and a `workflow/` test may not import `workflow-heavy`. So each existing engine row that names Heavy gets one home:

| Rows | Home |
|---|---|
| `MissedLevel_ClaimedInTurn_StaysFalse`, `StepTool_Heavy`, `RunLog_HeavyClosed`, `RunLog_MovedUp`, `RunLog_OnlyOnEntry`, `Countdown_CancelStopsTheTimer` | move to `workflow-heavy-main.test.ts` |
| `sessionEnded_EndsTheTurnOnlyFromTheCurrentHost`, `stepTool_ReportIsIgnored ($name)`, the running-state half of `load_SavedFlowWith_$name_...`, `stop_LeavesNoLiveRegistration_AndWritesNothing`, `stopThenStart_StartsAgain` in `workflow/main/start.test.ts` | stay, rewritten over a stub workflow |
| `runFor_IdleMainAction_RunsNothing`, `runFor_PreviewMainAction_RunsNothing` in `workflow-view.test.ts` | stay, rewritten over a stub workflow |
| Any other engine row that fails to compile for the same reason | stub workflow if it states an engine rule, else the Heavy test file |

New rows, one per new rule:
- `workflow-heavy-main.test.ts`, `startWithFlowsHeld_FollowsTheirPlans`: a Heavy flow with `planDir` held when the part starts reads that plan.
- `heavy-workflow.test.ts`, `claims_NamesOnlyHeavySkills`: `wigley:feature`, `feature`, `wigley:feature-primer`, `feature-primer`, `wigley:make`, `make` give true; `wigley:review`, `wigley:featurex`, `wigley:light`, and a `turnEnded` signal give false.
- `workflow-heavy-main.test.ts`, `subagentPlanWrite_NamesThePlanAndWatchesIt`: an `agentId: 'a1'` write of `<project>/docs/plan-a/plan.md` gives `planDir` `<project>/docs/plan-a`, and `progress` equals `readPlanProgress(PLAN)`.
- `workflow-heavy-main.test.ts`, `flowOfAnotherWorkflow_IsNotWatched`: a plan write in a `workflow-light` flow leaves `state` null and reads no plan.
- `src/plugins/manifests.test.ts`, one row: `workflow-heavy` lists exactly the seven command ids above and the settings `layout`, `autoClearAndMake`, `autoStartSeconds`.


## Page half

Files:
- create `src/plugins/workflow-heavy/page/start.ts`, `src/plugins/workflow-heavy/page/checklist.ts`
- move from `src/plugins/workflow/` to `src/plugins/workflow-heavy/`: `stages/<id>/page.ts` for `<id>` in `idle`, `primer`, `explore`, `interview`, `plan`, `cold-read`, `plan-ready`, `make`, `review`, `fix`, `closed`; `stages/stage-parts.ts`; `stages/page-stages.test.ts`; `page/countdown.ts`; `page/countdown.test.ts`; `page/preview.ts`; `page/preview.test.ts`; `layouts/default/layout.js`; `layouts/default/layout.css`; `layouts/default/layout.test.ts`; `main/selftest-script.ts`
- modify `src/plugins/workflow-heavy/main/start.ts`: run the self-test script
- replace `src/plugins/workflow/stages/heavy-page-workflow.ts` and its test with `workflow-heavy/page/checklist.ts` and `workflow-heavy/page/start.ts`; `planChecklist` becomes `heavyChecklist`
- modify `src/plugins/workflow/main/start.ts`: remove the self-test script run
- modify `src/plugins/workflow/page/start.ts`: drop `heavyPageWorkflow`, its draw and the plan's imports; `page/preview-steps.ts` stays in the engine, `PREVIEW_SAMPLES` and `previewFlow` move with `page/preview.ts`
- modify `src/plugins/page.ts`: add the part
- modify `src/plugins/keymap.ts`: the five chords
- modify `scripts/check-layers.mts`: the page layers of `workflow-heavy`, if the compile or the layer check names one
- test `src/plugins/workflow-heavy-page.test.ts` (create), `src/plugins/workflow-heavy/page/checklist.test.ts` (create), `src/plugins/keymap.test.ts` (one row added)

Consumes:
- From plan.md, word for word: `PageWorkflow`, `ChecklistView`, `ChecklistGroup`, `ChecklistItem`, `WorkflowPageExports.addWorkflow`, `WorkflowPageExports.createWorkflowDraw`, `WorkflowPageExports.runCommand`, `WorkflowDrawOptions`, `StageActionSpec` ← 02
- `WorkflowMainExports.selfTestHooks`, `WorkflowSelfTestHooks` ← 01
- Engine rules ← 02: the view draws each flow through its current workflow's `PageWorkflow` and builds `finishedGroups`, `currentGroup` and `laterGroups` from `checklist(flow).groups`; a hint qualifies `action.command` with `options.manifest.id`, and the main action stays `workflow.mainAction`; the view logs `<name> progress <text>`, `countdown shown in <name>` and `countdown stopped in <name>` under `[workflow]`, and redraws each second while `countdownText` is not null.
- Tree members: `sessionsPageKey`, `selectedSessionId` in `src/plugins/sessions/contract.ts`; `docsPageKey`, `openDoc` in `src/plugins/docs/contract.ts`; `isBusy`, `busyStatus`, `detailLine`, `STAGE_ACTIVITY_RANK`, `IDLE_STAGE` in `src/plugins/workflow/contract.ts`; `FAKE_WORKFLOW_FEATURE_TEXT`, `FAKE_WORKFLOW_PLAN_PATH`, `FAKE_WORKFLOW_STEP_TEXT`, `markRun` in `src/shared/fake-agent-harness.ts`.

Produces:
- `export const workflowHeavyPagePart: PagePart<typeof workflowHeavyManifest>` in `workflow-heavy/page/start.ts`
- `export function heavyChecklist(flow: SessionFlow): ChecklistView | null` in `workflow-heavy/page/checklist.ts`
- `export const HEAVY_PAGE_STAGES: readonly PageStage[]` in `workflow-heavy/stages/index.ts`
- `export function previewFlow(index: number, sessionId: string, now: number, autoStartSeconds: number): SessionFlow` and `export const PREVIEW_SAMPLES` in `workflow-heavy/page/preview.ts`, signatures as today
- `export function workflowSelfTestScript(deps: WorkflowSelfTestDeps): SelfTestScript` in `workflow-heavy/main/selftest-script.ts`, signature as today

Decisions:
- **Page workflow.** `addWorkflow` gets `id: 'workflow-heavy'`, `label: 'Heavy'`, `badge: 'H'`, `stages: HEAVY_PAGE_STAGES`, `draw`, `checklist: heavyChecklist`, `runAction`, `countdownText`, `progressText`, `hasPlan`, `previewFlows`.
- **Draw.** `draw` is `workflow.createWorkflowDraw(api, { manifest: workflowHeavyManifest, defaultLayout, defaultStylesheet, userLayout: () => api.settings().layout, sideTitle: 'Plan' })`. The section title stays `Plan`, order 20. `defaultLayout` and `defaultStylesheet` come from `../layouts/default/layout.js` and `../layouts/default/layout.css?url`.
- **`heavyChecklist`.**
  - It returns null when `heavyStateOf(flow).progress` is null, so the pane draws nothing until the plan is read.
  - `title` is `progress.title`, `checked` is `progress.checked` and `total` is `progress.total`.
  - `groups` holds today's `waves(progress)`: one group per wave, in the order each wave first appears, boxes of a split wave joined. The title is `Wave <n>`, or `Tasks` for boxes under no wave heading. Each item is `{ text, done }`.
  - This function replaces `waves` in `workflow-view.ts`. The finished-wave fold keeps working, because the engine builds the fold from these groups.
  - A plan with no boxes returns a view with `groups: []` and `total: 0`, as today.
- **`hasPlan`.** It returns `heavyStateOf(flow).progress !== null`, as `stripInput` does today.
- **`countdownText`.** It returns null when `countdownEndsAt` is null, else today's `countdownText(endsAt, now)`: whole seconds rounded up, as `10s`; `0s` at or past the end.
- **`progressText`.** It returns null when `progress` is null, else today's `progressText`: `<checked>/<total>`, then ` wave <n>` while a wave is open, then ` review <r>` when `reviewRounds` is above 0.
- **Stage modules.** Each keeps its `id`, `label`, `inStepper`, `stepSlot`, `order`, `runsTasks`, action order, `detail`, `status` and `statusProgress`. Each reads the plan through `heavyStateOf(flow)`. Drop `side` from every action.
- **Pinned action labels.** `Cancel`, `Clear & make`, `Make in new session`, `Open plan`, `Resume make`, `Retro`, `Dismiss`. `Open plan`, `Resume make` and `Dismiss` keep `keyOnly: true`.
- **Pinned row activities.**
  - `planReady`: `{ word: 'ready to make', tone: 'attention', rank: STAGE_ACTIVITY_RANK, emphasis: 'raised' }`.
  - `closed`: `{ word: 'closed', tone: 'success', rank: STAGE_ACTIVITY_RANK, emphasis: 'raised' }`.
- **`runAction`.** It takes `(sessionId, command, flow)`. `openPlan` calls `docs.openDoc(paths.join(planDir, 'plan.md'))` with `planDir` read through `heavyStateOf(flow)`, and with no plan it throws `the session has no plan`. Every other command calls `api.channel.invoke('runAction', { sessionId, command })`.
- **Commands.** `page/start.ts` returns the seven `HEAVY_COMMANDS`. Each reads `sessions.selectedSessionId()`, and with none logs `no selected session for <command>`. Otherwise it calls `workflow.runCommand(sessionId, command)`. `mainAction`, `toggleSidePane`, `toggleFinishedWaves` and `openPreview` stay in the engine.
- **Keys.** The chords do not change. In `keymap.ts`:
  - `<Leader>wn` → `workflow-heavy.makeInNewSession`
  - `<Leader>wr` → `workflow-heavy.resumeMake`
  - `<Leader>wo` → `workflow-heavy.openPlan`
  - `<Leader>wt` → `workflow-heavy.retro`
  - `<Leader>wd` → `workflow-heavy.dismiss`

  `<Leader>ww`, `<Leader>ws`, `<Leader>wf` and `<Leader>zlw` keep their `workflow.*` ids. `<Leader>w` keeps its group name `workflow`. `clearAndMake` and `cancelCountdown` have no chord today and get none. `docs/keymap.md` names chords and not ids, so this task does not change it.
- **Default layout.** It moves without a change to what it draws. Its typedef imports change from `../layout` to `../../../workflow/layouts/layout`. `layout.css` moves unchanged. `workflow/page/workflow.css` stays in the engine, because the kit draws those parts. The element takes `data-layout-owner="workflow-heavy"`.
- **Preview.**
  - `workflow.openPreview` stays in the engine on `<Leader>zlw`, and `createPreview` stays with it under task 02. Its tests stay there.
  - `previewFlows(sessionId, now)` returns `PREVIEW_SAMPLES.map` through `previewFlow`, reading `api.settings().autoStartSeconds`.
  - `previewFlow` keeps the thirteen samples, in today's order, and the seven sample tasks. It sets `workflow: 'workflow-heavy'`, `movedUpFrom: null`, `checklist: null`, `missedLevel: false`, and puts `planDir`, `progress`, `reviewRoundsAtMake: null` and `countdownEndsAt` in `state`.
- **Self-test.** The six groups move to `workflow-heavy/main/selftest-script.ts`, with today's names, keys and screenshots: `feature to plan ready`, `clear and make`, `review`, `reported fix`, `close and dismiss`, `auto-start countdown`.
  - `workflow-heavy/main/start.ts` runs the script when `services.selfTest` is not null, with `hooks: workflow.selfTestHooks`.
  - `AUTO_START_SETTINGS` becomes `{"workflow-heavy":{"autoClearAndMake":true,"autoStartSeconds":30}}`.
  - The two settings lines become `[workflow-heavy] settings: autoClearAndMake on, autoStartSeconds 30` and `[workflow-heavy] settings: autoClearAndMake off, autoStartSeconds 10`.
  - The `[workflow]` lines for `shows`, `progress`, `countdown` and `side pane` do not change, because the engine's view logs them.
  - `SELFTEST_PROJECT_NAME` stays `workflow-selftest`. The script's `shownLine`, `expectedSends` and `runProblems` do not change.
- **Boundary.** Heavy page imports `sessions/contract.ts` and `docs/contract.ts`, through `dependsOn`.

GIVEN a plan with waves 1 and 2 ticked and wave 3 open WHEN `heavyChecklist` runs THEN `groups` titles are `Wave 1`, `Wave 2`, `Wave 3`, and the side pane draws the fold `2 waves · <n> done` over wave 3
GIVEN a flow in `planReady` and not busy WHEN the row draws THEN the row reads `ready to make` and the chip draws no tag
GIVEN a closed run WHEN `Space w d` runs on the selected session THEN main folds `dismissed` and the session shows idle
GIVEN a chip's button in an unselected row WHEN the user clicks it THEN it runs for that row's session
GIVEN `planReady` with a running countdown WHEN `Space w w` runs THEN the main action is `Cancel` and the session does not clear
GIVEN the preview WHEN `Space z l w` runs thirteen times THEN it shows every Heavy sample in order, and the next press closes it

Tests: a moved test keeps its name and its assertion values, and reads plan fields through `heavyStateOf`. `page-stages.test.ts` reads `HEAVY_PAGE_STAGES` and `HEAVY_MAIN_STAGES`, and its check of declared commands reads `HEAVY_COMMANDS`. The rows of `page/workflow-view.test.ts` that name Heavy stages move to `src/plugins/workflow-heavy-page.test.ts`. That file starts the real engine page part and adds the heavy page part, and it may cross plugins, as `agent-form-drive.test.ts` does. Engine rows that use a fake stage stay under task 02.

| Behaviour that must survive | Test that pins it |
|---|---|
| Clear & make is planReady's main action, disabled while busy | `actions_TableOfFlows_ListsAvailableActionsMainFirst $stage $busy $countdownMs` (`clearAndMake:true`, `makeInNewSession:true`; busy `clearAndMake:false`, `makeInNewSession:true`); `runFor_PlanReadyMainAction_RunsClearAndMake`, `runFor_PlanReadyBusyMainAction_RunsNothing` |
| Make in new session runs while busy | `runFor_PlanReadyBusyMakeInNewSession_RunsIt` |
| Resume make is key only, and only with open boxes | `runFor_MakeResumeKey_RunsTheKeyOnlyAction`, `runFor_MakeMainAction_RunsNoKeyOnlyAction`, `runFor_MakeAllTickedResumeMake_RunsNothing`; `page-stages.test.ts` rows `${stage} with open boxes`, `${stage} with every box checked`, `${stage} with the plan unread` |
| Retro is closed's main action, disabled while busy; Dismiss is key only | `page-stages.test.ts` row `closed with a turn running` |
| Cancel during the countdown; the text ticks | `page-stages.test.ts` rows `plan ready during the countdown`, `plan ready with no countdown`; `tick_CountdownShown_RedrawsAndStopsWhenGone` (`10s`, `9s`, first button `Cancel`); `page/countdown.test.ts` rows (`10s`, `1s`, `0s`) |
| Row activities `Ready to make` and `Closed` | `setFlow_$stage_RowLabelReads$word` (`ready to make`, `closed`, null while busy and in make); `setFlow_LeavesWaitingStage_ClearsTheRowLabel` |
| Buttons run for their own session | `button_ChipOfUnselectedSession_RunsForItsOwnSession` |
| Review rounds and fix cycles in the words | `page-stages.test.ts` rows `review with rounds`, `review with no round`, `fix with rounds`, `fix with no round`, `review busy with 2 rounds`, `fix busy with 2 rounds`, `closed 9/9` |
| The trail keeps its steps and progress | `steps_FlowIn_$stage_$busy_CarryThePinnedStates`, `stepper_DrawsEachLabelTheCurrentOneWithProgressAndNoMark ($name)` |
| Waves group and the fold works | `side pane groups the plan and states its tasks: $name`, all rows; `the fold is kept per session: $name`, all rows; `finishedFold_Click_OpensItsSessionsWavesAndStatesIt` |
| The pane's summary and its null cases | `side pane draws and sets its summary only with a plan and while shown: $name`, all rows |
| What the default layout draws | every test of `layouts/default/layout.test.ts`, unchanged |
| Preview samples | `previewFlow_EachIndex_ShowsItsSample $index`, thirteen rows (`endsAt: NOW + 7000` at index 7; `checked` 3 at 8 and 9, 6 at 10 and 11, 7 at 12) |
| Stop leaves nothing live | `stop_LeavesNoLiveRegistration`, `stopThenStart_StartsAgain` in a new `workflow-heavy/page/start.test.ts`, over the real engine page part, asserting `Object.keys(commands)` contains `clearAndMake`. `workflow/page/start.test.ts` keeps 02's rows and its own stop rows asserting `mainAction` |

The self-test groups pin the same moves end to end: task 12 runs them. These main behaviours are pinned in the main half: closed on plan gone, re-attach replay and `savedAt`, a subagent's plan write naming the plan, and `wigley:make` naming a folder not written yet.

`exports_ConsumerDisposed_FreesTheStageId` stays in `workflow/page/start.test.ts`, as 02 reworked it.

New rows, one per new rule:
- `page/checklist.test.ts`, `heavyChecklist_MapsThePlan`:
  - progress null gives null.
  - Tasks `[1, done] [1, done] [2, open]`, title `Plan A`, give `{ title: 'Plan A', checked: 2, total: 3, groups: [{ title: 'Wave 1', items: [two done] }, { title: 'Wave 2', items: [one open] }] }`.
  - A box with wave null gives the group title `Tasks`.
  - Wave order `1, 2, 1` gives two groups, with wave 1 first, holding its two boxes.
  - No boxes gives `groups: []`, `total: 0`.
- `src/plugins/keymap.test.ts`, `workflowHeavyCommands_KeepTheirChords`: the default keymap maps `<Leader>wn`, `<Leader>wr`, `<Leader>wo`, `<Leader>wt`, `<Leader>wd` to the five ids above, and `<Leader>ww` to `workflow.mainAction`.
- `workflow-heavy-page.test.ts`, `commandWithNoSelectedSession_LogsAndRunsNothing`: with no selected session, `dismiss` logs `no selected session for dismiss` and calls no channel.
- `workflow-heavy-page.test.ts`, `commands_WithASelectedSession_RunThroughTheEngine`: each of the seven ids with `s1` selected calls `runCommand('s1', <id>)` once, and `openPlan` reaches `docs.openDoc`, not the channel.
- `workflow-heavy-page.test.ts`, `sideSection_ReadsPlan`: the side part's title reads `Plan`.


## Finish

Done when: it compiles; `scripts/check-layers.mts` passes; `workflow-heavy` is in `manifests.ts`, `main.ts` and `page.ts`; `workflow/plan-reader.ts`, `workflow/main/plan-watch.ts`, `workflow/main/actions.ts`, `workflow/main/countdown.ts` and `workflow/main/heavy-runtime.ts` are gone; `src/plugins/workflow/stages/` is gone; `workflow/page/countdown.ts`, `workflow/page/preview.ts`, `workflow/layouts/default/` and `workflow/main/selftest-script.ts` are gone; `grep -n "workflow\.\(makeInNewSession\|resumeMake\|openPlan\|retro\|dismiss\|clearAndMake\|cancelCountdown\)" src/plugins/keymap.ts` prints nothing; the test gate runs the tests above.

Checks in task 12, `12-final-verification.md`: `npm run selftest -- --plugin workflow-heavy`, all six groups, with their screenshots against today's look; a drive run of the Heavy strip, chip and side pane; the preview on `Space z l w`.

Commit: one commit for the group.

## Proof

