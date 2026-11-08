# 06 — Workflow stage actions as commands

Status: in progress
Type: Task
Wave: 3 · Depends on: 05
Plan: [plan.md](plan.md)

**Contents**

- **Intent** — what the task lands, and what the user sees after it.
- **Files** — what this task modifies and tests.
- **Consumes** — the tree's signatures and task 01's.
- **Produces** — the command, its key and the changed signatures.
- **Decisions** — the command path, the engine's gate, Heavy's commands, light and medium.
- **Behaviour** — GIVEN/WHEN/THEN.
- **Tests** — each with the break it catches.
- **Done when**, **Commit**, **Proof**.

## Intent

Every stage button and every stage key runs one engine command, `workflow.stageAction`, with the session and the action in its arg. A plugin then hooks every stage action of every workflow level at one id. The user sees no change: the same buttons, the same keys, the same Settings rows, the same log lines.

This task was written after the workflow levels split. The engine (`src/plugins/workflow/`) owns `workflow.stageAction` and the gate. Each level owns its actions behind `PageWorkflow.runAction`. Heavy keeps its own session commands in its manifest, so its keys and Settings rows stay.

## Files

Engine:

- modify `src/plugins/workflow/manifest.ts`
- modify `src/plugins/workflow/contract.ts`
- modify `src/plugins/workflow/page/start.ts`
- modify `src/plugins/workflow/page/workflow-view.ts`
- modify `src/plugins/workflow/page/layout/workflow-kit.ts`
- modify `src/plugins/workflow/page/layout/workflow-draw.ts`
- modify `src/plugins/workflow/layouts/layout.d.ts` (the `actionButton` and `finishedFold` comments only)
- modify `src/plugins/workflow/page/engine-parts.test-support.ts`
- test `src/plugins/workflow/page/start.test.ts`
- test `src/plugins/workflow/page/workflow-view.test.ts`
- test `src/plugins/workflow/page/layout/workflow-draw.test.ts`

Heavy:

- modify `src/plugins/workflow-heavy/page/start.ts`
- modify `src/plugins/workflow-heavy/stages/index.ts` (the file comment only)
- test `src/plugins/workflow-heavy-page.test.ts`

Docs:

- modify `docs/features/workflow/design.md`: the paragraph that starts `Each action names a command of the owner plugin` (measured at line 148) and the Decisions bullet `**Actions are commands of the owner plugin.**` (measured at line 310). Re-verify both.

Not changed: `src/plugins/keymap.ts`, `src/plugins/workflow-heavy/manifest.ts`, `src/plugins/workflow-heavy/main/*`, `src/plugins/workflow-heavy/contract.ts`, `src/plugins/workflow-light/*`, `src/plugins/workflow-medium/*`. The layout tests of the three levels call `testWorkflowKit` with today's arguments and do not change.

## Consumes

From the tree:

- `commands.run(id: CommandId): Promise<void>` and `commands.run<A>(key: CommandKey<A>, arg: A): Promise<void>` on `PageApi`. An unknown id or a bad arg throws at the call. A handler's failure is logged under the owning plugin, and the promise resolves.
- `commands.intercept(id, wrap)` and `onDidRun(listener)`, in the process that runs the handler.
- `export interface CommandKey<A, Id extends string = string> { readonly id: Id; readonly argType?: A; }`, in `src/contracts/commands.ts`.
- `CommandDecl.arg?: CommandArgShape`, where `CommandArgShape = 'number' | 'string' | { readonly [field: string]: 'number' | 'string' }`. A manifest handler reads its arg as `context.arg`, as `forms.choose` does in `src/plugins/forms/page/forms-commands.ts`.
- `checkCommandArg(id, shape, arg)` in `src/shared/command-args.ts`.
- `PageWorkflow.runAction(sessionId: string, command: string, flow: SessionFlow): Promise<void>` in `src/plugins/workflow/contract.ts` (measured at line 366).
- `WorkflowView.runFor(sessionId: string, command: string): Promise<void>` in `src/plugins/workflow/page/workflow-view.ts` (measured at line 572).
- `MAIN_ACTION = 'mainAction'` and `TOGGLE_FINISHED_WAVES = 'toggleFinishedWaves'` in `src/plugins/workflow/page/layout/workflow-kit.ts`.
- `HEAVY_COMMANDS` in `src/plugins/workflow-heavy/stages/index.ts`: `clearAndMake`, `cancelCountdown`, `makeInNewSession`, `resumeMake`, `openPlan`, `retro`, `dismiss`, each `runsIn: 'page'`, no `arg`. `workflow-heavy/manifest.ts` declares them.
- `startPagePart(part, { parts })` in `src/shared/plugin-part-harness.test-support.ts`: `parts` starts real providers in the same command world as the part under test.

