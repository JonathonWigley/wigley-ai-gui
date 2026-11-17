# 03 — Sessions pane clicks and presses

Status: in progress
Type: Batch
Rung: hard · changes when a tab bar draw replaces DOM under a live click, and what a release reads of a press it did not see begin
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Two follow-ups about the first press in an unfocused chat pane (`followups.md` on main at 9b671bd16):

- **A — Tabs lose their first click in an unfocused pane** (L169): pane focus moves on the release, and `drawFrame`
  rebuilds the strip with `strip.replaceChildren()`, so the released tab leaves the document before its `click`.
  `drawFrame` also redraws the popup bar on each draw (`drawPopupBar`), so a hidden popup's bar entry loses its first
  click the same way.
- **B — A press on an older selection in an unfocused pane leaves the keys nowhere** (L175): `pressedFocusAction`
  reads the selection at the release, so it cannot tell a selection the press made from an older one in that pane.

Files:
- modify `src/plugins/sessions/page/session-tabs-view.ts` (A: `Frame.drawnTabs`, `drawFrame`, `disposeTabs`, `scrollSelectedIntoView`; `Frame.popupBarEntries`, `drawPopupBar`, `redrawPane`, `redrawBars`)
- modify `src/plugins/sessions/page/pane-sessions.ts` (B: `SelectionEnds`, `isPressSelection`, the `PressedPaneFacts.hasSelectionInPane` comment)
- modify `src/plugins/sessions/page/start.ts` (B: the press record and `panePressed`)
- test `src/plugins/sessions/page/session-tabs-view.test.ts`
- test `src/plugins/sessions/page/pane-sessions.test.ts`
- test `src/plugins/sessions/page/start.test.ts`

Preconditions (run from the `wigley-ai-gui/` folder of the merged tree; checked 2026-11-17 on the Lane H branch):

| Claim | Command | Expected |
|---|---|---|
| A: every draw empties the strip | `grep -n "strip.replaceChildren();" src/plugins/sessions/page/session-tabs-view.ts` | one line, in `drawFrame` |
| A: drawn tabs are a list by index | `grep -n "drawnTabs: DrawnPart<SessionsPart>\[\];" src/plugins/sessions/page/session-tabs-view.ts` | one line (`Frame`) |
| A: every draw redraws the popup bar | `grep -n -A3 "const drawPopupBar = (frame: Frame) => {" src/plugins/sessions/page/session-tabs-view.ts` | `if (frame.popupBar !== null) {` then `disposePart(frame.popupBar);` |
| A: a tab's input is its title and icon | `grep -n "parts.tab(strip, { title: view.title, icon: view.icon })" src/plugins/sessions/page/session-tabs-view.ts` | one line (`drawTab`) |
| B: the release reads the selection | `grep -n -A3 "hasSelectionInPane:" src/plugins/sessions/page/start.ts` | `textSelection?.isCollapsed === false && pane.contains(textSelection.anchorNode)` |
| B: no press record | `grep -n "pointerdown" src/plugins/sessions/page/start.ts` | only `view.element.addEventListener('pointerdown', endListByMain, true)` |

Consumes: nothing.

Produces:
- `export interface SelectionEnds { anchorNode: unknown; anchorOffset: number; focusNode: unknown; focusOffset: number }` in `src/plugins/sessions/page/pane-sessions.ts`
- `export function isPressSelection(atPress: SelectionEnds | null, atRelease: SelectionEnds | null): boolean` in `src/plugins/sessions/page/pane-sessions.ts`

Decisions:
- **A, keep tab elements across draws.** `Frame.drawnTabs` becomes a `Map` from tab id to the drawn tab and the
  `title` and `icon` it drew with. `drawFrame` keeps a drawn tab whose title and icon are unchanged and only toggles
  its `is-active` class and `aria-current`; it disposes the drawn tabs of ids no longer in `frame.entries` and of
  ids whose title or icon changed, and draws those afresh. The strip's children then follow `frame.entries`' order:
  an element is moved only when the strip's child at that index is a different element, so a draw that changes
  nothing moves nothing. The `select` callback is per tab id, so a kept tab's `rowAction` stays right.
  `scrollSelectedIntoView` reads the selected tab's element by id. `disposeTabs` (from `redrawBar` and the session's
  drop) still disposes every drawn tab and empties the map: a layout change redraws every tab, as now. The pane part
  already updates in place for the same reason (`drawPanePart`); this is the tab strip's counterpart.
- **A, keep the popup bar across draws.** The bar is one `popupBar` part over all its entries, and `PopupBarPart` has
  no `update`, so the bar is kept or drawn again as a whole. `Frame` gains `popupBarEntries: { id: string; title:
  string; icon: string; status: string }[]`: the entries the drawn bar holds, newest hidden first, `id` being the
  popup's `view.id`; empty while no bar is drawn. `drawPopupBar` builds that list from `hiddenNewestFirst(frame.popups)`.
  When `frame.popupBar` is not null and the new list equals `frame.popupBarEntries` entry by entry (the same ids in
  the same order, each with the same `title`, `icon` and `status`), it keeps the bar and its entry elements and
  returns. Otherwise it disposes the bar and draws it again from the new list as now (no bar while no popup is
  hidden), and stores the list. Each entry's `rowAction` finds its popup by id when it runs
  (`frame.popups.find((each) => each.view.id === id)`) and does nothing when none is found, so a kept entry never acts
  on a dropped `Popup` record. A layout change still draws the bar again: `redrawPane` and `redrawBars` dispose
  `frame.popupBar`, set it to null and empty `popupBarEntries` for each frame before their draw. `drop` already
  disposes the bar.
