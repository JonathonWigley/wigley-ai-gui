# Lane H: harness seams — plan

Feature: intent-alignment, Lane H · Implements: none · Ticket: none
Target: main · Written: 2026-11-09

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

**Contents**

- **Goal** — what the lane delivers.
- **Architecture** — the systems the tasks touch.
- **Lane gates** — the order this lane keeps with Lanes E and P.
- **Preconditions** — the repository state the plan rests on, with the commands that check it.
- **Docs written ahead** — the docs already committed, and the commits.
- **Mandatory Reads** — what every implementer reads first.
- **Design Overview** — the after-state flow, the decisions, and what stays out.
- **File Structure** — the shared names and signatures, new files, and boundary rules.
- **Tasks** — the wave checklist.
- **Run log** — written by `wigley:make`.

## Goal

Put every piece of harness knowledge behind the adapter, so a second harness (Codex, planned in its own session after
this lane) is a new plugin folder that registers an adapter. The lane lands every Lane H item in steps 1–3 of
`docs/features/intent-alignment/master-plan.md`, Owned sessions join by an adapter key included, and the Structured
round results item.

## Architecture

- **Core main** — `src/main/main.ts` builds the harness registry, the agent environment and the streaming spawn, and
  registers the fake harness in fake runs. `src/contracts/agent.ts`, `plugin.ts`, `core-state.ts`, `processes.ts`,
  `platform.ts` and `settings.ts` change.
- **New plugin `claude-code`** — the Claude adapter moves from `src/main/claude-code/` to
  `src/plugins/claude-code/main/`, with a manifest that owns its settings, and registers itself.
- **Plugins** — chat (most tasks), sessions, docs, usage, notes, workflow-small/medium/large/spike, forms, primer.
- **Shared** — `src/shared/fake-agent-harness.ts`, `src/shared/plugin-part-harness.test-support.ts`,
  `src/shared/agent-forms/`, `src/shared/platform.ts`.
- **wigley-ai-marketplace** — `plugins/wigley/scripts/forms/relay.py`, its tests and the forms `README.md` (task 09).

## Lane gates

The master plan orders Lane H against two other lanes on shared files (`master-plan.md` § Intent, Side lanes):

- Lane E's forms chain (Forms item kinds as registrations, then the rest) starts only after task 02 lands.
- Lane P's Per-platform program lookup and spawning starts only after tasks 01, 03, 05, 06 and 08 land. Tasks 01, 03,
  05 and 08 edit `src/main/main.ts` and the Claude adapter; task 06 adds `serverName` to `PlatformRelay` in
  `src/contracts/platform.ts` and `src/shared/platform.ts`, the files Lane P edits too.

Each task that ticks a master-plan box says so; the run checks these gates by reading the master plan's boxes.

## Preconditions

Run each from the wigley-ai-gui folder of the clone or worktree the run works in, before the first dispatch. Each must print what its line says.

| Claim | Command | Expect |
|---|---|---|
| Harnesses are still a fixed array | `grep -c 'agentHarnesses: readonly AgentHarness\[\]' src/contracts/plugin.ts` | `1` |
| The session host is already a main service | `grep -c 'sessionHost: SessionHost' src/contracts/plugin.ts` | `1` |
| The adapter is still core, no plugin yet | `test -d src/main/claude-code && ! test -e src/plugins/claude-code && echo ok` | `ok` |
| The Claude launch puts the row id in the env | `grep -c 'SESSION_ROW_ENV\] = request.rowId' src/main/claude-code/claude-launch.ts` | `1` |
| The relay's hello has no row id yet | `grep -c row_id ~/Documents/ai/wigley-ai-marketplace/plugins/wigley/scripts/forms/relay.py` | `0` |
| Lane E's forms chain and Lane P's program lookup have not started | `grep -c '\[ \] Forms item kinds as registrations\|\[ \] Per-platform program lookup' docs/features/intent-alignment/master-plan.md` | `2` |
| `RoundError` throw sites (measured at plan time, re-verify) | `grep -rn 'new RoundError(' src/plugins/forms src/plugins/primer src/shared/agent-forms --include='*.ts' \| grep -vc test` | `46` |
| The audio picker still names its args error | `grep -c 'argsErrorName: AUDIO_PICKER_ERROR_NAME' src/plugins/audio-picker/main/picker-type.ts` | `1` |
| Chat still pins Claude | `grep -c "CHAT_HARNESS_ID = 'claude'" src/plugins/chat/contract.ts` | `1` |
| Sessions still reads Claude's `_meta` key | `grep -c "TOOL_USE_ID_META_KEY = 'claudecode/toolUseId'" src/plugins/sessions/main/mcp/mcp-server.ts` | `1` |

## Docs written ahead

