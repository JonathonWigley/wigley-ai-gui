# 03 — Chat page: key routes and the sending label

Status: not started
Type: Task
Wave: 3 · Depends on: 02
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/page/chat-commands.ts` · modify `src/plugins/chat/page/entry-list.ts` · modify `src/plugins/chat/manifest.ts` · modify `src/plugins/keymap.ts` · modify `src/plugins/chat/layouts/layout.d.ts` · modify `src/plugins/chat/layouts/default/` (the queuedMessage part) · test `src/plugins/chat/layouts/default/layout.test.ts` · test the chat-commands test (search `pullBackQueued` under `src/plugins/chat/page/`)
Consumes:  `sendNow(sessionId: string, queuedId: string): void` on `ChatChannel['invoke']` ← 02 · `sentEntryId: string | null` on `QueuedMessage` ← 02
Produces:  `sendQueuedNow` command in `src/plugins/chat/manifest.ts`: label `send the newest pending message now`, group `box`, runsIn `page`
           `{ keys: '<Leader>cs', command: 'chat.sendQueuedNow' }` in `chatBoxBinds()` in `src/plugins/keymap.ts`
           `export function sendQueuedNow(deps: { channel: ChatInvoke; log: Log }, session: SessionRef, queuedId: string)` in `src/plugins/chat/page/chat-commands.ts`, beside `pullBackQueued`
           `sent: boolean` on `QueuedMessageInput` in `src/plugins/chat/layouts/layout.d.ts`
Decisions:
- `sendQueuedNow` (the helper) invokes `sendNow` and logs `sending a pending message now in <session>`; a rejected invoke logs `sendNow failed: <error>`, as `pullBackQueued` does.
- The `chat.sendQueuedNow` command sends the newest **unsent** row (`sentEntryId === null`); with none it logs `no pending message in <session>`.
- Cmd+Enter: the page's `send` (chat-commands.ts `send(deps, session)`) first checks the entries' focused stop. When the box does not hold focus and the stop is a queued row, it calls `sendQueuedNow` for that row and sends nothing from the box. Otherwise it sends the box as today. The implementer reads how the box's and the page's `<D-Enter>` reach `chat.send` to find the box-focus signal; the box's own Cmd+Enter always sends the box.
- Enter or a click on a sent row still calls pull-back; main logs and refuses it (task 02). The page adds no check.
- `entry-list.ts` `queuedInput` passes `sent: message.sentEntryId !== null`.
- The default layout's queued part draws the label `sending` in place of `pending` when `sent`, keeping the image suffix: `sending · 2 images`. The text's dim look is unchanged.
- The keymap's leader group label for `<Leader>c` stays `chat controls`.

GIVEN a focused unsent pending row and focus off the box WHEN Cmd+Enter is pressed THEN `sendNow` is invoked with that row's id and the box keeps its text
GIVEN a sent row's input WHEN the default layout draws it THEN its label reads `sending`

Tests:     add `sent: true` rows to the existing label table in `layout.test.ts` (around the `pending · 2 images` rows): `{ imageCount: 0, sent: true, label: 'sending' }`, `{ imageCount: 2, sent: true, label: 'sending · 2 images' }`, and `sent: false` on the existing rows. If a chat-commands test covers `toggleEntry` or `pullBackQueued`, add rows there for `send` on a focused row (invokes `sendNow`, box untouched) and `sendQueuedNow` with none or only sent rows (logs `no pending message in`). If none exists, the final verification's drive run covers the key routes.
Done when: typecheck passes; the layer check (`scripts/check-layers.mts`, through the repo's script) passes; the tests above pass under vitest, filtered to the touched test files.
Commit:    one commit for the group

## Proof

