# 03 — Main-agent-only tool calls in sessions

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/sessions/contract.ts` · modify `src/plugins/sessions/main/session-list.ts` ·
           modify `src/plugins/sessions/main/start.ts` · modify `src/plugins/sessions/main/consumer-view.ts` ·
           modify `src/plugins/workflow/main/start.ts` · test `src/plugins/sessions/main/session-list.test.ts` ·
           test `src/plugins/sessions/main/start.test.ts` · test `src/plugins/workflow/main/start.test.ts`

Reads:     `AGENTS.md` § Architecture, the bullets "A registration", "A plugin talks" and "An MCP tool" (already
           updated), and the src tree entries `sessions/` and `workflow/`. `docs/features/workflow/design.md` § Signals,
           the paragraph on the tools (already updated).

Consumes:  `ToolCallContext` (`toolUseId: string | null; signal: AbortSignal`) in `src/plugins/sessions/contract.ts`,
           which the tree holds · `textResult(text: string): ToolResult` in the same file, which the tree holds

Produces:  in `src/plugins/sessions/contract.ts`:

```ts
// One tool call, as a tool-call guard sees it. `sessionId` is the app's own id (AgentSession.id).
export interface GuardedToolCall {
  readonly sessionId: string;
  readonly tool: string;
  readonly toolUseId: string | null;
  readonly mainAgentOnly: boolean;
}
export type ToolCallVerdict =
  | { readonly kind: 'run' }
  | { readonly kind: 'skip'; readonly text: string };
