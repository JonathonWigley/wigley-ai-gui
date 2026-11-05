# 11 — Sessions rows and selection as slots

Status: not started
Type: Task
Wave: 10 · Depends on: 10
Plan: [plan.md](plan.md)

Paths are relative to `src/plugins/` unless they start with `src/` or `docs/` or are `AGENTS.md`.

**Files:**

- Modify the owner: `sessions/contract.ts`, `sessions/main/session-list.ts`, `sessions/main/start.ts`, `sessions/page/start.ts`.
- Modify the listeners: `primer/page/start.ts`, `forms/page/start.ts`, `chat/page/start.ts`, `chat/page/chat-view.ts`, `chat/main/start.ts`, `agent-strip/page/start.ts`, `agent-skills/page/start.ts`, `agent-lines/page/start.ts`, `agents/page/start.ts`, `usage/page/start.ts`, `usage/main/start.ts`, `docs/page/start.ts`, `notes/page/start.ts`, `workflow/page/start.ts`, `unity-pool/page/start.ts`.
- Modify the manifests: `agent-strip/manifest.ts`, `agent-skills/manifest.ts`, `agents/manifest.ts`, `notes/manifest.ts`.
- Modify the docs: `AGENTS.md` (the "An event" and "A session tab" entries).
- Create the test: `sessions/contract.test.ts`.
- Test: `sessions/main/session-list.test.ts`, `sessions/main/start.test.ts`, `sessions/page/start.test.ts`, `agent-form-drive.test.ts`, `chat/main/start.test.ts`, `src/shared/state/slot-store.test.ts`, `src/main/state/slot-holder.test.ts`. Also every test `grep -rlE "sessions\.(activeChanged|sessionAdded|sessionRemoved|sessionHostChanged|selected)|selectedSessionId" src/plugins --include='*.test.ts'` names: 19 files (measured at plan time, re-verify).

**Consumes:**

- `KeyedSlotKey`, `SlotKey`, `KeyedSlotWriter`, `SlotWriter`, `KeyedSlotReader`, `SlotReader`, `api.state.publish`, `api.state.read` ← 05.
- `reads` on `PluginManifest` ← 05.
- `createSlotStore` in `src/shared/state/slot-store.ts` ← 05.
- The event `pageReady` of `CoreEvents`, heard as `core.pageReady` ← 06.
- `harness.state`, the part harness's `SlotStore` ← 05. A test writes rows through `harness.state.publish`.
- The page bus runs the listeners of one event in subscription order (`src/shared/event-bus.ts`, pinned by `event-bus.test.ts:11`). A listener added during an emit hears only later emits.
- The push gate in `src/main/main.ts` ← 05: the holder's `push` sends through `hasQuitStarted ? null : livePage(window)`, the expression `createPluginChannels` takes.
- These guarantees of the store ← 05:
  - `onWrite` runs before the listeners and inside the write, so a main write pushes in the same synchronous call. The order against `api.channel.send` is then the call order.
  - `get` and `all` already hold the new value when listeners run.
  - Listeners run in registration order.
  - `KeyedSlotWriter.all()` and `KeyedSlotReader.all()` iterate in first-set order. A `set` on a held key keeps its place. A `delete` and a later `set` go to the end. The order survives the snapshot the page mirror loads. Task 05's `SlotSnapshot` carries keyed slots as ordered entries for this reason.

**Produces** in `sessions/contract.ts`:

```ts
export const sessionsRowsSlot: KeyedSlotKey<SessionRow, 'main', 'sessions'> =
  { id: 'sessions.rows', process: 'main', kind: 'keyed' };   // keyed by the row's sessionId
export const sessionsSelectionSlot: SlotKey<string | null, 'main', 'sessions'> =
  { id: 'sessions.selection', process: 'main', kind: 'value' };   // main's selected row
export const sessionsActiveSlot: SlotKey<string | null, 'page', 'sessions'> =
  { id: 'sessions.active', process: 'page', kind: 'value' };   // the focused chat pane's session

export function followRows(
  rows: KeyedSlotReader<SessionRow>,
  handlers: {
    added?(row: SessionRow): void;
    removed?(sessionId: string): void;
    hostChanged?(row: SessionRow): void;
  },
): Disposable;
```

`followRows` calls `added` once per row `rows.all()` holds, in order, inside the call. Then it subscribes through `rows.on`. It keeps each row's last host id, so a change to any other field of a row calls nothing. A row deleted and set again calls `removed`, then `added`.

