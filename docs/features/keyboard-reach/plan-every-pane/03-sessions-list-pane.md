# 03 — Sessions list pane

Status: not started
Type: Task
Wave: 3 · Depends on: 01
Plan: [plan.md](plan.md)

The Sessions side bar becomes a keyboard pane with its own scope and a row cursor, reached by Alt+h past the
leftmost chat pane through the core's `focusSideBar` (Task 01). The task also folds in the follow-up "Pane focus keys
leave the keyboard in the old pane": Alt+hjkl between chat panes moves DOM focus as a click does.

Files:
- modify `src/plugins/sessions/manifest.ts` (scope `sidebar`, the list commands, the plugin comment)
- modify `src/plugins/keymap.ts` (the list binds; `sessions.sidebar` in the `<C-n>` per-scope list)
- modify `src/plugins/sessions/page/start.ts` (`focusSideBar`, `focusMain`, the side-bar hooks, the list command
  handlers, the `checkVisible` guard, the key-move focus step, the page part's comment)
- modify `src/plugins/sessions/page/sessions-view.ts` (`SessionsView.list`, the cursor state, two new deps)
- modify `src/plugins/sessions/page/sidebar-view.ts` (the cursor ring, the cursor prompt, the focusable rows box)
- modify `src/plugins/sessions/page/sidebar-order.ts` (the two pure cursor rules)
- modify `src/plugins/sessions/page/layout/sessions-parts.ts` (`RowKit.cursorPrompt`, the prompt's app slot)
- modify `src/plugins/sessions/layouts/layout.d.ts` (`SessionRowInput.isPrompted`, `RowKit.cursorPrompt`, `is-cursor`
  in the "app keeps" list)
- modify `src/plugins/sessions/layouts/default/layout.js`, `layout.css` (the prompt's place, the cursor ring)
- modify `src/shared/page/pane-tree/pane-tree-view.ts` (the `keyFocused` option)
- modify `src/plugins/sessions/main/selftest-script.ts` (three groups, the result check)
- modify `docs/features/followups.md` (remove the entry "Pane focus keys leave the keyboard in the old pane", near
  line 192; find it by its title)
- test `src/plugins/sessions/page/sidebar-order.test.ts`, `src/plugins/sessions/page/sessions-view.test.ts`,
  `src/plugins/sessions/page/start.test.ts`, `src/plugins/sessions/page/layout/sessions-parts.test.ts`,
  `src/shared/page/pane-tree/pane-tree-view.test.ts`

`plan.md`'s File Structure lists this task's files without `sidebar-order.ts`, `sessions-parts.ts`, `layout.d.ts` and
the self-test script; they are this task's alone (no other task touches them).

Consumes:
- `Mode.focusSideBar?(): void` and `Mode.focusMain(): void` in `src/contracts/plugin.ts` ← 01. The core calls
  `focusSideBar` on Alt+h past main's left edge while the side bar shows, then holds the side area; it calls
  `focusMain` on Alt+l from the side area (and Alt+h from the right bar). A base scope change the core did not make
  returns its area to main.
- Task 01 gives Sessions' `mode.add` a `focusMain`; this task replaces that body with the one below.
- Seam to check against 01: the scope `sideBarOpenedOver` sets (below) must leave the core holding the side area, so
  Alt+l from the overlay reaches `focusMain`; when 01's core treats that scope change as one it did not make, the
  lead rules where the side area is set.
- The tree already holds `ModeHandle.picked()`, `ModeHandle.sideBarShown()`, `Mode.sideBarHidden?()`,
  `Mode.sideBarOpenedOver?()` (`src/contracts/plugin.ts`), `appSlot` (`src/shared/page/layout-host/app-slot.ts`),
  the row primitive's `.ui-row.is-cursor` ring (`src/shared/page/ui/row.css`), `chat.focusBox`.

Produces:
- `sessions.sidebar` scope: `scopes.sidebar: 'In the sessions list'` in `src/plugins/sessions/manifest.ts`.
- The list commands in `src/plugins/sessions/manifest.ts`, each `group: 'list'`, `runsIn: 'page'`:

  | Command | Label | Key (scope `sessions.sidebar`) |
  |---|---|---|
  | `listDown` | `next session row` | `j` |
  | `listUp` | `previous session row` | `k` |
  | `listTop` | `first session row` | `gg` |
  | `listBottom` | `last session row` | `G` |
  | `listOpen` | `show the session and focus its pane` | `<CR>` |
  | `listShow` | `show the session, staying in the list` | `l` |
  | `listBack` | `back to the focused pane` | `<Esc>` |
  | `listFavorite` | `favorite or unfavorite the row's project` | `s` |
  | `listMoveUp` | `move the row's project up` | `K` |
  | `listMoveDown` | `move the row's project down` | `J` |
  | `listRename` | `rename the row's session` | `r` |
  | `listClose` | `close the row's session` | `d` |

  The binds sit in `src/plugins/keymap.ts` under "Tabs and sessions", after `sessions.moveProjectDown`.
  `'sessions.sidebar'` joins the `<C-n>` per-scope list right after `'sessions.idle'`.
- In `src/plugins/sessions/page/sidebar-order.ts`:
  - `export type CursorMove = 1 | -1 | 'first' | 'last';`
  - `export function movedCursor(order: readonly string[], cursorId: string | null, move: CursorMove): string | null`
  - `export function cursorAfterDraw(before: readonly string[], after: readonly string[], cursorId: string | null): string | null`
- In `src/plugins/sessions/page/sessions-view.ts`:
  - `SessionsView.list: SessionList`, with
    ```ts
    export interface SessionList {
      enter(): SessionRow | null;
      leave(): boolean;
      holdsKeys(): boolean;
      move(move: CursorMove): SessionRow | null;
      cursorSessionId(): string | null;
      refocus(): void;
    }
    ```
  - `SessionsViewDeps.cursorMoved(row: SessionRow | null): void` and `SessionsViewDeps.paneKeyFocused(): void`
- In `src/plugins/sessions/page/sidebar-view.ts`: `SidebarView.focus(): void`; `render` gains a last parameter
  `cursor: SidebarCursor`, `export interface SidebarCursor { sessionId: string | null; hasKeys: boolean }`;
  `mountSidebarView` gains the `anchor` it names the prompt's keys with (`KeyHints['anchor']`).
- In `src/plugins/sessions/layouts/layout.d.ts`: `SessionRowInput.isPrompted: boolean`;
  `RowKit.cursorPrompt(parent: HTMLElement): HTMLElement | null`.
- In `src/shared/page/pane-tree/pane-tree-view.ts`: `PaneTreeViewOptions.keyFocused(id: string): void`.
- Sessions' `Mode` passes `focusSideBar`, `focusMain`, `sideBarHidden`, `sideBarOpenedOver`.

Decisions:

**The cursor.** The cursor is a session id the view holds apart from the selected row (the focused pane's session).
It walks the session rows in drawn order (`drawnRows` of the drawn sections: the preview's while it shows), so the
section labels and group headers are never under it.
- *Entry* (`list.enter`): the cursor goes on the selected row, else the first drawn row, else none, on every entry.
  The list holds the keys from then on; the rows box takes DOM focus.
- *Moves* (`movedCursor`): `1`/`-1` step one row, clamped at the ends (no wrap); `'first'`/`'last'` go to the ends; a
  cursor that is null or not in `order` lands on the first row for any move; an empty order gives null.
- *Rows change under it* (`cursorAfterDraw`, applied by every side bar draw while the list holds the keys, against
  the order the last draw drew): a cursor whose row is still drawn stays on it wherever it moved (a favorite toggle
  moves its group between sections); a cursor whose row left goes to the row now at the index it held in `before`,
  clamped to the last row, so a close lands on the next row, or the previous one for the last; a cursor that is null
  or was not in `before` takes the first row; no rows give null. A draw that changed the cursor this way calls
  `cursorMoved` with the new row (null for none). The selected row changing (`l`, `Enter`, `Alt+Shift+o`) never moves
  the cursor.
- *Leaving* (`list.leave`): the cursor goes back on the selected row and the ring comes off; returns whether the list
  held the keys (false, doing nothing, when it did not).
- *Drawn*: the cursor's row carries `is-cursor` while the list holds the keys, and scrolls into view
  (`scrollIntoView({ block: 'nearest' })`) after each draw and move then. Out of the list the cursor is the selected
  row, so the cursor prompt sits there, hidden by its scope and keeping its space, as the docs tree's prompt sits on
  its selected row. Decided (lead): the selected card keeps the hidden prompt line at all times, per `DESIGN.md`'s
  "hides in place, keeping its space", so the card's height never shifts on entering or leaving the list.
- *DOM focus*: the side bar view sets `tabIndex = -1` on the drawn pane's `rows` box each time it draws the pane, and
  `focus()` focuses that box. A `redrawPane` while the list holds the keys focuses the new box (`list.refocus`).

**The cursor prompt** (`DESIGN.md` § Keys and focus, cursor prompt), modelled on the docs tree's
(`src/plugins/docs/page/tree-view.ts` `rowActionsElement`, `layout.d.ts` `cursorPrompt`): the side bar view builds two
`span.session-row-actions` elements once, for its life, each anchor with `scope` `sessions.sidebar` and its label:
- a favorite project's row: `listFavorite` `unfavorite`, `listMoveUp` `up`, `listMoveDown` `down`, `listRename`
  `rename`, `listClose` `close`, in that order;
- any other row: `listFavorite` `favorite`, `listRename` `rename`, `listClose` `close`.

The cursor's row draws with `isPrompted: true` and its variant; every other row with false. `RowKit.cursorPrompt`
places the app's prompt through an `appSlot` named `cursorPrompt` and returns it, or returns null on a row that is not
prompted; a prompted row whose layout leaves it out gets it at its element's end (`placeIfLeftOut`). The default
layout calls `kit.cursorPrompt(element)` after the footer when `input.isPrompted`, and its CSS gives
`.session-row-actions` the card's full width on its own grid line (`grid-column: 1 / -1`), wrapping when it has no
room. `layout.d.ts` adds `is-cursor` on the cursor's row to "The app keeps". The CSS draws
`.ui-row.session-row.is-cursor` with the focus ring (`focus-border`, 1px, inset) over the selected border and the
on-screen ring; the status edge's pseudo-element stays.

**Entering and leaving** (`start.ts`):
- `focusSideBar`: `api.keys.setScope('sidebar')`, then `view.list.enter()`; logs `list focused on <label>`, or
  `list focused, no rows`. `sideBarOpenedOver` runs the same.
- *Main's scope*: while the list holds the keys `checkVisible` tells no tab and sets no `idle`, so a visible tab that
  changes under the list (`l`, a close, `Alt+Shift+o`) never takes the scope. Ending the list's turn always sets
  main's scope again: the visible tab's `shown`, or `idle` when the focused pane shows no tab, whatever `checkVisible`
  last saw.
- `focusMain`: when `view.list.leave()` returns true it logs `list left` and calls `mode.picked()` (closing a narrow
  window's overlay, so the keys never sit in a pane under it; the `leave` comes first, so the `sideBarHidden` it may
  cause finds the list already left); then it sets main's scope and runs the key-move focus step below. The core's
  Alt+l, `Enter` and `Esc` all end through it.
- `sideBarHidden`: when `view.list.leave()` returns true, logs `list left`, sets main's scope and runs the key-move
  focus step, without `picked`.
- `hidden`: ends the list's turn (`leave`, no log, no focus step) before its `checkVisible`.
- A `pointerdown` (capture) or `focusin` inside the mode's element (`view.element`, the chat panes) while the list
  holds the keys ends its turn: `leave`, `list left`, main's scope, no `picked`, no focus step, since the press or the
  focus places the DOM focus itself.
- A list key other than `Esc` while `mode.sideBarShown()` is false (a narrowing hid the side bar without telling) logs
  `list keys ignored: the side bar is hidden` and does nothing.

**The list keys** (`start.ts`):
- `j`/`k`/`gg`/`G`: `view.list.move(1 | -1 | 'first' | 'last')`; logs `list cursor on <label>` (also at an end, where
  the cursor stays), or `no session rows`. `cursorMoved` logs the same two lines.
- Every cursor-row key reads main's row under the cursor (`rowOf(view.list.cursorSessionId())`); with none, or on a
  layout preview row, which is not main's, it logs `no session under the cursor` and does nothing.
- `Enter`: `exports.activate(row.sessionId)` (as a row click: the pane showing the session takes focus, else the
  focused pane loads it), then `focusMain` (which runs `picked`).
- `l`: `exports.activate(row.sessionId)` only; no `picked`, so a narrow overlay stays open and the list keeps the keys.
- `Esc`: `focusMain`.
- `s`: `view.toggleFavorite(row.project)`; `K`: `view.moveFavorite(row.project, -1)`; `J`:
  `view.moveFavorite(row.project, 1)`. Their lines are the existing ones (`favorited <p>`, `unfavorited <p>`,
  `moved <p> up|down`, `<p> cannot move up|down`, `<p> is not a favorite`), so a non-favorite row's `J`/`K` logs
  `<p> is not a favorite` and changes nothing.
- `r`: `renameDialog.open(row)`; the dialog's close gives focus back to the rows box (it restores what held focus).
- `d`: `exports.closeSession(row.sessionId)` (the existing tab close guards and confirm, then main's close); once it
  settles, closed or kept, the rows box takes focus again when the list still holds the keys (`list.refocus`). The
  row leaving moves the cursor by `cursorAfterDraw`.
- The existing focused-pane commands (`<Leader>pf`, `<Leader>rr`, `<Leader>;` and the rest) keep acting on the
  focused pane's session in every scope, the list's included.

**Key moves between chat panes** (the follow-up): `createPaneTreeView` calls `keyFocused(id)` after
`outer.focus.move` moved focus, once `focused` ran; a release, `focus(id)` and a move that stays put call it never.
`sessions-view` passes it on as `paneKeyFocused()`. In `start.ts` the step `panePressed` runs after its `keep` check
becomes one helper, run by `panePressed` (after that check), by `paneKeyFocused` and by `focusMain`: blur the focused
element, then run `chat.focusBox` when the focused pane shows a session and the command is registered, logging
`keys to pane <label>` first (`empty` for an empty pane, as `paneLabel` reads). A key move so lands where a click on
the pane lands: the Chat box, in insert mode.

GIVEN panes [c | b] with b focused and favorites [b, c] WHEN Alt+h, Alt+h THEN `pane focused panes-c`, then
`list focused on panes-c`, the scope `sessions.sidebar`, the ring on c's row
GIVEN the list holds the keys on b, shown in another pane WHEN `l` THEN b's pane takes focus and the list keeps the
scope and the keys
GIVEN the cursor on a, the last row WHEN `d` closes a THEN the cursor moves to the row before and logs
`list cursor on <label>`
GIVEN the list holds the keys and the focused pane shows no tab WHEN Esc THEN the scope is `idle`

Tests:
- `sidebar-order.test.ts`: `movedCursor_StepsAndClampsInDrawnOrder` (`it.each`): rows over order [a, b, c] —
  b +1 → c; c +1 → c; a −1 → a; b 'first' → a; a 'last' → c; null +1 → a; absent 'x' −1 → a; [] +1 → null.
  `cursorAfterDraw_KeepsOrReplacesTheCursorRow` (`it.each`): b, [a,b,c] → [c,b,a] → b; b, [a,b,c] → [a,c] → c;
  c, [a,b,c] → [a,b] → b; a, [a,b] → [] → null; null, [] → [a,b] → a; x, [a,b] → [b,a] → b.
- `sessions-view.test.ts`: `sessionList_EntryMovesAndLeave` (`it.each`) over three rows in two groups with b
  selected: enter → cursor b, `is-cursor` on b's row only, b prompted; move 'last' → the last row ringed and
  prompted; leave → true, no `is-cursor`, the selected row prompted again; leave again → false. A row on a favorite
  project draws the favorite variant (five anchors) and a Recent row the other (three).
  `sessionList_RowLeaving_MovesTheCursorAndReports`: with the cursor on the last row, a state without it moves the
  cursor to the row before and calls `cursorMoved` with that row.
- `start.test.ts`: `listShow_KeepsTheListScope_WhileTheVisibleTabChanges` — after `focusSideBar`, `listShow` on a
  row of another session leaves the last scope set `sidebar`; `focusMain_SetsIdle_WhenThePaneShowsNoTab`;
  `paneKeyFocused_RunsFocusBox` — a key move into a pane showing a session runs `chat.focusBox`, as a release does.
- `sessions-parts.test.ts`: a row case whose layout leaves `cursorPrompt` out gets the prompt at its element's end;
  one that calls it twice draws with `default`. Add these as rows of the existing row-part table when one owns the
  fallback rule.
- `pane-tree-view.test.ts`: widen `reports a release only when it moved focus` to assert `pressFocused` and
  `keyFocused` per row (`reports a release or a key move only when it moved focus`), adding the row "a key move at
  the edge" (`move('left')` from `a` → neither); "a focus move" now expects `keyFocused` ['b'].

Self-test (`src/plugins/sessions/main/selftest-script.ts`), three groups after `drawn order`, which leaves panes
[c | b] with b focused and no favorites:
- `list keys`, why `Option+h past the leftmost pane reaches the Sessions list, whose cursor walks the session rows and shows a row by Enter or l.`:
  1. `' ', 'p', 'f'` → `[sessions] favorited panes-b`
  2. `<A-h>` → `[sessions] pane focused panes-c`, alsoExpect `/\[sessions\] keys to pane panes-c/`, why
     `A pane key moves the keys into the pane it focuses, as a click does.`
  3. `' ', 'p', 'f'` → `[sessions] favorited panes-c` (drawn: panes-b, panes-c, then panes-a)
  4. `<A-h>` → `[sessions] list focused on panes-c`, screenshot `list-cursor`
  5. `j` → `[sessions] list cursor on panes-a`; 6. `g`,`g` → `… on panes-b`; 7. `G` → `… on panes-a`;
     8. `k` → `… on panes-c`; 9. `k` → `… on panes-b`
  10. `l` → `[sessions] activated panes-b`
  11. `j` → `[sessions] list cursor on panes-c`, why `The list keeps the keys after l.`
  12. `G` → `[sessions] list cursor on panes-a`
  13. `Enter` → `[sessions] list left`, alsoExpect `/\[sessions\] activated panes-a/` (panes [c | a], a focused)
  14. `<A-h>` → `[sessions] pane focused panes-c`; 15. `<A-h>` → `[sessions] list focused on panes-c`;
      16. `Escape` → `[sessions] list left`; 17. `<A-h>` → `[sessions] list focused on panes-c`;
      18. `<A-l>` → `[sessions] list left`
- `list row keys`, why `s, K, J, r and d act on the cursor's row, not the focused pane's session.` (panes [c | a], c
  focused, favorites [b, c]):
  1. `<A-h>` → `[sessions] list focused on panes-c`
  2. `K` → `[sessions] moved panes-c up`; 3. `K` → `[sessions] panes-c cannot move up`
  4. `j` → `[sessions] list cursor on panes-b`; 5. `J` → `[sessions] panes-b cannot move down`
  6. `j` → `[sessions] list cursor on panes-a`; 7. `J` → `[sessions] panes-a is not a favorite`
  8. `s` → `[sessions] favorited panes-a`; 9. `K` → `[sessions] moved panes-a up`, screenshot `list-favorite-prompt`
  10. `s` → `[sessions] unfavorited panes-a`
  11. `r`, `...RENAMED`, `Enter` → `[sessions] renamed panes-a to "Renamed in test"`
  12. `r`, `RENAMED.length` × `Backspace`, `Enter` → `[sessions] cleared the user title of panes-a`, why
      `The rename dialog gives the keys back to the list.`
  13. `d` → `[sessions] list cursor on panes-b`, why `Closing the cursor's last row moves the cursor to the row before.`
  14. `s` → `[sessions] unfavorited panes-b`; 15. `g`,`g` → `[sessions] list cursor on panes-c`;
      16. `s` → `[sessions] unfavorited panes-c`; 17. `Escape` → `[sessions] list left`
- `list overlay`, why `In a window too narrow for the side bar, Space k s opens the list over the panes with the keys in it, and Enter closes it.`:
  1. width `600`, `' ', 'k', 's'` → `[sessions] list focused on panes-c`
  2. `j` → `[sessions] list cursor on panes-b`
  3. `Enter` → `[sessions] list left`, alsoExpect `/\[page\] side bar hidden/`, `/\[sessions\] activated panes-b/`
  4. width `'start'`, `<A-h>` → `[sessions] list focused on panes-b`, why
     `Back at the start width the side bar lies beside the pane again.`
  5. `Escape` → `[sessions] list left` (the script ends with one pane, panes-b, focused)

`problems()` now expects panes-a's row gone (the `d` step closed it) and panes-b's and panes-c's in place, and the
script's comment says so.

Prose: the manifest's and `start.ts`'s plugin comments, `SessionsView`'s and `SidebarView`'s interface comments,
`layout.d.ts`'s header and `layout.js`'s summary each gain the list, its scope and the cursor prompt, as they now name
the rows and the project keys.

Done when: compiles; the tests above pass; `npm run selftest -- --plugin
sessions` passes; the follow-up entry is gone from `docs/features/followups.md`. Runtime and visual checks belong to
[the final verification](10-final-verification.md).

Commit: one commit for the group.

## Proof