export type ToolCallGuard = (call: GuardedToolCall) => Promise<ToolCallVerdict>;
export interface ContributeToolsOptions {
  readonly mainAgentOnly?: boolean;
}
// SessionsMainExports changes to:
contributeTools(
  tools: ToolDefinition[],
  start: (session: AgentSession) => ToolSession,
  options?: ContributeToolsOptions,
): Disposable;
addToolCallGuard(guard: ToolCallGuard): Disposable;
```

Decisions:
- Sessions keeps the main-agent-only flag per tool name, in a `toolFlags: Map<string, boolean>` beside `toolNames` in
  `session-list.ts`. `contributeTools` sets an entry for each of its tools; `withdrawContribution` deletes the entry
  where it deletes the name from `toolNames`. `routeCall` gains no parameter: it reads the flag from `toolFlags`
  (missing reads false). A contribution with `{ mainAgentOnly: true }` marks each of its
  tools. A contribution with no options, or with `mainAgentOnly` absent or false, marks none. Disposing the
  contribution removes its marks with its tool names (design review).
- Sessions names no plugin and no tool. It only carries the flag to the guards (plan.md § Boundary rules).
- `addToolCallGuard` follows `addCloseGuard`: each call is its own registration, held as its own object, so one
  function added twice is asked twice until both handles are disposed. A second `dispose` does nothing.
- The routing order for a call, in `routeCall` (`session-list.ts`):
  1. An unknown tool name rejects with today's `Unknown tool:` error. No guard is asked.
  2. Sessions asks each guard in registration order, one at a time, and awaits each answer before it asks the next.
     The call it gives each guard is `{ sessionId: entry.session.id, tool: name, toolUseId: context.toolUseId,
     mainAgentOnly: <the flag of name> }`.
  3. The first `skip` wins. The call resolves `textResult(verdict.text)`, which is a success, not an error result. The
     handler does not run, and no later guard is asked.
  4. When every guard answers `run`, sessions reads the tool's route again and calls the handler as today. A tool whose
     contribution was disposed while the guards answered rejects with the `Unknown tool:` error. The call also rejects,
     with the handler not run, when the session left `entries` while the guards answered (`Session ended`), or when
     `context.signal` aborted (its abort reason). The guard wait is new, so these checks are new too.
  5. A guard that rejects makes the call reject with that error. The handler does not run, and no later guard is asked.
- Every guard sees every call, whether or not the tool is main-agent-only. The guard decides from `mainAgentOnly`.
- A guard disposed while a call awaits it still decides that call. A later call does not ask it.
- The guards hold for connected and owned sessions alike, and for a relay joined to an owned session: every call path
  goes through `routeCall`.
- `endpoint.json` and `tools.json` do not change: the flag is not written to them.
- `SessionList` inherits `addToolCallGuard` and the new `contributeTools` signature through
  `Omit<SessionsMainExports, …>`. `start.ts` passes `options` through to `list.contributeTools` and adds
  `addToolCallGuard: (guard) => list.addToolCallGuard(guard)` to the exports.
- `consumer-view.ts` files the guard: `addToolCallGuard: (guard) => consumer.track(exports.addToolCallGuard(guard))`.
  It passes `options` through in `contributeTools` (AGENTS.md "A registration").
- Sessions contributes its own `set_session_title` with `{ mainAgentOnly: true }` (`start.ts`, the
  `exports.contributeTools([SET_SESSION_TITLE_TOOL], …)` call).
- The workflow engine contributes `set_workflow_checklist` with `{ mainAgentOnly: true }` (`workflow/main/start.ts`, the
  `sessions.contributeTools([checklistToolDefinition()], …)` call) and `set_workflow_step` with
  `{ mainAgentOnly: true }` (the call inside `contributeStepTool`, so each new contribution of the step tool keeps the
  flag).
- The three tool factories (`startTitleTool`, `startStepTool`, `startChecklistTool`) do not change: the guard acts
  before they run.
- Test fakes that cast to `SessionsMainExports` (`as unknown as`) need no new member. A typed fake whose test now reads
  the options (`workflow/main/start.test.ts`, the `sessions` fake near line 137) records the third argument.
- Update the doc comments on `SessionsMainExports.contributeTools` and on the new `addToolCallGuard` to say what the
  flag and the guards do, in the words of the decisions above.

GIVEN a session with tool `a` contributed main-agent-only and one guard that answers `skip` with `no change` WHEN the
agent calls `a` with tool-use id `t1` THEN the call resolves `{ content: [{ type: 'text', text: 'no change' }] }` with no
`isError`, the handler records no call, and the guard got `{ sessionId: <row id>, tool: 'a', toolUseId: 't1',
mainAgentOnly: true }`.
GIVEN two guards, the first answering `run` and the second `skip` WHEN a call comes THEN both are asked, first to
second, and the result is the second guard's text.
GIVEN two guards, the first answering `skip` WHEN a call comes THEN the second guard is not asked.
GIVEN a guard that rejects WHEN a call comes THEN the call rejects with that error and the handler records no call.
GIVEN a disposed guard WHEN a call comes THEN it is not asked.
GIVEN a guard WHEN the agent calls a tool no contribution holds THEN the call rejects with the `Unknown tool:` error and
the guard is not asked.
GIVEN the sessions part started WHEN a guard registered through the exports sees a call of `set_session_title` THEN
`mainAgentOnly` is true.
GIVEN the workflow part started WHEN it contributes the checklist tool and the step tool THEN each contribution carries
`{ mainAgentOnly: true }`, and the step tool's contribution again after a stage is added carries it too.

Tests:
- `session-list.test.ts`, new `it.each` `routeCall_ToolCallGuards_$case`, one row per verdict case: no guard → the
  handler's result; one `skip` → the skip text as success, handler not called; `run` then `skip` → skip text, both asked
  in order; `skip` first → second not asked; a guard rejects → the call rejects with its error, handler not called; a
  disposed guard → not asked, handler's result; the contribution disposed during a guard's await → `Unknown tool:`,
  handler not called; a guard disposed during its own await → its answer still decides the call; the session ended
  during a guard's await → rejects `Session ended`; the signal aborted during a guard's await → rejects, handler not
  called; one guard added twice → asked twice. Each row asserts the result, the handler's calls and the guards' asked
  order. Break caught: a guard skipped, a skip read as an error result, guards asked out of order or all asked after a
  skip, a rejection swallowed.
- `session-list.test.ts`, new `it.each` `routeCall_GuardSeesTheCall_$case`: a contribution with
  `{ mainAgentOnly: true }` → `mainAgentOnly: true`; one with no options → false; a tool contributed main-agent-only, disposed, then contributed again with no options →
  false; a tool-use id `t1` and a null id are
  passed through as given; the session id is the row's app id. Break caught: the flag lost per tool name, or the
  wrong context passed.
- `session-list.test.ts`, existing `rejects a call to a tool no contribution holds`: add a guard and assert it was not
  asked.
- `sessions/main/start.test.ts`, existing `contributes set_session_title once, titling the calling session at the
  setting limit`: add a guard through the exports and assert its call for `set_session_title` has
  `mainAgentOnly: true`. Break caught: the title tool contributed without the flag.
- `sessions/main/start.test.ts`, existing `disposes what a dependent registered through its view when its registrations
  dispose`: add a guard through the view; after the registrations dispose, a call does not ask it. Break caught: the
  view does not file the guard.
- `workflow/main/start.test.ts`, existing `Start_ContributesBothTools` and
  `stepTool_StageAddedByAPlugin_JoinsTheToolUntilDisposed`: assert each recorded contribution's options are
  `{ mainAgentOnly: true }`. Break caught: a workflow tool contributed without the flag, or the step tool's
  re-contribution dropping it.

Done when: the code compiles; the test gate runs the tests above. The live check is task 10's check 4, "A subagent's
step report changes nothing".
Commit:    one commit for the group

## Proof

