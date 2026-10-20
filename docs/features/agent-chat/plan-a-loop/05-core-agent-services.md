# 05 — Core: agent contract, services, self-test scripts, ACP removal, fake harness

Status: in progress
Type: Task
Wave: 2 · Depends on: 02
Plan: [plan.md](plan.md)

Files:     modify `src/contracts/agent.ts` · `src/contracts/ambient.ts` · `src/contracts/plugin.ts` ·
           `src/contracts/settings.ts` · `src/config/settings.ts` · `src/main/main.ts` · `src/main/window.ts` ·
           `src/main/selftest.ts` · `src/main/plugins/main-api.ts` · `scripts/check-layers.mts` · `forge.config.mts` ·
           `package.json` · `package-lock.json`
           create `src/main/selftest-config.ts` · `src/shared/fake-agent-harness.ts` · `src/shared/expand-home.ts`
           delete `src/main/acp/acp-agent-client.ts` · `src/mock-agent/mock-agent.ts` (and their now-empty folders)
           test `src/main/plugins/main-api.test.ts` · create `src/main/selftest-config.test.ts` ·
           `src/shared/fake-agent-harness.test.ts` · `src/shared/expand-home.test.ts`
Consumes:  `scripts/check-layers.mts` as task 02 leaves it (02 adds no entry: its files fall under `src/shared` and
           `src/shared/page`) ← 02 ·
           `SelfTestScript`, `SelfTestHost`, `MainServices` in `src/contracts/plugin.ts` (tree) ·
           `startSelfTest`, `SelfTestDriver`, `SelfTestConfig` in `src/main/selftest.ts` (tree) ·
           `createMainApi(manifest, deps: MainApiDeps)` in `src/main/plugins/main-api.ts` (tree) ·
           `windowService(window)` in `src/main/window.ts` (tree) · `HARNESSES` in `src/plugins/sessions/contract.ts`
           (tree; holds `'claude'`)
Produces:  `src/contracts/agent.ts` — exactly the block in plan.md § Shared names and signatures (`ControlChoice`,
           `SessionControl`, `ProcessActivity`, `ChatEntry`, `ChatEntryKind`, `AgentStart`, `AgentProcessEvents`,
           `AgentProcess`, `AgentHarness`), with its comments; `AgentClient` and `StopReason` gone
           `export type RandomUuid = () => string;` in `src/contracts/ambient.ts` (comment: an RFC 4122 v4 UUID, fresh
           per call)
           `MainServices` in `src/contracts/plugin.ts` gains `randomUuid: RandomUuid`, `agentHarnesses: readonly
           AgentHarness[]`, and `window: { show(): void; isFocused(): boolean; chooseFolder(): Promise<string | null> }`
           `SelfTestHost.run(script: SelfTestScript): void` — signature unchanged, comment rewritten: each plugin's
           part calls it at most once during its start; the driver runs the handed scripts in hand-over order on each
           run
           `Settings.claude: { command: string }` in `src/contracts/settings.ts`; `defaultSettings.claude = { command:
           '~/.local/bin/claude' }` in `src/config/settings.ts`
           `export function expandHome(value: string, homeDir: string): string` in `src/shared/expand-home.ts`
           `export type FakeAgentCall = { method: 'send'; text: string } | { method: 'interrupt' } | { method:
           'setControl'; id: string; value: string } | { method: 'end' }` in `src/shared/fake-agent-harness.ts`
           `export interface FakeAgentProcessRecord { request: AgentStart; events: AgentProcessEvents; calls:
           FakeAgentCall[]; ended: boolean }` in the same file
           `export interface FakeAgentHarness extends AgentHarness { readonly processes: readonly
           FakeAgentProcessRecord[]; failNextStart(message: string): void; holdEnd(): void; releaseEnd(): void }` in
           the same file
           `export function createFakeAgentHarness(): FakeAgentHarness` in the same file
           `export function isFakeAgentHarness(harness: AgentHarness): harness is FakeAgentHarness` in the same file
           `export const FAKE_HOLD_TEXT = 'fake: hold';` and `export const FAKE_TOOL_TEXT = 'fake: tool';` in the
           same file
           `export interface HandedScript { pluginId: string; script: SelfTestScript }`,
           `export type SelfTestConfig = Pick<SelfTestScript, 'pageBinds' | 'settings'>` (moved from `selftest.ts`) and
           `export function mergeSelfTestConfigs(handed: readonly HandedScript[]): SelfTestConfig` in
           `src/main/selftest-config.ts`
           `SelfTestDriver { hostFor(pluginId: string): SelfTestHost; closeHandover(): SelfTestConfig }` in
           `src/main/selftest.ts` (no longer extends `SelfTestHost`)
           `MainApiDeps.services: Omit<MainServices, 'selfTest'>` and `MainApiDeps.selfTestFor(pluginId: string):
           SelfTestHost | null` in `src/main/plugins/main-api.ts`
           `windowService(window: BrowserWindow): MainServices['window']` in `src/main/window.ts`
           `LAYERS` entries in `scripts/check-layers.mts` (listed in § Layer check below)
