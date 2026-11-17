# 06 — Sessions stops naming Claude

Status: done
Type: Task
Wave: 4 · Depends on: 04
Plan: [plan.md](plan.md)

Files:
- modify `src/contracts/platform.ts` — `PlatformRelay` gains `serverName`
- modify `src/shared/platform.ts` — `platformRecord` sets `relay.serverName`
- test `src/shared/platform.test.ts`
- modify `src/plugins/sessions/main/mcp/mcp-server.ts` — `TOOL_USE_ID_META_KEY`, `toolUseId()` and the name in `SERVER_INFO` go; `serveMcp` takes them as options
- test `src/plugins/sessions/main/mcp/mcp-server.test.ts`
- modify `src/plugins/sessions/main/start.ts` — `openRelay` hands `serveMcp` the server name and a per-connection tool-use id reader
- test `src/plugins/sessions/main/start.test.ts`
- modify `docs/features/followups.md` — remove the "Sessions stops naming Claude" item
- modify `docs/features/intent-alignment/master-plan.md` — tick its box

Consumes:
- `AgentHarnessRegistry.get(id: string): AgentHarness | null` and `MainServices.agentHarnesses: AgentHarnessRegistry` ← 01
- `AgentHarness.toolUseIdOf(meta: Readonly<Record<string, unknown>> | null): string | null` ← 04 (Claude's adapter reads `claudecode/toolUseId`; the fake answers per 04)
- `SessionInfo.harness` as task 01 leaves it (an open harness id string, or null when the hello named none)
- `ConnectedSession.session.info` — today's tree (`src/plugins/sessions/contract.ts`)

Produces:
- `readonly serverName: string;` in `src/contracts/platform.ts` (`PlatformRelay`)
- `export const RELAY_SERVER_NAME = 'wigley-forms';` in `src/shared/platform.ts`
- `export interface McpServeOptions { serverName: string; toolUseIdOf(meta: Readonly<Record<string, unknown>> | null): string | null }` in `src/plugins/sessions/main/mcp/mcp-server.ts`
- `export function serveMcp(streams: { input: Readable; output: Writable }, session: ToolSession, tools: LiveTools, options: McpServeOptions): { close(): Promise<void> }` in `src/plugins/sessions/main/mcp/mcp-server.ts`
- `export function harnessToolUseId(harnesses: Pick<AgentHarnessRegistry, 'get'>, info: SessionInfo, meta: Readonly<Record<string, unknown>> | null): string | null` in `src/plugins/sessions/main/start.ts`

Decisions:
- The MCP server name comes from `platform.relay.serverName`, set by the composition root's `platformFor`, with no setting (plan.md § Decisions). The value stays `'wigley-forms'`: the marketplace plugin's `.mcp.json` server key, which Claude's tool names (`mcp__plugin_wigley_wigley-forms__…`) embed. `SERVER_INFO.version` `'1.0.0'` stays in `mcp-server.ts`.
- The tool-use id is read by the adapter registered under the hello's harness id (plan.md § Decisions). `mcp-server.ts` knows no registry and no `_meta` key: it hands each call's raw `_meta`, or null when the call carries none, to `options.toolUseIdOf`, and puts the answer in `ToolCallContext.toolUseId`.
- `harnessToolUseId` looks the harness up at each call, not once per connection, so an adapter that registers after a relay connected answers that relay's later calls (drafter).
- A session whose `info.harness` is null, or names an id with no registered adapter, gets a null tool-use id (plan.md § Decisions; design doc § Permission prompts).
- Every consumer of `ToolCallContext.toolUseId` copes with null today; the task changes none of them (measured at plan time, re-verify):
  - `src/plugins/sessions/main/session-list.ts` `routeCall` copies it into `GuardedToolCall.toolUseId` (`string | null`).
  - `src/plugins/chat/main/tool-callers.ts` `callerGuard` answers `{ kind: 'run' }` for a null id. A subagent's call of a main-agent-only tool from a harness with no adapter so runs, not skips.
  - `src/shared/agent-forms/tool-session.ts` passes it to the form type's `open`; `src/shared/agent-forms/form-store.ts` `openRecord` saves it as `tool_use_id: null`. No code in `src/` reads a saved `tool_use_id` back except the store's own parse (`stringOrNull`).
  - `src/plugins/forms/main/round-type.ts` passes it through to `session.open`.
  - `src/plugins/chat/main/permission-tool.ts` reads `tool_use_id` from the call's arguments, not from the context.
- The sessions manifest gains nothing: `api.services.agentHarnesses` and `api.services.platform` are core services every main part already reads (`src/plugins/sessions/main/start.ts` reads both today).
- Lane gate: Lane P's Per-platform program lookup waits for this task, because it edits `src/contracts/platform.ts` and `src/shared/platform.ts` too (plan.md § Lane gates).

Mandatory:
- `AGENTS.md` § Architecture: "A plugin talks", "An MCP tool", "An agent harness", "An ambient service".
- `docs/features/agent-harnesses/design.md` — whole.

GIVEN the composition root built the platform WHEN any part reads `platform.relay.serverName` THEN it reads `'wigley-forms'`.
GIVEN a relay connection WHEN its client sends `initialize` THEN the reply's `serverInfo.name` is the `serverName` `serveMcp` was given.
GIVEN a `tools/call` carrying `_meta` WHEN the server routes it THEN `toolUseIdOf` receives that `_meta` object and the session's call context holds its answer.
GIVEN a `tools/call` with no `_meta` WHEN the server routes it THEN `toolUseIdOf` receives null.
GIVEN a session whose hello named a registered harness WHEN a call arrives THEN the tool-use id is that adapter's `toolUseIdOf(meta)`.
GIVEN a session whose hello named no harness, or a harness id with no registered adapter WHEN a call arrives THEN the tool-use id is null.

Tests:
- `src/shared/platform.test.ts` › `platformFor_Inputs_RelayCarriesLaunchAndPid` — a row added to the existing test: `expect(relay.serverName).toBe('wigley-forms')` for each OS.
- `src/plugins/sessions/main/mcp/mcp-server.test.ts` — the `connect` helper passes `{ serverName: 'test-forms', toolUseIdOf }`, where `toolUseIdOf` records each `meta` it receives and answers `'toolu_01'` when `meta` is not null, else null.
  - `initialize_ServerName_RepliesWithGivenName` — the `initialize` reply's `result.serverInfo.name` is `'test-forms'`.
  - `calls the session with the tool name, arguments and tool-use id` (existing) — the call sends `_meta: { 'claudecode/toolUseId': 'toolu_01' }`; it now also asserts `toolUseIdOf` received exactly `{ 'claudecode/toolUseId': 'toolu_01' }`, and `context.toolUseId` is `'toolu_01'`.
  - `passes a null tool-use id when the host sends none` (existing) — it now also asserts `toolUseIdOf` received `null`.
- `src/plugins/sessions/main/start.test.ts` › `harnessToolUseId_ByHelloHarness_AsksThatAdapter` — one `it.each` table over a registry stub whose `get('claude')` returns a harness whose `toolUseIdOf` answers `'toolu_01'`, and whose `get` returns null for every other id; `meta` is `{ k: 'v' }`:
  | `info.harness` | expected |
  |---|---|
  | `'claude'` | `'toolu_01'` |
  | `null` | `null` |
  | `'codex'` | `null` |
  The `'claude'` row also asserts the adapter received `{ k: 'v' }`.
- Self-test: no step. The self-test opens no relay (`sessionsMainPart.start`, `runMode === 'selfTest'`), so no MCP server runs in it.

Approach:
- `openRelay` in `src/plugins/sessions/main/start.ts` passes `serve: (streams, session) => serveMcp(streams, session, list, { serverName: api.services.platform.relay.serverName, toolUseIdOf: (meta) => harnessToolUseId(api.services.agentHarnesses, session.session.info, meta) })`.
- `mcp-server.ts` passes `meta ?? null` from `request.params._meta` to `options.toolUseIdOf`. The SDK types `_meta` as `Record<string, unknown> | undefined`.
- `platformRecord` (called by `createMacPlatform`, `createWindowsPlatform` and `createLinuxPlatform`; `platformFor` only dispatches) writes `serverName: RELAY_SERVER_NAME` beside `username`, `pid` and `launch`. `fakePlatform` (`src/shared/platform.test-support.ts`) calls `platformFor`, so it needs no edit.

Done when: compiles (`npm run lint` and `npm run typecheck`); the test gate runs `src/shared/platform.test.ts`, `src/plugins/sessions/main/mcp/mcp-server.test.ts` and `src/plugins/sessions/main/start.test.ts`; `grep -rn --exclude='*.test.ts' 'claudecode/toolUseId\|wigley-forms' src/plugins/sessions` prints nothing (the test keeps `'claudecode/toolUseId'` as sample `_meta` data).

Commit: one commit. It also removes the "Sessions stops naming Claude" item from `docs/features/followups.md` § Harness seams, and ticks `- [ ] Sessions stops naming Claude` in `docs/features/intent-alignment/master-plan.md` § Lane H.

## Proof

Commit 48bde0c9f · proof: diff read: PlatformRelay.serverName, RELAY_SERVER_NAME, McpServeOptions, 4-arg serveMcp, harnessToolUseId present; no claudecode key left in sessions source; wave compile (typecheck, lint) passes; shared-doc hunks in cb20cd2ff · concerns: harness toolUseIdOf runs inside callTool's try, so a throwing reader gives a tool error result as the old read did
