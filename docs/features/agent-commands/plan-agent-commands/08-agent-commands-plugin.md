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
- test `src/plugins/agent-commands/main/start.test.ts`
- create `src/plugins/agent-commands/main/tools.ts`
- test `src/plugins/agent-commands/main/tools.test.ts`
- create `src/plugins/agent-commands/main/drive-actions.ts`
- test `src/plugins/agent-commands/main/drive-actions.test.ts`
- modify `src/plugins/manifests.ts`
- modify `src/plugins/main.ts`

Consumes:  `PluginCommands.runFor`, `PluginCommands.list`, `CommandOutcome`, `CommandInfo.risky`, `CommandInfo.targets` ← 01
           `formsMainKey`, `FormsMainExports.confirm` ← 02
           `readsEverySlot`, `api.state.readAny`, `api.state.slotIds` ← 03
           chat's `isHeadless`, `isUnattended`, `senderName`, and the command `chat.sendTo` ← 06
           in the tree: `SessionsMainExports.contributeTools`, `textResult`, `errorResult`, `ToolCallContext`,
           `DriveHost.add`
Produces:  `agentCommandsManifest` in `src/plugins/agent-commands/manifest.ts`
           `agentCommandsMainPart` in `src/plugins/agent-commands/main/start.ts`
           `export const AGENT_COMMAND_TOOLS: ToolDefinition[]` and
           `export function createAgentCommandTools(deps: AgentCommandToolDeps): (callerId: string) => ToolSession` in `src/plugins/agent-commands/main/tools.ts`
           drive actions `agent-commands.call` and `agent-commands.result`

Decisions:
- **Manifest.** Id `agent-commands`, label `Agent commands`.
  - `dependsOn` main: `sessions`, `chat` and `forms`.
  - `readsEverySlot: true`.
  - No commands, settings or page part.
  - Register it in `manifests.ts` and `main.ts`, beside forms.
- **Who gets the tools.** Every agent, main and sub-agents alike: `contributeTools` with no `mainAgentOnly` (round 1).
- **`start.ts`** passes `(session) => tools(session.id)` to `contributeTools`. It builds `AgentCommandToolDeps` from the
  api and the three exports, so `tools.ts` holds the tool rules over plain functions and its test needs no app. The
  deps:
  - `list()`, `runFor(id, arg, sessions)`
  - `rowIds()`, read from `sessions.rows`
  - `senderName(id)`, `isHeadless(id)`, `isUnattended(id)` (chat)
  - `confirm(callerId, request, signal, toolUseId)` (forms)
  - `readAny(id)`, `slotIds()`
- **Names.** Every session name in a confirm comes from chat's `senderName` (06), the one owner of the name rule (lead
  ruling 4). This task has no name chain of its own.
- **Schemas.** The three tool definitions are literals in `tools.ts`, each with `additionalProperties: false`:
  - `list_commands`: `{ filter?: string }`
  - `run_command`: `{ command: string (required), arg?: any JSON, session?: string }`
  - `read_state`: `{ slot?: string, key?: string }`
- **Descriptions** are in plain words, each naming its inputs. `run_command`'s description says: `Ran` means the
  command's handler finished without an error; it does not prove the effect, so read the state to check it (lead ruling
  8).
- **Input checks** (step 0 of every tool). Each failure is an `errorResult` naming the field, and nothing runs:
  - `command` missing or not a string → `command must be a string`
  - `session`, `filter`, `slot` or `key` not a string → `<field> must be a string`
  - `key` without `slot` → `key needs slot`
  - an unknown tool name → `Unknown tool <name>`
  - `arg` counts as given when it is not `undefined`; `null` is given.
- **`list_commands`** gives a `textResult` of a JSON array of `{ id, label, group, runsIn, arg?, risky?, targets? }`,
  sorted by id. `filter` keeps the infos whose id, label or group holds it, case ignored.
- **`run_command`** steps, in order. Each refusal is an `errorResult` and runs nothing:
  1. An unknown `command` → `Unknown command <id>. Call list_commands for the ids.`
  2. A `session` given for a command without `targets: true` → `<id> does not act on a given session. Run it without
     session.` `chat.sendTo` is not flagged, since it takes its target in `arg`.
  3. A `session` that is not in `rowIds()` → `No session <session>. Read read_state sessions.rows for the ids.` For
     `chat.sendTo`, a string `arg.sessionId` not in `rowIds()` gives the same text.
  4. A `forms.*` command while any confirm waits → `forms commands wait until the open Allow or Deny is answered.` An
     agent cannot pick Allow on a confirm for the user (Decided). The tools keep one count of waiting confirms across
     every caller.
  5. A risky command from a caller that is headless or unattended → `<id> is risky and needs the user's Allow, but this
     session runs with no user watching.` No confirm is asked.
  6. A risky command calls `confirm(callerId, { title, detail }, context.signal, context.toolUseId)`:
     - title: `Run <label>?`
     - detail: `The agent in session "<caller name>" asks to run <id> (<label>)`, then ` on session "<target name>"`
       when a session is given, then `.`. When an argument is given, add a blank line, `Argument:`, and the argument as
       `JSON.stringify(arg, null, 2)` in a fenced `json` block.
     - A rejection → `errorResult` of its message (lead ruling 6).
     - `false` → `The user denied <id>.`
  7. `runFor(id, arg, { targetSessionId: session, callerSessionId: callerId })`:
     - `'ran'` → `textResult('Ran <id>.')`
     - `'skipped'` → `textResult('Skipped <id>: an intercept did not run it.')`
     - a rejection → `errorResult` of its message
