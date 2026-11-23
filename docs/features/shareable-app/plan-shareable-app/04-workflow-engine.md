# 04 — Declarative workflow engine and the built-in Checklist flow

Status: not started
Type: Task
Rung: deep · crosses the flow fold, saved flows, the countdown timers, runtime commands and keys, and the relay hook protocol
Wave: 3 · Depends on: 03
Plan: [plan.md](plan.md)

The contract is `docs/features/feature-contributions/design.md` § Picking a strategy › Workflows, § Section: workflows
(every part but § The plan capability), § The Checklist flow and § Names and types › The workflow engine. Read them in
full first. The engine keeps `MainWorkflow` and `PageWorkflow` as its internal seam. This task adds the build of both
from a `WorkflowDecl`, so a contributed declaration is a workflow. The four `workflow-*` level plugins keep running
beside it, unchanged, until 06 removes them. The plan capability (plan folder, plan watch, `readPlan`, the plan pane's
groups, `set_workflow_plan`) is 05: this task reads `flow.plan` and leaves it `null`, through `NO_PLAN_FOLD`.

All paths are under `wigley-ai-gui/`.

Files:
- modify `src/plugins/workflow/contract.ts`
- modify `src/plugins/workflow/flow.ts`
- modify `src/plugins/workflow/manifest.ts`
- modify `src/plugins/workflow/main/start.ts`
- modify `src/plugins/workflow/main/step-tool.ts`
- modify `src/plugins/workflow/main/checklist-tool.ts`
- modify `src/plugins/workflow/main/flow-store.ts`
- modify `src/plugins/workflow/page/start.ts`
- modify `src/plugins/workflow/page/workflow-view.ts`
- modify `src/plugins/workflow/page/layout/workflow-draw.ts`
- modify `src/plugins/workflow/page/layout/workflow-kit.ts`
- create `src/plugins/workflow/declared/workflows-reader.ts`
- create `src/plugins/workflow/declared/plan-format-reader.ts`
- create `src/plugins/workflow/declared/build-main.ts`
- create `src/plugins/workflow/declared/build-page.ts`
- create `src/plugins/workflow/declared/triggers.ts`
- create `src/plugins/workflow/declared/templates.ts`
- create `src/plugins/workflow/declared/plan-fold.ts`
- create `src/plugins/workflow/declared/plan-pane.ts`
- create `src/plugins/workflow/declared/uses-plan.ts`
- create `src/plugins/workflow/declared/actions.ts`
- create `src/plugins/workflow/declared/countdown.ts`
- create `src/plugins/workflow/declared/countdown-text.ts`
- create `src/plugins/workflow/declared/preview.ts`
- create `src/plugins/workflow/declared/checklist-hook.ts`
- create `src/plugins/workflow/layouts/default/layout.js` and `layout.css` (copied from `src/plugins/workflow-large/layouts/default/`)
- test `src/plugins/workflow/layouts/default/layout.test.ts` (ported from `src/plugins/workflow-large/layouts/default/layout.test.ts`)
- test `src/plugins/workflow/declared/workflows-reader.test.ts`
- test `src/plugins/workflow/declared/plan-format-reader.test.ts`
- test `src/plugins/workflow/declared/build-main.test.ts`
- test `src/plugins/workflow/declared/build-page.test.ts`
- test `src/plugins/workflow/declared/templates.test.ts`
- test `src/plugins/workflow/declared/actions.test.ts`
- test `src/plugins/workflow/declared/countdown.test.ts`
- test `src/plugins/workflow/declared/checklist-hook.test.ts`
- test `src/plugins/workflow/contract.test.ts`, `flow.test.ts`, `main/start.test.ts`, `main/step-tool.test.ts`,
  `main/checklist-tool.test.ts`, `main/flow-store.test.ts`, `page/start.test.ts`, `page/workflow-view.test.ts`,
  `page/layout/workflow-kit.test.ts` (rows added or changed)
- modify `src/plugins/auto-compact/main/agent-wait.ts` · test `src/plugins/auto-compact/main/agent-wait.test.ts`
- test `src/plugins/manifests.test.ts` (the `workflow` settings row)

