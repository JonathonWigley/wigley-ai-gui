# 03 — Chat page exports and the row clock part

Status: done
Type: Task
Wave: 3 · Depends on: 02
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/contract.ts` · modify `src/plugins/chat/page/start.ts` ·
           modify `src/plugins/chat/page/chat-view.ts` · create `src/plugins/chat/page/row-clock.ts` ·
           test `src/plugins/chat/page/row-clock.test.ts` · modify `src/plugins/chat/layouts/layout.d.ts` ·
           modify `src/plugins/chat/layouts/default/layout.js` · modify `src/plugins/chat/layouts/default/layout.css` ·
           modify `src/plugins/chat/page/chat.css` ·
           test `src/plugins/chat/layouts/default/layout.test.ts` · modify `src/plugins/chat/page/read-chat-layout.ts` ·
           test `src/plugins/chat/page/read-chat-layout.test.ts` · modify `src/plugins/chat/page/chat-layouts.ts` only
           when the compiler needs it
Consumes:  `activeTime` on `ChatSessionState` and on `ChatChannel['messages']` ← 02 ·
           `ActiveTime`, `activeMsAt` ← 01 ·
           `SessionsPageExports.addRowPart(part: SessionPart): Disposable` (tree) ·
           `chatPartDraws`, `surfaceBaseKit`, `ChatLayouts` in `src/plugins/chat/page/chat-layouts.ts` (tree)
Produces:  in `src/plugins/chat/contract.ts`:
           `activeTime(sessionId: string): ActiveTime | null` on `interface ChatPageExports`
           `export interface ChatPageEvents extends EventShape { activeTimeChanged: { sessionId: string; activeTime: ActiveTime } }`
           in `src/plugins/chat/layouts/layout.d.ts`:
           `export interface RowClockInput { text: string; isRunning: boolean }`
           `rowClock?(parent: HTMLElement, input: RowClockInput, kit: BaseKit): PartView<RowClockInput>` on the
           chat `Layout`
           in `src/plugins/chat/page/row-clock.ts`:
           `export interface RowClockDeps { layouts: ChatLayouts; kit: SurfaceKitDeps; clock: Clock; timers: Timers; log: Log; activeTime(sessionId: string): ActiveTime | null }`
           `export interface RowClock { part: SessionPart; changed(sessionId: string): void }`
           `export function createRowClock(deps: RowClockDeps): RowClock` — the part id is `chat.rowClock`
Decisions: chat offers the clock to other plugins (round 1) · run time formatted with `kit.duration`, redrawn
           once a second in place while running (Decided) · everything draws through a layout, so the run time is
           a chat layout part with its `default` (AGENTS.md § Intent) · the row part's kit uses the `'chat'` scope
           and adds no manifest scope, since `rowClock` names no key (Decided) · `activeTimeChanged` fires on the
           `activeTime` message only; a listener reads the starting value from `activeTime()` (Decided)

Exports and the event:

- `chat-view.ts` keeps each session's `ActiveTime` from `sessionStarted` and from each `activeTime` message, next to
  where it handles `background` today. `mountChatView` takes a new dep `onActiveTime(sessionId: string, activeTime:
  ActiveTime): void`, which it calls on each `activeTime` message, not on `sessionStarted`. It returns or exposes
  `activeTime(sessionId)`: the kept record, null for a session it does not hold. It drops the record when the
  session leaves.
- `start.ts`: the third generic of `PageApi` (the `ChatApi` type, line 43) becomes `ChatPageEvents`, the way
  sessions passes `SessionsPageEvents`. `onActiveTime` emits `api.events.emit('activeTimeChanged', ...)` and calls
  `rowClock.changed(sessionId)`. `start.ts` builds the row clock with `services.clock` and `services.timers`, adds
  `sessions.addRowPart(rowClock.part)`, and keeps the returned `Disposable` with chat's other registrations.

The row part (`row-clock.ts`):

- The part keeps each drawn row by session id: its wrapper, its drawn view, and its `dispose`. A row's `dispose`
  removes it from the kept rows.
- A row draws nothing when `activeTime(sessionId)` is null, or when it is paused (`since === null`) with
  `activeMsAt === 0`. Else it draws the layout's `rowClock` with `{ text: kit.duration(activeMsAt(time, now)),
  isRunning: time.since !== null }`. `now` is `deps.clock.now()`.
- `changed(sessionId)` draws that session's kept row again from the current record: it draws the part when the row
  showed nothing, updates it, or clears the wrapper when the row now draws nothing. A session with no kept row is
  ignored. Then it updates the tick.
- Chat's layouts changing (`layouts.onChange`) draws every kept row again.
- The tick: one pending one-shot timer at a time, through `deps.timers`, `TICK_MS = 1000`, as `agent-strip.ts`
  keeps `pendingTick`. It is pending while any kept row's record is running, and cleared when none is. Each tick
  updates every running row through `callEach`, so one row's failure does not stop the others.
- Each update goes through `chatPartDraws(layouts, 'rowClock', log).update`. On `'none'` or `'threw'` the row draws
  the part again in place, as agent-strip does for its task boxes.
- The kit is `surfaceBaseKit(deps.kit, 'chat', rollback)`, with the rollback recorder the other chat surfaces pass.
- `default`'s `rowClock` draws `span.chat-row-clock` holding the text, `fg-secondary`, `text-12`, no wrap, tabular
  numerals (`font-variant-numeric: tabular-nums`). `isRunning` sets `is-running`; `default` draws it the same as
  paused. Its `update` sets the text and the class in place.
- `read-chat-layout.ts` reads the new part as it reads `queuedMessage`.
- `src/plugins/chat/page/chat.css` orders the part's wrapper, as `usage.css` does for its row parts:
  `.session-row-part[data-part='chat.rowClock'] { order: 3; margin-left: auto; }`, with a one-line comment.

GIVEN a session paused at 65 000 ms WHEN its row draws THEN the part shows `kit.duration(65000)` and no tick is pending
GIVEN a row drawn paused at 0 (empty) WHEN `changed` runs after its clock starts THEN the part draws and a tick is pending
GIVEN a running row WHEN one second passes on the fake timers THEN the part's text is one second later
GIVEN a running row WHEN `changed` runs after its clock stops THEN the text is the stopped total and no tick is pending
GIVEN the row's draw is disposed WHEN a second passes THEN no update runs and no timer is pending

Tests:     `row-clock.test.ts`, with a fake clock and fake `Timers` the test advances: one `it.each` table on what a
           row draws at build (unheld session → empty; paused at 0 → empty; paused at 65 000 → `kit.duration(65000)`;
           running from `now - 5000` → `kit.duration(5000)`); one test per remaining GIVEN above; one test that a
           layout `rowClock` with no `update` still advances its text (drawn again). In
           `layouts/default/layout.test.ts`, add the `rowClock` key to `SURFACE_PARTS` and a row drawing paused
           then running through `update` (text and `is-running` change in place). Add a `rowClock` row to the
           part table in `read-chat-layout.test.ts`. A test of the view's keeping: `activeTime()` returns the
           message's record and null for an unheld id, and `onActiveTime` runs once per message — in the existing
           test file that covers `chat-view.ts` message handling, or in `row-clock.test.ts` when none does.
Done when: compiles; `npm run lint` passes; the test gate runs the tests above
Commit:    one commit for the group

## Proof

Commit 017d5cb4 · proof: diff read; every Produces present; typecheck clean; layer check refuses contract.ts importing src/shared, fixed by the contract change landing next · concerns: layouts design Adopters and AGENTS chat prose lag (task 06); preview rows show no run time; empty wrapper keeps margin-left auto and gap, unchecked on screen; row part and layouts.onChange Disposables dropped, chat keeps no registrations
