# 06 — A composer part's stop on the entry cursor

Status: not started
Type: Task
Wave: 3 · Depends on: 05
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/contract.ts`
           · create `src/plugins/chat/page/composer-stop-holder.ts` · test `src/plugins/chat/page/composer-stop-holder.test.ts`
           · modify `src/plugins/chat/page/entry-focus.ts` · test `src/plugins/chat/page/entry-focus.test.ts`
           · modify `src/plugins/chat/page/entry-list.ts`
           · modify `src/plugins/chat/page/chat-view.ts` · modify `src/plugins/chat/page/start.ts`
           · modify `src/plugins/chat/page/chat-commands.ts` · test `src/plugins/chat/page/chat-commands.test.ts`
           · modify `src/plugins/chat/page/chat.css`
Consumes:  `ChatComposerPart` and `addComposerPart` (`src/plugins/chat/contract.ts`, tree) · `ChatStatusPart` ← 05 ·
           the composer redraw and `ChatViewDeps` as 05 leaves them ← 05 · `api.keys.setScope`, `api.keys.scope`,
           `api.keys.onScopeChanged` (`src/contracts/plugin.ts`, tree) · `SessionTabHandle.isVisible` (tree)
Produces:  in `src/plugins/chat/contract.ts`, as plan.md § File Structure gives them:
             `export interface ComposerStop { enter(sessionId: string, exits: ComposerStopExits): boolean;`
               `leave(sessionId: string): void }`
             `export interface ComposerStopExits { toEntries(): void; toBox(how: 'insert' | 'append'): void }`
             `stop?: ComposerStop;` on `ChatComposerPart`
           in `src/plugins/chat/page/entry-focus.ts`:
             `export function isAtLastStop(focus: EntryFocus, ids: readonly string[]): boolean`
           in `src/plugins/chat/page/entry-list.ts`: `isAtLastStop(): boolean;` on `EntryList`
           in `src/plugins/chat/page/composer-stop-holder.ts`:
             `export interface ComposerStopHolder { offer(parts: readonly ChatComposerPart[]): string | null;`
               `leave(): void; holding(): string | null }`
             `export interface ComposerStopHolderDeps { sessionId: string; name: string; toEntries(): void;`
               `toBox(how: 'insert' | 'append'): void; changed(holding: boolean): void; log: Log }`
             `export function createComposerStopHolder(deps: ComposerStopHolderDeps): ComposerStopHolder`
           (`holding()` is the holding part's id, null while none holds; one holder per held tab, in `HeldTab`)
           in `src/plugins/chat/page/chat-view.ts`: `enterStop(): string | null;` on `ChatSession`
Decisions: see below.

## Decisions

- **Contract comments** (`contract.ts`), beside the plan's lines: `enter` sets the part's own base scope through its
  own `api.keys.setScope` before it returns true, and changes nothing when it returns false. `leave` sets no scope:
  chat, or the view that took the keys, has set one already. A part calls each exit at most once per `enter`; a call
  after chat took the cursor back does nothing. A status part's `stop` is never read (see the conflict in the reply).
- **When `j` offers the stops.** `chat.nextEntry` offers them when `session.entries.isAtLastStop()`, else it moves as
  today. `isAtLastStop(focus, ids)` is true when `ids` is empty, or when `focus.entryId` is the last id. It is false
  for a null `entryId` with ids present, so the first `j` from the start still focuses the last stop. The last stop
  may be a pending row or an open run's line, as `moveFocus` treats them. `EntryList.isAtLastStop` reads it over the
  list's stop order.
- **The offer.** `ChatSession.enterStop()` runs the tab's holder's `offer` with `composerParts.parts()`. `offer` asks each
  part with a `stop`, in part order, and stops at the first whose `enter(sessionId, exits)` returns true. A part whose
  `enter` throws is logged as `[chat] composer part <id> stop failed: <error>` and the next is asked. A stop that takes
  the cursor logs `[chat] composer part <id> took the cursor in <tab name>`; `nextEntry` then logs nothing else. None
  taking it: `nextEntry` runs `moveEntry` as today, which logs the focused stop.
- **Chat's side while a stop holds.** The holder's `changed(true)` adds `is-at-stop` to the tab root; `chat.css` hides
  the focused entry's bar under `.chat-tab.is-at-stop .chat-entry-slot.is-cursor`, as it does for `is-box-focused`.
  `focusedEntry()` returns null while a stop holds. Chat sets no scope at `enter`: the part's `setScope` replaces
  `chat.chat`, so `G`, `gg` and the other chat keys do not fire, and arriving entries keep the list following the last
  entry unmarked. Chat sets no resize or focus target today (Sessions mode's outer panes stay across base scope
  changes), so the part's scope change loses none.
- **Exits** (built per `offer`, bound to that offer):
  - `toEntries()`: the holder holds nothing, `changed(false)`, then `deps.setScope('chat')` and `entries.latest()`
    (the last stop, following). Logs `[chat] cursor back on the entries in <tab name>`.
  - `toBox(how)`: the holder holds nothing first, so the box's `focused` listener calls no `leave`; then
    `changed(false)`, `deps.setScope('chat')`, and `box.focus({ insert: true })` for `insert` or
    `box.focus({ insertAtEnd: true })` for `append`. Logs `[chat] focused the box in <tab name>`, as `focusBox` does.
  - Either one called after its offer stopped holding (left, or a newer offer) does nothing and logs
    `[chat] stale composer stop exit in <tab name> ignored`.
- **When chat calls `leave`.** `holder.leave()` calls the holding part's `stop.leave(sessionId)` once, logs
  `[chat] composer part <id> left in <tab name>`, holds nothing and runs `changed(false)`. A throw from the part's
  `leave` is logged and the holder still clears. Chat calls it:
  - when the box takes focus (the editor's `focused` listener: a mouse click, `fillComposer`, a reveal);
  - on each scope change (`ChatViewDeps.onScopeChanged`, from `api.keys.onScopeChanged`) while the holding tab is not
    the visible tab (`handle.isVisible()` false): another tab, pane or mode showed. A pushed scope over the visible tab
    (help, which-key) keeps the stop;
  - in the tab's own `shown`, before `setScope('chat')`, when it still holds (a guard for a missed change);
  - before the tab's composer draws again (layout change, a composer or status part added or removed), since the
    parts are built again: when the tab is visible chat then sets `chat.chat` and runs `entries.latest()`, as
    `toEntries` does;
  - when `sessions.sessionRemoved` drops the tab, before its composer disposes.
- **No new keys.** `j` and `k` stay `chat.nextEntry` and `chat.prevEntry`. `k` inside the part's scope is the part's own
  bind, which calls `toEntries` (task 09).
- **Self-test.** A fixture composer part is not practical: chat's self-test script runs in main, and a page part
  cannot tell it runs under the self-test (`runMode` is a main service only). Task 09 adds the step in its plugin's
  self-test: with a fake subagent running, `Escape`, then `j` on the last entry expects
  `[chat] composer part agent-strip took the cursor in chat-selftest`, and `k` expects
  `[chat] cursor back on the entries in chat-selftest`. Until then the chat script's `j` steps prove the path where no
  stop takes the cursor.

## Behaviour

GIVEN the cursor on the last entry and a composer part whose stop's `enter` returns true WHEN the user presses `j`
THEN that part holds the cursor, no entry is marked, `chat.chat` is no longer in force, and the log names the part.
GIVEN two parts whose stops both return true WHEN `j` is pressed on the last entry THEN the first in part order takes the cursor,
and the second's `enter` is not called.
GIVEN every stop returns false WHEN `j` is pressed on the last entry THEN the cursor stays on the last entry and logs
it as today.
GIVEN a stop holding WHEN the part calls `toEntries` THEN `chat.chat` is in force, the last stop is focused and marked.
GIVEN a stop holding WHEN the user clicks the box THEN the part's `leave` runs once and the box has focus.
GIVEN a stop holding WHEN another session's tab shows THEN the part's `leave` runs once.
GIVEN a stop holding WHEN help opens over the tab THEN `leave` does not run.

## Tests

- `entry-focus.test.ts`: `isAtLastStop_$case` (it.each) — no ids → true; focus on the last id → true; focus on an
  earlier id → false; null `entryId` with ids → false. Catches `j` entering a stop from mid-list or from the start.
- `composer-stop-holder.test.ts`:
  - `offer_$case` (it.each) — no part has a stop → null; the first stop returns false and the second true → the
    second's id, both asked in order; two return true → the first's id, the second not asked; the first throws →
    logged, the second asked. Catches a wrong order or a throw ending the offer.
  - `exits_ToEntries_ClearsAndRunsChatsToEntries` — after `toEntries`, `holding()` is null, `changed(false)` ran, and
    deps' `toEntries` ran once.
  - `exits_ToBox_ClearsBeforeFocusing` — deps' `toBox` runs with `holding()` already null.
  - `exits_AfterLeaveOrNewerOffer_Ignored` (it.each) — an exit called after `leave`, or an older offer's exit after a
    newer offer, logs the stale line and runs nothing.
  - `leave_Holding_CallsPartLeaveOnce` — `leave` twice calls the part's `leave` once; a throwing `leave` still clears.
- `chat-commands.test.ts`: the fake session's `entries` gains `isAtLastStop` and the session `enterStop`.
  `nextEntry_$case` (it.each) — at the last stop and a stop takes it → logs only the took-the-cursor line and does not
  move; at the last stop and none takes it → moves and logs the focused stop; not at the last stop → `enterStop` is
  not called.
- Self-test: none in this task (see Decisions); task 09's step proves the handover live.

## Runtime look for task 11

With the agent strip drawn: `j` from the last entry, then a mouse click in the box, a tab switch and a pane focus move
each drop the strip's selection; `Space ?` over the strip keeps it.

Done when: `npm run lint` and the suite pass; the tests above run; the chat self-test's `transcript focus` and
`resting session` groups still pass.
Commit:    one commit for the group, its paths by name.

## Proof

