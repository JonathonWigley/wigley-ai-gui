# 08 — The agent-commands plugin: three MCP tools and two drive actions

Status: not started
Type: Task
Rung: deep · joins four earlier groups behind three tools, with the confirm gate, the refusals and async drive calls
Wave: 3 · Depends on: 01, 02, 03, 06
Plan: [plan.md](plan.md)

Paths are under `wigley-ai-gui/`.

Files:
- create `src/plugins/agent-commands/manifest.ts`
- create `src/plugins/agent-commands/main/start.ts`
- create `src/plugins/agent-commands/main/tools.ts`
- test `src/plugins/agent-commands/main/tools.test.ts`
- create `src/plugins/agent-commands/main/drive-actions.ts`
- modify `src/plugins/manifests.ts`
- modify `src/plugins/main.ts`

Consumes:  `PluginCommands.runFor`, `PluginCommands.list`, `CommandInfo.risky` ← 01
           `formsMainKey`, `FormsMainExports.confirm` ← 02
           `readsEverySlot`, `api.state.readAny`, `api.state.slotIds` ← 03
           chat's `isHeadless`, `isUnattended`, `chat.sendTo` ← 06
           in the tree: `SessionsMainExports.contributeTools`, `titles`, `label`, `editableTitle`,
           `textResult`, `errorResult`, `ToolCallContext`, `DriveHost.add`
Produces:  `agentCommandsManifest` in `src/plugins/agent-commands/manifest.ts`
           `agentCommandsMainPart` in `src/plugins/agent-commands/main/start.ts`
           `export const AGENT_COMMAND_TOOLS: ToolDefinition[]` and
           `export function createAgentCommandTools(deps: AgentCommandToolDeps): (callerId: string) => ToolSession` in `src/plugins/agent-commands/main/tools.ts`
           drive actions `agent-commands.call` and `agent-commands.result`

Decisions:
- Manifest: id `agent-commands`, label `Agent commands`; `dependsOn` main `sessions`, `chat`, `forms`;
  `readsEverySlot: true`; no commands, settings or page part. Register it in `manifests.ts` and `main.ts` beside forms.
- The tools go to every agent, main and sub-agents alike: `contributeTools` with no `mainAgentOnly` (round 1).
- `start.ts` passes `(session) => tools(session.id)` to `contributeTools`, and builds `AgentCommandToolDeps` from the api and the three exports, so `tools.ts` holds the tool rules over
  plain functions and its test needs no app: `list()`, `runFor(id, arg, sessions)`, `rowIds()` (from
  `sessions.rows`), `nameOf(id)`, `isHeadless(id)`, `isUnattended(id)`, `confirm(callerId, request, signal,
  toolUseId)`, `readAny(id)`, `slotIds()`.
- `nameOf(id)` is `editableTitle(sessions.titles(id))` when not empty, else `sessions.label(id)`, else the id — the
  name rule 06 uses for the frame.
- Tool definitions, pinned (descriptions in plain words, each naming its input):
  - `list_commands { filter?: string }` → `textResult` of a JSON array of `{ id, label, group, runsIn, arg?, risky? }`,
    sorted by id; `filter` keeps the infos whose id, label or group holds it, case ignored.
  - `run_command { command: string, arg?: unknown, session?: string }` → `textResult('Ran <id>.')`.
  - `read_state { slot?: string, key?: string }` → no `slot`: a JSON array of `slotIds()`; else the slot as JSON — a
    value slot's value, a keyed slot as an object of its entries, a list slot as an array; with `key`, that one entry.
- `run_command` steps, in order; each refusal is an `errorResult` and runs nothing:
  1. An unknown `command` → `Unknown command <id>. Call list_commands for the ids.`
  2. A `session` that is not in `rowIds()` → `No session <session>. Read read_state sessions.rows for the ids.`
  3. A risky command from a caller that is headless or unattended → `<id> is risky and needs the user's Allow, but
     this session runs with no user watching.`
  4. A risky command: `confirm(callerId, { title, detail }, context.signal, context.toolUseId)`.
     - title: `Run <label>?`
     - detail: `The agent in session "<caller name>" asks to run <id> (<label>)` + ` on session "<target name>"` when a
       session is given + `.` + `\n\nArgument: <arg JSON>` when an argument is given.
     - false → `The user denied <id>.`
  5. `runFor(id, arg, { targetSessionId: session, callerSessionId: callerId })`. A rejection → `errorResult` of its
     message; a resolve → `Ran <id>.`
- `chat.sendTo` takes its target from its argument; when the tool call gives `arg.sessionId` and no `session`, step 2
  checks `arg.sessionId` too, so an agent's typo gets the tool's error text.
- `read_state` with an unknown `slot` → `No slot <slot>. Call read_state with no slot for the ids.`; an unknown `key`
  → `No entry <key> in <slot>.`
- A tool session ends with nothing to clean up: `end()` does nothing.
- Drive actions (`drive-actions.ts`), because the fake harness calls no MCP tool and a drive run must reach the
  tools:
  - `agent-commands.call { sessionId, tool, args }` calls the tool on the tool session `createAgentCommandTools`
    gives for `sessionId` as caller (one per session id, kept for the run), with `toolUseId: null` and a fresh
    signal, and returns `{ callId }` at once — a risky call waits on the user's form, which the drive answers with
    later actions. It goes around `sessions`' tool-call guards; the confirm still runs in the caller's forms
    session, so the caller must be a live session forms started a tool session for.
  - `agent-commands.result { callId }` returns `{ pending: true }` until the call settles, then its `ToolResult`.
  - Both are added only when `api.drive` is not null, as `system-stats` adds its actions.

GIVEN `list()` holds `a.x` and `b.y` WHEN `list_commands {filter: 'B'}` runs THEN it returns only `b.y`'s info
GIVEN an unknown command WHEN `run_command` runs THEN it returns the unknown-command error and `runFor` is not called
GIVEN a risky command WHEN `run_command` runs from a headless caller THEN it returns the refusal and asks no confirm
GIVEN a risky command and `confirm` resolves false WHEN `run_command` runs THEN it returns `The user denied <id>.` and `runFor` is not called
GIVEN a risky command and `confirm` resolves true WHEN `run_command` runs with `session: 's2'` THEN `runFor` gets `{ targetSessionId: 's2', callerSessionId: <caller> }` and the result is `Ran <id>.`
GIVEN `runFor` rejects with `boom` WHEN `run_command` runs THEN the result is an error result `boom`
GIVEN a keyed slot WHEN `read_state {slot, key}` runs THEN it returns that entry's JSON; an absent key gives the no-entry error

Tests:
- `src/plugins/agent-commands/main/tools.test.ts` (new), over `createAgentCommandTools` with plain fake deps:
  - `it.each` `run_command refuses before running` (rows: unknown command, unknown session, unknown `arg.sessionId`
    for `chat.sendTo`, risky from headless, risky from unattended, risky denied): each the pinned text, `runFor` not
    called.
  - `it.each` `run_command runs and reports` (rows: plain command, risky allowed with target, `runFor` rejects): the
    `runFor` call and the result text. Assert the confirm's title and detail on the risky row.
  - `it.each` `list_commands filters by id, label or group`.
  - `it.each` `read_state reads ids, a slot or one entry` (rows: no slot, value slot, keyed slot, list slot, key,
    unknown slot, unknown key).

Done when: `npm run typecheck` passes; the test gate runs the tests above. The tools in the live app are checked by 10
(Final verification).
Commit:    one commit for the group