- **`read_state`** (lead ruling 9; the slot shapes match `SlotSnapshot`):
  - With no `slot`, it gives a JSON array of `slotIds()`.
  - A value slot gives its value as JSON, and an unset value gives `null`.
  - A keyed slot gives an object of `key: value`.
  - A list slot gives an array of `[key, items]` pairs in first-set order.
  - With `key`: a keyed slot gives that value, and a list slot gives that key's `items` array.
  - Errors:
    - an unknown `slot` → `No slot <slot>. Call read_state with no slot for the ids.`
    - an unknown `key`, or any `key` on a value slot → `No entry <key> in <slot>.`
  - A declared slot that no part has created yet reads as unknown.
- A tool session ends with nothing to clean up: `end()` does nothing.
- **Drive actions** (`drive-actions.ts`). The fake harness calls no MCP tool, so a drive run reaches the tools through
  these:
  - `agent-commands.call { sessionId, tool, args }` calls the tool on the tool session `createAgentCommandTools` gives
    for `sessionId` as caller, with `toolUseId: null` and a fresh signal.
    - There is one tool session per session id, kept for the run.
    - It returns `{ callId }` at once. `callId` is a counter string (`'1'`, `'2'`, …). A risky call waits on the user's
      form, which the drive answers with later actions.
    - It goes around `sessions`' tool-call guards. The confirm still runs in the caller's forms session, so the caller
      must be a live session that forms started a tool session for.
  - `agent-commands.result { callId }` returns `{ pending: true }` until the call settles, then its `ToolResult`. That
    result stays readable for the run. An unknown `callId` rejects with `Unknown call <callId>`.
  - Both are added only when `api.drive` is not null, as `system-stats` adds its actions.

GIVEN `list()` holds `a.x` and `b.y` WHEN `list_commands {filter: 'B'}` runs THEN it returns only `b.y`'s info
GIVEN an unknown command WHEN `run_command` runs THEN it returns the unknown-command error and `runFor` is not called
GIVEN a command without `targets` WHEN `run_command` runs with `session` THEN it returns the takes-no-session error and asks no confirm
GIVEN a risky command WHEN `run_command` runs from a headless caller THEN it returns the refusal and asks no confirm
GIVEN a waiting confirm WHEN another call runs a `forms.*` command THEN it returns the wait error
GIVEN a risky command and `confirm` resolves false WHEN `run_command` runs THEN it returns `The user denied <id>.` and `runFor` is not called
GIVEN a risky command and `confirm` rejects with `no forms session for c1` WHEN `run_command` runs THEN the result is an error result with that text, and `runFor` is not called
GIVEN a risky targetable command and `confirm` resolves true WHEN `run_command` runs with `session: 's2'` THEN `runFor` gets `{ targetSessionId: 's2', callerSessionId: <caller> }` and the result is `Ran <id>.`
GIVEN `runFor` resolves `'skipped'` WHEN `run_command` runs THEN the result is `Skipped <id>: an intercept did not run it.`
GIVEN `runFor` rejects with `boom` WHEN `run_command` runs THEN the result is an error result `boom`
GIVEN a list slot WHEN `read_state {slot}` runs THEN it returns `[[key, items], …]` in first-set order; with `key` it returns that key's items

Tests:
- `src/plugins/agent-commands/main/tools.test.ts` (new), over `createAgentCommandTools` with plain fake deps:
  - `it.each` `run_command refuses before running`. Each row returns its pinned text, and `runFor` is not called. The
    rows that should not ask also assert that `confirm` is not called.
    - Rows: missing `command`; unknown command; `session` on an unflagged command; `session` on `chat.sendTo`;
      unknown session; unknown `arg.sessionId` for `chat.sendTo`; `forms.submit` while a confirm waits; risky from
      headless; risky from unattended; risky denied; `confirm` rejects.
  - `it.each` `run_command runs and reports`. Each row asserts the `runFor` call and the result text.
    - Rows: a plain command; a risky targetable command allowed with a target (also assert the confirm's literal title
      and detail, the fenced argument included); `'skipped'`; `runFor` rejects.
  - `it.each` `list_commands filters by id, label or group`.
  - `it.each` `read_state reads ids, a slot or one entry`. Each row has a literal expected JSON.
    - Rows: no slot; value slot; unset value slot (`null`); keyed slot; list slot; key on keyed; key on list; key on a
      value slot; unknown slot; unknown key; `key` without `slot`.
  - `it('the three tool definitions are the pinned literals')`, as forms' `tool-definitions.test.ts` checks its own.
- `src/plugins/agent-commands/main/start.test.ts` (new): one `it` that the part contributes the three tools with no
  `mainAgentOnly`, through the plugin harness.
- `src/plugins/agent-commands/main/drive-actions.test.ts` (new): one `it.each` with rows for pending then settled, an
  unknown `callId`, and no actions added when `api.drive` is null.

Done when: `npm run typecheck` passes; the test gate runs the tests above. The tools in the live app are checked by 10
(Final verification).
Commit:    one commit for the group
