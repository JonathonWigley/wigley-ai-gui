# 01 — Harness seam: entry on take-in, send returns its id

Status: in progress
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/contracts/agent.ts` · modify `src/main/claude-code/claude-code-harness.ts` · modify `src/main/claude-code/turn-tracker.ts` · modify `src/shared/fake-agent-harness.ts` · modify `src/plugins/chat/main/chat-sessions.ts` (stub only) · test `src/main/claude-code/claude-code-harness.test.ts` · test `src/main/claude-code/turn-tracker.test.ts` · test `src/shared/fake-agent-harness.test.ts`
Consumes:  `DecodedLine.lifecycle: { uuid: string; state: string } | null` (tree, `stream-decoder.ts`)
Produces:  `send(message: UserMessage): string` on `AgentProcess` in `src/contracts/agent.ts`
           `messageDropped(entryId: string): void` on `AgentProcessEvents` in `src/contracts/agent.ts`
           `mode(): 'unknown' | 'lifecycle' | 'fallback'` on `TurnTracker` in `src/main/claude-code/turn-tracker.ts` (exports the `TurnMode` type it returns)
Decisions:
- `send` returns the `id` of the user `ChatEntry` the harness will emit for that message, fixed at the call (the Claude adapter's `user-${sendCount}`, the fake's `user-${sentTurn}`). Doc comment on `send`: the entry arrives through `entry` once the agent takes the message in, which may be later than the call, and never before `send` returns; a send during a running turn hands the message to the agent at once, and the agent decides when its turn takes it in; `messageDropped` names an id whose entry will never come, and also arrives only after `send` returns.
- Doc comment on `messageDropped`: the agent let the message go without taking it in; no entry with that id follows.
- `TurnTracker.mode()` returns the mode the tracker already keeps; the tracker's header comment names it. One owner for the rule: the adapter asks the tracker and never reads `capabilities` itself.
- Claude adapter, `send` when `tracker.mode()` is `lifecycle`: write the stdin line at once, then hold the entry draft — and the `userMessage` and `skillStarted` agent events it emits today — keyed by the message's uuid. `tracker.written` and `syncActivity()` stay at the write, unchanged.
- Claude adapter, `send` when the mode is `unknown` or `fallback`: emit at the write, as today. Nothing is ever held outside lifecycle mode; a process's mode is fixed by its first init and never changes after.
- Claude adapter, a `lifecycle` line with state `started` for a held uuid: emit the held entry, then `userMessage`, then `skillStarted` (today's order), and drop the hold. The entry and both events are stamped at the `started` line's time, not the write's.
- Claude adapter, a terminal state (`completed`, `cancelled`, `discarded`, `refused`) for a held uuid with no `started` before it: drop the hold and call `events.messageDropped(entryId)`, **before** the `activity` event that the same line causes (`syncActivity` at the end of line handling). These drop states are unmeasured for a message never started (claude-stream.md § Message lifecycle samples only `cancelled` after a started turn); the test lines are synthetic, built with the file's `lifecycle(uuid, state)` helper.
- Holds survive `tracker.abandon()` (the interrupt grace): a `started` that arrives after an abandon still emits.
- Claude adapter, process end: held drafts are dropped silently, with no entry and no `messageDropped`; chat main returns its own copies (task 02).
- Fake harness: `send` returns `user-${sentTurn}`; its entry timing is unchanged (it takes every message in at once, on a microtask). It never calls `messageDropped`.
- `chat-sessions.ts` `processEvents`: add `messageDropped() {}` with a one-line comment that chat main handles it in task 02, so the tree typechecks at the end of this wave. The test files' `recordingEvents` objects get a recording `messageDropped` too (`grep -rn "AgentProcessEvents" src --include='*.ts'`).

GIVEN a lifecycle-mode process mid-turn WHEN `send` runs THEN the stdin line is written at once and no user entry is emitted until that uuid's `started` line, and the entry's `at` is the `started` line's time
GIVEN a held uuid WHEN its `cancelled`, `discarded` or `refused` line arrives with no `started` before it THEN `messageDropped` fires with the id `send` returned, before the line's activity event, and no entry is emitted
GIVEN a fallback-mode or unknown-mode process WHEN `send` runs THEN the user entry is emitted at the write, as today

Tests:     a new `it.each` in `claude-code-harness.test.ts`, beside `send_WritesUserMessageAndEmitsWorking`, over rows of {mode init (`lifecycleInit` or a fallback init), the send, the lines after it, the expected events in order}. The test clock moves between the write and the line, so `at` is checked. `randomUuid` gives `uuid-1`, `uuid-2` per send. Rows:
           - lifecycle, `started` → nothing at the write; then entry (returned id, `at` of the line), `userMessage`, in that order
           - lifecycle, typed skill text, `started` → `skillStarted` arrives after the entry, nothing at the write
           - lifecycle, `cancelled` / `discarded` / `refused` with no `started` → `messageDropped(returned id)` before the `activity` event, no entry
           - lifecycle, interrupt grace `abandon`, then `started` → entry emitted
           - lifecycle, process ends with a held uuid → no entry, no `messageDropped`
           - fallback → entry at the write
           The existing `send_SlashText_EmitsSkillStarted` table (unknown mode) stays as it is: it pins emit-at-write in unknown mode.
           `turn-tracker.test.ts`: add `mode()` to the existing mode test's assertions (unknown before init, lifecycle or fallback after).
           `fake-agent-harness.test.ts`: in `send_PlainText_StreamsReplyThenResult` (around line 221), assert `send` returns the emitted user entry's id.
Done when: the repo's typecheck passes; the tests above pass under vitest, filtered to the three test files.
Commit:    one commit for the group

## Proof

