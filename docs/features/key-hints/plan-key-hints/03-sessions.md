# 03 — Sessions: list and tab strip prompts

Status: not started
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/sessions/page/start.ts` · modify `src/plugins/sessions/page/sessions-view.ts` ·
           modify `src/plugins/sessions/page/sidebar-view.ts` · modify `src/plugins/sessions/page/session-tabs-view.ts` ·
           modify `src/plugins/sessions/page/tabs.ts` · modify `src/plugins/sessions/page/sessions.css` ·
           test `src/plugins/sessions/page/tabs.test.ts`
Consumes:  `anchor(element: HTMLElement, command: CommandId, options?: AnchorOptions): Disposable` on `KeysPageExports` ← 01 ·
           `AnchorOptions { scope?: ViewScope; where?: HintWhere; label?: boolean | string }` ← 01 · the `ui-key-prompt` root class ← 01 ·
           the class `ui-key-chevron` ← 01 ·
           `stepSession`, `stepTab` (in `tabs.ts` now) · `sectionHeader` (`src/shared/page/ui/section-header.ts`, now)
Produces:  `export function hasOtherSession(state: SessionsState): boolean` in `src/plugins/sessions/page/tabs.ts`
           `export function hasOtherTab(tabIds: readonly string[], selectedTabId: string | null): boolean` in `src/plugins/sessions/page/tabs.ts`
           `SessionsViewDeps.keys: Pick<KeysPageExports, 'anchor'>` in `sessions-view.ts`, in place of `noSelectionHint`
           `SessionTabsDeps.keys: Pick<KeysPageExports, 'anchor'>` in `session-tabs-view.ts`, in place of `noSelectionHint`
           `mountSidebarView(activate: (sessionId: string) => void, keys: Pick<KeysPageExports, 'anchor'>): SidebarView` in `sidebar-view.ts`

Decisions:
- **Binds and anchors.** Every non-leader `any` bind in `src/plugins/keymap.ts` that sessions owns gets an
  anchor with no `scope`, so it shows in every scope (user, 2026-10-27):

  | Bind | Command | Anchor element | Options |
  |---|---|---|---|
  | `<A-S-i>` | `sessions.prevSession` | session list header, first in the pair | none; a `▲` chevron after it → `⌥⇧I ▲` |
  | `<A-S-o>` | `sessions.nextSession` | session list header, last | none; a `▼` chevron before it → `▼ ⌥⇧O` |
  | `<A-i>` | `sessions.prevTab` | tab strip start, before the first tab | none; a `‹` chevron after it → `⌥I ‹` |
  | `<A-o>` | `sessions.nextTab` | tab strip, right after the last tab | none; a `›` chevron before it → `› ⌥O` |
  | `<D-w>` | `sessions.closeSession` | tab strip right end | `{ label: 'close' }` → `⌘W close` |
  | (same `<A-S-o>`) | `sessions.nextSession` | the hint after "Pick a session in the side bar" | none → `⌥⇧O` |

  `<Leader>ks` and `<Leader>;` are leader binds: which-key shows them, and they get no anchor. The other `any`
  binds in the keymap belong to other plugins' tasks.
- **Chevrons.** Each chevron is a `span.ui-key-chevron` (task 01) that the view places next to its anchor
  element, on the side the table names. KeyPrompt draws keys and then the label, so a chevron before the keys
  cannot be a label. Task 01's rule hides the chevron while its anchor is hidden. The view owns the anchor
  element's placement and style (plan.md, Decisions); the keys plugin owns what is inside it.
- **Session list header.** `mountSidebarView` returns as `element` a `div.session-side` that holds
  `sectionHeader('Sessions', pair)` and, under it, the `nav.session-sidebar` of rows. `render` replaces only the
  nav's children, so the header and its anchors are built once. `pair` is a `span.session-edge` holding, in order,
  the previous-session anchor element, the `▲` chevron, the `▼` chevron and the next-session anchor element. `SessionsView.sideBar` is the `div.session-side`. The header's text "Sessions" is the
  agent's addition: a header with prompts and no name reads as a stray line.
- **Tab strip.** `mountSessionTabsView` wraps the strip in a `div.session-tabs-bar` laid out as a grid:
  previous-tab anchor and its `‹` chevron, the strip (`auto`), the `›` chevron and next-tab anchor, a `1fr` gap,
  the close anchor. Each anchor and its chevron share one `span` cell. `draw` replaces only the
  strip's tabs, so the anchors are built once. `.session-area` keeps its two rows; the bar takes the first row in
  place of the strip.
- **A pair hides with one target** (`DESIGN.md` § Keys and focus). On each draw the view toggles the class
  `is-no-target` (`visibility: hidden`, so the space stays) on the session pair while `hasOtherSession(state)` is
  false, on both tab anchor cells (each anchor with its chevron) while `hasOtherTab` of the selected session's tab ids is false, and on the close anchor
  while no session is selected. The sidebar reads `state` in `render`; the tab view reads it in `draw`.
- **`hasOtherSession(state)`** is `stepSession(state, 1) !== null`. **`hasOtherTab(tabIds, selectedTabId)`** is
  `stepTab(tabIds, selectedTabId, 1) !== null`. Each rests on the step function its command runs, so the prompt
  hides exactly when the key would do nothing.
- **No-selection hint.** `noSelectionHint` leaves both deps interfaces. `mountSessionTabsView` makes one
  `span.sessions-pick-hint` at mount, anchors it to `sessions.nextSession` with no options, and hands that same
  element to `text.show` while the text has `hasHint`. `emptyState` appends it, which moves it; the anchor stays.
- **`start.ts`.** Pass `keys` into `mountSessionsView`. Delete the `noSelectionHint` builder, the `kbd` import and
  the `keys.onChanged` block, whose only work was to redraw that hint; the anchor redraws itself. `roundToastText`
  keeps reading `keys.keysFor` for the toast text.
- **Anchor lifetime.** The sessions page part lives as long as the page, so its anchors are never disposed, as its
  `onChanged` subscription was not.

GIVEN one session row, selected WHEN the list draws THEN `hasOtherSession` is false and the session pair carries
`is-no-target`
GIVEN two session rows WHEN the list draws THEN the session pair shows `⌥⇧I ▲ ▼ ⌥⇧O`
GIVEN the selected session holds one tab WHEN the tab area draws THEN `⌥I ‹` and `› ⌥O` carry `is-no-target`, and
`⌘W close` shows
GIVEN rows and no selected session WHEN the tab area draws THEN it reads "Pick a session in the side bar" followed by
the `sessions.nextSession` anchor, and `⌘W close` carries `is-no-target`
GIVEN the user rebinds `sessions.nextTab` WHEN the keymap changes THEN the anchor shows the new keys with no redraw by
sessions (task 12, check "Rebind reaches a hint")

Tests:     in `tabs.test.ts`:
           `hasOtherSession is false with no rows or one selected row, and true with one unselected row or two rows` —
           `{ rows: [], selectedSessionId: null }` → false; one row `a` selected → false; one row `a`, none selected →
           true; rows `a`, `b`, `a` selected → true
           `hasOtherTab is false under two tabs and true from two` — `([], null)` → false; `(['t1'], 't1')` → false;
           `(['t1', 't2'], 't1')` → true
           The look of the header, the strip and the hidden pair is task 12's checks "Edge prompts" and "One target
           hides a pair".
Done when: compiles; lint passes; the test gate runs the tests above;
           `grep -rnE "keyHint|appendKeyHint|kbd\(" src/plugins/sessions` prints nothing.
Commit:    one commit for the group

## Proof
