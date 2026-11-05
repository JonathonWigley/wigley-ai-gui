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
| `sessionRested` | stays, for the moment only: unseen mark, `visibleSessionRested`, the error toast and the `rested` log lines. `running: false` is in `chat.session`. |
| `invoke.returnedPlaced`, `invoke.loaded`, `logInLink`, `logInEnded` | stay |

`chat/main/start.ts`'s `sessions` handler goes, and `ChatPreview.states()` goes with it (its only caller is that handler, measured at plan time, re-verify).

**Owners read through the writer.**
- `HeldSession.state` goes. `session.state` has 131 lines in `chat-sessions.ts` (measured at plan time, re-verify). Each read and write moves to `session.slots` or `session.sessionId`.
- `copyState` and `upsertEntry` go. `ChatSlots` assembles the copy, and `put` does the upsert.
- `ChatSessions.sessions()` stays for the drive actions, the fixtures and the tests. It returns `[...held.values()].map((session) => session.slots.read())`.
- The preview's `shown.state` goes the same way.
- The `held` map stays. It holds what is live and not JSON: `owned`, `process`, `pending`, `attaching`, `historyRead`, `unheldSettling`, `replay`, and the plain counters and sets outside `ChatSessionState` (`writtenMessages`, `backgroundIds`, `confirmedPicks`, `pendingPicks`, `returnedDrops`).
- `rowOrders` changes from `WeakMap<QueuedMessage, number>` to `Map<string, number>` keyed by row id, removed with its row. A slot value's object identity is no contract.
- A value is never mutated after a `set`. Every site already assigns a new list.

**Close.** The comment on `drop` says later events for a session are ignored, but `cancelPending` and a closing process still reach state.
- `drop` calls `session.slots.close()` first, then `held.delete`, then `cancelPending`.
- `close()` assembles the last `ChatSessionState` once into a private detached object and deletes the session's key in all six slots.
- After `close()`, reads and writes on that `SessionSlots` use the detached object and write no slot. A late write can then not bring a closed session's key back and redraw its tab. This object is the one copy, and only after the key is gone.

**Order.**
- `ChatSlots.open` writes `entries`, `controls`, `commands`, `queued` and `returned`, then `chat.session` last. The write sits where `send('sessionStarted', …)` is today, after `sessionOpened`.
- The page builds a tab when a `chat.session` key has no tab, and reads the other five slots from the mirror at that moment.
- Other writes sit where the `send` is today. `sendQueued` becomes `save()`, and the `setQueued` sits at the assignment. Today's `writeNextQueued` already sends between its two changes, so the wire count does not change there.
- Slot changes and `sessionRested` keep today's relative order, since both leave main in send order on one `webContents`. `sessionRested`'s `wasActive` reads `tab.state.activity`, and main still writes idle after it.

**Page.**
- `channel.invoke('sessions')` and its catch go. At view start the page runs `add` over `reader.session.all()`, inside the same try and log as today (`chat session arrival failed`). Then it subscribes. The mirror holds the snapshot before the part starts, so no push can land between the read and the subscribe.
- The hypothesis in the state map, that a push before the `sessions` reply is dropped, ends here: the reply no longer exists, so no test pins it and no rule replaces it.
- `heldFor` and its log line `<message> for unknown session <id> ignored` go. A change for a key with no tab returns in silence: nothing is lost, because `add` reads the mirror when the `chat.session` key arrives.
- A `chat.session` change with value `undefined` does nothing. `onSessionRemoved` stays the teardown.
- `tab.state` stays as the view's last applied `ChatSessionState`. It is a reader's baseline for comparing a `chat.session` write, not an owner's copy, and 32 lines read it (measured at plan time, re-verify).
- The `chat.session` listener compares each value with `tab.state` and runs today's block for the value that changed, with today's log line. It compares `activity`, `background`, `running`, `repo` and `branch` with `!==`, and `activeTime` and `compaction` with `isSameJson` from `src/shared/json.ts`. A fresh object from the Bridge would otherwise always differ. It logs `<name> running` only for false to true.
- `activeTimes` in `chat-view.ts` goes. `activeTime(sessionId)` reads `chat.session`.
- `activeTimeChanged` and `ChatPageEvents` go: no plugin hears the event (only `chat/contract.ts` and `chat/page/start.ts` name it, measured at plan time, re-verify), and the slot's notice replaces it. `activeTime`'s comment in the page exports names the slot.

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
- `raw` is `unknown[]` (`src/contracts/agent.ts`). Task 05's draft `JsonSafe` maps `unknown` to `never`, so `publish(chatEntriesSlot)` does not compile against it. This task needs `JsonSafe` to admit `unknown`. The plan's lead settles that in task 05 before the run. If the type still refuses, stop and report a contract concern. Do not add a cast here.

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
GIVEN a restored session WHEN its tab shows THEN the history arrives as one `replace` with the replayed entries behind it.
GIVEN `/clear` WHEN it runs THEN the entries are one `Conversation cleared` notice and `activeTime` is 0.
GIVEN a returned message placed and not yet confirmed WHEN another message returns THEN the box takes only the new one.
GIVEN a process exit with an error WHEN main rests the session THEN the row stops running and the page toasts the error once.

