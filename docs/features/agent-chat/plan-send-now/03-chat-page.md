# 03 — Chat page: key routes and the sending label

Status: done
Type: Task
Wave: 3 · Depends on: 02
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/page/chat-commands.ts` · modify `src/plugins/chat/page/chat-view.ts` · modify `src/plugins/chat/page/entry-list.ts` · modify `src/plugins/chat/manifest.ts` · modify `src/plugins/keymap.ts` · modify `src/plugins/chat/layouts/layout.d.ts` · modify `src/plugins/chat/layouts/default/layout.js` · modify `src/plugins/chat/main/selftest-script.ts` · test `src/plugins/chat/page/chat-commands.test.ts` · test `src/plugins/chat/page/entry-list.test.ts` · test `src/plugins/chat/layouts/default/layout.test.ts`
Consumes:  `sendNow(sessionId: string, queuedId: string): void` on `ChatChannel['invoke']` ← 02 · `sendAllNow(sessionId, message | null): void` on `ChatChannel['invoke']` ← 02 · `sentEntryId: string | null` on `QueuedMessage` ← 02
Produces:  `sendNow` command in `src/plugins/chat/manifest.ts`: label `send the box and every pending message now`, group `box`, runsIn `page`
           `{ keys: '<D-Enter>', scope: 'chat.chat', command: 'chat.sendNow' }` in `src/plugins/keymap.ts`, replacing today's `<D-Enter>` → `chat.send` bind in that scope
           `export function sendQueuedNow(deps: { channel: ChatInvoke; log: Log }, session: SessionRef, queuedId: string)` in `src/plugins/chat/page/chat-commands.ts`, beside `pullBackQueued`
           `isBoxFocused(): boolean` on `ChatSession` in `src/plugins/chat/page/chat-view.ts`, read from the tab's `isBoxFocused`
           `sent: boolean` on `QueuedMessageInput` in `src/plugins/chat/layouts/layout.d.ts`
Decisions:
- The `sendQueuedNow` helper invokes `sendNow` and logs `sending a pending message now in <session>`. A rejected invoke logs `sendNow failed: <error>`, as `pullBackQueued` does.
- User decision, round 3 (relayed by session ai-dev-2e): no `<Leader>cs` and no `chat.sendQueuedNow` command. Cmd+Enter runs the new `chat.sendNow` command; Enter keeps running `chat.send`, unchanged.
- `chat.sendNow`: `<D-Enter>` is one chord bind with an empty context in the box and out of it (`src/renderer/page-keys.ts`), so the command decides by `session.isBoxFocused()`. When the box is not focused and `session.entries.focused()` is a queued row, it calls `sendQueuedNow` for that row, sent or not, and leaves the box untouched; main refuses a sent row (task 02). In every other case it reads the box as `send` does and invokes `sendAllNow(sessionId, message)`, `null` when the box is empty, logging `sending now in <session>`; it clears and restores the box exactly as `send` does, and a rejected invoke logs `sendAllNow failed: <error>`. Main decides idle (as Enter) against running (box plus every unsent row, into the turn). The entries' focused stop stays on its last row while the box holds focus, so the box-focus check is what keeps Cmd+Enter in the box on the box route.
- Session ai-dev-2e edits `chatBoxBinds()` in `src/plugins/keymap.ts` (Enter sends in insert mode, Shift+Enter adds a line) before this task: leave `chatBoxBinds()` as found.
- Enter or a click on a sent row still calls pull-back, which main refuses (task 02). The page adds no check.
- `entry-list.ts`: `queuedInput` passes `sent: message.sentEntryId !== null`, and `isQueuedChanged` also compares `sent`, so a row flipping to sent redraws in place.
- `layout.js`: `queuedLabel` takes `sent` and draws `sending` in place of `pending`, keeping the image suffix (`sending · 2 images`). `showQueued` passes it through. The text's dim look is unchanged.
- Update, in the same edit, the comments the change makes false: `QueuedMessageInput` and the `queuedMessage` part in `layout.d.ts`, the label comment in `layout.js`, and `buildQueuedSlot`'s click comment in `entry-list.ts` (a click on a sent row is refused).
- Chat self-test (`selftest-script.ts`, the pending-row flow beside `FAKE_HOLD_TEXT` and `pending one`): add one step that queues a row over the held fake turn, presses `<Esc>`, `G`, `<D-Enter>`, and expects `[chat] sending a pending message now in chat-selftest`. The fake takes the message in at once, so the step waits on the log line only. Add a second step: over the held fake turn with one row queued, type text in the box and press `<D-Enter>` in it; expect `[chat] sending now in chat-selftest`. This follows `AGENTS.md` § Running and testing: a key behaviour gets a self-test step.

GIVEN a focused pending row and focus off the box WHEN Cmd+Enter is pressed THEN `sendNow` is invoked with that row's id and the box keeps its text
GIVEN a focused pending row and focus in the box WHEN Cmd+Enter is pressed THEN `sendAllNow` is invoked with the box's message and `sendNow` is not
GIVEN a row that flips to sent WHEN `setQueued` runs THEN the part's `update` runs with `sent: true`

Tests:     `chat-commands.test.ts` (beside `toggleEntry_pendingRow_pullsItBack` and `pullBackQueued given $given`, using `focusedOnStop` and `setUp`; the queued fakes there get `sentEntryId: null`). Rows:
           - `sendNow` command with the row focused and the box unfocused → invoked `[['sendNow', <sessionId>, <id>]]`, box text kept
           - the same with the box focused and text in it → invoked `[['sendAllNow', <sessionId>, <message>]]`, box cleared as `send` clears it, no `sendNow`
           - the box focused and empty → invoked `[['sendAllNow', <sessionId>, null]]`
           - `sendQueuedNow` helper's invoke rejected → log `sendNow failed: <error>`
           `entry-list.test.ts`: `setQueued` with the same row unsent, then sent → the part's `update` runs with `sent: true`.
           `layout.test.ts`: add `sent` to the label table around the `pending · 2 images` rows: existing rows `sent: false`, plus `{ imageCount: 0, sent: true, label: 'sending' }` and `{ imageCount: 2, sent: true, label: 'sending · 2 images' }`.
Done when: the repo's typecheck and layer check (`scripts/check-layers.mts`, through the repo's script) pass; the tests above pass under vitest, filtered to the touched test files; the chat self-test passes.
Commit:    one commit for the group

## Proof

Commit 2583f5b8 · proof: diff read: chat.sendNow in manifest, <D-Enter> chat.chat bound to chat.sendNow, exported sendQueuedNow, ChatSession.isBoxFocused, QueuedMessageInput.sent all present; tsc clean; worker's 3 test files (138) pass; chat self-test (--plugin chat) passes both new steps · concerns: <D-Enter> chat.sendNow has no key anchor (Send button anchors chat.send, which now has no chat.chat bind) — the whole self-test's anchor check would fail; design call for triage; oxfmt flags start.ts/title-tool files outside the task; keymap.md and design.md still name <Leader>cs (task 04)
