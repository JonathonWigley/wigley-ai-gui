# 12 — Chat session state as slots

Status: not started
Type: Task
Wave: 11 · Depends on: 11
Plan: [plan.md](plan.md)

Files:
- create `src/plugins/chat/main/chat-slots.ts` · test `src/plugins/chat/main/chat-slots.test.ts`
- modify `src/plugins/chat/contract.ts`
- modify `src/plugins/chat/main/chat-sessions.ts` · test `src/plugins/chat/main/chat-sessions.test.ts`
- modify `src/plugins/chat/main/start.ts` · test `src/plugins/chat/main/start.test.ts`
- modify `src/plugins/chat/main/preview/chat-preview.ts` · test `src/plugins/chat/main/preview/chat-preview.test.ts`
- modify `src/plugins/chat/page/chat-view.ts` · test `src/plugins/chat/page/chat-view.test.ts`
- modify `src/plugins/chat/page/start.ts` · test `src/plugins/chat/page/start.test.ts`
- modify `src/plugins/chat/main/selftest-script.ts` only where a log line moves
- modify `docs/features/agent-chat/design.md` (lines 277 and 319 name `ChatSessionState.queued` and `.returned`, measured at plan time, re-verify)

Consumes:
- `KeyedSlotKey`, `ListSlotKey`, `KeyedSlotWriter`, `ListSlotWriter`, `KeyedSlotReader`, `ListSlotReader`, `ListSlotChange` in `src/contracts/state.ts` ← 05
- `api.state.publish` and `api.state.read` on `MainApi` and `PageApi` ← 05
- `createSlotStore(log: Log)` in `src/shared/state/slot-store.ts`, and the real slot store on the part harness ← 05
- Page parts start after the page mirror holds the snapshot ← 05
- `sessionsRowsSlot` and `followRows(rows, { removed })` from `src/plugins/sessions/contract.ts` on the page ← 11. The `sessionRemoved` event is gone.
- `delivery` on the user `ChatEntry` ← plan-delivery-state, a precondition. This task assumes it landed.

Produces, in `src/plugins/chat/contract.ts`:

```ts
// The small values of one session. Whole value per change.
export interface ChatSessionInfo {
  sessionId: string;
  projectDir: string;
  profile: string;
  activity: ProcessActivity;
  background: number;
  activeTime: ActiveTime;
  running: boolean;
  compaction: SessionCompaction | null;
  repo: string;
  branch: string | null;
}
// What the slots add up to for one session.
export interface ChatSessionState extends ChatSessionInfo {
  entries: ChatEntry[];
  controls: SessionControl[];
  commands: AgentCommand[];
  queued: QueuedMessage[];
  returned: ReturnedMessage[];
}
export const chatSessionSlot: KeyedSlotKey<ChatSessionInfo, 'main', 'chat'> = { id: 'chat.session', process: 'main', kind: 'keyed' };
export const chatEntriesSlot: ListSlotKey<ChatEntry, 'main', 'chat'> = { id: 'chat.entries', process: 'main', kind: 'list' };
export const chatControlsSlot: KeyedSlotKey<SessionControl[], 'main', 'chat'> = { id: 'chat.controls', process: 'main', kind: 'keyed' };
export const chatCommandsSlot: KeyedSlotKey<AgentCommand[], 'main', 'chat'> = { id: 'chat.commands', process: 'main', kind: 'keyed' };
export const chatQueuedSlot: KeyedSlotKey<QueuedMessage[], 'main', 'chat'> = { id: 'chat.queued', process: 'main', kind: 'keyed' };
export const chatReturnedSlot: KeyedSlotKey<ReturnedMessage[], 'main', 'chat'> = { id: 'chat.returned', process: 'main', kind: 'keyed' };
```

Every key in every slot is the session id. The item id in `chat.entries` is `ChatEntry.id`.

Produces, in `src/plugins/chat/main/chat-slots.ts`:

