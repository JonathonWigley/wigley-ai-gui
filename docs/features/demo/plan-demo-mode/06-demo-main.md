# 06 — Demo main: the run, the demo harness, the step agents and the real-session step

Status: done
Type: Task
Rung: deep · crosses lifecycle and async: registers and disposes a harness, holds the plugin switch, launches and closes chat sessions, and serializes page requests against Stop
Wave: 2 · Depends on: 01, 02, 03
Plan: [plan.md](plan.md)

Files:
- create `wigley-ai-gui/src/plugins/demo/manifest.ts`
- create `wigley-ai-gui/src/plugins/demo/contract.ts`
- create `wigley-ai-gui/src/plugins/demo/main/start.ts` · test `wigley-ai-gui/src/plugins/demo/main/start.test.ts`
- create `wigley-ai-gui/src/plugins/demo/main/demo-run.ts` · test `wigley-ai-gui/src/plugins/demo/main/demo-run.test.ts`
- create `wigley-ai-gui/src/plugins/demo/main/step-agent.ts` · test `wigley-ai-gui/src/plugins/demo/main/step-agent.test.ts`
- create `wigley-ai-gui/src/plugins/demo/main/real-session-step.ts` · test `wigley-ai-gui/src/plugins/demo/main/real-session-step.test.ts`
- modify `wigley-ai-gui/src/plugins/manifests.ts`
- modify `wigley-ai-gui/src/plugins/main.ts`

Consumes:
- `DEMO_HARNESS_ID`, `DEMO_PROFILE`, `DemoMainStep`, `DemoMainStage`, `DemoMainContext`, `DemoStepRegistry` from `src/contracts/demo.ts` ← 01
- `MainServices.demoSteps: DemoStepRegistry<DemoMainStep>` ← 01
- `MainServices.cloneDir: string | null` ← 01
- `PluginSwitchService.runDisabledForNow(): Promise<Disposable>` ← 01
- `FakeHarnessIdentity.unlisted?: true` ← 02
- `LaunchRequest.ephemeral?: true` ← 03
- `createFakeAgentHarness(clock, files, timers, identity)`, `FakeAgentHarness.processes` (`src/shared/fake-agent-harness.ts:1243`, `:301`) — in the tree
- `ChatMainExports.launch`, `close`, `closeSessionsIn`, `defaultProfile`, `chatMainKey` (`src/plugins/chat/contract.ts:682`, `:761`, `:742`, `:806`) — in the tree
- `ScopedAgentsMainExports.addScopedAgent`, `ScopedAgentStore`, `scopedAgentsMainKey` (`src/plugins/scoped-agents/contract.ts`) — in the tree
- `AgentHarnessRegistry.register` (`src/contracts/agent.ts:682`) — in the tree

Produces:
- `src/plugins/demo/manifest.ts`: `export const demoManifest = definePlugin({ id: 'demo', … })`, the fields under Pinned values.
- `src/plugins/demo/contract.ts`:
  - `export const REAL_SESSION_STEP_ID = 'demo.realSession';`
  - `export const STEP_AGENT_ID = 'step';` (the step agent's agent id, which main registers and 07's page pane names)
  - `export interface DemoRunState { running: boolean; stepId: string | null; beat: number; autoplay: boolean; realShown: boolean }`
  - `export const demoRunSlot: SlotKey<DemoRunState, 'page', 'demo'> = { id: 'demo.run', process: 'page', kind: 'value' };`
  - `export interface DemoStepBrief { id: string; plugin: string; title: string; caption: string; files: readonly string[]; beats: readonly string[] }`
  - `export interface DemoChannel extends ChannelShape { invoke: { start(): Promise<{ scratchDir: string }>; enterStep(stepId: string): Promise<Readonly<Record<string, string>>>; leaveStep(stepId: string): Promise<void>; describeStep(brief: DemoStepBrief): void; stop(): Promise<void> }; messages: Record<never, never> }`
