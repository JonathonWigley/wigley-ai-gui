# 14 — Events for every moment

Status: in progress
Type: Batch
Wave: 12 · Depends on: 12, 13
Plan: [plan.md](plan.md)

Files:
- chat: modify `src/plugins/chat/contract.ts`, `src/plugins/chat/main/chat-sessions.ts` · test `src/plugins/chat/main/chat-sessions.test.ts`
- docs: modify `src/plugins/docs/contract.ts`, `src/plugins/docs/main/start.ts`, `src/plugins/docs/page/start.ts`, `src/plugins/docs/page/docs-view.ts` · test `src/plugins/docs/main/start.test.ts`, `src/plugins/docs/page/start.test.ts`
- backlog: modify `src/plugins/backlog/contract.ts`, `src/plugins/backlog/main/start.ts` · test `src/plugins/backlog/main/start.test.ts`
- notes: modify `src/plugins/notes/contract.ts`, `src/plugins/notes/main/note-sender.ts`, `src/plugins/notes/main/start.ts` · test `src/plugins/notes/main/note-sender.test.ts`
- sessions: modify `src/plugins/sessions/contract.ts`, `src/plugins/sessions/page/start.ts`, `src/plugins/sessions/page/row-activities.ts`, `src/plugins/sessions/page/sessions-view.ts` · test `src/plugins/sessions/page/start.test.ts`, `src/plugins/sessions/page/row-activities.test.ts`
- visual: modify `src/plugins/visual/contract.ts`, `src/plugins/visual/page/start.ts`, `src/plugins/visual/page/visual-overlay.ts` · test `src/plugins/visual/page/visual-overlay.test.ts`
- keys: modify `src/plugins/keys/contract.ts`, `src/plugins/keys/page/start.ts` · test `src/plugins/keys/page/start.test.ts`

Consumes:
- `chatSessionSlot`, `chatControlsSlot` in `src/plugins/chat/contract.ts` ← 12
- `KeyedSlotKey`, `KeyedSlotWriter`, `api.state.publish` ← 05
- The slots of tasks 11 and 13, by name, only to rule events out

Produces, each typed in the plugin's `contract.ts`:

`src/plugins/chat/contract.ts`, on the existing `ChatMainEvents`:

```ts
messageSent: { sessionId: string; entryId: string };
turnStarted: { sessionId: string };
turnFinished: { sessionId: string; how: 'idle' | 'rested' };
```

`src/plugins/docs/contract.ts`, on the existing `DocsMainEvents`, and a new page interface:

```ts
docSaved: { path: string };
docCreated: { path: string };
docTrashed: { path: string; trashed: string[] };
docRenamed: { from: string; to: string };

export interface DocsPageEvents extends EventShape { docOpened: { path: string }; }
```

`src/plugins/backlog/contract.ts` (new interface):

```ts
export interface BacklogMainEvents extends EventShape {
  followupCreated: { homeRoot: string; title: string };
  followupEdited: { homeRoot: string; title: string };
  followupDeleted: { homeRoot: string; title: string };
}
```

`src/plugins/notes/contract.ts` (new interface):

```ts
export interface NotesMainEvents extends EventShape {
  noteSent: { projectDir: string };
  noteFiled: { request: FollowupRequest };
}
```

`src/plugins/sessions/contract.ts`, on the existing `SessionsPageEvents`, and a new slot:

```ts
tabAdded: { sessionId: string; tabId: string };

export interface RowActivitySource { sourceId: string; activity: RowActivity; }
export const sessionsActivitySlot: KeyedSlotKey<RowActivitySource[], 'page', 'sessions'> =
  { id: 'sessions.activity', process: 'page', kind: 'keyed' };
```

`src/plugins/visual/contract.ts`: `export interface VisualPageEvents extends EventShape { visualOpened: { count: number; index: number }; }`

