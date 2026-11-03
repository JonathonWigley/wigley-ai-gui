# 03 — Harness tracks turns by uuid

Status: not started
Type: Task
Wave: 3 · Depends on: 01, 02
Plan: [plan.md](plan.md)

Files:     modify `src/main/claude-code/claude-code-harness.ts` · modify `src/main/claude-code/claude-controls.ts` ·
           modify `src/main/main.ts` · modify `src/contracts/agent.ts` (a doc comment) · test `src/main/claude-code/claude-code-harness.test.ts` ·
           test `src/main/claude-code/claude-controls.test.ts`
Consumes:  `createTurnTracker`, `TurnTracker` (its `abandon` included), `ControlCommand` ← 02; the five `DecodedLine` fields ← 01;
           `RandomUuid` from `src/contracts/ambient.ts` (in the tree)
Produces:  `ClaudeCodeHarnessDeps.randomUuid: RandomUuid` in `src/main/claude-code/claude-code-harness.ts`
           `export function userMessage(message: UserMessage, uuid: string): object` in `src/main/claude-code/claude-controls.ts`
           `export function controlMessage(id: ClaudeControlId, value: string, lineId: string): object` in the same file
Decisions: uuid on every stdin user message (round 1) · `randomUuid` injected (Decided) · activity emitted only on
           change (Decided) · plain interrupt plus `interruptAnswered` (Decided) · fallback log and notice (Decided) ·
           Ctrl+C always ends working: 5 s grace, second press kills (round 2) · every local slash command gets a uuid
           like any message: `/status`, `/mcp`, `/context` and `/compact` were measured with uuids at plan time and
           take a message's own-turn shape (claude-stream.md § Message lifecycle)

## Changes

`claude-controls.ts`:

