# 07 — Demo page: the panel, the caption, the Demo section, the run driver and the keys

Status: not started
Type: Task
Rung: deep · crosses async and lifecycle: the run driver serializes step enters across processes, runs autoplay on timers, and tears down page and main halves in order
Wave: 3 · Depends on: 04, 05, 06, 11, 12, 13
Plan: [plan.md](plan.md)

Files:
- create `wigley-ai-gui/src/plugins/demo/page/start.ts` · test `wigley-ai-gui/src/plugins/demo/page/start.test.ts`
- create `wigley-ai-gui/src/plugins/demo/page/run-driver.ts` · test `wigley-ai-gui/src/plugins/demo/page/run-driver.test.ts`
- create `wigley-ai-gui/src/plugins/demo/page/panel-view-model.ts` · test `wigley-ai-gui/src/plugins/demo/page/panel-view-model.test.ts`
- create `wigley-ai-gui/src/plugins/demo/page/real-session-step.ts`
- create `wigley-ai-gui/src/plugins/demo/page/layout/read-demo-layout.ts`
- create `wigley-ai-gui/src/plugins/demo/layouts/layout.d.ts`
- create `wigley-ai-gui/src/plugins/demo/layouts/default/layout.js`
- create `wigley-ai-gui/src/plugins/demo/layouts/default/layout.css`
- modify `wigley-ai-gui/src/plugins/demo/main/start.ts`
- modify `wigley-ai-gui/src/plugins/page.ts`
- modify `wigley-ai-gui/src/plugins/main.ts`
- modify `wigley-ai-gui/src/plugins/keymap.ts`

Consumes:
- `DemoStep`, `DemoStage`, `DemoBeat`, `DemoSection`, `DEMO_SECTIONS`, `DEMO_HARNESS_ID` from `src/contracts/demo.ts` ← 01
- `PageServices.demoSteps: DemoStepRegistry<DemoStep>` ← 01
- `SessionsPageExports.showOnly(sectionId: string): Disposable` ← 04
- `AgentPaneSpec.resizeTarget: ResizeTarget | null`, `AgentPaneSpec.entersFrom: PaneDirection | null` ← 05
- `demoManifest`, `DemoChannel`, `DemoStepBrief`, `DemoRunState`, `demoRunSlot`, `REAL_SESSION_STEP_ID`, `STEP_AGENT_ID` ← 06
- `autoCompactPagePart` in `src/plugins/auto-compact/page/start.ts` ← 11
- `sessionLogPagePart` in `src/plugins/session-log/page/start.ts` ← 12
- `usageTabLineMainPart` in `src/plugins/usage-tab-line/main/start.ts` ← 12
- `agentCommandsPagePart` in `src/plugins/agent-commands/page/start.ts` ← 13
- `SessionsPageExports.addSection`, `activate`, `sessionsPageKey` (`src/plugins/sessions/contract.ts:667`, `:668`, `:687`) — in the tree
- `ScopedAgentsPageExports.addAgentPane`, `scopedAgentsPageKey` (`src/plugins/scoped-agents/contract.ts`) — in the tree
- `api.areas.rightBar.contribute(element, { order, focus, left })`, `api.areas.statusBar.contribute(element, { align })` (`src/contracts/plugin.ts:415-477`) — in the tree
- `createLayoutParts`, `readLayoutParts`, `createBaseKit`, `ownerBaseKitDeps`, `kitCommandsOf` (`src/shared/page/layout-host/`) — in the tree

Produces:
- `src/plugins/demo/page/run-driver.ts`:
  - `export function runOrder(steps: readonly DemoStep[]): DemoStep[]`
  - `export interface RunDriverState { stepId: string | null; beat: number; beatCount: number; autoplay: boolean }`
  - `export interface RunDriverDeps { steps(): readonly DemoStep[]; enter(step: DemoStep): Promise<DemoStage>; leave(step: DemoStep, stage: DemoStage): Promise<void>; timers: Timers; autoplaySeconds(): number; changed(state: RunDriverState): void; failed(stepId: string, error: unknown): void; log(line: string): void }`
  - `export interface RunDriver { start(): Promise<void>; next(): Promise<void>; previous(): Promise<void>; goTo(stepId: string): Promise<void>; reset(): Promise<void>; setAutoplay(on: boolean): void; stop(): Promise<void>; state(): RunDriverState; current(): { step: DemoStep; stage: DemoStage } | null }`
  - `export function createRunDriver(deps: RunDriverDeps): RunDriver`