Committed on `main` in `6da8397b8` and `8b85b743f` (the plan branch `plan-lane-h`, merged to `main` with this plan):

- `docs/features/agent-harnesses/design.md` — new: the lane's design and the reasons behind it.
- `AGENTS.md` — the `claude-code` plugin entry, `src/main/claude-code/` removed from the tree, the relay join by row
  id, `core.agentHarnesses`, the agent harness and session control paragraphs, chat's and usage's entries.
- `docs/features/followups.md` — two stale details fixed in Harness-neutral UI copy and Open chat entry kinds.

Task 16 re-reads each of them against the landed code.

## Mandatory Reads

Every implementer:

- `AGENTS.md` § Intent, § Architecture: "A plugin", "A registration", "A plugin talks", "A slot", "An MCP tool", "An
  agent harness", "A session control", "A setting", "An ambient service", and the `npm run lint` layer paragraph. It
  is about 34k tokens whole; read the whole file only when a task's Mandatory line says so.
- `docs/features/agent-harnesses/design.md` — whole.
- `wigley:writing-code`, `wigley:codebase-design`, `wigley:writing-tests` (read from the marketplace clone,
  `~/Documents/ai/wigley-ai-marketplace/plugins/wigley/skills/<skill>/SKILL.md`).

Per task, as its document lists:

- `docs/features/plugin-framework/design.md` § Hot reload (Wave 4), § Runtime loader (Wave 4 step 3) — tasks 01, 03,
  15.
- `docs/features/agent-chat/claude-stream.md` § Initialize — task 04; and the permission sections — task 08.
- `docs/features/agent-chat/design.md` — tasks 08, 09, 10, 15.
- `DESIGN.md` and `docs/features/layouts/design.md` — tasks 10, 13, 14.
- `docs/features/docs-browser/design.md` — task 07.
- The marketplace's `plugins/wigley/scripts/forms/README.md` — tasks 02, 09.

No `.claude/rules/` folder and no nested `AGENTS.md` exist in the wigley-ai-gui folder (measured at plan time).

## Design Overview

### After-state flow

```
 main.ts (composition root)
   ├─ creates AgentHarnessRegistry ──writes──► core.agentHarnesses slot (id → AgentHarnessInfo)
   ├─ services.agentHarnesses = registry · services.processes.spawn · services.agentEnvironment
   └─ fake runs: registry.register(fake); built-ins leave out claude-code

 claude-code plugin (main)
   ├─ settings: command, profiles ──► adapter
   ├─ registry.register(claudeAdapter)  (id 'claude'; handle.refresh() on settings change)
   └─ sessions.contributeTools(permission_prompt) ──row id──► the session's AgentProcess
                                                              └─ events.permission ──► chat

 chat ──reads registry / slot──► harness by defaultHarness, or by the profile's or saved session's harness
   ├─ start(AgentStart{ sessionId: null, rowId }) ──► events.sessionId(id) ──► owned.setHostSessionId
   ├─ controls found by role · clear aliases from info · entries by kind (renderers)
   └─ harness leaves the registry ──► detach sessions · harness returns ──► attach

 relay.py hello { row_id: $WIGLEY_SESSION_ROW, … } ──► sessions joins the owned row by row id
 sessions MCP: server name from platform.relay.serverName · _meta ──► registry.get(hello harness).toolUseIdOf
 docs: profiles' folders, configRoots, installedPlugins, projectConfigFolder, chips from the slot
 usage: every registered harness's profiles
 forms: round logic returns records · forms' MCP wording module words them, byte-identical to today
```

### Decisions

Settled with the user in the interview:

- Claude Code becomes the built-in `claude-code` plugin; the adapter moves to `src/plugins/claude-code/`, registers
  itself and owns its settings and profiles. The core hands every plugin the session host and a streaming spawn.
- The registry is a main service (`register`, `list`, `get`) plus the core slot `core.agentHarnesses`; plugins and
  layouts read the slot.
- An owned session joins its relay by row id; the relay's hello gains `row_id`; `open` needs no host id. The
  marketplace relay change lands in this lane (task 09).
- Forms' wire text stays byte-identical through Structured round results, pinned by tests over the exact strings.
- `capabilities` is a closed record of required booleans `{ interrupt, resume, images, midTurnSend }`.
- A control's `role` is an optional open string; `model`, `permissionMode` and `effort` are the values chat binds
  keys to; any other role is reachable through `c`.
- Entry renderers: user layout, then plugin renderers with the latest registration first, then `default`; the first
  renderer whose `kind` matches and whose `match` (when given) passes draws.