```ts
export interface ChatSlotWriters {
  session: KeyedSlotWriter<ChatSessionInfo>;
  entries: ListSlotWriter<ChatEntry>;
  controls: KeyedSlotWriter<SessionControl[]>;
  commands: KeyedSlotWriter<AgentCommand[]>;
  queued: KeyedSlotWriter<QueuedMessage[]>;
  returned: KeyedSlotWriter<ReturnedMessage[]>;
}
// One session's view of the slots. The only path chat main and the preview read or write a session's state.
export interface SessionSlots {
  readonly sessionId: string;
  read(): ChatSessionState;
  info(): ChatSessionInfo;
  setInfo(change: Partial<Omit<ChatSessionInfo, 'sessionId' | 'projectDir' | 'profile'>>): void;
  entries(): readonly ChatEntry[];
  putEntry(entry: ChatEntry): void;
  replaceEntries(entries: readonly ChatEntry[]): void;
  controls(): SessionControl[];
  setControls(controls: SessionControl[]): void;
  commands(): AgentCommand[];
  setCommands(commands: AgentCommand[]): void;
  queued(): QueuedMessage[];
  setQueued(queued: QueuedMessage[]): void;
  returned(): ReturnedMessage[];
  setReturned(returned: ReturnedMessage[]): void;
  close(): void;
}
export interface ChatSlots { open(state: ChatSessionState): SessionSlots; }
export function createChatSlots(writers: ChatSlotWriters): ChatSlots;
```

`ChatSessionsDeps` and the preview's deps each gain `slots: ChatSlots`. `HeldSession` gains `sessionId: string` and `slots: SessionSlots`, and loses `state`.

Decisions:

**Slot shape.** Six slots, not one and not one per field. The split follows size and the listener, not the rate.
- The rate does not force a split. `activeTime` holds a start time and a total, and the page computes the clock. Main writes it at each start, stop and `/clear` reset, about twice per turn, not per tick. `activity` writes only on a change of the shown value (`updateActivity` returns when it is the same), so a few writes per turn. `entry` is the only per-chunk value, and it has its own slot.
- `chat.session` holds the small values: identity, `activity`, `background`, `activeTime`, `running`, `compaction`, `repo`, `branch`. A late reader gets a value it can trust in one read: `isWorking` reads `activity` and `running` together. A write is about 300 bytes (estimate).
- `chat.queued` and `chat.returned` are apart because a row carries `images`. One image in the queue must not ride on every `activity` write.
- `chat.commands` is apart because it is a large list that seldom changes.
- `chat.controls` is apart because a fresh list from the Bridge never compares equal by identity. Inside `chat.session` it would redraw on each `activity` write.
- Rejected: one keyed value for the whole session. It ships images on each activity change.
- Rejected: one slot per field. It gives 12 keys for one owner, and no reader takes one field alone.

**Messages.** Each message and invoke of `ChatChannel` ends as below. The contract's comments that say "arriving as `entries`", "arriving as `queued`", "arriving as `returned`" and "sent as `activeTime`" are rewritten to name the slot.

| Today | After |
|---|---|
| `invoke.sessions` | goes |
| `sessionStarted` | goes: a new key in `chat.session` |
| `entry` | goes: `chat.entries` `put` |
| `entries` | goes: `chat.entries` `replace` |
| `controls` | goes: `chat.controls` |
| `commands` | goes: `chat.commands` |
| `queued` | goes: `chat.queued` |
| `returned` | goes: `chat.returned` |
| `activity`, `background`, `activeTime`, `compaction`, `branch`, `sessionRunning` | go: `chat.session` |
| `sessionRested` | stays, for the moment only: the unseen mark and its row draw, `visibleSessionRested`, the error toast and the `rested` log lines. `running: false` and its draws are in `chat.session`. |
| `invoke.returnedPlaced`, `invoke.loaded`, `logInLink`, `logInEnded` | stay |