From task 01 (`01-kit-commands.md` § Produces):

- `BaseKit.button(parent: HTMLElement, label: string, command: string, options?: KitButtonOptions): HTMLButtonElement`, with `KitButtonOptions { arg?: KitCommandArg; variant?: ButtonVariant; keys?: string | null }`. An unknown id, or an `arg` the command does not declare, throws while the part builds.
- `KitCommands { exists(id): boolean; argShape(id): CommandArgShape | undefined; run(id, arg?): void }` and `kitCommandsOf(api)` in `src/shared/page/layout-host/base-kit.ts`. Task 01 moves the engine's `drawDeps.kit.commands` literal in `workflow/page/start.ts` to `kitCommandsOf(api)`.
- `keyRunner(commands: Pick<PageApi['commands'], 'run'>, log: PluginLog): <A>(key: CommandKey<A>, arg: A) => void` in `base-kit.ts`. It voids the promise and logs a throw at the call as `command <id> failed: <error text>`.
- Listing rule: a command with a declared `arg` lists in Settings and help only when a key binds it.

## Produces

In `src/plugins/workflow/contract.ts`:

```ts
// The session a stage action runs for, and the action: `mainAction`,
// `toggleFinishedWaves`, or the short command id of a stage's action.
export interface StageActionArg { sessionId: string; action: string }
export const workflowStageActionKey: CommandKey<StageActionArg, 'workflow.stageAction'> =
  { id: 'workflow.stageAction' };

export interface WorkflowDraw {
  sideTitle: string;
  chip(parent: HTMLElement, input: ChipInput, sessionId: string): Drawn;
  strip(parent: HTMLElement, input: StripInput, sessionId: string): Drawn;
  sidePane(parent: HTMLElement, input: SidePaneInput, sessionId: string): Drawn;
}

export interface WorkflowPageExports {
  addWorkflow(workflow: PageWorkflow): Disposable;
  createWorkflowDraw(api: PagePluginApi, options: WorkflowDrawOptions): WorkflowDraw;
}
```

`RunCommand` goes. `WorkflowPageExports.runCommand` goes. `PageWorkflow.runAction` stays with its signature.

In `src/plugins/workflow/manifest.ts`, one new command:

| Command | `arg` | Label | Group | `runsIn` | Site |
|---|---|---|---|---|---|
| `workflow.stageAction` | `{ sessionId: 'string', action: 'string' }` | `run a stage action for a session` | `workflow` | `page` | every `kit.actionButton`, `kit.finishedFold`, and every stage key |

It takes no default key, and lists nowhere while unbound, by the listing rule.

In `src/plugins/workflow/page/layout/workflow-kit.ts`:

```ts
export function createWorkflowKit(
  services: OwnerKitServices,
  rollback: RollbackDeps,
  sessionId: string,
  clock: Clock,
  manifest: Pick<PluginManifest, 'id' | 'commands'>,
): WorkflowKit;
```

In `src/plugins/workflow/page/engine-parts.test-support.ts`:

```ts
export function testWorkflowKit(
  manifest: Pick<PluginManifest, 'id' | 'commands'>,
  now = 0,
  sessionId = 's1',
): { kit: WorkflowKit; anchors: RecordedAnchor[]; runs: { id: CommandId; arg: unknown }[] };
```

Its fake `commands.argShape` returns `{ sessionId: 'string', action: 'string' }` for `workflow.stageAction` and `undefined` for every other id. Its `run` pushes onto `runs`. Use the anchor type `recordingAnchors()` returns today. `workflow-draw.test.ts`'s own kit fake gets the same `argShape` rule.

## Decisions

The command path, after the task:

