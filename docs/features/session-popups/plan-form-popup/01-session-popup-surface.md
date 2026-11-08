# 01 — Session popup surface in sessions

Status: in progress
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/sessions/contract.ts` · `src/plugins/sessions/manifest.ts` · `src/plugins/sessions/page/session-tabs-view.ts` · `src/plugins/sessions/page/tabs.ts` · `src/plugins/sessions/page/start.ts` · `src/plugins/sessions/page/sessions-view.ts` · `src/plugins/sessions/page/consumer-view.ts` · `src/plugins/sessions/page/pane-sessions.ts` · `src/plugins/sessions/layouts/layout.d.ts` · `src/plugins/sessions/layouts/default/layout.js` · `src/plugins/sessions/layouts/default/layout.css` · `src/plugins/sessions/page/layout/sessions-parts.ts` · `src/plugins/sessions/page/layout/read-sessions-layout.ts` · `src/plugins/sessions/page/sessions.css` · `src/plugins/keymap.ts` · test `src/plugins/sessions/page/session-tabs-view.test.ts` · `src/plugins/sessions/page/tabs.test.ts` · `src/plugins/sessions/page/start.test.ts` (or the file that owns `checkVisible`'s tests) · `src/plugins/sessions/page/layout/sessions-parts.test.ts` · `src/plugins/sessions/page/consumer-view.test.ts` · `src/plugins/sessions/page/pane-sessions.test.ts`
Consumes:  `SessionTabView`, `SessionTabHandle`, `mayClose`, `visibleTab`, `checkVisible`, `rowStatus`/`statusesOf`, `createLayoutParts` — all in the tree
Produces:  in `src/plugins/sessions/contract.ts`:
           `export interface SessionPopupView { id: string; title: string; icon: string; element: HTMLElement; beforeClose(): boolean; shown(): void }`
           `export interface SessionPopupHandle extends Disposable { setStatus(status: string): void; open(): void; hide(): void; isVisible(): boolean }`
           `SessionsPageExports.addPopup(sessionId: string, popup: SessionPopupView): SessionPopupHandle`
           command `sessions.togglePopup` (manifest, page process) bound `<Leader>vf` in scope `any`
           theme token `sessions.popup-top` (`kind: 'raw'`, default `'15%'`)
           layout parts `popup(parent, PopupInput, SessionsKit): PopupPart` and `popupBar(parent, PopupBarInput, PopupBarKit): PopupBarPart` in `src/plugins/sessions/layouts/layout.d.ts`
Decisions: design doc `docs/features/session-popups/design.md` § The popup surface, § Open, hidden and gone, § Keys and focus, § Look (interview, all five answers on their recommendations)

## What to build

- **Contract.** The two types and `addPopup` above, with doc comments in the style of `SessionTabView` /
  `SessionTabHandle`: `addPopup` attaches the element before returning, opens the popup (it becomes the session's
  top open popup), and throws on a popup id the session already holds; a popup added before its session's row waits
  for the row, as a tab does; a session's popups drop with its row. `open` makes it the top open popup; `hide` hides
  it; `isVisible` reads true only while it is the top open popup of the focused pane's session and Sessions mode
  shows; `dispose` removes it; every call on a dropped popup does nothing. `consumer-view.ts` forwards `addPopup`
  and tracks its handle like `addTab`'s.
- **Frame.** Each `Frame` in `session-tabs-view.ts` gains its popups in open order (the last opened open one on top)
  and a popup layer over `bodies`: each popup's `popup` part holds the plugin's element in its `body`; only the top
  open popup carries `is-open`, the rest are hidden; the `popupBar` part draws at the frame's bottom with one entry
  per hidden popup (newest first), and is absent while none is hidden. A click on an entry opens that popup
  (`rowAction`, as tabs do). Every add, open, hide, dispose and status change runs the view's `changed` (so the side
  bar row and `checkVisible` follow). The popup layer and bar redraw with the rest on `redrawPane`/`redrawBars` and
  move with the frame (connected moves keep the plugin element's state).
- **Visible surface.** `visibleTab` / `checkVisible` (`tabs.ts`, `start.ts`) gain the popup: when the focused pane's
  session has an open popup, the visible surface is that popup (compare by session id + popup id + kind), its
  `shown()` runs, and no tab's `isVisible` reads true; otherwise today's tab rule. A change from popup to tab (hide,
  dispose) runs the tab's `shown()` again, so the chat's scope and its `Chat tab shown in <label>` line come back.
  When a popup becomes visible and `document.activeElement` is inside that frame's tab bodies, blur it.
  `pane-sessions.ts`' press rule (`pressedFocusAction`) focuses no chat box while the pressed session has an open
  popup.
- **Close guard and status.** `mayClose` asks the session's popups' `beforeClose` after its tabs'; the session row's
  status lines read tab statuses then popup statuses (`statusesOf`).
- **Toggle.** `sessions.togglePopup` (label `Hide or show the session's popup`, group `sessions`) acts on the focused pane's session. Pinned log lines (self-test waits on them):
  - open popup present → hide it, log `hid <popup title> popup in <session label>`
  - else a hidden popup present → open the newest hidden one, log `opened <popup title> popup in <session label>`
  - else → log `no popup in <session label>`; with no session in the focused pane → log `no popup: no session shown`
  `<session label>` is what today's `showed <title> tab in <label>` line uses. Bind `{ keys: '<Leader>vf', scope:
  'any', command: 'sessions.togglePopup' }` beside the other `<Leader>v*` binds in `src/plugins/keymap.ts`. The hidden
  bar anchors this command once (see § Pinned by the cold read).
- **Layout.** `PopupInput { title: string; icon: string }`, `PopupPart extends SessionsPart { body: HTMLElement }`;
  `PopupBarInput { entries: { title: string; icon: string; status: string }[] }`, `PopupBarPart extends SessionsPart {
  entries: HTMLElement[] }` (one per input entry, in order; the app wires their clicks), `PopupBarKit extends
  SessionsKit { toggleHint(parent: HTMLElement): void }` (anchors `sessions.togglePopup`). Add both to `Layout`,
  `LAYOUT_PARTS`, `SessionsParts` (with `requireElementIn` checks for `body` and each entry), the `default`
  `layout.js` (an entry shows its icon, its status — or its title when the status is empty — and the toggle hint) and
  its CSS. The app keeps `is-open` on the popup root.
- **Look (CSS).** The popup layer fills the frame's body; the popup root's top sits at `var(--wg-sessions-popup-top)`
  below the layer's top, on `--wg-sheet-background`, `--wg-radius-lg` top corners, no shadow; the strip above is
  dimmed with `var(--wg-scrim)` while a popup is open (geometry in § Pinned by the cold read). Slide: `transform: translateY(100%)` hidden → `0` open, transition over
  `--wg-duration-slow` with `--wg-ease-out` entering and `--wg-ease-in` leaving (reduced motion is the token's job).
  No raw values (`npm run lint` runs `check-styles.mts`).
- **Copy.** `NOTHING_OPEN_TEXT` in `session-tabs-view.ts` becomes `"Nothing open yet: this session's first round opens here"`.
- Keep the tab take-over as it is: task 03 removes it once its last caller goes.

## Pinned by the cold read

- **States.** Each popup is `open` or `hidden`. The top popup is the last opened among the open ones; an open popup
  under it is covered: not drawn, no bar entry, and it shows again when the top one hides or goes. The bar lists the
  hidden popups most recently hidden first, and the toggle's "newest hidden" is that first entry. Row: open A, open
  B, hide B, hide A → toggle opens A.
- **`open()` on the top open popup is a no-op** (no `changed`, no `shown` again). `SessionPopupView.shown`'s doc says
  it may run inside `addPopup`, before the handle returns, as `SessionTabView.shown`'s does. `isVisible` of a popup
  in an unfocused pane reads false while it is still drawn open.
- **The popup part persists.** Each popup's `popup` part is drawn once on add and again only on a layout change
  (`redrawPane`); `draw()` only toggles `is-open` and `inert`. On add the root is attached without `is-open` and
  gets it on the next animation frame, so the entry slide runs. Only the `popupBar` part redraws on every change.
- **Not open = inert.** A root without `is-open` carries `inert` (so Tab and typing never reach a hidden form) and
  `visibility: hidden` once its slide-out ends; sessions focuses nothing on open — the plugin's `shown` owns focus.
- **Geometry.** The frame's `bodies` sheet is `position: relative`; the popup layer is `position: absolute; inset: 0;
  overflow: hidden` inside it, above the pane edges' z-order, and `pointer-events: none` except on the open popup's
  root and the dim strip. The strip paints `background: var(--wg-scrim)` (frame-local — not the `.ui-scrim` class,
  which is a window-wide fixed backdrop) and absorbs clicks, doing nothing. The popup's `body` fills its root (grid,
  `height: 100%`), so the plugin element's `height: 100%` fills it. The `popupBar` sits in normal flow under
  `bodies` inside the frame, so it never covers the popup.
- **`VisibleTab`** becomes `{ kind: 'tab'; sessionId; tabId } | { kind: 'popup'; sessionId; popupId } | 'none' |
  null`, from `visibleTab(isModeShown, sessionId, tabId, popupId)`, the popup id winning when not null.
  `checkVisible(true)` (`isShownAgain`) runs the visible surface's `shown` again for a popup as it does for a tab.
- **Toggle outside Sessions mode** shows the mode first (one `mode.show()` at the top, as the tab steps do), then acts.
- **Pane press.** `PressedPaneFacts` gains `isPopupOpen`; with it true, `pressedFocusAction` returns `keep` (focus
  stays where it is, so a click in the form keeps its text box).
- **Command group** is `sessions` (as `closeSession` and `renameSession`).
- **The bar's key hint** draws once per bar, at its end (`toggleHint` called once by `default`); the kit allows
  repeated calls. Leader sequences are exempt from the placement check, so the hint is for the user, not a gate.
- **Mode-hidden toggle and `mayClose`** need a `popupsOf(sessionId)` accessor on the tabs view beside `tabsOf`.

GIVEN a session with a selected Chat tab WHEN a popup is added THEN the popup is visible, `shown()` ran on the popup, and the tab's `isVisible` reads false
GIVEN an open popup WHEN `hide()` runs THEN the tab's `shown()` runs again, the popup's `isVisible` reads false, and the bar holds one entry for it
GIVEN two popups opened A then B WHEN B hides THEN A is visible; WHEN B disposes instead THEN A is visible and the bar is absent
GIVEN a hidden popup WHEN its bar entry is clicked THEN it opens and the bar is absent
GIVEN the focused session has an open popup WHEN `sessions.togglePopup` runs THEN it hides and logs `hid <title> popup in <label>`; run again THEN it opens and logs `opened <title> popup in <label>`; with no popup THEN `no popup in <label>`
GIVEN a session with a tab and a popup whose `beforeClose` returns false WHEN the user closes the session THEN the close is refused
GIVEN a popup with status `R1` WHEN the row draws THEN its status lines hold `R1` after the tabs' statuses
GIVEN a focused chat text box WHEN a popup opens over it THEN the box loses focus
GIVEN `addPopup` twice with one id on one session THEN it throws
GIVEN popups A and B opened in that order WHEN B then A hide and the toggle runs THEN A opens
GIVEN an open top popup WHEN `open()` runs on it THEN no `changed` and no second `shown`
GIVEN a hidden popup THEN its root is `inert`
GIVEN Sessions mode hidden WHEN `sessions.togglePopup` runs THEN the mode shows, then the toggle acts

Tests:     add rows/tests where each rule's owner tests live, per `wigley:writing-tests` § One test per behaviour:
           `tabs.test.ts` — `visibleTab` table gains popup rows (open popup wins; hidden popup → tab; mode hidden → null)
           `session-tabs-view.test.ts` — popup stack (open order, hide, dispose, reopen via bar click), bar entries, `isVisible` of tab vs popup, statuses order, `beforeClose` in `mayClose`, duplicate id throws, blur on open
           start-level test owning `checkVisible` — popup→tab transition runs the tab's `shown` again; togglePopup's four log lines (a table)
           `sessions-parts.test.ts` — `popup` and `popupBar` parts draw from `default` and fall back when a user part omits `body`/an entry
           `pane-sessions.test.ts` — press on a session with an open popup returns `keep` (a row in the existing press table)
           the rows above for stack order, `open()` no-op, `inert`, mode-hidden toggle and `checkVisible(true)` on a popup join the owning tests listed here
Done when: `npm test` and `npm run lint` pass; the test gate runs the tests above
Commit:    one commit for the group

## Proof