`chat/main/start.ts`'s `sessions` handler goes, and `ChatPreview.states()` goes with it (its only caller is that handler, measured at plan time, re-verify).

**Owners read through the writer.**
- `HeldSession.state` goes. `session.state` has 131 lines in `chat-sessions.ts` (measured at plan time, re-verify). Each read and write moves to `session.slots` or `session.sessionId`.
- `copyState` and `upsertEntry` go. `ChatSlots` assembles the copy, and `put` does the upsert.
- `ChatSessions.sessions()` stays for the drive actions, the fixtures and the tests. It returns `[...held.values()].map((session) => session.slots.read())`.
- The preview's `shown.state` goes the same way.
- The `held` map stays. It holds what is live and not JSON: `owned`, `process`, `pending`, `attaching`, `historyRead`, `unheldSettling`, `replay`, and the plain counters and sets outside `ChatSessionState` (`writtenMessages`, `backgroundIds`, `confirmedPicks`, `pendingPicks`, `returnedDrops`).
- `rowOrders` changes from `WeakMap<QueuedMessage, number>` to `Map<string, number>` keyed by row id. A slot value's object identity is no contract.
  - Only `appendQueued` sets an id. `writeRowNow` and `releaseHeldRow` lose their `rowOrders.set`, because the fresh row keeps its id.
  - An id goes only when no path can read that row's order again, where today's `WeakMap` entry becomes unreachable. The sites: `returnAllHeld` (every queued id, after it reads their orders), `returnUnsent` (the unsent ids), `takeIn` and `returnDropped` (the sent row's id), `holdForCompaction`'s catch (the held row's id), `pullBack` (the pulled row's id), and `writeNextQueued` after `deliverWritten` returns.
  - `writeNextQueued` filters the row out and then calls `rowOrderOf`, and its catch puts the row back. So the id stays across the filter and stays on a throw. After `deliverWritten` returns, `writtenMessages` holds the order.
  - A row sent now stays in the queue with `sentEntryId` set, so its id stays until `takeIn` or `returnDropped`.
  - The sites that compare rows by object compare `id` instead: `writeNextQueued`, `writeRowNow`, `releaseHeldRow`, `holdForCompaction`'s catch and `pullBack`.
- A value is never mutated after a `set`. Every site already assigns a new list.

**Close.** The comment on `drop` says later events for a session are ignored, but `cancelPending` and a closing process still reach state.
- `drop` calls `session.slots.close()` first, then `held.delete`, then `cancelPending`.
- `close()` assembles the last `ChatSessionState` once into a private detached object. It then deletes the session's key in all six slots, `chat.session` first, so no reader finds a session key with half its lists gone.
- After `close()`, reads and writes on that `SessionSlots` use the detached object and write no slot. A late write can then not bring a closed session's key back and redraw its tab. This object is the one copy, and only after the key is gone.

**Order.**
- `ChatSlots.open` writes `entries`, `controls`, `commands`, `queued` and `returned`, then `chat.session` last. The write sits where `send('sessionStarted', …)` is today, after `sessionOpened`.
- The page builds a tab when a `chat.session` key has no tab, and reads the other five slots from the mirror at that moment.
- Other writes sit where the `send` is today. `sendQueued` becomes `save()`, and the `setQueued` sits at the assignment, so each assignment to the queue is one slot write. Do not coalesce them.
- The wire count does not change at a site with one assignment per `sendQueued`. `writeNextQueued` is one: today it already sends between its two changes.
- The wire count rises at two sites, because `appendQueued` and `writeRowNow` assign with no send today (line numbers measured at plan time, re-verify):
  - `sendAllNowSettled` (lines 2116 to 2126) runs one `appendQueued` and one `writeRowNow` per unsent row before its one `sendQueued`.
  - The restore loop (lines 1433 to 1436) runs one `appendQueued` per saved row before its one `sendQueued`.
- Each middle value is a valid queue, because each row in it is complete. The page draws it and logs `<n> pending message(s) in <name>` once per write. This is accepted.
- Slot changes and `sessionRested` keep today's relative order, since both leave main in send order on one `webContents`.
- Main writes `running: false` at the assignment, before `sessionRested`, on a process exit (lines 1252 and 1271) and on a failed re-attach (lines 1698 and 1704). So the page's `running` block runs first.
- `sessionRested`'s `wasActive` reads `tab.state.activity`. On a process exit, main writes idle after `sessionRested`, so `wasActive` and `chatView_ErrorRest_ToastsOnce` read the activity from before the rest. On a failed re-attach, main writes idle first, as today.

**Page.**
- `channel.invoke('sessions')` and its catch go. At view start the page runs `add` over `reader.session.all()`, inside the same try and log as today (`chat session arrival failed`). Then it subscribes. The mirror holds the snapshot before the part starts, so no push can land between the read and the subscribe.
- The hypothesis in the state map, that a push before the `sessions` reply is dropped, ends here: the reply no longer exists, so no test pins it and no rule replaces it.
- `heldFor` and its log line `<message> for unknown session <id> ignored` go. A change for a key with no tab returns in silence: nothing is lost, because `add` reads the mirror when the `chat.session` key arrives.
- A deleted key does nothing on the page, in all six listeners: value `undefined` in `chat.session`, `chat.controls`, `chat.commands`, `chat.queued` and `chat.returned`, and `{ kind: 'delete' }` in `chat.entries`. The listener returns before `rebuild`, `setControls`, `setQueued` or `placeReturned`. The tab stays as drawn until `onSessionRemoved`, the only teardown, hears the sessions plugin's `removed` follow.
- `tab.state` stays as the view's last applied `ChatSessionState`. It is a reader's baseline for comparing a `chat.session` write, not an owner's copy, and 32 lines read it (measured at plan time, re-verify).
- The `chat.session` listener compares each value with `tab.state` and runs today's block for the value that changed, with today's log line. It compares `activity`, `background`, `running`, `repo` and `branch` with `!==`, and `activeTime` and `compaction` with `isSameJson` from `src/shared/json.ts`. A fresh object from the Bridge would otherwise always differ. It logs `<name> running` only for false to true.
- The `running` block owns `running` and its draws, for both values: `setWorking`, `drawTurn` and `drawStatusLine`, as today's `sessionRunning` block does.
- The `sessionRested` handler sets no `running` and calls none of those three. It keeps these steps, in this order: `unseen` from `tab.state.activity`, `drawActivity`, `visibleSessionRested`, the `rested` log line and the error toast.
- `drawActivity` stays in that handler because it is the only draw of the new `unseen` value. A rest with an error can reach a row that is already idle, and no later write draws that row.
- `activeTimes` in `chat-view.ts` goes. `activeTime(sessionId)` reads `chat.session`.
- `activeTimeChanged` and `ChatPageEvents` go: no plugin hears the event (only `chat/contract.ts` and `chat/page/start.ts` name it, measured at plan time, re-verify), and the slot's notice replaces it. `activeTime`'s comment in the page exports names the slot.
- `activeTimeListeners` and `announceActiveTime` stay. The list in `chat/page/start.ts` holds one entry: `(sessionId) => rowClock.changed(sessionId)`. `add` and the `activeTime` block of the `chat.session` listener each call `announceActiveTime`. Without these calls, the row's clock does not restart or stop on an `activeTime` write.
- Rewrite the comments that name the old path: `activeTimeChanged` above `chatPagePart` in `chat/page/start.ts`, and "each `activeTime` message" on `ChatViewDeps` in `chat-view.ts`.

**Returned.**
- `chat.returned` is the whole list. A new message and a `returnedPlaced` removal both notify, so the listener can see an id it already placed.
- `HeldTab` gains `placedReturned: Set<string>`. `add` and the listener hand `placeReturned` only ids outside the set, and add them before the call.
- Each id gets one attempt per page load, as today. A page load starts with an empty set and places what main still holds, as today.

**History and clear.**
- `prependHistory` calls `replaceEntries([...history, ...entries()])`, one `replace`.
- `/clear` calls `replaceEntries([notice])`. `removeOlderHostNotice` also calls `replaceEntries`.
- The page's `replace` branch is today's `entries` block: `rebuild`, `drawTurn`, and the log `<n> entries read in <name>`.
- `askHistory` and `loadHistory` stay: a restored transcript is not in the slot until the tab asks. Slots stay free of a transcript's bulk until a tab is shown.

**Entries with `raw`.**
- `chat.entries` holds the whole entry, `raw` included. Each change ships what `entry` ships today, and the snapshot carries what the `sessions` reply carried.
- No `raw` trimming lands here. No file in `chat/page` or `chat/main` reads `.raw` (measured at plan time, re-verify), and trimming it is a separate change.
- `raw` is `unknown[]` (`src/contracts/agent.ts`). Task 05's `JsonSafe` passes `unknown`, so `publish(chatEntriesSlot)` compiles. Add no cast.

**Replayed session after restart.**
- A restart starts with an empty holder. `restore` opens the session through `ChatSlots.open` with its saved active time and queue and an empty entry list.
- A re-attach's replay runs the normal `processEvents.entry` path, so each replayed entry is one `put`, as each is one `entry` message today. The `replay` flag object stays on `HeldSession`.
- A page load during the replay takes the snapshot so far and the later puts by sequence number.
- `prependHistory` puts history ahead of what the replay put.

**Owner restart.** Main stops a part only at quit, so this plan has no path where chat main starts over a live holder. Chat main reads no old value at start. Wave 4 owns rebuilding after a reload.

GIVEN a page load with two sessions in main WHEN the page part starts THEN two tabs show with their entries and no `sessions` invoke runs.
GIVEN a text entry streaming WHEN a chunk arrives THEN one `put` carries the whole entry, and the tab redraws its turn as today.
GIVEN a session opened WHEN the page hears its `chat.session` key THEN the new tab holds its queue, controls, commands and entries.
GIVEN a closed session whose process still ends WHEN its last events arrive THEN no slot holds its key and no tab comes back.
GIVEN a session closing with its tab still up WHEN each of its six keys is deleted THEN the tab stays as drawn until the sessions plugin removes its row.
GIVEN a restored session WHEN its tab shows THEN the history arrives as one `replace` with the replayed entries behind it.
GIVEN `/clear` WHEN it runs THEN the entries are one `Conversation cleared` notice and `activeTime` is 0.
GIVEN a returned message placed and not yet confirmed WHEN another message returns THEN the box takes only the new one.
GIVEN a process exit with an error WHEN main rests the session THEN the row stops running and the page toasts the error once.

Tests:

New file `chat-slots.test.ts`, over `createChatSlots` with writers from `createSlotStore(log).publish(key)`:
- `chatSlots_SessionOpens_WritesSessionKeyLast` — `store.onWrite` shows `chat.session` last. Catches a tab built from empty lists.
- `chatSlots_WriteAfterClose_SetsNoKeyAndReadsAnswer` — table over `setInfo`, `putEntry`, `setQueued`. Catches a late process event bringing a closed session back.
- `chatSlots_SessionCloses_DeletesSessionKeyFirst` — `store.onWrite` shows the `chat.session` delete first and six deletes in all. Catches a reader finding a session key with half its lists gone.

`chat-sessions.test.ts`:
- It builds `slots` from a real slot store and records each `SlotChange` through `store.onWrite`. An assertion on the last value reads `test.chat.sessions()`. An assertion on a sequence reads the recorded changes. The existing `messages` array keeps only `sessionRested`. About 169 lines touch it (measured at plan time, re-verify). This is the existing behaviour moved, not new tests.
- Add `sendNow_FreshRowObject_KeepsQueuePlace` — catches `rowOrders` lost when a row arrives as a fresh object.
- Add `writeNextQueued_RowLeavesQueue_KeepsOrderForWrite` — table: the write lands, and the write throws. The throw row asserts that the row is back at its index and that `returnAllHeld` later returns it in order. Catches an id removed at the filter, which makes `rowOrderOf` throw and fails each queued write.
- Add a case to the restore tests: `restore_ReplayThenHistory_LandInOrder` — catches a history `replace` that drops what the replay put.

`chat-view.test.ts`:
- Its fake channel emits become writes to a real slot store. Delete the unknown-session log case.
- `chatView_PageLoad_DrawsEverySessionInMirror` — asserts no `sessions` invoke. Catches a remaining invoke.
- `chatView_SessionKeyAfterLists_BuildsTabWithThem` — catches a tab that reads the lists too early.
- `chatView_ChangeWithNoTab_LosesNothing` — the list change comes first, then the key. The tab shows it.
- `chatView_KeyDeleted_TabStaysAsDrawn` — table over the six slots, with a live tab. Each row asserts no redraw, no log line and no throw. Catches an `undefined` that reaches `rebuild`, `setQueued` or `placeReturned`, and a tab emptied before its teardown.
- `chatView_SessionWrite_RunsOnlyChangedBlock` — table over `activity`, `background`, `activeTime`, `compaction`, `running`, `branch`; each row asserts its one log line. The `activeTime` row has no log line: it asserts that `activeTimeListeners` ran once, the seam `rowClock.changed` sits on. The `running` row with false has no log line: it asserts `setWorking` ran once. Catches every block re-running on each write, an `activeTime` always counted as changed, and a row clock that no write restarts.
- `chatView_ReturnedStillListed_PlacesOnce` — catches a double placement before `returnedPlaced` lands.
- `chatView_ErrorRest_ToastsOnce` — catches the moment lost with the `running` move.
- `chatView_Rest_DrawsUnseenOnly` — table: a rest on an active row, and a rest with an error on an idle row. Each row asserts that the row shows the error mark, and that `sessionRested` calls no `setWorking`. Catches an unseen mark left undrawn, and each rest drawing twice.

`chat-preview.test.ts`: its `sessionStarted` and `entry` assertions read the slots. It keeps the case that `preview` holds a row, now read as a `chat.session` key.

`start.test.ts` in `main/` and `page/`: remove the `sessions` handler case. Each other `chat.invoke('sessions')` read in `main/start.test.ts` reads the slots instead, and the fake `sessions` reply in `page/start.test.ts` goes. Neither file has an `activeTimeChanged` case (measured at plan time, re-verify). A key held twice throws is task 05's test: do not repeat it.

Self-test `expect` lines stay as they are, since every log line stays except `<message> for unknown session`. `grep -n "for unknown session" src/plugins/chat/main/selftest-script.ts` must print nothing.

`grep -n "pending message" src/plugins/chat/main/selftest-script.ts` lists the steps that expect a queue count. Read each hit. A step whose keys reach `sendAllNowSettled` or the restore loop can now log a middle count, so it must expect the last count. At plan time no such step expects a count (the `box now` step expects `sending now`), so re-verify and change only a hit that breaks this rule.

Runtime checks are in [Final verification](16-final-verification.md).

Done when: compiles and lints; `grep -n "session\.state\|copyState\|heldFor\|invoke('sessions')" src/plugins/chat/main/chat-sessions.ts src/plugins/chat/page/chat-view.ts` prints nothing; `grep -n "pending message" src/plugins/chat/main/selftest-script.ts` has been read against the rule above; `docs/features/agent-chat/design.md`'s two lines name the slots; the test gate runs the tests above.

Commit: one commit for the group.

## Proof