`src/plugins/keys/contract.ts`: `export interface KeysPageEvents extends EventShape { helpOpened: null; }`

Each plugin's `*Api` alias takes its interface as the events parameter, as `DocsApi` in `docs/main/start.ts` does with `DocsMainEvents`. No plugin hears these yet, so no manifest's `reads` changes.

Decisions:

**The list.** Each row of the state map's item table, with docs rename added.

| Item | Result | Reason |
|---|---|---|
| Core mode, scope, window focus, theme | slot, no event | `core.*` slots, task 06 |
| Core config changed | no event | `onSettingsChanged` and the config store's `onChanged` stay callbacks; neither plan.md nor task 06 adds an event |
| Core page ready | event `core.pageReady` | task 06 |
| Chat message sent | event `messageSent` | a moment; the entry is in `chat.entries` |
| Chat turn started and finished | events `turnStarted`, `turnFinished` | moments; the running state is in `chat.session` |
| Chat control changed | slot, no event | `chat.controls`, task 12; a reader hears its notice |
| Docs opened, saved, created, trashed, renamed | events | moments |
| Backlog created, edited, deleted | events | moments; `changed` stays for its page |
| Backlog applied | no event | the user's answer: "applied" is only `FollowupEditResult`'s `type`, an edit that landed, and it has no action of its own |
| Workflow flow and stage | slot, no event | task 13; no moment was named for a stage change |
| Agents roster | slot, no event | task 13 |
| Usage snapshot | slot, no event | task 13 |
| Notes sent or filed | events | moments |
| Sessions activity set | slot `sessions.activity` | a late reader wants the row's activities |
| Sessions tab added | event `tabAdded` | a moment; no reader wants a tab list today, so no slot |
| Visual opened | event `visualOpened` | a moment |
| Help opened | event `helpOpened` | a moment; no reader wants the open flag, so no slot |

**Chat's turn events do not duplicate `agentEvent`.** They state different facts, and the `contract.ts` comment says which to hear.
- `agentEvent` `turnStarted` and `turnEnded` report the harness stream, replays included with `replayed: true`. Workflow folds them through `signalOf`, and it stays on them.
- `chat.turnStarted` and `chat.turnFinished` report the row's shown `activity` crossing idle. That also covers a compaction running with no harness turn, and a process exit with no `turnEnded`. A plugin that wants "the row's work began or ended" hears these and filters nothing.
- No listener of `agentEvent` moves in this task.
- Each bus is per process, so a page plugin reads `chat.session` instead.

**Chat emit sites**, in `chat-sessions.ts`:
- `messageSent`: in `deliver`, right after `process.send(message)` returns `entryId`. Every write goes through `deliver` (`writeRowNow`, `deliverWritten`), so this is the one site. A queued message fires when it is written, not when it queues. A throwing `send` fires nothing.
- `turnStarted` and `turnFinished` with `how: 'idle'`: in `updateActivity`, on its `turnStarted` and `turnFinished` booleans, when `isReplayed` is false. Fire them whatever else `announceTurnFinished`'s condition says: a stopped turn and a turn in the background still crossed idle. `updateActivity` has three callers (lines 1125, 1182 and 2653, measured at plan time, re-verify), and only line 1182 passes `replay.isReplaying`. Check the other two for a path a replay reaches, and pass the flag there.
- The emit in `updateActivity` sits after the `activity` slot write and `updateActiveTime`, and before `announceTurnFinished`. A listener that reads `chat.session` then finds the new `activity` and a current `activeTime`.
- `turnFinished` with `how: 'rested'`: in `showRestingIdle`, when the activity was not idle before it and no replay runs. That path sets idle without `updateActivity`. The emit sits after the `activity` slot write and `updateActiveTime`, for the same reason.
- The preview emits none of them: it runs no turn.