Decisions: plan.md Decisions: Claude only behind a seam (round 1, 3), ACP adapter and mock agent removed (round 4),
           `claude.command` core setting and `randomUuid` (after round 4), one self-test script per plugin (after
           round 4) · the fake's id is `'claude'`, so chat finds it by the same id as the real adapter (brief) · the
           shared object `MainServices` stays one value for every plugin except `selfTest`, which `createMainApi`
           fills per plugin from `selfTestFor(manifest.id)`, so the driver knows which plugin handed each script ·
           the fake lives in `src/shared/` because chat's self-test script (task 11, `src/plugins/chat/main`) and the
           tests both reach it, and `src/plugins` may import `src/shared` but not `src/main` · `expandHome` lives in
           `src/shared/` because main.ts (task 06, the `claude` command) and chat main (task 07, a profile's
           `configDir`) apply the same `~/` rule

## Agent contract and core services

- `src/contracts/agent.ts`: replace the file whole with plan.md's block. `ChatEntryKind` and every comment there land
  verbatim.
- `src/contracts/plugin.ts`: imports `RandomUuid` from `./ambient` and `AgentHarness` from `./agent`; `MainServices`
  gains the three members above. The comment over `MainServices` adds: `agentHarnesses` lists every harness adapter
  the app runs, found by `id`; `window.chooseFolder` opens the native folder dialog over the window and resolves to
  null when the user cancels; `window.isFocused` is true while the app's window has focus.
- `src/contracts/settings.ts`: `claude: { command: string }` with the comment `` `command` is the `claude` executable
  a session runs; a leading `~/` means the home folder, since an app started from the Dock has no shell `PATH`. ``
- `src/shared/expand-home.ts` `expandHome`: a value starting `~/` → `homeDir` joined with the rest by one `/`
  (string join, no `node:path`, since `src/shared` imports no package); any other value returned as it stands (`~`
  alone, `~user/x`, `/abs`, `rel` included).
- `src/main/window.ts` `windowService`: `show` as today; `isFocused: () => window.isFocused()`; `chooseFolder`
  calls `dialog.showOpenDialog(window, { properties: ['openDirectory', 'createDirectory'] })` and resolves to
  `filePaths[0]`, or null when `canceled` is true or `filePaths` is empty. Its comment names all three.
- `src/main/main.ts`:
  - `randomUuid: RandomUuid = () => randomUUID()` (from `node:crypto`, beside `randomBytes`), passed as
    `services.randomUuid`.
  - `agentHarnesses: isSelfTest ? [createFakeAgentHarness()] : []` — the list task 06 adds the Claude adapter to
    outside the self-test.
  - `window`: `windowService(window)` outside the self-test; in the self-test the same with `chooseFolder: () =>
    Promise.resolve(null)`, since an offscreen run can show no dialog.
  - `startMainParts` takes `services: Omit<MainServices, 'selfTest'>` and passes `selfTestFor: (pluginId) =>
    selfTest?.hostFor(pluginId) ?? null`; the `selfTestHost` local goes.
  - `buildConfig` keeps its shape; `SelfTestConfig` is imported from `./selftest-config`.