Consumes:
- `contributionsMainKey`, `ContributionsMainExports.registerFeature`, `strategies`, `onChanged`, `ready`,
  `contributionsFeaturesSlot`, `FeatureReader`, `ReadResult`, `Strategy`, `WORKFLOW_LIST_CONTROL_KIND` in
  `src/plugins/contributions/contract.ts` ← 03
- `WorkflowDecl`, `StageDecl`, `TriggerDecl`, `PredicateDecl`, `CounterDecl`, `ActivityDecl`, `ActionDecl`, `PlanFormat`,
  `qualifiedWorkflowId` in `src/contracts/contributions.ts` ← 03
- `sessions.addHookHandler(name, handler)`, `HookHandler` (`src/plugins/sessions/contract.ts`), `docsPageKey.openDoc`
  (`src/plugins/docs/contract.ts`), `chatMainKey` `send`, `clear`, `launch`, `profileOf`, `isHeadless`
  (`src/plugins/chat/contract.ts`), `PageApi.commands.register` and `PageApi.keys.bind` (`src/contracts/plugin.ts`):
  already in the tree.

Produces (05 and 06 consume these by these exact names):
- In `src/plugins/workflow/contract.ts`:
  - `CHECKLIST_WORKFLOW_ID = 'checklist'`, `CHECKLIST_STAGE = 'work'`, `CHECKLIST_WORKFLOW: WorkflowDecl`.
  - `export { qualifiedWorkflowId } from '../../contracts/contributions'` (one formula, written once by 03).
  - `actionCommandShortId(workflowId: string, actionId: string): string`: the workflow id with every `:` replaced by
    `-`, then `-`, then the action id (`wigley:large`, `clearAndMake` → `wigley-large-clearAndMake`).
  - `DeclaredWorkflow { id; pluginName; decl; planFormat }` as design.md writes it.
  - `AutoStartSetting { workflow: string; seconds: number }`.
  - `SessionFlow` gains `checklistReported: boolean`, `plan: PlanState | null`, `counters: Record<string, number>`,
    `enteredFrom: StageId | null`, `countdownEndsAt: number | null`.
  - `PlanState`, `PlanProgress`, `PlanTaskLine` (types only), exactly as design.md writes them.
  - `WorkflowSignal` gains `{ type: 'planChanged'; progress: PlanProgress }`, `{ type: 'planGone' }`,
    `{ type: 'planReported'; planDir: string }` and `{ type: 'event'; event: string }`. `custom` stays until 06.
  - `MainWorkflow` gains `foldFields?(flow: SessionFlow, signal: WorkflowSignal): SessionFlow` (run after the checklist
    and before the stage rules; returns `flow` itself for no change) and `afterStage?(before: SessionFlow, next:
    SessionFlow, signal: WorkflowSignal): SessionFlow` (run after the stage rules; `before` is the flow the stage rules
    started from).
  - `WorkflowDrawOptions.badgeColor?: string`.
  - `WorkflowChannel` (`invoke: { runAction(arg: { sessionId: string; action: string }): Promise<void> }`).
  - `workflowDeclaredSlot: KeyedSlotKey<DeclaredWorkflow, 'main', 'workflow'> = { id: 'workflow.declared', process:
    'main', kind: 'keyed' }`: the enabled declared workflows, keyed by qualified id.
  - `WorkflowSelfTestHooks.addDeclared(workflow: DeclaredWorkflow): Disposable`.
  - `CHECKLIST_HOOK = 'workflow.checklist'`.
- `src/plugins/workflow/declared/plan-fold.ts`: `interface PlanFold { fold(flow: SessionFlow, signal: WorkflowSignal,
  workflow: DeclaredWorkflow, planFromArgs: boolean): PlanState | null }` and `NO_PLAN_FOLD: PlanFold` (returns
  `flow.plan`).
- `src/plugins/workflow/declared/plan-pane.ts`: `interface PlanPane { checklist(flow: SessionFlow, format: PlanFormat |
  null): ChecklistView | null }` and `NO_PLAN_PANE: PlanPane` (returns `defaultChecklist(flow)`).
- `src/plugins/workflow/declared/uses-plan.ts`: `usesPlan(decl: WorkflowDecl): boolean`.
- `src/plugins/workflow/declared/build-main.ts`: `buildMainWorkflow(workflow: DeclaredWorkflow, planFold: PlanFold):
  MainWorkflow`.
