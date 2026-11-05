# 06 — Workflow stage actions as commands

Status: not started
Type: Task
Wave: 3 · Depends on: 05
Plan: [plan.md](plan.md)

Files:
- create `src/plugins/workflow/action-registry.ts` · `src/plugins/workflow/stages/main-actions.ts`
- modify `src/plugins/workflow/contract.ts` · `manifest.ts` · `flow.ts` · `stages/index.ts` · `stages/stage-parts.ts` · `stages/make/main.ts` · `stages/plan-ready/main.ts` · `stages/plan-ready/page.ts` · `stages/closed/main.ts` · `stages/closed/page.ts` · `main/actions.ts` · `main/start.ts` · `page/start.ts` · `page/workflow-view.ts` · `page/layout/workflow-kit.ts` · `page/layout/workflow-parts.ts` (each under `src/plugins/workflow/`)
- modify `docs/features/workflow/design.md` (the paragraph that says `stages/index.ts` lists the commands; measured at line 90, re-verify)
- test `src/plugins/workflow/action-registry.test.ts` (create) · `main/actions.test.ts` · `main/start.test.ts` · `page/workflow-view.test.ts` · `page/start.test.ts` · `flow.test.ts` · `stages/page-stages.test.ts` · `stages/main-stages.test.ts`

Consumes (copied, since `plan-commands-and-state/` is gone; each is in the tree):
- `commands.run(id: CommandId): Promise<void>` and `commands.run<A>(key: CommandKey<A>, arg: A): Promise<void>`, on `MainApi` and `PageApi`. An unknown id or a bad arg throws at the call. A handler's failure is logged under the owning plugin, and the promise resolves. A run from the other process goes over the bridge.
- `commands.register(short: string, decl: CommandDecl, handler: CommandHandler): Disposable`, on both APIs.
- `commands.intercept(id, wrap)` and `onDidRun(listener)` work in the process that runs the handler.
- `export interface CommandKey<A, Id extends string = string> { readonly id: Id; readonly argType?: A; }`, in `src/contracts/commands.ts`.
- `CommandDecl.arg?: CommandArgShape`, where `CommandArgShape = 'number' | 'string' | { readonly [field: string]: 'number' | 'string' }`.
- `PageCommandContext<A = undefined>` is `{ editor?: TextEditor; arg: A }`. `MainCommandContext<A = undefined>` is `{ chord?: string; arg: A }`. A handler is `(context) => void | Promise<void>`.
- `BaseKit.button(parent: HTMLElement, label: string, command: CommandId, options?: { arg?: CommandArg; variant?: string; keys?: string }): HTMLElement` and `BaseKit.command(id: CommandId, arg?: CommandArg): () => void` ← 01.
- Listing rule ← 01: a command with a declared `arg` lists in Settings, help and the palette only when a key binds it.

Produces:
- In `src/plugins/workflow/contract.ts`:
  ```ts
  export type StageActionArg = { sessionId: string };
  export type StageRunArg = { sessionId: string; action: string };
  export const workflowStageActionKey: CommandKey<StageRunArg, 'workflow.stageAction'>;
  export function stageWorkerKey(action: string): CommandKey<StageActionArg>;   // id `workflow.${action}InSession`
  export interface StagePageTools { openDoc(path: string): void; paths: Pick<Paths, 'join'>; }
  export type StageActionSpec = StageActionBase &
    ({ side: 'main' } | { side: 'page'; run(flow: SessionFlow, tools: StagePageTools): void | Promise<void> });
  // StageActionBase: today's command, label, keyOnly, available, enabled, plus help?: string
  export interface StageMainTools {
    chat: Pick<ChatMainExports, 'send' | 'clear' | 'launch' | 'profileOf'>;
    signal(sessionId: string, signal: WorkflowSignal): void;
    cancelCountdown(sessionId: string): void;
  }
  export interface MainStageAction {
    command: string;
    label: string;
    idleOnly?: true;
    run(sessionId: string, flow: SessionFlow, tools: StageMainTools): Promise<void>;
  }
  // MainStage gains: actions?: readonly MainStageAction[]; planArgsSkill?: string;
  ```
  `WorkflowChannel.invoke.runAction` and `WorkflowActionRequest` go. `WorkflowChannel.messages` gains `actionFailed: { sessionId: string; command: string; message: string }`.