**Docs emit sites**, in `docs/main/start.ts`, after the awaited call and in the plain consts all paths share (`writeDoc`, `writeBytes`, `trashDoc`), so the `DocsMainExports` paths emit too. `DocFiles` stays unaware.
- `docSaved`: `writeDoc` when the result is `{ type: 'written' }`, not on `changedOnDisk`. `writeBytes` when it resolves. A follow-up edit that Backlog writes through `docs.writeDoc` is a doc saved, so it fires too.
- `docCreated`: the `createDoc` handler, with `CreatedDoc.path`.
- `docTrashed`: `trashDoc`, when `trashed.length > 0`. A partial trash with an `error` still fires for what went.
- `docRenamed`: the `renameDoc` handler, with `from` and the resolved path as `to`.
- A rejected call emits nothing.
- `docOpened`: on the page, in `docs-view.ts` at both `doc.open` sites (lines 525 and 575, measured at plan time, re-verify), when `doc.open` resolves true. A new `docOpened(path: string)` on the view's deps carries it to `docs/page/start.ts`, which emits. `openChanged` is not the site: it also runs for a close and a rename.

**Backlog emit site.** One site: the `result.type === 'applied'` block in `applyEdit` (`backlog/main/start.ts:571`, measured at plan time, re-verify). Page edits and `fileNote` both pass there.
- `create` fires `followupCreated` with `draft.title`.
- `edit` fires `followupEdited` with `draft.title`. `setTags` fires `followupEdited` with `title`.
- `delete` fires `followupDeleted` with `title`.
- `commit` emits nothing: it changes no follow-up, and the list does not name it.
- `channel.send('changed')` stays as it is at all its sites. It is the page's channel, and a file watch has no item to name.
- `applyEdit` sends no `changed`. A page edit reaches the page through the file watch (`watchFile`, `backlog/main/start.ts:421`, measured at plan time, re-verify). Only `fileNote` sends `changed` after its edit lands (line 780).

**Notes emit sites**, in `note-sender.ts`. `NoteSenderDeps` gains `emit: PluginEvents<NotesMainEvents>['emit']`, as `ChatSessionsDeps` has. The sender is the site because `drive-actions.ts` and the channel handlers both reach it.
- `noteFiled`: `toFollowup` when the result is `sent`, with its `request`.
- `noteSent`: `toSession` when the result is `sent`, with its `projectDir`.
- `refused` emits nothing.

**Sessions.**
- `tabAdded`: in `sessions/page/start.ts`'s `addTab` export (line 123, measured at plan time, re-verify), after `view.tabs.add` returns, with `tab.id`.
- `sessions.activity`: the key is the session id. The value is the list of `{ sourceId, activity }` in last-set order. A list rather than a record because "the latest set winning a tie" depends on that order.
- `createRowActivities` takes the `KeyedSlotWriter<RowActivitySource[]>` as its one parameter, in place of its `bySession` map. It keeps `set`, `top` and `forget` with their signatures. A session with no sources is `delete`d, not an empty list.
- `forget(sessionId)` deletes the session's key. `sessions-view.ts` still calls it when a row is removed.
- `set` still returns whether the row's shown activity changed, so `drawSidebar` runs as often as today.
- `createRowActivities` is called in `sessions-view.ts` (line 206, measured at plan time, re-verify). `sessions/page/start.ts` publishes the slot and passes the writer to the view through a new `activities` member on the view's deps, so the factory runs after `publish`.
- The value is page-owned, so it stays in main across a page load. The contract says every page load starts with none. So at the sessions part's start, after `publish` and before the view mounts, delete every key the writer's `all()` holds. Each source sets its activity again on the new page, as it does today.

**Visual.** `visualOpened`: at the end of `overlay.open` in `visual-overlay.ts`, through a new `opened(count: number, index: number)` on `VisualOverlayDeps`. Carry the counts only: the sources are whole documents.

**Keys.** `helpOpened`: in `toggleHelp` in `keys/page/start.ts`, on the branch that opens help, after `keys.pushScope('help')`. Closing help emits nothing. The list names only the open.

