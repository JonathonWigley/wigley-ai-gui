# 02 — The queuedMessage layout part

Status: not started
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/layouts/layout.d.ts` · modify `src/plugins/chat/layouts/default/layout.js` · test `src/plugins/chat/layouts/default/layout.test.ts` · modify `src/plugins/chat/page/read-chat-layout.ts` · test `src/plugins/chat/page/read-chat-layout.test.ts` · modify `src/plugins/chat/page/chat.css`
Consumes:  `PartView<I>`, `BaseKit` and the `activity` part as the activity-line plan landed them (in the tree once plan.md's first precondition holds)
Produces:  in `src/plugins/chat/layouts/layout.d.ts`:
           `export interface QueuedMessageInput { text: string; imageCount: number }` — comment: one pending message: its text as typed and how many images it carries
           `ChatLayout.queuedMessage?(parent: HTMLElement, input: QueuedMessageInput, kit: BaseKit): PartView<QueuedMessageInput>` — comment: one pending message's row, appended to the entry list after the last entry; the app marks the focused row and handles its click
           `CompleteChatLayout` requires it, as it does every part
           in `src/plugins/chat/layouts/default/layout.js`: the built-in `queuedMessage`
Decisions: the part is read, validated and rolled back exactly as the `activity` part is in `read-chat-layout.ts`; follow that part's path rather than adding a new one
           the built-in row, under DESIGN.md: a dim `pending` label, then the text whole and wrapped as typed (line breaks kept), in the secondary foreground; with `imageCount > 0` the label reads `pending · 1 image` or `pending · N images`. Draw it as the built-in `activity` part draws: `el()` nodes with named classes, their look in `chat.css` from theme tokens — `.chat-queued` (root), `.chat-queued-label` (`fg-tertiary`), `.chat-queued-text` (`fg-secondary`, `white-space: pre-wrap`, `overflow-wrap: anywhere`); no raw colour, length or font (plan.md § Boundary rules). Line breaks show through the CSS, so the live check (06) proves them, not a jsdom test
           `update` redraws the label and text from the new input in place
           the app owns the cursor bar and the click (03), so the part takes no `focused` flag and binds no handler
GIVEN `{ text: 'fix the tests', imageCount: 0 }` WHEN the built-in part draws THEN the row shows `pending` and `fix the tests`, and no image count
GIVEN `imageCount: 2` WHEN it draws THEN the label reads `pending · 2 images`; with `1`, `pending · 1 image`
GIVEN a drawn row WHEN `update` runs with new text THEN the same element shows the new text
Tests:     `layout.test.ts`: one `it.each` table for the built-in `queuedMessage` label over `imageCount` 0, 1, 3 (expected label text per row) ; one case for `update` in place, beside the `activity` part's update test
           `read-chat-layout.test.ts`: add `{ layout: { queuedMessage: builder } }` to `readChatLayout_PartsItChanges_ReturnsTheDefaultExport`, and `{ layout: { queuedMessage: 'row' }, error: 'queuedMessage is not a function' }` to `readChatLayout_Malformed_ThrowsNamingIt`, beside the `activity` rows; no new test
Done when: compiles; `npm run lint` passes; the test gate runs the tests above
Commit:    one commit for the group

## Proof
