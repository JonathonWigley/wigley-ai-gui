# 02 — Chat main: sendNow and sent rows

Status: not started
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/contract.ts` · modify `src/plugins/chat/main/chat-sessions.ts` · test `src/plugins/chat/main/chat-sessions.test.ts`
Consumes:  `send(message: UserMessage): string` on `AgentProcess` ← 01 · `messageDropped(entryId: string): void` on `AgentProcessEvents` ← 01
Produces:  `sentEntryId: string | null` on `QueuedMessage` in `src/plugins/chat/contract.ts`
           `sendNow(sessionId: string, queuedId: string): void` on `ChatChannel['invoke']` in `src/plugins/chat/contract.ts`
           `sendNow(sessionId: string, queuedId: string): void` on the chat sessions interface in `src/plugins/chat/main/chat-sessions.ts` (beside `pullBack`), wired to the channel where `pullBack` is
Decisions:
- `QueuedMessage.sentEntryId`: null while the row waits; the id `send` returned once the user sent it now. Comment on the field says so. `queue` creates rows with null.
- `sendNow`: unknown session → log as `pullBack` does; no row with that id, or the row's `sentEntryId` is not null → log `queued message <id> no longer queued`, nothing else. Otherwise `process.send` the row's message; on success set `sentEntryId` and `sendQueued(session)`; a throw leaves the row unsent and logs `queued message <id> not sent: <error>`. The row stays in place in the queue.
- **Held messages**: chat main keeps every message it writes — `deliver`'s idle sends, `writeNextQueued`'s writes and `sendNow`'s — keyed by the entry id `send` returned, until that entry arrives. Idle and next-queued writes are held without a row; send-now writes are the sent row itself.
- `entry` callback: an entry whose `id` (the harness id, before `rowEntryOf`) matches a held message drops the hold, and when a sent row carries that id, drops the row and `sendQueued(session)`.
- `messageDropped(entryId)`: the held message goes back to the box through the `returned` message (as pull-back does), its sent row is dropped, and it logs `sent message <entryId> returned: never taken in`. An id chat holds nothing for is ignored with a log.
- `writeNextQueued` writes the oldest **unsent** row; sent rows are skipped and stay.
- `pullBack` on a sent row: does nothing and logs `queued message <id> already sent`.
- Interrupt: returns every unsent row, oldest first, as today; sent rows stay.
- Process exit (and the clear's process swap, which returns queued messages today): returns every row, sent ones included, plus every held message without a row, oldest write first.
- The queue's persistence across a page reload carries `sentEntryId` with the rest of the row.
- Activity needs no change: the tracker keeps the session working while a sent uuid is open (task 01 leaves it as is).

GIVEN a running turn and two queued rows WHEN `sendNow` runs on the newer one THEN `send` is called with its message, its row stays with `sentEntryId` set, and the older row stays unsent
GIVEN a sent row WHEN the entry with its `sentEntryId` arrives THEN the row is dropped and a `queued` message carries the queue without it
GIVEN a sent row WHEN `messageDropped` fires with its id THEN `returned` carries its message and the row is gone
GIVEN a sent row and an unsent row WHEN the user interrupts THEN `returned` carries only the unsent message and the sent row stays
GIVEN a sent row WHEN the process exits THEN `returned` carries it

Tests:     add rows to the existing pull-back and queue tests in `chat-sessions.test.ts` (search `pullBack` and `queued`) rather than new files. One table test for `sendNow`'s refusals: unknown id, already sent, already written by an idle → each logs `queued message <id> no longer queued` and calls no `send`; one for the throwing write → row unsent, log matches `not sent`. Rows for: entry drops the row; `messageDropped` returns it; interrupt keeps sent rows; exit returns them; `writeNextQueued` skips a sent row; an idle send that is dropped returns to the box. Fakes record `send` calls and return ids the test chose.
Done when: typecheck passes; the tests above pass under vitest filtered to `chat-sessions.test.ts`.
Commit:    one commit for the group

## Proof

