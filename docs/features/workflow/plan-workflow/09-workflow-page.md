# 09 — Workflow page: row chip, composer strip, Flow tab, keys, preview

Status: not started
Type: Task
Wave: 4 · Depends on: 06, 08
Plan: [plan.md](plan.md)

Files:     create `src/plugins/workflow/layouts/layout.d.ts` · create `src/plugins/workflow/layouts/default/layout.js` ·
           create `src/plugins/workflow/page/start.ts` · create `src/plugins/workflow/page/workflow-view.ts` ·
           create `src/plugins/workflow/page/flow-tab.ts` · create `src/plugins/workflow/page/preview.ts` ·
           create `src/plugins/workflow/page/countdown.ts` · create `src/plugins/workflow/page/workflow.css` ·
           create `src/plugins/workflow/page/layout/workflow-parts.ts` ·
           create `src/plugins/workflow/page/layout/workflow-kit.ts` ·
           create `src/plugins/workflow/page/layout/read-workflow-layout.ts` ·
           modify `src/plugins/workflow/main/start.ts` (the `api.layouts.register` call only) ·
           modify `src/plugins/keymap.ts` · modify `src/plugins/page.ts` · modify `docs/keymap.md` ·
           test `src/plugins/workflow/page/workflow-view.test.ts` · test `src/plugins/workflow/page/flow-tab.test.ts` ·
           test `src/plugins/workflow/page/countdown.test.ts` · test `src/plugins/workflow/page/preview.test.ts` ·
           test `src/plugins/workflow/page/layout/read-workflow-layout.test.ts`
Consumes:  `SessionPart`, `SessionsPageExports.addRowPart(part: SessionPart): Disposable` (in the tree)
           the agents page pattern: `createSubagentLines`'s held wrappers, its one-second ticker on `services.timers`,
           and its once-per-change page log line ← subagent-lines task 09
           `ChatComposerPart`, `ChatPageExports.fillComposer(sessionId: string, text: string): void`,
           `ChatPageExports.addComposerPart(part: ChatComposerPart): Disposable`, `CHAT_PREVIEW_HOST_ID`, and the
           rule that a composer part is built only inside a Chat tab's composer, for that tab's session ← 06
           `StageId`, `IDLE_STAGE`, `SessionFlow`, `isBusy`, `PageStage` (with `order`), `StageActionSpec` (with
           `available` and `enabled`), `WorkflowPageExports`, the workflow channel (`flows` message,
           `runAction({ sessionId, command })`, `flows()`), and `newFlow` ← 03
           `PlanProgress` (with `tasks`) ← 02
           `BUILT_IN_PAGE_STAGES` in `stages/index.ts` ← 07
           `workflowManifest` (commands with the four Flow tab scroll commands and `openPreview`, scopes, settings),
           the `check-layers` entries for `src/plugins/workflow/page`, `src/plugins/workflow/layouts` and
           `src/plugins/page.ts` ← 08
           in the tree: `SessionsPageExports.addTab` / `selectedSessionId` / `SessionTabHandle.setStatus` / `remove`,
           `SessionsPageEvents.sessionAdded` / `sessionRemoved`, `KeysPageExports.anchor`, `DocsPageExports.openDoc`,
           `createBaseKit` / `ownerBaseKitDeps` / `createLayoutParts` / `readLayoutParts`, `ButtonVariant`
           (`src/shared/page/layout-host/kit.d.ts`), `scrollContent` / `scrollText` (`src/shared/content-scroll.ts`),
           the `chat.openPreview` command
