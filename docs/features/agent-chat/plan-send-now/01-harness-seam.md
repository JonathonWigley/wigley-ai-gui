# 01 — Harness seam: entry on take-in, send returns its id

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/contracts/agent.ts` · modify `src/main/claude-code/claude-code-harness.ts` · modify `src/shared/fake-agent-harness.ts` · test `src/main/claude-code/claude-code-harness.test.ts` · test `src/shared/fake-agent-harness.test.ts`
Consumes:  `DecodedLine.lifecycle: { uuid: string; state: string } | null` (tree, `stream-decoder.ts`) · `TurnTracker` (tree, `turn-tracker.ts`, unchanged)
Produces:  `send(message: UserMessage): string` on `AgentProcess` in `src/contracts/agent.ts`
           `messageDropped(entryId: string): void` on `AgentProcessEvents` in `src/contracts/agent.ts`
Decisions:
- `send` returns the `id` of the user `ChatEntry` the harness will emit for that message, fixed at the call (the Claude adapter's `user-${sendCount}`, the fake's `user-${sentTurn}`). Doc comment on `send`: the entry arrives through `entry` once the agent takes the message in, which may be later than the call; a send during a running turn hands the message to the agent at once and the agent decides when its turn takes it in; `messageDropped` names an id whose entry will never come.
- Doc comment on `messageDropped`: the agent let the message go without taking it in; no entry with that id follows.
- Claude adapter, lifecycle mode (the tracker's mode, fixed by the first init): `send` writes the stdin line at once and holds the entry draft — and the `userMessage` and `skillStarted` agent events it emits today — keyed by the message's uuid. A `lifecycle` line with state `started` for a held uuid emits them, in today's order, and drops the hold. A terminal state (`completed`, `cancelled`, `discarded`, `refused`) for a held uuid with no `started` before it drops the hold and calls `events.messageDropped(entryId)`.
- Claude adapter, before the mode is known and in fallback mode: emit at the write, as today. A message held when the mode turns out `fallback` is emitted at once.
- Claude adapter, process end: held drafts are dropped silently; chat main returns its own copies (task 02).
- `syncActivity()` and `tracker.written` stay at the write, unchanged.
- Fake harness: `send` returns `user-${sentTurn}`; its entry timing is unchanged (it takes every message in at once). It never calls `messageDropped`.
- Every other `AgentProcessEvents` implementer in the tree gets a `messageDropped` member — find them with `grep -rn "AgentProcessEvents" src --include='*.ts'`.

GIVEN a lifecycle-mode process mid-turn WHEN `send` runs THEN the stdin line is written at once and no user entry is emitted until that uuid's `started` line
GIVEN a held uuid WHEN its `cancelled` line arrives with no `started` before it THEN `messageDropped` fires with the id `send` returned, and no entry is emitted
GIVEN a fallback-mode process WHEN `send` runs THEN the user entry is emitted at the write, as today

Tests:     add rows to the existing harness test that owns the user entry on send (search `kind: 'user'` in `claude-code-harness.test.ts`), as a table over the three cases above: lifecycle `started` → entry with the returned id after the line; `cancelled` / `discarded` / `refused` with no `started` → `messageDropped(returned id)` and no entry; fallback init → entry at the write. One row: a `skillStarted` event for a typed skill arrives with the entry, not at the write.
           fake harness: one assertion in an existing send test that `send` returns the emitted entry's id.
Done when: `npm run typecheck` (or the repo's tsc script) passes; the tests above pass under vitest, filtered to the two test files.
Commit:    one commit for the group

## Proof

