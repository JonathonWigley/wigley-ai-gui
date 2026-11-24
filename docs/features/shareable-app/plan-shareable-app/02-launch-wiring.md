# 02 — Launch every Claude Code session with the `auri` plugin, and build every tool name from one place

Status: done
Type: Task
Rung: standard · follows the existing `claudeLaunch` argument pattern (`src/plugins/claude-code/main/claude-launch.ts`, the `--permission-prompt-tool` pair) and adds no seam another task consumes
Wave: 3 · Depends on: 01 (consumes `agentPluginDir` and `MainServices.appDir`), 03 (both edit `claude-code-harness.ts`)
Plan: [plan.md](plan.md)

Mandatory reads for this task: `wigley-ai-gui/AGENTS.md` § Architecture (the claude-code harness and the relay
paragraph), `docs/features/feature-contributions/design.md` § Names and types › The agent plugin.

Paths are under `wigley-ai-gui/` in the worktree `W` (`~/Documents/.worktrees/ai-shareable-app`).

Files:
- modify `src/plugins/claude-code/main/claude-launch.ts` · test `src/plugins/claude-code/main/claude-launch.test.ts`
- modify `src/plugins/claude-code/main/claude-code-harness.ts` · test `src/plugins/claude-code/main/claude-code-harness.test.ts`
- modify `src/plugins/claude-code/main/start.ts`
- modify `src/plugins/claude-code/main/permission-route.ts`
- modify `src/shared/platform.ts` · test `src/shared/platform.test.ts`
- test `src/plugins/chat/main/start.test.ts`, `src/plugins/chat/main/chat-sessions.test.ts` (fixture tool names only)

Consumes: `AGENT_PLUGIN_NAME`, `AGENT_SERVER_NAME`, `claudePluginToolName`, `agentPluginDir` in
`src/shared/agent-plugin.ts` ← 01 · `MainServices.appDir` in `src/contracts/plugin.ts` ← 01 · the folder
`agent-plugin/` with the `auri` MCP server ← 01.

Produces:
- `claudeLaunch(request: ClaudeStart, env: Readonly<Record<string, string>>, homeDir: string, paths: Paths, pluginDir: string): ClaudeLaunch` in `claude-launch.ts`.
- `ClaudeSpawnInput.pluginDir: string` in `claude-launch.ts`.
- `ClaudeCodeHarnessDeps.agentPluginDir: string` in `claude-code-harness.ts`.
- `RELAY_SERVER_NAME = AGENT_SERVER_NAME` in `src/shared/platform.ts`.
- `CLAUDE_PERMISSION_TOOL = claudePluginToolName(AGENT_PLUGIN_NAME, AGENT_SERVER_NAME, PERMISSION_TOOL_NAME)` in `permission-route.ts`.

## Decisions

- **Probe first, before any code.** Every tool name in this task rests on Claude Code naming an inline plugin's MCP
  tool `mcp__plugin_<plugin>_<server>__<tool>`. Prove it with the user's own `claude` (no install; it spends one
  model call):
  1. In the session scratchpad, write a minimal plugin folder `probe-plugin/`: `.claude-plugin/plugin.json` with
     `"name": "probe"` and `mcpServers.probe` running `python3 "${CLAUDE_PLUGIN_ROOT}/server.py"`, and `server.py`, a
     standard-library stdio MCP server that answers `initialize` and `tools/list` with one tool `ping`, and replies
     to `tools/call` with a text result.
  2. Run `claude -p --plugin-dir <scratchpad>/probe-plugin --output-format stream-json --verbose "Reply with the word ok."`
     and read the first `{"type":"system","subtype":"init"}` line: its `tools` array must hold
     `mcp__plugin_probe_probe__ping`, and its `mcp_servers` entry for the server must be `connected`.
  3. Record the init line's tool name and server status in the task's Proof.
  If the tool name has any other form, or the server does not connect, stop here and report it to the lead with the
  init line: plan.md's tool names, `CLAUDE_PERMISSION_TOOL` and every renamed reference rest on this form.
- **The flag.** `claudeLaunch` adds `'--plugin-dir', pluginDir` right after the `--permission-prompt-tool` pair, on
  every launch, a resumed one included. `claude --help` on this machine prints
  `--plugin-dir <path>  Load a plugin from a directory or .zip` (plan.md § Preconditions).
- **Why `--plugin-dir` is safe beside an installed `auri`.** The Claude Code plugin loading reference (§ Name
  conflicts, read at plan time) says an enabled `--plugin-dir` plugin replaces a same-named installed marketplace
  plugin silently, and loads in place as `auri@inline`. So an app session gets the app's own copy even when the user
  also installed `auri` from the app's marketplace for terminal sessions, and it never gets two `auri` servers.
- **Where the folder comes from.** `claude-code/main/start.ts` sets
  `agentPluginDir: agentPluginDir(services.appDir, services.paths)` in the deps it passes `createClaudeCodeHarness`.
  Both `claudeSpawn` calls in `claude-code-harness.ts` (the live launch near line 916 and `prepareClaudeRun` near line
  988, measured at plan time, re-verify) pass `pluginDir: deps.agentPluginDir`. A prepared run (a scheduled run that
  starts while the app is closed) carries the same path: the installed app's resources folder stays on disk while the
  app is closed.
- **No other `claude` call takes the flag.** The plan-usage poll (`PLAN_USAGE_ARGS`, `claude -p /usage`) needs no app
  tool, so it stays as it is.