- `src/plugins/demo/page/panel-view-model.ts`:
  - `export function stepListInput(steps: readonly DemoStep[], state: RunDriverState, beats: readonly string[], cursorId: string | null, autoplay: boolean, realShown: boolean): StepListInput`
  - `export function captionInput(steps: readonly DemoStep[], state: RunDriverState): CaptionInput | null`
  - `export function movedCursor(steps: readonly DemoStep[], cursorId: string | null, move: 'down' | 'up'): string | null`
- `src/plugins/demo/page/real-session-step.ts`: `export function realSessionPageStep(sessions: Pick<SessionsPageExports, 'activate'>): DemoStep`
- `src/plugins/demo/layouts/layout.d.ts`: `StepListInput`, `StepSectionInput`, `StepRowInput`, `BeatRowInput`, `CaptionInput`, `DemoKit`, `DemoPart`, `Layout { steps?; caption? }`, `CompleteLayout`
- `src/plugins/demo/page/layout/read-demo-layout.ts`: `export function readDemoLayout(module: unknown, name: string): Layout`
- `src/plugins/demo/page/start.ts`: `export const demoPagePart: PagePart<typeof demoManifest>`

## Decisions

- **Run order** (`runOrder`): by the step's section index in `DEMO_SECTIONS`, then `order` ascending, then `id` ascending, so two steps with one order still sort the same way each time. The driver reads `deps.steps()` and sorts on every move. A plugin that starts mid-run (the off-by-default plugins, after `runDisabledForNow`) adds its steps to the order at once.
- **The run driver** (`createRunDriver`). It is a pure module: no DOM, no channel. Every call runs in one serial queue (`createSerialQueue`), autoplay's moves included, so a key press during an enter waits for it.
  - **Entering a step** = `deps.enter(step)`, then `stage.beats[b].show()` for the beat `b` the move asks for. The driver holds `{ step, stage }`. When `enter` rejects, or returns a stage with no beats, the driver calls `deps.failed(step.id, error)` and holds a stand-in stage with one beat `{ name: 'failed', show() {} }` and a no-op `dispose`, so the run goes on. A `show` that throws calls `deps.failed` too, and the beat counts as shown.
  - **Leaving** = `deps.leave(step, stage)`, its rejection given to `deps.failed`.
  - **Neighbours** come from the sort key of the held step, not its index. A step whose plugin stopped mid-run still has a next and a previous.
  - `start`: enters the first step in run order at beat 0. With no step, it logs `no steps`.
  - `next`: shows the next beat of the held stage. From its last beat, it leaves the step and enters the next step at beat 0. From the last beat of the last step, it logs `at the last beat` and changes nothing.
  - `previous`: shows the previous beat. From beat 0, it leaves the step and enters the previous step at its last beat (`stage.beats.length - 1`, known once `enter` resolves). Beat 0 of the first step logs `at the first beat`.
  - `goTo(stepId)`: leaves the held step and enters `stepId` at beat 0, its own id included. An id no step holds rejects `No demo step <stepId>.` and changes nothing.
  - `reset`: leaves the held step and enters it again at beat 0.
  - `stop`: turns autoplay off, then leaves the held step. It holds nothing after.
  - After each shown beat, the driver calls `deps.changed(state)` and logs `showing <stepId> beat <b + 1> of <count>: <beat name>`. After the move, it logs one of `moved next`, `moved previous`, `went to <stepId>`, `reset <stepId>`.
- **Autoplay** (plan.md Decisions; design.md § What it is):
  - `setAutoplay(true)` arms one timer on the injected `timers` for the shown beat. Its dwell in ms is `1000 × max(max(1, autoplaySeconds()), beat.dwellSeconds ?? 0)`. A setting below 1 counts as 1, as its description says.
  - When the timer fires, the driver checks the move first. At the last beat of a step whose next step is `REAL_SESSION_STEP_ID`, autoplay turns off and logs `autoplay stopped before demo.realSession`. At the last beat of the last step, it turns off and logs `autoplay stopped at the end`. Else it runs `next`.
  - Every shown beat re-arms the timer while autoplay is on, so a key move restarts the dwell. `setAutoplay(false)` and `stop` clear the timer. Each change logs `autoplay on` or `autoplay off` and calls `deps.changed`.
  - A key or a `goTo` still enters the real-session step. Only autoplay stops before it.