The `createSessionList` deps lose `stateChanged` and gain `rows: KeyedSlotWriter<SessionRow>` and `selection: SlotWriter<string | null>`.

These go from `sessions/contract.ts`:

- `SessionsChannel.invoke.state`, `SessionsChannel.messages.stateChanged`.
- `SessionsMainEvents.selected`.
- `SessionsMainExports.selectedSessionId`, `SessionsPageExports.selectedSessionId`.
- Every member of `SessionsPageEvents`. The interface stays empty, because task 14 adds to it.

`SessionsState` stays as the page view's input type.

**Decisions:**

Rule: a slot's notice replaces any matching event, and a moment stays an event. A notice matches when the slot holds what the event reports, for every session the event covers.

| Event | Verdict | Why |
|---|---|---|
| main `selected` | goes: `sessions.selection` | The slot holds the whole value. |
| main `hostSessionChanged` | stays | It fires for a session with no row, which the rows slot does not hold. It carries the whole `AgentSession` with `info`. Workflow and docs treat it as a moment: a clear. |
| main `titleChanged` | stays | It fires for a session with no row (`setTitle` emits it either way). Chat saves the titles of a row it holds. |
| page `activeChanged` | goes: `sessions.active` | Focus is a value a late reader wants. Its listeners already pair it with an initial `selectedSessionId()` read, a hand-written get-then-subscribe. |
| page `sessionAdded` | goes: `sessions.rows` | A late reader wants every row. It catches up through `all()`. |
| page `sessionRemoved` | goes: `sessions.rows` | The notice `(id, undefined)` is the removal. A late reader never held state for a row it did not see, so it has nothing to catch up on. The moments stay on main: `closed` and `ended`. |
| page `sessionHostChanged` | goes: `sessions.rows` | Every session it reports has a row. |

`sessions.active` is a third slot beyond the brief's two. Without it, `activeChanged` stays as one more get-then-subscribe pair.

What each listener becomes:

| Event | Listener | After |
|---|---|---|
| `selected` | chat main `start.ts:412` | `sessionsSelectionSlot` `on`: `chat.selected(value ?? null)` |
| `activeChanged` | primer `:107`, forms `:106` | `sessionsActiveSlot` `on`: dispatch `sessionActivated`. `initialState` reads `get() ?? null`. |
| `activeChanged` | chat page `:196` | `onActiveChanged` wired to `sessionsActiveSlot` `on` |
| `activeChanged` | unity-pool `:385`, usage `:245` | `shownSessionId` goes. The draw reads `get() ?? null`. `on` redraws. |
| `sessionAdded` | agent-strip, agent-skills, agent-lines, usage | The `names` map goes. `nameOf` is `rows.get(id)?.label ?? id`. |
| `sessionAdded` | docs `:419` | `followRows` `added`: adds the Docs tab |
| `sessionAdded` | notes `:40` | The `rows` map goes. A pull builds `NoteSession` from `rows.get`, null `hostSessionId` meaning none. `followRows` `added` keeps the log line `session <id or none> listed`, which `notes/main/selftest-script.ts:383` expects. |
| `sessionAdded` | workflow `:149` | The `heard` map goes. Name and folder read `rows.get`. `added` calls `preview.sessionAdded`. |
| `sessionAdded` | unity-pool `:364` | The `rows` map goes. Reads `rows.get`. Any rows notice redraws. |
| `sessionRemoved` | primer `:181`, forms `:182` | `followRows` `removed`: `view.forgetSession` |
| `sessionRemoved` | agent-strip, agent-skills, agent-lines, usage | `removed`: the plugin's `forget` |
| `sessionRemoved` | chat page `:192`, sessions page `:846` | `onSessionRemoved` and the `sessionsPageView` argument wired to `removed` |
| `sessionRemoved` | agents page `start.ts:29` | `removed`: `rosters.forget`. Task 13 deletes this. |
| `sessionRemoved` | docs `:449`, notes `:47` | `removed`: as today, notes' map step gone |
| `sessionRemoved` | workflow `:168` | `removed`: `preview.sessionRemoved`, `flows.delete`, `view.forget` |
| `sessionRemoved` | unity-pool `:370` | `removed`: `loggedBadges.delete` |
| `sessionHostChanged` | chat page `:200`, docs `:458` | `followRows` `hostChanged` |
| `sessionHostChanged` | notes `:51`, workflow `:160`, unity-pool `:376` | Nothing: each reads `rows.get`. Unity-pool's redraw comes from the rows notice. |

