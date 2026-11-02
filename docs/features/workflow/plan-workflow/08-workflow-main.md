# 08 — Workflow main part: manifest, flows, plan watch, actions, countdown

Status: not started
Type: Task
Wave: 3 · Depends on: 01, 03, 06, 07
Plan: [plan.md](plan.md)

Files:     create `src/plugins/workflow/manifest.ts`
           create `src/plugins/workflow/main/start.ts` · test `main/start.test.ts`
           create `src/plugins/workflow/main/flow-store.ts` · test `main/flow-store.test.ts`
           create `src/plugins/workflow/main/plan-watch.ts` · test `main/plan-watch.test.ts`
           create `src/plugins/workflow/main/actions.ts` · test `main/actions.test.ts`
           create `src/plugins/workflow/main/countdown.ts` · test `main/countdown.test.ts`
           create `src/plugins/workflow/main/agent-signals.ts` · test `main/agent-signals.test.ts`
           modify `src/plugins/manifests.ts` · `src/plugins/main.ts` · `scripts/check-layers.mts`
Consumes:  `skillStarted`, `fileWritten`, `turnStarted`, `turnEnded` members of `AgentEvent` ← 01
           the Claude adapter and the fake emitting `skillStarted` for a slash command in a user message, and
           `turnStarted` at every turn's start ← 04, 05
           `ChatMainExports.send(sessionId: string, message: UserMessage): Promise<void>` and
           `ChatMainExports.clear(sessionId: string): Promise<void>` ← 06
           `SessionFlow`, `WorkflowSignal`, `MainStage`, `WorkflowMainExports`, `WorkflowChannel`, `IDLE_STAGE` ← 03
           `foldFlow`, `newFlow`, `isPlanFile`, `planDirOf` ← 03 · `readPlanProgress` ← 02
           `BUILT_IN_MAIN_STAGES`, `WORKFLOW_COMMANDS` ← 07
           `AgentEvent`, `MAIN_AGENT_ID` ← plan-subagent-lines task 02 · `ChatAgentEvent`, `ChatMainEvents.agentEvent` ←
           plan-subagent-lines task 05 · `ChatMainEvents.sessionOpened: { sessionId: string; profileDir: string }` ←
           plan-usage task 04 · `MainServices.timers: Timers` ← plan-usage task 02 ·
           `SessionsMainEvents.hostSessionChanged: AgentSession` ← plan-clear-command task 02
           in the tree: `ChatMainExports.launch`, `ChatMainExports.profileOf`, `SessionsMainEvents.connected` and
           `ended`, `MainApi.data`, `MainApi.settings`, `MainApi.onSettingsChanged`, `services.files` (`read`, `stat`,
           `watch`), `services.clock`, `services.log`, the `agentSpawned`, `agentFinished` and `sessionEnded` members
           of `AgentEvent`, `ChatAgentEvent.hostSessionId`,
           `readIfPresent` and `isMissingFile` in `src/contracts/files.ts`, `QualifiedEvents`, `definePlugin`