- `src/plugins/demo/main/demo-run.ts`:
  - `export interface DemoRunDeps { chat: Pick<ChatMainExports, 'launch' | 'close' | 'closeSessionsIn'>; harnesses: Pick<AgentHarnessRegistry, 'register'>; makeHarness(identity: FakeHarnessIdentity): FakeAgentHarness; steps: Pick<DemoStepRegistry<DemoMainStep>, 'list'>; pluginSwitch: Pick<PluginSwitchService, 'runDisabledForNow'>; data: Pick<Files, 'list' | 'deleteFile' | 'makeFolder'>; scratchDir: string; profileDir: string; log: PluginLog }`
  - `export interface DemoRun { start(): Promise<{ scratchDir: string }>; enterStep(stepId: string): Promise<Readonly<Record<string, string>>>; leaveStep(stepId: string): Promise<void>; stop(): Promise<void>; isRunning(): boolean }`
  - `export function createDemoRun(deps: DemoRunDeps): DemoRun`
  - `export const SCRATCH_FOLDER = 'scratch'; export const PROFILE_FOLDER = 'profile';` (relative to the plugin data folder)
- `src/plugins/demo/main/step-agent.ts`:
  - `export function stepAgentInstructions(stepId: string, brief: DemoStepBrief | undefined, run: DemoRunState | undefined, folder: string): string`
  - `export function stepAgentTitle(stepId: string, brief: DemoStepBrief | undefined): string`
  - `export function createStepAgentStore(data: Pick<Files, 'read' | 'write'>, log: PluginLog): ScopedAgentStore`
- `src/plugins/demo/main/real-session-step.ts`:
  - `export const REAL_SESSION_TEXT = 'Say hello to the team in one short sentence.';`
  - `export function realSessionMainStep(chat: Pick<ChatMainExports, 'launch' | 'defaultProfile'>): DemoMainStep`
- `src/plugins/demo/main/start.ts`: `export const demoMainPart: MainPart<typeof demoManifest>`

## Decisions

- **The manifest** (plan.md File Structure › Demo plugin; layouts follow `docs/features/layouts/design.md`):
  - `dependsOn: { main: ['chat', 'scoped-agents'], page: ['sessions', 'scoped-agents'] }`, `reads: { main: [], page: [] }`.
  - Every command `runsIn: 'page'` (07 handles them). The eight shared commands, then four panel commands this task adds for 07's panel keys: `cursorDown`, `cursorUp`, `goToCursor`, `askAgent`.
  - No command is `risky`. agent-commands' confirm for a risky command shows as a `forms.confirm` popup through `sessions.addPopup`, and the step agent's row is an owner row the side bar leaves out (`sessions/page/start.ts:806`), so a risky confirm would never show and the step agent's `run_command` would wait until its tool call aborts (task 05, Decisions).
  - `scopes: { panel: 'In the Demo panel' }`.
  - `settings: { layout: 'default', autoplaySeconds: 5 }`, `settingControls: { layout: 'layout' }`, `themeTokens: {}`. No `demoSkip`: the plugin has its own step.
- **The main-side run** lives in `createDemoRun`, so the part's `start` only wires it. Every public call runs in one serial queue (`createSerialQueue`, `src/shared/serial-queue.ts`), so a `stop` that arrives during an `enterStep` waits for it, and two `start`s never interleave.
- **`start`**:
  1. When a run is live, stop it first (a page that reloaded mid-run starts over).
  2. Make the folders `scratch` and `profile` in plugin data (`data.makeFolder`). Empty `scratch`: `data.list('scratch', { recursive: true })`, then `data.deleteFile` on every entry that is a file. Folders stay, empty. Deleting for good keeps demo files out of the OS Trash, which `trash` would fill once per run.
  3. Make the demo harness: `makeHarness({ id: DEMO_HARNESS_ID, label: 'Demo', profiles: [{ name: DEMO_PROFILE, configDir: profileDir }], unlisted: true })`, and register it with `harnesses.register`.
  4. `await pluginSwitch.runDisabledForNow()` and hold its `Disposable` for the run.
  5. Log `run started in <scratchDir>` and resolve `{ scratchDir }`.
  - When step 3 or 4 throws, undo what the earlier steps registered, in reverse order, and reject with the error.