The page callers of `selectedSessionId()` move to `sessionsActiveSlot` with `get() ?? null`: forms, primer, usage, unity-pool, notes, workflow, `chat/page/chat-view.ts:390`.

The main callers move to `sessionsSelectionSlot` with `get() ?? null`, and the shapes their fakes see stay:

- `chat/main/chat-sessions.ts:776` keeps its `sessions` member. `chat/main/start.ts` builds that member from the slot.
- `usage/main/start.ts:185` keeps the drive's `selectedSessionId` dep.

Manifest edges after this task:

- `agent-strip` and `agent-skills`: `sessions` moves from `dependsOn.page` to `reads.page`. They use no page export of it.
- `notes`: the same move, as its only export use was `selectedSessionId`.
- `agents`: `sessions` moves from `dependsOn.page` to `reads.page`. Task 13 removes it.
- `usage`, `unity-pool`, `agent-lines`, `workflow`, `docs`, `chat`, `forms`, `primer` keep `sessions` in `dependsOn.page`: each uses a page export.
- Main edges stay: each of `usage`, `docs`, `agent-lines`, `agent-skills`, `agent-strip` and `unity-pool` still calls `api.dependency(sessionsMainKey)`.

Main's write order is the contract the page rests on:

1. In one list operation, every row write comes first, then the selection write, then the events (`closed`, `ended`, `connected`, `hostSessionChanged`, `titleChanged`).
2. `activated` still goes before the writes it causes, so the mode shows first and the round does not toast.
3. Every write of one operation runs in one synchronous block.

In `session-list.ts`:

- The `rows` array, `selectedSessionId` and `sentSelectedSessionId` go. `sendState` goes. The list reads through the writers.
- A row value is never changed in place. Each change writes a new object.
- The list writes a selection only when it differs from `selection.get()`.
- At creation, the list deletes every key `rows` holds, then writes `null` to `selection`. A slot outlives its owner's stop, and a harness restart reaches this line. A leftover selection that names no row would read on the page as a mid-operation state that never ends. The same rule as above applies: a slot that already holds `null` gets no write.
- `removeRow` takes the neighbour from `[...rows.all().keys()]` before the delete: the right neighbour, else the left.
- `state()` stays, built from the writers. `sessions/main/selftest-script.ts:224` and the tests read it. `selftest-script.ts` does not change.
- The list's own `isStopped` stays. It guards lookups landing after `stop`, which would otherwise log `written after stop`.

In `sessions/page/start.ts`, the `state` invoke, the `stateChanged` listener, `hasStateChanged` and `isStopped` go. `activated` stays a channel message: it is a moment.

The page's steps:

1. At the start of the part, publish `sessionsActiveSlot` and set it to `null`. A page load must not show the old page's focus to a later reader. Subscribe to the rows and selection slots here too, so sessions' listener runs before every dependent's.
2. Each notice calls `apply` with `{ rows: [...rows.all().values()], selectedSessionId: selection.get() ?? null }`. A notice returns at once while `hasRestored` is false.
3. On `core.pageReady`, call the same `apply`. That is the first state, read from the store. Sessions' first apply and every reader's catch-up then run after all page parts started, as today's first `state` reply did. Register this listener in the synchronous start of the part. Parts start in `dependencyOrder`, and sessions comes before every reader, so the bus runs sessions' apply before each reader's catch-up. A reader that only `reads` sessions keeps this order through its place in `builtInManifests`.
4. A state is mid-operation when its selection is a non-null id that no row holds: main deleted the selected row and its selection write follows. More than one notice can land before that write: `rows.delete(id)`, then a `rows.set(neighbour)` that clears a mark, then `selection.set(neighbour)`.
   - For each mid-operation state, `apply` renders, closes the panes and drops the tabs. It skips `placeSelection` and the tail.
   - Each mid-operation state adds to three remembered values. `removed` is the union of each state's `changes.removed`. `wasSplit` is true when any of these states saw a split: after the first state the panes are closed, so a later state's own reading is false. `hasClosedPane` is true when any of these states had `closing.length > 0`.
   - The next state that is not mid-operation adds its own three values. It passes `removed` and `wasSplit` to `selectionAction` and `hasClosedPane` to `checkVisible`. Then it clears all three.
   - `selectionAction` does not change.
   - Without this step a split would place the neighbour instead of telling main the focused pane, a single pane would publish `null` and set the `idle` scope between the notices, and a closed pane's "shown again" tell would be lost.