Produces:  in `src/plugins/workflow/layouts/layout.d.ts`:
           `export interface StepInput { id: string; label: string; state: 'done' | 'current' | 'ahead' }`
           `export interface ActionInput { command: string; label: string; enabled: boolean; main: boolean }`
           `export interface ChipInput { stage: string; label: string; detail: string; countdown: string | null; mainAction: ActionInput | null }`
           `export interface StripInput { stage: string; label: string; detail: string; countdown: string | null; steps: readonly StepInput[]; actions: readonly ActionInput[] }`
           `export interface PlanTaskInput { text: string; done: boolean }`
           `export interface PlanWaveInput { title: string; tasks: readonly PlanTaskInput[]; current: boolean }`
           `export interface FlowTabInput { stage: string; label: string; detail: string; countdown: string | null; planTitle: string | null; steps: readonly StepInput[]; waves: readonly PlanWaveInput[]; actions: readonly ActionInput[] }`
           `export interface ActionButtonOptions { anchor?: boolean; variant?: ButtonVariant }`
           `export interface WorkflowKit extends BaseKit { actionButton(parent: HTMLElement, action: ActionInput, options?: ActionButtonOptions): HTMLButtonElement; stepper(parent: HTMLElement, steps: readonly StepInput[]): HTMLElement; countdown(parent: HTMLElement, text: string): HTMLElement }`
           `export interface WorkflowPart { element: HTMLElement }`
           `export interface Layout { chip?(parent: HTMLElement, input: ChipInput, kit: WorkflowKit): WorkflowPart; strip?(parent: HTMLElement, input: StripInput, kit: WorkflowKit): WorkflowPart; flowTab?(parent: HTMLElement, input: FlowTabInput, kit: WorkflowKit): WorkflowPart }`
           `export interface CompleteLayout extends Required<Layout> {}`
           in `src/plugins/workflow/page/countdown.ts`: `export function countdownText(endsAt: number, now: number): string;`
           in `src/plugins/workflow/page/workflow-view.ts`:
           `export function createWorkflowView(deps: WorkflowViewDeps): WorkflowView;`
           `export interface WorkflowView { chipPart: SessionPart; stripPart: ChatComposerPart; setFlow(flow: SessionFlow): void; forget(sessionId: string): void; setLayouts(shown: ShownLayouts<Layout>): void; mainAction(flow: SessionFlow): StageActionSpec | null; runFor(sessionId: string, command: string): Promise<void> }`
           in `src/plugins/workflow/page/flow-tab.ts`:
           `export function createFlowTabs(deps: FlowTabsDeps): FlowTabs;` with
           `export interface FlowTabs { chatTabBuilt(sessionId: string): void; setFlow(flow: SessionFlow): void; redraw(): void; remove(sessionId: string): void }`
           in `src/plugins/workflow/page/preview.ts`:
           `export const PREVIEW_STAGES: readonly StageId[];` ·
           `export function previewFlow(index: number, sessionId: string, now: number, autoStartSeconds: number): SessionFlow;`
           in `src/plugins/workflow/page/layout/read-workflow-layout.ts`:
           `export function readWorkflowLayout(module: unknown, name: string): Layout;`
           in `src/plugins/workflow/page/start.ts`: `export const workflowPagePart: PagePart<typeof workflowManifest>`
           with exports `WorkflowPageExports`
Decisions:
- **Stage registry.** `start.ts` keeps the page halves in a list sorted on `PageStage.order`, ascending. A stage
  with the same `order` as a held one goes after it. `addStage(stage: PageStage): Disposable` inserts the stage at its
  place in that order. It throws `stage <id> is already added` on a held id. It redraws every held part. Its
  `Disposable` removes the stage and redraws. `start.ts` registers every entry of `BUILT_IN_PAGE_STAGES` through this
  same `addStage` before it reads the channel. A flow whose `stage` names no registered page half draws as
  `IDLE_STAGE` and logs `[workflow] no page stage <id>` once per id.
- **Flows.** `start.ts` holds a `Map<sessionId, SessionFlow>`. It hears `api.channel.on('flows', …)` and replaces each
  flow it carries, then invokes `flows()`. The answer applies only to sessions that no `flows` push touched since the
  call (the stale-read rule of `sessions/page/start.ts`). A failed read logs `[workflow] flows not read: <error>`.
  A session with no flow reads as `newFlow(sessionId, projectDir ?? '')` (03; `flow.ts` is pure, so the page imports
  it). `sessions.sessionRemoved` deletes the flow and the name, calls `flowTabs.remove` and calls `view.forget`.