- `src/plugins/workflow/declared/build-page.ts`: `buildPageWorkflow(workflow: DeclaredWorkflow, deps: PageBuildDeps):
  PageWorkflow`, with `PageBuildDeps { draw: WorkflowDraw; planPane: PlanPane; runAction(sessionId: string, action:
  string, flow: SessionFlow): Promise<void> }`.
- `src/plugins/workflow/declared/workflows-reader.ts`: `workflowsReader: FeatureReader<WorkflowDecl[]>` and
  `declaredWorkflows(workflows: readonly Strategy<WorkflowDecl[]>[], planFormats: readonly Strategy<PlanFormat>[], off:
  readonly string[]): DeclaredWorkflow[]`.
- `src/plugins/workflow/declared/plan-format-reader.ts`: `planFormatReader: FeatureReader<PlanFormat>`.
- `src/plugins/workflow/declared/countdown-text.ts`: `countdownText(endsAt: number, now: number): string`, moved
  unchanged from `src/plugins/workflow-large/page/countdown.ts` (06 deletes the original).

Decisions:

**Readers and the enabled set**
- The workflow main part adds `contributions` to `dependsOn.main`, and registers `workflowsReader` under `workflows`
  (label `Workflows`) and `planFormatReader` under `planFormat` (label `Plan format`). The page part adds `docs` and
  `settings` to `dependsOn.page` (docs lists no `workflow` dependency, so no cycle).