- The MCP server name comes from the composition root (`PlatformRelay.serverName`), with no setting.
- Each harness plugin owns its profiles (`claude-code.profiles`); chat, usage and docs read them from the registry.
- No harness step in the start prompt: chat's `defaultHarness` setting (default `claude`) picks a new session's
  harness. More start-prompt choices are out of scope (the user's call in round 2).
- Docs' guard and lookups read every registered profile's folder; the docs index file keeps `claudeConfigDirs`.
- Each adapter declares its config and plugin-cache roots and offers `installedPlugins`; docs parses no harness file.
- When a harness leaves the registry, chat detaches its sessions and re-attaches them when it registers again.
- Refresh round, against `main` at 83305ac31: the audio picker drops `needs_manual_open` from its outcome type as
  forms and the primer do (task 02); a row waiting on its harness refuses Send now with the "not loaded" text, while
  pull back and the headless switch work and interrupt does nothing (task 15); chat sends `now` only to a harness that
  declares `midTurnSend` (contract line in task 04, check in task 10).

Decided by the agent (shown as Decided notices):

- An unregistered harness id shows as its raw id. Docs' `IndexHarness` opens to a string; `docs_index.py` is
  unchanged.
- `controls()` is a synchronous declaration; the `initialize` reply refreshes it through `events.controls`.
- `result.costUsd` is per turn; `UsageAgentEvent.spendUsd` stays cumulative; the contract says both.
- Permission answers keep `{ allowed, reason }`.
- The tool-use id is read by the adapter registered under the hello's harness id.
- Docs' chips become a list in registration order; the docs layout contract changes in place.
- The `.claude` folder rule reads each adapter's `projectConfigFolder`.
- Chat copy: "the agent" in fixed text, the harness label where code holds a harness; the Claude adapter's own errors
  keep naming Claude.
- `/clear` stays the app's; each harness declares extra clear aliases.
- Chat layout inputs gain `harnessLabel` beside `harness`.
- Structured results: round wording goes to a forms MCP wording module; generic lines stay in the shared tool session
  over the form type's noun and tool names; `RoundError.problem` is free text with a `path`; `needs_manual_open`
  leaves forms' and primer's `Outcome`.
- Every form type gets `argsErrorText`, the audio picker's included, with its error text unchanged.
- Unknown entry kinds join no activity run.
- Plugin id `claude-code`, harness id `claude`; the setting `claude.command` becomes `claude-code.command`. The
  user's `settings.json` sets neither `claude.command` nor `chat.profiles` (measured at plan time), so no edit there.
- Profile names are unique across harnesses; the first registered harness keeps a clashing name and the registry logs
  the clash.
- The core adds `services.agentEnvironment`, `services.agentHomeDir` and `ProcessRunner.spawn`;
  `services.sessionHost` already exists. `agentHomeDir` is the home the adapter runs as: `os.homedir()` in a drive
  run on Claude, whose `services.homeDir` is the run's empty home, and `services.homeDir` in every other run.
- `claude-code.command` defaults to `''`, and an empty value means `services.platform.programs.claude`: a manifest
  default is a static literal and cannot read the platform (the unity-pool `scriptPath` rule).
- Every adapter reports its session id through `events.sessionId`; `AgentStart.sessionId` is null for a new session.
  This lands with the row-id join (task 09), since `open` needs a host id until then.
- The `claude-code` plugin contributes `permission_prompt` itself and routes by row id.
- A nested process that inherits `WIGLEY_SESSION_ROW` joins an owned row only while the row has no host id, or the
  hello's session id equals the row's, or the hello has none (design doc § Joining an app-started session).
- Harness-specific entry kinds are namespaced `<harness id>:<kind>` (a template-literal type), so they never collide
  with chat's known kinds and the `ChatEntry` union keeps narrowing on `kind`.
- In fake runs the composition root registers the fake and leaves `claude-code` out of the built-in plugins (task 03).
  The fake keeps the id `claude` until task 10, where chat stops pinning `claude`; task 10 renames it `fake`, and
  `main.ts` lays `chat.defaultHarness: 'fake'` over the plugin settings in the self-test and fake drive runs (task
  10), since a self-test script's settings reach only the page.
- `AgentStart.controls` already carries the values a session starts with, so no `initialControls` field is added;
  picking a model in the start prompt is out of scope with the other start-prompt choices.
- The marketplace forms README's hello description changes with `relay.py` in task 09, not ahead: the installed plugin
  never documents a hello its relay does not send.

### Out of scope

- The Codex harness adapter: its own plan once this lane lands (master plan Lane H step 4).
- Start-prompt choices beyond the default harness: a harness step, a model pick at start.
- Agent settings through an adapter, reload plugins and skills, agent plugin management (followups, Harness seams).
- The relay's `harness` and `session_id` reads (`CLAUDECODE`, `CLAUDE_CODE_SESSION_ID`): the Codex plan's.
- `PlatformPrograms.claude` and program lookup: Lane P's Per-platform program lookup.

## File Structure

### Shared names and signatures

Every task document that writes or reads one of these uses it exactly as written here.

`src/contracts/agent.ts` (task 01 unless marked):

```ts
// The declarations a harness publishes in `core.agentHarnesses`; JSON-safe.
export interface AgentHarnessInfo {
  label: string;
  capabilities: HarnessCapabilities;          // task 04
  clearAliases: readonly string[];            // task 04: names beside the app's own `clear`
  projectConfigFolder: string;                // task 04: '.claude' for Claude
  profiles: readonly HarnessProfile[];        // task 05
}
export interface HarnessCapabilities {        // task 04
  interrupt: boolean; resume: boolean; images: boolean; midTurnSend: boolean;
}
export interface HarnessProfile { name: string; configDir: string }   // task 05
export interface HarnessConfigRoots {         // task 04
  configDir: string; pluginCacheDirs: readonly string[];
}
export interface InstalledPlugin {            // task 04
  key: string; installDir: string; version: string | null;
  listedAt: { path: string; line: number } | null;   // task 04: the config file and 1-based line that list the key
}
export interface AgentHarness {
  readonly id: string;
  info(): AgentHarnessInfo;
  controls(profileDir: string | null): SessionControl[];                        // task 04
  toolUseIdOf(meta: Readonly<Record<string, unknown>> | null): string | null;   // task 04
  configRoots(profileDir: string | null): HarnessConfigRoots;                   // task 04
  installedPlugins(profileDir: string | null): Promise<InstalledPlugin[]>;      // task 04
  // …every member it has today
}
export interface AgentHarnessRegistration extends Disposable { refresh(): void }
export interface AgentHarnessRegistry {
  register(harness: AgentHarness): AgentHarnessRegistration;
  list(): readonly AgentHarness[];
  get(id: string): AgentHarness | null;
}
// task 04
export const CONTROL_ROLES = { model: 'model', permissionMode: 'permissionMode', effort: 'effort' } as const;
// SessionControl gains `role?: string`.
// task 08
export interface PermissionDecision { allowed: boolean; reason: string | null }
export interface PermissionRequest { entry: Extract<ChatEntry, { kind: 'permission' }> }
// AgentProcessEvents gains `permission(request: PermissionRequest): void`;
// AgentProcess gains `answerPermission(requestId: string, decision: PermissionDecision): void`.
// CLAUDE_PERMISSION_TOOL and PERMISSION_TOOL_NAME leave this file.
// task 09
// AgentStart.sessionId becomes `string | null`; AgentProcessEvents gains `sessionId(id: string): void`.
// task 14
// ChatEntry gains `{ kind: HarnessEntryKind; id: string; at: number; raw: unknown[] }`,
// `export type HarnessEntryKind = \`${string}:${string}\``.
```

`src/contracts/core-state.ts` (task 01):

```ts
export const coreAgentHarnessesSlot: KeyedSlotKey<AgentHarnessInfo, 'main', 'core'> =
  { id: 'core.agentHarnesses', process: 'main', kind: 'keyed' };   // keyed by harness id
```

`src/contracts/plugin.ts`: `MainServices.agentHarnesses: AgentHarnessRegistry` (task 01);
`MainServices.agentEnvironment: Readonly<Record<string, string>>` and `MainServices.agentHomeDir: string` (task 03).

`src/contracts/processes.ts` (task 03): `ProcessRunner.spawn(command, args, options): SpawnedProcess`, the streaming
run the Claude adapter's `ClaudeSpawn` does today. Task 03 defines `SpawnedProcess` with no Node type, and a plugin's
view kills its spawned processes when the plugin stops, as it stops its `run`s.

`src/shared/agent-harness-label.ts` (task 01): `harnessLabel(infos: ReadonlyMap<string, AgentHarnessInfo>, id:
string): string` — the registered label, else `id`. Sessions, notes and docs page code call it.

`src/contracts/platform.ts` (task 06): `PlatformRelay.serverName: string` (`readonly`), set from
`export const RELAY_SERVER_NAME = 'wigley-forms';` in `src/shared/platform.ts`.

`src/plugins/sessions/contract.ts`: `HARNESSES`, `Harness` and `DRIVE_SESSION_DEFAULTS.harnesses` go; a session's
harness is `string` (task 01). `SessionInfo` gains `rowId: string | null` (task 09).

`src/shared/harness-profiles.ts` (task 05): `export interface RegisteredProfile extends HarnessProfile { harnessId:
string }` and `export function registeredProfiles(infos: ReadonlyMap<string, AgentHarnessInfo>): RegisteredProfile[]`
— every registered harness's profiles in registration order, tagged with the harness id.

`src/shared/fake-agent-harness.ts` (task 10): `export const FAKE_HARNESS_ID = 'fake';`, the fake's id.

`src/plugins/manifests.ts` (task 03): `export const realHarnessPluginIds: readonly string[]` — the ids of the built-in
plugins that run a real harness, which `main.ts` leaves out in fake runs.

`src/plugins/claude-code/` (task 03): `manifest.ts` (`claudeCodeManifest`, id `claude-code`, setting `command`;
`profiles` from task 05), `main/start.ts` (the main part; registers the adapter), `main/*.ts` (every file now in
`src/main/claude-code/`, moved with its test). Harness id stays `export const CLAUDE_HARNESS_ID = 'claude';`, exported from
`src/plugins/claude-code/main/claude-code-harness.ts`.

`src/plugins/chat/` : setting `defaultHarness` (task 10); `export type StartRequest = StartTarget & { harness: string;
profile: string }` and `harness: string` on `ChatSessionInfo` (task 10); setting `profiles` and type `ChatProfile` go (task 05);
`CHAT_HARNESS_ID` goes (task 10); page export `addEntryRenderer` (task 14).

`src/plugins/forms/main/mcp-wording.ts` (task 02): the round's MCP wording.

### New files

- `src/main/agent-harness-registry.ts` + test (task 01): the registry; core, since the composition root builds it.
- `src/shared/agent-harness-label.ts` + test (task 01): one label rule for every page that shows a harness.
- `src/plugins/claude-code/` (task 03): the plugin; every adapter file moves here.
- `src/plugins/claude-code/main/permission-route.ts` + test (task 08): the `permission_prompt` tool and its routing.
- `src/plugins/chat/page/entry-renderers.ts` + test (task 14): the renderer registry.
- `src/plugins/forms/main/mcp-wording.ts` + test (task 02): the wording adapter.

### Boundary rules

- Only `src/plugins/claude-code/` names Claude's CLI, files, env variables, control ids, `_meta` key, permission tool
  or reply JSON. `src/main/main.ts` names the plugin only through the built-in plugin lists.
- `scripts/check-layers.mts`: `src/main/claude-code` leaves `CORE_LAYERS` and `main.ts`'s entry; the plugin's needs
  (`node:` packages) go in `PLUGIN_EXTRAS` (task 03).
- Chat, sessions, docs, usage and notes read harnesses only through `services.agentHarnesses` (main) or
  `core.agentHarnesses` (page and layouts).
- Every task that lands a follow-up item removes it from `docs/features/followups.md` and ticks its master-plan box
  in the same commit. Two tasks of one wave (02 and 03, 05 and 06, 07 and 08) edit those two files in disjoint
  hunks; 07 and 08 also edit different lines of `.agents/skills/drive/SKILL.md`. The second group to commit rebases
  on the first, and no other file is shared inside a wave.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [AgentHarnessRegistry](01-agent-harness-registry.md)

### Wave 2
- [x] [Structured round results](02-structured-round-results.md) — after 01 (both edit `forms/main/start.ts`)
- [x] [The claude-code plugin](03-claude-code-plugin.md) — after 01

### Wave 3
- [x] [AgentHarness grows what a second harness needs](04-agent-harness-grows.md) — after 03

### Wave 4
- [x] [Harness settings with the harness](05-harness-settings.md) — after 04
- [x] [Sessions stops naming Claude](06-sessions-stops-naming-claude.md) — after 04

### Wave 5
- [x] [Docs reads harness config roots from the adapter](07-docs-config-roots.md) — after 05
- [x] [Permission behind the harness](08-permission-behind-the-harness.md) — after 05

### Wave 6
- [x] [Owned sessions join by row id](09-owned-sessions-join-by-row-id.md) — after 06, 08

### Wave 7
- [x] [Chat picks a harness](10-chat-picks-a-harness.md) — after 09

### Wave 8
- [x] [Control roles](11-control-roles.md) — after 10

### Wave 9
- [x] [Clear aliases from the adapter](12-clear-aliases.md) — after 11

### Wave 10
- [ ] [Harness-neutral UI copy](13-harness-neutral-copy.md) — after 12

### Wave 11
- [ ] [Open chat entry kinds and entry renderers](14-entry-kinds-and-renderers.md) — after 13

### Wave 12
- [ ] [Chat follows a harness leaving and returning](15-harness-leave-and-return.md) — after 14

### Wave 13
- [ ] [Doc re-read](16-doc-re-read.md) — after 15

### Wave 14
- [ ] [Final verification](17-final-verification.md) — after 16

## Run log

Review base: e6c894d93a3a717fdd10693a13130b63a7484e75

### Groups
- 01 · hard · 166a52d74 · diff read: every Produces present; wave compile (typecheck, lint) passes after one same-rung test-cast fix · concerns: self-test expectations changed beyond Files (notes session line from the registry, forms expects 'codex session'); stale 'Claude pending' wording fixed in docs/main/start.ts and drive SKILL.md; usage poller looks its harness up once at start
- 02 · hard · d204d35b7 · diff read: mcp-wording.ts exports, argsErrorText on AgentFormType, needs_manual_open only in tool descriptions; wave compile (typecheck, lint) passes; golden captured on the base tree, where all 59 hand-traced values passed (f2f1a2f37) · concerns: golden values hand-traced (settled by the base run); Lane E's 06 and 08 task docs still name argsErrorName, parse(raw, where) and removed exports — its refresh must pick up argsErrorText, parse(raw, at), describe(), RoundResult
- 03 · hard · 594eb7589 · diff read: claudeCodeManifest, realHarnessPluginIds, ProcessRunner.spawn, agentEnvironment/agentHomeDir present, src/main/claude-code gone; wave compile (typecheck, lint) passes · concerns: fake runs serve a catalog without claude-code (self-test plugin lists may shift); endpointEnv's undefined-drop rule now untested in main.ts; Lane P's plan docs still name claude.command; manifest text names ~/.local/bin/claude as the platform default
- 04 · hard · 920835082 · diff read: HarnessCapabilities, HarnessConfigRoots, InstalledPlugin, CONTROL_ROLES, SessionControl.role, info's capabilities/clearAliases/projectConfigFolder, controls/toolUseIdOf/configRoots/installedPlugins present in contracts/agent.ts and both adapters; wave compile (typecheck, lint) passes; oxfmt 4c4cb1bd6 · concerns: foldPipeLine_InitializeWithoutList_KeepsHeldList now expects a second 'initialize listed no models' log; info_Label_* tests replaced by declaration tests; model-choice reader sits in session-fold.ts (commandRecordsOf is in claude-commands.ts); preview-session.ts controls carry no role (task 11); agent definitions now skip an install record with no installPath before picking project-or-user, so a pathless project install falls to the user install where it used to give none
- 06 · hard · 48bde0c9f · diff read: PlatformRelay.serverName, RELAY_SERVER_NAME, McpServeOptions, 4-arg serveMcp, harnessToolUseId present; no claudecode key left in sessions source; wave compile (typecheck, lint) passes; shared-doc hunks in cb20cd2ff · concerns: harness toolUseIdOf runs inside callTool's try, so a throwing reader gives a tool error result as the old read did
- 05 · hard · cb20cd2ff · diff read: HarnessProfile, AgentHarnessInfo.profiles, createAgentHarnessRegistry(slot, log), claude-code profiles setting and DEFAULT_PROFILES, registeredProfiles, FAKE_PROFILES present; ChatProfile and chat.profiles gone; wave compile (typecheck, lint) passes; oxfmt in the wave's format commit · concerns: startUsagePart tests with no registered harness now log an async failing poll none asserts; user-visible strings naming the removed setting reworded harness-neutral beyond the comment edits listed; edits beyond Files: comments in claude-launch.ts, chat and usage layout.d.ts, retro-queue.ts, auto-retro manifest, session-host/design.md; followups 'Docs reads harness config roots' still says it builds on the removed item (07 removes it)
- 07 · hard · 2236bd15f · diff read: HarnessFolders/createHarnessFolders, HarnessChip, ChipInput.harness string, docsFixtureInstalls, readPluginStatus harnesses option present; docs plugin reads roots and installs through the slot; wave compile (typecheck, lint) passes; shared-doc hunks in 8c942653e · concerns: after task 10 renames the fake to 'fake' the self-test i step's fixture index still says claude; a drive run on real Claude reads the user's real ~/.claude profiles; index-sources.test.ts edited beyond Files; page/start.test.ts and the drive docs.seed line left unchanged (01 already says pending chips)
- 08 · hard · 8c942653e · diff read: PermissionDecision, PermissionRequest, AgentProcessEvents.permission, AgentProcess.answerPermission in contracts/agent.ts; permission-route.ts with route/toolSession; claude-code contributes permission_prompt; permission-tool.ts deleted; no CLAUDE_PERMISSION_TOOL in contracts, chat or main; wave compile (typecheck, lint) passes · concerns: two new oxlint no-useless-spread warnings (cancelWaitingPermissions in claude-code-harness.ts:507 and fake-agent-harness.ts:1350, a keys snapshot while settling deletes); test cases most likely to need a touch-up at the gate: harness permission_Cancelled on close, fake send_PermissionText microtask order, chat permission_sessionEnds/rowCloses; chat-sessions permission_abortAfterDetachAll and NoLiveRow cases deleted as now owned by the route and adapter
- 09 · hard · 6fb763cb3 · diff read: AgentStart.sessionId nullable, AgentProcessEvents.sessionId, SessionInfo.rowId, RelayHello.row_id, hostSessionIdSettled, ClaudeStart present; relay.py sends row_id; wave compile passes after one same-rung fix (rowId on two 06 test literals) and oxfmt · concerns: resume finds a running hosted process by hosted.id.startsWith(hostSessionId-) while new process ids start with the row id, so resume of an unheld session no longer finds a process started under the new scheme; hostSessionIdSettled waiters stay pending after detachAll; ~9k-line chat-sessions.test edited unrun, event-order expectations may shift; a pending clear's snapshot pairs the old host id with the new processId for one microtask; workflow hears hostSessionChanged null to id before chat.sessionOpened for a new row
- 10 · hard · eeb2e337e · diff read: chat defaultHarness setting, FAKE_HARNESS_ID = 'fake', composition-root override in selftest-config, CHAT_HARNESS_ID gone, lookups harness resolution present; wave compile passes after one same-rung fix (harness on RecentFolder test literals) and oxfmt · concerns: restore with an unregistered harness now rests with a notice; two start.test restore tests now throw through an artificial infoFails stub; chat-sessions.test setUp patches the fake's info() in place; docs self-test i step still opens its session as 'claude' (docs only tells codex apart)
- 11 · hard · 2728bd986 · diff read: ROLE_COMMANDS replaces CONTROL_IDS, role lookups in controlCommand/chipKeyCommands/composerInputOf/controlChip/pickControlOf, MODE_CONTROL_ID gone, ComposerControlInput.role, preview-session roles; wave compile (typecheck, lint) passes · concerns: none beyond formatting left to oxfmt
- 12 · hard · 4eb8decc2 · diff read: addClearCommands returns one Disposable, aliases from core.agentHarnesses re-registered on slot change, SlashCommands.addAlias present; self-test clear step sends /reset; wave compile (typecheck, lint) passes, oxfmt clean · concerns: clear aliases register app-wide from every harness, not per the session's harness; it.each row typed never[] (compiled clean)
### Contract changes
- IndexHarness (docs contract): 'claude' | 'codex' → string alias kept · why: keeps docs call sites; chips still { claude, codex } until task 07 · consumers: 07 · group 01
- docs-state chips/detailFields/statusTexts/rollupText/treeRowStatus: each takes harnesses: ReadonlyMap<string, AgentHarnessInfo> as last param · why: labels from the slot · consumers: 07 · group 01
- DRIVE_SESSION_DEFAULTS typed { projectDir: string; harness: string }; sessions sidebar-view drawRow takes a harnesses() function; NotesSelfTestResult gains sessionLine · why: the literal union is gone; labels re-read per draw · consumers: none planned · group 01
- FakeSpawn: a record → an exported class implementing SpawnedProcess in src/shared/fake-processes.ts (command, args, cwd, env, written, isInputEnded, kills; drivers stdout/stderr/close) · why: the returned process and the recorded spawn are one object · consumers: 03's tests, later fake-spawn users · group 03
- FAKE_TOOL_USE_ID_META_KEY = 'fake/toolUseId' exported from src/shared/fake-agent-harness.ts beyond Produces, the key the fake's toolUseIdOf reads · why: tests drive the fake's tool-use id the way CLAUDE_TOOL_USE_ID_META_KEY drives Claude's · consumers: 06 · group 04
- usage-internal PlanPollerDeps.planUsage(profileDir) → planUsage(profile: RegisteredProfile); profiles/roundStarted/polled take RegisteredProfile · why: the poller reaches each profile's own harness · consumers: none outside usage · group 05
- fake-agent-harness exports FAKE_CANCELLED_REASON and FakeAgentCall gains { method: 'answerPermission'; requestId; decision }; UNATTENDED_REASON moves to chat-sessions.ts; permission-route.ts also exports RoutedPermissionCall, PermissionCall, PermissionTarget, PermissionRoute, permissionReplyText, DEFAULT_DENY_MESSAGE, PERMISSION_TOOLS · why: src/shared may not import the Claude plugin; the target needs raw args · consumers: 08 only · group 08
- AgentFormDriveSessions.connect param gains rowId: null (shared/agent-forms/drive-actions.ts); ClaudeStart = Omit<AgentStart,'sessionId'> & { sessionId: string } exported from claude-launch.ts · why: every SessionInfo literal carries rowId; the launch needs a minted id · consumers: none planned · group 09
- ChatSessionsDeps.defaultHarness not added; ChatDriveDeps.profileNames() → defaultProfile(): string | null; lookups.ts adds requireHarnessOfProfile and UNRECORDED_HARNESS_ID; ChatSelfTestDeps gains defaultHarness() · why: unused dep dropped; drive needs the default profile's harness · consumers: 10 only · group 10
### Rulings
- Waves 2, 4 and 5 keep their pairs despite the wave check's clashes on followups.md, master-plan.md and drive SKILL.md: the plan's boundary rules put the two groups in disjoint hunks of those files; workers edit only their own hunk, and the group that commits first leaves the shared doc to the second group's commit, which carries both hunks and says so — the check's clash rule cannot see hunks — a mislabelled hunk in one commit if wrong · lead
- Run works in worktree ~/Documents/.worktrees/ai-lane-h-harness-seams (branch lane-h-harness-seams) per WigleyRepos.md § Landing; Lane E's worktree is paused at its forms gate (waits on task 02) and its unmerged commits stay its own; peers on the main clone make every commit pathspec-scoped — a merge conflict at landing if Lane E or P lands first · lead
- Fake labels itself Fake under id 'claude' until task 10, so fake runs read 'Fake' where they read 'Claude Code' — drive captures differ until task 10 · group 01 · group 01
- Relay hello and the drive sessions action accept any string harness; an unregistered id shows its raw id ('codex session') — a typo reads as a raw label · group 01 · group 01
- Payload rows of the golden test assert JSON.stringify(<object literal>, null, 2) rather than literal strings; key order and values stay pinned — stringify's own format is unpinned · group 02 · group 02
- main.ts mode services: ModeServicesContext is { window, homeDir, log }; forWindow adds a RunAgents { harnesses, agentHomeDir } record; a drive run on Claude registers no harness in the root and runs as os.homedir() · group 03 · group 03
- spawnStreaming catches a synchronous spawn throw and reports it through closed on a microtask; abortableProcesses returns a no-op SpawnedProcess for a spawn after stop · group 03 · group 03
- Lead: the wave 2 compile also ran oxfmt --write over the wave's files (49a74243b), and the golden test ran once on the pre-change tree to capture forms-tools.golden.txt — a fixture capture of the base, not a test of the change, so the test gate at the end stays the run's only test evidence · lead
- startingControls(controls) in claude-controls.ts is the one rule for a Claude process's first controls, used by the fold state and by controls() — one helper to inline again if wrong · group 04
- controls(profileDir) ignores profileDir on both adapters — a profile with its own default mode would need a read later · group 04
- A refreshed model choice list leaves the held model value as it is even when the list lacks it; the next get_settings reply re-maps — a stale value shows until then · group 04
- installedPlugins' listedAt matches the literal "<key>" substring per line; a key written with JSON escapes gets listedAt null · group 04
- Registry compares each recomputed entry with slot.get(id) and sets only changed ones; a changed entry that still loses a clash logs the clash again — one repeated line per real change if wrong · group 05
- Strings naming chat's removed profiles setting now name 'the harness's profiles setting' — task 13 may reword · group 05
- plan-poller's in-flight map stays keyed by configDir, so two harnesses declaring one folder share a poll · group 05
- HarnessFolders.roots() returns adapter values unexpanded; doc-files' guardFolders expands ~ against the docs home and drops non-absolute roots — any other reader of roots must expand itself · group 07
- docs-state keeps 01's harnesses param name and DocsViewDeps.harnesses() rather than renaming to infos · group 07
- startDocs hands docsFixtureInstalls to every fake harness in any non-live run, before building the folders · group 07
- The adapter's ask returns the cancelled reply with no entry when the process already closed or detached, not only on an aborted signal · group 08
- The attach target settles just before attachClaudeProcess returns; an answer during an attach reaches the new process, so an unattended row's deny may wait for the attach · group 08
- Chat drops an answer whose processStart is older than the row's current one · group 08
- Fake: an interrupt cancels waiting requests with the shown cancelled entry; detach cancels silently; requests emit on a microtask · group 08
- Plugin version goes to 2.13.1, not the plan's 2.12.4: marketplace main is at 2.13.0 (d5074678f); landing rebases onto main first · group 09
- The fake harness's attach rejects a null sessionId, as Claude does · group 09
- A second clear while one is pending keeps the first pre-clear sent; sessionClosed during a pending clear reports it · group 09
- The Claude adapter's sessionId microtask bypasses the isDetached emit gate · group 09
- No harness step in the start prompt: target is defaultHarness, a picked recent folder's recorded registered harness, or a pinned profile's harness · group 10
- ChatSessionsDeps gains no defaultHarness (no reader); drive deps take defaultProfile() in place of profileNames() · group 10
- UNRECORDED_HARNESS_ID = 'claude' is the harness of a record or recent folder saved without one · group 10
- ComposerControlInput.role is left out of the fixture object when null (verbosity has no role) · group 11
- Aliases are recomputed only when the distinct list changes; a command that takes a dropped alias's name moves to the end of list() · group 12
### Review rounds
### Test gate