GIVEN a message queued during a turn WHEN the turn ends and main writes it THEN `chat.messageSent` fires once, at the write.
GIVEN a replay at startup WHEN its turns cross idle THEN neither turn event fires.
GIVEN a running turn whose process exits WHEN the session rests THEN `chat.turnFinished` fires with `how: 'rested'`.
GIVEN a write that finds the file changed on disk WHEN `writeDoc` resolves THEN `docs.docSaved` does not fire.
GIVEN a follow-up deleted WHEN the edit lands THEN `backlog.followupDeleted` fires and no other backlog event fires.
GIVEN a note filed as a new follow-up WHEN the edit lands THEN `backlog.followupCreated` fires and the page gets `changed`.
GIVEN a refused edit WHEN `applyEdit` returns THEN no backlog event fires.
GIVEN an activity set by a source WHEN the page reloads THEN `sessions.activity` holds no old key.
GIVEN two sources with one rank WHEN the second sets THEN the row shows the second, and the slot's list ends with it.

Tests, each at the seam that owns the emit:

`chat-sessions.test.ts`:
- `messageSent_RowQueuedThenWritten_FiresAtWrite` — table: idle send, queued then written, send now, throwing write (no event). Catches an emit moved to `send` or to `queueRow`.
- `turnEvents_ActivityCrossesIdle_FireOncePerCrossing` — table: start and idle; waiting then idle (one finish); replay (none); rest (`how: 'rested'`); stop all (fires). The listener reads `chat.session` on each event and asserts the new `activity` and a current `activeTime`. Catches a copy of `announceTurnFinished`'s condition, a rest with no finish, and an emit before the slot write.

`docs/main/start.test.ts`:
- `docEvents_CallLands_FireOnlyThen` — table: written, changed on disk (none), bytes, create, rename, trash with targets, trash with none (none), rejected guard (none). Catches an emit before the await, and `changedOnDisk` counted as saved.

`docs/page/start.test.ts`:
- `docOpened_DocOpens_FiresOnlyThen` — a missing doc fires none. Catches an emit on `openChanged`.

`backlog/main/start.test.ts`:
- `followupEvents_EditLands_FireByType` — table per `FollowupEdit` type, with `setTags` as edited; `missing`, `titleTaken` and `refused` fire none; `fileNote` create fires created. Each landed row asserts one event. Only the `fileNote` rows assert `changed`, because `applyEdit` sends none. Catches a refused edit fired, a second event on one edit, and `changed` removed from `fileNote`.

`note-sender.test.ts`:
- Add rows to the existing send tests: `sent` fires its event, `refused` fires none. Catches an emit before the result.

`row-activities.test.ts`:
- Its existing tie and removal cases run over a real slot store's writer, and assert the list order. Add `rowActivities_NoSourcesLeft_HoldsNoKey`.
- Add `rowActivities_Forget_HoldsNoKey` — catches a removed row's key left in the slot.

`sessions/page/start.test.ts`:
- `addTab_TabAdded_FiresTabAdded` — catches an emit outside the export.
- `sessionsStart_OldPageActivities_Cleared` — a seeded key is gone after start. Catches stale activities across a reload.

`visual-overlay.test.ts`:
- Add `overlayOpen_Opens_ReportsCountAndIndex`, including a second `open`.

`keys/page/start.test.ts`:
- `toggleHelp_OpenAndClose_FiresOnOpenOnly` — catches a toggle emitting both ways.

Runtime checks are in [Final verification](16-final-verification.md). These events have no screen, so they earn no live check.

Done when: compiles and lints; each `contract.ts` holds the names above; `grep -n "emit('\(messageSent\|turnStarted\|turnFinished\)'" src/plugins/chat/main/chat-sessions.ts` prints the sites above; the test gate runs the tests above.

Commit: one commit for the group.

## Proof