- `workflowsReader.read(section)` refuses anything but an array of declarations, each checked to design.md § Workflow
  fields and § Stage fields, and refuses the whole section on any reason. Each reason starts with the path in the
  section (`[2].stages[4].enter[0]: …`). The checks:
  - `id` and every action id match `^[A-Za-z][A-Za-z0-9]*$`, because the command short id carries them.
  - `id`s are unique in the section; stage ids are unique in a workflow.
  - `order` is a number below 1000 (the Checklist flow's order is 1000).
  - `badgeColor`, when present, is a non-empty string.
  - Every skill in `claims` appears in exactly one stage's `skill` trigger.
  - A group name equal to a stage id is refused; every group member names a stage.
  - Every `from` entry names a stage or a group; every `actions` entry and every `auto` names an action of the
    workflow; `auto` also names an action of kind `send`, `clearAndSend`, `launch` or `event` (main runs it).
  - `counters.<name>.counts` names a stage and `resetOn` is `claim`; `fixCycles.counter` names a counter.
  - `status`, `tone` (a sessions `ActivityTone`), `emphasis` (`raised` or `urgent`), predicates and action kinds take
    only the listed values.
  - `reopens` needs `finishes`.
  - `send`, `clearAndSend` and `launch` need a non-empty `text`; `event` needs `event`; `then` is only on `launch`.
  - Every template's variables are in design.md § Templates; `{plan}` appears only in an action's `text`.
  - `sidePane.kind` is `checklist` or `plan`.
  A plan counter name (`records`, `counterRose`, `{plan.counter.X}`, `fixCycles.planCounter`) is not checked against
  the plugin's `planFormat`, which is another section.
- `planFormatReader.read(section)` checks each knob's type to design.md § Section: planFormat, and that
  `groupHeading.pattern` compiles as a `RegExp`. It does not apply defaults: 05's reader of plans does.
- `declaredWorkflows(...)`: for each workflow strategy in source order, each declaration in array order, a
  `DeclaredWorkflow` with `id: qualifiedWorkflowId(strategy.id, decl.id)`, `pluginName: strategy.id`, `decl`, and
  `planFormat` the value of the `planFormat` strategy with the same id, else `null`. A qualified id in `off` is left out.
- Main computes the enabled set after `contributions.ready`, and again on `onChanged('workflows')`,
  `onChanged('planFormat')` and `onSettingsChanged` (the `off` list). It publishes the set in `workflowDeclaredSlot`,
  plus every `addDeclared` entry (which ignores `off`). For each changed entry (by `JSON.stringify`) it disposes the old
  `addWorkflow` registration and adds `buildMainWorkflow(entry, NO_PLAN_FOLD)`; a removed entry is disposed. 05 passes
  its fold where this task passes `NO_PLAN_FOLD`.
- The page part builds one `PageWorkflow` per key of `workflowDeclaredSlot`, from `buildPageWorkflow(entry, { draw,
  planPane: NO_PLAN_PANE, runAction })`, and disposes it when the key leaves.

**The Checklist flow**
- `CHECKLIST_WORKFLOW`: `{ id: 'checklist', label: 'Checklist', badge: 'C', order: 1000, claims: [], sidePane: { kind:
  'checklist', title: 'Checklist' }, stages: [{ id: 'work', label: 'Checklist', status: 'busy', progress: '
  {checklist}', enter: [] }] }`. Main adds `buildMainWorkflow({ id: CHECKLIST_WORKFLOW_ID, pluginName: '', decl:
  CHECKLIST_WORKFLOW, planFormat: null }, NO_PLAN_FOLD)` at start, the page the matching page half, both before any
  declared one. It is never in `workflowDeclaredSlot` and never switched off.
- `newFlow` and `sampleFlow` start every flow with `workflow: 'checklist'`, `stage: 'work'`, `checklistReported: false`,
  `plan: null`, `counters: {}`, `enteredFrom: null`, `countdownEndsAt: null`.
- `applyClaim`: a claim from the Checklist flow leaves `movedUpFrom` null. A claim by another workflow also sets
  `plan: null`, `counters: {}`, `enteredFrom: null`, `countdownEndsAt: null`.
- `applyChecklist`: a `checklistReported` signal sets `checklistReported: true`. No claim and no `cleared` resets it.
- `markMissedLevel(flow, hasOtherWorkflow: boolean)`: sets `missedLevel` when `flow.workflow === CHECKLIST_WORKFLOW_ID`
  and `hasOtherWorkflow` (any registered workflow but the Checklist flow, the level plugins included until 06). The
  view's two `flow.workflow === null` tests for the missed level (`workflow-view.ts`, the chip and `logMissedLevel`)
  become `flow.workflow === CHECKLIST_WORKFLOW_ID`.
- The view draws no stage for a flow on the Checklist flow while `flow.checklist === null`: the chip, strip and pane
  draw as they draw a flow in `IDLE_STAGE` today.
- `auto-compact/main/agent-wait.ts`: `hasLevel` becomes `flow.workflow !== null && flow.workflow !==
  CHECKLIST_WORKFLOW_ID`.
- `flow-store.ts` load: a saved flow that lacks a new field takes the `newFlow` value for it; a saved flow with
  `workflow: null` loads as `workflow: 'checklist'`, `stage: 'work'`. A saved level-plugin flow keeps its `state`.
- `checklist-tool.ts`: `reportChecklist` resolves false only for a session with no flow. The text for that case becomes
  `Ignored the checklist: the app holds no flow for this session.` The tool stays contributed to every session, main
  agent only, with its offline answer.

**The checklist hook** (`declared/checklist-hook.ts`)
- Main calls `sessions.addHookHandler(CHECKLIST_HOOK, handler)`. The handler reads the flow of the hook's session (the
  `AgentSession`'s id) and replies:
  - no flow: `{ reported: false, open: 0, items: [] }`;
  - otherwise `reported: flow.checklistReported || flow.plan?.reported === true`;
  - `items`: `flow.checklist` when it is not null; else, when `flow.plan?.reported === true`, `flow.plan.progress?.tasks`
    mapped to `{ text, done }` (`[]` when progress is null); else `[]`;
  - `open`: the count of `items` with `done: false`.
  This is the coordinator's ruling: a reported plan counts as a reported checklist, since a plan run's checklist is its
  plan. Task 12's hook script reads this reply.

**Trigger fold** (`declared/triggers.ts`, `declared/build-main.ts`)
- `buildMainWorkflow` gives `claims(signal)`: true when `startsSkill(signal, skill)` for a skill in `decl.claims`;
  `firstStage`: the first stage holding a `skill` trigger (the Checklist flow: `work`); `stages`: one `MainStage` per
  `StageDecl`, `order` its index, `reportedAs` its `step`, `finishes` its `finishes`.
- One pure `matchTrigger(flow, signal, workflow): { stage: StageDecl; trigger: TriggerDecl | 'reopen' } | null` decides
  the stage. It runs first the reopen rule, then stages in array order and each stage's triggers in order; the first
  match wins. Each `MainStage.enter` answers from it, so `foldFlow`'s loop takes the same answer.
  - Reopen: `signal.type === 'planChanged'`, the flow's stage has `reopens`, `isBusy(flow)`, and `flow.enteredFrom` is
    not null → the stage `enteredFrom`.
  - `skill`: `startsSkill(signal, trigger.skill)`. It matches while the flow is already in its stage.
  - `step`: `signal.type === 'stepReported'` and `signal.step` is the id of a stage of this workflow whose `step` equals
    `trigger.step`. It does not match while the flow is in its stage.
  - `event`: `turnEnded` matches the `turnEnded` signal; `planChanged` and `planGone` match those signals; any other
    name matches `{ type: 'event', event: name }`. It does not match while the flow is in its stage.
  - `from`: the flow's stage is one listed, or a member of a listed group. `when`: every predicate holds.
- Predicates, read from the flow after `foldFields`: `idle` `!isBusy`; `busy` `isBusy`; `planRead` `plan?.progress
  != null`; `planHasTasks` `progress.total > 0`; `planOpen` `progress.checked < progress.total`; `{ counterRose: n }`
  `progress.counters[n] > plan.snapshots[n]` (false when either is missing).
- `foldFields(flow, signal)`:
  - `plan: planFold.fold(flow, signal, workflow, planFromArgs)`, where `planFromArgs` is true when the signal is a
    `skillStarted` that a `planFromArgs` trigger of this workflow names;
  - a `turnStarted` or `cleared` sets `countdownEndsAt: null`;
  - a `skillStarted` this workflow claims, on a flow this workflow already holds, sets each counter whose `resetOn` is
    `claim` to 0.
- `afterStage(before, next, signal)`, using `matchTrigger(before-after-foldFields, signal)`:
  - a matched trigger with `clearsPlan` sets `plan: null`;
  - a stage change sets `countdownEndsAt: null`;
  - a stage change into a counter's `counts` stage adds 1 to it;
  - a stage change into a `finishes` stage, by a trigger (not the reopen rule), sets `enteredFrom: before.stage`;
  - a match of a stage with `records`, by a trigger (not the reopen rule), sets `plan.snapshots[name]` to
    `plan.progress.counters[name]` for each name, and deletes the snapshot when progress is null (05's fold fills it on
    the first read).
  `foldFlow` calls `current.foldFields` after `applyChecklist`, then `applyStageRules`, then `current.afterStage`.
  `sameFlow` compares the new fields: `checklistReported`, `enteredFrom` and `countdownEndsAt` by value, `counters` and
  `plan` by `JSON.stringify`.
- `fixCycles(flow)`: `{ counter: n }` → `flow.counters[n] ?? 0`; `{ planCounter: n }` →
  `flow.plan?.progress?.counters[n] ?? 0`; left out → 0.

**Templates** (`declared/templates.ts`): `renderTemplate(template, flow, workflow): string` fills design.md § Templates:
`{plan}` `plan.dir`; `{plan.title}`; `{plan.checked}`, `{plan.total}`; `{plan.build}` `<checked>/<total>` over the
tasks with `verification: false`; `{plan.wave}`; `{plan.counter.<n>}`; `{counter.<n>}`; `{checklist}`
`checklistCount(flow)`. A template whose every variable is empty, null or 0 renders `''`; a template with no variable
renders as written. A `detail` part that renders `''` is left out, and the parts join with `detailLine`.

**Page half** (`declared/build-page.ts`)
- `PageWorkflow.id` the qualified id (the Checklist flow: `checklist`), `label`, `badge`, `stages` from the `StageDecl`s:
  `inStepper` (default true), `stepSlot` `slot`, `order` the index, `runsTasks`, `status` (`busy` → `busyStatus`,
  `finishing` → `finishingStatus`, `ready` → `'ready'`, `none` → null), `statusProgress` from `progress`, `chipProgress`
  from `chipProgress` else `progress`, `detail` from `detail`, `rowActivity` and `unseenActivity` with rank
  `STAGE_ACTIVITY_RANK`.
- `actions`: a stage with `auto` first gets `{ command: 'cancelCountdown', label: 'Cancel', available: countdownEndsAt
  !== null, enabled: true }`. Then each listed action, `command: actionCommandShortId(id, actionId)`, `label`,
  `keyOnly`, `available` its predicates (all hold), `enabled` its predicates. An `openPlan` action is available only
  while `flow.plan?.dir` is not null, as well. An action whose `text` holds `{plan}` is available only while
  `flow.plan?.dir` is not null.
- `checklist(flow)`: `planPane.checklist(flow, workflow.planFormat)` for a `plan` side pane, else `defaultChecklist`.
- `progressText`: checklist pane `checklistCount(flow)`; plan pane null while `flow.plan?.progress` is null, else
  `<checked>/<total>` over all boxes, then ` wave <n>` while `progress.wave` is not null, then ` review <r>` while
  `fixCycles` is `{ planCounter: X }` and `progress.counters[X] > 0`. This keeps today's Large log line.
- `hasPlan`: plan pane `flow.plan?.progress != null`; checklist pane left out.
- `countdownText(flow, now)`: null while `flow.countdownEndsAt` is null, else `countdownText(endsAt, now)`.
- `previewFlows(sessionId, now)` (`declared/preview.ts`): one sample per stage, in stage order, with the workflow and
  stage set and nothing running. A checklist-pane workflow's samples carry `sampleChecklist(['Read the code', 'Make the
  change', 'Run the tests'], 1)`. A plan-pane workflow's carry a sample `PlanState`: dir `<projectDir>/plan-sample`,
  `reported: true`, progress title `Sample plan`, five tasks in groups 1 and 2, two checked, `wave: 1`, and each
  `{plan.counter.X}` the declaration names set to 1. A stage with `auto` also gets `countdownEndsAt: now + 10000`.
- `runAction`: `cancelCountdown` and every action but `openPlan` go to main through the channel's `runAction`. `openPlan`
  opens `paths.join(plan.dir, planFormat?.file ?? 'plan.md')` with `docs.openDoc`, and throws `the session has no plan`
  while `plan.dir` is null.
- Draw: one `createWorkflowDraw(api, { manifest: workflowManifest, defaultLayout, defaultStylesheet, userLayout: () =>
  api.settings().layout, sideTitle: decl.sidePane.title, badgeColor: decl.badgeColor ?? 'var(--wg-accent)' })` per
  workflow. The kit's `badge` sets `--workflow-badge-color` to `badgeColor` when the options carry one, else to today's
  `var(--wg-<manifest id>-badge)`, so the level plugins draw as before.
- The default layout is Large's: copy `workflow-large/layouts/default/layout.js` and `layout.css` (countdown before the
  main action, the finished-waves fold, the grouped side pane) to `workflow/layouts/default/`, renaming owner selectors
  and comments from `workflow-large` to `workflow`, and port its `layout.test.ts` there. Main calls
  `api.layouts.register({ layoutTypes })`.