## Self-test: one script per plugin

- `src/main/plugins/main-api.ts` `createMainApi`: returns `services: { ...deps.services, selfTest:
  deps.selfTestFor(manifest.id) }`; every other member as today.
- `src/main/selftest-config.ts` `mergeSelfTestConfigs` (pure, no Electron import):
  - `pageBinds`: every script's binds concatenated in hand-over order.
  - `settings`: per plugin id, the union of the setting names every script sets. Two scripts setting the same
    setting of the same plugin to values whose `JSON.stringify` is equal merge to that value; to different values it
    throws `Self-test scripts of <first pluginId> and <second pluginId> set <settings plugin>.<setting> to different
    values` (e.g. `Self-test scripts of forms and chat set keys.whichKeyTimeoutMs to different values`).
  - An empty list returns `{ pageBinds: [], settings: {} }`.
- `src/main/selftest.ts`:
  - `startSelfTest` returns a `SelfTestDriver`. `hostFor(pluginId)` returns a host whose `run(script)` records
    `{ pluginId, script }` in hand-over order. A second `run` under the same plugin id throws `Plugin <pluginId>
    handed over a second self-test script; each plugin hands at most one`. A `run` after `closeHandover` throws the
    message it throws today.
  - `closeHandover()`: with nothing handed, fails as today (`a plugin handed over a self-test script during start`).
    Otherwise it calls `mergeSelfTestConfigs`; a throw fails the self-test through `failSelfTest('the self-test
    scripts merge', error, cleanUp)` and returns `{ pageBinds: [], settings: {} }`. On success it registers the one
    `did-finish-load` listener that starts a run over every handed script (the per-`run` listener goes) and returns
    the merged config.
  - A run waits for the page ready and focuses it once, as today, then for each handed script in hand-over order:
    reads the log length, `open(run)`, waits for its `shownLine`, runs its steps with its own `scrollsItself`,
    awaits its result and reports `<pluginId> result <problems joined by ', ', or 'as expected'>`. A failing script
    does not stop the next one: failures add up across scripts, and `all passed` / `<n> failed` prints once, after
    the last script, before the exit. A run a reload interrupts stands down between and inside scripts, as inside
    steps today.
- The forms script hands over as today (`selfTest?.run(formsSelfTestScript(sessions))`); its steps and lines are
  unchanged, so `npm run selftest` passes with one script.

## ACP removal

- Delete `src/main/acp/acp-agent-client.ts` and `src/mock-agent/mock-agent.ts`; remove the third `build` entry
  (`src/mock-agent/mock-agent.ts`) from `forge.config.mts`.
- `@agentclientprotocol/sdk` leaves `package.json` and `package-lock.json` by
  `source ~/.nvm/nvm.sh && nvm use && npm uninstall --ignore-scripts --no-audit --no-fund @agentclientprotocol/sdk`
  run in the repo root. This is a removal, not an install. After it, `git diff --stat -- package.json
  package-lock.json` must show deletions only, and `git diff package-lock.json` must touch only the root
  `"@agentclientprotocol/sdk": "^1.9.0"` dependency line and the `node_modules/@agentclientprotocol/sdk` block.
  Any other added, changed or removed package (`zod` included) means: stop, restore both files with `git checkout --
  package.json package-lock.json`, and report the diff to the lead without retrying.
- Measured at plan time, re-verify: `grep -rln "AgentClient\|acp-agent-client\|mock-agent" src scripts
  forge.config.mts` lists `src/mock-agent/mock-agent.ts`, `src/contracts/agent.ts`, `src/main/acp/acp-agent-client.ts`,
  `scripts/check-layers.mts`, `forge.config.mts`; after this task it lists nothing.

## Layer check (`scripts/check-layers.mts` `LAYERS`)

