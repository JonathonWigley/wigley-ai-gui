# 01 — Chat main queue and the channel

Status: in progress
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/contract.ts` · modify `src/plugins/chat/main/chat-sessions.ts` · test `src/plugins/chat/main/chat-sessions.test.ts` · modify `src/plugins/chat/main/start.ts` · modify `src/plugins/chat/main/preview/chat-preview.ts` and every other `ChatSessionState` literal the compiler names, main and page (`chat-view.ts`, `composer-kit.test.ts`, `composer-input.test.ts`, `chat-commands.test.ts`, `layouts/default/layout.test.ts`, `chat-preview.test.ts` at plan time), each given `queued: []`
Consumes:  `UserMessage` from `src/contracts/agent.ts` (in the tree)
Produces:  in `src/plugins/chat/contract.ts`:
           `export interface QueuedMessage extends UserMessage { id: string }` — doc comment: a message sent while its session's turn ran, held by chat main until the turn ends; `id` is unique within its session
           `ChatSessionState.queued: QueuedMessage[]` — oldest first; [] while nothing waits
           `ChatChannel.invoke.pullBack(sessionId: string, queuedId: string): void`
           `ChatChannel.messages.queued: { sessionId: string; queued: QueuedMessage[] }` — replaces the session's whole queue
           `ChatChannel.messages.returned: { sessionId: string; messages: UserMessage[] }` — oldest first, for the page to put back into the box
           in `src/plugins/chat/main/chat-sessions.ts`, on the object `createChatSessions` returns (the interface beside `send` and `interrupt`, near line 105):
           `pullBack(sessionId: string, queuedId: string): void`
Decisions: queue when `session.state.running && session.state.activity !== 'idle'` (plan.md § Decisions); a resting or idle session sends as today
           the queue lives in `session.state.queued` alone (one source of truth; `copyState` carries it to `sessions()`); `HeldSession` gains only `queuedCount: number`; ids are `queued-<n>`, `n` counting from 1 per row
           queueing sends `queued`, logs `queued a message in session <sessionId>` (not pinned: the self-test waits on the page's line, 03), and does not call `process.send`
           in `processEvents.activity`: an `idle` report while `queued` is non-empty shifts the oldest, sends `queued`, and writes it through `deliver` with `{ text, images }` only (no `id` reaches the harness); `harnessActivity` and `updateActivity` are left alone for that report (plan.md § Decisions, the drain)
           the drain's write is guarded: the Claude harness reports `idle` before `ended` when its process closes mid-turn, and `send` then throws (`requireRunning`). When `deliver` throws, the message goes back to the head of the queue, the error is logged (`queued message <id> not sent: <error>`), and the report is handled as a normal idle (`harnessActivity = 'idle'`, `updateActivity`), so the `ended` that follows returns every message
           `pullBack`: an id not in the queue logs `queued message <id> already sent` and sends nothing; otherwise removes it, sends `queued`, then `returned` with that one message; a session chat does not hold logs as other methods do
           one private helper returns every queued message: empties the queue, sends `queued` with [] and `returned` with all of them oldest first; nothing is sent when the queue is already empty. `interrupt` calls it before `process.interrupt()`, whether or not the process is working; `ended` calls it for a live process before the exit notice
           `interrupt` today goes through `liveFor`, which returns null for a resting session; a resting session's queue is always empty, so that stays
           `drop` (row closed) discards the queue with no message
           `copyState` copies `queued`; `startNew` and every restore start it at []
           `start.ts` handles `pullBack` the way it handles `interrupt`, ignored in the preview session (`ignoredInPreview`)
           `ChatChannel.invoke.interrupt`'s and `send`'s doc comments in the contract say what they now do: `send` queues while a turn runs; `interrupt` returns every queued message first
GIVEN a running session whose harness reports `working` WHEN two messages are sent THEN the process receives neither, `queued` lists both oldest first, and `state.queued` holds them
GIVEN two queued messages WHEN the harness reports `idle` THEN the process receives the first, `queued` lists the second, no `activity: idle` message is sent and no turn-finished alert fires; WHEN it reports `idle` again THEN the second is written; WHEN it reports `idle` a third time THEN the session shows idle and the alert fires as today
GIVEN two queued messages WHEN `pullBack` names the second THEN `returned` carries it alone and `queued` lists the first; WHEN `pullBack` names an id already written THEN nothing is sent and the log reads `queued message <id> already sent`
GIVEN two queued messages WHEN `interrupt` runs THEN `returned` carries both oldest first, `queued` is [], and the process's `interrupt` is called
GIVEN two queued messages WHEN the process ends THEN `returned` carries both oldest first before the session rests, and a later start writes neither; GIVEN the fake reports `idle` after its process ended (its `send` throws then) WHEN `ended` follows THEN `returned` still carries both
Tests:     add to `chat-sessions.test.ts`, beside the existing send and interrupt tests, using its fake process: one test per GIVEN above (queue while working; drain on idle with the hidden idle and the single alert — the window unfocused first, as `turnFinished_unfocused_alertsAndMarks` does, asserting zero alerts after the first two idles and one after the third; pull-back including the already-sent row; interrupt returns all; exit returns all, with a row for the idle-after-ended order). Assert on the channel messages and the fake process's received sends, by the values the test wrote. The existing idle-send test keeps proving a send while idle writes at once
Done when: compiles; `npm run lint` passes; the test gate runs the tests above
Commit:    one commit for the group

## Proof