```
 button / fold ─► kit.button ─► workflow.stageAction { sessionId: drawn session, action } ─┐
 engine key (ww, wf)   ─► workflow.mainAction / toggleFinishedWaves ─┐                     │
 Heavy key (wn wr wo wt wd, …) ─► workflow-heavy.<action> ───────────┴► stageAction        │
                                   { sessionId: selected session, action }                 │
                                                                                           ▼
                 engine handler: view.runFor(sessionId, action)
                   toggleFinishedWaves · preview check · mainAction · available · enabled
                                                                                           ▼
                 workflow.runAction(sessionId, spec.command, flow)   (the flow's level)
                   Heavy: openPlan opens the doc; every other action invokes its channel's runAction
```

**One engine command.**

- The engine declares `workflow.stageAction`. Its handler, in the object `workflow/page/start.ts` returns, is `stageAction: (context) => view.runFor(context.arg.sessionId, context.arg.action)`. It returns the promise.
- `view.runFor` stays the one gate, unchanged: the `toggleFinishedWaves` case, the preview check, `mainAction`, `available`, `enabled`, the `nothing to run` log, the `catch` that logs `<action> not run in <name>: <message>` and toasts `Workflow: <message>` with tone `error`, and the `ran <action> in <name>` log. Every log line and toast keeps today's text.
- An intercept or an `onDidRun` listener on `workflow.stageAction` sees every user route of every level: each button, each fold, each stage key. An intercept on a key command (`workflow-heavy.clearAndMake`) sees that key only.

**`PageWorkflow.runAction` stays as the seam behind the command.** The engine names no level's actions. The flow's level dispatches its own, as today. Heavy's `runAction` keeps its `openPlan` branch and its channel `runAction` call. Heavy's main side keeps its channel handler, `createWorkflowActions`, its closed `actions` record and `IDLE_ONLY_COMMANDS`: they are Heavy's own plumbing behind a command a user route already ran.

**Buttons.**

- `RunCommand` and the `run` parameter go from `createWorkflowKit`, from `WorkflowDraw.chip`, `.strip` and `.sidePane`, and from `kitFor` in `workflow-draw.ts`. Each takes the `sessionId` of the part it draws. `workflow-view.ts`'s `drawPart` passes `part.sessionId`, and its `runCommand` helper goes.
- `actionButton` draws through `base.button(parent, action.label, workflowStageActionKey.id, { arg: { sessionId, action: command }, variant })`, where `command` is `MAIN_ACTION` for the main action, else `action.command`. The variant rule stays: `options.variant`, else `primary` for the main action and `secondary` for the rest. It keeps its `stopPropagation` click listener and its `disabled`.
- `finishedFold` draws through `base.button` with today's label (`▾ <text>` while open, else `▸ <text>`), `workflowStageActionKey.id`, and `{ arg: { sessionId, action: TOGGLE_FINISHED_WAVES }, variant: 'ghost' }`. It keeps its class, its `aria-expanded` and its hint.
- Each keeps today's hint, since a sweep keeps what the user sees and `workflow.stageAction` has no bind to hint. `actionButton` keeps `options.anchor`: unless it is `false`, it calls `base.keyHint(button, qualify(hintOwner, command))`, with today's `hintOwner`. The fold keeps `base.keyHint(fold, qualify(workflowManifest.id, TOGGLE_FINISHED_WAVES))`. Neither passes the `keys` option.
- `workflow-kit.ts` stops importing `textButton`.
- The layout contract keeps its `actionButton` and `finishedFold` signatures. Their comments in `layouts/layout.d.ts` say that a click runs `workflow.stageAction` with the session the part draws and the action. Keep the rest of each comment.

**Keys.**

- Each stage key runs `workflow.stageAction` on the selected session, so the one intercept sees keys too. The key commands keep their ids, labels and binds, so `keymap.ts`, Settings and help do not change.
- The engine's `runOnSelected` in `workflow/page/start.ts` keeps its `no selected session for <command>` log. With a session, it runs `keyRunner(api.commands, log)(workflowStageActionKey, { sessionId, action: command })` in place of `void view.runFor(sessionId, command)`. It serves `mainAction` and `toggleFinishedWaves`. `toggleSidePane` and `openPreview` do not change.
- Heavy's `runOnSelected` in `workflow-heavy/page/start.ts` does the same in place of `void workflow.runCommand(sessionId, command)`. It keeps its `no selected session for <command>` log, and its seven commands.
- `WorkflowPageExports.runCommand` goes, since no caller is left. Its sentence in the `WorkflowPageExports` comment in `contract.ts` (measured at line 399) goes.