Task 02's shared layout files fall under the existing `src/shared` (`src/shared/layouts/`) and `src/shared/page`
layers, which the chat entries below allow; this task adds:

- remove `'src/main/acp'` and `'src/mock-agent'`, and `'src/main/acp'` from `'src/main/main.ts'`'s `layers`
- add `'src/main/claude-code': { layers: ['src/contracts', 'src/shared'], packages: ['node:'] }`, and
  `'src/main/claude-code'` to `'src/main/main.ts'`'s `layers`
- add `'src/plugins/chat': { layers: ['src/contracts', 'src/shared', 'src/plugins/sessions/contract.ts',
  'src/plugins/keys/contract.ts'], packages: [] }`
- add `'src/plugins/chat/main': { layers: ['src/contracts', 'src/shared', 'src/plugins/chat',
  'src/plugins/chat/layouts', 'src/plugins/sessions/contract.ts'], packages: ['node:'] }`
- add `'src/plugins/chat/layouts': { layers: [], packages: [] }`
- add `'src/plugins/chat/page': { layers: ['src/contracts', 'src/shared', 'src/shared/page', 'src/plugins/chat',
  'src/plugins/chat/layouts', 'src/plugins/keys/contract.ts', 'src/plugins/sessions/contract.ts'], packages: [] }`
- add `'src/plugins/chat'` and `'src/plugins/chat/main'` to `'src/plugins/main.ts'`'s `layers`; `'src/plugins/chat'`
  to `'src/plugins/manifests.ts'`'s; `'src/plugins/chat'` and `'src/plugins/chat/page'` to `'src/plugins/page.ts'`'s

When the docs plugin (plan B of docs-browser) landed first, the entries are added beside its own, and the run log
says so (plan.md Preconditions).

## Fake agent harness (`src/shared/fake-agent-harness.ts`)

Scripted behaviour, pinned. Every emission runs in a microtask queued by the call that causes it (never inside the
call), so a caller's state is in place before its events arrive; a test flushes with `await Promise.resolve()`
(twice where a step queues a second microtask). `n` is the process's turn number, counting sends from 1. Every call
on a process (`send`, `interrupt`, `setControl`, `end`) is pushed to its record's `calls` first, in call order, the
refused ones included, so a test or chat's self-test script reads exactly what chat asked of the harness.

- `id`: `'claude'`. `processes`: one record per `start` that did not throw, in start order, the same array object for
  the harness's life; each record changes in place as its process is used. A record's `request` and `events` are the
  very objects `start` received.
- `failNextStart(message)`: the next `start` throws `new Error(message)`, records nothing and emits nothing; the one
  after starts normally.
- `start(request, events)`: records `{ request, events, calls: [], ended: false }`; then emits `controls` with
  `[{ id: 'mode', label: 'Mode', choices: [{ value: 'auto', label: 'Auto' }, { value: 'plan', label: 'Plan' }], value: 'auto' },
  { id: 'effort', label: 'Effort', choices: [{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' }], value: 'medium' }]`, then `commands(['fake-command'])`, then `activity('idle')`.
- `send(text)`: emits, in order (the user entry comes from the harness, as plan.md § Who emits what pins):
  1. `entry({ kind: 'user', id: 'user-<n>', text, raw: [{ fake: 'user', text }] })`
  2. `activity('working')`
  3. when `text` is `FAKE_HOLD_TEXT`: nothing more — the turn stays open until `interrupt` or `end`.
  4. when `text` is `FAKE_TOOL_TEXT`: `entry({ kind: 'tool', id: 'tool-<n>', toolUseId: 'fake-tool-<n>', name:
     'Bash', input: { command: 'echo fake' }, summary: 'echo fake', result: null, raw: [{ fake: 'tool' }] })`, then
     the same id with `result: { text: 'fake', isError: false }` and `raw: [{ fake: 'tool' }, { fake: 'tool-result' }]`,
     then `entry({ kind: 'assistant', id: 'assistant-<n>', text: 'fake agent ran a tool', streaming: false, raw:
     [{ fake: 'assistant', text: 'fake agent ran a tool' }] })`, then step 6.
  5. otherwise: `entry({ kind: 'assistant', id: 'assistant-<n>', text: 'fake agent heard: ', streaming: true, raw:
     [{ fake: 'assistant', text: 'fake agent heard: ' }] })`, then the same id with `text: 'fake agent heard:
     <text>'`, `streaming: false`, `raw` both events' objects (the second `{ fake: 'assistant', text: <text> }`),
     then step 6.
  6. `entry({ kind: 'result', id: 'result-<n>', stopReason: 'end_turn', costUsd: null, durationMs: null, raw: [{
     fake: 'result' }] })`, then `activity('idle')`.
