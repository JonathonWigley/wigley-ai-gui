# 04 — AgentHarness grows what a second harness needs

Status: in progress
Type: Task
Wave: 3 · Depends on: 03
Plan: [plan.md](plan.md)

Files:     modify `src/contracts/agent.ts` ·
           modify `src/plugins/claude-code/main/claude-code-harness.ts` ·
           modify `src/plugins/claude-code/main/claude-controls.ts` ·
           modify `src/plugins/claude-code/main/session-fold.ts` ·
           modify `src/plugins/claude-code/main/agent-definitions.ts` ·
           create `src/plugins/claude-code/main/installed-plugins.ts` ·
           modify `src/shared/fake-agent-harness.ts` ·
           modify `src/shared/agent-harness-registry.test-support.ts` (`harnessInfo`'s defaults gain the three new
           fields; no test that calls `harnessInfo` changes) ·
           modify `docs/features/agent-chat/claude-stream.md` (§ Initialize, last bullet) ·
           modify `docs/features/followups.md` · modify `docs/features/intent-alignment/master-plan.md` ·
           test `src/plugins/claude-code/main/installed-plugins.test.ts` (create) ·
           test `src/plugins/claude-code/main/claude-controls.test.ts` ·
           test `src/plugins/claude-code/main/session-fold.test.ts` ·
           test `src/plugins/claude-code/main/claude-code-harness.test.ts` ·
           test `src/plugins/claude-code/main/agent-definitions.test.ts` (run; its cases must pass unchanged) ·
           test `src/shared/fake-agent-harness.test.ts`
Consumes:  `AgentHarness.info(): AgentHarnessInfo` and `AgentHarnessInfo.label` ← 01 ·
           `CLAUDE_HARNESS_ID = 'claude'` in `src/plugins/claude-code/main/claude-code-harness.ts` ← 03 ·
           `AgentHarness.configFolder(profileDir)`, `defaultConfigFolder(homeDir, paths)` (`claude-launch.ts`),
           `controlValue`, `isChoice`, `controlOf`, `CLAUDE_CONTROLS` (`claude-controls.ts`), `foldInitializeAnswer`
           and `setControlValue` (`session-fold.ts`), `pluginInstalls` and `installPathOf` (`agent-definitions.ts`) —
           all in `src/plugins/claude-code/main/` ← 03 ·
           `harnessInfo(overrides?)` in `src/shared/agent-harness-registry.test-support.ts` ← 01
Produces:  `export interface HarnessCapabilities` in `src/contracts/agent.ts`
           `capabilities: HarnessCapabilities;` in `src/contracts/agent.ts` (on `AgentHarnessInfo`)
           `clearAliases: readonly string[];` in `src/contracts/agent.ts`
           `projectConfigFolder: string;` in `src/contracts/agent.ts`
           `export interface HarnessConfigRoots` in `src/contracts/agent.ts`
           `export interface InstalledPlugin` in `src/contracts/agent.ts`
           `listedAt: { path: string; line: number } | null;` in `src/contracts/agent.ts` (on `InstalledPlugin`)
           `controls(profileDir: string | null): SessionControl[];` in `src/contracts/agent.ts`
           `toolUseIdOf(meta: Readonly<Record<string, unknown>> | null): string | null;` in `src/contracts/agent.ts`
           `configRoots(profileDir: string | null): HarnessConfigRoots;` in `src/contracts/agent.ts`
           `installedPlugins(profileDir: string | null): Promise<InstalledPlugin[]>;` in `src/contracts/agent.ts`
           `role?: string;` in `src/contracts/agent.ts` (on `SessionControl`)
           `export const CONTROL_ROLES = { model: 'model', permissionMode: 'permissionMode', effort: 'effort' } as const;` in `src/contracts/agent.ts`
           `export const CLAUDE_TOOL_USE_ID_META_KEY = 'claudecode/toolUseId';` in `src/plugins/claude-code/main/claude-code-harness.ts`
           `export const CLAUDE_CLEAR_ALIASES: readonly string[] = ['reset', 'new'];` in `src/plugins/claude-code/main/claude-code-harness.ts`
           `export interface PluginInstallRecord extends InstalledPlugin { scope: string | null; projectPath: string | null }` in `src/plugins/claude-code/main/installed-plugins.ts`
           `export async function readInstalledPlugins(deps: { files: Files; paths: Paths; log: Log }, configDir: string): Promise<PluginInstallRecord[]>` in `src/plugins/claude-code/main/installed-plugins.ts`
           `export function isChoice(controls: readonly SessionControl[], id: ClaudeControlId, value: string): boolean` in `src/plugins/claude-code/main/claude-controls.ts`
           `setInstalledPlugins(configDir: string, plugins: readonly InstalledPlugin[]): void;` in `src/shared/fake-agent-harness.ts`
