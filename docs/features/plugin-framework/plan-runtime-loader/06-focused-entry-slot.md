# 06 — Visual reads chat's focused entry through a slot

Status: done
Type: Task
Wave: 3 · Depends on: 04 (both edit chat's page `start.ts` and `contract.ts`), 05 (both edit `AGENTS.md`)
Plan: [plan.md](plan.md)

Closes the follow-up "Visual reads chat's focused entry through a slot" in `docs/features/followups.md`. Today
`ChatPageExports.focusedEntry` and `focusedBlock` hand visual an `HTMLElement`, which a plugin from a user folder
cannot read across a reload. Chat publishes the focus as ids in a page slot, and visual finds the element from them.

Files:
- modify `src/plugins/chat/contract.ts` (new `ChatFocus`, `chatFocusSlot`; `ChatPageExports` loses two members and
  their doc lines)
- modify `src/plugins/chat/page/start.ts` (publishes the slot; drops the two exports) · test
  `src/plugins/chat/page/start.test.ts`
- modify `src/plugins/chat/page/chat-view.ts` (computes and writes the focus; `ChatView` loses `focusedEntry` and
  `focusedBlock`; tab roots carry `data-chat-session`)
- modify `src/plugins/chat/page/entry-list.ts` (slots carry `data-chat-entry`; a `focusChanged` dep) · test
  `src/plugins/chat/page/entry-list.test.ts`
- modify `src/plugins/chat/page/entry-focus.ts` (`blockIndexOfStop`) · test `src/plugins/chat/page/entry-focus.test.ts`
- test `src/plugins/chat/page/chat-view.test.ts`
- modify `src/plugins/visual/manifest.ts`, `src/plugins/visual/page/start.ts`,
  `src/plugins/visual/page/visual-commands.ts`, `src/plugins/visual/page/visual-registry.ts` · test
  `src/plugins/visual/page/start.test.ts`, `src/plugins/visual/page/visual-commands.test.ts`,
  `src/plugins/visual/page/visual-registry.test.ts`
- modify `AGENTS.md`, the source map's `chat/` line (line 315 at plan time): the sentence "page exports
  `focusedEntry` … and `focusedBlock` … to visual" only

Consumes: nothing from another task.

Produces, in `src/plugins/chat/contract.ts`:

- `export interface ChatFocus { sessionId: string; entryId: string; block: number | null }`.
- `export const chatFocusSlot: SlotKey<ChatFocus | null, 'page', 'chat'> = { id: 'chat.focus', process: 'page', kind: 'value' }`.

Decisions:
- **The value.** The visible Chat tab's focused stop:
  - `sessionId` is the tab's session.
  - `entryId` is the id of the slot the stop belongs to: the entry id, the activity line's run id, or the queued
    message's id. For a block stop it is the entry holding the block (`entryIdOfStop`).
  - `block` is the block's index among that entry's `[data-md-lines]` elements in document order (the index in a
    block stop id `<entryId>#<n>`), and null on a stop that is no block.
  - The value is null with no visible Chat tab, with no focused stop, or while a composer part's stop holds the
    cursor. These are today's null cases of `focusedEntry`.
- **The DOM marks that visual finds by.** Chat sets `data-chat-session="<sessionId>"` on each Chat tab's root
  (`.chat-tab`), and `data-chat-entry="<slot id>"` on each `.chat-entry-slot` (entry, activity and queued slots), at
  build. The `chatFocusSlot` doc in `contract.ts` names both attributes and the `[data-md-lines]` block rule, as the
  contract visual reads against.
- **When chat writes.** Chat writes through one writer in chat-view. It computes the value again and writes only when
  it differs (`isSameJson`). The writer takes an optional shown tab. `view.shown(tab)` passes its tab, and the writer
  computes from that tab. `view.shown` can run inside `addTab`, before `tab.handle` is set and before `tabs` holds
  the tab, so `visibleTab()` does not find it there. Every other write point passes no tab, and the writer computes
  from `visibleTab()`. The write points:
  - each focus change of a tab's entry list. `EntryListDeps` gains `focusChanged(): void`, which `setFocus` calls
    synchronously whenever `focus.stopId` changes.
  - a tab shown or hidden (`view.shown(tab)` and the tab's `hidden`).
  - a tab removed.
  - the composer stop holder's `changed`.
  - the view's `dispose`, which writes null before it tears down the tabs, because the slot outlives the part.
  The write is synchronous, so a `v` pressed right after `j` reads the new stop. Chat's page `start` publishes the
  slot, hands the view a `writeFocus(value)` dep, and writes null at once. The view's dispose does the stop's null
  write, so `start`'s own dispose adds no write.
- **`entryIdOfStop` and a new `blockIndexOfStop(stopId: string): number | null`** in `entry-focus.ts` split a stop id.
  The second returns the trailing `#<digits>` as a number, or null.
- **Visual finds the element** in `createVisualCommands`:
  - Deps: `focus: () => ChatFocus | null` replaces `chat`.
  - `VisualRegistry` gains `hosts(): HTMLElement[]` (every held host).
  - The entry is the `closest('[data-chat-entry]')` of the first held host for which that element's
    `dataset.chatEntry` equals `entryId`, and whose `closest('[data-chat-session]')` has `dataset.chatSession` equal
    to `sessionId`.
  - From the entry on, the code is as today: `hostsIn(entry)`, then the block element
    `entry.querySelectorAll('[data-md-lines]')[block]` and `hostsIn` of it for the start index.
  - A null focus logs `no focused entry`. A focus with no matching host logs `no visuals in the focused entry`, since
    an entry with no held host has no visual. The two log lines stay word for word.
- **Visual no longer depends on chat's page part.** `visual/page/start.ts` reads
  `api.state.read(chatFocusSlot)` and passes `() => focusSlot.get() ?? null`. The visual manifest moves `'chat'` from
  `dependsOn.page` to `reads.page`. `dependsOn.main` keeps `['chat']`.
- **Removal.** `focusedEntry` and `focusedBlock` leave `ChatPageExports` (and its doc lines), `ChatView`, chat's
  `exports`, and every caller and test fake (`visual/page/start.test.ts`, `visual/page/visual-commands.test.ts`).
  `EntryList.focusedElement` and `EntryList.focusedBlock` go too: chat-view (lines 668-678 at plan time) is their
  only caller outside tests. The `entry-list.test.ts` reads of them (lines 758, 1914, 1973, 2162-2167 at plan time)
  read through a test helper instead. The helper takes `list.place().focus.stopId`, finds the slot among
  `list.element`'s children whose `dataset.chatEntry` is `entryIdOfStop` of it, and takes that slot's
  `[data-md-lines]` element at `blockIndexOfStop` of it, or null for no block.
- AGENTS.md: the source map's `chat/` line says "page exports `focusedEntry` (the focused entry's element) and
  `focusedBlock` (the cursor's block element) to visual". Replace it with: the page publishes the `chat.focus` slot
  (the visible Chat tab's focused session, entry and block), which visual reads. The "A slot" bullet lists slots as
  examples ("among others") and needs no edit.

GIVEN a visible Chat tab whose cursor is on block 1 of message `e1` in session `s1` WHEN the cursor moves THEN
`chat.focus` holds `{ sessionId: 's1', entryId: 'e1', block: 1 }` before the key handler returns.
GIVEN a composer part's stop holds the cursor WHEN it takes the stop THEN `chat.focus` is null.
GIVEN `chat.focus` names `e1` in `s1`, and `e1`'s slot holds two visuals in blocks 1 and 2 WHEN `openVisuals` runs
with `block: 2` THEN the overlay opens on both sources at index 1.
GIVEN another session's tab holds an entry slot with the same entry id WHEN `openVisuals` runs THEN it opens only the
visible session's visuals.

Tests:
- `visual-commands.test.ts`: the existing tables keep their rows and cases. Their fakes build the entry as an
  `li` with `dataset.chatEntry` under a root with `dataset.chatSession`, and hand `focus` in place of the `chat`
  fake. Add the row "same entry id in another session" to the `openVisuals` table: a second session root holding an
  entry with the same id and one visual. It breaks if visual matches on the entry id alone.
- `visual-registry.test.ts`: extend the existing test with `hosts()` listing held hosts and leaving out disposed ones.
- `visual/page/start.test.ts`: replace the `fakeDependency(chatPageKey, …)` with a `chatFocusSlot` value written
  through the harness's state. The test keeps its rows.
- `entry-focus.test.ts`: extend the table `blockStopId of $entryId round-trips through entryIdOfStop` to assert
  `blockIndexOfStop` gives back `blockIndex` too, and add a table test `blockIndexOfStop_NoBlockSuffix_IsNull` with
  rows `e1` and `run-3`. It breaks if the index is read from the wrong end of the id.
- `chat-view.test.ts`: add one table test `chatFocus_FollowsTheVisibleTabsCursor` with rows:
  - cursor on a block → the value with `block`.
  - cursor on a non-message entry → `block: null`.
  - composer stop holding → null.
  - the tab hidden → null.
  - a tab shown inside `addTab` (the fake `addTab` calls `shown` before it returns, so the handle is not set) → the
    value of that tab's stop, not null.
  - the tab removed → null.
  - the view disposed → null.
  It breaks if a write is missed at a cursor move, stays deferred to the place tick, or reads `visibleTab()` on a
  shown event.
- `chat-view.test.ts`: assert that each tab root (`.chat-tab`) carries `dataset.chatSession` equal to its session
  id. It breaks if chat sets another attribute than the one visual finds by.
- `entry-list.test.ts`: extend the case that moves the cursor with a count of `focusChanged` calls (one per changed
  stop, none for a move to the same stop).
- `entry-list.test.ts`: replace `focusedElement_Stops_ReturnsTheFocusedSlot` with a table test
  `slot_EachKind_CarriesDataChatEntry` with rows: a message entry (its entry id), an activity slot (its run id), a
  queued slot (its queued message id). Each row asserts the slot's `dataset.chatEntry` and that it equals
  `entryIdOfStop` of the stop the cursor holds on that slot. It breaks if a slot kind is left unmarked or marked
  with another id than its stop's.
- `chat/page/start.test.ts`: add `chatFocus_Start_WritesNull`: after start with no tab, the `chatFocusSlot` value
  read through the harness's state is null. It breaks if `start` does not publish the slot.
- Self-test: chat's existing self-test step that opens visuals with `v` (`src/plugins/chat/main/selftest-script.ts`,
  "v opens on the second visual") runs filtered (`npm run selftest -- --plugin chat`), through the slot this time. Task 16 runs the live check by name: after a
  live restart of chat, `v` still opens the focused entry's visuals.

Done when: compiles; the tests named above pass by name; `grep -rn "focusedEntry\|focusedElement\|focusedBlock" src AGENTS.md` finds nothing;
`grep -n "chatPageKey" src/plugins/visual/page/start.ts` finds nothing; chat's self-test passes filtered. Task 15 removes the follow-up item.

Commit: one commit for the task.

## Proof

Commit 4615a79e · proof: diff read; ChatFocus, chatFocusSlot present, focusedEntry/focusedBlock gone; chat page and visual tests 959 pass; filtered chat self-test deferred to the test gate (main.ts mid-edit by 09/10 at the time) · concerns: chat self-test not yet run; stale focusedEntry mention in docs/features/practice/plan-practice-mode/03-chat-page-mount.md (another feature's plan)