- **B, record at the press.** `start.ts` adds a capture `pointerdown` listener on `window` that reads
  `window.getSelection()` into `selectionAtPress`: its `SelectionEnds` when the selection is not collapsed, else
  null. It is removed in the part's `dispose`. On a window listener: the press may begin anywhere the pane tree's own
  `notePress` (also on `window`) hears it. `panePressed` reads the selection now the same way and passes
  `hasSelectionInPane: isPressSelection(selectionAtPress, now) && pane.contains(now.anchorNode)`.
- **B, the rule.** `isPressSelection` is true when the release finds a selection that is not the one the press
  found: `atRelease` not null, and `atPress` null or differing in any of the four fields. A press on the old
  selected text (Chromium collapses it after `mouseup`) and a press on a `preventDefault` target (the old selection
  stays) both read as no selection of this press, so `pressedFocusAction` sends the keys to the box; a drag that
  makes a new selection keeps it. A drag that reselects exactly the old range counts as no new selection: the keys go
  to the box, the one extra key the item already accepts. `pressedFocusAction` itself is unchanged; the
  `hasSelectionInPane` comment says "a selection this press made, not collapsed, anchored in the pressed pane".

A — GIVEN two panes, the first focused, the second's session with tabs `a` and `b`, `a` selected WHEN the user presses and releases on tab `b` in the second pane THEN pane focus moves and tab `b`'s element is still the same element in the strip, so its `click` runs `selectTab` for `b`.
A — GIVEN a drawn strip WHEN a tab is removed THEN its element leaves the strip and the others stay the same elements, in order.
A — GIVEN two panes, the first focused, the second's session holding a hidden popup `p` WHEN the user presses and releases on `p`'s popup bar entry in the second pane THEN pane focus moves and the entry is still the same element, so its `click` opens `p`.
B — GIVEN an unfocused pane holding a selection from before WHEN a press and release on that pane leave that same selection THEN the release sends the keys to the Chat box (`toBox`).
B — GIVEN an unfocused pane with no selection WHEN a press drags out a new selection there THEN the release keeps it (`keep`), as today.

Tests:
- `session-tabs-view.test.ts`, new `'a draw keeps each unchanged tab element, so a release that moves pane focus
  leaves the click its target'`: two panes, the second pane's session holding tabs `a` and `b`; read tab `b`'s
  element, `panes.focus` the second pane; the strip's `b` element is the same object, and its `click` records
  `selectTab('<session>', 'b')`.
- `session-tabs-view.test.ts`, new `'a removed tab leaves the strip while the others keep their elements'`: tabs
  `a`, `b`, `c`; dispose `b`'s handle; the strip holds `a` and `c`, each the same object as before, in that order.
- `session-tabs-view.test.ts`, new `'a draw keeps an unchanged popup bar, so the first click on an unfocused pane's
  bar entry reaches it'`: two panes, the second pane's session holding popup `p` added with `addPopup` and hidden
  (`handle.hide()`); read `p`'s `session-popup-bar-entry` element, `panes.focus` the second pane; the bar's entry is
  the same object, and its `click` opens `p` (`p`'s popup root has `is-open`).
- `pane-sessions.test.ts`, new `it.each` `'isPressSelection: $case'`: `ends(node, offset)` builds `SelectionEnds` with
  anchor and focus at one place. Rows: `no selection at either end` (null, null → false); `a new selection`
  (null, ends(n1, 0..4) → true); `the same selection` (A, copy of A → false); `a different selection` (A = n1 0..4,
  B = n1 0..6 → true); `the selection gone` (A, null → false).
- `start.test.ts` (sessions), new `'a press that leaves an older selection sends the keys to the Chat box'`: two
  panes as `panePressed_PopupOpenFocusOutside_LetsGoWithNoChatBox` sets up, with `chatFocusBoxPart(focusBox)`;
  assign `getSelection` on the harness's stubbed `window` to return a non-collapsed selection anchored in the second
  pane's element, the same before and after; fire `pointerdown` with that pane's element as target, then
  `pointerup`; `focusBox` was called once.

Done when: compiles; `npm test` runs the tests above, and `session-tabs-view.test.ts`, `sessions-view.test.ts`,
`pane-sessions.test.ts` and `start.test.ts` (sessions) pass; no window listener stays live after the part stops (the
existing `'stops with nothing live and starts again'` rows pass).

Commit: one commit for the group: "Sessions: tab and popup bar elements outlive a draw and a release reads only its
own press's selection, so the first click in an unfocused pane lands (follow-ups L169, L175)".

## Proof