- **`enterStep(stepId)`**: rejects `The demo is not running.` with no live run. A held main stage (a page that entered twice) is left first, as `leaveStep` leaves it. It finds the step by id in `steps.list()`. No main half resolves `{}` and holds nothing. Else it awaits `step.enter(context)`, holds `{ id, stage }`, logs `entered <id>: <session keys, comma-joined, or none>`, and resolves `stage.sessions`. A rejecting `enter` holds nothing and rejects with its error.
- **Leaving a step closes its sessions; steps never close their own.** The page disposes its page stage first and then invokes `leaveStep` (07), so a step change, `goTo`, `reset` and Stop all leave in the order page stage, main stage, sessions. `leaveStep(stepId)` acts only when the held stage's id matches; any other id does nothing. It:
  1. Disposes the held main stage. A throwing `dispose` is logged `leave <id> failed: <errorText>`.
  2. Calls `chat.close(id, 'finished')` for every session id in that stage's `sessions` map, in key order, each awaited; a rejection is logged `session <id> not closed: <errorText>` and the next still closes.
  3. Holds nothing after.
  A step's `DemoMainStage.dispose` removes what the step set up besides its sessions (a slot overlay, a sample file); it never closes a session. Sessions a step launched but left out of its `sessions` map stay open until Stop's `closeSessionsIn`.
- **The step context** (`DemoMainContext`, one per run):
  - `scratchDir`: the run's scratch folder, full path.
  - `launchSession(text)`: `chat.launch({ projectDir: scratchDir, profile: DEMO_PROFILE, message: { text, images: [] }, ephemeral: true })`. It adds the resolved id to the run's launched set.
  - `processEvents(sessionId)`: the `events` of the last record in the run's harness `processes` whose `request.rowId === sessionId`. It throws `No demo session <sessionId>.` for an id the launched set does not hold or no record holds. The last record wins, since a resumed session adds a record.
- **`stop`**, a no-op with no live run. In order, each step's error logged, never stopping the next:
  1. Leave the held main stage, as `leaveStep` does (dispose, then close its sessions).
  2. `await chat.closeSessionsIn(scratchDir)`: every other demo session the run left open, the real-session step's included, before the harness leaves, so no session waits detached (`closeSessionsIn`, `src/plugins/chat/main/start.ts:693-707`: it closes every held session whose `projectDir` is `samePath` to the folder and awaits each one's end).
  3. Dispose the plugin-switch hold.
  4. Dispose the harness registration.
  5. Clear the launched set. Log `run stopped`.