- `interrupt()`: while a turn is open (only a held turn can be), emits `entry({ kind: 'notice', id: 'notice-<n>',
  text: 'Interrupted', tone: 'info', raw: [{ fake: 'interrupt' }] })` then `activity('idle')`, and the turn closes;
  with no turn open it emits nothing.
- `setControl(id, value)`: throws `fake agent has no control <id>` for an id not declared and `fake agent control
  <id> has no choice <value>` for a value not among its choices (synchronously, after the call is recorded);
  otherwise emits `controls` with that control's `value` changed and the rest as they were.
- `end()`: sets `ended`; emits `ended({ code: 0, error: null })` and resolves after it; a second `end` on the same
  process resolves and emits nothing more. After `end`, `send`, `interrupt` and `setControl` throw `fake agent
  process has ended`.
- `holdEnd()`: every `end()` called after it, until `releaseEnd()`, sets `ended` at once but emits nothing and returns
  a promise left pending. `releaseEnd()` then emits `ended({ code: 0, error: null })` for each held process in call
  order, resolves their promises, and turns the hold off; with nothing held it only turns the hold off.
- `isFakeAgentHarness(harness)`: true only for an object `createFakeAgentHarness` returned (a module-private
  `WeakSet` of them), so chat's self-test script reads the records through the type guard without a cast.

## Behaviour and tests

GIVEN `~/.local/bin/claude` and home `/Users/u` WHEN `expandHome` runs THEN it returns `/Users/u/.local/bin/claude`
GIVEN `~`, `/abs/x`, `rel/x`, `~other/x` WHEN `expandHome` runs with home `/Users/u` THEN each is returned as it stands
GIVEN two scripts handed by `forms` then `chat` WHEN `mergeSelfTestConfigs` runs THEN binds are forms' then chat's and settings hold both plugins' settings
GIVEN both scripts set `keys.whichKeyTimeoutMs` to 1000 WHEN merged THEN the merged setting is 1000
GIVEN `forms` sets `keys.whichKeyTimeoutMs` 1000 and `chat` sets it 2000 WHEN merged THEN it throws `Self-test scripts of forms and chat set keys.whichKeyTimeoutMs to different values`
GIVEN a `selfTestFor` returning a host per plugin id WHEN `createMainApi` builds plugin `forms`'s API THEN `api.services.selfTest` is the host for `forms`, and the other services are the shared ones
GIVEN a fake process WHEN `start` runs THEN the record holds the very request and events passed, and controls, `['fake-command']`, idle follow
GIVEN `failNextStart('no claude')` WHEN `start` runs twice THEN the first throws `no claude` and records nothing, the second starts
GIVEN a started fake process WHEN `send('hi')` runs and microtasks flush THEN events are user `hi`, working, assistant `fake agent heard: ` streaming, assistant `fake agent heard: hi` final, result `end_turn`, idle
GIVEN a started fake process WHEN `send(FAKE_TOOL_TEXT)` runs THEN events are user, working, tool `fake-tool-1` with result null, the same tool with result `fake`, assistant `fake agent ran a tool`, result, idle
GIVEN a held turn (`FAKE_HOLD_TEXT`) WHEN `interrupt()` runs THEN a notice `Interrupted` and `idle` follow, and `calls` ends with `{ method: 'interrupt' }`
GIVEN a started fake process WHEN `setControl('effort', 'high')` runs THEN `controls` reports effort `high` and mode `auto`, and `calls` holds `{ method: 'setControl', id: 'effort', value: 'high' }`
GIVEN a started fake process WHEN `setControl('effort', 'max')` runs THEN it throws `fake agent control effort has no choice max`, and the call is recorded
GIVEN `holdEnd()` WHEN `end()` runs THEN the promise stays pending and no `ended` is emitted until `releaseEnd()`, which emits `ended({ code: 0, error: null })` and resolves it
GIVEN an ended fake process WHEN `send('x')` runs THEN it throws `fake agent process has ended`

