# 08 — Work and place survive a page reload

Status: not started
Type: Task
Wave: 5 · Depends on: 06, 07
Plan: [plan.md](plan.md)

Files:
- create `src/shared/page/place-slot.ts` · `src/shared/page/page-hide.ts` · test `src/shared/page/place-slot.test.ts`
- modify `src/shared/page/autosave.ts` · `src/shared/page/session-form-tabs.ts` · test `src/plugins/forms/page/autosave.test.ts` (holds `startAutosave`'s behaviour through forms)
- modify, sessions: `src/plugins/sessions/contract.ts` · `page/start.ts` · `page/session-tabs-view.ts` · `page/tabs.ts`; test `page/tabs.test.ts` · `page/session-tabs-view.test.ts`
- modify, chat: `src/plugins/chat/contract.ts` · `page/start.ts` · `page/chat-view.ts` · `page/chat-commands.ts` · `page/entry-list.ts`; test `page/start.test.ts` · `page/chat-commands.test.ts` · `page/entry-list.test.ts`
- modify, forms: `src/plugins/forms/contract.ts` · `page/start.ts` · `page/forms-view.ts` · `page/form-state.ts` · `page/autosave.ts`; test `page/start.test.ts` · `page/form-state.test.ts` · `page/forms-view.test.ts`
- modify, primer: `src/plugins/primer/contract.ts` · `page/start.ts` · `page/primer-view.ts` · `page/primer-state.ts`; test `page/start.test.ts` · `page/primer-state.test.ts`
- modify, docs: `src/plugins/docs/contract.ts` · `page/start.ts` · `page/docs-view.ts` · `page/doc-view.ts` · `page/tree-view.ts`; test `page/start.test.ts` · `page/doc-view.test.ts` · `page/tree-view.test.ts`
- modify, notes: `src/plugins/notes/contract.ts` · `page/start.ts` · `page/popup.ts` · `page/popup-state.ts`; test `page/popup.test.ts`
- modify, backlog: `src/plugins/backlog/contract.ts` · `page/start.ts` · `page/backlog-view.ts` · `page/backlog-state.ts`; test `page/backlog-state.test.ts` · `page/start.test.ts`
- modify, settings: `src/plugins/settings/contract.ts` · `page/start.ts` · `page/settings-view.ts`; test `page/settings-view.test.ts`

A plugin with no `contract.ts` today gets the file. Check each with `test -f`.

Consumes (copied, since `plan-commands-and-state/` is gone):
- `src/contracts/state.ts`:
  ```ts
  export interface SlotKey<V, P extends ProcessName = ProcessName, Plugin extends string = string> {
    readonly id: `${Plugin}.${string}`; readonly process: P; readonly kind: 'value'; readonly valueType?: V;
  }
  export interface KeyedSlotKey<V, P, Plugin> { /* same, kind: 'keyed' */ }
  export interface SlotWriter<V> extends Disposable { get(): V | undefined; set(value: V): void; }
  export interface KeyedSlotWriter<V> extends Disposable {
    get(key: string): V | undefined;
    all(): ReadonlyMap<string, V>;
    set(key: string, value: V): void;
    delete(key: string): void;
  }
  ```
- `api.state.publish(key)` returns the writer: it throws while a live part holds the key; a page load releases the old page's claims. `api.state.read(key)` returns a reader with `get()` and `on(listener)`. Slot values are JSON, enforced by `JsonSafe`.
- The page takes a snapshot before its parts start, so `writer.get()` in `start` reads the last page's value.
- The sessions rows slot of `plan-commands-and-state` task 11: its key in `src/plugins/sessions/contract.ts`. **plan.md does not name it.** This document writes `sessionsRowsSlot`; use the landed name. It reads `readonly SessionRow[]` or an equivalent list.
- The part harness's real slot store (`src/shared/plugin-part-harness.test-support.ts`): a test simulates a page load by starting a new part over the same store.
- `SessionsPageEvents.sessionRemoved`, `TakeOver`, the frame's `takeOvers` ← 07.
- `TextEditor.setText` reports no `changed`, and `insert` does (`src/contracts/editor.ts`).

Produces:
- `src/shared/page/place-slot.ts`:
  ```ts
  // Drops a write whose JSON equals the last one, so a store's every change costs one compare.
  export function placeWrites<V>(write: (value: V) => void): (value: V) => void;
  // Deletes every key `isLive` refuses: the row or form ended while no page ran.
  export function pruneKeys<V>(writer: KeyedSlotWriter<V>, isLive: (key: string) => boolean): void;
  ```
- `src/shared/page/page-hide.ts`: `export function onPageHide(listener: () => void): Disposable`, on `window`'s `pagehide`.
- `AutosaveDeps.onPageHide(listener: () => void): Disposable`, in `src/shared/page/autosave.ts`. It is a dep because the unit tests run in the `node` environment.
- Slot keys, each in its plugin's `contract.ts`, with `process: 'page'`:

| Key | Shape | Held per | Value |
|---|---|---|---|
| `chatPlaceSlot` | `KeyedSlotKey<ChatPlace,'page','chat'>` | session id | `{ draft: string; focus: EntryFocus; openRuns: string[]; openExpanders: Record<string, boolean[]> }` |
| `chatDraftImagesSlot` | `KeyedSlotKey<readonly ChatImage[],'page','chat'>` | session id | the attached images |
| `formsPlaceSlot` | `KeyedSlotKey<RoundPlace,'page','forms'>` | form id | `{ focus: number; reviewRow: number; view: 'forms' \| 'review' \| 'confirm'; confirmReturnView: 'forms' \| 'review'; confirmClosesSession: boolean }` |
| `primerPlaceSlot` | `KeyedSlotKey<PrimerPlace,'page','primer'>` | form id | `{ selectedTask: TaskRow; selectedItem: number \| null; pane: PrimerPane; view; confirmReturnView; confirmClosesSession }` |
| `docsPlaceSlot` | `KeyedSlotKey<DocsPlace,'page','docs'>` | view id | `{ openPath: string \| null; expanded: string[]; selectedId: string \| null; filter: string; edits: { path: string; text: string; baseText: string } \| null }` |
| `notesPlaceSlot` | `SlotKey<NotesPlace,'page','notes'>` | one | `{ isOpen: boolean; field: NoteField; imageIndex: number }` |
| `backlogPlaceSlot` | `SlotKey<BacklogPlace,'page','backlog'>` | one | `{ focus: BacklogFocus; homeCursor: number; openRoot: string \| null; selectedKey: string \| null; expanded: string[]; filter: string }` |
| `settingsPlaceSlot` | `SlotKey<SettingsPlace,'page','settings'>` | one | `{ sectionsCursor: number; openSectionId: string; cursorKey: string \| null; filter: string }` |
| `sessionsPlaceSlot` | `KeyedSlotKey<SessionsPlace,'page','sessions'>` | session id | `{ selectedTabId: string \| null; selections: number; takeOvers: TakeOver[] }` |

  `openExpanders` holds what `kit.expanders.openStates()` returns, per entry id.
- `SessionTabHandle.takeOver(options?: { restored?: boolean }): { release(): void }`, in `src/plugins/sessions/contract.ts`. `FormTabHandle.takeOver` and `SessionFormTabs.takeOver(formId, sessionId, restored: boolean)` follow.

Decisions:

- **Keyed slots: added beyond plan.md,** which writes `SlotKey` for every plugin. A plugin with one value per session or form uses `KeyedSlotKey`: a keystroke then sends one session's record, not every session's. Report it.
- **`sessionsPlaceSlot` and `chatDraftImagesSlot`: added beyond plan.md.** See below. Report them.
- **Every plugin uses one shape, so `place-slot.ts` is the one helper:** `start` publishes the key and reads `writer.get()`; the plugin restores; each change goes through `placeWrites` to the writer.
- **Writes happen on each change,** per plan.md. A store-backed plugin (forms, primer, notes, backlog) writes from its store subscription. Chat, docs and settings write from the listeners named below.

**Images in main's memory.** Each image is up to `MAX_IMAGE_BASE64`, 5 MB of base64. A session's attached images therefore sit in main's memory, and go to the page once in each snapshot. This is acceptable: there is one user, the set is what the user attached, a send or a removal frees it, and an app restart drops it. Images have their own key because a draft writes on each keystroke, and a keystroke must not resend 5 MB. `attachments.onChange` writes the images, and an empty list deletes the key.

**Chat.**
- `chat-view.ts`'s box `changed` (today `() => undefined`, in `tab.box = deps.editor.create`) writes the place.
- `setText` reports no `changed`, so the send and re-place sites in `chat-commands.ts` (measured at lines 454, 493, 551, 598, re-verify) leave a stale draft unless told. `ChatSession` gains `boxChanged(): void`, and each `setText` site calls it. A sent message must leave the slot, or a reload brings it back into the box.
- The tab's creation restores: `box.setText(place.draft)`, `attachments.add` per saved image, and `entries.restorePlace(place)`.
- `EntryList` gains `place(): Pick<ChatPlace, 'focus' | 'openRuns' | 'openExpanders'>` and `restorePlace(place)`, and calls a new `placeChanged` dep from `changed()`. `restorePlace` holds the values until the entries arrive. A saved stop no entry holds falls back to `START_FOCUS`. Saved open expanders use the existing `expanders.restore` path. Scroll follows the cursor; it is no separate value.

**Forms and primer.**
- A form's place is written while the form is open. `view`, `confirmReturnView` and `confirmClosesSession` are written only for the active form, since the state holds one view.
- `openForms`' read in `start.ts` dispatches `formShown`, then a new `placeRestored` action per form holding a key. A new form has no key, so it opens as today.
- **Restored rounds do not take over again.** `syncRoundViews` tests the key's presence before the form's first write, and passes the result as `restored`. A restored take over never selects. It adopts the saved `TakeOver` for that tab id, so its release gives back what the first take over took. No saved record: its release does nothing. A fresh take over replaces any saved record for its tab id. Primer's `syncPrimerViews` follows.
- Forms' and primer's autosave body stays in main. Focus is `RoundState.focus`, a rail position. Box focus and insert mode are not restored: the box's own scope comes from `shown`.

**Sessions.** Without the selected tab, a restored round that does not take over would leave the user on the first tab added. So `sessionsPlaceSlot` holds it.
- `session-tabs-view.ts` writes the place from `setTabs` and from every change to `frame.takeOvers`.
- A new frame reads the saved place and takes `selections` from it.
- When `add` adds a tab whose id equals the saved `selectedTabId`, and `tabs.selections` still equals the saved count, the tab selects uncounted. Forms' tab comes after the `openForms` read, so this rule handles a tab added late. A user's pick since the load raises the count and wins.
- Pure rule in `tabs.ts`: `tabsAfterRestoredAdd(tabs: TabsState, tabId: string, saved: SessionsPlace): TabsState`.

**Docs.**
- Key: the `viewId` `addView` takes. Docs mode's view and each `sessionSourceId(sessionId)` view have one each.
- Tree: `TreeView` gains `place()` and `restorePlace()`, over `TreeState`, with `expanded` as an array. It restores before the first `setTree`, so the first tree's default expansion does not overwrite it.
- Open doc: restore goes through `openDoc(path, null)`, so a doc the index no longer lists toasts as today, and its edits stay in the slot until the view's next write replaces them.
- **Unsaved edits.** The editor's `changed` (today `() => undefined`, measured at line 708) writes `edits`. `baseText` is `shown.text` when the write happens. On restore, the pane opens the editor and calls `setText(edits.text)`. `hasUnsavedEdits` compares `editor.text()` with `shown.text`, so it reads true with no new state. When the file on disk differs from `baseText`, the view opens the existing changed-on-disk prompt, so the user's edits overwrite nothing without asking. A saved or closed editor writes `edits: null`.

**Notes.** Fields and images live in main (`saveDraft`). The place holds the popup's open state and cursors. On load, `isOpen` true opens the popup through its usual open path, and the cursors apply after `loadDraft`. An open markup session is not restored: the popup returns on its fields. Report this as a limit.

**Backlog.** `placeRestored` applies once the first homes load, as a state action in `backlog-state.ts`. `pendingSelect` stays out. A saved `openRoot` no home holds opens no home. The filter value applies with its box closed.

**Settings.** `settings-view.ts`'s local `sectionsCursor`, `openSectionId` and `cursorKey`, and the filter box's value, write on each change. `restorePlace` runs before the first draw. A saved `cursorKey` no row holds leaves the cursor as the first draw sets it. An open editing box is not restored; the brief lists cursor and filter only.

**Who clears what.**

| Key | Cleared when | While no page runs |
|---|---|---|
| `chatPlaceSlot`, `chatDraftImagesSlot`, `sessionsPlaceSlot` | `sessions.sessionRemoved` deletes the key | `pruneKeys` in `start`, against `sessionsRowsSlot`. Skip the prune when the rows read undefined |
| `docsPlaceSlot`, session views | `sessions.sessionRemoved` deletes `sessionSourceId(id)` (`docs/page/start.ts`, measured at line 449) | the same prune; docs mode's own key stays |
| `formsPlaceSlot`, `primerPlaceSlot` | the store's form leaves (`formClosed`): delete its key | `pruneKeys` after `openForms` settles, against the forms that read returned. A failed read prunes nothing |
| notes, backlog, settings | one value, overwritten | none needed |

A row ending clears the place, as the tab's own state goes with it today. An app restart loses every slot, by plan.md's scope.

**Autosave flush.** `startAutosave` subscribes `deps.onPageHide` and disposes it in `dispose`. The listener runs: for each draft in `drafts()` with `saveState(draft) === 'unsaved'`, cancel its pending timer and call `saveDraft` at once. `saveDraft` reaches `deps.save`, and `channel.invoke`, before its first `await`. So the invoke leaves within the `pagehide` listener. A draft already saving at its latest revision is left alone. Forms, primer and notes pass `onPageHide`.

**Whether a write sent during `pagehide` reaches main.** The tree cannot show this. `ipcRenderer.invoke` posts within the listener, but a reload may tear the frame down before main handles it. So two pins:
- The test `pagehide_saves_every_unsaved_draft_synchronously` proves the call happens inside the listener.
- The live check in [11](11-final-verification.md), tagged low-confidence, proves main holds the text after a reload.

Slot writes are sent on each change, before `pagehide`, so only autosaves carry this question.

GIVEN a typed chat draft and an attached image WHEN the page reloads THEN the box and the image row hold them, and the cursor stop and open runs are back.
GIVEN a sent message WHEN the page reloads THEN the box is empty.
GIVEN a round on the review view, row 3, WHEN the page reloads THEN the review view shows at row 3, and the answers typed are in.
GIVEN the user moved from an open round's tab to Chat WHEN the page reloads THEN Chat stays selected.
GIVEN a restored round the user stays on WHEN it submits THEN the tab it took over from selects again.
GIVEN a round shown for the first time after a reload THEN it takes over, as today.
GIVEN typing within the autosave delay WHEN the page reloads THEN the restored form holds that text.
GIVEN an open doc with unsaved edits WHEN the page reloads THEN the editor holds them, the tree keeps its expansion, and closing the session refuses as today.
GIVEN those edits, and the file changed on disk during the reload, THEN the changed-on-disk prompt opens.
GIVEN a session whose row ended while no page ran WHEN the page loads THEN its keys are gone, and a new row of that session starts empty.
GIVEN a backlog filter, home and selected row, or a settings cursor and filter, WHEN the page reloads THEN they are back.

Tests (each "reload" row starts a second part over the same harness store):
- `place-slot.test.ts`: `equal_value_writes_once`, which catches a write per store change with no change in it; `prune_deletes_only_dead_keys`.
- `forms/page/autosave.test.ts`: `pagehide_saves_every_unsaved_draft_synchronously`, which catches a flush deferred past the listener; `pagehide_leaves_a_saved_draft_and_a_saving_revision_alone`, which catches a double save; `dispose_stops_the_pagehide_listener`.
- `sessions/page/tabs.test.ts`: `restored_add_selects_the_saved_tab_only_with_no_pick_since`, which catches a late Form tab stealing a user's pick.
- `sessions/page/session-tabs-view.test.ts`: `restored_take_over_keeps_selection_and_its_release_gives_back_the_saved_tab`, which catches a restored round yanking the session. `fresh_take_over_replaces_a_stale_saved_record`.
- `chat/page/start.test.ts`: `reload_restores_draft_images_and_place`; `row_removed_clears_the_place`; `row_gone_during_reload_is_pruned`, which catches a place outliving its row.
- `chat/page/chat-commands.test.ts`: `send_clears_the_saved_draft`, which catches `setText` reporting no `changed`.
- `chat/page/entry-list.test.ts`: `restored_stop_that_no_entry_holds_falls_back`.
- `forms/page/start.test.ts`: `reload_restores_focus_review_row_and_view`, `form_closed_deletes_its_place`, `closed_while_no_page_ran_is_pruned`. `forms/page/forms-view.test.ts`: `restored_round_passes_restored_and_new_round_does_not`. Primer: the same rows in its `start.test.ts`, as one table when the harness allows.
- `docs/page/doc-view.test.ts`: `restored_edits_read_as_unsaved`, `restored_edits_with_changed_disk_open_the_prompt`, which catches a silent overwrite. `docs/page/tree-view.test.ts`: `restored_expansion_survives_the_first_tree`, which catches `defaultExpandedIds` overwriting it. `docs/page/start.test.ts`: `reload_reopens_the_doc_per_view`.
- `notes/page/popup.test.ts`: `reload_reopens_with_cursors`.
- `backlog/page/backlog-state.test.ts`: `placeRestored` table, rows for a gone home and a gone row. `settings/page/settings-view.test.ts`: `restores_cursor_and_filter`, row for a gone key.

Done when: every key in the table is in its `contract.ts`; each plugin's manifest `reads` includes `sessions` where its prune reads the rows slot; compiles; the test gate runs the tests above. The live checks are in [11](11-final-verification.md).
Commit: one commit for the group.

## Proof