**Heavy's commands stay in its manifest.** `HEAVY_COMMANDS` keeps all seven entries: the five `keymap.ts` binds (`makeInNewSession`, `resumeMake`, `openPlan`, `retro`, `dismiss`), plus `clearAndMake` and `cancelCountdown`. So the user can bind each, and Settings lists each once, as today. Each stage action's `command` stays a key of `HEAVY_COMMANDS`, so the `action` a button sends is the same short id the key sends.

**Light and Medium do not change.** Their stages have no actions, so `runFor` logs `nothing to run` before `runAction`, and their rejecting `runAction` stays unreached. `docs/features/workflow/design.md`'s line on it (measured at line 123) stays true.

**Comments that go untrue.** Reword each to what the code does after this task:

- `stages/index.ts`'s file comment, `and the commands their actions and keys run`: the commands are the keys' commands, and a button runs `workflow.stageAction` with the same short id.
- `workflow-heavy/page/start.ts`'s part comment, `Each command runs on the selected session, through the engine.`: it runs `workflow.stageAction` on the selected session.
- `workflow-view.ts`'s `WorkflowView` comment: `runFor` is the one path, which `workflow.stageAction` runs.
- `workflow-kit.ts`'s `createWorkflowKit` comment: `run runs a command for the session the part draws` becomes `sessionId` is the session each button runs `workflow.stageAction` for.
- `contract.ts`'s `PageWorkflow.runAction` comment: it runs one of its stages' actions for the session `workflow.stageAction` names, after the engine's gate.

**Design doc.** In `docs/features/workflow/design.md`:

- The paragraph at line 148: each action names a command of the owner plugin, which its key runs. A button, a fold and a key all run the engine's `workflow.stageAction` with the session and the action, and the flow's level runs the action through its `runAction`. Light and Medium declare none.
- The Decisions bullet at line 310: keep its reason. It says the engine owns one command for every stage action, the level owns the actions, and the engine names no stage or skill.

**Self-test lines.** No `expect` line moves: no log line changes. Heavy's script presses `<Leader>wd` and expects `shows idle` (measured in `workflow-heavy/main/selftest-script.ts` at line 138). The key now reaches `runAction` through `workflow.stageAction`.

## Behaviour

- GIVEN a chip drawn for session `b` while `a` is selected WHEN its main action button is clicked THEN `workflow.stageAction` runs with `{ sessionId: 'b', action: 'mainAction' }`, Heavy's channel gets `{ sessionId: 'b', command: 'clearAndMake' }`, the click goes no further, and the selection stays.
- GIVEN session `s1` is selected WHEN `<Leader>wn` runs THEN `workflow.stageAction` runs with `{ sessionId: 's1', action: 'makeInNewSession' }`, and the log and toast lines read as today.
- GIVEN a plugin's intercept on `workflow.stageAction` that calls no `next` WHEN a Heavy key or a stage button runs THEN the action does not run.
- GIVEN the preview session WHEN any button runs THEN the log reads `preview runs nothing for <action>`, except `toggleFinishedWaves`, which runs.
- GIVEN Settings WHEN it draws THEN it shows no `workflow.stageAction` row, and one row for each `workflow-heavy.*` and `workflow.*` key command, as today.

## Tests

One test per behaviour; a case of a rule an existing test owns is a row in that test.

`src/plugins/workflow/page/workflow-view.test.ts`, `describe('workflow kit')`, through `testWorkflowKit(LIGHT, NOW, 'b')`:

- `button_Click_RunsStageActionForTheKitsSession`, a table. It catches a button left on a closure, or one sent for the selected session.

  | Case | Draw | `runs` after a click |
  |---|---|---|
  | main action | `actionButton` with `{ command: 'go', main: true }` | `[{ id: 'workflow.stageAction', arg: { sessionId: 'b', action: 'mainAction' } }]` |
  | other action | `actionButton` with `{ command: 'go', main: false }` | `[{ id: 'workflow.stageAction', arg: { sessionId: 'b', action: 'go' } }]` |
  | fold | `finishedFold(…, 'x', false)` | `[{ id: 'workflow.stageAction', arg: { sessionId: 'b', action: 'toggleFinishedWaves' } }]` |

