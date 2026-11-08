# 07 — Chat's mouse-only items

Status: not started
Type: Batch
Wave: 7 · Depends on: 06
Plan: [plan.md](plan.md)

Four items that close the Chat tab's mouse-only gaps, sharing one spec: every one is a key on a
target the transcript cursor, the composer or the agent strip already selects, and every one gets
its self-test step with a fixture state that builds its target.

1. `y`/`n` act on the permission card under the entry cursor.
2. Enter toggles the expander in the cursor's block.
3. `<Leader>ci` shows the composer's attached images in the image viewer, `x` removing the shown one.
4. Ctrl+j/k and Ctrl+Shift+j/k scroll an open agent-strip box's tool list.

Files:
- modify `src/plugins/chat/page/chat-view.ts`: the `Pick` on `ChatSession.entries` gains `toggleFocusedBlock` only.
- modify `src/plugins/chat/page/chat-commands.ts`: `allowOrCopy`, `denyPermission`, `toggleEntry`;
  new handlers `showAttachments` and `removeShownImage`.
- modify `src/plugins/chat/page/chat-kit.ts`: `Expander` and `Expanders`.
- modify `src/plugins/chat/page/entry-list.ts`: new `toggleFocusedBlock`.
- modify `src/plugins/chat/page/image-viewer.ts`: removal.
- modify `src/plugins/chat/page/composer-kit.ts`: only if the attachments' `onChange` wiring needs
  it. As drawn now, `attachments.onChange` already redraws the strip, so expect no change here, and
  drop the file from the commit if it has none.
- modify `src/plugins/chat/layouts/layout.d.ts`: `ImageViewerInput.removable`.
- modify `src/plugins/chat/layouts/default/layout.js`, `layout.css`: the viewer's `x` hint.
- modify `src/plugins/chat/manifest.ts`. Task 06 owns this file, but 07 runs after it, so 07 may
  modify it too: two commands are added here and one label is reworded.
- modify `src/plugins/agent-strip/page/agent-strip.ts`, `src/plugins/agent-strip/page/start.ts`
  (command wiring), `src/plugins/agent-strip/manifest.ts`.
- modify `src/plugins/keymap.ts`.
- modify `src/shared/fake-agent-harness.ts`: `FAKE_BLOCKS_REPLY` gains a details block.
- modify `src/plugins/chat/main/selftest-script.ts`, `src/plugins/agent-strip/main/selftest-script.ts`.
- test `src/plugins/chat/page/chat-commands.test.ts`, `src/plugins/chat/page/entry-list.test.ts`.
- test, create `src/plugins/chat/page/image-viewer.test.ts`.
- test `src/plugins/agent-strip/page/agent-strip.test.ts`.

Consumes: nothing named. 06 lands first in the same files (`chat/manifest.ts`, `keymap.ts`, the chat
self-test script). Rebase over its edits, and keep the `chat.chat` scope as the transcript's and the
box's scope, which plan.md leaves unchanged.

Produces:
- `chat/manifest.ts` commands:
  - `showAttachments: { label: 'show the attached images', group: 'box', runsIn: 'page' }`
  - `removeShownImage: { label: 'remove the shown image', group: 'image', runsIn: 'page' }`
  - `toggleEntry` relabelled `'expand or collapse the block's expander, else the entry'`.
- `agent-strip/manifest.ts` commands, each with `group: 'agent strip'` and `runsIn: 'page'`:
  - `lineDown`, label `'scroll the tool list a line down'`
  - `lineUp`, label `'scroll the tool list a line up'`
  - `halfPageDown`, label `'scroll the tool list half a page down'`
  - `halfPageUp`, label `'scroll the tool list half a page up'`
- `EntryList.toggleFocusedBlock(): { entry: ChatEntry; result: 'expanded' | 'collapsed' } | null`
  in `entry-list.ts`.
- In `chat-kit.ts`:
  - `type Expander = Pick<CollapsibleCard, 'element' | 'isOpen' | 'setOpen'>`.
  - `Expanders.inside(container: HTMLElement): Expander[]`: the kit's expanders whose element
    `container` contains, in creation order.
- In `image-viewer.ts`:
  - `export interface ImageRemoval { remove(index: number): readonly ChatImage[] }`. It removes the
    image at `index` from where the images came from and returns the images left there.
  - `ImageViewer.open(images, index, removal?: ImageRemoval)`.
  - `ImageViewer.removeShown(): void`.