5. The tail of `apply` (`publishFocused` and `checkVisible`) runs in `queueMicrotask`. This keeps today's order for a reader: every row notice reaches every reader before the `sessions.active` write the row caused. A sync write would reach the active listeners before the rows listeners of plugins that started later. Only this tail is deferred: `panesChanged` at `sessions/page/start.ts:355`, a pane change outside `apply` guarded by `isApplying`, still calls `publishFocused` and `checkVisible` synchronously. A `get()` of `sessions.active` between an `apply` and its microtask returns the previous focus. This is accepted, though today's `selectedSessionId()` reads the live pane.
6. `published` goes. A `hasPublished` boolean replaces its `undefined` first-state mark. `publishFocused` reads the last value through the writer and passes `undefined` to `isRoundToast` before the first publish.

The order pinned, today against after:

| Case | Today, one `apply` | After |
|---|---|---|
| Page load | render and restore panes, `sessionAdded` per row, `activeChanged` | `core.pageReady`: sessions' apply, each reader's `followRows` `added`, then the microtask writes `sessions.active` |
| New selected row | `sessionAdded`, then `activeChanged` | rows notice to every reader, selection notice, then `sessions.active` |
| Selected row removed | tabs drop, `sessionRemoved`, `activeChanged` | rows notice (sessions drops tabs first, as it subscribed first), selection notice, then `sessions.active` |
| Host id changed | `sessionHostChanged`, then `activeChanged` | rows notice, then `sessions.active` when focus changed |

A page reader with a `followRows` that has `added` calls it inside a `core.pageReady` listener. It subscribes and catches up in that one synchronous block. A reader with only `removed` may call it at its current site.

Quit: from main's first quit task on, main sends the page no plugin message (`AGENTS.md` § A plugin). A page told of the rows ended by a stop saves them as gone: panes, recency.

- Task 05's push gate keeps this for slots. This task must not add another path to the page: no `api.channel.send` of a row or a selection stays.
- At quit, `list.endAll()` still writes through the writers, as the part's `dispose` runs before its registrations go. The holder takes the value, `seq` moves and nothing reaches the page.
- The live proof that a restart restores the panes after a quit belongs to [Final verification](16-final-verification.md).

No `rows()` or `sessions()` export is added. A reader takes the slot.

GIVEN a selecting `open` WHEN it runs THEN the writes are `rows.set(id)`, then `selection.set(id)`, then `connected` is emitted.
GIVEN the selected row of two closes WHEN the user closes it THEN the writes are `rows.delete(id)`, any `rows.set(neighbour)` clearing its mark, `selection.set(neighbour)`, then `closed` is emitted.
GIVEN a split with the selected session in one pane WHEN that row's delete notice and then the selection notice land THEN main is told the focused pane's session and no session is placed.
GIVEN one pane showing the selected session WHEN those two notices land THEN `sessions.active` goes straight to the neighbour, never `null`, and the scope is never `idle`.
GIVEN a close that also clears the neighbour's mark WHEN the delete, neighbour and selection notices land in that order THEN the result is the same as for the two notices, and a pane closed by the first notice still makes the visible tab's `shown` run again.
GIVEN a pane change outside `apply` WHEN `panesChanged` returns THEN `sessions.active` already holds the focused pane's session.
GIVEN a reader that started after sessions WHEN a row arrives that focus follows THEN the reader's rows notice runs before its `sessions.active` notice.
GIVEN rows written before `core.pageReady` WHEN it fires THEN sessions applies once and each `followRows` `added` runs once per row.
GIVEN a reader whose part started after sessions WHEN `core.pageReady` fires THEN the reader's `added` handler finds the row already drawn by sessions.
GIVEN a page reload with `sessions.active` holding the old focus WHEN sessions starts THEN a later reader reads `null`.
GIVEN a title change on a row WHEN its notice lands THEN no `added` and no `hostChanged` runs, and docs adds no second tab.
GIVEN a quit has started WHEN sessions' dispose ends the rows THEN the holder's rows are empty and the page gets no push.
GIVEN a slot still holding rows and a selection from an earlier stop WHEN `createSessionList` runs THEN every key is deleted, and then the selection is `null`.

**Tests:**