**Commands and keys** (page)
- For each declared action, `api.commands.register(actionCommandShortId(id, actionId), { label, group: 'workflow',
  runsIn: 'page', targets: true, risky })` (`risky` only when the declaration sets it). Its handler runs
  `workflowStageActionCommand` with `{ sessionId: targetSessionId ?? sessions.shownSessionId(), action: <short id> }`,
  and logs `no shown session for <short id>` when both are null, as `runOnSelected` does.
- An action with `key` also gets `api.keys.bind({ keys: key, scope: 'any', command: 'workflow.<short id>' })`. Both
  handles go with the workflow's page half.
- The kit's key hint for an action names `workflow.<short id>`; where the kit reads only `manifest.commands`, it also
  looks the qualified id up through `kit.keys`.
- The manifest gains `cancelCountdown: { label: 'cancel the auto-start', group: 'workflow', runsIn: 'page', targets:
  true }`, with no default key.

**Actions in main** (`declared/actions.ts`): `createDeclaredActions(deps).run(sessionId, action): Promise<boolean>`,
from `workflow-large/main/actions.ts`:
- An unknown short id rejects `Unknown workflow action <short id>`; a session with no flow rejects `No workflow flow for
  session <id>`.
- An action whose `enabled` predicates fail logs `<short id> not run in session <id>: not enabled` and resolves false.
- `send`: `chat.send(sessionId, { text, images: [] })`. `clearAndSend`: `chat.clear`, then the send unless the part
  stopped. `launch`: rejects `The session is not a chat session` with no profile; else `chat.launch({ projectDir,
  profile, message, headless: chat.isHeadless(sessionId) })`, then signals `{ type: 'event', event: then }` when
  `then` is set. `event`: signals `{ type: 'event', event }`. Each signal is `live`.