Produces:  `export const workflowManifest` in `src/plugins/workflow/manifest.ts`
           `export const workflowMainPart: MainPart<typeof workflowManifest>` in `src/plugins/workflow/main/start.ts`,
           whose `exports` is a `WorkflowMainExports`
           in `src/plugins/workflow/main/flow-store.ts`:
           `export const FLOWS_FILE = 'flows.json';`
           `export interface FlowStore { load(): Promise<void>; get(sessionId: string): SessionFlow | null; hostIdOf(sessionId: string): string | null; all(): SessionFlow[]; open(sessionId: string, hostSessionId: string, projectDir: string): SessionFlow; rekey(sessionId: string, hostSessionId: string): void; put(flow: SessionFlow): void; drop(sessionId: string): void; resetFlows(projectDir: string): void }`
           in `src/plugins/workflow/main/start.ts`, for the self-test script (task 10):
           `export interface WorkflowSelfTestHooks { resetFlows(projectDir: string): void; onMainTurnEnded(listener: (sessionId: string) => void): Disposable }`
           `export function createFlowStore(deps: { files: Files; log: Log; paths: Paths }): FlowStore;`
           in `src/plugins/workflow/main/plan-watch.ts`:
           `export interface PlanWatch { follow(sessionId: string, planDir: string | null): void; check(sessionId: string): void; dispose(): void }`
           `export function createPlanWatch(deps: { files: Pick<Files, 'read' | 'stat' | 'watch'>; log: Log; signal(sessionId: string, signal: WorkflowSignal): void }): PlanWatch;`
           in `src/plugins/workflow/main/actions.ts`:
           `export interface WorkflowActionsDeps { chat: Pick<ChatMainExports, 'send' | 'clear' | 'launch' | 'profileOf'>; flowOf(sessionId: string): SessionFlow | null; signal(sessionId: string, signal: WorkflowSignal): void; cancelCountdown(sessionId: string): void }`
           `export function createWorkflowActions(deps: WorkflowActionsDeps): { run(sessionId: string, command: string): Promise<void> };`
           in `src/plugins/workflow/main/countdown.ts`:
           `export interface Countdown { sync(flow: SessionFlow): void; stop(sessionId: string): void; dispose(): void }`
           `export function createCountdown(deps: { timers: Timers; clock: Clock; fire(sessionId: string): void }): Countdown;`
           in `src/plugins/workflow/main/agent-signals.ts`:
           `export function signalOf(event: AgentEvent, flow: SessionFlow, fromCurrentHost: boolean): WorkflowSignal[];`
Decisions:
- **Manifest** (`definePlugin`), comment above it says what the plugin does, as notes' does:
  - `id: 'workflow'`, `dependsOn: ['chat', 'sessions', 'docs', 'keys']`
  - `commands`: `...WORKFLOW_COMMANDS`, then these page commands no stage owns, all `runsIn: 'page'`:
    `lineDown` → `next line`, `lineUp` → `previous line`, `halfPageDown` → `half a page down`, `halfPageUp` →
    `half a page up` (each `group: 'flow tab'`), and `openPreview` → `show the workflow layout preview`
    (`group: 'debug'`). 09 writes their handlers and binds in `src/plugins/keymap.ts`: the four scroll commands on
    `<C-j>`, `<C-k>`, `<C-S-j>`, `<C-S-k>` in `workflow.flow`, `openPreview` on `<Leader>zlw`, and every
    `<Leader>w` bind with `scope: 'any'`. Leader sequences are left out of the placement gate (AGENTS.md § Key hints).
  - `scopes: { flow: 'In the Flow tab' }`: the Flow tab is a session tab and sets this base key scope in `shown`
    (AGENTS.md § A session tab). The strip holds no scope (design.md § Decisions).
  - `settings: { layout: 'default', autoClearAndMake: false, autoStartSeconds: 10 }`
  - `settingInfo`: `layout` → `Workflow layout` / `The layout that draws the stage chip, the composer strip and the Flow tab: a folder in the layouts/workflow folder, or default.`;
    `autoClearAndMake` → `Auto Clear & make` / `Starts Clear & make by itself when a plan is ready, after a countdown the user can cancel.`;
    `autoStartSeconds` → `Auto-start countdown` / `Seconds the plan-ready countdown runs before Clear & make starts by itself; at least 1.`
  - `themeTokens: {}`
