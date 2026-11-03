# 03 — Chat page: key routes and the sending label

Status: not started
Type: Task
Wave: 3 · Depends on: 02
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/page/chat-commands.ts` · modify `src/plugins/chat/page/chat-view.ts` · modify `src/plugins/chat/page/entry-list.ts` · modify `src/plugins/chat/manifest.ts` · modify `src/plugins/keymap.ts` · modify `src/plugins/chat/layouts/layout.d.ts` · modify `src/plugins/chat/layouts/default/layout.js` · modify `src/plugins/chat/main/selftest-script.ts` · test `src/plugins/chat/page/chat-commands.test.ts` · test `src/plugins/chat/page/entry-list.test.ts` · test `src/plugins/chat/layouts/default/layout.test.ts`
Consumes:  `sendNow(sessionId: string, queuedId: string): void` on `ChatChannel['invoke']` ← 02 · `sentEntryId: string | null` on `QueuedMessage` ← 02
Produces:  `sendQueuedNow` command in `src/plugins/chat/manifest.ts`: label `send the newest pending message now`, group `box`, runsIn `page`
           `{ keys: '<Leader>cs', command: 'chat.sendQueuedNow' }` in `chatBoxBinds()` in `src/plugins/keymap.ts`
           `export function sendQueuedNow(deps: { channel: ChatInvoke; log: Log }, session: SessionRef, queuedId: string)` in `src/plugins/chat/page/chat-commands.ts`, beside `pullBackQueued`
           `isBoxFocused(): boolean` on `ChatSession` in `src/plugins/chat/page/chat-view.ts`, read from the tab's `isBoxFocused`
           `sent: boolean` on `QueuedMessageInput` in `src/plugins/chat/layouts/layout.d.ts`
Decisions:
- The `sendQueuedNow` helper invokes `sendNow` and logs `sending a pending message now in <session>`. A rejected invoke logs `sendNow failed: <error>`, as `pullBackQueued` does.
- The `chat.sendQueuedNow` command sends the newest **unsent** row (`sentEntryId === null`); with none it logs `no pending message in <session>`.
- Cmd+Enter: `<D-Enter>` is one chord bind with an empty context in the box and out of it (`src/renderer/page-keys.ts`), so the page's `send` decides by `session.isBoxFocused()`. When the box is not focused and `session.entries.focused()` is a queued row, it calls `sendQueuedNow` for that row, sent or not, and sends nothing from the box. Main refuses a sent row (task 02). In every other case it sends the box, as today. The entries' focused stop stays on its last row while the box holds focus, so the box-focus check is what keeps Cmd+Enter in the box sending the box.
- Enter or a click on a sent row still calls pull-back, which main refuses (task 02). The page adds no check.
- `entry-list.ts`: `queuedInput` passes `sent: message.sentEntryId !== null`, and `isQueuedChanged` also compares `sent`, so a row flipping to sent redraws in place.
- `layout.js`: `queuedLabel` takes `sent` and draws `sending` in place of `pending`, keeping the image suffix (`sending · 2 images`). `showQueued` passes it through. The text's dim look is unchanged.
- Update, in the same edit, the comments the change makes false: `QueuedMessageInput` and the `queuedMessage` part in `layout.d.ts`, the label comment in `layout.js`, and `buildQueuedSlot`'s click comment in `entry-list.ts` (a click on a sent row is refused).
- The keymap's leader group label for `<Leader>c` stays `chat controls`.
- Chat self-test (`selftest-script.ts`, the pending-row flow beside `FAKE_HOLD_TEXT` and `pending one`): add one step that queues a row over the held fake turn, presses `<Esc>`, `G`, `<D-Enter>`, and expects `[chat] sending a pending message now in chat-selftest`. The fake takes the message in at once, so the step waits on the log line only. This follows `AGENTS.md` § Running and testing: a key behaviour gets a self-test step.

GIVEN a focused pending row and focus off the box WHEN Cmd+Enter is pressed THEN `sendNow` is invoked with that row's id and the box keeps its text
GIVEN a focused pending row and focus in the box WHEN Cmd+Enter is pressed THEN the box is sent and `sendNow` is not invoked
GIVEN a row that flips to sent WHEN `setQueued` runs THEN the part's `update` runs with `sent: true`

Tests:     `chat-commands.test.ts` (beside `toggleEntry_pendingRow_pullsItBack` and `pullBackQueued given $given`, using `focusedOnStop` and `setUp`; the queued fakes there get `sentEntryId: null`). Rows:
           - `send` with the row focused and the box unfocused → invoked `[['sendNow', <sessionId>, <id>]]`, box text kept
           - the same with the box focused → the box is sent, no `sendNow`
           - `sendQueuedNow` with two rows, the newest sent → the older, unsent row's id
           - `sendQueuedNow` with none, or only sent rows → log `no pending message in <session>`
           `entry-list.test.ts`: `setQueued` with the same row unsent, then sent → the part's `update` runs with `sent: true`.
           `layout.test.ts`: add `sent` to the label table around the `pending · 2 images` rows: existing rows `sent: false`, plus `{ imageCount: 0, sent: true, label: 'sending' }` and `{ imageCount: 2, sent: true, label: 'sending · 2 images' }`.
Done when: the repo's typecheck and layer check (`scripts/check-layers.mts`, through the repo's script) pass; the tests above pass under vitest, filtered to the touched test files; the chat self-test passes.
Commit:    one commit for the group

## Proof