- A `text` whose `{plan}` renders empty does not run: it logs `no plan to make` and resolves false.
- `cancelCountdown` sets `countdownEndsAt: null` on the flow through `setFlowFields`.

**Countdown** (`declared/countdown.ts`, main): one observer, moved from `workflow-large/main/start.ts` and
`countdown.ts`, keyed by flow:
- It starts when a fold is `whole`, its origin is not `replay`, the session's last turn end was not replayed, the stage
  changed, the new stage has `auto`, `countdownEndsAt` is null, and `workflow.autoStart` lists the flow's workflow id:
  `countdownEndsAt = clock.now() + Math.max(1, seconds) * 1000`.
- When it fires, it sets `countdownEndsAt: null` and runs the stage's `auto` action through `createDeclaredActions`,
  logging `ran <short id> in <session name>`, or `auto-start failed: <errorText>`.
- A replay of the session, a settings change that drops the workflow from `autoStart`, and a part stop cancel it.
- Flow writes go through one new internal store call, `setFlowFields(sessionId, patch)`, which keeps the save time as
  `setState` does today.

**`set_workflow_step`** (`main/step-tool.ts`): the description becomes `Set this session's step in its workflow, so the
app shows it. Call it each time a skill moves to one of these steps.` The step union, the re-contribution on every
`addWorkflow` and dispose, and the success and ignore texts stay as they are. With the enabled set re-added on each
switch, the tool follows `workflow.off`.

