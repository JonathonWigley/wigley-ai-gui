# 03 — The claude-code plugin

Status: not started
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     move `src/main/claude-code/*.ts` (18 sources and 16 tests, measured at plan time, re-verify) →
           `src/plugins/claude-code/main/` ·
           create `src/plugins/claude-code/manifest.ts` · create `src/plugins/claude-code/main/start.ts` ·
           test `src/plugins/claude-code/main/start.test.ts` ·
           modify `src/plugins/claude-code/main/claude-code-harness.ts` (after the move) ·
           modify `src/plugins/claude-code/main/claude-launch.ts` (after the move) ·
           test `src/plugins/claude-code/main/claude-code-harness.test.ts` ·
           test `src/plugins/claude-code/main/claude-launch.test.ts` ·
           modify `src/plugins/manifests.ts` · modify `src/plugins/main.ts` ·
           modify `src/contracts/processes.ts` · modify `src/contracts/plugin.ts` · modify `src/contracts/platform.ts` ·
           modify `src/contracts/settings.ts` · modify `src/config/settings.ts` · test `src/config/settings.test.ts` ·
           modify `src/main/main.ts` ·
           modify `src/main/processes/node-processes.ts` · test `src/main/processes/node-processes.test.ts` ·
           modify `src/main/processes/limited-processes.ts` · test `src/main/processes/limited-processes.test.ts` ·
           modify `src/shared/plugin-service-views.ts` · test `src/main/plugins/main-api.test.ts` ·
           modify `src/shared/fake-processes.ts` · test `src/shared/fake-processes.test.ts` ·
           modify `src/shared/plugin-part-harness.test-support.ts` ·
           test `src/plugins/manifests.test.ts` · create test `src/plugins/main.test.ts` ·
           test `src/main/config/config-store.test.ts` ·
           test `src/main/config/user-config.test.ts` · test `src/main/config/user-settings.test.ts` ·
           test `src/main/selftest-config.test.ts` ·
           modify `scripts/check-layers.mts` ·
           modify `docs/features/settings/design.md` · modify `docs/features/agent-chat/design.md` ·
           modify `docs/features/agent-chat/claude-stream.md` · modify `docs/features/agent-tower/design.md` ·
           modify `docs/features/unity-pool/design.md` · modify `docs/features/usage/design.md` ·
           modify `docs/features/followups.md` (paths only)