- `userMessage(message, uuid)` adds `uuid` to the line, after `parent_tool_use_id`. Doc comment names the uuid's
  purpose in one clause (Claude reports the message's lifecycle by it).
- `controlMessage(id, value, lineId)`: mode puts `lineId` in `request_id` as now; effort and model return
  `userMessage({ text: \`/${id} ${value}\`, images: [] }, lineId)`. Doc comment states what `lineId` is per id.

`claude-code-harness.ts`, `startClaudeProcess`:

- `ClaudeCodeHarnessDeps` gets `randomUuid: RandomUuid`; the deps doc comment gets one clause: `randomUuid` gives each
  stdin user message its `uuid`.
- Delete the local `ControlCommand` and `pendingTurns` (and its comment); import `ControlCommand` and
  `createTurnTracker` from `./turn-tracker`. `const tracker = createTurnTracker();`.
- Rename `setActivity(next)` to `emitActivity(next)`: it sets `activity` and emits unconditionally. Only the start
  (today's `setActivity('idle')` after `emitControls()`) and the child's `close` handler (idle when `activity` is
  `working`; it replaces `pendingTurns.length = 0`) call it. Add `syncActivity()`: it returns at once when
  `hasClosed`, so a stdout line read after `close` emits nothing after `ended`; else it reads `tracker.activity()`,
  and when that differs from `activity` it calls `emitActivity`; when the result is `idle` it also clears the
  interrupt grace timer (below).
- `handleLine`: call `const turn = tracker.read(decoded)` first; `command` is `turn.command` (replaces the
  `answersSend`/`pendingTurns.shift()` lines). When `turn.fellBack`, after the `decoded.entries` loop (so the notice
  follows the init's events entry), log `claude` `msg_lifecycle_v1 missing from init capabilities; tracking turns by results` and post
  `harnessNotice('This Claude Code version reports no message lifecycle; the working state follows turn results only.', 'info', line)`
  — the notice's raw is the stdout `line` string as read. Replace the
  closing `if (decoded.turnEnded && pendingTurns.length === 0) setActivity('idle')` with `syncActivity()`. The rest
  of `handleLine` (hidden command result entry, control value on success, context usage request) stays.
- `answerControlResponse`, interrupt branch: call `tracker.interruptAnswered()` and then `syncActivity()`, on success
  and on error (the error notice stays).
- `send`: `const uuid = deps.randomUuid();` `userMessage(userInput, uuid)`; replace `pendingTurns.push(...)` and
  `setActivity('working')` with `tracker.written(uuid, <typed command or null>)` and `syncActivity()`.
- `setControl` for effort and model: `const uuid = deps.randomUuid();` `controlMessage(control.id, value, uuid)`;
  `tracker.written(uuid, { id: control.id, value })`; `syncActivity()`. Delete the comment "A slash command carries no
  request id." The `activity === 'working'` throw stays.
- `interrupt()` keeps its `activity !== 'working'` early return. Then:
  - When the grace timer is pending (an earlier interrupt is unanswered and the session still works): post
    `harnessNotice('Interrupted again; ending the Claude process.', 'info', null)`, log `claude`
    `second interrupt while working; killing the process`, and call this process's `kill()`. Write no second
    interrupt request. Chat main's `ended` handler rests the row, unchanged.
  - Else: write the same plain interrupt request and post the `Interrupted` notice as now, and start the grace timer:
    `const INTERRUPT_GRACE_MS = 5000;` beside `END_GRACE_MS`, a `setTimeout` pushed to `timers` (so `markClosed`
    clears it) and held in `let graceTimer: ReturnType<typeof setTimeout> | null`. `syncActivity` reaching idle
    clears it and sets it to null.
  - When the timer fires and `activity` is still `working`: `tracker.abandon()`, post
    `harnessNotice('Claude did not stop within 5 s; showing the session idle.', 'info', null)`, log `claude`
    `interrupt unanswered after 5 s; dropping turn state`, set `graceTimer` to null, `syncActivity()`.
- `src/contracts/agent.ts`, the comment above `AgentProcess`: add that `interrupt` always ends working — an adapter
  shows idle within a grace period whatever the agent answers, and a second `interrupt` while still working ends the
  process. The fake harness answers each interrupt at once, so it needs no change.
- Rewrite the comment above `handleLine` if any of it no longer holds.

`src/main/main.ts`, `claudeHarness`: pass the module-level `randomUuid` in the deps object, beside `clock`. It is
declared below `claudeHarness` but initialized before any call: both call sites (`liveServices().forWindow` and the
drive's harness picker) run after module load, as `clock` and `files` already do.

## Tests

`claude-code-harness.test.ts`:

- `started(...)` deps: `randomUuid` returns `uuid-1`, `uuid-2`, … in call order (a counter inside `started`).
- Add helpers: `lifecycleInit` (a `system/init` with `capabilities: ['msg_lifecycle_v1']`), `lifecycle(uuid, state)`
  (a `command_lifecycle` line), and an optional `uuids` argument on `successResult` that sets `user_message_uuid` to
  the first and `user_message_uuids` to all.
- `send_WritesUserMessageAndEmitsWorking`: expect `userMessage({ text: 'hi', images: [] }, 'uuid-1')`.
- `setControl_Effort_SetsValueOnCommandResult`: expect `controlMessage('effort', 'high', 'uuid-1')`.
- `send_TwoMessages_StaysWorkingUntilTheSecondResult`, `send_ControlCommandQueuedBehindTurn_TakesItsOwnResult`,
  `interrupt_WhileQueuedTurnRuns_WritesRequest`: run in lifecycle mode — a `lifecycleInit` before each result and each
  result carrying its message's uuid; assertions stay.
- `send_UnrequestedResultWhileCommandPending_CommandTakesItsOwnResult` (`it.each` over `peer` and
  `task-notification`): run in lifecycle mode — init, the unrequested result with no uuid keys (still working,
  effort null), then init and the command's result naming `uuid-1` (effort high, idle).
- `send_EffortValueNotAChoice_LeavesEffortUnknown`, `interrupt_AfterErrorResult_UsesDistinctNoticeIds`: check they
  still pass in unknown mode; change only what the new uuid argument forces.
- New `activity_MessageFoldedIntoClaudesOwnTurn_EndsIdle` — the regression for the bug, `it.each` over two rows:
  - lifecycle: send `'one'` (`uuid-1`); `lifecycleInit`; `successResult('1', ['uuid-1'])` → `idle`. Send `'two'`
    (`uuid-2`); `lifecycleInit` (Claude's own turn starts); `lifecycle('uuid-2', 'queued')`, `'started'`,
    `'completed'`; a result with `origin: { kind: 'task-notification' }` and no uuid keys → last activity `idle`.
  - fallback: the same lines with inits that carry no `capabilities` and no `command_lifecycle` lines → last
    activity `idle`.
- New `activity_ClaudesOwnTurn_ShowsWorkingThenIdle`: nothing sent; `lifecycleInit` → last activity `working`; result
  with `origin: { kind: 'task-notification' }` → `idle`.
- New `interrupt_Answered_EndsIdleOnlyWhenNoTurnIsOpen` — `it.each`; the interrupt's request id is `wigley-2`
  (`wigley-1` is the start's context-usage request). Rows:
  - no turn, success: unknown mode, send `'one'`, interrupt, control response success with
    `response: { still_queued: [] }` → last activity `idle`
  - no turn, error: the same with an error control response → last activity `idle`, and the `Could not interrupt`
    notice is posted
  - turn open: `lifecycleInit`, send `'one'`, interrupt, success response → last activity still `working`; then
    `errorResult` → `idle`
- New `interrupt_UnansweredForTheGrace_ShowsIdleWithNotice` (fake timers): send `'one'`, interrupt, advance
  `INTERRUPT_GRACE_MS` (5000 ms) with no line written → last activity `idle` and a notice with text
  `Claude did not stop within 5 s; showing the session idle.`; a second row advances 4999 ms → still `working`.
- New `interrupt_AnsweredWithinTheGrace_PostsNoGraceNotice` (fake timers): send, interrupt, `errorResult`, advance
  5000 ms → no grace notice, and `activity` was emitted `idle` once.
- New `interrupt_SecondWhileWorking_KillsTheProcess` (fake timers): send `'one'`, interrupt, interrupt again before
  5000 ms → `fake.child.kill` called with `SIGTERM`, the `Interrupted again; ending the Claude process.` notice is
  posted, and only one interrupt request was written. A second row: interrupt, `errorResult` (idle), send `'two'`,
  interrupt → no kill (the first interrupt was answered).
- New `activity_RepeatedWorkingLines_EmitsOnlyChanges`: send, `lifecycleInit`, `lifecycle('uuid-1', 'started')` →
  exactly one `['activity', 'working']` after the send.
- New `start_InitWithoutLifecycleCapability_PostsOneNotice`: two inits without `capabilities` → one notice with the
  pinned copy, and `logged` holds `['claude', 'msg_lifecycle_v1 missing from init capabilities; tracking turns by results']`
  exactly once (filter by that text: stderr also logs under `claude`).
- New `activity_LineAfterClose_EmitsNothingAfterEnded`: send, close the child, then write `lifecycleInit` to stdout →
  no `activity` emission follows `ended`.

`claude-controls.test.ts`:

- `controlMessage_Effort_IsSlashCommand`: `controlMessage('effort', 'high', 'u-1')` carries `uuid: 'u-1'`.
- `controlMessage_Mode_IsControlRequest`: unchanged.
- `userMessage_TextOnly_PlainStringContent` and `userMessage_WithImages_ImageBlocksThenText`: pass a uuid; the
  expected line carries it. `userMessage_ImagesNoText_OmitsTextBlock`: pass a uuid.

Done when: `npm run typecheck` and `npm run lint` pass; the test gate runs the tests above and every test in
`claude-code-harness.test.ts` and `claude-controls.test.ts`. Runtime checks defer to
[05 — Final verification](05-final-verification.md).
Commit:    one commit for the group

## Proof

<written by wigley:make: commit sha, proof result, concerns; empty until the group lands>