- **Names.** As agents task 09: `sessionAdded` fills a map with `api.services.paths.base(projectDir)`, or the sessionId
  when `projectDir` is null. Every log line below names the session by this name.
- **Busy.** The page reads busy only through `isBusy(flow)` (03). It never reads `turnRunning` or
  `runningSubagents` itself. Each built-in action's `enabled(flow)` is built over `isBusy` (07). The countdown draws
  from `countdownEndsAt`, which main sets only while the flow is not busy and clears when a turn starts.
- **Inputs.** `workflow-view.ts` builds each input from the flow and the page stages. Each input has one function,
  reached only through the view:
  - `steps`: every page stage with `inStepper`, in order. The flow's stage is `current`, the stages before it are
    `done`, and the stages after it are `ahead`. Idle is not in the stepper, so in idle every step is `ahead`.
  - `actions`: the stage's `actions` whose `available(flow)` is true, in order. Each `ActionInput` has
    `enabled: spec.enabled(flow)`. The first has `main: true`. The countdown's Cancel is plan ready's own first action
    (07), so the page adds no action of its own.
  - `countdown`: `countdownText(flow.countdownEndsAt, clock.now())` while `countdownEndsAt` is non-null, else null.
  - `detail`: the page stage's `detail(flow)`.
  - `waves`: from `flow.progress.tasks`, grouped by `wave` in file order. A task with `wave: null` goes in a group
    titled `Tasks`. The other groups are titled `Wave <n>`. `current` is true for the group whose number equals
    `progress.wave`. The list is empty while `progress` is null.
- **Plan checklist source.** Main sends the parsed checklist in `SessionFlow.progress.tasks` (02). The page never
  reads `plan.md`. Main already reads it on each change for the counts, and the page redraws on the same `flows` push.
- **`mainAction(flow)`** returns the spec of the first action of the flow's page stage whose `available(flow)` is
  true, or null when there is none. It does not read `enabled`. So in plan ready while busy, it returns Clear & make,
  which is disabled. It never falls through to Make in new session.
- **`runFor(sessionId, command)`** is the one path that runs a workflow command:
  1. When the session shows the preview, log `[workflow] preview runs nothing for <command>` and stop.
  2. Read the session's flow (or the idle shape). For `mainAction`, take `mainAction(flow)`. For any other command,
     take the available action with that `command`.
  3. When there is no such action, or its `enabled(flow)` is false, log
     `[workflow] nothing to run for <command> in <name>` and stop. `<command>` is the command that was asked for, so
     a busy `ww` logs `nothing to run for mainAction in <name>`.
  4. Run the action by its `side`:
     - `page`: `startFeature` runs `chat.fillComposer(sessionId, '/wigley:feature ')`. `openPlan` runs
       `docs.openDoc(paths.join(planDir, 'plan.md'))`.
     - `main`: `api.channel.invoke('runAction', { sessionId, command: <the action's command> })`.
  5. Log `[workflow] ran <the action's command> in <name>` when the action is done (a page action returned, or
     `runAction` resolved). When it rejects, log `[workflow] <the action's command> not run in <name>: <error>` and
     show the toast `Workflow: <error>` (`'error'`).
- **Who a press acts on.** Every button runs for the session it is drawn for. Only keys use `selectedSessionId()`.
  - Keys: each command handler calls `runFor(selectedSessionId(), <command>)`. When `selectedSessionId()` is null, it
    logs `[workflow] no selected session for <command>` and runs nothing.
  - Buttons: each part draw (chip, strip, Flow tab) builds its own workflow kit with
    `run = (command) => view.runFor(sessionId, command)`, where `sessionId` is the session that part draws. A chip
    under a row that is not selected, and a strip in a chat pane that is not focused, so run for their own session.
