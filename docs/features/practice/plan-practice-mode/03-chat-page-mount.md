# 03 — Chat page: mountChat

Status: not started
Type: Task
Wave: 3 · Depends on: 02
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/contract.ts` · modify `src/plugins/chat/page/chat-view.ts` · modify
           `src/plugins/chat/page/start.ts` · test `src/plugins/chat/page/chat-view.test.ts`
Consumes:  `SessionRow.owner: string | null` ← 01 (read on the page from `sessionsRowsSlot`, already read in
           `start.ts` as `rows`). From 02 nothing but the rule that an owned session never gets a Sessions pane.
Produces:  in `src/plugins/chat/contract.ts`: `interface ChatMount extends Disposable { shown(): void; hidden(): void }`
           and `ChatPageExports.mountChat(element: HTMLElement, sessionId: string): ChatMount`.
           In `chat-view.ts` (internal): `ChatTabs.mount(element: HTMLElement, sessionId: string): ChatMount`;
           `ChatViewDeps.ownerOf(sessionId: string): string | null | undefined` (undefined: no row yet) and
           `ChatViewDeps.onRowAdded(listener: (sessionId: string) => void): void`.

Decisions:
- **One seam, two adapters** (design.md § Chat and sessions changes; design review). `createTab` (chat-view.ts
  1014-1193) splits at the `deps.sessions.addTab` call (1148): the build of root, main, entries, composer, side, box,
  drop target and place is one function taking an `attach` step; the step returns a `TabHost` that replaces
  `HeldTab.handle: SessionTabHandle | null` (322-347):
  `interface TabHost { isVisible(): boolean; select(): void; reveal(): void }`.
  - Sessions adapter: `attach` calls `deps.sessions.addTab` with today's `SessionTabView` (id `chat`, title `Chat`,
    icon `comment`, order 2, `beforeClose`, `shown`) and selects the tab at the end of the build, as 1191 does now.
    `isVisible` = `handle.isVisible()`, `select` = `handle.select()`, `reveal` = `deps.sessions.activate(sessionId)` then
    `handle.select()` (today's `showRevealed`, 431-435, minus the focus step, which stays in the view).
  - Mount adapter: `attach` appends the root to the host's element. `isVisible` reads a flag `shown()` sets and
    `hidden()` clears; `select` and `reveal` do nothing (the host plugin owns where its pane shows).
  - `TabHost` adds `reveal` to the brief's list (attach, shown, hidden, isVisible, select): `showRevealed` activates
    the session in Sessions, which an owned row must never do, while `mayClose` (1398) and the end of the build select
    without activating.
  - `view.shown` may run inside `attach` (`addTab`'s rule, sessions/contract.ts 392), so the build sets `tab.host`
    from `attach`'s return and nothing in `shown` reads it.
- **The tab marked shown replaces "the one visible tab".** The view keeps `lastShown: HeldTab | null` (replacing
  `lastShownSessionId`, 421). `visibleTab()` (601) returns `lastShown` when its `host.isVisible()` reads true, else
  undefined. Every read of `tab.handle?.isVisible()` (426, 546, 586, 785) reads `tab.host.isVisible()`.
  `otherSessionShown` still fires when the shown tab's session differs from `lastShown`'s, so a mount shown after a
  Sessions tab (or the reverse) closes the reason box, confirm, control picker and image viewer (start.ts 227-231,
  301-304) as a session switch does. Chat commands, the `chat.focus` slot (`chatFocusSlot`), the hub keys and `fillComposer`
  need no change: they go through `visibleSessionId()` / `session(id)`.
- **A shown mount takes the chat keys** through the existing `view.shown` body (466-481): `takeKeys(tab, 'chat')`
  sets scope `chat`, the tab's own `focusTarget` (`movePane`, 881) and the hub divider or null as resize target.
  `hidden()` only clears the flag: the host sets its own scope next, and the base change drops chat's targets. The
  view never calls `setOuterPanes`; `movePane` returns false at the view's edge, so the core moves on to the outer
  panes the host mode hands over (AGENTS.md § A focus target). That is task 09's to set, not this task's.
- **An owned row gets no Sessions tab** (AGENTS.md § A chat pane, owned session). `add(info)` (456) reads
  `deps.ownerOf(sessionId)`: a string → no Sessions tab; when a mount waits for the session, the mount attaches (below),
  else nothing is held until a mount comes. `null` → today's Sessions tab.
  `undefined` (no row yet) → the id waits in an `awaitingRow` set, and `onRowAdded` runs `add` again with the
  session's current `chat.session` value. Main writes the row inside `sessions.open` before chat's slots open
  (chat/main/chat-sessions.ts `openRow`, 1435), so the wait is a guard, not the usual path.
- **`mount(element, sessionId)` throws**, in this order, an `Error` whose message is the reason:
  - disposed view: `chat page is stopped`
  - row present with no owner (`ownerOf` returns `null`): `session <sessionId> is not owned; it shows in Sessions`
  - the session already has a mount, attached or waiting: `session <sessionId> is already mounted`
- **A mount waits for its session.** Page slots mirror main after a delay, so a host can call `mount` right after
  `askInterviewer` resolves, before the page holds the session's `chat.session` key or its row. `mount` does not
  throw for either. When the key is missing or `ownerOf` returns `undefined`, `mount` returns the handle at once,
  leaves the element empty, and keeps the wait in a `waitingMounts: Map<sessionId, { element, handle }>`. The view
  attaches when both have arrived: `add` (456) for a session whose `ownerOf` is a string builds the waiting mount, if
  one waits. `add` runs on the key's arrival and again from `onRowAdded`, so the order of the two does not matter.
  - `shown()` and `hidden()` on a waiting mount set its flag only. The build reads the flag, so a mount shown while
    it waits takes the chat keys when it attaches.
  - `dispose()` on a waiting mount deletes the wait; a later arrival attaches nothing.
  - A row that arrives with `owner: null` while a mount waits gets today's Sessions tab. The wait is deleted and
    logs `session <sessionId> is not owned; it shows in Sessions`; the element stays empty.
  - `view.dispose()` deletes every wait.
- **Attaching** builds the tab from `stateInSlots` (351) with the mount adapter, sets it in `tabs`, and runs
  `side.sync`, `placeNewReturned`, the pending reveal and `announceActiveTime` as `add` does (485-491). A mount whose
  session is already present attaches inside the `mount` call.
- **`dispose` leaves the session running**: it deletes the tab from `tabs`, runs `tearDownTab` (763) and removes the
  root from the element; no channel call. Each call on a disposed mount does nothing; a later `mount` of the same
  session builds a fresh view, and the saved draft comes back through `placeOf`.
- **Row removal tears a mount down**: `onSessionRemoved` (556) treats a mount as any held tab and also removes its
  root; its handle goes dead as a disposed one. `view.dispose()` (730) does the same for every mount.
- **Export**: `start.ts` exports `mountChat: (element, sessionId) => consumer.track(view.mount(element, sessionId))`,
  so a consumer's restart disposes its mounts. `ownerOf` reads `rows.get(sessionId)?.owner`; `onRowAdded` is
  `followRows(rows, { added: (row) => listener(row.sessionId) })`. `followRows` calls `added` for each row it already
  holds inside the call, so the view registers `onRowAdded` after `add` and the `chat.session` reader exist; the
  catch-up calls then find both.
- Doc comments that name "the visible tab" (`ChatView` 100-119, `ChatViewDeps` 225-258, `HeldTab` 308-321,
  `createTab` 999-1013) and start.ts's part comment (71-104) say "the shown tab, a Sessions tab or a mount" and
  name `mountChat`; the contract's `ChatMount` comment states the throws, that a mount made before the session
  reaches the page attaches when it arrives, and that dispose leaves the session running.

GIVEN an owned session (row `owner: 'practice'`) WHEN its `chat.session` key arrives THEN `addTab` is not called and `view.session(id)` is undefined.
GIVEN its key arrives before its row WHEN the row arrives with `owner: null` THEN it gets its Chat tab; with `owner: 'practice'` THEN it gets none.
GIVEN a mounted owned session WHEN `shown()` runs THEN scope `chat` is set with the tab's focus target, and `visibleSessionId()` names it.
GIVEN a shown mount WHEN `hidden()` runs THEN `visibleSessionId()` is null and a hub key logs `no Chat tab shown`.
GIVEN a mount WHEN `dispose()` runs THEN the element holds no child, no channel method beyond `loadHistory` was invoked, the `chat.session` key stays, and mounting again succeeds.
GIVEN a mount WHEN the session's row leaves THEN the element holds no child and a later `shown()` sets no scope.
GIVEN `mount` on an unowned, an already-mounted session, or after the page stopped THEN it throws the reason above.
GIVEN `mount` before the session's key or row reached the page WHEN both arrive THEN the view attaches to the element;
WHEN the handle is disposed first THEN the arrival attaches nothing.

Tests (new `describe('mountChatView mounts')` in `chat-view.test.ts`; the `mounted()` harness, 155-408, gains an
`owners` map read by `ownerOf`, a captured `onRowAdded` listener exposed as `rowAdded(sessionId)`, and records each
`addTab` session id and counts `otherSessionShown` calls; the fake DOM's `document.createElement('div')` is the host element):
- `ownedRow_Arrives_GetsNoSessionsTab` — table: owner `'practice'` at arrival → no `addTab`, `session('s1')`
  undefined; owner `null` → `addTab('s1')`; no row at arrival, then `rowAdded` with owner `'practice'` → no `addTab`;
  no row, then `rowAdded` with `null` → `addTab('s1')`. Catches an owned row placed in a Sessions pane.
- `mount_ShownThenHidden_TakesThenGivesUpTheChatKeys` — after `shown()`: `keyCalls` holds `['setScope', 'chat']`
  followed by `setFocusTarget` with a non-null target, `visibleSessionId()` is `'s1'`; after `hidden()`:
  `visibleSessionId()` is null, `view.hub.move(1)` logs `no Chat tab shown`. Catches keys left on a hidden mount
  or never given to a shown one.
- `mount_AnotherSessionShownAfter_ClosesSessionDialogs` — a Sessions tab `s2` shown, then mount `s1` shown: the
  harness's `otherSessionShown` counter reads 1. Catches dialogs left acting on the wrong session.
- `mount_Refused_ThrowsTheReason` — table: `s2` unowned → `session s2 is not owned; it shows in Sessions`; `s1`
  mounted twice → `session s1 is already mounted`; `s9` (no key, no row) mounted twice → `session s9 is already
  mounted`; any session after `view.dispose()` → `chat page is stopped`.
- `mount_BeforeTheSessionArrives_AttachesWhenBothArrive` — `it.each` over the arrival order, each mounting `s9`
  (owner `'practice'` once its row arrives) before anything arrives, then asserting the element has 0 children and
  no `addTab` call: key then row (`rowAdded('s9')`) → the element has 1 child; row then key → 1 child; `shown()`
  while waiting, then both → 1 child and `keyCalls` holds `['setScope', 'chat']`; `dispose()` while waiting, then
  both → 0 children; row with owner `null`, then key → 0 children, `addTab('s9')`, and the log names `s9`. Catches a
  mount that throws or stays empty when the host mounts right after `askInterviewer` resolves.
- `mount_Disposed_LeavesTheSessionHeld` — after `dispose()`: element has 0 children, `invoked` methods are only
  `loadHistory`, `writers.session.get('s1')` is defined, a second `mount` of `s1` returns without throwing.
- `mount_RowRemoved_TearsDownAndGoesDead` — `removeSession('s1')`: element has 0 children; `shown()` afterwards adds
  no `setScope` call.
Existing tests in `chat-view.test.ts` and `chat-commands.test.ts` stay green unchanged except the harness's added
deps (`ownerOf` returning `null` by default).

Approach: none beyond the decisions.

Done when: `npm run typecheck` and `npm run lint` pass, and the test gate runs `src/plugins/chat/page/chat-view.test.ts`
and `src/plugins/chat/page/chat-commands.test.ts`. Live checks belong to "12 — Final verification".
Commit:    one commit for the group

## Proof