- **The page's `enter` and `leave`** for the driver:
  - `enter(step)`: `sessions = await api.channel.invoke('enterStep', step.id)`, then `stage = await step.enter({ scratchDir, sessions })`. When the page half rejects, the main half is left before the rejection reaches the driver (`invoke('leaveStep', step.id)`). Once the stage holds, the page sends `invoke('describeStep', brief)`, with `plugin` the id's part before its first `.` and `beats` the stage's beat names.
  - `leave(step, stage)`: `stage.dispose()`, then `await invoke('leaveStep', step.id)` (design Overview, step 3: page stage first, then main stage). Main's `leaveStep` then closes every session in the main stage's `sessions` map (06); a page stage never closes a session.
- **Starting the run** (the first `demo.togglePanel`, or a `goTo` with no run):
  1. `{ scratchDir } = await invoke('start')`. A rejection logs `start failed: <errorText>`, toasts `The demo did not start: <errorText>` with tone `error`, and changes nothing.
  2. Add the Demo section: `sessions.addSection({ id: 'demo', label: 'Demo', order: 0, claims: (row) => row.harness === DEMO_HARNESS_ID || (row.projectDir !== null && services.paths.samePath(row.projectDir, scratchDir)) })`. Order 0 sits below every section's order today: live-view 15 (`live-view/page/live-section.ts:443`), context-sources 35, scheduling 900, auto-retro 1000. So a demo row another section also claims goes to Demo. The `projectDir` clause claims the real-session step's row, which runs on the default harness.
  3. Hold `sessions.showOnly('demo')`.
  4. Contribute the panel and the caption, then publish `demo.run`.
  5. Log `run started`, then `await driver.start()`.