- In `src/plugins/workflow/action-registry.ts`: `createActionRegistry<A extends { command: string }>(register: (action: A) => Disposable): { add(actions: readonly A[]): Disposable }`.
- In `src/plugins/workflow/stages/main-actions.ts`: `MAKE_SKILL = 'wigley:make'`, `CLEAR_AND_MAKE_ACTION`, `RESUME_MAKE_MAIN_ACTION`, `MAKE_IN_NEW_SESSION_ACTION`, `CANCEL_COUNTDOWN_ACTION`, `RETRO_ACTION`, `DISMISS_ACTION`, each a `MainStageAction`.
- Manifest command `workflow.stageAction`: `{ label: 'run a stage action in a session', group: 'workflow', runsIn: 'page', arg: { sessionId: 'string', action: 'string' } }`. It serves every action button and the finished-waves fold.
- `workflow.<action>InSession` commands, registered at runtime, one per action, each with `arg: { sessionId: 'string' }` and `runsIn` equal to the action's side. Today's actions: `cancelCountdown`, `clearAndMake`, `makeInNewSession`, `resumeMake`, `retro`, `dismiss` (main); `openPlan` (page). Count measured at plan time, re-verify.

Decisions:

The command paths, after the task:

```
 key  ─► workflow.<action>     page, no arg, on the selected session ─┐
 button or fold ─► workflow.stageAction {sessionId, action}   page ───┤
                                                                      ▼
                     view.runFor(sessionId, action): preview, available, enabled
                                                                      ▼
                     commands.run(stageWorkerKey(action), {sessionId})
                       ├─ side page: the stage's run(flow, tools)
                       └─ side main: routed; idle-only check; the stage's run(...)
```

- **The manifest wins for today's ids.** `WORKFLOW_COMMANDS` stays in the manifest with today's ids and labels. Reason: `src/plugins/keymap.ts` types each default bind by `QualifiedCommandId<BuiltInManifest, …>`, so a default bind needs a manifest id, and today's keys and Settings rows stay as they are. `<Leader>ww`, `wn`, `wr`, `wo`, `wt` and `wd` keep working with no edit to `keymap.ts`.
- **`register` never declares an id the manifest holds.** The page's stage registration tests `Object.hasOwn(WORKFLOW_COMMANDS, action.command)`. When the manifest holds the id, it registers the worker alone. When it does not, it also registers the no-arg key command `workflow.<action>`, label `action.help`, group `workflow`, `runsIn: 'page'`, whose handler is `runOnSelected`. `addStage` throws `action <command> has no help` when that action has no `help`. The built-in actions need no `help`.
- **No new default key.** A stage binds no key. The user binds a stage's key command in `keymap.json`.
- **A worker takes a session; a key does not.** One id cannot serve both, since a bind holds a fixed arg and a button draws for a session that may not be selected. So each action has a key command and a worker. The worker lists nowhere, by the listing rule, so Settings shows one row per action, as today.
- **An intercept on the worker sees every route:** key, button, palette. `onDidRun` likewise.
- `view.runFor` stays the one gate. It keeps the preview check, `mainAction`, the `toggleFinishedWaves` case, `available`, `enabled` and the `nothing to run` log. `runSpec` and its closed switch go. `runFor` replaces them with `await deps.runWorker(sessionId, spec)` in today's `try`. `WorkflowViewDeps.openDoc`, `.paths` and `.runAction` go; `runWorker(sessionId: string, spec: StageActionSpec): Promise<void>` replaces them.
- `RunCommand` and the `run` parameter of `createWorkflowKit` and of `parts.chip`, `.strip`, `.sidePane` go. Each takes `sessionId`. `actionButton` draws through `base.button(parent, action.label, workflowStageActionKey.id, { arg: { sessionId, action: main ? MAIN_ACTION : action.command }, variant })`, and keeps its `stopPropagation` listener and `disabled`. The fold draws the same way with `action: TOGGLE_FINISHED_WAVES`. The layout contract keeps its `actionButton` signature.
- **A failure is a message.** A run resolves after a handler fails, so the page can no longer read main's error from the promise. The main worker catches the failure, logs `<action> not run in <name>: <message>` (today's text) and sends `actionFailed`. The page's `actionFailed` listener toasts `Workflow: <message>` with tone `error` (today's text). The page worker logs and toasts the same text in its own `catch`, and `runFor` keeps its `catch` for a run that throws at the call.
- **`ran <action> in <name>` logs in the process that runs the worker,** with today's text, only when the action ran. Main's name is `sessions.label(sessionId) ?? paths.base(flow.projectDir)`, as `fireCountdown` reads it. Today the page logs `ran` also for a main run that refused a busy flow; that false line goes.
- `main/actions.ts` keeps `createWorkflowActions` and its `run(sessionId, command): Promise<boolean>` contract. The closed `actions` record and `IDLE_ONLY_COMMANDS` go. `WorkflowActionsDeps` gains `actionOf(command: string): MainStageAction | null`, read from the registered stages, and carries `StageMainTools`. `action.idleOnly` replaces the set: `clearAndMake`, `resumeMake` and `retro` set it.
- **Who holds which main action:** plan-ready main: `cancelCountdown`, `clearAndMake`, `makeInNewSession`. Make main: `resumeMake`. Closed main: `retro`, `dismiss`. A page half of another stage may name an action a main stage holds: review and fix name `resumeMake` (measured at plan time, re-verify).
- **A shared action registers once.** `OPEN_PLAN_ACTION` and `RESUME_MAKE_ACTION` sit in many stages. `createActionRegistry` counts holders per command, registers on the first holder and disposes with the last. The same object under a held command adds a holder. A different object under a held command throws `action <command> is already registered`.
- `addStage` in each process adds the stage's actions to its registry and disposes them with the stage. The built-in loops take the same path. The main loop keeps its single `contributeStepTool` call.
- The auto-start stays a direct `actions.run` call in `fireCountdown`. It is no user action, and its failure logs `auto-start failed` with no toast, as today. `MainStage.autoCommand` keeps naming an action by its short name.
- **The flow fold stops naming the make skill.** `MAKE_SKILL` leaves `flow.ts`. `applyBookkeeping` takes the stages `foldFlow` holds. On `skillStarted`, it sets `planDir` from `argsPath` when any stage has `planArgsSkill` and `startsSkill(signal, stage.planArgsSkill)` holds. `make/main.ts` sets `planArgsSkill: MAKE_SKILL`, and its `enter` reads the same constant. `/wigley:make` and `/wigley:retro` text moves with the actions into `stages/main-actions.ts`.
- `OPEN_PLAN_ACTION.run` holds today's `openPlan` body and its `the session has no plan` throw. `PLAN_FILE` moves to `stage-parts.ts`.
- `WORKFLOW_COMMANDS` loses no entry. `stageAction`, `toggleSidePane`, `toggleFinishedWaves` and `openPreview` stay beside it in the manifest.