Decisions: - The shapes in plan.md § File Structure are word for word: `HarnessCapabilities` is a closed record of
             required booleans `{ interrupt, resume, images, midTurnSend }`; `role` is an optional open string;
             `CONTROL_ROLES` names the three values chat binds keys to (plan.md § Decisions).
           - `controls()` is a synchronous declaration; the `initialize` reply refreshes the running process's controls
             through `events.controls` (plan.md, Decided by the agent).
           - A declared control's `value` is the value a session started now with empty `AgentStart.controls` begins
             with, null when the harness cannot know it before start. Claude: `mode` `auto` (today's `launchMode`
             default), `effort` null, `model` null. The fake: its fixed starting values (`auto`, `medium`,
             `fake-small`, `brief`). (drafter)
           - Claude's roles: `mode` → `CONTROL_ROLES.permissionMode`, `effort` → `CONTROL_ROLES.effort`, `model` →
             `CONTROL_ROLES.model`. The role goes on each `CLAUDE_CONTROLS` entry, so the fold's controls and every
             `events.controls` list carry it. The fake: the same three roles on its `mode`, `effort` and `model`;
             `verbosity` has no role. Control ids stay as they are (chat still finds them by id until task 11).
           - Claude's `info()` gains `capabilities: { interrupt: true, resume: true, images: true, midTurnSend: true }`,
             `clearAliases: CLAUDE_CLEAR_ALIASES` (`['reset', 'new']`, claude-stream.md § Initialize: `clear` → `reset`,
             `new`) and `projectConfigFolder: '.claude'`. The fake's `info()` gains the same four `true` capabilities,
             `clearAliases: ['reset']` (so chat's `/reset` keeps working in fake runs once task 12 registers only
             declared aliases) and `projectConfigFolder: '.claude'` (docs' self-test runs on the fake, and its fixtures
             use `.claude`). (drafter)
           - `toolUseIdOf`: Claude returns `meta['claudecode/toolUseId']` when it is a non-empty string, else null;
             null `meta` gives null. The key is `CLAUDE_TOOL_USE_ID_META_KEY`; sessions keeps its own copy until task 06
             calls `toolUseIdOf`. The fake reads `meta['fake/toolUseId']` by the same rule, so no code outside
             `claude-code/` names Claude's key (plan.md § Boundary rules). (drafter)
           - `configRoots(profileDir)`: `configDir` follows `configFolder(profileDir)` exactly (null → the default
             `~/.claude` under `homeDir`, whatever the environment sets; else `~` expanded); `pluginCacheDirs` is
             `[join(configDir, 'plugins', 'cache')]`. The fake: `configDir` is `configFolder(profileDir)`,
             `pluginCacheDirs` `[\`${configDir}/plugins/cache\`]`. (drafter)
           - `readInstalledPlugins(deps, configDir)` reads `<configDir>/plugins/installed_plugins.json` and returns
             one `PluginInstallRecord` per install, in file order: the plugins object's keys in order, each key's
             install array in order. `key` is the JSON key (`wigley@wigley-ai-marketplace`), `installDir` the record's
             `installPath`, `version` the record's `version` when a non-empty string, else null. `scope` and
             `projectPath` are the record's fields when non-empty strings, else null. `listedAt` is `{ path, line }`:
             `path` is that `installed_plugins.json` and `line` the 1-based line of the first line holding `"<key>"`;
             null when no line does (docs' `pluginConfigFile` reads it, task 07). `readInstalledPlugins` skips a
             record whose `installPath` is not a non-empty string, so no caller sees one. A missing file resolves `[]`;
             an unreadable or unparsable file resolves `[]` and logs through `deps.log`, so docs never sees a
             rejection. (drafter; the real file holds `scope`, `projectPath`, `installPath`, `version`, measured at
             plan time)
           - The adapter's `installedPlugins(profileDir)` calls
             `readInstalledPlugins({ files, paths, log }, configRoots(profileDir).configDir)` and returns each record's
             projection `{ key, installDir, version, listedAt }`: the public `InstalledPlugin` carries no `scope` and no
             `projectPath`.
           - One source of truth for `installed_plugins.json`: the new `installed-plugins.ts` owns reading and parsing
             it. `agent-definitions.ts`' `pluginInstalls` calls `readInstalledPlugins(deps, configFolder)`, groups the
             records by `key` in file order, and keeps only its install choice. `installPathOf` takes
             `(installs: readonly PluginInstallRecord[], projectDir: string, paths: Paths): string | null`: the
             install whose `scope !== 'user'`, whose `projectPath` is not null and `paths.samePath` to `projectDir`,
             else the install whose `scope === 'user'`; it returns that install's `installDir`, null when none. Its
             log texts move with the reader unchanged: `installed plugins not read: <error text>` and
             `installed plugins not read: <path> is not JSON`, source `claude`. (drafter)
           - One behaviour changes at the edge: today a project install with no `installPath` makes `installPathOf`
             return null, so the user install does not load. After, the read skips that record, so the user install
             loads. No `agent-definitions.test.ts` case holds such a record (measured at plan time: every install in
             it has an `installPath`). (drafter)
           - `isChoice` reads the controls it is given, not the fixed `CLAUDE_CONTROLS`:
             `isChoice(controls, id, value)` is true when `controls.find((control) => control.id === id)` holds a
             choice whose `value` equals `value`. Both callers pass the fold state's `state.controls`:
             `setControl` in `claude-code-harness.ts` (inside `createClaudeSession`, whose `state: SessionFoldState`
             also feeds `events.controls`), and `foldControlValues` in `session-fold.ts`. (drafter)
           - Docs between this task and task 07: docs' `installedScripts`, `installedPluginsFile` and
             `WIGLEY_PLUGIN_KEY` in `src/plugins/docs/main/script-locator.ts` stay untouched in this task. Docs may
             not import the adapter (`scripts/check-layers.mts`: a plugin's `main/` imports only the `contract.ts` of
             the plugins it depends on), and docs calling `installedPlugins` through `services.agentHarnesses` is task
             07's change. So docs compiles unchanged, and task 07 deletes docs' parser. (drafter)
           - The `initialize` refresh (followups.md, AgentHarness grows; claude-stream.md § Initialize lists `models`
             and `current_permission_mode` among the reply's keys). The shape of `models` is the Agent SDK's
             `ModelInfo[]`: `{ value: string; displayName: string; description: string; resolvedModel?: string; … }`
             (code.claude.com/docs/en/agent-sdk/typescript, `ModelInfo`); it is documented, not measured in
             claude-stream.md. `current_permission_mode` is read as a permission mode string, as `init`'s
             `permissionMode` is.
             - `models`: each element that is an object with a non-empty string `value` becomes a choice
               `{ value, label }`, `label` its `displayName` when a non-empty string, else `value`, in the reply's
               order. One or more such choices replace the `model` control's `choices`; none (key missing, not an
               array, no usable element) keeps the choices and logs `initialize listed no models`.
             - `current_permission_mode`: a non-empty string sets the `mode` control's value to
               `controlValue('mode', <it>)` (so `default` reads `manual`), the same rule `init`'s reported values use;
               anything else leaves it.
             - Both run on a success answer whether or not `commands` is a list: the commands branch no longer
               returns before them. An error answer logs as today and changes no control.
             - One `{ kind: 'controls' }` effect follows when the choices or the mode value changed, after the
               `commands` effect; none when nothing changed.
           - Once the model choices can change per process, every check of a model value reads the fold state's
             current model choices, not the fixed `MODEL_CHOICES`: `setControl`'s choice check in the harness and the
             typed `/model <value>` check in the fold (both through `isChoice(state.controls, …)`), and
             `controlValue('model', …)`. `controlValue` for `model` maps
             a reported name to, first, the choice whose `value` equals it, else the first choice in list order whose
             `value` the lower-cased name contains (today's rule), else the reported name. Its signature becomes
             `controlValue(id: ClaudeControlId, reported: string, choices: readonly ControlChoice[]): string`; callers
             pass the matching control's current choices from the fold state. (drafter)
           - Doc comments: `ChatEntry` `result.costUsd` is "this turn's cost in USD, null when the harness reports
             none; an adapter whose harness reports a running total subtracts the previous turn's"; `UsageAgentEvent`
             `spendUsd` is "the process's spend so far in USD, cumulative across its turns". Claude already computes
             the per-turn share (`stream-decoder.ts`, `lastTotalCost`), so no code changes for cost (plan.md, Decided
             by the agent).
           - `SendOptions.now` in `src/contracts/agent.ts`: its comment, and the `now` sentence in `send`'s comment,
             gain "chat passes `now` only to a harness whose `capabilities.midTurnSend` is true; to any other it writes
             the message plainly". Chat's check lands in task 10 (the user, refresh round). No code changes here: both
             adapters declare `midTurnSend: true`.
           - Not in this task: the harness-minted session id (task 09); chat, sessions, docs and usage reading any new
             member (tasks 06, 07, 10–14); `profiles` on `AgentHarnessInfo` (task 05).
Mandatory: AGENTS.md § Architecture: "An agent harness", "A session control", "A registration", and the `npm run lint`
           layer paragraph; `docs/features/agent-harnesses/design.md`; `docs/features/agent-chat/claude-stream.md`
           § Init and § Initialize; `wigley:writing-code`, `wigley:writing-tests` and its `typescript-vitest.md`
GIVEN the Claude adapter WHEN `controls(null)` is read before any start THEN it returns `mode` (value `auto`, role
      `permissionMode`), `effort` (null, role `effort`) and `model` (null, role `model`), in that order, each with
      today's labels and choices
GIVEN the Claude adapter WHEN `info()` is read THEN it carries the four capabilities `true`, `clearAliases`
      `['reset', 'new']` and `projectConfigFolder` `.claude`, beside task 01's `label`
GIVEN a `_meta` of `{ 'claudecode/toolUseId': 'toolu_1' }` WHEN Claude's `toolUseIdOf` reads it THEN it returns
      `toolu_1`; for null, `{}` or a non-string value it returns null
GIVEN profileDir `~/work-claude` and home `/home/u` WHEN Claude's `configRoots` reads it THEN it returns
      `{ configDir: '/home/u/work-claude', pluginCacheDirs: ['/home/u/work-claude/plugins/cache'] }`; for null it
      returns the `/home/u/.claude` pair
GIVEN an `installed_plugins.json` under the profile's folder WHEN `installedPlugins` reads it THEN it returns one
      record per install in file order, each with its `listedAt`; a missing file gives `[]`, a file that is not JSON gives `[]` and one log line
GIVEN a started process WHEN its `initialize` answer lists `models` THEN the `model` control's choices become those
      models in order, labelled by `displayName`, and one `controls` effect reports it
GIVEN a started process WHEN its `initialize` answer has `current_permission_mode` `default` THEN the `mode` control
      reads `manual`
GIVEN a process whose model choices came from `initialize` WHEN `setControl('model', v)` names one of them THEN the
      `/model v` line is written; for a value in neither list it throws `Claude Code control model has no choice <v>`
GIVEN the fake WHEN any new member is read THEN it answers as Decisions says, and `installedPlugins(dir)` returns
      what `setInstalledPlugins(dir, …)` last set, `[]` before
Tests:     - `installed-plugins.test.ts` › `readInstalledPlugins_ListsEveryInstallInFileOrder` — a file with key
             `wigley@wigley-ai-marketplace` holding a user install (`/cache/wigley/1.0`, version `1.0`) then a project
             install (`/cache/wigley/2.0`, no version), and key `tools@x` holding `/cache/tools/1.0` version `1.0`,
             reads `[{ key: 'wigley@wigley-ai-marketplace', installDir: '/cache/wigley/1.0', version: '1.0' },
             { key: 'wigley@wigley-ai-marketplace', installDir: '/cache/wigley/2.0', version: null },
             { key: 'tools@x', installDir: '/cache/tools/1.0', version: '1.0' }]`, each record also holding
             `listedAt: { path: <that file>, line: <the line of its key> }`, both `wigley@…` records the same line
             (asserted with `toMatchObject`; `scope` and `projectPath` have their own test below)
           - `installed-plugins.test.ts` › `readInstalledPlugins_KeyOnLine3_ListedAtLine3` — `installed_plugins.json`
             `'{\n"plugins":{\n"p@m":[{"installPath":"/x","version":"1"}]\n}}'` → `listedAt`
             `{ path: <that file>, line: 3 }`; a key no line holds → `listedAt` null
           - `installed-plugins.test.ts` › `readInstalledPlugins_UnreadableFile` — table: missing file → `[]` and no
             log; `not json` → `[]` and log `installed plugins not read: <path> is not JSON`; a read that throws `boom`
             → `[]` and log `installed plugins not read: boom`; a record with no `installPath` is skipped
           - `installed-plugins.test.ts` › `readInstalledPlugins_ScopeAndProjectPath_Carried` — an install
             `{ scope: 'project', projectPath: '/repo', installPath: '/x' }` reads `scope: 'project'`,
             `projectPath: '/repo'`; an install `{ installPath: '/y' }` reads `scope: null`, `projectPath: null`
           - `claude-controls.test.ts` › `isChoice_ReadsTheGivenControls` — table over controls whose `model` choices
             are `[{ value: 'opus[1m]', label: 'Opus 1M' }]`: `('model', 'opus[1m]')` → true; `('model', 'opus')` →
             false; `('effort', 'high')` with no `effort` control in the list → false
           - `agent-definitions.test.ts` — every existing case passes unchanged (the project-install and user-install
             choice now reads through `readInstalledPlugins`)
           - `claude-controls.test.ts` › `controlValue_Model_MapsFullNameToAlias` — add rows: with choices
             `[{opus}, {opus[1m]}]` the name `opus[1m]` maps to `opus[1m]` (exact first); with choices `[{default},
             {opus}]` the name `claude-opus-5-5[1m]` maps to `opus`; a name no choice is in stays as reported
           - `claude-controls.test.ts` › `CLAUDE_CONTROLS_DeclareRoles` — `mode` → `permissionMode`, `effort` →
             `effort`, `model` → `model`
           - `session-fold.test.ts` › `foldPipeLine_InitializeAnswer_RefreshesModelChoicesAndMode` — reply
             `{ commands: [FEATURE_COMMAND], models: [{ value: 'default', displayName: 'Default (recommended)',
             description: '' }, { value: 'opus', displayName: 'Opus', description: '' }, { value: 'haiku',
             displayName: '', description: '' }], current_permission_mode: 'default' }` gives effects `commands`
             then one `controls` whose `model` choices are `[{ value: 'default', label: 'Default (recommended)' },
             { value: 'opus', label: 'Opus' }, { value: 'haiku', label: 'haiku' }]` and whose `mode` value is `manual`
           - `session-fold.test.ts` › `foldPipeLine_InitializeAnswer_NoModels_KeepsChoices` — table: `models` absent,
             `models: 'x'`, `models: [{ displayName: 'No value' }]`: the `model` choices stay the fixed four, log
             `initialize listed no models`, and no `controls` effect when `current_permission_mode` is absent
           - `session-fold.test.ts` › `foldPipeLine_InitializeAnswer_ReadsModelsWithNoCommandList` — reply
             `{ models: [{ value: 'opus', displayName: 'Opus', description: '' }] }` still refreshes the choices, and
             logs `Could not list commands: no list in the answer` as today
           - `session-fold.test.ts` › `foldPipeLine_InitializeError_LogsAndEmitsNothing` — unchanged: no `controls`
             effect on an error answer
           - `session-fold.test.ts` › `foldPipeLine_TypedModelCommand_ChecksTheRefreshedChoices` — after an
             `initialize` listing `opus[1m]`, a successful typed `/model opus[1m]` turn sets the `model` value
             `opus[1m]`
           - `claude-code-harness.test.ts` › `controls_BeforeStart_DeclaresClaudesControls`,
             `info_DeclaresCapabilitiesAliasesAndProjectFolder`, `toolUseIdOf_ReadsClaudesMetaKey` (table: the
             string, null, `{}`, `{ 'claudecode/toolUseId': 7 }`), `configRoots_ResolvesTheProfileFolder` (table:
             `~/work-claude`, `/abs/dir`, null), `installedPlugins_ReadsTheProfilesFile` — exact values as the GIVEN
             lines above
           - `claude-code-harness.test.ts` › `setControl_ModelFromInitialize_WritesTheCommand` — after the
             `initialize` answer lists `opus[1m]`, `setControl('model', 'opus[1m]')` writes `/model opus[1m]`;
             `setControl('model', 'nope')` throws `Claude Code control model has no choice nope`
           - `harnessInfo` (`src/shared/agent-harness-registry.test-support.ts`): its defaults become
             `{ label: 'Harness', capabilities: { interrupt: true, resume: true, images: true, midTurnSend: true },
             clearAliases: [], projectConfigFolder: '.claude', ...overrides }`. Every test that calls it passes
             unchanged
           - `fake-agent-harness.test.ts` › `declarations_AnswerEveryNewMember` — `controls(null)` (four controls,
             roles as Decisions), `info()` fields, `toolUseIdOf({ 'fake/toolUseId': 'u' })` → `u`,
             `configRoots('~/p')` → `{ configDir: '~/p', pluginCacheDirs: ['~/p/plugins/cache'] }`,
             `installedPlugins('~/p')` → `[]`, then the list `setInstalledPlugins('~/p', …)` set
           - No self-test step: plan.md leaves `claude-code` out of fake runs, so the Claude behaviour has no self-test
             path; the fake's members gain no user-visible behaviour in this task
Approach:  `foldInitializeAnswer` keeps its error branch first. Then it reads `commands` (logging and skipping the
           commands effect when not a list, no early return), then `models`, then `current_permission_mode`, pushing
           `commands` first and one `controls` last. The model-choice reader is a private helper in `session-fold.ts`
           beside `commandRecordsOf`.
Done when: `npm run lint` and `npm run typecheck` pass; the test gate runs the tests above
Commit:    one commit for the group; it also removes "AgentHarness grows what a second harness needs" from
           `docs/features/followups.md` § Harness seams, ticks step 2's box in
           `docs/features/intent-alignment/master-plan.md`, and rewrites claude-stream.md § Initialize's last bullet to
           "the app's Claude adapter sends it too, as the first stdin line of a started process, and reads `commands`,
           `models` (the model control's choices) and `current_permission_mode` (the mode control's value) from its
           answer; `models` follows the Agent SDK's `ModelInfo`, documented, not measured here."

## Proof