- **Stopping** (`demo.stop`, which is also what the step agent's `demo.stop` runs): `await driver.stop()`, then `await invoke('stop')`. Then dispose the showOnly hold, the section, the panel and caption contributions, call `pane.scopeOpened(null)`, publish `{ running: false, stepId: null, beat: 0, autoplay: false, realShown: false }`, and log `run stopped`. Each step's error is logged and never stops the next.
- **Page load**: in `ready`, the page invokes `stop` once and logs a rejection. A run that a reload left in main ends, since no page drives it any more.
- **Commands** (every one runs from agent-commands' `run_command` too, since agent-commands lists every live command, `src/plugins/agent-commands/main/tools.ts`):
  - `togglePanel`: with no run, it starts one. With the panel shown, it hides the panel and logs `panel hidden`; the run and its step stay. With the panel hidden, it shows it and logs `panel shown`.
  - `next`, `previous`, `reset`, `autoplay` (toggles), `showReal`, `stop`: with no run, each logs `the demo is not running` and does nothing.
  - `goTo(arg)`: starts the run when none runs, then `driver.goTo(arg)`. Its rejection reaches the caller.
  - `showReal`: disposes the showOnly hold and logs `real sessions shown`; run again, it takes a new `showOnly('demo')` hold and logs `real sessions hidden`. It publishes `realShown`.
  - `cursorDown`, `cursorUp`: move the panel cursor over the steps in run order, stopping at the ends, and log `cursor on <stepId>`.
  - `goToCursor`: `driver.goTo(cursorId)`.
  - `askAgent`: `pane.toggle()`, which moves the keys into the shown pane and back (`src/plugins/scoped-agents/page/agent-pane.ts:384-391`, an `isAlwaysShown` pane).
- **The panel**, a right-bar contribution (`system-stats/page/start.ts:251-255` is the pattern):
  - `panelSlot` (`div.demo-panel-slot`, `tabIndex = -1`, no outline) holds `stepsSlot`, drawn by the layout's `steps` part, over `agentSlot`, which holds the pane's `element`.
  - It contributes with `{ order: PANEL_ORDER, focus: focusPanel, left: leavePanel }` and `PANEL_ORDER = -10`. That puts it first: usage's details take the default order 0 (`renderer/shell/shell.ts:57`), unity-pool 10, system-stats 20.
  - `focusPanel` sets scope `panel`, puts the cursor on the held step when it is on none, focuses `panelSlot`, redraws, and logs `panel focused` and `cursor on <stepId>`. `leavePanel` drops the cursor's ring and redraws.
  - The panel redraws on each `deps.changed`, each `demoSteps.onChanged`, each cursor move, settings change and layouts set.
- **The agent pane**, added once at page start through `addAgentPane`, owner `'demo'`, agent id `STEP_AGENT_ID`:
  - `isAlwaysShown: true`, `entersFrom: null`, `resizeTarget: null` (05: the right bar owns resizing and pane moves).
  - `setShown(shown)` sets `agentSlot.hidden = !shown`.
  - `tookKeys` drops the panel's cursor ring. `leave` sets scope `panel` again and focuses `panelSlot`.
  - On every step change the page calls `pane.scopeOpened(stepId)`. The heading reads the held step's title on each call.
- **The caption**: `captionSlot` (`span.demo-caption-slot`) contributed to `api.areas.statusBar` with `{ align: 'center' }` while the run lives (usage's line is the pattern, `usage/page/start.ts:91`), drawn by the layout's `caption` part from `captionInput`.
- **The `demo.run` slot**: published by the page (`api.state.publish(demoRunSlot)`) at start, on each `deps.changed`, on each `showReal`, and at stop.
- **The real-session step's page half** (`realSessionPageStep`), registered at page start through `services.demoSteps.register`:
  - Id `REAL_SESSION_STEP_ID`, section `live`, `order: 1000`, which sorts it after live-view's step and last in the run (plan.md: `live`, last).
  - `enter(context)` resolves one beat, `hello`, whose `show` is `sessions.activate(context.sessions.session)`. A missing `session` key throws `The real session did not start.`.
  - `dispose` does nothing: main's `leaveStep` closes the session (06).
- **The layout contract** (`docs/features/layouts/design.md`; system-stats' contract is the pattern, `system-stats/layouts/layout.d.ts`):
  - Two parts: `steps(parent, input: StepListInput, kit: DemoKit): DemoPart` and `caption(parent, input: CaptionInput, kit: DemoKit): DemoPart`. The app keeps the right-bar slot, the agent pane below the step list, the keys, the cursor and every redraw.
  - `StepListInput { sections: StepSectionInput[]; autoplay: boolean; realShown: boolean }`.
  - `StepSectionInput { title: string; steps: StepRowInput[] }`. Only sections that hold a step are listed, in `DEMO_SECTIONS` order, with its titles verbatim.
  - `StepRowInput { id: string; title: string; isCurrent: boolean; isCursor: boolean; beats: BeatRowInput[] }`. `beats` lists names only under the current step; it is `[]` on every other row.
  - `BeatRowInput { name: string; isCurrent: boolean }`.
  - `CaptionInput { title: string; caption: string; stepNumber: number; stepCount: number; autoplay: boolean }`. It is null with no held step, and then the caption slot is empty.
  - The `default` layout draws:
    - each section with `kit.sectionHeader`, each step as a row with `is-current` and `is-cursor` classes, and the current step's beats indented under it with `is-current` on the shown beat;
    - a hint line with `kit.keyHint(hints, 'askAgent', { label: true })`, and tags `autoplay` and `real sessions shown` when they hold;
    - the caption as `<stepNumber>/<stepCount>`, the title, and the caption text.
  - The app scrolls the first `.is-cursor` into view while the panel holds the keys.
  - `kit.keyHint` anchors `demo.askAgent` in scope `demo.panel`, so the end-of-run placement check (`src/main/selftest-runner.ts:62-74`) finds the `i` bind placed. `j`, `k` and `<CR>` are vim keys and every `<Leader>` bind shows in which-key, so neither needs an anchor (`src/plugins/keys/page/unplaced.ts:17-58`).
- **Main's layouts**: `src/plugins/demo/main/start.ts` adds `api.layouts.register({ layoutTypes })`, with `layoutTypes` from `../layouts/layout.d.ts?raw`, as `system-stats/main/start.ts` does.
- **Composition.** This task is the one editor of the part lists after 06 (plan.md Files by task), so it adds the demo page part and every new part a step task created:
  - `src/plugins/page.ts` `pageParts`: `demoPagePart` before `appUpdatePagePart`; `sessionLogPagePart` after `sessionStashPagePart` (main starts session-stash before session-log, `src/plugins/main.ts`); `agentCommandsPagePart` after `audioPickerPagePart` (task 13); `autoCompactPagePart` after `agentsPagePart` (task 11). Each with its import beside the others.
  - `src/plugins/main.ts` `mainParts`: `usageTabLineMainPart` after `usageMainPart` (task 12).
  - `src/plugins/manifests.ts` needs no edit: each of those plugins' manifests is listed already, and 06 added `demoManifest`.
  - `scripts/check-layers.mts`' composition check (`checkCompositionRoots`, `:1121`) expects each plugin's `./<id>/page/start` or `./<id>/main/start` in the list once that file exists. Until this task lists the four new parts, `npm run lint` fails on exactly those missing entries after 11, 12 and 13 land; after this task it passes.
- **Keys** (`src/plugins/keymap.ts`; `docs/keymap.md`'s `d` row was written ahead):
  - `groups` gains `'<Leader>d': 'demo'` after `'<Leader>v': 'view'`.
  - A `// ── Demo ──` banner section holds the leader binds, each `scope: 'any'`, `where: 'page'`, as the preview binds do (`keymap.ts:1282-1287`, `<Leader>zlo`).
  - Below them go the panel binds in scope `demo.panel`: `j` cursorDown, `k` cursorUp, `<CR>` goToCursor, `i` askAgent.
  - `i` is not in the brief's key list. Without it the pane's ask box takes the keys only by a click, and `i` is the insert key that chatroom's log also uses for its composer (`keymap.ts:1206`, `chatroom.compose`).

## Pinned values

- The leader binds: `<Leader>dd` → `demo.togglePanel`, `<Leader>dn` → `demo.next`, `<Leader>dp` → `demo.previous`, `<Leader>da` → `demo.autoplay`, `<Leader>dr` → `demo.reset`, `<Leader>dh` → `demo.showReal`, `<Leader>dx` → `demo.stop`.
- Section `id 'demo'`, `label 'Demo'`, `order 0`. `PANEL_ORDER = -10`.
- Real-session page step:
  - title `Real session`
  - caption `A real Claude session starts on the default profile and says hello to the team.`
  - files `['src/plugins/demo/main/real-session-step.ts', 'src/plugins/demo/page/real-session-step.ts']`
  - beat `hello`
- Agent pane heading: `Step agent · <held step's title>`, or `Step agent` with none. Its hint: `Ask for a change to the feature on screen; the agent works in the app's own clone.`
- The stand-in beat's name: `failed`. Error text `No demo step <stepId>.`, toast `The demo did not start: <errorText>`.
- Log lines (each logged through `services.log`, which prefixes `[demo] `): `run started`, `run stopped`, `showing <id> beat <n> of <count>: <name>`, `moved next`, `moved previous`, `went to <id>`, `reset <id>`, `at the first beat`, `at the last beat`, `no steps`, `autoplay on`, `autoplay off`, `autoplay stopped before demo.realSession`, `autoplay stopped at the end`, `step <id> failed: <errorText>`, `panel shown`, `panel hidden`, `panel focused`, `cursor on <id>`, `real sessions shown`, `real sessions hidden`, `the demo is not running`, `start failed: <errorText>`.

GIVEN steps in sections `bars` (order 1) and `shell` (orders 2 and 1) WHEN `runOrder` sorts them THEN the order is shell 1, shell 2, bars 1
GIVEN the held step on its last beat WHEN `next` runs THEN the step's stage is left and the next step shows beat 0
GIVEN the held step on beat 0 WHEN `previous` runs THEN the previous step is entered and shows its last beat
GIVEN the first step on beat 0 WHEN `previous` runs THEN `at the first beat` is logged and nothing is entered or left
GIVEN autoplay on, `autoplaySeconds` 5 and a beat with `dwellSeconds` 8 WHEN 7.9 s pass THEN the beat still shows, and at 8 s the next beat shows
GIVEN autoplay on and the held step's last beat, with `demo.realSession` next WHEN the dwell passes THEN autoplay turns off, `autoplay stopped before demo.realSession` is logged, and the real-session step is not entered
GIVEN a step whose `enter` rejects WHEN the driver enters it THEN `failed` gets its id, a one-beat `failed` stage holds, and `next` moves on
GIVEN no run WHEN `demo.togglePanel` runs THEN main's `start` is invoked, the Demo section is added, `showOnly('demo')` is held, and the first step shows
GIVEN a run WHEN `demo.stop` runs THEN the held step's page stage is disposed before main's `leaveStep`, then main's `stop` runs, and the hold, section, panel and caption are disposed

## Tests

- `run-driver.test.ts`, `describe('createRunDriver')`. Fake steps carry beat names and record `enter`, `show` and `dispose` into one `calls` array. A manual `Timers` fake keeps its handles and fires them by hand, so time is explicit (`typescript-vitest.md` § Time).
  - `runOrder_SectionThenOrderThenId_Sorts`: one `it.each` table of `{ steps, expected }` rows, including a tie on `order` broken by id.
  - `moves_FromPosition_LandOnBeatOrStep`: one `it.each` table over two steps of three and two beats. Each row is `{ name, from: [stepId, beat], move, expectedCalls, expectedState }`. Rows:
    - `next` within a step
    - `next` from the last beat (leave, enter, show beat 0)
    - `next` at the end (`at the last beat`, no calls)
    - `previous` within a step
    - `previous` from beat 0 (enters the previous step, shows its beat 2)
    - `previous` at the start (`at the first beat`)
    - `goTo` another step
    - `goTo` the held step (leave, enter, beat 0)
    - `reset`
  - `goTo_UnknownId_RejectsAndKeepsTheStep`.
  - `autoplay_Dwell_IsTheLongerOfSettingAndBeat`: one `it.each` table of `{ setting, dwellSeconds, firesAtMs }` rows: `5, undefined, 5000`; `5, 8, 8000`; `5, 2, 5000`; `0, undefined, 1000`. Each row asserts that nothing moves at `firesAtMs - 1` and that the next beat shows at `firesAtMs`.
  - `autoplay_BeforeRealSession_StopsWithoutEntering`: two steps, the second `demo.realSession`. On the first step's last beat, the fire turns autoplay off, logs the stop line and calls no `enter`. A `next` afterwards still enters it.
  - `autoplay_KeyMove_RestartsTheDwell`: a `next` at 3 s of a 5 s dwell moves at 8 s, not at 5 s.
  - `enter_Rejects_HoldsAFailedStageAndMovesOn`.
  - `calls_DuringAnEnter_WaitForIt`: a `next` sent while an `enter` is held on a deferred promise runs after it resolves, so the calls do not interleave.
- `panel-view-model.test.ts`:
  - `stepListInput_GroupsBySection_ListsBeatsUnderCurrentOnly`: one table. Rows: an empty section is left out; titles come from `DEMO_SECTIONS`; beats are listed only under the current step.
  - `movedCursor_AtEnds_Stops`: one table of `{ from, move, expected }`.
- `start.test.ts`, `describe('demoPagePart')`, on `startPagePart` (`src/shared/plugin-part-harness.test-support.ts:1810`) with fake `sessions` and `scoped-agents` page exports and a fake channel:
  - `togglePanel_NoRun_StartsTheRun`: the order of `invoke('start')`, `addSection` with id `demo`, `showOnly('demo')`, then `enterStep` of the first step. The Demo section's `claims` is checked as one table: a row on harness `demo`, a row in the scratch folder on another harness, and a row elsewhere on `claude-code` → true, true, false.
  - `stop_Run_LeavesPageStageThenMainThenDisposesHolds`.
  - `showReal_Twice_DisposesThenRetakesTheHold`.
  - `command_NoRun_LogsNotRunning`: one table over `next`, `previous`, `reset`, `autoplay`, `showReal` and `stop`.
- The keymap's build-time check covers the new binds, through `src/plugins/keymap.test.ts`, `defaultKeymap_MergedWithBuiltIns_PassesKeymapChecks`: a misspelt command or scope fails to compile.

Dropped: nothing. The panel's look, the caption's place and the agent pane in the right bar are live checks for task 17.

Done when: `npm run typecheck`, `npm test` and `npm run lint` pass.

Commit: one commit for the group: "Demo page: the right-bar panel with the step agent, the caption, the Demo section and the Space d keys"

## Proof
