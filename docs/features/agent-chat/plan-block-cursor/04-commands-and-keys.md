# 04 — Commands and keys

Status: not started
Type: Task
Wave: 3 · Depends on: 03
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/keymap.ts` · modify `src/plugins/chat/manifest.ts` · modify `src/plugins/chat/page/chat-commands.ts` · modify `src/plugins/chat/page/chat-kit.ts` · modify `src/plugins/chat/page/chat-view.ts` · modify `src/plugins/chat/contract.ts` · modify `src/plugins/visual/page/visual-commands.ts` · test `src/plugins/chat/page/chat-commands.test.ts` · test `src/plugins/chat/page/entry-list.test.ts` · test `src/plugins/visual/page/visual-commands.test.ts`
Consumes:  `moveToMessage`, `toggleRange`, `cancelRange`, `selectedSource`, `focusedBlock` ← 03
Produces:

- commands `chat.nextMessage`, `chat.prevMessage`, `chat.toggleRange`, `chat.cancelRange`, `chat.allowOrCopy` in `manifest.ts`
- `ChatPageExports.focusedBlock(): HTMLElement | null` in `src/plugins/chat/contract.ts`

Decisions:

Pinned binds, in `chatEntryPageBinds` and scope `chat.chat`:

| Keys | Command | Label |
|---|---|---|
| `J` | `chat.nextMessage` | `next message` |
| `K` | `chat.prevMessage` | `previous message` |
| `V` | `chat.toggleRange` | `start or end a range` |
| `<Esc>` | `chat.cancelRange` | `cancel the range` |
| `y` | `chat.allowOrCopy` | `allow the tool once, or copy` |

- The group of the first four is `entries`. The group of `chat.allowOrCopy` is `permissions`.
- `<Esc>` is `where: 'page'`. In the box, `<Esc>` stays `chat.leaveBox`.
- `chat.allowPermission` goes away. Rename it at each reference: `keymap.ts`, `manifest.ts`, `chat-commands.ts`, `chat-kit.ts` and `entry-list.test.ts`. This app has one user, so no alias stays.
- `allowOrCopy`: with a pending permission, allow it as `allowPermission` does today. With none, copy.
- The Allow button in `chat-kit.ts` allows only. It runs its own answer callback, and keeps its key hint through `allowOrCopy`.
- Copy: read `session.entries.selectedSource()`. With null, log `nothing to copy` and show no toast. Otherwise call the injected clipboard write, end the range with `cancelRange`, and show the toast `Copied 1 block` or `Copied <n> blocks` in tone `success`.
- A failed clipboard write logs the error and shows the toast `Copy failed` in tone `error`. The range stays.
- Add `writeClipboard(text: string): Promise<void>` to the deps of `chat-commands.ts`. The live adapter calls `navigator.clipboard.writeText`, as `sign-in-dialog.ts` does.
- `cancelRange` with no open range logs and does nothing else.
- `nextMessage` and `prevMessage` log through `focusedLine`, as `moveEntry` does.
- `chat.nextEntry` keeps its `isAtLastStop` and `enterStop` behaviour. `chat.nextMessage` does not enter a composer stop.
- `focusedBlock` in `chat-view.ts` mirrors `focusedEntry`: null while `tab.stop.holding()` is not null.
- `visual.openVisuals`: read `sourcesIn(entry)` as today. When `focusedBlock()` is not null and `sourcesIn(block)` is not empty, open at the index of that block's first source in the entry's list. Otherwise open at 0.

GIVEN a pending permission WHEN `y` runs THEN the permission is allowed and the clipboard is not written
GIVEN no pending permission and a cursor block WHEN `y` runs THEN the clipboard holds the block's source and the toast says `Copied 1 block`
GIVEN an open range of three blocks WHEN `y` runs THEN the clipboard holds all three, the toast says `Copied 3 blocks`, and the range ends
GIVEN an open range WHEN the clipboard write fails THEN the toast says `Copy failed` and the range stays
GIVEN a stop with nothing to copy WHEN `y` runs THEN the clipboard is not written and no toast shows
GIVEN an open range WHEN page `<Esc>` runs THEN the range ends and the cursor stays
GIVEN an entry with two visuals and a cursor on the second WHEN `v` runs THEN the overlay opens at index 1
GIVEN a cursor on a paragraph in that entry WHEN `v` runs THEN the overlay opens at index 0

Tests:     add `it.each` rows for the `y` cases in `chat-commands.test.ts`, with a fake clipboard and toast; add the `<Esc>` case there; add the two `v` rows to `visual-commands.test.ts`; rename the `allowPermission` references in `entry-list.test.ts`.
Done when: compiles; `npm run lint` passes; the test gate runs the tests above.
Commit:    one commit for the group

## Proof