Tests:

New file `chat-slots.test.ts`, over `createChatSlots` with writers from `createSlotStore(log).publish(key)`:
- `chatSlots_SessionOpens_WritesSessionKeyLast` — `store.onWrite` shows `chat.session` last. Catches a tab built from empty lists.
- `chatSlots_WriteAfterClose_SetsNoKeyAndReadsAnswer` — table over `setInfo`, `putEntry`, `setQueued`. Catches a late process event bringing a closed session back.

`chat-sessions.test.ts`:
- It builds `slots` from a real slot store and records each `SlotChange` through `store.onWrite`. An assertion on the last value reads `test.chat.sessions()`. An assertion on a sequence reads the recorded changes. The existing `messages` array keeps only `sessionRested`. About 169 lines touch it (measured at plan time, re-verify). This is the existing behaviour moved, not new tests.
- Add `sendNow_FreshRowObject_KeepsQueuePlace` — catches `rowOrders` lost when a row arrives as a fresh object.
- Add a case to the restore tests: `restore_ReplayThenHistory_LandInOrder` — catches a history `replace` that drops what the replay put.

`chat-view.test.ts`:
- Its fake channel emits become writes to a real slot store. Delete the unknown-session log case.
- `chatView_PageLoad_DrawsEverySessionInMirror` — asserts no `sessions` invoke. Catches a remaining invoke.
- `chatView_SessionKeyAfterLists_BuildsTabWithThem` — catches a tab that reads the lists too early.
- `chatView_ChangeWithNoTab_LosesNothing` — the list change comes first, then the key. The tab shows it.
- `chatView_SessionWrite_RunsOnlyChangedBlock` — table over `activity`, `background`, `activeTime`, `compaction`, `running`, `branch`; each row asserts its one log line. Catches every block re-running on each write, and an `activeTime` always counted as changed.
- `chatView_ReturnedStillListed_PlacesOnce` — catches a double placement before `returnedPlaced` lands.
- `chatView_ErrorRest_ToastsOnce` — catches the moment lost with the `running` move.

`chat-preview.test.ts`: its `sessionStarted` and `entry` assertions read the slots. It keeps the case that `preview` holds a row, now read as a `chat.session` key.

`start.test.ts` in `main/` and `page/`: remove the `sessions` handler case and the `activeTimeChanged` case. A key held twice throws is task 05's test: do not repeat it.

Self-test `expect` lines stay as they are, since every log line stays except `<message> for unknown session`. `grep -n "for unknown session" src/plugins/chat/main/selftest-script.ts` must print nothing.

Runtime checks are in [Final verification](16-final-verification.md).

Done when: compiles and lints; `grep -n "session\.state\|copyState\|heldFor\|invoke('sessions')" src/plugins/chat/main/chat-sessions.ts src/plugins/chat/page/chat-view.ts` prints nothing; `docs/features/agent-chat/design.md`'s two lines name the slots; the test gate runs the tests above.

Commit: one commit for the group.

## Proof