- **Doc comments.** `claudeLaunch`'s comment adds "the app's `auri` plugin as `--plugin-dir`". The comment above
  `PERMISSION_TOOL_NAME` drops the `wigley-forms` sentence and says the tool is served by the `auri` plugin's server,
  which every app launch loads with `--plugin-dir`. `NO_PROCESS_TEXT` and the tool description keep their text.
- **`RELAY_SERVER_NAME`.** `platform.ts` imports `AGENT_SERVER_NAME` and sets `RELAY_SERVER_NAME` to it. Its comment
  becomes "The server key of the `auri` plugin's manifests, which the app's MCP server also gives as its name." Keep
  the export, because `platformRecord` and the sessions plugin read `relay.serverName`.
- **Every place a tool name is built.** `CLAUDE_PERMISSION_TOOL` is the only place in non-test code that builds an
  `mcp__` name (measured at plan time by `grep -rn "mcp__" src --include='*.ts'`, re-verify). The test fixtures that
  spell a tool name change to the `auri` form so a reader meets one naming: `claude-launch.test.ts`'s `TOOL` becomes
  `claudePluginToolName(AGENT_PLUGIN_NAME, AGENT_SERVER_NAME, 'permission_prompt')` imported from
  `src/shared/agent-plugin.ts` (not a literal, so it follows the constant); the `mcp__wigley-forms__chatroom_post`
  and `mcp__wigley-forms__set_workflow_step` fixtures in `chat/main/start.test.ts` (lines 812, 1278) and
  `chat/main/chat-sessions.test.ts` (lines 2349, 2521) become `mcp__plugin_auri_auri__chatroom_post` and
  `mcp__plugin_auri_auri__set_workflow_step` (line numbers measured at plan time, re-verify).
- The forms tool-definitions comment that says "The two wigley-forms tools" is task 11's file, so it stays here.

## Behaviour

GIVEN any session start WHEN `claudeLaunch` builds the args THEN they hold `--permission-prompt-tool
mcp__plugin_auri_auri__permission_prompt` and then `--plugin-dir <appDir>/agent-plugin`.
GIVEN a prepared run WHEN `prepareClaudeRun` builds its spec THEN its args hold the same `--plugin-dir` pair.
GIVEN any platform WHEN `platformFor` runs THEN `relay.serverName` is `auri`.

## Tests

- `claude-launch.test.ts` `claudeLaunch_NewSession_PinnedArgsAndProfileEnv`: the pinned args gain
  `'--plugin-dir', '/app/agent-plugin'` after the permission tool, and every `claudeLaunch(...)` call in the file
  passes `'/app/agent-plugin'`. Catches a launch that drops the flag, which leaves the session with no app tools.
- `claude-launch.test.ts`, the existing `claudeSpawn` test near line 395: `pluginDir` passes through to the spec's args.
  Catches a spawn path that builds the args without the folder.
- `claude-code-harness.test.ts`: every deps fake gains `agentPluginDir: '/app/agent-plugin'`; the prepared-run test
  that asserts `CLAUDE_PERMISSION_TOOL` in the args (near line 3617) also asserts the `--plugin-dir` pair. Catches
  `prepareClaudeRun` losing the folder.
- `claude-code-harness.test.ts`: `liveStart_SpawnsWithPluginDir` starts a session through the harness with the
  recording `ProcessRunner` (the `spawned` list near line 155, measured at plan time, re-verify) and asserts the
  first spawn's `args` hold `'--plugin-dir', '/app/agent-plugin'` right after the permission tool pair. Catches the
  live launch (near line 916) building its spawn without `deps.agentPluginDir`.
- `platform.test.ts`: the `serverName` row expects `'auri'`. Catches a server name that drifts from the manifests'
  key, which would make the permission tool name wrong.
- Task 01's `agentPluginManifests_NameTheConstants` already ties `AGENT_SERVER_NAME` to the manifest
  key; nothing is added for it here.

## Verification

```
cd /Users/jonathonwigley/Documents/.worktrees/ai-shareable-app/wigley-ai-gui
npm test -- src/plugins/claude-code src/shared/platform.test.ts src/plugins/chat/main/start.test.ts src/plugins/chat/main/chat-sessions.test.ts
npm run typecheck && npm run lint
grep -rn "wigley-forms\|wigley_forms" src --include='*.ts'
```

The grep prints only `src/plugins/forms/contract.ts` (`SAVED_ROUNDS_FOLDER`, a data folder plan.md keeps),
`src/plugins/forms/main/tool-definitions.ts` (task 11), `src/plugins/chatroom/main/start.ts` (task 11) and
`src/main/main.ts` (the self-test temp-folder prefix, not a tool name). A live app session that loads the `auri`
server is checked in task 18.

## Done when

- The probe's init line shows `mcp__plugin_probe_probe__ping` with the server connected, recorded in Proof.
- The commands above pass, and the grep prints only the four files named.
- `RELAY_SERVER_NAME` and `CLAUDE_PERMISSION_TOOL` hold no string literal of a plugin or server name.

Commit: one commit for the group.

## Proof

Commit bda3396a9 · proof: diff read: Produces present per report and spot reads; wave 3 typecheck and lint pass; tests wait for the test gate · concerns: liveStart test asserts on the fake session host's spawn (the ProcessRunner route the plan named is never reached)