GIVEN a stage added through `addStage` with a page action WHEN its button is clicked THEN the stage's `run` runs for the session the button draws, with no edit to `workflow-view.ts`.
GIVEN a stage added through `addStage` with a main action in its main half and its page half WHEN its button is clicked THEN main runs the action through routing, and no `runAction` channel exists.
GIVEN `<Leader>wn` binds `workflow.makeInNewSession` WHEN the key runs THEN it acts on the selected session as today, and Settings shows one row for it.
GIVEN a chip drawn for a session that is not selected WHEN its main action is clicked THEN the action runs for the drawn session, and the selection stays.
GIVEN the preview session WHEN any button runs THEN the log reads `preview runs nothing for <action>`, except `toggleFinishedWaves`, which runs.
GIVEN a main action whose stage throws WHEN it runs from a button THEN main logs `<action> not run in <name>: <message>`, and the page toasts `Workflow: <message>`.
GIVEN a plugin's intercept on `workflow.clearAndMakeInSession` WHEN the key or the button runs THEN the intercept wraps the handler both times.
GIVEN a flow with no such stage WHEN `skillStarted` of `wigley:make` folds THEN `planDir` stays. GIVEN the make stage is registered WHEN it folds THEN `planDir` comes from `argsPath`.

Tests:
- `action-registry.test.ts`: `shared_action_registers_once_and_goes_with_its_last_holder` catches a second `register` throwing on `openPlan`, or a stage's dispose removing an action another stage holds. `different_action_under_a_held_command_throws`.
- `workflow-view.test.ts`: `stage_added_with_a_page_action_runs_it` catches a surviving closed switch. Rows at the `ran clearAndMake in proj`, `ran makeInNewSession in proj` and `ran resumeMake in proj` cases (measured at lines 409-437) move: this table now asserts `runWorker` got the session and the spec. `chip_button_runs_for_its_own_session_not_the_selected_one` catches a button routed through `runOnSelected`.
- `main/actions.test.ts`: existing table keeps its rows, built on stage actions. Add the row `action_of_an_added_stage_runs`, which catches a closed record left behind.
- `main/start.test.ts`: the harness's `runAction` helper (measured at line 270) runs `stageWorkerKey(command)` through the fake `commands`. Add `failed_main_action_logs_and_sends_actionFailed`, which catches a failure lost in the resolved promise. Add `refused_busy_action_logs_no_ran`.
- `page/start.test.ts`: `added_stage_action_gets_a_key_command_and_built_in_ids_do_not_register_twice` catches a throw from declaring a manifest id again; `actionFailed_toasts_main's_message`.
- `flow.test.ts`: row `a stage's planArgsSkill sets planDir, and no stage naming it leaves planDir`, which catches a fold still naming the skill.
- `stages/page-stages.test.ts`: the `undeclared` test (measured at line 449) changes to: every built-in page action names a `WORKFLOW_COMMANDS` id, and every `side: 'main'` action names an action of a built-in main stage. It catches a button with no worker.

Done when: `grep -n 'runAction\|switch (spec.command)\|MAKE_SKILL' src/plugins/workflow/flow.ts src/plugins/workflow/contract.ts src/plugins/workflow/page/workflow-view.ts` prints nothing; compiles; the design doc's paragraph reads true; the test gate runs the tests above. The live checks are in [11](11-final-verification.md).
Commit: one commit for the group.

## Proof