- `sessions/contract.test.ts`, new, `followRows` as one table: a row present at the call gives `added` in order; a new row gives `added`; a title change gives nothing; a host change gives `hostChanged`; a delete gives `removed`; a delete and set gives `removed` then `added`; after `dispose` nothing. Catches a reader adding a second Docs tab on a title notice, or missing a row present at start.
- `sessions/main/session-list.test.ts`, the order tests at `:483` and `:1032` (measured at plan time, re-verify): the fake records `rows set`, `rows delete` and `selection`. Add one table, `every operation writes rows, then selection, then emits`, with rows for open, activate with a mark, close selected, end selected, `setHostSessionId` and `setTitle`. Catches a selection arriving before its row, which would place a row the page lacks.
- `sessions/main/session-list.test.ts`, add a row: `activate` records `activated` before its writes. Catches a toast on an activated round.
- `sessions/main/session-list.test.ts`, add `create_ClearsLeftovers`, as a table. Rows and a selection held: the writes are the deletes, then `selection` `null`. Slot holding `null`: no selection write. Slot unwritten: `selection` `null`. Catches a leftover selection that the page reads as a mid-operation state with no end.
- `sessions/page/start.test.ts`: the tests at `:63` and `:82` (a state read landing around stop) go, with what they guard. Add these:
  - `selectedRowRemoved_WaitsForTheSelectionNotice`, as a table. Split: main told the focused pane, nothing placed. Single pane: `sessions.active` goes from the old session to the neighbour with no `null`, no `idle` scope. Each of these two also runs with a neighbour `rows.set` notice between the delete and the selection notices, with the same result. Add a row for a split whose focused pane keeps its tab, with that notice between: the tab's `shown` runs again. These rows catch a second mid-operation `apply` that overwrites the remembered values.
  - `rowNotice_ReachesLaterReadersBeforeActive`, with a reader subscribed after the part starts. Catches a sync tail.
  - `paneChange_WritesActiveSynchronously`: a pane change outside `apply`, then a read with no `await`. Catches a `publishFocused` that defers on every path.
  - `pageReady_AppliesOnceFromTheStore`, with a rows write before it fired.
  - `pageReady_SessionsAppliesBeforeAReaderAdded`: the part starts, then a reader registers a `core.pageReady` listener that calls `followRows`. Its `added` handler asserts that the row's element is drawn. It does not rely on `addTab`, because `session-tabs-view.ts` creates a tab frame on demand, so `addTab` succeeds in either order. Catches sessions' listener registered after a reader's, for example behind an `await`.
  - `start_SetsActiveToNull`, with the slot holding an old value. Catches a stale focus after a reload.
- `sessions/main/start.test.ts`:
  - `:323`, the table of a project lookup: running writes a row, disposed writes none.
  - Add `dispose_EmptiesTheRowsThroughTheWriter`: after dispose `rows.all()` is empty, selection is `null` and `send` recorded nothing.
- `src/main/state/slot-holder.test.ts`, add `mainWrite_QuitGatedPush_KeepsValueAndMovesSeq`: `push` is built as `main.ts` builds it, from a quit flag and a null target. With the flag set, a write sends nothing, `store` holds the value and `snapshot().seq` moved. Catches a gated write that loses the value, which the next snapshot needs. The expression in `main.ts` has no unit seam: the `grep -c` in Done when pins it.
- `chat/main/start.test.ts`: a selection write reaches `chat.selected`, undefined as `null`. The `titleChanged` test at `:730` stays.
- `agent-form-drive.test.ts` and each test the Files grep names: write rows and the active value through the harness store instead of `harness.emit('sessions.…')`, or use the new deps. No new behaviour.

The runtime checks collect in [Final verification](16-final-verification.md).

**Done when:**

- It compiles and the layer check passes.
- The test gate runs the tests above, filtered to the plugins touched.
- `grep -rnE "sessions\.(activeChanged|sessionAdded|sessionRemoved|sessionHostChanged|selected)|stateChanged|hasStateChanged" src` prints nothing.
- Each self-test `expect` line that names one of these moved. `grep` shows `[notes] session … listed` and `[sessions] activated …` unchanged.
- `grep -c 'hasQuitStarted ? null : livePage(window)' src/main/main.ts` gives 2: the channels' gate and the holder's push.
- `AGENTS.md` "An event" uses another example than `activeChanged`. "A session tab" names the rows slot in place of `sessions.sessionRemoved`.
- `grep -rlE "sessionAdded|sessionRemoved|activeChanged|sessionHostChanged" docs --include='*.md'`, plan folders and `intent-alignment` left out: each hit that describes today's code is fixed. A followup's history stays.

**Commit:** one commit for the group.

## Proof