- **Row chip** (`chipPart`, id `workflow.chip`), built as agents' lines are: held wrappers by sessionId. A draw
  disposes the wrapper's previous draw and draws `chip` through `createLayoutParts` (owner `workflow`). Idle draws
  nothing into the wrapper (design § Where it draws). The chip's kit scope is null (no scope, so its prompts always
  show). Its main action draws through `kit.actionButton(parent, mainAction, { anchor: false, variant: 'ghost' })`.
  The click stops its propagation (see Kit), so a press runs the action and does not also select the row. A click
  elsewhere on the chip bubbles to the row and selects the session.
- **Composer strip** (`stripPart`, id `workflow.strip`): held wrappers by sessionId. It draws `strip` in every stage,
  idle included. Idle's input gives `stage: 'idle'`, and the default layout draws only a dim Start feature button
  (`ghost` variant, `workflow-strip--idle`). Kit scope null. The first thing `stripPart.build(parent, sessionId)`
  does is call `flowTabs.chatTabBuilt(sessionId)`, before it draws, so a strip layout that throws still counts.
- **Flow tab** (`flow-tab.ts`). The Flow tab is never a session's first tab. Chat builds a composer part only inside a
  Chat tab's composer (06), and chat's `createTab` (`src/plugins/chat/page/chat-view.ts`) draws the composer just
  before it calls `sessions.addTab` for the Chat tab, in the same call. So a strip build for a session means that its
  Chat tab is added once the current call returns. `createFlowTabs` holds that rule:
  - It keeps the set of sessions whose strip was built, and one `FlowTab` per session that has one.
  - `chatTabBuilt(sessionId)` adds the session to the set. When the held flow for that session has
    `hasLeftIdle: true` and the session has no Flow tab, it schedules the add with `services.timers.set(add, 0)`, so
    the add runs after chat's `addTab`.
  - `setFlow(flow)` adds the Flow tab at once when `flow.hasLeftIdle` is true, the session is in the set, and it has
    no Flow tab. Otherwise it only redraws the session's Flow tab when there is one. A flow for a session not in the
    set waits for `chatTabBuilt`.
  - The add calls `sessions.addTab(sessionId, view)` with `id` `workflow.flow`, `title` `Flow`, `icon` `checklist`.
    `beforeClose` returns true. `shown` runs `api.keys.setScope('flow')`, `api.panes.setResizeTarget(null)` and
    `api.panes.setFocusTarget(null)`, and logs `[workflow] Flow tab shown in <name>`. The add logs
    `[workflow] Flow tab added in <name>`.
  - The tab stays from then on (design § Where it draws). `remove(sessionId)` removes the tab and forgets the session;
    `start.ts` calls it on `sessionRemoved` and when the preview closes.
  - Each draw redraws `flowTab` into the tab element's scroll body and calls `setStatus(<page stage label>)`, plus
    ` · <countdown>` while one shows. Its kit scope is `flow`.
  - Docs adds its Docs tab on `sessions.sessionAdded` (`src/plugins/docs/page/start.ts`), before any flow leaves
    idle, and chat selects its Chat tab when it adds it. So a session's tabs are Chat and Docs in either order, then
    Flow last. `addTab` selects only a session's first tab, so the Flow tab never opens selected. 10's tab steps rest
    on this order.
- **Countdown.** `countdownText(endsAt, now)` is the whole seconds left, rounded up, as `<s>s`. At or past zero it is
  `0s`. There is one ticker for the whole page, as in agents task 09: one `services.timers.set(tick, 1000)`. It is
  scheduled when a draw leaves a countdown on screen (chip, strip or tab) and no tick is pending. Each tick redraws
  every part that shows a countdown, and schedules the next tick while one still shows. It is cleared when none
  shows. The page runs nothing at zero: main runs Clear & make on its own timers and pushes the new flow.
