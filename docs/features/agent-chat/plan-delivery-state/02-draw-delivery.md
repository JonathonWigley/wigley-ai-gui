# 02 — Draw the delivery state

Status: done
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/layouts/layout.d.ts` · modify `src/plugins/chat/layouts/default/layout.js` · modify `src/plugins/chat/layouts/default/layout.css` · modify `src/plugins/chat/page/entry-list.ts` · modify `src/plugins/chat/main/preview/preview-session.ts` · test `src/plugins/chat/page/entry-list.test.ts` · test `src/plugins/chat/layouts/default/layout.test.ts`
Consumes:  `UserDelivery`, `delivery` on the user `ChatEntry` ← 01
Produces:  `export type UserDelivery = 'sent' | 'received' | 'notReceived'` and `delivery: UserDelivery | null` on `UserInput` in `src/plugins/chat/layouts/layout.d.ts`

Decisions:

- `layout.d.ts` is a standalone contract text that is written to the user's layouts folder, so it cannot import from `src/contracts`. It declares its own `UserDelivery`. The compiler checks that a user `ChatEntry` is assignable to `UserInput`.
- The page owns the rule "Received shows on the latest user message only". The layout draws what its input says. A user's own layout therefore gets the rule with no work.
- The **latest delivery entry** is the last user entry in `entries` whose `delivery` is not `null`. A slash command or a history entry is therefore not the latest delivery entry.
- `entryInput` in `entry-list.ts`: for a user entry with `delivery: 'received'` that is not the latest delivery entry, the input has `delivery: null`. Every other input keeps its `delivery`. `sent` and `notReceived` stay on every message.
- `put` in `entry-list.ts` redraws only the slot of the entry it receives, so add this step: when `put` receives a user entry, call `redrawSlot` with its new input on the slot of every other user entry with `delivery: 'received'` in `next`, when that input differs from the slot's last input. `rebuild` needs no change, because it already calls `entryInput`.
- The default layout draws the label under the bubble: a sibling of the card from `kit.card(entry)`, as the last child of `entry`, with class `chat-user-delivery`. Its text comes from this map: `sent` → `Sent`, `received` → `Received`, `notReceived` → `Not received`. For `null` it draws no element.
- The user view's `update` replaces or removes that label. `fillUserTurn` clears only the card, so it does not touch the label.
- `notReceived` adds class `is-not-received`. CSS: `.chat-user-delivery` uses `--wg-font-ui`, `--wg-text-ui` and `--wg-fg-tertiary`, as `.chat-queued-label` does. `.chat-user-delivery.is-not-received` uses `--wg-status-error`.
- The label sits outside the blocks that `BLOCK_SELECTOR` (`[data-md-lines]`) reads, so the cursor and copy do not hold it.
- `preview-session.ts`: `preview-1` gets `delivery: 'sent'`. Directly after it, add `preview-user-2` with text `Is this one lost?` and `delivery: 'notReceived'`, then `preview-user-3` with text `Is this one received?` and `delivery: 'received'`. Both have `images: []` and `at: previewAt(0)`. Other preview entries keep their ids and order.

GIVEN user entries with `received`, `sent`, `received` in that order WHEN the list draws THEN the inputs have `null`, `sent`, `received`.
GIVEN user entries with `received`, then `null` WHEN the list draws THEN the inputs have `received`, `null`.
GIVEN a drawn latest user entry with `received` WHEN a new user entry with `sent` arrives THEN the earlier entry's slot redraws with `delivery: null`.
GIVEN a drawn user entry with `sent` WHEN the same id arrives with `received` THEN its slot redraws and the scroll position rule stays as for any entry update.
GIVEN each delivery value WHEN the default layout draws a user entry THEN the label text and class are as the map says, and `null` draws no element.

Tests:

- `entry-list.test.ts`: one table test for the first two GIVEN lines, plus one redraw test for each of the next two GIVEN lines.
- `layout.test.ts`: one table test over the four values. It asserts on the presence of `chat-user-delivery` and `is-not-received` and on the text. These strings are parsed by no one, but the map is the behaviour this task adds.

Done when: compiles; the test gate runs the tests above; the layout check that the repo runs on `layout.js` passes.
Commit:    one commit for the group. Stage by pathspec: peers hold other uncommitted edits in this tree.

## Proof

Commit 41fd97f4 · proof: diff read: Produces present on UserInput; tsc and lint clean · concerns: label look unchecked on screen until task 03; an older received entry's redraw refills its whole card, so thumbnails could flicker
