# 01 — Delivery state in the fold

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/contracts/agent.ts` · modify `src/main/claude-code/stream-decoder.ts` · modify `src/main/claude-code/session-fold.ts` · modify `src/main/claude-code/transcripts.ts` · modify `src/plugins/chat/main/preview/preview-session.ts` · modify `src/shared/fake-agent-harness.ts` · test `src/main/claude-code/stream-decoder.test.ts` · test `src/main/claude-code/session-fold.test.ts` · modify every test fixture the compiler names
Consumes:  `HeldMessage`, `pushUserMessage`, `releaseHeldMessage`, `foldProcessClosed` in `session-fold.ts` (in the tree)
Produces:  `export type UserDelivery = 'sent' | 'received' | 'notReceived'` in `src/contracts/agent.ts`
           `delivery: UserDelivery | null` on the `kind: 'user'` member of `ChatEntry` in `src/contracts/agent.ts`
           `requestedMessages: string[]` and `responseStarted: boolean` on `DecodedLine` in `stream-decoder.ts`

Decisions:

- `requestedMessages` holds `user_message_uuids` of a `system/status` line with `status` `requesting` and no string `parent_tool_use_id`. It is `[]` on every other line.
- `responseStarted` is true on a `stream_event` whose inner type is `message_start` and that has no string `parent_tool_use_id`. It is false on every other line. It does not change what `decodeStreamEvent` does with `currentMessage`.
- The fold state gets a map from message uuid to an awaiting record: the message's sent draft and `isRequested`. The map keeps write order.
- `releaseHeldMessage` on `started` pushes the draft with `delivery: 'sent'` and adds the awaiting record. `state.heldMessages` holds the draft with `delivery: null` before that.
- `foldOutLine` handles a line in this order: `releaseHeldMessage`, then the `requestedMessages` mark, then the `responseStarted` check, then the terminal check. A `started` and a `requesting` line are separate lines, and this order is safe for any line that holds more than one field.
- On `requestedMessages`, set `isRequested` true on each named awaiting record. Ignore a uuid with no record.
- On `responseStarted`, send each awaiting record with `isRequested` true again as `delivery: 'received'`, through `pushEntry`, in map order, and remove it. `pushEntry` keeps the first `at`.
- On a `lifecycle` line with a state in `TERMINAL_STATES`, end the record for that uuid. On `foldProcessClosed`, end every record, in map order.
- To end a record: when the draft's `text` starts with `/`, send the entry with `delivery: null`; else send it with `delivery: 'notReceived'`. Then remove the record. Do not emit `userMessage` or skill events again: use `pushEntry`, not `pushUserMessage`.
- `pushUserMessage` keeps its signature, and it pushes the delivery the draft holds. `foldUserLine` in fallback mode and `releaseAllHeldMessages` pass drafts with `delivery: null`, and they add no awaiting record.
- `foldUserLine` runs for replay also, and the map lives in `SessionFoldState`, so a replay rebuilds the state.
- `transcripts.ts`: `delivery: null`. `fake-agent-harness.ts`: `delivery: null` in both user entries. `preview-session.ts`: `delivery: null` on `preview-1`; task 02 sets the preview's values.
- Update the comment on `ChatEntry` and the fold's header comment for what the state means. State the meaning of each value in one line each.

GIVEN a message written, then `started`, WHEN the fold reads them THEN the entry has `delivery: 'sent'`.
GIVEN `started`, a main `requesting` line that names the uuid, and a main `message_start` WHEN the fold reads them THEN the entry is sent again with `delivery: 'received'`, the same `at`, and no second `userMessage` agent event.
GIVEN a main `message_start` after `started` with no `requesting` line that names the uuid WHEN the fold reads it THEN the delivery stays `sent`.
GIVEN a `requesting` line that names the uuid and a `message_start` with a string `parent_tool_use_id` WHEN the fold reads them THEN the delivery stays `sent`.
GIVEN a `requesting` line with a string `parent_tool_use_id` that names the uuid, then a main `message_start` WHEN the fold reads them THEN the delivery stays `sent`.
GIVEN two messages, where the second is folded into the first's turn and named by a later `requesting` line WHEN each `message_start` arrives THEN each message becomes `received` at its own request's response.
GIVEN `sent` and a terminal state with no response WHEN the fold reads it THEN plain text gets `notReceived` and text that starts with `/` gets `null`.
GIVEN `received` and then `completed` WHEN the fold reads it THEN the fold sends no further entry for that message.
GIVEN `sent` and the process closes WHEN `foldProcessClosed` runs THEN the entry gets `notReceived`.
GIVEN fallback mode WHEN a message is written THEN its entry has `delivery: null` and no later line changes it.
GIVEN a held message that ends without `started` THEN `messageDropped` fires and no entry is sent, as today.
GIVEN a pipe log that reaches `received` WHEN `replayPipeLog` runs THEN the replay holds one user entry with `delivery: 'received'`.

Tests:

- `stream-decoder.test.ts`: one table test for `requestedMessages` and `responseStarted`. Rows: main `requesting` with uuids; subagent `requesting`; another `status` value; main `message_start`; subagent `message_start`.
- `session-fold.test.ts`: one table test for delivery over a list of lines, with the final delivery of each message as the literal expected value. Rows are the GIVEN lines above that end in a delivery value. A row can end with a process close, so the process-close GIVEN is a row.
- `session-fold.test.ts`: one test asserts that the re-sent entry keeps its `at` and adds no `userMessage` agent event. The same test then reads `completed` and asserts that the line gives no further entry effect. One row in the existing replay test asserts the replay's `received`.

Done when: compiles; the test gate runs the tests above.
Commit:    one commit for the group. Stage by pathspec: peers hold other uncommitted edits in this tree.

## Proof