- **Log lines** (the self-test's anchors, 10; plain `api.services.log('workflow', …)`):
  - `[workflow] <name> shows <stage id>`, logged when the flow's stage differs from the last one logged for that
    session. A session with no line logged yet counts as different, so its first flow logs. The self-test matches
    whole lines, so this line carries no copy.
  - `[workflow] <name> progress <checked>/<total>`, plus ` wave <n>` when `wave` is not null and ` review <r>` when
    `reviewRounds` is above 0. It is logged when that text differs from the last one logged for the session. Nothing
    is logged while `progress` is null.
  - `[workflow] countdown shown in <name>` when a flow's `countdownEndsAt` goes from null to a time;
    `[workflow] countdown stopped in <name>` when it goes back to null.
  - `[workflow] Flow tab added in <name>`, and `[workflow] Flow tab shown in <name>` in each `shown`.
  - the `runFor` lines: `ran <command> in <name>`, `<command> not run in <name>: <error>`,
    `nothing to run for <command> in <name>`, `preview runs nothing for <command>`, and
    `no selected session for <command>`.
  - the preview's three lines (below).
- **Commands.** The handlers are `mainAction`, `clearAndMake`, `cancelCountdown`, `makeInNewSession`, `resumeMake`,
  `openPlan`, `retro`, `startFeature` and `dismiss`, each a key handler on the selected session as Who a press acts
  on says;
  `openPreview` (below); and the Flow tab's `lineDown`, `lineUp`, `halfPageDown` and `halfPageUp`, which scroll the
  visible Flow tab's body through `scrollContent` / `scrollText` as the gallery's do. 08's manifest declares all of
  them.
- **Keys** (`src/plugins/keymap.ts`):
  - `groups` gains `'<Leader>w': 'workflow'`.
  - A new banner section `// ── Workflow ──…` goes after `// ── Tabs and sessions ──`. Each bind in it has
    `scope: 'any'` and the default `where`. A leader bind fires on the page and in a box's normal mode, so the strip
    under the chat box reaches them. The binds: `<Leader>ww` `workflow.mainAction`, `<Leader>wn`
    `workflow.makeInNewSession`, `<Leader>wr` `workflow.resumeMake`, `<Leader>wo` `workflow.openPlan`, `<Leader>wt`
    `workflow.retro`, `<Leader>wf` `workflow.startFeature`, `<Leader>wd` `workflow.dismiss` (design § Keys, verbatim).
  - In the same section: `<C-j>` `workflow.lineDown`, `<C-k>` `workflow.lineUp`, `<C-S-j>` `workflow.halfPageDown`,
    `<C-S-k>` `workflow.halfPageUp`, each `scope: 'workflow.flow'` (docs/keymap.md § Layers: every view that scrolls
    its content takes them).
  - Under `// ── Debug and testing ──`, after `<Leader>zlc` (and after agents' `<Leader>zla` once it lands):
    `{ keys: '<Leader>zlw', scope: 'any', command: 'workflow.openPreview', where: 'page' }`.
  - `docs/keymap.md`: add `zlw workflow preview` to the `zl` row (the `w` row is already written ahead).
- **Anchors.** Leader sequences and vim's own keys are left out of the placement gate (AGENTS.md § Key hints), so no
  workflow bind can fail it. The design still places each key where it acts (design § Keys). `kit.actionButton`
  draws a control hint inside the button through `kit.keyHint(button, <command id>)`, where `<command id>` is the
  qualified `workflow.<command>`. The main action's button anchors `workflow.mainAction`, so it prints `Space w w`.
  Every other button anchors its own command. `clearAndMake` and `cancelCountdown` have no key of their own, so they
  draw a hint only on the main button. Strip and Flow tab buttons carry anchors. The row chip's button passes
  `anchor: false` and carries none: the side bar is too narrow, and the strip already shows the key.
- **Kit** (`workflow-kit.ts`): `createWorkflowKit(services, scope, rollback, run)` over `createBaseKit(ownerBaseKitDeps(
  workflowManifest, services, scope, rollback))`. Each part draw builds its own kit (see Who a press acts on). It
  adds:
  - `actionButton(parent, action, options)`: `button.ui-button` with the action's label. The variant is
    `options.variant` when given, else `primary` when `action.main`, else `secondary`. The hint is drawn unless
    `options.anchor` is false. The button is `disabled` when `!action.enabled`. A click calls
    `event.stopPropagation()`, then `run(action.main ? 'mainAction' : action.command)`, so the main button and `ww`
    take the same path.
  - `stepper(parent, steps)`: `ol.workflow-stepper`, one `li.workflow-step` per step with `data-state` and the label.
  - `countdown(parent, text)`: `span.workflow-countdown` with `font-variant-numeric: tabular-nums`.
- **Layout contract** header comment (as subagent-lines task 09's): what each part draws, that each root carries
  `data-layout` and `data-layout-owner="workflow"`, and what the app keeps: the stage, the flows, the commands and
  their keys, the session each button runs for, the countdown's ticking and its text, the tab's status line and
  scrolling. `layout.d.ts` imports `BaseKit` and `ButtonVariant` from `'../kit'`.
- **Layout types in main.** `src/plugins/workflow/main/start.ts` gains
  `import layoutTypes from '../layouts/layout.d.ts?raw';` and `api.layouts.register({ layoutTypes })` in `start`, as
  `src/plugins/settings/main/start.ts` does (08 left this call to this task).
- **Default layout** (`// @ts-check`, `/** @type {import('../layout').CompleteLayout} */`):
  - `chip`: `div.workflow-chip`: `kit.tag(label, 'accent')`, `span.workflow-chip-detail` (`detail`), the countdown
    while non-null, and the main action through `kit.actionButton(chip, mainAction, { anchor: false, variant:
    'ghost' })` when `mainAction` is not null.
  - `strip`: `div.workflow-strip` (`workflow-strip--idle` in idle). Outside idle: the stepper, the detail, the
    countdown, then each action through `kit.actionButton`. In idle: the one Start feature action button.
  - `flowTab`: `div.workflow-flow`: `kit.sectionHeader(planTitle ?? label)`, the stepper, the detail and countdown,
    then one section per wave (`kit.sectionHeader(title)`, then a `ul` of rows: `kit.row` density `list` with a
    leading `codicon-pass-filled` icon when done, `codicon-circle-large` when open). The current wave's header
    carries `is-current`. Then the actions. With no waves, `kit.emptyState(parent, 'No plan yet')`.
- **Reader**: `readWorkflowLayout` over `readLayoutParts` with
  `LAYOUT_PARTS: Record<keyof Layout, true> = { chip: true, strip: true, flowTab: true }`.
- **Show**: `api.layouts.show<Layout>({ defaultLayout, read: readWorkflowLayout, userLayout: () =>
  api.settings().layout, setLayouts: (shown) => { view.setLayouts(shown); flowTabs.redraw() } })`.
- **CSS** (`workflow.css`, tokens only; check each name against `src/config/themes/`): chip one line, gap
  `--wg-space-2`, `min-height: var(--wg-row-tree)`, detail `--wg-fg-tertiary` ellipsized; strip a wrapping flex row,
  gap `--wg-space-2`, padding `--wg-space-1` `--wg-space-2`, border-bottom `--wg-border-subtle`; idle strip
  `--wg-fg-tertiary`; steps `--wg-fg-tertiary` ahead, `--wg-fg-secondary` done, `--wg-accent` and
  `--wg-weight-semibold` current; countdown `--wg-status-warning`; Flow tab body scrolls (`overflow-y: auto`), padding
  `--wg-space-4`, font `--wg-text-13`.
- **Preview** (`Space z l w`, `workflow.openPreview`). It runs on chat's preview session. That is the only sample
  session with a Chat tab, so it is the only one with a composer for the strip:
  - `PREVIEW_STAGES` is `['idle', 'primer', 'feature', 'planReady', 'planReady', 'make', 'review', 'closed']`. The
    second `planReady` carries the countdown. These ids are the built-in stages' ids and live in `page/preview.ts`,
    a sample, not core logic (plan.md boundary rule exception).
  - `previewFlow(index, sessionId, now, autoStartSeconds)` returns the sample: `projectDir` `Workflow preview`,
    `hasLeftIdle` true (idle included, so the Flow tab exists from the first press), `turnRunning` false,
    `runningSubagents` `[]`, `planDir` `~/docs/features/preview/plan-preview` from `feature` on (null before),
    `progress` null before `feature`, then `{ checked, total: 7, wave, reviewRounds, title: 'Preview plan', tasks }`
    with seven tasks over three waves: checked 0 wave 1 through `planReady`, checked 3 wave 2 at `make`, checked 6
    wave 3 reviewRounds 1 at `review`, checked 7 wave null at `closed`. `countdownEndsAt` is
    `now + autoStartSeconds * 1000` on index 4 only.
  - The first press runs `api.commands.run('chat.openPreview')` and waits for the session whose `sessionAdded` has
    `hostSessionId === CHAT_PREVIEW_HOST_ID` (06), or uses it at once when it is held. It draws index 0 over that
    session and logs `[workflow] workflow preview step 1 of 8: idle`. Each next press shows the next index and logs
    `step <n> of 8: <stage>`. The press after the last drops the sample, calls `flowTabs.remove` for the preview
    session, and logs `[workflow] workflow preview closed`. The chat preview row stays, as chat's own.
  - While the preview shows, its sample wins over any pushed flow for that session, and `runFor` on that session
    logs `[workflow] preview runs nothing for <command>` and does nothing.
- **Registration**: `workflowPagePart` joins `pageParts` in `src/plugins/page.ts` after `agentsPagePart`. 08 writes
  every `check-layers` entry, the `src/plugins/page.ts` entry included, so this task does not edit
  `scripts/check-layers.mts`. When `npm run lint` shows the page needs a layer that 08's entry lacks, report it as a
  contract change for 08; do not add it here.

GIVEN a flow in planReady with a plan of 7 tasks and nothing busy WHEN it arrives THEN the chip draws Plan ready with
its detail and an enabled Clear & make button, the strip lights Plan ready with Clear & make first, and
`[workflow] proj shows planReady` and `[workflow] proj progress 0/7 wave 1` are each logged once.
GIVEN the same flow while busy (a turn runs, or a subagent runs) WHEN it draws THEN Clear & make is still the first
button and is disabled; WHEN `ww` runs THEN no `runAction` is invoked and
`[workflow] nothing to run for mainAction in proj` is logged.
GIVEN an idle flow WHEN the row draws THEN the chip wrapper is empty and the strip draws one Start feature button.
GIVEN a flow whose `countdownEndsAt` is 10 000 ms ahead WHEN it draws THEN the strip shows `10s` and Cancel as the
main action; WHEN a tick fires 1 s later THEN it shows `9s`; WHEN the flow arrives with `countdownEndsAt` null THEN the
pending tick is cleared.
GIVEN session `b` in planReady and session `a` selected WHEN `b`'s chip button is clicked THEN
`runAction({ sessionId: 'b', command: 'clearAndMake' })` is invoked.
GIVEN a session's flow with `hasLeftIdle` true WHEN it arrives before the session's strip is built THEN no Flow tab is
added; WHEN the strip is then built and the zero-delay timer fires THEN one Flow tab is added; a later flow adds none.
GIVEN the selected session in planReady WHEN the `mainAction` command runs THEN
`runAction({ sessionId, command: 'clearAndMake' })` is invoked; in idle THEN
`fillComposer(sessionId, '/wigley:feature ')` runs.

Tests:
- `countdown.test.ts`: `it.each` `'$left ms → $text'`, catching a floor in place of a ceiling or a negative shown:
  rows 10000 → `10s`, 9001 → `10s`, 9000 → `9s`, 1 → `1s`, 0 → `0s`, -1500 → `0s`.
- `workflow-view.test.ts` (fake DOM via `installFakeDom`, fake timers recording `set`/`clear`, fake clock,
  `recordingAnchors`, the page stages from `BUILT_IN_PAGE_STAGES`, a fake channel recording `runAction`):
  - `actions_TableOfFlows_ListsAvailableActionsMainFirst`: `it.each` over (stage, busy cause, countdown) → expected
    `command:enabled` list. It catches a Clear & make that hides or stays enabled while busy, and a dropped Cancel.
    Rows: planReady/none/none → `clearAndMake:true, makeInNewSession:true, openPlan:true`; planReady/turn/none →
    `clearAndMake:false, makeInNewSession:true, openPlan:true`; planReady/subagent/none → the same as the turn row;
    planReady/none/10 s → `cancelCountdown:true, clearAndMake:true, makeInNewSession:true, openPlan:true`; make with
    1/3 ticked/subagent/none → `resumeMake:false, openPlan:true`; idle/none/none → `startFeature:true`. The rows
    rest on 07's specs; when one differs from 07, report it.
  - `runFor_$case`: `it.each` over (stage, busy, command) → the recorded call or log line. Rows: planReady, not
    busy, `mainAction` → `runAction clearAndMake`; planReady, busy, `mainAction` → no call and
    `nothing to run for mainAction in proj`; planReady, busy, `makeInNewSession` → `runAction makeInNewSession`;
    make with 3/3 ticked, not busy, `resumeMake` → no call and `nothing to run for resumeMake in proj`; idle,
    not busy, `mainAction` → `fillComposer`. It catches `ww` falling through to a second action.
  - `button_ChipOfUnselectedSession_RunsForItsOwnSession`: two sessions, `a` selected, a click on `b`'s chip button
    records `runAction({ sessionId: 'b', … })` and a click event that does not reach the row. It catches a button
    that reads `selectedSessionId()`.
  - `chip_IdleFlow_DrawsNothing` and `strip_IdleFlow_DrawsStartFeatureOnly`, as one `it.each` over the two parts.
  - `log_SameStageRedrawn_LogsOnce`: two draws and a wrapper rebuild of one flow log one `shows` line and one
    `progress` line; a changed `checked` logs a second `progress` line and no `shows` line. It catches a log on
    every row redraw, which would break 10's waits.
  - `tick_CountdownShown_RedrawsAndStopsWhenGone`: as subagent-lines task 09's ticker test, on `10s` → `9s`.
  - `steps_FlowInMake_MarksDoneCurrentAhead`: the stepper's `data-state` list for a make flow.
  - `waves_TasksAcrossWaves_GroupsInFileOrderAndMarksCurrent`.
  - `registry_StageAddedOutOfOrder_SortsOnOrder`: a page stage with `order` 35 added after the built-ins draws in the
    stepper between Plan ready and Make. It catches a registry that appends.
  - `chip_UserLayoutThrows_DrawsWithDefault`.
- `flow-tab.test.ts` (fake sessions recording `addTab`, fake timers): `add_$case`, an `it.each` over the order of
  the flow, the strip build and the timer, catching a Flow tab added before the Chat tab. Rows: flow then build then
  timer → one add, after the timer only; build then flow → one add at once; flow with `hasLeftIdle` false then build
  → no add; a second flow after the add → no second add; `remove` then a flow → no add until the next build.
- `preview.test.ts`: `previewFlow_EachIndex_ShowsItsStage` (`it.each` over the 8 indexes: stage, `countdownEndsAt`
  null except index 4, `progress.checked`), catching a countdown on the wrong sample.
- `layout/read-workflow-layout.test.ts`: an unknown key throws naming it; a non-function part throws.
- `layout-contracts.test.ts` picks the new `layout.d.ts` up on its own.

Visual checks (the strip, the chip at the narrowest side bar, the Flow tab, the countdown ticking, `Space z l w`) are
12's.
Done when: compiles; `npm test` runs the test files above and `layout-contracts.test.ts`; `npm run lint` passes
(layers and styles)
Commit:    one commit for the group

## Proof
