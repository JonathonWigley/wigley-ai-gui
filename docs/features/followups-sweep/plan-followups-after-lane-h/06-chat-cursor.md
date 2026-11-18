# 06 — Chat cursor follows tall blocks and hidden tabs

Status: in progress
Type: Batch
Rung: hard · the cursor's scroll rules interact (following, the visible band, the saved place), and no existing pattern settles which callers of `scrollToFocus` settle the cursor
Wave: 2 · Depends on: 07 (both list `entry-list.ts`, `entry-list.test.ts` and `agent-chat/design.md`)
Plan: [plan.md](plan.md)

Fixes two follow-ups (`docs/features/followups.md`, main at 9b671bd16):

- L197 **A clamped key on a too-tall last block stops following**: following at the bottom on a last stop taller than
  the band, `j` or `J` takes the `slot` scroll, whose `scrollIntoView({ block: 'nearest' })` pulls the list up a few
  pixels and ends following, so a streaming reply is left behind until `G`.
- L202 **A turn ending in a hidden tab can leave the chat cursor off screen**: `latest` skips its band settle on a
  hidden list, and `scrollToFocus` on show fires no scroll when the list already sits at the bottom, so over an
  overflowing open run the cursor stays on the run's line, off screen, until the next scroll.

Files:
- modify `src/plugins/chat/page/entry-list.ts`
- test `src/plugins/chat/page/entry-list.test.ts`
- modify `docs/features/agent-chat/design.md` (the block-stop paragraph, `j` or `J` onto the last stop)

Preconditions (run from the `wigley-ai-gui/` folder of the merged `main`):

| Claim | Command | Expected |
|---|---|---|
| `scrollsToStop` reads only following and the stop's height | `grep -n -A2 'const scrollsToStop' src/plugins/chat/page/entry-list.ts` | `!focus.following \|\|` then `isTallerThanBand(stop.getBoundingClientRect(), visibleBand(list));` |
| `scrollToFocus` draws and never settles | `grep -n 'const scrollToFocus = ' src/plugins/chat/page/entry-list.ts` | `const scrollToFocus = () => drawFocus(focus.following ? 'bottom' : 'slot');` |
| The chat tab calls it on every show | `grep -n 'entries.scrollToFocus' src/plugins/chat/page/chat-view.ts` | one line, inside the tab's `shown` handler |
| `latest` settles only on a shown list | `grep -n -A6 '    latest() {' src/plugins/chat/page/entry-list.ts` | `if (!isListHidden()) {` then `settleInBand(1, true);` |

Consumes: nothing.

Produces: no new export. `EntryList.scrollToFocus(): void` keeps its signature; its behaviour changes as below.

Decisions:
- **L197**: `scrollsToStop(stop)` becomes `!focus.following || (isTallerThanBand(...) && !isScrolledToEnd(list, 1))`
  (the fix the follow-up names). A following cursor on a too-tall stop with the list already at its bottom then falls
  to `scrollFocus`'s following branch and scrolls to the bottom, so it keeps following. A move onto a too-tall last
  stop with the list off its bottom keeps today's behaviour (its start shows, following only once a scroll lands on the
  bottom).