Consumes:  `AgentHarnessRegistry.register(harness: AgentHarness): AgentHarnessRegistration` ← 01 ·
           `AgentHarnessRegistration extends Disposable` ← 01 · `MainServices.agentHarnesses: AgentHarnessRegistry` ← 01 ·
           `AgentHarness.info(): AgentHarnessInfo` ← 01 (the Claude adapter's `info()` comes with 01) ·
           the registry main.ts builds and the fake registration in fake runs ← 01 ·
           `MainServices.sessionHost: SessionHost`, `CLAUDE_PERMISSION_TOOL` in `src/contracts/agent.ts`,
           `SessionHost.spawn`, `createFakeSessionHost` in `src/shared/fake-session-host.ts` (the tree today)
Produces:  `export const claudeCodeManifest` in `src/plugins/claude-code/manifest.ts`
           `export const claudeCodeMainPart: MainPart<typeof claudeCodeManifest>` in `src/plugins/claude-code/main/start.ts`
           `export function claudeCommand(setting: string, programs: PlatformPrograms): string` in `src/plugins/claude-code/main/start.ts`
           `export const CLAUDE_HARNESS_ID = 'claude';` in `src/plugins/claude-code/main/claude-code-harness.ts`
           `export interface SpawnOptions {` in `src/contracts/processes.ts`
           `export interface SpawnEvents {` in `src/contracts/processes.ts`
           `export interface SpawnExit {` in `src/contracts/processes.ts`
           `export interface SpawnStartError {` in `src/contracts/processes.ts`
           `export type SpawnSignal = 'SIGTERM' | 'SIGKILL';` in `src/contracts/processes.ts`
           `export interface SpawnedProcess {` in `src/contracts/processes.ts`
           `spawn(command: string, args: readonly string[], options: SpawnOptions): SpawnedProcess;` in `src/contracts/processes.ts`
           `agentEnvironment: Readonly<Record<string, string>>;` in `src/contracts/plugin.ts`
           `agentHomeDir: string;` in `src/contracts/plugin.ts`
           `export const realHarnessPluginIds: readonly string[]` in `src/plugins/manifests.ts`
           `export function withoutRealHarnessPlugins(manifests: readonly PluginManifest[], mainParts: readonly MainPart[], isFake: boolean): { manifests: readonly PluginManifest[]; mainParts: readonly MainPart[] }` in `src/plugins/manifests.ts`
           `export function coreDefaultSettings(): Settings` in `src/config/settings.ts`
           `readonly spawns: FakeSpawn[]` in `src/shared/fake-processes.ts`
Decisions:
  - Plugin id `claude-code`, harness id `claude` (`CLAUDE_HARNESS_ID`), setting `claude-code.command` (plan.md
    § Decisions, Decided by the agent). The plugin's `dependsOn` and `reads` are empty in both processes: it reads only
    services. Task 08 adds `sessions` when the plugin contributes `permission_prompt`.
  - The manifest: `label: 'Claude Code'` (no other manifest uses it, measured at plan time), `description:
    'Runs agent sessions on the Claude Code CLI.'`, `settings: { command: '' }`, `commands: {}`, `scopes: {}`,
    `themeTokens: {}`, and `settingInfo.command` = `{ label: 'Claude command', description: 'The claude program
    sessions run; ~ is the home folder. Empty, it is the platform default, ~/.local/bin/claude. Applies to the next
    session.' }`. The file opens with a comment on what the plugin is, as every manifest does. Task 05 adds `profiles`.
  - A manifest default is a static literal: `definePlugin` takes a plain object, the page serves it, and no manifest
    reads a service (measured at plan time). So the default cannot be `services.platform.programs.claude`. The rule:
    an empty `command` means the platform's program, `claudeCommand(setting, programs)` returns `programs.claude` for
    `''` and the setting itself for any other value. This follows unity-pool's `scriptPath: ''` and
    `resolveScriptPath` (`src/plugins/unity-pool/main/pool-cli.ts`). (drafter)
  - `PlatformPrograms.claude`'s comment becomes: `// The program a Claude Code session runs when the
    claude-code.command setting is empty.` Lane P owns its lookup (plan.md § Out of scope).
  - The core setting `claude` leaves `Settings` (`src/contracts/settings.ts`), the defaults and `settingInfo`
    (`src/config/settings.ts`). With no other use of `programs`, `defaultSettingsFor(programs)` becomes
    `coreDefaultSettings()`, and `config/settings.ts` stops importing `PlatformPrograms`. Its callers are `main.ts`
    `defaultSettings()`, `settings.test.ts` and `manifests.test.ts` (2 calls each, measured at plan time). (drafter)
  - The user's `~/.config/wigley-ai-gui/settings.json` holds the keys `fonts`, `keys` and `chat` only (measured at
    plan time), so no `settings.json` edit (AGENTS.md § A setting). The implementer reads the file once before the
    commit. When it sets `claude`, the implementer stops and reports to the lead, and does not edit the file.
  - The hint text changes in three places in `claude-code-harness.ts`: the session spawn hint `…does not exist; set
    claude-code.command`, the one-shot hint `claude was not found at <command>; set claude-code.command`, and the
    comment over `runCli`, which names `claude-code.command`. The Claude adapter's own errors keep naming Claude
    (plan.md § Decisions).
  - `SpawnedProcess` and its records, in `src/contracts/processes.ts`, hold no Node type (plan.md § File Structure):
    ```ts
    export type SpawnSignal = 'SIGTERM' | 'SIGKILL';
    export interface SpawnStartError { message: string; notFound: boolean }
    export interface SpawnExit {
      code: number | null; signal: string | null; startError: SpawnStartError | null;
    }
    export interface SpawnEvents {
      stdout(chunk: string): void; stderr(chunk: string): void; closed(exit: SpawnExit): void;
    }
    export interface SpawnOptions {
      cwd: string; env: Readonly<Record<string, string>>; events: SpawnEvents;
    }
    export interface SpawnedProcess {
      write(text: string): void; endInput(): void; kill(signal?: SpawnSignal): void;
    }
    ```
    `spawn` takes the events in `options`, so the plan's three-parameter signature holds and no output can arrive
    before a listener exists; the session host passes its events at spawn the same way (`SessionHost.spawn`).
    `env` is the whole environment and nothing else passes through, as `ClaudeSpawn`'s `env` is today. (drafter)
  - Spawn rules, written as the comment on `ProcessRunner.spawn` and kept by every implementation: no shell; stdin,
    stdout and stderr are pipes; output arrives as UTF-8 text, a character never split across chunks; `closed` is
    called exactly once, on the first of the program's exit and its failure to start or run. A failure sets
    `startError` with the OS's message as it is and `notFound: true` for `ENOENT` (a missing program or `cwd`), and
    `code` and `signal` null. `kill()` sends `SIGTERM`. A `write`, `endInput` or `kill` after `closed` does nothing.
    An error on stdin (`EPIPE` after the exit) is dropped. Node's adapter passes `windowsHide: true`, as `run` does. `createNodeProcesses()` returns `{ run, startDetached, spawn }`.
    (drafter)
  - The adapter no longer logs a stdin error (it logs one through `child.stdin.on('error')` today), since the spawn
    drops it. (drafter)
  - The per-plugin view (`abortableProcesses`) kills every live spawned process with `SIGKILL` when the plugin's
    registrations are disposed, as an abort kills a `run` with `SIGKILL` in `node-processes.ts`. A spawn after the
    dispose starts no program; its `closed` is called on a microtask with `{ code: null, signal: null, startError: {
    message: 'Stopped <command>', notFound: false } }`, the same words a stopped `run` rejects with. A process leaves
    the view's live set at its `closed`. The view already forwards `startDetached` untracked, since a detached start outlives the plugin; its comment gains a line saying `spawn` is the tracked path. (drafter)
  - `limitRuns` passes `spawn` straight to its runner and counts it against no limit: the limit is git's, and git
    only calls `run`. `spawn` goes beside the `startDetached` forward it already has. (drafter)
  - The adapter's dep `spawn: ClaudeSpawn` becomes `processes: ProcessRunner`, called as `deps.processes.spawn(…)`,
    so a class runner such as `FakeProcesses` keeps its `this`. `ClaudeSpawn` and the `node:child_process` import
    leave the adapter. `cliSpawnError` reads `exit.startError.notFound` in place of `NodeJS.ErrnoException.code`.
    (drafter)
  - The adapter's dep `env: NodeJS.ProcessEnv` becomes `env: Readonly<Record<string, string>>`. `claudeEnv` takes
    `Readonly<Record<string, string>>` and returns `Record<string, string>`, `claudeLaunch` takes the same, and
    `ClaudeLaunch.env` becomes `Record<string, string>`; `definedEnv` in the adapter goes, since no value is undefined
    now. (drafter)
  - `MainServices.agentEnvironment` is today's `endpointEnv`: the app's environment, its undefined values dropped,
    plus `WIGLEY_AI_GUI_ENDPOINT_DIR` set to `appEndpointDir(paths, homeDir, appInstance.id)`, where `homeDir` is the
    run's home (`inputs.homeDir`). The rule is the same in every run mode, so `main.ts` builds it once in the services
    object it hands `startMainParts`. `endpointEnv` returns `Readonly<Record<string, string>>`. (drafter)
  - The home folder the adapter runs as: `MainServices.agentHomeDir: string`. It is `os.homedir()` in a drive run on
    Claude (`WIGLEY_DRIVE_HARNESS=claude`), and `inputs.homeDir` in every other run. The plugin passes it as the
    adapter's `homeDir` and expands the command against it. Reason: a drive run on Claude builds the adapter over
    `os.homedir()` today (`driveHarness` in `main.ts`), so a `~` command, the default `.claude` folder, transcripts
    and the one-shot runs' `cwd` are the user's. `services.homeDir` in that run is the run's empty `<run>/home`, so a
    plugin on it would find no `~` command and list no saved session. (plan.md § Decisions)
  - `main.ts` names the plugin only through the built-in plugin lists (plan.md § Boundary rules).
    `src/plugins/manifests.ts` exports `realHarnessPluginIds = [claudeCodeManifest.id]`, with the comment `// The
    built-in plugins that run a real agent harness, which a run on the fake harness leaves out.` (drafter)
  - The built-in source mechanism: `startCatalog` hands `createBuiltInSource({ manifests, mainParts })` the plugin
    lists (`src/main/plugin-catalog/built-in-source.ts`), and the config store, the switch and the served config all
    read plugins from the catalog. The filter is a pure function in `src/plugins/manifests.ts`:
    `withoutRealHarnessPlugins(manifests, mainParts, isFake)`. With `isFake` true it returns both lists without the
    ids in `realHarnessPluginIds`, filtered by `manifest.id` (a main part by `part.manifest.id`), each in its input
    order. With `isFake` false it returns both input lists unchanged. It imports `MainPart` as a type only, from
    `src/contracts/plugin.ts`. `startCatalog` in `main.ts` passes
    `createBuiltInSource(withoutRealHarnessPlugins(manifests, mainParts, isFakeHarnessRun(environment)))`. A helper
    in `main.ts`, `isFakeHarnessRun(environment: RunEnvironment): boolean`, decides it once: `selfTest` → true,
    `drive` → `environment.harness === 'fake'`, `live` → false. (plan.md § Decisions; the mechanism: drafter)
  - The exclusion is load-bearing now: the fake keeps the id `claude` until task 10, so a claude-code plugin in a fake
    run would register a second `claude`.
  - In a run on Claude, `main.ts` registers no harness; the plugin registers Claude's. Task 01's fake registration
    for fake runs stays as 01 left it. `claudeHarness()`, the `createClaudeCodeHarness` import and the
    `CLAUDE_PERMISSION_TOOL` import leave `main.ts`, and so does any Claude branch 01 left in `driveHarness`.
  - The plugin imports `CLAUDE_PERMISSION_TOOL` from `src/contracts/agent.ts` and passes it as the adapter's
    `permissionTool`, as `main.ts` does today, until task 08 moves it (`src/contracts` is open to every plugin
    layer).
  - The part's `start` wiring: `command` → `services.paths.expandTilde(claudeCommand(api.settings().command,
    services.platform.programs), services.agentHomeDir)`, read at each call, so a setting change applies to the next
    process; `permissionTool` → `CLAUDE_PERMISSION_TOOL`; `env` → `services.agentEnvironment`; `log` → `(_source,
    message) => services.log(message)`, so the adapter's lines show under `claude-code`; `host` →
    `services.sessionHost`; `processes` → `services.processes`; `files`, `paths`, `clock`, `randomUuid` → the
    services of the same name; `homeDir` → `services.agentHomeDir`. It registers the adapter with
    `services.agentHarnesses.register(harness)` and returns `{ commands: {}, dispose: () => registration.dispose() }`:
    the registry is a service the plugin API does not track (AGENTS.md § A plugin, `dispose`). No `refresh()` call
    in this task, since no declaration reads a setting yet; task 05 adds it with profiles. (drafter)
  - The adapter's `id: 'claude'` becomes `id: CLAUDE_HARNESS_ID`. Its log calls keep the source `'claude'`. (drafter)
  - `claudeCodeMainPart` joins `src/plugins/main.ts` right after `sessionsMainPart` and before `formsMainPart`, with
    the comment `// Before chat and usage, so Claude's harness is registered when they start.` Usage looks the
    harness up once at start today (`src/plugins/usage/main/start.ts`, the plan poller), and the host starts parts in
    list order where no dependency says otherwise. `claudeCodeManifest` joins `builtInManifests` right after
    `sessionsManifest`. A new `src/plugins/main.test.ts` pins the start order (Tests); `scripts/check-layers.mts`
    gains its entry `'src/plugins/main.test.ts': { layers: ['src/contracts', 'src/shared', 'src/plugins/main.ts'],
    packages: [] }`, with the comment `// Checks the order the built-in main parts start in.`, as
    `src/plugins/page.test.ts` has for page parts. (drafter)
  - `scripts/check-layers.mts`: the `'src/main/claude-code'` entry leaves `CORE_LAYERS`, and `'src/main/claude-code'`
    leaves the `'src/main/main.ts'` entry's layers. `PLUGIN_EXTRAS` gains `'claude-code': { main: NODE_ONLY }` with
    the comment `// Its adapter's tests drive fake children over node:events, node:readline and node:stream.` After
    the move, only `claude-code-harness.test.ts` imports `node:` (measured at plan time); the derived plugin main
    layer already admits `src/contracts`, `src/shared` and `src/shared/paths`, which the old entry listed.
  - Every relative import in a moved file gains one `../`: `src/main/claude-code/` sits 3 folders deep and
    `src/plugins/claude-code/main/` sits 4. `git mv` each file, so history follows.
  - No `contract.ts`: the plugin exports nothing to other plugins, and `tsconfig.plugin-types.json` emits only
    `src/contracts/*.ts` and `src/plugins/*/contract.ts`, so `plugins/_types` needs no change. The new records in
    `src/contracts/processes.ts` reach `_types` through that include, which is why they hold no Node type.
  - No self-test step: no fake run starts the plugin (plan.md § Decisions). The live checks cover it.
  - The sample paths `src/main/claude-code/stream-decoder.ts` in `src/shared/fake-agent-harness.ts` and
    `src/plugins/agents/main/preview.ts` are fake tool inputs, not references, and stay. (drafter)
  - Docs: every `src/main/claude-code` path in the doc files listed under Files becomes
    `src/plugins/claude-code/main`. `docs/features/settings/design.md` line 20 states that `claude.command` moved to
    the `claude-code` plugin as `claude-code.command`, with the key-hints setting still a follow-up.
    `docs/features/agent-chat/design.md` line 110 states the adapter is the built-in `claude-code` plugin, registered
    through `services.agentHarnesses`, and the `claude` path is its `claude-code.command` setting. plan.md and the
    task documents keep their text. Task 16 re-reads them all.
Mandatory: AGENTS.md § Architecture: "A plugin", "An agent harness", "An ambient service", "A setting", and the
           `npm run lint` layer paragraph; `docs/features/agent-harnesses/design.md` § The claude-code plugin;
           `docs/features/plugin-framework/design.md` § Hot reload (Wave 4) and § Runtime loader (Wave 4 step 3);
           `src/plugins/unity-pool/main/pool-cli.ts` `resolveScriptPath` (the empty-setting pattern)
GIVEN the live app WHEN main parts start THEN the claude-code part registers a harness with id `claude` before chat and usage start
GIVEN the claude-code part is running WHEN it stops THEN its registration is disposed and the registry no longer lists `claude`
GIVEN `claude-code.command` is `''` WHEN the adapter spawns THEN it runs `platform.programs.claude` with `~` expanded against the agent home
GIVEN `claude-code.command` is set WHEN the adapter spawns THEN it runs that value with `~` expanded, read at that spawn
GIVEN a one-shot `claude` cannot be found WHEN the run ends THEN the reason is `claude was not found at <command>; set claude-code.command`
GIVEN a run on the fake harness (self-test, drive on fake) WHEN the catalog loads THEN it holds no `claude-code` plugin, and no run spawns `claude`
GIVEN a plugin with a live spawned process WHEN the plugin stops THEN the process is killed with `SIGKILL`
GIVEN a plugin that has stopped WHEN it spawns THEN no program starts and `closed` reports `Stopped <command>`
GIVEN core settings WHEN the app loads THEN they hold no `claude` key, and Settings mode shows `Claude command` under the Claude Code plugin
Tests:
  - `src/plugins/claude-code/main/start.test.ts` (new; `startMainPart` from the part harness, with a recording
    `AgentHarnessRegistry` double of its own passed as `services.agentHarnesses`: `register` pushes the harness and
    returns a handle whose `dispose` removes it and counts; `refresh` counts):
    - `claudeCommand_EmptyOrSet_PicksThePlatformProgramOrTheSetting` — table: `('', { claude: '~/.local/bin/claude' })`
      → `'~/.local/bin/claude'`; `('/opt/claude', { claude: '~/.local/bin/claude' })` → `'/opt/claude'`.
    - `start_RegistersTheClaudeHarness` — after start the double holds one harness, `id === 'claude'`.
    - `stop_DisposesTheRegistration` — after `harness.stop()` the double holds none and counted 1 dispose.
    - `accountStatus_CommandSetting_SpawnsItInTheAgentHomeWithTheAgentEnvironment` — services `agentHomeDir:
      '/Users/u'`, `agentEnvironment: { PATH: '/bin', WIGLEY_AI_GUI_ENDPOINT_DIR: '/e' }`, settings `{ command:
      '~/bin/claude' }`; `registered.accountStatus(null)` → `processes.spawns[0]` has `command: '/Users/u/bin/claude'`,
      `args: ['auth', 'status', '--json']`, `cwd: '/Users/u'`, `env: { PATH: '/bin', WIGLEY_AI_GUI_ENDPOINT_DIR: '/e' }`.
      Then `pushSettings({ command: '' })` and a second call → `spawns[1].command: '/Users/u/.local/bin/claude'`.
  - `src/plugins/claude-code/main/claude-code-harness.test.ts` (moved): every `spawn:` dep (5, measured at plan time)
    becomes `processes:`, built by a new test helper `childProcesses(children)`: a `ProcessRunner` whose `run`
    throws and whose `spawn` wraps the next fake child, recording `{ args, options }`, wiring `stdout`/`stderr`
    `data` (encoding `utf8`) to the events, the emitter's first `close` (code, signal) or `error` to one `closed`
    (`error.code === 'ENOENT'` → `notFound: true`), and `write`/`endInput`/`kill(signal = 'SIGTERM')` to the child.
    The `childHost` session fake keeps its streams. Rows changed: the `it.each` row `SpawnNotFound` (about line 3074)
    expects `reason: 'claude was not found at /bin/claude; set claude-code.command'`; `spawnNotFound_EndsWithHint`
    expects `error: expect.stringMatching(/\/bin\/claude.*\/proj.*set claude-code\.command$/)`. Every other test
    passes unchanged in what it asserts.
  - `src/plugins/claude-code/main/claude-launch.test.ts` (moved): its env inputs and expectations type as
    `Record<string, string>`; no assertion changes.
  - `src/main/processes/node-processes.test.ts`, over `process.execPath -e <script>`:
    - `spawn_WritesAndStreams_ClosesWithTheCode` — script `process.stdin.pipe(process.stdout);
      process.stderr.write("err"); process.stdin.on("end", () => process.exit(3))`; `write('hello\n')`, `endInput()`
      → stdout chunks join to `'hello\n'`, stderr to `'err'`, one `closed` with `{ code: 3, signal: null, startError:
      null }`.
    - `spawn_Env_IsTheWholeEnvironment` — `env: { ONLY: 'x' }`, script prints `${process.env.ONLY} ${process.env.HOME}`
      → stdout `'x undefined'`.
    - `spawn_Kill_ClosesWithTheSignal` — script `setTimeout(() => {}, 60000)`; `kill('SIGKILL')` → `{ code: null,
      signal: 'SIGKILL', startError: null }`; a later `write('x')` throws nothing.
    - `spawn_MissingProgram_ClosesOnceNotFound` — command `/no/such/program` → exactly one `closed`, `code: null`,
      `signal: null`, `startError.notFound: true`, `startError.message` containing `ENOENT`.
  - `src/main/processes/limited-processes.test.ts` › `spawn_PastTheLimit_PassesStraightThrough` — with `limitRuns(inner,
    1)` and one `run` held open, a `spawn` reaches `inner.spawn` at once. Its two inner `ProcessRunner` literals gain a
    `spawn` that throws.
  - `src/main/plugins/main-api.test.ts`, beside "stops the plugin's running programs…":
    - `kills the plugin's spawned programs when its registrations are disposed` — a live `FakeSpawn` gets `kills:
      ['SIGKILL']`; one already closed gets `kills: []`.
    - `refuses a spawn once its registrations are disposed` — after dispose, `spawn('claude', [], …)` adds no entry to
      `spawns`, and `closed` is heard once, after a microtask, with `startError: { message: 'Stopped claude',
      notFound: false }`.
  - `src/shared/fake-processes.test.ts` › `spawn_RecordsAndDrives` — `spawn` records `{ command, args, cwd, env }`;
    `stdout('a')`, `stderr('b')`, `close({ code: 0, signal: null, startError: null })` reach the events in order; a
    second `close` is not heard; `write('x')`, `endInput()` and `kill()` land in `written: ['x']`, `isInputEnded:
    true`, `kills: ['SIGTERM']`.
  - `src/config/settings.test.ts`: `defaultSettingsFor_Programs_SetsClaudeCommand` goes (its rule left core);
    `defaultSettingsFor_PluginsDisabled_HoldsDocsSessionTab` becomes `coreDefaultSettings_PluginsDisabled_…`, same
    assertion.
  - `src/plugins/manifests.test.ts`: both `defaultSettingsFor(fakePlatform('macos').programs)` calls become
    `coreDefaultSettings()`; `manifests_LabelsAndDescriptions_FilledAndLabelsUnique` now covers `Claude Code`.
  - `src/plugins/manifests.test.ts` › `withoutRealHarnessPlugins_given $given` (table) over `builtInManifests` and
    main parts built as `builtInManifests.map((manifest) => ({ manifest, start: () => ({}) }))`:
    - `a fake run` (`isFake: true`) → neither list holds id `claude-code`; every other id is kept, in input order.
    - `a real run` (`isFake: false`) → both lists' ids equal the input lists' ids, `claude-code` included.
  - `src/plugins/main.test.ts` (new) › `mainParts_StartOrder_ClaudeCodeBeforeChatAndUsage` —
    `startPlugins(mainParts, 'main', ({ manifest }) => { started.push(manifest.id); return {}; })`, as
    `src/plugins/page.test.ts` does; `started.indexOf('claude-code')` is below `started.indexOf('chat')` and below
    `started.indexOf('usage')`, and not `-1`.
  - `config-store.test.ts`, `user-config.test.ts`, `user-settings.test.ts`, `selftest-config.test.ts`: the `claude: {
    command: 'claude' }` member leaves each `Settings` fixture.
  - `npm run lint` (`check-layers.mts`) passes: the composition-root check finds `./claude-code/main/start` in
    `mainParts` and `./claude-code/manifest` in `builtInManifests`.
Approach:
  - `FakeProcesses.spawn` (shared): records a `FakeSpawn` in `spawns`, beside `detachedStarts`, and returns it as the `SpawnedProcess`. A
    `FakeSpawn` holds `command`, `args`, `cwd`, `env`, `written: string[]`, `isInputEnded: boolean`, `kills:
    SpawnSignal[]` (`kill()` records `'SIGTERM'`, and kill closes nothing), and the test's drivers `stdout(text)`,
    `stderr(text)` and `close(exit)`, which call the spawn's events; a second `close` does nothing. Nothing is
    scripted for a spawn.
  - `plugin-part-harness.test-support.ts`: the default services gain `agentEnvironment: {}` and `agentHomeDir:
    '/home'` (the harness's `homeDir`).
  - `main.ts`: `ModeServicesContext`, `liveServices`, `offscreenRunServices` and `driveHarness` keep only what 01
    and the fake need. The mode services, which already return `screenCapture`, return `agentHomeDir` (`os.homedir()` for a drive run on Claude, else the
    context's `homeDir`). The comments on `liveServices` and `endpointEnv` stop naming Claude Code: the
    relays of "the agent sessions this app starts".
Done when: compiles (`npm run lint` and `npm run typecheck`); the test gate runs the tests above; `test -d
           src/main/claude-code` fails; `grep -rn "claude\.command" src` prints nothing
Commit:    one commit for the group ("Claude Code becomes the built-in claude-code plugin: …", naming the move, the
           setting, `processes.spawn` and `agentEnvironment`). It removes no follow-up and ticks no master-plan box:
           task 05 lands the rest of "Harness settings with the harness" and does both.

## Proof