- `actionButton_main$main_Anchors $command` and `finishedFold_AnchorsTheEnginesCommand` stay as they are. They catch a hint moved onto `workflow.stageAction`.

`src/plugins/workflow/page/start.test.ts`:

- `stageAction_RunsTheGateForTheArgsSession`, a table over the engine part with one stub workflow whose stage holds action `go`. It catches a handler that reads the selected session, or one that skips `runFor`.

  | Case | Selected | Arg | Then |
  |---|---|---|---|
  | named session | `a` | `{ sessionId: 'b', action: 'go' }` | the stub's `runAction` got `('b', 'go', <b's flow>)` |
  | main action | `a` | `{ sessionId: 'b', action: 'mainAction' }` | the stub's `runAction` got `('b', 'go', <b's flow>)` |
  | unknown action | `a` | `{ sessionId: 'b', action: 'nope' }` | log ends `nothing to run for nope in <b's name>`; `runAction` not called |

- `engineKeys_RunStageActionOnTheSelectedSession`, a table with rows `mainAction` and `toggleFinishedWaves`. With `s1` selected, an `onDidRun` listener hears `workflow.stageAction` with `{ sessionId: 's1', action: <row> }`. It catches a key that calls `view.runFor` past the command.

`src/plugins/workflow/page/layout/workflow-draw.test.ts`: the three `() => undefined` arguments become a session id, `'s1'`. No new test.

`src/plugins/workflow-heavy-page.test.ts`:

- `setUp` starts Heavy with `parts: [workflowPagePart]`, so both parts share one command world and Heavy's `commands.run` reaches the engine's handler. The `runCommand` spy goes. `view.runFor` and `view.toggleFinishedWaves` run `workflow.stageAction` through the harness. Fakes stay for sessions, chat and docs. Re-verify the dependency rules of `parts` in the harness before the move.
- `commands_WithASelectedSession_RunThroughTheEngine %s`: its seven rows stay. Each now asserts that an `onDidRun` listener hears `workflow.stageAction` with `{ sessionId: 's1', action: <command> }`. It catches a key that skips the command.
- `commandWithNoSelectedSession_LogsAndRunsNothing`: in place of `runCommand` not called, assert no `workflow.stageAction` run was heard. Keep the log line and `invoked` assertions.
- `button_ChipOfUnselectedSession_RunsForItsOwnSession` and `finishedFold_Click_OpensItsSessionsWavesAndStatesIt` stay as they are. They now run through `workflow.stageAction`, and catch a button that reaches the wrong session or loses `stopPropagation`.
- `intercept_OnStageAction_WrapsKeysAndButtons`, a table. An intercept on `workflow.stageAction` records each arg and calls no `next`. It catches a route that reaches `runAction` past the command.

  | Case | Run | Intercept heard | `invoked` |
  |---|---|---|---|
  | Heavy key | `commands.clearAndMake` with `s1` selected, flow in `planReady` | `{ sessionId: 's1', action: 'clearAndMake' }` | `[]` |
  | button | click the main action on `b`'s chip, flow in `planReady` | `{ sessionId: 'b', action: 'mainAction' }` | `[]` |

`src/plugins/workflow-heavy/page/start.test.ts`, the light and medium `page/start.test.ts` files, and every `workflow-heavy/main` test: no change, since `runAction` and the channel stay.

Filtered self-tests: `workflow`, `workflow-heavy`, `workflow-light`, `workflow-medium`. No `expect` line moves.

## Done when

- `grep -rn 'RunCommand\|runCommand\|textButton(' src/plugins/workflow src/plugins/workflow-heavy src/plugins/workflow-heavy-page.test.ts` prints nothing.
- `grep -n 'stageAction' src/plugins/workflow/manifest.ts src/plugins/workflow/contract.ts src/plugins/workflow/page/start.ts` prints the declaration, the key and the handler.
- It compiles; the design doc's two passages read true; the test gate runs the tests above. The live checks are in [11](11-final-verification.md).

Commit: one commit for the group.

## Proof