- **Registration.** `workflowManifest` joins `builtInManifests` in `src/plugins/manifests.ts` right after
  `usageManifest`, the list's last entry today. `workflowMainPart` joins `mainParts` in `src/plugins/main.ts` right
  after `usageMainPart`, before `keysMainPart`. So the workflow main part starts after chat, docs and settings, and
  settings' self-test script runs before workflow's. **The page part is task 09's**: 08 adds no page part and no
  `pageParts` entry in `src/plugins/page.ts`. Every workflow command runs in the page, so the main part's
  `commands` is `{}`, and nothing binds a workflow key until 09; the page part with a handler for every page command
  joins `pageParts` in 09 (the usage plan's tasks 05 and 06 split the same way).
- **Layouts.** The main part's `api.layouts.register({ layoutTypes })` needs `layouts/layout.d.ts`, which 09 writes;
  09 adds that call to `main/start.ts`. 08 registers no layout.
- **check-layers** — 08 writes every workflow `LAYERS` entry, `workflow/page`, `workflow/layouts` and the
  `src/plugins/page.ts` root entry included, so the list lives in one task. 09 writes no `LAYERS` entry: a layer its
  page needs beyond this list is a concern 09 reports to the lead. Add these entries, in notes' block shape, after
  the notes entries:
  - `'src/plugins/workflow/plan-reader.ts'`: `layers: []`
  - `'src/plugins/workflow/contract.ts'`: `['src/contracts', 'src/plugins/workflow/plan-reader.ts']`
  - `'src/plugins/workflow'` (manifest, flow): `['src/contracts', 'src/shared', 'src/plugins/workflow/contract.ts', 'src/plugins/workflow/plan-reader.ts', 'src/plugins/workflow/stages']`
  - `'src/plugins/workflow/stages'`: `['src/contracts', 'src/plugins/workflow', 'src/plugins/workflow/contract.ts', 'src/plugins/workflow/plan-reader.ts']`
    (`src/plugins/workflow` for `flow.ts` in the stage tests)
  - `'src/plugins/workflow/main'`: `['src/contracts', 'src/shared', 'src/plugins/workflow', 'src/plugins/workflow/contract.ts', 'src/plugins/workflow/plan-reader.ts', 'src/plugins/workflow/stages', 'src/plugins/chat/contract.ts', 'src/plugins/sessions/contract.ts', 'src/plugins/workflow/layouts']`, `packages: ['node:']`
  - `'src/plugins/workflow/layouts'`: `['src/shared/page/layout-host']`
  - `'src/plugins/workflow/page'`: `['src/contracts', 'src/shared', 'src/shared/paths', 'src/shared/page', 'src/shared/page/ui', 'src/plugins/workflow', 'src/plugins/workflow/contract.ts', 'src/plugins/workflow/plan-reader.ts', 'src/plugins/workflow/stages', 'src/plugins/chat/contract.ts', 'src/plugins/docs/contract.ts', 'src/plugins/keys/contract.ts', 'src/plugins/sessions/contract.ts', 'src/plugins/workflow/layouts', 'src/shared/page/layout-host']`
  - the root entries: `'src/plugins/manifests.ts'` gains `'src/plugins/workflow'`; `'src/plugins/main.ts'` gains
    `'src/plugins/workflow'` and `'src/plugins/workflow/main'`; `'src/plugins/page.ts'` gains `'src/plugins/workflow'`
    and `'src/plugins/workflow/page'` now, so 09 edits `src/plugins/page.ts` (its `pageParts` entry) and no
    `check-layers.mts` line.
- **Flows are keyed by host session id on disk.** A sessions row id is fresh on every launch
  (`session-list.ts` `addEntry`: `deps.randomHex()`), and chat restores rows by host session id
  (`open-sessions.json`). So `flows.json` holds `{ "flows": [{ "hostSessionId": string, "flow": SessionFlow }] }`, in
  `api.data`, written whole (`JSON.stringify(…, null, 2)`) after each `put`, `rekey` and `drop`, one write after
  another in call order (a promise queue, as notes' draft store does). A write that rejects is logged
  (`workflow`, `flows.json not written: <errorText>`) and the next change writes again.
- **`FlowStore`**:
  - `load` reads `flows.json` once. Missing → no saved flows. Unreadable (not JSON, or not the shape above, checked
    field by field) → logged `flows.json unreadable; starting with no flows`, no saved flows, and the next write
    replaces it. A flow read from disk gets `turnRunning: false` and `countdownEndsAt: null`: no process runs and no
    countdown survives a relaunch. It also gets `runningSubagents: []`: no subagent outlives its process.
  - `open(sessionId, hostSessionId, projectDir)`: the saved flow for `hostSessionId`, with `sessionId` and
    `projectDir` from the call, or `newFlow(sessionId, projectDir)` when none is saved. Holds it, writes, returns it.
  - `rekey` moves the session's saved key to the new host id (a clear) and writes; `put` replaces the session's flow
    and writes; `drop` forgets the session's flow and its saved entry and writes. Each ignores a session it does not
    hold. Saved entries no open session took stay in the file (a row chat restores later still finds its flow).
  - `get` and `all` read only open sessions' flows; `all` in `open` order. `hostIdOf(sessionId)` is the host session
    id the session's flow is held under now (`open`'s, or the last `rekey`'s); null for a session it does not hold.
  - `resetFlows(projectDir)`: every open flow whose `projectDir` equals `projectDir` (compared with
    `services.paths`, AGENTS.md § A path, passed in as `deps.paths`) becomes `newFlow(sessionId, projectDir)`, and
    every saved entry with that `projectDir` no open session holds is removed; then one write. With `deps.paths`
    the factory is `createFlowStore(deps: { files: Files; log: Log; paths: Paths })`.
- **Self-test hooks** (`WorkflowSelfTestHooks`, built in `start.ts` only when `services.selfTest` is non-null and
  handed to task 10's `main/selftest-script.ts` there; 10 owns how the script receives them):
  - `resetFlows(projectDir)`: `store.resetFlows`, then for each reset session `countdown.stop`,
    `planWatch.follow(sessionId, null)`, and one `flows` send. A fixture run starts each case from idle.
  - `onMainTurnEnded(listener)`: calls `listener(sessionId)` after the change path has applied each `turnEnded`
    signal from `chat.agentEvent` (the main agent's: `turnEnded` carries no `agentId`), whether or not the flow
    changed; the Disposable removes it. The script waits on it in place of a timed wait.
- **Session lifecycle** in `start.ts`, owned sessions only (plan.md Decisions):
  - `sessions.connected` (an `AgentSession`): remember `{ hostSessionId: info.sessionId, projectDir: info.projectDir }`
    by `session.id`, when both are non-null. It fires before chat's `sessionOpened` (plan-usage task 04).
  - `chat.sessionOpened` `{ sessionId }`: take the remembered pair and `store.open(…)`; then `planWatch.follow` its
    `planDir`, and send `flows`. A `sessionOpened` with no remembered pair is logged and ignored.
  - `sessions.hostSessionChanged` (an `AgentSession`): `store.rekey(session.id, session.info.sessionId)`, then fold
    `{ type: 'cleared' }`. A clear keeps the stage (plan.md Decisions).
  - `sessions.ended` `{ sessionId }`: forget the remembered pair, `countdown.stop`, `planWatch.follow(sessionId, null)`,
    `store.drop`, send `flows`. This is the main-side event for a row leaving: sessions main has no `sessionRemoved`
    (that is a page event), and chat ends an owned session only when the user closes its row, never on quit
    (`chat-sessions.ts` `closed`, `killAll`), so a relaunch keeps the flows.
  - `chat.agentEvent` (`ChatAgentEvent`): `signalOf(event, flow, store.hostIdOf(sessionId) === hostSessionId)` for
    the session's flow; fold each signal it returns, in order, through the change path. Events of a session with no
    flow are ignored.
- **Readiness.** `start` is synchronous; `store.load()` runs at start as `ready`. Every listener and both channel
  handlers run their work in `ready.then(…)`, so they apply in arrival order after the load. `flows()` resolves to
  `store.all()` after `ready`.
- **One change path** in `start.ts` for every fold, used by the listeners, the plan watch's `signal` and the actions'
  `signal`, in this order:
  1. Read the flow; `next = foldFlow(flow, signal, stages)`.
  2. On every `turnEnded` signal, `planWatch.check(sessionId)`, whether or not the fold changed the flow. A
     `turnEnded` with no turn running (a control command's turn, a crash's mapped `sessionEnded`) still catches a
     folder that `wigley:make` deleted inside its turn.
  3. On a `fileWritten` signal whose `path` passes `isPlanFile`, `planWatch.follow(sessionId, next.planDir)`, whether
     or not the fold changed the flow. A rewrite of the same plan changes no field, and this call reopens a watch
     that `planGone` closed (§ Plan watch).
  4. When `next === flow`, stop.
  5. When the stage changed to a stage whose `autoCommand` is set, `next.countdownEndsAt` is null and
     `autoClearAndMake` is on, set `countdownEndsAt` to `services.clock.now() + Math.max(1, autoStartSeconds) * 1000`.
  6. `store.put(next)`, `countdown.sync(next)`, `planWatch.follow(sessionId, next.planDir)` when `planDir` changed,
     and send `flows` with `store.all()`.
- **`signalOf(event, flow, fromCurrentHost)`** (pure but for `node:path`) returns the signals one agent event gives,
  `[]` for none. `fromCurrentHost` is true when the event's `ChatAgentEvent.hostSessionId` is the host id the store
  holds the flow under now. Per member:
  - `skillStarted`, only when `agentId` is `MAIN_AGENT_ID` → `{ type: 'skillStarted', skill, args, argsPath }`.
    `args` is the event's `args`, unchanged. `argsPath` is `args` trimmed and read as a path: null when that is
    `''`; the trimmed text when it is absolute (`path.isAbsolute`); else that text resolved against
    `flow.projectDir` (`path.resolve`). `signalOf` reads no disk, so `argsPath` for `two words` is `/r/two words`;
    only the fold's plan argument reads `argsPath` (03), and a stage rule that wants text reads `args`.
  - `fileWritten`, only when `agentId` is `MAIN_AGENT_ID` → `{ type: 'fileWritten', path }`.
  - `turnStarted` → `{ type: 'turnStarted' }`; `turnEnded` → `{ type: 'turnEnded' }`. These carry no `agentId`:
    they are the main conversation's turn, and every turn emits `turnStarted`, an unrequested one included (04).
  - `agentSpawned` whose `parentAgentId` is `MAIN_AGENT_ID` → `{ type: 'subagentStarted', agentId }`. A subagent's
    own subagent gives `[]`.
  - `agentFinished` whose `agentId` is in `flow.runningSubagents` → `{ type: 'subagentFinished', agentId }`; any
    other `agentFinished` gives `[]`.
  - `sessionEnded` with `fromCurrentHost` true → one `subagentFinished` per id in `flow.runningSubagents`, in list
    order, then `{ type: 'turnEnded' }`. A process that exits or crashes mid-turn sends no `result` and no
    `agentFinished`, so this ends its turn and its subagents, and Resume make shows after a crash. The
    `subagentFinished` signals come first, so the `turnEnded` sees nothing busy.
  - `sessionEnded` with `fromCurrentHost` false → `[]`. After a clear, the old process's `sessionEnded` arrives late
    under the old host id (`chat-sessions.test.ts` `sessionEndedHostIds`), and it must not end the new process's
    make turn.
  - `userMessage` and every other member → `[]`. `userMessage` is not the turn start: `turnStarted` is.
  Main-side code may use `node:path` (AGENTS.md § A path).
- **Stage registry** in `start.ts`: `addStage(stage)` throws `Workflow stage <id> is already added` on a held id,
  keeps the list sorted by `order` (ties in add order), and returns a Disposable that removes it. `start` adds each of
  `BUILT_IN_MAIN_STAGES` through it. `exports: { addStage }`.
- **Plan watch** (`services.files`, full paths). `follow(sessionId, planDir)`: same `planDir` as now with its watch
  open → nothing. Same `planDir` as now with its watch closed by `planGone` → open it again, as for a new folder
  below: a plan re-created at the same path (the same slug planned again, a branch switch that restores the folder)
  is watched again. Otherwise close the session's watch; null → done. Else `stat(planDir)`: null or not a folder → signal
  `planGone`. Else `watch(planDir, onChange, { recursive: false, onError })` and read now. Never `watch` a missing
  folder: `Files.watch` creates the folder it is given. A read: `readIfPresent(planDir + '/plan.md')`, joined with
  `node:path` `join`; text → signal `{ type: 'planChanged', progress: readPlanProgress(text) }`; null → `stat(planDir)`,
  and null there → close the watch and signal `planGone`; a folder with no `plan.md` yet → nothing. `onChange` (any
  path) and `onError` each run a read. `check(sessionId)` runs a read for a watched session. A read that resolves
  after the session's watch moved or closed is dropped (a per-session generation number). A read that rejects is
  logged (`workflow`, `plan.md not read in <planDir>: <errorText>`). `dispose` closes every watch.
  `check` on `turnEnded` covers a folder delete the OS watcher may not report: `wigley:make` deletes the folder
  inside a turn. `check` on a session whose watch `planGone` closed does nothing; a plan-file `fileWritten` (change
  path step 3) or a `follow` reopens it.
- **Actions** (`run(sessionId, command)`), main-side commands only. Rejections, each an `Error` whose message the
  page toasts: unknown command → `Unknown workflow command <command>`; no flow → `No workflow flow for session <id>`;
  a command needing a plan with `planDir` null → `The session has no plan`. The commands needing a plan are
  `clearAndMake`, `resumeMake` and `makeInNewSession`; each checks `planDir` before any chat call. The message text
  is a `UserMessage` `{ text, images: [] }`:
  - `clearAndMake`, `resumeMake`: `await chat.clear(sessionId)`, then `await chat.send(sessionId, '/wigley:make <planDir>')`.
  - `makeInNewSession`: `profile = chat.profileOf(sessionId)`; null → reject `The session is not a chat session`.
    `await chat.launch({ projectDir: flow.projectDir, profile, message: '/wigley:make <planDir>' })`, then signal
    `handedOff` on this session. The new session needs no preset flow: chat's `sessionOpened` gives it
    `newFlow`, and its own first message's `skillStarted` (`wigley:make`, args the plan folder) sets its `planDir`
    and moves it to make. This keeps stage ids out of `main/` (plan.md boundary rule).
  - `retro`: `await chat.send(sessionId, '/wigley:retro')`.
  - `dismiss`: signal `{ type: 'dismissed' }`.
  - `cancelCountdown`: `deps.cancelCountdown(sessionId)`.
  Main does not re-check `available`: the page offers only available actions, and the countdown runs `clearAndMake`
  itself. The plan folder is sent unquoted, as the user types it.
- **Countdown** on `services.timers` (plan-usage task 02 adds it to `MainServices`). `sync(flow)`:
  `countdownEndsAt` non-null and no timer for the session → `timers.set(fire, max(0, endsAt − clock.now()))`;
  null and a timer → `timers.clear`. `stop` clears the session's timer. When a timer fires, the countdown first
  forgets the session's timer handle, then calls `deps.fire(sessionId)`. So the next plan ready's `sync` arms a new
  timer for that session. `start.ts`'s `fire(sessionId)`: when the
  flow still has `countdownEndsAt` non-null, put it with `countdownEndsAt: null` (send `flows`), then run the current
  stage's `autoCommand` through the actions; a rejection is logged (`workflow`, `auto-start failed: <errorText>`)
  and sent as no toast (main has no page to toast on). `cancelCountdown` (the action) puts `countdownEndsAt: null`
  and syncs. `onSettingsChanged` with `autoClearAndMake` off cancels every running countdown the same way.
- **Settings log line.** On each `onSettingsChanged` call, main logs one line: `services.log('workflow',
  'settings: autoClearAndMake <on|off>, autoStartSeconds <n>')`, which the log shows as
  `[workflow] settings: autoClearAndMake on, autoStartSeconds 3`. `<on|off>` is `on` when `autoClearAndMake` is
  true; `<n>` is `Math.max(1, autoStartSeconds)`, the value the countdown uses. The self-test (10) waits on this line
  after it writes the settings, so the countdown arms only after main has the new values. Main logs no line at
  start.
- **Channel**: `api.channel.handle('flows', …)` and `handle('runAction', ({ sessionId, command }) => actions.run(…))`;
  `api.channel.send('flows', store.all())` after each change. The heard events are typed
  `QualifiedEvents<'chat', ChatMainEvents> & QualifiedEvents<'sessions', SessionsMainEvents>`.
- **`dispose`**: `planWatch.dispose()`, `countdown.dispose()`.

GIVEN a saved flow for host id `h1` WHEN chat restores that row under a new row id THEN the row's flow is the saved
one with the new `sessionId`, `turnRunning` false and `countdownEndsAt` null
GIVEN a plan-ready flow WHEN `clearAndMake` runs THEN chat gets `clear('s1')` and then `send('s1', { text: '/wigley:make /r/plan-a', images: [] })`, in that order
GIVEN `autoClearAndMake` on WHEN a flow enters plan ready THEN `countdownEndsAt` is now + 10 000 ms, and at that time
Clear & make runs
GIVEN a watched plan folder WHEN it is deleted THEN `planGone` is signalled once and the watch is closed
GIVEN a flow whose watch `planGone` closed WHEN the session writes that `plan.md` again THEN the watch reopens and
signals `planChanged`
GIVEN a flow with a turn running WHEN its current process sends `sessionEnded` THEN `turnRunning` is false and
`runningSubagents` is `[]`

Tests:     `flow-store.test.ts` (`describe('createFlowStore')`, over `createMemoryFiles` from `src/shared/memory-files.ts`):
           · `it.each` load table: missing file → `all()` empty after `open` makes `newFlow`; a saved flow for `h1`
             with `turnRunning: true`, `runningSubagents: ['a1']` and a `countdownEndsAt` → `open('s9', 'h1', '/r')`
             returns it with `sessionId 's9'`, `turnRunning false`, `runningSubagents []`, `countdownEndsAt null`;
             `hostIdOf('s9')` is `'h1'`, and `'h2'` after `rekey('s9', 'h2')`; not-JSON text and a wrong shape → no
             saved flows and one logged line
           · `it` a `put`, `rekey('s1', 'h2')` and `drop` each leave `flows.json` holding exactly the expected
             entries, read back as JSON, and a saved entry no session opened stays in the file
           · `it` `resetFlows('/r')` turns the open `/r` flow into `newFlow`, leaves an open `/q` flow as it was,
             and removes a saved, unopened `/r` entry from the file
           `plan-watch.test.ts` (`describe('createPlanWatch')`, memory files; the memory adapter reports each change at
           once): following a folder with a plan.md signals `planChanged` with `readPlanProgress` of it; a write to
           plan.md signals again; deleting the folder signals `planGone` once and later writes signal nothing
           while no `follow` runs; after that `planGone`, a write that re-creates the folder and then
           `follow(s, the same planDir)` signals `planChanged` (a re-created plan never watched again); `check` on
           that closed watch before the `follow` signals nothing;
           following a missing folder signals `planGone` and creates no folder (`stat` stays null); a read that
           resolves after `follow(s, null)` signals nothing (a deferred `read` the test resolves late)
           `actions.test.ts` (`describe('createWorkflowActions')`, a recording chat fake): one `it.each` table
           `{ command, flow, calls, signals }` asserting the ordered chat calls and the signals for `clearAndMake`,
           `resumeMake`, `makeInNewSession` (calls `launch` with `{ projectDir: '/r', profile: 'personal', message }`
           then signals `handedOff`), `retro`, `dismiss`, `cancelCountdown`; one table of rejections with their exact
           messages (unknown command, no flow, no profile, and `The session has no plan` for each of
           `clearAndMake`, `resumeMake` and `makeInNewSession` with `planDir` null, with no chat call recorded); and
           a row where `clear` rejects: `send` is not called and `run` rejects with the same error
           `countdown.test.ts` (`describe('createCountdown')`, a fake `Timers` the test fires by hand, a fixed clock):
           a flow with `countdownEndsAt` arms one timer for `endsAt − now` ms; syncing it again arms no second one;
           syncing it with `countdownEndsAt: null` clears it; `stop` clears it; firing calls `fire('s1')` once;
           after a fire, syncing the flow with a new `countdownEndsAt` arms a new timer (a fired timer kept as
           the session's, so the next plan ready never counts down)
           `agent-signals.test.ts` (`describe('signalOf')`): one `it.each` table `{ event, flow, fromCurrentHost,
           expected }`, `expected` the whole signal list. Flows have `projectDir` `/r`. Rows:
           · main `skillStarted` with args `/a/plan-x` → `args` and `argsPath` `/a/plan-x`
           · args `docs/features/x/plan-a` → `args` unchanged, `argsPath` `/r/docs/features/x/plan-a`
           · args `two words` → `args` `two words`, `argsPath` `/r/two words` (args rewritten for a stage rule)
           · args `''` → `argsPath` null
           · a subagent's `skillStarted` and `fileWritten` → `[]`; main `fileWritten` → its path
           · `turnStarted` → `turnStarted`; `turnEnded` → `turnEnded`; `userMessage` → `[]`
           · `agentSpawned` with parent `main` → `subagentStarted`; with parent `a1` → `[]`
           · `agentFinished` `a1` with `runningSubagents: ['a1']` → `subagentFinished a1`; with `[]` → `[]`
           · `sessionEnded` from the current host with `['a1', 'a2']` → `subagentFinished a1`, `subagentFinished a2`,
             `turnEnded`; from another host → `[]` (an old process ending the new one's turn)
           · `toolStarted` → `[]`
           `start.test.ts` (`describe('workflowMainPart')`), the wiring once, building the api the way
           `src/plugins/notes/main/start.test.ts` does, with memory files and fake timers: `sessions.connected` then
           `chat.sessionOpened` for `s1`; `chat.agentEvent` `skillStarted wigley:feature`, `turnStarted`,
           `fileWritten` of a plan.md (the memory files hold it, with three boxes under `## Tasks`), `turnEnded`; the last `flows` message holds `s1` at `planReady` with
           the plan's progress, and `flows.json` holds it under its host id; with `autoClearAndMake` on, advancing
           the fake timers by 10 000 ms makes chat's fake record `clear` then `send` `/wigley:make <plan folder>`.
           More `it`s in that file, each over the same wiring:
           · a `turnEnded` that changes no field (a flow in make with no turn running) still runs
             `planWatch.check`: the plan folder deleted from the memory files before it gives a `flows` message
             with the flow at `closed`
           · after `planGone`, a `fileWritten` of the same `plan.md` re-created gives `planChanged` progress in
             the next `flows` message
           · `sessionEnded` under the flow's host id mid-turn leaves `turnRunning` false and `runningSubagents`
             `[]`; the same event under the old host id after `hostSessionChanged` changes nothing
           · a settings change to `{ autoClearAndMake: true, autoStartSeconds: 3 }` makes the test's recording `log`
             get exactly `('workflow', 'settings: autoClearAndMake on, autoStartSeconds 3')`; `autoStartSeconds: 0`
             logs `autoStartSeconds 1`
Done when: compiles; `npm run lint` passes (check-layers included); the test gate runs the tests above. Runtime checks
           are in the final verification task.
Commit:    one commit for the group

## Proof