**Settings** (`manifest.ts`): `settings: { off: [] as string[], autoStart: [] as AutoStartSetting[], layout: 'default'
}`, `settingControls: { off: WORKFLOW_LIST_CONTROL_KIND, autoStart: 'json', layout: 'layout' }`, and `settingInfo`:
- `off`: label `Workflows off`, description `The declared workflows that do not run, each as plugin:workflow.`
- `autoStart`: label `Auto-start`, description `The declared workflows whose ready stage runs its action by itself
  after a countdown: a list of { "workflow", "seconds" }, seconds at least 1.`
- `layout`: label `Workflow layout`, description `The layout that draws every declared workflow's chip, composer strip
  and side pane: a folder in the layouts/workflow folder, or default.`

Out of this task: the session note's wording (`main/session-note.ts`) is task 11's, which depends on this task. The
removal of the level plugins, of `workflow-large.*` keys in `src/plugins/keymap.ts`, and of their settings is 06's.

GIVEN a fresh flow WHEN the agent calls `set_workflow_checklist` THEN the flow stays on `checklist`/`work`,
`checklistReported` is true, and the `workflow.checklist` hook replies `reported: true` with the open count.

GIVEN a make lead's flow with `plan.reported: true` and no checklist sent WHEN the hook asks THEN it replies
`reported: true`, with `items` from the plan's tasks, so the lead's edits are not gated.

GIVEN the design's Medium declaration WHEN a `stepReported fix` folds twice from `review`, with `build` between THEN
`counters.fix` is 2, the fix stage's status line ends ` · cycle 2`, and a new `wigley:medium` start sets it to 0.

GIVEN the design's Large declaration with `autoStart: [{ workflow: 'wigley:large', seconds: 3 }]` WHEN a live
`turnEnded` moves the flow into `planReady` with a plan of tasks THEN `countdownEndsAt` is now + 3000, and after 3 s
the `clearAndMake` action runs `chat.clear` then `chat.send('/wigley:make <plan dir>')`.

GIVEN `workflow.off: ['wigley:small']` WHEN the setting changes THEN `wigley:small` leaves `workflow.declared`,
`set_workflow_step`'s enum drops the steps only it declares, and its runtime commands and keys are disposed.

Tests (each names the break it catches; fixtures are the design's Small, Medium, Spike and Large examples as test data,
which the boundary rule allows):
- `contract.test.ts` › `actionCommandShortId` and `qualifiedWorkflowId` — `('wigley:large', 'clearAndMake')` →
  `wigley-large-clearAndMake`; `('wigley', 'large')` → `wigley:large`.