- `ImageViewerInput.removable: boolean` in `layouts/layout.d.ts`.
- In `agent-strip.ts`, `AgentStrip.scrollToolList(step: ScrollStep, direction: 1 | -1): void`. The
  four commands in `start.ts` call it.

## Decisions

### 1. `y`/`n` target the permission under the cursor

A **waiting card under the cursor** is the case where `session.entries.focused()` is
`{ kind: 'entry' }` on a permission entry, and the entry with that id in `session.state.entries`
still has `answer === null`. Read the answer from the state, not from the stop, since the stop may
hold an older copy. Name a helper in `chat-commands.ts` for this, for example
`permissionTarget(session)`. It returns that entry, else `oldestPendingPermission(state.entries)`,
else null.

Precedence for `y` (`chat.allowOrCopy`), first match wins:

1. A range is open → copy (today's intent rule: a permission landing on an open range waits).
2. A waiting card is under the cursor → allow that card.
3. Another card is waiting → allow the oldest waiting one (today).
4. No card is waiting → copy (today).

Precedence for `n` (`chat.denyPermission`): the waiting card under the cursor, else the oldest
waiting one, else log `no pending permission in <name>` (today's line). An open range does not
change `n`.

Log lines are unchanged: `allowed <tool> in <name>`, `deny reason box shown for <tool>`,
`denied <tool> in <name>`. A click on a card's buttons still answers that card. Every waiting card
keeps its own `y`/`n` anchors, as now.

### 2. Enter toggles the expander in the cursor's block

**The cursor's block holds an expander** when `focusedBlock()` is not null, so the cursor is on a
block stop of a user or assistant message, and at least one of these is true:

- the block element is itself a `details` element;
- the block contains a `details` element (a markdown `:::details Summary` block draws
  `details.md-details` with its `summary`, and a contributed fence view may draw one too);
- the block contains a kit expander (`collapsibleCard`, `collapsibleRow`, `expander`), as returned
  by `kit.expanders.inside(block)`.

The **target** is the first of those candidates in document order, compared with
`compareDocumentPosition`, so the outermost and topmost one wins. Exactly one expander toggles:

- a `details` target flips its `open`;
- a kit target calls `setOpen(!isOpen())`.

Stops that are not blocks never match: an activity line, a pending row, and every entry kind other
than a message. They keep today's behaviour.

`toggleFocusedBlock()` returns null when the cursor has no block or its block holds no expander.
Otherwise it returns the entry and whether the target opened or closed.

Precedence for Enter (`chat.toggleEntry`), first match wins:

1. A pending row → pull it back (today).
2. The cursor's block holds an expander → toggle that one expander and log
   `<expanded|collapsed> <kind> block`, `<kind>` being the entry's kind, for example
   `expanded assistant block`.
3. A user entry with images → open the viewer on its first image, with no removal (today).
4. Otherwise → `toggleFocused()` as today: an activity line opens or closes; any other entry
   toggles all its kit expanders, or logs `<kind> entry has nothing to expand`.

A `details` element that Enter opened is not kept across a redraw of its entry. That matches a
click on its summary today; only kit expanders are restored.

### 3. `<Leader>ci` and the viewer's `x`

- **Binds.** `<Leader>ci` → `chat.showAttachments` in `chat.chat`, with no `where`, so it fires on
  the page and in the box. This is a Decided change from the other `<Leader>c…` keys, which are
  `where: 'box'`. The page has no plain letter for this action, whereas `m`/`e`/`o`/`c` cover the
  pickers there. `x` → `chat.removeShownImage` in `chat.image`.
- **`showAttachments`** works in the visible tab's session only (`inSession`). It reads
  `session.attachments.images()`:
  - none → log `no attached image`, the same line `<Leader>cx` logs, and open nothing;
  - else → `viewer.open(images, 0, removal)`. The removal's `remove(index)` calls
    `session.attachments.removeAt(index)` and returns `session.attachments.images()`. The composer's
    strip redraws through the existing `onChange`.
- **`removeShown`**:
  - Viewer closed → does nothing, like `next`, `previous` and `close`.
  - Opened with no removal (a sent message's images) → logs `sent images cannot be removed` and
    changes nothing.
  - Opened with a removal → logs `removed attached image <n> of <count>` (the shown place before the
    removal), calls `remove(index)`, and takes the returned images as its own:
    - none left → `close()`, which logs `image viewer closed`;
    - otherwise it shows the same index if one is left there (the next image), else the index
      before it (the previous image), and logs `image viewer showing <i> of <count>` through
      today's `show`.
- **Snapshot.** The viewer holds the images it was opened with until the next `x`. A change made to
  the attachments while it is open shows only after that `x` or a reopen. Its pushed scope keeps the
  composer's keys away meanwhile.
- **The `x` anchor** is a box hint in the viewer. `ImageViewerInput.removable` is true when the
  viewer was opened with a removal.
  - The default layout's `imageViewer` draws
    `kit.keyHint(frame, 'removeShownImage', { label: 'remove', className: 'chat-image-viewer-remove' })`
    beside the counter, using the `BaseKit` it is already handed. The hint's scope is the part's
    `chat.image`.
  - The default layout's `update` hides the hint (`hidden`) when `removable` is false and shows it
    when true.
  - The CSS places it on the counter's line, and the hint keeps its own `[hidden]` rule.
  - A user layout that leaves the hint out loses only the hint; the key still works.

### 4. Agent-strip tool list scroll

- **Binds** in `agent-strip.strip`:
  - `<C-j>` → `agent-strip.lineDown`
  - `<C-k>` → `agent-strip.lineUp`
  - `<C-S-j>` → `agent-strip.halfPageDown`
  - `<C-S-k>` → `agent-strip.halfPageUp`

  These are vim's own keys, so they need no anchor.
- **`scrollToolList(step, direction)`**:
  - No selection (the strip holds no cursor) → does nothing, like the other strip commands.
  - The selection's session has an open agent box with a drawn tool list → call
    `scrollContent(list, step, direction, textLineHeightPx(list))` (`src/shared/content-scroll.ts`,
    `src/shared/page/text-line.ts`) and log `scrollText('the tool list', step, direction, scroll)`.
    For example: `scrolled the tool list down a line`, `the tool list did not scroll down`.
  - No box is open, or the open box is a task row → log `no open tool list in <name>`.
- The open box is the session's open key, whether or not it is the selected box.
- The scroll survives redraws through the existing `listScrollTop` carry.

### Docs

Written ahead (plan.md § Docs written ahead): `docs/keymap.md` § Layers' chat `y`/`n` clause and the
`c` leader row's `ci` (page and box). No doc edit in this task; Task 09 re-reads both.

### Fixture states (AGENTS.md § Key hints, the placement check)

- **Two waiting cards.** The chat fixture's open-time permission in `chat-selftest` stays the
  oldest. The new group sends `fake: permission` twice in `chat-selftest`, which makes a newer card
  each time.
- **An expander in a block.** Append the block `:::details Fixture details\nThe hidden line.\n:::`
  to `FAKE_BLOCKS_REPLY` as its last block, joined by `\n\n` as the others are. The block cursor
  group's steps keep passing: K from the last block still leaves the reply, and `V j y` still copies
  two blocks. `fake-agent-harness.test.ts` asserts the constant by name, so it needs no change.
- **Attachments.**
  - The chat script's `openSessions` starts a third session in a new self-test project,
    `chat-images` (`IMAGES_PROJECT_NAME`). It is made in `makeProjects` and closed in
    `closeEarlierSessions`.
  - Start it before `chat-second`, so it sits at the far end of the rows and `chat-second` stays
    `chat-selftest`'s neighbour for the two-sessions group's `<A-S-i>`/`<A-S-o>` steps.
  - Through `ChatSessions`, add `send` and `interrupt` to the deps' `Pick`:
    1. `send(imagesId, { text: FAKE_HOLD_TEXT, images: [] })`.
    2. Wait until the state reports the turn running, then
       `send(imagesId, { text: '', images: FAKE_HISTORY_IMAGES })`. That message queues.
    3. `interrupt(imagesId)`. It returns the queued message to the box and ends the hold.
  - The page places the returned message when the tab mounts, so the box holds no text and two
    attached images.
  - Finish this before `sessions.activate(id)` for `chat-selftest`, so the run's shown line follows
    it.
  - `chat-images`'s process calls are not checked, so `EXPECTED_CALLS` does not change for this
    fixture.

GIVEN a waiting card B under the cursor and an older waiting card A WHEN `y` runs THEN B is
allowed, and A stays waiting.
GIVEN the cursor on an answered card and card A waiting WHEN `n` runs THEN A's reason box opens.
GIVEN a range open and a waiting card under the cursor WHEN `y` runs THEN the range is copied and
nothing is allowed.
GIVEN the cursor on a block holding a `details` WHEN Enter runs THEN that `details` opens, and the
entry's kit expanders are left as they were.
GIVEN a block with a kit collapsible that sits before a `details` in document order WHEN
`toggleFocusedBlock` runs THEN only the collapsible toggles.
GIVEN two attached images and the viewer on image 2 WHEN `x` runs THEN the attachments hold image 1
and the viewer shows `1 of 1`; GIVEN that state WHEN `x` runs again THEN the viewer closes.
GIVEN the viewer over a sent message's images WHEN `x` runs THEN nothing is removed and it logs
`sent images cannot be removed`.
GIVEN an open agent box with a tool list taller than its box WHEN `lineDown` runs THEN the list's
`scrollTop` grows.

Tests:
- `chat-commands.test.ts`:
  - Add a `focused` column to the `allowOrCopy_$given` table, plus rows:
    - waiting card under the cursor with an older one waiting → allows the cursor's;
    - answered card under the cursor with one waiting → allows the oldest;
    - range open with a waiting card under the cursor → copies.
  - New table `denyPermission_$given`, with rows:
    - cursor waiting → deny opens on it;
    - cursor answered → oldest;
    - none waiting → log `no pending permission in <name>`.
    The break it catches: the target read from the oldest only, or the answer read from the stale
    stop.
  - Add a row beside `toggleEntry_userEntryWithImages_opensViewerAtFirstAndTogglesNothing`:
    `toggleEntry_blockExpanderInUserEntryWithImages_togglesBlockAndOpensNoViewer`. It pins step 2
    ahead of step 3. Add `toggleEntry_blockWithoutExpander_togglesWholeEntry` to pin the fallback.
  - New `showAttachments_$given` table:
    - none → `no attached image` and no open;
    - two → open at 0 with a removal whose `remove(1)` leaves one attachment.
- `entry-list.test.ts`: new `toggleFocusedBlock_$given` table in the `block stops` describe, with
  rows:
  - the block is `details`;
  - `details` inside the block;
  - a kit collapsible before a `details` → the collapsible;
  - a block with neither → null;
  - an activity stop → null.
  The break it catches: toggling every expander, or the last one, in place of the first.
- `image-viewer.test.ts` (create): `removeShown_$given` table, with rows:
  - middle of three → shows the next, at the same index;
  - last of two → shows the previous;
  - last of one → closes;
  - no removal → logs `sent images cannot be removed`, keeps the image;
  - closed → no call.
  Each row asserts the removal's calls, the logged lines and the drawn input's `index`, `count` and
  `removable`.
- `agent-strip.test.ts`:
  - `scrollToolList_OpenAgentBox_ScrollsItsList`: stub the list's `scrollHeight` and
    `clientHeight`; assert `scrollTop` and the logged line.
  - `scrollToolList_NoOpenList_Logs`: a task row open, or none open.
  - `scrollToolList_NoSelection_DoesNothing`.

Self-test steps (the chat script, unless marked):

- **New group `permission cursor`**, after `sending` and before `permission card`. Its why: "y and n
  answer the waiting card under the cursor, not the oldest: two fake permission turns each make a
  newer card, the cursor's card is allowed and then denied while the fixture's card stays waiting
  for the next group's y."
  1. `keys: sendKeys(FAKE_PERMISSION_TEXT)`, expect `[chat] permission entry added in chat-selftest`.
  2. `keys: ['Escape', 'k']`, expect `[chat] focused user entry`.
  3. `keys: ['j']`, expect `[chat] focused permission entry`.
  4. `keys: ['y']`, expect `[chat] result entry added in chat-selftest`,
     alsoExpect `/^\[chat\] allowed Bash in chat-selftest$/`.
  5. Steps 1–3 again.
  6. `keys: ['n']`, expect `[chat] deny reason box shown for Bash`.
  7. `keys: ['<D-Enter>']`, expect `[chat] result entry added in chat-selftest`,
     alsoExpect `/^\[chat\] denied Bash in chat-selftest$/`.

  The existing `permission card` group's first `y`, which shows the form, then proves the fixture's
  card stayed waiting.

  Add two `{ method: 'send', text: FAKE_PERMISSION_TEXT, imageCount: 0 }` rows to `EXPECTED_CALLS`,
  after the second `'hello'`. Read the fake's call record for a permission answer, and add any call
  the answer records.
- **New group `block expander`**, after `block cursor`. Its why: "Enter on fake: blocks' details
  block opens and closes that one expander; on a block with none it toggles the whole entry, as
  before."
  1. `keys: ['<A-S-i>']`, expect `[chat] Chat tab shown in chat-second`.
  2. `keys: ['Escape', 'G']`, expect `[chat] following the latest entry`.
  3. `keys: ['Enter']`, expect `[chat] expanded assistant block`, `screenshot: 'block-expanded'`.
  4. `keys: ['Enter']`, expect `[chat] collapsed assistant block`.
  5. `keys: ['k']`, expect `[chat] focused assistant entry`.
  6. `keys: ['Enter']`, expect `[chat] assistant entry has nothing to expand`.
  7. `keys: ['<A-S-o>']`, expect `[chat] Chat tab shown in chat-selftest`.
- **New group `attachments`**, after `two sessions`. Its why: "Space c i opens the viewer on the
  composer's two attached images, x removes the shown one and shows the one before it, a last x
  closes the viewer, and Space c i then finds none."
  1. Keys that show `chat-images`'s tab (the Sessions list orders by recency, not by start order, so
     run the chat script once with the new session, read the row order from the `two sessions` screenshot, and
     write the real keys here and in step 7; start `chat-images` so it sorts last, after chat-second, and the
     existing `two sessions` steps — chat-second as chat-selftest's neighbour, the `<A-S-o>` wrap — pass unchanged). Expect `[chat] Chat tab shown in chat-images`,
     (No alsoExpect: the pulled-back line logs at fixture time in `openSessions`; step 2's `showing 1 of 2` proves
     the two images.)
  2. `keys: [' ', 'c', 'i']`, expect `[chat] image viewer showing 1 of 2`, `checksFit: true`,
     `screenshot: 'attachments-viewer'`.
  3. `keys: ['l']`, expect `[chat] image viewer showing 2 of 2`.
  4. `keys: ['x']`, expect `[chat] image viewer showing 1 of 1`,
     alsoExpect `/^\[chat\] removed attached image 2 of 2$/`.
  5. `keys: ['x']`, expect `[chat] image viewer closed`,
     alsoExpect `/^\[chat\] removed attached image 1 of 1$/`.
  6. `keys: [' ', 'c', 'i']`, expect `[chat] no attached image`.
  7. Keys back to `chat-selftest`, expect `[chat] Chat tab shown in chat-selftest`.
- **`images` group**: after `{ keys: ['l'], expect: '[chat] image viewer showing 2 of 2' }`, add
  `{ keys: ['x'], expect: '[chat] sent images cannot be removed' }`. Extend the group's why:
  "…and x over a sent message's images removes nothing".
- **Agent strip `strip keys` group**: the steps run between the `Enter` that opens box 1 and the
  `Enter` that closes it:
  1. `keys: ['<C-j>']`, expect `[agent-strip] the tool list did not scroll down`. Box 1's subagent
     has one tool, so the list does not overflow; the step proves the key reaches the open box's
     list.
  2. `keys: ['<C-S-k>']`, expect `[agent-strip] the tool list did not scroll up`.

  After the closing `Enter`, add `keys: ['<C-j>']`, expect
  `[agent-strip] no open tool list in agent-strip-selftest`. Extend the group's why: "…Ctrl+j and
  Ctrl+Shift+k reach an open box's tool list, and say so with none open".

Done when:
- typecheck and lint pass;
- the test gate runs the tests above;
- `npm run selftest -- --plugin chat --plugin agent-strip` passes (the new groups, with the groups
  before them in each script).

The placement check runs only on a whole run. It is left to Task 10, which must show no
`[keys] unplaced x chat.removeShownImage in chat.image` line.

Commit: one commit for the group.

## Proof