- **L202**: `scrollToFocus` settles the cursor into the band on its following path: after its draw, while
  `focus.following` and the list is not hidden (`isListHidden()`), it runs the same settle `latest` runs
  (`settleInBand(1, true)`). This covers every caller (the tab's show, `rebuild`, `applySavedPlace`), since each
  scrolls a following list to its bottom and the documented rule ("at the bottom, whether or not the list had to
  scroll there, the cursor moves to the nearest step in view") holds for all of them.
- The settle in `scrollToFocus` is a change by the list, not the user: `settleInBand` gains a `by: PlaceChange`
  parameter; `onListScroll` and `latest` pass `'user'` as today, `scrollToFocus` passes `'list'`. So a held
  `restorePlace` value survives the settle (`placeMoved('list')` keeps `savedPlace`), and only the user's moves drop it.
- Update the `EntryList` interface comments that the change makes untrue: `move` ("A move onto the last stop …"):
  add that a following cursor on a too-tall stop with the list at its bottom stays at the bottom and follows;
  `scrollToFocus`: "Scrolls to the bottom while following and moves a cursor left off screen into the visible band, as
  `latest` does; else brings the focused stop into view." Keep the header comment's "its tab calls `scrollToFocus`
  each time it shows" sentence true.
- `docs/features/agent-chat/design.md`, the block-stop paragraph ("`j` or `J` onto the last stop scrolls to the
  bottom and follows, unless the stop is too tall for the view: then its start shows, …"): add "; a `j` or `J` that
  stays on a too-tall last stop while the list follows at its bottom leaves the list there, still following".

GIVEN the list follows at its bottom (scrollTop 800 of scrollHeight 900, clientHeight 100) with the cursor on the last
block, 150px tall in a 100px band, WHEN `move(1)` runs THEN `scrollIntoView` is not called, scrollTop is 900, and an
entry put after it takes the cursor (still following).

GIVEN the same list WHEN `moveToMessage(1)` runs at the last message THEN the same holds.

GIVEN a list over an overflowing open last run whose `latest()` ran while it was hidden (clientHeight 0), leaving the
cursor on the run's line, WHEN it shows again (clientHeight 100) at its bottom and `scrollToFocus()` runs THEN the
cursor moves to the nearest step in the band and follows: a step put after it takes the cursor.

GIVEN the same list still hidden WHEN `scrollToFocus()` runs THEN the cursor stays on the run's line.

GIVEN a shown list that follows at its bottom and overflows, and a `restorePlace` whose focus names a stop the first
`rebuild` does not hold WHEN that `rebuild` runs and settles, then a second `rebuild` holds the stop THEN the cursor
is on the saved stop (the settle by the list kept `savedPlace`).

Tests (all in `src/plugins/chat/page/entry-list.test.ts`):
- `move_OntoTheLastStop ($case)`: add a `from` field (the scrollTop the row starts at, fired as a scroll before the
  move) to every row; the three existing rows take `from: 100`. Add the row
  `case: 'a clamped move on a stop too tall while following at the bottom keeps following'`, `startsOnLastStop: true`,
  `from: 800`, `lastStop: { top: -20, height: 150 }`, `scrollsToStop: false`, `scrollTop: 900`, `afterPut: 'n'`.
- `moveToMessage_ClampedOnAStopTooTallFollowingAtTheBottom_KeepsFollowing`: the row above's setup with
  `list.moveToMessage(1)` in place of `move(1)`; asserts no `scrollIntoView` call, `scroller.scrollTop` 900,
  `cursorLabel(list)` `'a#1'`, then after `put(notice('n'))` `cursorLabel(list)` `'n'`.
- `scrollToFocus_ShownAgainAtTheBottomOverAnOverflowingOpenRun ($case)`: built as
  `latest_AtTheBottomOverAnOverflowingOpenRun`, with `scroller.clientHeight = 0` before `list.latest()`, then
  `scroller.clientHeight = shownHeight` and `list.scrollToFocus()`. Rows:
  `'moves the cursor into the band and follows'` (`shownHeight: 100`, focused `{ kind: 'entry', entry: tool('t2') }`,
  after `put(tool('t3'))` focused `tool('t3')`) and `'on a list still hidden stays on the line'` (`shownHeight: 0`,
  focused the `activity:t1` stop with steps t1, t2; after the put, that stop with steps t1, t2, t3).
- New `'a restored place whose stop is not drawn yet survives the settle of a following overflowing list'`: set up
  under `activityShown()` with the scroller geometry of `latest_AtTheBottomOverAnOverflowingOpenRun` (shown,
  overflowing, at its bottom, following). `list.restorePlace({ focus: { stopId: 't3', following: false, anchorId:
  null }, openRuns: ['activity:t1'], openExpanders: {} })`; `list.rebuild` over `user('u1'), tool('t1'), tool('t2')`
  (no `t3`), so `scrollToFocus` runs its settle; then `list.rebuild` over `user('u1'), tool('t1'), tool('t2'),
  tool('t3')` → `cursorLabel(list)` is `'t3'`. It fails when the settle passes
  `'user'`, which clears `savedPlace`.
- `scrollToFocus_FollowingOnAStopTooTall_ScrollsToTheBottom` and `latest_AtTheBottomOverAnOverflowingOpenRun` stay
  unchanged and pass.

Done when: compiles (`npm run typecheck`); `npm test` runs the tests above and the rest of `entry-list.test.ts` green;
the design.md line is updated.

Commit: one commit, "Chat cursor: keep following on a clamped key over a too-tall last block, settle into the band
when a hidden tab shows (follow-ups L197, L202)".

## Proof