Tests:     `src/shared/expand-home.test.ts`:
           `expandHome_TildeSlash_JoinsHome` — `/Users/u/.local/bin/claude`;
           `expandHome_OtherValues_ReturnedAsTheyStand` — `~`, `/abs/x`, `rel/x`, `~other/x` unchanged
           `src/main/selftest-config.test.ts`:
           `mergeSelfTestConfigs_TwoScripts_ConcatenatesBindsInHandOverOrder` — binds `[formsBind, chatBind]`,
           settings `{ forms: {...}, chat: {...} }` as built in the test;
           `mergeSelfTestConfigs_SameSettingSameValue_Merges` — `{ keys: { whichKeyTimeoutMs: 1000 } }`;
           `mergeSelfTestConfigs_SameSettingDifferentValues_Throws` — the message above;
           `mergeSelfTestConfigs_NoScripts_IsEmpty` — `{ pageBinds: [], settings: {} }`
           `src/main/plugins/main-api.test.ts`: existing tests pass `selfTestFor: () => null`;
           `createMainApi_SelfTest_IsTheHostForThePlugin` — `selfTestFor` records `['forms']`, `api.services.selfTest`
           is the host object it returned, `api.services.clock` is the shared clock object
           `src/shared/fake-agent-harness.test.ts`:
           `start_RecordsRequestAndEvents_ThenControlsCommandsIdle` — `processes[0].request` and `.events` are the
           objects passed (`toBe`), the exact controls array above, `['fake-command']`, `'idle'`;
           `failNextStart_ThrowsOnce` — `no claude`, `processes` length 0 then 1;
           `send_PlainText_StreamsReplyThenResult` — the six events with the exact entries above for `hi`, and
           `calls` `[{ method: 'send', text: 'hi' }]`;
           `send_ToolText_EmitsToolWithResult` — the tool entries above, then the final assistant entry `assistant-1` (text `fake agent ran a tool`, `streaming: false`, raw as above), then `result-1`, idle;
           `send_HoldText_HoldsTurnOpen` — user entry and `working` only;
           `interrupt_HeldTurn_EndsWithNotice` — notice `Interrupted`, `idle`;
           `interrupt_NoTurn_EmitsNothing` — no events, the call recorded;
           `setControl_KnownChoice_ReportsNewValue` and `setControl_UnknownChoice_Throws` — values above;
           `end_EndsOnceAndRefusesSend` — one `ended({ code: 0, error: null })`, `ended` true, `send` throws;
           `holdEnd_KeepsEndPendingUntilRelease` — no `ended` and an unsettled promise after a flush, then both on
           `releaseEnd()`;
           `isFakeAgentHarness_TellsTheFakeFromAnother` — true for the fake, false for `{ id: 'claude', start }`
           The driver's run order lands in the self-test, not a unit test: `selftest.ts` imports Electron
Done when: `npm run typecheck`, `npm test`, `npm run lint` pass; `npm run selftest` passes with forms' script alone and
           prints `forms result as expected` and `all passed`; the ACP grep above prints nothing;
           `grep -c agentclientprotocol package.json package-lock.json` → `0` for both; `ls src/main/acp src/mock-agent`
           fails (both gone)
Commit:    one commit for the group — "Agent harness seam: AgentHarness contract with a scripted fake, randomUuid,
           window focus and folder dialog services, the claude.command setting, one self-test script per plugin; ACP
           client, mock agent and @agentclientprotocol/sdk removed"

## Proof