- **The step agent** (design.md § The step agent; backlog's assistant is the pattern, `src/plugins/backlog/main/start.ts:870-877`):
  - `addScopedAgent({ owner: 'demo', agentId: STEP_AGENT_ID, folder: () => folder, instructions, title, store: createStepAgentStore(api.data, services.log) })`, registered once at part start. The scope is the step id.
  - `folder` is `services.cloneDir ?? services.homeDir`. `MainServices.cloneDir` (task 01) is main's `inputs.repoDir`: the installed app's clone, or the dev app's own repo in the dev app, and `null` in the part harness's default services.
  - Main keeps the last `DemoStepBrief` per step id that the page sent through `describeStep`, for the run's life and across runs while the part runs. `instructions(scope)` is `stepAgentInstructions(scope, briefs.get(scope), runSlot.get(), folder)`, with `runSlot = api.state.read(demoRunSlot)`, as backlog's main reads its page slot (`src/plugins/backlog/main/start.ts:878`).
  - `title(scope)` is `stepAgentTitle(scope, briefs.get(scope))`.
  - Instructions reach the agent only at launch and resume (`src/plugins/scoped-agents/main/scoped-agent-service.ts`, `launchSession` and `bringBack`), so the beat they name goes stale. The text therefore tells the agent to read `demo.run` with `read_state` for the beat on screen now.
  - `createStepAgentStore` copies backlog's `createAssistantStore` shape (`src/plugins/backlog/main/assistant.ts`) into its own file `step-agents.json`: records by scope, every call through one serial queue, an unreadable file logged `step-agents.json unreadable; the step agents start fresh` and read as empty, `superseded` resolving null, `checkAsk` resolving. Stop leaves the records and sessions, so conversations persist across runs.
- **The real-session step's main half** (`realSessionMainStep`, id `REAL_SESSION_STEP_ID`), registered at part start through `services.demoSteps.register`:
  - `enter(context)`: `profile = chat.defaultProfile(null)`. When it is null, it throws `Chat has no profiles.`. Else it calls `chat.launch({ projectDir: context.scratchDir, profile, message: { text: REAL_SESSION_TEXT, images: [] }, ephemeral: true })` and resolves `{ sessions: { session: <id> }, dispose }`.
  - `dispose` does nothing. Leaving the step closes the session through `leaveStep` (above), as for every step; Stop's `closeSessionsIn` also closes it, since it runs in the scratch folder.
- **The part** (`demoMainPart`):
  - Builds the run with `scratchDir = services.paths.join(api.dataFolder, SCRATCH_FOLDER)`, `profileDir = services.paths.join(api.dataFolder, PROFILE_FOLDER)` and `makeHarness = (identity) => createFakeAgentHarness(services.clock, services.files, services.timers, identity)`.
  - Handles the five channel calls: `start`, `enterStep`, `leaveStep` and `stop` call the run; `describeStep` stores the brief.
  - Returns `{ commands: {}, dispose }`. `dispose` calls `run.stop()` and logs a rejection as `stop failed: <errorText>`.
  - Registers no layouts: 07 adds `api.layouts.register` once `layouts/layout.d.ts` exists.
- **Composition**:
  - `demoManifest` goes in `builtInManifests` after `windowManifest`, before `appUpdateManifest`.
  - `demoMainPart` goes in `mainParts` before `appUpdateMainPart`.
  - The self-test hands scripts over in start order (`src/main/selftest.ts:233-246`). So 08's demo script runs after every other plugin's but app-update's, which stays last (`src/plugins/main.ts`, its "Last" comment).
  - `scripts/check-layers.mts` needs no edit. It derives the demo layer from the folder and `dependsOn` (`scripts/layer-rules.mts`), and `src/shared/fake-agent-harness.ts` sits in `src/shared`, which every plugin layer may import. Its composition check (`checkCompositionRoots`) expects `./demo/manifest` in `manifests.ts` and `./demo/main/start` in `main.ts` once this task lands.

## Pinned values

- Manifest `label: 'Demo'`, `description: 'Walks through every feature of the app, one step at a time, on sample data with a caption.'`
- Commands (`label` · `group` · `arg`):
  - `togglePanel`: `show or hide the demo` · `demo`
  - `next`: `next beat or step` · `demo`
  - `previous`: `previous beat or step` · `demo`
  - `goTo`: `go to a demo step` · `demo` · `arg: 'string'`
  - `autoplay`: `autoplay the demo on or off` · `demo`
  - `reset`: `set the demo step up again` · `demo`
  - `showReal`: `show or hide the real sessions` · `demo`
  - `stop`: `stop the demo` · `demo`
  - `cursorDown`: `next step` · `panel`
  - `cursorUp`: `previous step` · `panel`
  - `goToCursor`: `go to the step` · `panel`
  - `askAgent`: `ask the step agent` · `panel`
- `settingInfo`:
  - `autoplaySeconds`: label `Demo autoplay`, description `How long autoplay shows each beat of a demo step, in seconds; at least 1. A beat that needs longer keeps its own longer time.`
  - `layout`: label `Demo layout`, description `The layout that draws the Demo panel and the caption: a folder in the layouts/demo folder, or default.`
- The harness label `Demo`. The data files `scratch/`, `profile/`, `step-agents.json`.
- `stepAgentTitle`: `Demo · <brief.title>`, or `Demo · <stepId>` with no brief.
- `stepAgentInstructions` text, lines joined by `\n`, `<…>` filled in:

  ```
  You are the step agent of the wigley-ai-gui demo for step <stepId> of the <brief.plugin> plugin: <brief.title>.
  Its caption: <brief.caption>
  Its beats, in order: <brief.beats as "1. <name>", "2. <name>"… joined by "; ">
  Its files:
  - <each of brief.files>
  When this conversation started, beat <run.beat + 1> of step <run.stepId> showed.

  The user watches this step in the app and asks you to change the feature it shows. You work in the app's own clone, <folder>. Read its AGENTS.md before you change code, and land each change by its rules.

  The demo's state is the demo.run slot: call read_state with slot demo.run for the step and beat on screen now (beat counts from 0). Drive the demo with run_command: demo.goTo with a step id as its arg, demo.next, demo.previous, demo.reset (sets the step up again from its first beat, for example after a change lands) and demo.stop. Call list_commands for the other commands.
  ```

  With no brief, the first four lines are one line: `You are the step agent of the wigley-ai-gui demo for step <stepId>.` With no run state, or a state whose `stepId` is null, the `When this conversation started` line is left out.
- Error texts: `The demo is not running.`, `No demo session <sessionId>.`, `Chat has no profiles.`

GIVEN no live run WHEN `start` runs THEN it empties `scratch`, registers a harness whose identity is `{ id: 'demo', label: 'Demo', profiles: [{ name: 'demo', configDir: <profileDir> }], unlisted: true }`, holds `runDisabledForNow`'s Disposable, and resolves `{ scratchDir }`
GIVEN a live run WHEN `start` runs again THEN the first run's hold and harness registration are disposed and its scratch folder's sessions closed before the new harness registers
GIVEN `runDisabledForNow` rejects WHEN `start` runs THEN the harness registration is disposed and `start` rejects with that error
GIVEN a live run and a main step `p.one` whose stage has sessions `{ a: 's1' }` WHEN `enterStep('p.one')` runs THEN it resolves `{ a: 's1' }`, and `leaveStep('p.one')` disposes that stage and then calls `chat.close('s1', 'finished')`
GIVEN a live run WHEN `enterStep('p.none')` runs for an id no main step holds THEN it resolves `{}`
GIVEN no live run WHEN `enterStep` runs THEN it rejects `The demo is not running.`
GIVEN a session the run launched through `launchSession` WHEN `processEvents` runs on its id THEN it returns the `events` of the harness's last process record for that row; for any other id it throws `No demo session <id>.`
GIVEN a live run holding a step stage WHEN `stop` runs THEN, in order, the stage is disposed, its sessions are closed, `closeSessionsIn(scratchDir)` resolves, the hold is disposed, and the harness registration is disposed
GIVEN chat has a default profile WHEN the real-session step enters THEN `chat.launch` gets `{ projectDir: <scratchDir>, profile: <default>, message: { text: 'Say hello to the team in one short sentence.', images: [] }, ephemeral: true }` and the stage's sessions are `{ session: <id> }`

## Tests

- `demo-run.test.ts`, `describe('createDemoRun')`, on in-memory fakes of every dep: a `register` that records identities and disposals, a `runDisabledForNow` that hands out a recording Disposable, a `closeSessionsIn` that records its folder, and one `calls` array that every fake appends to, for the order checks.
  - `start_FreshRun_EmptiesScratchRegistersUnlistedHarnessHoldsSwitch`: one file under `scratch` deleted; the identity above; one hold; the resolved `scratchDir`.
  - `start_LiveRun_StopsTheOldRunFirst`: `calls` reads `closeSessionsIn`, `hold disposed`, `harness disposed`, then `harness registered`, `hold taken`.
  - `start_SwitchRejects_UndoesTheHarness`: rejects with the switch's error; the registration disposed.
  - `enterStep_ByRegistration_ResolvesSessionsOrEmpty`: a table of `{ registered, expected }` rows: a main step with `{ a: 's1' }` → `{ a: 's1' }`; no main step → `{}`.
  - `enterStep_NoRun_Rejects`: `The demo is not running.`
  - `leaveStep_ById_DisposesThenClosesItsSessions`: one table. Rows: the same id → `calls` reads `stage disposed`, `close s1 finished`, `close s2 finished` for sessions `{ a: 's1', b: 's2' }`; another id → no call, the stage still held. The break it catches is a step's sessions left open, or closed before the stage's own teardown.
  - `leaveStep_CloseRejects_ClosesTheRest`: the first `close` rejects; the log holds `session s1 not closed: …` and `s2` still closes.
  - `processEvents_LaunchedOrNot_ReturnsLastRecordOrThrows`: a fake harness whose `processes` hold two records for `s1` and one for `s9`. `s1`, launched, → the second record's `events`; `s9`, not launched → throws `No demo session s9.`.
  - `stop_LiveRun_TearsDownInOrder`: `calls` reads `stage disposed`, `close s1 finished`, `closeSessionsIn <scratchDir>`, `hold disposed`, `harness disposed`; `isRunning()` false.
  - `stop_StageDisposeThrows_StillClosesAndDisposes`: the log holds `leave <id> failed: …`, and the three later calls still run.
- `step-agent.test.ts`:
  - `createStepAgentStore`, as backlog's `src/plugins/backlog/main/assistant.test.ts` covers its store: write then read and `entries` round-trip; `write(scope, null)` removes the scope; an unreadable file reads as no records and logs once.
  - `stepAgentInstructions_BriefAndRun_NamesStepFilesBeatAndFolder`: one test that the text holds the step id, every file, `beat 2 of step p.one` for `run.beat` 1, and the folder. The break it catches is a dropped field. With no brief, the text holds the one-line opening.
  - `stepAgentInstructions_NoStepOnScreen_LeavesOutTheStartedLine`: one `it.each` table over `run` `undefined` and `{ running: false, stepId: null, … }`; the text holds no `When this conversation started` line. The break it catches is `beat 1 of step null` in a step agent's instructions.
- `start.test.ts`, `describe('demoMainPart')`, on `startMainPart` with fake `chat` and `scoped-agents` main exports, as `src/plugins/backlog/main/start.test.ts:451-469` does. The `scoped-agents` fake records the `addScopedAgent` spec, so the test calls its `instructions`, `title` and `folder`:
  - `describeStep_ThenInstructions_HoldsTheBrief`: `describeStep` a brief for `p.one` through the channel; the recorded `instructions('p.one')` holds the brief's title and `title('p.one')` is `Demo · <title>`. The break it catches is a brief stored under one key and read under another.
  - `folder_ByCloneDir_FallsBackToHome`: one `it.each` table over `cloneDir` `'/clone'` → `'/clone'` and `null` → the services' `homeDir`.
  - `dispose_LiveRun_StopsTheRun`: `start` through the channel, then the part's `dispose`; the `chat` fake's `closeSessionsIn` got the scratch folder and `run stopped` logs. The break it catches is a run left live (harness registered, plugin switch held) after the part stops. The `stop failed:` branch is a guard: `stop` logs each of its own steps' errors and does not reject, so no test reaches it.
- `real-session-step.test.ts`, `describe('realSessionMainStep')`:
  - `enter_DefaultProfile_LaunchesEphemeralInScratch`: the exact request above.
  - `enter_NoProfile_Throws`: `Chat has no profiles.`, and `launch` is not called.

Done when: `npm run typecheck`, `npm test` and `npm run lint` pass. The live checks of the run go to the plan's final verification task, 17.

Commit: one commit for the group: "Demo main: the run, the unlisted demo harness, step agents per step and the real-session step"

## Proof

Commit 720cf9f14 · proof: diff read against Shared names; Wave 2 typecheck and lint pass (8ac2f4304 compile fixes, a5664e8f1 formats; check-layers part-list misses wait for 07) · concerns: createStepAgentStore copies backlog's createAssistantStore (shared store a follow-up); isRunning is false from a stop's first await