- `workflows-reader.test.ts` › refusals — one table, one bad field per row, each asserting the exact reason with its
  path: a claim in no `skill` trigger; a claim in two; a group named like a stage; a `from` naming nothing; an `auto`
  naming an `openPlan` action; `reopens` without `finishes`; `send` with no `text`; an unknown template variable; an
  id with `-`; `order: 1000`. Catches a reader that accepts a declaration the engine cannot run.
- `workflows-reader.test.ts` › the four design examples pass, and `declaredWorkflows` qualifies ids, joins the same
  plugin's `planFormat`, and leaves out an `off` id.
- `plan-format-reader.test.ts` › the design's `planFormat` passes; a `groupHeading.pattern` that does not compile is
  refused.
- `build-main.test.ts` › trigger rules — one table over the Large example: an own skill re-enters its stage and applies
  `clearsPlan` again; a `step` trigger does not match while in its stage, so a later stage's trigger wins; a `from`
  group gates `interview`; `planReady` needs `idle` and `planHasTasks`; `review` enters on `counterRose`; `closed`
  sets `enteredFrom`; a busy `planChanged` in `closed` reopens to `enteredFrom`; a `records` stage snapshots the counter
  and a reopen does not. Catches each of design.md's three re-entry rules.
- `build-main.test.ts` › counters — the Medium GIVEN.
- `flow.test.ts` › add rows: a new flow is on `checklist`/`work`; a claim from the Checklist flow leaves `movedUpFrom`
  null; `checklistReported` survives a claim; `markMissedLevel` marks only with another workflow registered.
- `templates.test.ts` › one table over every variable, the all-empty rule, and `{plan.build}` leaving out the
  verification task.
- `build-page.test.ts` › status, progress, detail, activities and actions of the Small and Large examples; an
  `openPlan` action is hidden while `plan.dir` is null; `progressText` gives `3/8 wave 2 review 1` for the plan pane and
  `1/3` for the checklist pane; previews give one sample per stage.
- `actions.test.ts` › ported from `workflow-large/main/actions.test.ts`: each kind's chat calls, the `then` event, the
  `enabled` refusal, `no plan to make`, and the stopped part.
- `countdown.test.ts` › the Large GIVEN with fake timers; a replayed turn end starts none; a workflow not in
  `autoStart` starts none; `turnStarted` cancels.
- `checklist-hook.test.ts` › the two hook GIVENs, a session with no flow, and a checklist that wins over a reported
  plan.
- `main/start.test.ts` › add rows: the `workflow.off` GIVEN; `addDeclared` publishes into `workflow.declared` and
  ignores `off`; a declared workflow from the contributions fake draws a step tool enum holding its steps.
- `step-tool.test.ts` › the description names no plugin.
- `checklist-tool.test.ts` › a fresh flow's report succeeds; a session with no flow gets the new ignore text.
- `flow-store.test.ts` › add rows: a saved flow with no new fields loads with their defaults; a saved `workflow: null`
  loads on the Checklist flow.
- `page/start.test.ts` › add rows: a declared action registers `workflow.<short id>` and its key, and a dispose of the
  workflow removes both.
- `workflow-view.test.ts` › add rows: the chip draws no stage on the Checklist flow until a checklist arrives; the
  missed-level tag shows on the Checklist flow.
- `workflow-kit.test.ts` › add a row: `badgeColor` sets `--workflow-badge-color`.
- `layout.test.ts` (ported) › every Large layout test, against the shared layout.
- `agent-wait.test.ts` › add a row: a flow on the Checklist flow has no level.
- `manifests.test.ts` › the `workflow` settings keys are `autoStart`, `layout`, `off`.

Verification:
- `npm run typecheck`
- `npm test -- src/plugins/workflow src/plugins/auto-compact src/plugins/manifests.test.ts src/plugins/workflow-large-main.test.ts src/plugins/workflow-large-page.test.ts src/plugins/workflow-levels.test.ts`
  (the level plugins' tests still pass: they run beside the engine until 06)
- `npm run lint`
- `grep -rn "wigley" src/plugins/workflow --include='*.ts' --include='*.js' | grep -v '\.test\.ts'` prints nothing.

Done when: compiles; lint passes; the tests above pass; the four level plugins' tests still pass.

Commit: one commit for the group.

## Proof

