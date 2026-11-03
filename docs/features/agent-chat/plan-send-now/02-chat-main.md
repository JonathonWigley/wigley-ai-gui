# 02 — Chat main: sendNow, sendAllNow and sent rows

Status: done
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/contract.ts` · modify `src/plugins/chat/main/chat-sessions.ts` · modify `src/plugins/chat/main/start.ts` · test `src/plugins/chat/main/chat-sessions.test.ts` · test `src/plugins/chat/main/start.test.ts`
Consumes:  `send(message: UserMessage): string` on `AgentProcess` ← 01 · `messageDropped(entryId: string): void` on `AgentProcessEvents` ← 01
Produces:  `sentEntryId: string | null` on `QueuedMessage` in `src/plugins/chat/contract.ts`
           `sendNow(sessionId: string, queuedId: string): void` on `ChatChannel['invoke']` in `src/plugins/chat/contract.ts`
           `sendNow(sessionId: string, queuedId: string): void` on the chat sessions interface in `src/plugins/chat/main/chat-sessions.ts`, beside `pullBack`
           `api.channel.handle('sendNow', …)` in `src/plugins/chat/main/start.ts`, through `ignoredInPreview('sendNow', sessionId)` as `pullBack` is
           `sendAllNow(sessionId: string, message: <the message type the channel's send takes> | null): void` on `ChatChannel['invoke']` in `src/plugins/chat/contract.ts`
           `sendAllNow(sessionId, message)` on the chat sessions interface in `src/plugins/chat/main/chat-sessions.ts`, beside `sendNow`
           `api.channel.handle('sendAllNow', …)` in `src/plugins/chat/main/start.ts`, through `ignoredInPreview('sendAllNow', sessionId)`
Decisions:
- `QueuedMessage.sentEntryId`: null while the row waits; the id `send` returned once the user sent it now. `queue` creates rows with null.
- `deliver` returns the entry id `process.send` returned. Each caller records what it wrote: the idle send and `writeNextQueued` record a **held message** (no row); `sendNow` sets the row's `sentEntryId`. `sendNow` does not repeat `deliver`'s first-message work (`sent`, the first-message title, `save()`): a queued row exists only after a message was already sent.
- **Held messages**: a map per session from entry id (the harness id, before `rowEntryOf`) to the message written, in write order, kept until that entry arrives. It is emptied at exit and at the clear's process swap, since harness ids (`user-1`) restart per process.
- `sendNow`: unknown session → log as `pullBack` does; no row with that id, or the row's `sentEntryId` is not null → log `queued message <id> no longer queued` and nothing else. Otherwise deliver the row's message; on success set `sentEntryId` and `sendQueued(session)`; a throw leaves the row unsent and logs `queued message <id> not sent: <error>`. The row keeps its place in the queue.
- `entry` callback, only when `isLive`: an entry whose harness id matches a held message or a sent row drops it. For a sent row it then sends `queued` (the queue without the row), and nothing else.
- `messageDropped(entryId)`, only when `isLive`:
  - a sent row: drop the row, `sendQueued`, then `returned` with its message (pull-back's order); log `sent message <entryId> returned: never taken in`
  - a held message with no row: `returned` with it, no `queued`; same log
  - an id chat holds nothing for: log `dropped message <entryId> not held` and nothing else
- `sendAllNow` (Cmd+Enter in the box; user decision, round 3): unknown session → log as `pullBack` does. With no running turn (the check `send` uses to decide whether to queue), a non-null message goes through `send`'s own path unchanged, so it behaves exactly as Enter; a null message does nothing. With a running turn: deliver every unsent row, oldest first, setting each one's `sentEntryId`; then, when the message is not null, append it as a new row (as `queue` creates one) and deliver it the same way, so it reads `sending` and sits last, in the order written. A throw stops there: that row and every row after it stay unsent (the box message stays as an unsent row), logged `queued message <id> not sent: <error>`. One `sendQueued(session)` at the end whenever any row changed. Nothing to send (no unsent rows, null message) → log `nothing to send now in <session>`.
- `writeNextQueued` takes the oldest **unsent** row. On a throw it goes back at its original index, so sent rows keep their places.
- `pullBack` on a sent row: nothing, and log `queued message <id> already sent`.
- Interrupt: returns every unsent row, oldest first, as today; sent rows stay.
- Exit and the clear's process swap share one return helper (it replaces `returnAllQueued`). It sends one `returned` whose `messages` are the held messages with no row, in write order, then every row, sent and unsent, in queue order. It sends that `returned` whenever the list is not empty, even with an empty queue. Then it empties the queue and the held messages.
- The queue's persistence across a page reload already carries `sentEntryId` through `copyState`.
- Update, in the same edit, the comments the change makes false. In `chat-sessions.ts`: the interface comments on `send`, `interrupt`, `clear` and `pullBack`, and the comments on `returnAllQueued` (or its replacement) and `writeNextQueued`. In `contract.ts`: the `QueuedMessage` comment, and the channel comments on `send`, `interrupt`, `clear` and `pullBack`; `sendNow` and `sendAllNow` get their own.

GIVEN a running turn and two queued rows WHEN `sendNow` runs on the newer one THEN `send` is called with its message, its row stays with `sentEntryId` set, and the older row stays unsent
GIVEN a running turn, two unsent rows and a box message WHEN `sendAllNow` runs THEN `send` is called three times — the older row, the newer row, the box message — all three rows carry `sentEntryId`, and one `queued` is sent
GIVEN no running turn WHEN `sendAllNow` runs with a message THEN it is sent exactly as `send` sends it
GIVEN a sent row WHEN the entry with its `sentEntryId` arrives THEN the row is dropped and one `queued` carries the queue without it
GIVEN a sent row WHEN `messageDropped` fires with its id THEN `queued` (without it) then `returned` (its message) are sent
GIVEN a sent row WHEN `pullBack` names it THEN nothing is sent and the log reads `queued message <id> already sent`
GIVEN a sent row and an unsent row WHEN the user interrupts THEN `returned` carries only the unsent message and the sent row stays
GIVEN an idle send not yet taken in and one sent row WHEN the process exits THEN one `returned` carries the idle send's message, then the sent row's

Tests:     extend the existing queue, pull-back, interrupt and exit tests in `chat-sessions.test.ts` (search `pullBack`, `queued`, `returned`) with rows rather than new files. The fake from 01 returns `user-<turn>` and emits that entry on a microtask. So a test reads a sent row's id from `sessions()[0].queued[n].sentEntryId` (an idle send's is `user-<turn>`), and fires `test.process.events.messageDropped(id)` or asserts the exit and interrupt rows **before** any `flush()`. A test that needs the entry later calls `process.events.entry({ kind: 'user', id, … })` itself. Rows:
           - `sendNow` refusals, one table: unknown id, already sent, already written at an idle → each logs `queued message <id> no longer queued` and calls no `send`
           - `sendNow` whose write throws → row unsent, log matches `not sent`
           - entry drops a sent row (one `queued`, no `returned`)
           - `messageDropped` on a sent row (`queued` then `returned`); on a held idle send (`returned` only); on an unknown id (log only)
           - `pullBack` on a sent row (log `already sent`, nothing sent)
           - interrupt keeps sent rows
           - exit returns held, then rows, in that order; with an empty queue and one held message it still returns it
           - clear's swap returns sent and held messages the same way
           - `writeNextQueued` skips a sent row ahead of it; on its throw, the unsent row goes back at its index
           - after a clear, an old process's `entry` or `messageDropped` changes nothing
           - `sendAllNow`, one table: idle with a message (as `send`); running with two rows and a message (three sends in written order, one `queued`); running with a null message (rows only); running with nothing unsent and null (log `nothing to send now`); the second write throws (that row and the box row stay unsent, log `not sent`)
           `start.test.ts`: add `{ method: 'sendNow', args: ['queued-1'] }` and a `sendAllNow` row to the preview-ignored table beside `pullBack`.
Done when: the repo's typecheck passes; the tests above pass under vitest, filtered to `chat-sessions.test.ts` and `start.test.ts`.
Commit:    one commit for the group

## Proof

Commit f9ab864e · proof: diff read: sentEntryId on QueuedMessage, sendNow and sendAllNow on ChatChannel invoke and ChatSessions, both start.ts handlers via ignoredInPreview present; whole-tree tsc clean; worker's chat-sessions and start tests pass (195) · concerns: worker ran npx prettier (downloaded to ~/.npm/_npx/b388654678d519d9, hard-gate breach, reported to user) then restored formatting with the repo's oxfmt; sentEntryId: null added to fakes in page/entry-list.test.ts and page/chat-commands.test.ts (03's files); start.ts SESSION_TITLE_INSTRUCTION line not oxfmt-clean at HEAD either
