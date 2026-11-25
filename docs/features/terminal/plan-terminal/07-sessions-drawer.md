# 07 — Sessions drawer slot

Status: done
Type: Task
Rung: hard · adds the `addDrawer` contract that 09 consumes, and a frame lifetime (open, shown, moved, dropped)
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:
- modify `src/plugins/sessions/contract.ts`
- modify `src/plugins/sessions/page/session-tabs-view.ts`
- modify `src/plugins/sessions/page/sessions-view.ts`
- modify `src/plugins/sessions/page/start.ts`
- modify `src/plugins/sessions/page/consumer-view.ts`
- modify `src/plugins/sessions/page/sessions.css`
- modify `src/plugins/sessions/page/layout/sessions-parts.ts`
- modify `src/plugins/sessions/page/layout/read-sessions-layout.ts`
- modify `src/plugins/sessions/layouts/layout.d.ts`
- modify `src/plugins/sessions/layouts/default/layout.js`
- modify `src/plugins/sessions/layouts/default/layout.css`
- modify `docs/features/layouts/design.md`
- modify `AGENTS.md`
- modify `src/plugins/sessions/page/sessions-view-fakes.ts`
- test `src/plugins/sessions/page/session-tabs-view.test.ts`
- test `src/plugins/sessions/page/start.test.ts`
- test `src/plugins/sessions/page/consumer-view.test.ts`
- test `src/plugins/sessions/page/layout/sessions-parts.test.ts`

Consumes:  nothing from other tasks. It uses `createSplitDivider` (`src/shared/page/ui/split.ts:273`) and
           `SplitDivider` (`split.ts:97-103`) as they are.

Produces:
- In `src/plugins/sessions/contract.ts`, beside `SessionPopupHandle` (`contract.ts:556-566`), word for word from
  plan.md § File Structure:
  ```ts
  // `shown` runs each time the drawer becomes visible: opened in a visible frame, or its frame shown.
  // `focus` runs when sessions moves focus into the drawer (Alt+j, or `open({ focus: true })`).
  export interface SessionDrawerView { id: string; element: HTMLElement; shown(): void; focus(): void }
  export interface SessionDrawerHandle extends Disposable {
    open(options: { focus: boolean }): void;
    close(): void;
    isOpen(): boolean;
    // When the drawer holds focus, hands the keys to the focused pane's selected tab, as Alt+k from the drawer
    // does; otherwise does nothing. The drawer stays open.
    returnFocus(): void;
  }
  ```
  and in `SessionsPageExports` (`contract.ts:682-713`), after `addPopup`:
  `addDrawer(sessionId: string, drawer: SessionDrawerView): SessionDrawerHandle;`
- In `src/plugins/sessions/layouts/layout.d.ts`, beside `PopupBarInput` and `PopupBarPart`:
  - `export interface DrawerInput { id: string }` — `id` is the drawer view's `id`.
  - `export interface DrawerPart extends SessionsPart { body: HTMLElement; handle: HTMLElement }`
  - in `Layout`, after `popupBar`: `drawer?(parent: HTMLElement, input: DrawerInput, kit: SessionsKit): DrawerPart;`
- In `src/plugins/sessions/page/layout/sessions-parts.ts`, in `SessionsParts` after `popupBar` (`:137`):
  `drawer(parent: HTMLElement, input: DrawerInput): DrawnPart<DrawerPart>;`
- In `src/plugins/sessions/page/session-tabs-view.ts`:
  - `SessionTabsDeps` (`:142-150`) gains `uiState: UiState;`, `timers: Timers;`, `log: PluginLog;` and
    `drawerLeft(): void;`.
  - `SessionTabsView` (`:152-206`) gains:
    - `addDrawer(sessionId: string, view: SessionDrawerView): SessionDrawerHandle;`
    - `checkDrawers(): void;`
    - `moveDrawerFocus(direction: PaneDirection): boolean;`
    - `nudgeDrawer(direction: PaneDirection): boolean;`
- In `src/plugins/sessions/page/sessions-view.ts`: `SessionsViewDeps` (`:89-122`) gains `uiState: UiState;` and
  `drawerLeft(): void;`. `SessionPanes.outer` (`:171`, built at `:588`) becomes the wrapped outer panes (Decisions).
- In `src/plugins/sessions/page/sessions-view-fakes.ts`: `SessionsViewOptions` gains `isModeShown?: () => boolean`,
  and `sessionsViewSetup` returns `drawerLefts(): number`, the count of `drawerLeft` calls.

Decisions:
- **Row order.** `frameOf` (`session-tabs-view.ts:277-321`) builds a fourth child, `div.session-drawer-host`, and
  appends the frame's children in this order: `barHost`, `bodies`, `drawerHost`, `popupBarHost`. The drawer host is a
  sibling of `.session-bodies`, never inside it, so the popup layer (`.session-popups`, inside `.session-bodies`) covers
  the tab body and never the drawer. The hidden popups' bar stays at the frame's bottom, under the drawer. The host
  is created with every frame and starts `hidden`.
- **Frame state.** `Frame` (`:88-113`) gains `drawerHost: HTMLElement` and `drawer: Drawer | null`. A new private
  `interface Drawer { view: SessionDrawerView; part: DrawnPart<DrawerPart>; divider: SplitDivider; isOpen: boolean;
  isShown: boolean }`. `isShown` is true while `shown` has run and the drawer has not stopped being visible since.
- **Visible.** A drawer is visible when all three hold: `drawer.isOpen`, `frame.element.parentNode !== holder` (a pane
  shows the frame), and `deps.isModeShown()`.
- **`checkDrawers`.** For each frame's drawer: when it is visible and `isShown` is false, set `isShown` true, then run
  `view.shown()`; when it is not visible, set `isShown` false. Each `shown` call runs in its own `try`/`catch`, as
  `partTooltips` (`sessions-view.ts:340-350`) guards a row part. A throw logs
  `drawer ${view.id} shown failed: ${errorText(error)}` through `deps.log`, and the loop goes on to the next drawer.
  `checkDrawers` never throws, so a drawer view's throw never leaves `draw`, `place`, `render`, `drop` or `open`.
  `isShown` stays true after a throw, so the next `draw` does not call that `shown` again. `draw` (`:514-532`) calls `checkDrawers` as its last step, so `place`,
  `render`, every tab or popup change and `drop` all check. `start.ts` calls `view.tabs.checkDrawers()` in the mode's
  `shown` (`start.ts:445-450`) after `view.tabs.rescroll()`, and in `hidden` (`:451-456`) after
  `model.setModeShown(false)`.
- **Shown timing.** `shown` runs on each change from not visible to visible: `open` in a shown frame; a pane that
  loads the frame while the drawer is open; the mode shown again while the drawer is open. It runs once more after a
  layout redraw of the drawer part while visible. It does not run when the frame moves from one shown pane to another
  shown pane: the drawer stays visible. A size change while visible is the drawer view's to watch (task 09 observes its
  own element). Sessions has no `hidden` call for a drawer.
- **`addDrawer(sessionId, view)`.** Uses `frameOf(sessionId)`, so a drawer added before the row exists waits in the
  holder, as `addPopup` (`:849-903`) does. Throws `Session ${sessionId} already has a drawer` when
  `frame.drawer !== null`. It draws the `drawer` part into `drawerHost` with `{ id: view.id }`, moves `view.element`
  into the part's `body` with `moveConnected`, and creates the divider (Height). The drawer starts closed. It runs no
  `changed`: a drawer is not tab state.
- **Handle.** Each handle method first finds the live drawer: `frames.get(sessionId)?.drawer === drawer`. On a drawer
  that is no longer live (disposed, or its frame dropped) every method does nothing and `isOpen` returns false.
  - `open({ focus })`: when closed, set `isOpen` true, set `drawerHost.hidden` false, then run `checkDrawers()`. Then,
    when `focus` is true and the drawer is visible, run `view.focus()`. An `open({ focus: true })` on an open drawer
    runs only the focus step. A drawer that is not visible opens and takes no focus.
  - `close()`: when open, first run the focus hand-back (below), then set `isOpen` false, `isShown` false and
    `drawerHost.hidden` true.
  - `isOpen()`: the live drawer's `isOpen`.
  - `returnFocus()`: runs the focus hand-back only. The drawer stays open.
  - `dispose()`: runs the focus hand-back, sets `frame.drawer` to null, disposes the divider, disposes the part and
    removes its element (`disposePart`, `:950-953`), removes `view.element`, and sets `drawerHost.hidden` true. The
    session may then add a new drawer.
  - **Focus hand-back**: when `drawerHost.contains(document.activeElement)`, call `deps.drawerLeft()`. Otherwise do
    nothing: a hand-back with focus elsewhere must not blur the Chat box.
- **`drop`** (`:738-759`) adds two steps to its `callEach` list: `() => frame.drawer?.divider.dispose()` and
  `() => frame.drawer?.part.dispose()`. The frame has already left `frames`, so the handle is dead after the drop.
  `drop` does not call `view.shown` or `deps.drawerLeft`.
- **Layout redraw.** `redrawPane` (`:769-784`) redraws each frame's drawer before it calls `place`: draw the new part
  into `drawerHost`, move `view.element` into the new body with `moveConnected`, dispose the old divider, create a
  new divider on the new handle, dispose and remove the old part, and set `isShown` false so the `draw` that `place`
  runs calls `shown` again while visible. `redrawBars` leaves the drawer alone.
- **Height.** One height for every drawer, in sessions' uiState (`api.services.uiState`, scoped to the plugin), key
  `drawer-height`. Each drawer has its own `createSplitDivider` over that key, which follows every `set` of the key
  (`split.ts:328`), so every drawer shows the same height. Options: `initial`, `min`, `endMin` from `DRAWER_SPLIT`;
  `uiState: deps.uiState`; `stateKey: DRAWER_HEIGHT_KEY`; `axis: 'column'`; `sizedPane: 'end'`;
  `handle: part.built.handle`; `anchor: (node, command) => deps.keys.anchor(node, command)`, as `sessions-view.ts`
  passes the pane tree its anchor; `timers: deps.timers`. `measure()` returns `left` = the top of
  `frame.bodies.getBoundingClientRect()` and `span` = the bottom of `drawerHost.getBoundingClientRect()` less that
  top. `show(height)` sets `--session-drawer-height` on `frame.element.style` to `String(height)`. On `addDrawer`,
  also set `--session-drawer-end-min` on `frame.element.style` to `String(DRAWER_SPLIT.endMin)`. The two properties
  go on the frame, not the host, because the frame's grid tracks read them (Pinned values).
- **Height cap.** The CSS cap uses the grid tracks of an end-sized column split
  (`src/shared/page/ui/split.css:29-33`), not a container query. While the drawer is open, the frame's tab body row is
  `minmax(end-min, 1fr)` and its drawer row is `minmax(0, height)`. The grid gives the tab body row its `end-min`
  first, and the drawer row gets the rest up to `height`. These two rows are the box that `measure()` reads, so the
  CSS cap and the drag clamp (`clampSplitWidth`, `src/shared/page/ui/split-width.ts`) measure the same box: the
  drawer row never takes more than `span` less `endMin`. They differ in one case only: when `span` is less than
  `min` plus `endMin`, the clamp keeps the drawer at `min` and the CSS keeps the tab body at `endMin`, so the drawer
  shows less than `min`. The CSS wins on the screen. The tab bar row and the popup bar row are outside the box, in
  both. Task 12 step 6 checks this live (it shrinks the window).
- **Why `createSplitDivider`.** `createSplit` (`split.ts:374`) builds its own root, handle and two panes. The drawer
  is a grid row of a frame that already exists, with a handle the layout draws. So this task uses
  `createSplitDivider`, the divider core that `createSplit` is built on. The stored key, the clamp and the column
  axis are the same.
- **Focus wrapper.** In `sessions-view.ts`, `panes.outer` stops being `treeView.outer` (`:588`) and becomes one object
  built once, so `setOuterPanes` and `release` (`pane-targets.ts`) keep comparing the same object:
  - `focus.move(direction)` returns `tabs.moveDrawerFocus(direction) || treeView.outer.focus.move(direction)`.
  - `resize.nudge(direction)` returns `tabs.nudgeDrawer(direction) || treeView.outer.resize.nudge(direction)`.
- **`moveDrawerFocus(direction)`.** Reads the focused pane's session's drawer (`focusedSessionId()`, `:258-261`).
  - `down`, the drawer visible and `drawerHost` not holding `document.activeElement`: run `view.focus()`, return true.
  - `up`, `drawerHost` holding `document.activeElement`: call `deps.drawerLeft()`, return true.
  - Every other case returns false, so the move goes on to the pane tree. `down` from inside the drawer reaches the
    pane below; `left` and `right` reach the side panes, whose `keyFocused` hands the keys over.
- **`nudgeDrawer(direction)`.** When the focused pane's session's `drawerHost` holds `document.activeElement`, return
  `drawer.divider.nudge(direction)`; otherwise return false. The divider returns false for `left` and `right`, so they
  go on to the pane tree. With focus outside the drawer, `up` and `down` reach the pane tree's dividers as today, so
  the drawer never hides a column split's divider from the resize keys.
- **Why the outer panes and not a focus target.** `PaneTargets.baseChanged` (`src/renderer/pane-targets.ts:234`)
  forgets the view's focus and resize targets on every base scope change, and the drawer's screen sets its own base
  scope when it takes focus (task 09). A target would be gone by the next key. The outer panes stay until
  `setOuterPanes(null)`. The core asks the outer panes only while no scope is pushed (`pane-targets.ts:310-313`):
  task 09 must set the terminal scope with `setScope`, never `pushScope`.
- **`drawerLeft` wiring.** `SessionsViewDeps.drawerLeft` passes straight into `SessionTabsDeps.drawerLeft`.
  `start.ts` passes `drawerLeft: () => keysToFocusedPane()` (`start.ts:272-276`), which blurs the focused element and
  runs `model.setMainScope()`, so the selected tab's `shown` runs again and takes the keys, as Alt+k from any pane
  does. `start.ts` also passes `uiState` (`start.ts:246`) into `mountSessionsView`; `sessions-view.ts` passes
  `deps.uiState`, `deps.timers` and `deps.log` into `mountSessionTabsView` (`:512-522`).
- **Export.** `createExports` (`start.ts:153-190`) adds
  `addDrawer: (sessionId, drawer) => view.tabs.addDrawer(sessionId, drawer)`. `sessionsPageView`
  (`consumer-view.ts`) adds `addDrawer: (sessionId, drawer) => handlesOf(sessionId).track(exports.addDrawer(sessionId,
  drawer))`, so a consumer's dispose and a removed session dispose its drawer handle as they do its tabs and popups.
  Its header comment names drawers beside tabs and popups.
- **Layout part.** `drawer` draws once on `addDrawer` and again on each layout set. The `sessions-parts.ts` draw
  (pattern: `popup`, `:463-468`) builds the plain `sessionsKit(rollback)`, calls the builder, then
  `requireElementIn(drawer.element, drawer.body, 'drawer body')` and
  `requireElementIn(drawer.element, drawer.handle, 'drawer handle')`, and returns
  `{ element, body, handle }`. A part that fails either check draws with `default`, as `popup` does.
  `read-sessions-layout.ts` adds `drawer: true` to `LAYOUT_PARTS`.
- **Layout contract text** (`layout.d.ts`). Add a `// Drawers.` paragraph after the `// Popups.` one (`:62-67`): a
  session's drawer is a strip under its tabs that a plugin fills (the terminal); `drawer` draws its frame once when the
  drawer is added and again on each layout set; the app fills `body` with the plugin's element and owns the drag on
  `handle` and the drawer's height, one height for every drawer; a `drawer` whose `body` or `handle` is not inside
  its `element` draws with `default`. Add to "The app keeps" list: the drag and the resize prompt on the drawer's
  `handle`, and whether the drawer shows. Add the drawer host to the sentence "The tab bodies, the sheet that holds
  them, the popup layer over them … stay the app's". Doc comments on `DrawerInput` and `DrawerPart` say the same in
  one line each.
- **Default draw** (`layout.js`, after `popupBar`): `div.session-drawer` holding `div.session-drawer-handle`, then
  `div.session-drawer-body`; returns `{ element, body, handle }`. The file's header comment names the drawer's frame
  (its handle over its body) beside the popup's sheet.
- **CSS** — see Pinned values. The app's own CSS (`sessions.css`) owns the host row and its height; the default
  layout's CSS (`layout.css`) owns the drawer's look. `sessions.css`'s comment over `.session-area` (`:104-106`)
  names the drawer row between the sheet and the popup bar.
- **Docs.** `docs/features/layouts/design.md:145` (the `sessions` row): add "each session's drawer frame (`drawer`)"
  after the popup bar. `AGENTS.md:316` (the sessions src map line): "each session's tabs, popups and drawer
  (`addTab`, `addPopup`, `addDrawer`, the hidden bar)"; `AGENTS.md:319`: "with the `popup`, `popupBar` and `drawer`
  parts".
- **Fakes.** `sessionsViewSetup` passes `isModeShown` from its options (default `() => true`), `uiState` (it holds
  one already), and a `drawerLeft` that counts its calls into `drawerLefts()`.

Pinned values:
- In `session-tabs-view.ts`, beside `ENTERING` (`:948`):
  `const DRAWER_HEIGHT_KEY = 'drawer-height';` and
  `const DRAWER_SPLIT = { initial: 240, min: 160, endMin: 160 } as const;` — px. `initial` and `min` are the primer
  columns' split defaults (`src/plugins/primer/page/primer-view.ts:688-690`); `endMin` keeps the tab body at least the drawer's own least
  height.
- Error text: `Session ${sessionId} already has a drawer`.
- Classes: app host `session-drawer-host`; default part `session-drawer`, `session-drawer-handle`,
  `session-drawer-body`.
- Custom properties on the frame (`.session-area`), unitless px: `--session-drawer-height`,
  `--session-drawer-end-min`.
- `sessions.css`:
  - `.session-area` (`:107-113`) stays as it is. With the host hidden, the popup bar takes the third row, as today.
  - New rule `.session-area:has(> .session-drawer-host:not([hidden]))`: `grid-template-rows: auto
    minmax(calc(var(--session-drawer-end-min) * 1px), 1fr) minmax(0, calc(var(--session-drawer-height) * 1px))
    auto;`. The host's `hidden` attribute is the one switch, as `.shell-status-bar:not(:has(…))`
    (`src/renderer/shell/shell.css:307`) reads `hidden`. Add no class for an open drawer.
  - New rule `.session-drawer-host`: `display: grid; grid-template: minmax(0, 1fr) / minmax(0, 1fr); min-height: 0;`.
    It sets no height: it fills its grid row.
  - New rule `.session-drawer-host[hidden] { display: none; }`
  - Use no `container-type` and no `cqh` unit.
- `layout.css`, after the popup bar's rules (`:493-525`), with a comment in the file's style:
  - `.session-drawer`: `display: grid; grid-template-rows: var(--wg-space-1) minmax(0, 1fr); height: 100%;
    min-height: 0; margin: 0 var(--wg-sheet-gutter);`
  - `.session-drawer-handle`: `position: relative; cursor: row-resize;` and its `::after`: `content: '';
    position: absolute; top: 50%; left: 0; right: 0; height: 1px; background: var(--wg-border-default);
    transition: background-color var(--wg-duration-fast) var(--wg-ease-out);`
  - `.session-drawer-handle:hover::after, .session-drawer-handle.is-active::after { background:
    var(--wg-focus-border); }` — the same states `split.css` gives `.ui-split-handle`.
  - `.session-drawer-body`: `display: grid; grid-template: minmax(0, 1fr) / minmax(0, 1fr); min-height: 0;`
  - The layout.css header comment (`:1-2`) adds "the session drawer's frame".

GIVEN a session shown in the focused pane with an open popup WHEN its drawer opens THEN the drawer's host is a child
of `.session-area` after `.session-bodies`, and the popup layer does not contain the drawer's element.
GIVEN a closed drawer in a shown frame WHEN `open({ focus: false })` runs THEN `shown` runs once and `focus` never.
GIVEN an open drawer whose session no pane shows WHEN a pane loads that session THEN `shown` runs once.
GIVEN an open drawer WHEN Sessions mode hides and shows again THEN `shown` runs once more.
GIVEN an open drawer holding the focus WHEN `close()` runs THEN `drawerLeft` runs once and the host is hidden.
GIVEN an open drawer and focus in the Chat box WHEN `returnFocus()` runs THEN `drawerLeft` does not run.
GIVEN a session's frame with a drawer WHEN the frame drops THEN the drawer's resize prompt anchors are disposed and
the handle's `open` runs no `shown`.
GIVEN an open drawer and focus in the chat WHEN Alt+j runs `outer.focus.move('down')` THEN the drawer's `focus`
runs and the move returns true; WHEN Alt+k then runs `move('up')` from inside the drawer THEN the selected tab's
`shown` runs again and the log reads `keys to pane label s1`.
GIVEN `drawer-height` stored as 300 WHEN two sessions add drawers THEN both frames show `--session-drawer-height`
`300`; WHEN `drawer-height` is set to 320 THEN both show `320`.
GIVEN two open drawers in two shown panes, the first one's `shown` throwing, WHEN the mode shows THEN the second
drawer's `shown` runs once, `checkDrawers` does not throw, and the log reads `drawer a shown failed: boom`.
GIVEN an open drawer holding the focus WHEN its frame drops THEN `drawerLeft` does not run.
GIVEN an open drawer in a shown pane WHEN its frame moves to another shown pane THEN `shown` does not run again.
GIVEN an open drawer WHEN a bar part is added THEN `shown` does not run again.
GIVEN an open drawer at its highest WHEN the window shrinks THEN the tab body keeps at least 160 px (live check, task
12 step 6).

Tests:
- `session-tabs-view.test.ts`, new `describe('session drawers', …)`. Drawer views are built by a `drawerView(id)`
  helper beside `popupView` (`:39-48`) whose `shown` and `focus` are `vi.fn()`, and whose `focus` focuses its element
  under `installFocusFakeDom`, as the test at `:825` does. Each test builds on `popupSetup` (`:105-117`) or
  `sessionsViewSetup` with two sessions.
  - `it.each` `'a drawer runs shown each time it becomes visible ($case)'` — rows, each listing its steps and the
    expected `shown` call count:
    | case | steps | shown |
    |---|---|---|
    | open in a shown frame | `open({ focus: false })` | 1 |
    | open while no pane shows the session | add the drawer for `t`, `open` | 0 |
    | a pane loads the open drawer's session | as above, then `panes.load(focused, 't')` | 1 |
    | the pane leaves the session and comes back | open in shown `s`, load `t`, load `s` | 2 |
    | closed and opened again | `open`, `close`, `open` | 2 |
    | a tab added while open | `open`, `tabs.add('s', tabView('x'))` | 1 |
    | a layout redraw while open | `open`, `view.setLayouts(withUser(defaultLayout, {}))` | 2 |
    | open while the mode is hidden | `isModeShown` false, `open` | 0 |
    | the mode shows after an open while hidden | as above, then `isModeShown` true, `tabs.checkDrawers()` | 1 |
    | the frame moves to the other shown pane | `TWO_PANES` with `a` in `pane-1` and `c` in `pane-2` (`:179-185`), open `a`'s drawer, then `panes.restore(TWO_PANES, new Map([['pane-1', 'c'], ['pane-2', 'a']]))` | 1 |
    | a bar part added while open | the setup's `barParts` store, `open`, then `barParts.add({ id: 'x', build: () => ({}) })` | 1 |
  - `'a throwing shown is logged and skips no other drawer'` — the two-pane setup above, `isModeShown` false; drawer
    `a`'s `shown` throws `new Error('boom')`; open both drawers, set `isModeShown` true, then
    `tabs.checkDrawers()`: it does not throw, `c`'s `shown` count is 1, and `logged` contains
    `drawer a shown failed: boom`. Then `a`'s `open({ focus: true })` does not throw and runs `a`'s `focus` once.
  - `'the drawer row sits under the tab bodies and outside the popup layer'` — with an open popup and an open drawer,
    the frame's children's first classes read `['session-tabs-host', 'session-bodies', 'session-drawer-host',
    'session-popup-bar-host']`, and `findAll(frame, 'session-popups')[0].contains(drawer element)` is false.
  - `it.each` `'open, close and isOpen show and hide the drawer row ($case)'` — rows: added → `isOpen` false, host
    `hidden` true; `open` → true, false; `open` then `close` → false, true; `open` then `dispose` → false, true and the
    host has no children.
  - `'a second drawer for one session throws'` — `addDrawer('s', drawerView('b'))` after `addDrawer('s',
    drawerView('a'))` throws `Session s already has a drawer`; after the first handle's `dispose`, the second add
    returns a handle.
  - `it.each` `'open with focus focuses a visible drawer only ($case)'` — rows: `open({ focus: true })` in a shown
    frame → `focus` 1; `open({ focus: true })` with the session in no pane → `focus` 0; `open({ focus: false })` →
    `focus` 0; `open({ focus: false })` then `open({ focus: true })` → `focus` 1, `shown` 1.
  - `it.each` `'a focus hand-back runs drawerLeft only while the drawer holds focus ($case)'` — rows: `close` with
    focus inside → `drawerLefts()` 1; `close` with a tab's element focused → 0, `document.activeElement` still that
    element; `returnFocus` with focus inside → 1 and `isOpen()` true; `returnFocus` with focus outside → 0;
    `dispose` with focus inside → 1.
  - `it.each` `'dropping the frame or disposing the handle disposes the drawer ($case)'` — rows `dispose`, `drop`,
    each run with the drawer open and focus inside it: afterwards every anchor whose command is
    `panes.resizePaneUp` or `panes.resizePaneDown` is disposed, `isOpen()` is false, and `open({ focus: true })`
    runs no `shown` and no `focus`. `drawerLefts()` reads 1 after `dispose` and 0 after `drop`.
  - `'every drawer shows the stored drawer height and follows a set'` — `fakeUiState([['drawer-height', 300]])`,
    drawers for `s1` and `s2`: both frames' (`.session-area`) `style['--session-drawer-height']` read `'300'`; after
    `uiState.set('drawer-height', 320)` both read `'320'`; after a layout redraw and another set to 280, both read
    `'280'` (the new divider follows the key).
  - `it.each` `'the outer panes move focus into and out of the drawer ($case)'` — through `view.panes.outer.focus
    .move`, one pane, expected `{ moved, focus, drawerLefts }`:
    | case | moved | focus | drawerLefts |
    |---|---|---|---|
    | down, drawer open, focus outside | true | 1 | 0 |
    | down, drawer closed | false | 0 | 0 |
    | down, focus inside the drawer | false | 0 | 0 |
    | up, focus inside the drawer | true | 0 | 1 |
    | up, focus outside | false | 0 | 0 |
    | left, focus inside the drawer | false | 0 | 0 |
  - `it.each` `'the resize keys reach the drawer only while it holds focus ($case)'` — through
    `view.panes.outer.resize.nudge`, the drawer's handle with `hasLayoutBox` true: `up` with focus inside → true;
    `up` with focus outside → false; `left` with focus inside → false.
- `start.test.ts`, in `describe('sessions page part', …)`:
  - `'Alt+j focuses the open drawer and Alt+k hands the keys back to the tab'` — start over one session `s1` with a
    tab whose `shown` is counted; `addDrawer('s1', …)` through the consumer exports, `open({ focus: false })`;
    `harness.outerPanes()?.focus.move('down')` returns true and runs the drawer's `focus` once; with focus inside the
    drawer, `move('up')` returns true, the tab's `shown` count rises by one, and the log lines from that point contain
    `keys to pane label s1`. Pattern: `'paneKeyFocused_ReshowsTheTab'` (`start.test.ts:1595-1614`).
  - `'an open drawer runs shown again when Sessions mode shows again'` — an open drawer in the shown pane has
    `shown` 1; show another mode (`otherModePart`, `:79`), then Sessions again: `shown` 2.
- `consumer-view.test.ts`: `fakeExports` gains `addDrawer`, whose handle counts `disposes.drawer`. Rows added to
  `'disposes the tabs, popups, parts, sections and showOnly holds a consumer added when its registrations dispose'`
  (`:75`): one `addDrawer('s1', …)`, expected `drawer: 1`. In `"forgets a removed session's tabs and popups…"`
  (`:118`): an `addDrawer('s1', …)` and an `addDrawer('s2', …)`; after `removed.tell('s1')`, `drawer: 1`; after
  `consumer.dispose()`, `drawer: 2`.
- `layout/sessions-parts.test.ts`: new `it.each` `'drawerPart_Draw_KeepsTheContract ($case)'` on the shape of
  `'popupParts_Draw_KeepsTheContract'` (`:759-830`), with a `drawerShape(parts)` helper reading each child of the
  drawn element as `handle`, `body` or its text:
  | case | layout | drawnBy | holds | failure |
  |---|---|---|---|---|
  | default drawer | `{}` | `default` | `['handle', 'body']` | null |
  | user drawer draws both | `drawer` drawing `div.mine-drawer` with a body then a handle | `mine` | `['body', 'handle']` | null |
  | user drawer's body outside its element | body from `document.createElement` | `default` | `['handle', 'body']` | `drawer body` |
  | user drawer's handle outside its element | handle from `document.createElement` | `default` | `['handle', 'body']` | `drawer handle` |
- No `read-sessions-layout.test.ts` row: `LAYOUT_PARTS` is a `Record<keyof Layout, true>`, so the compiler fails a
  missing `drawer` entry.

Done when: `npm run typecheck` passes; the tests above exist; the test gate runs them.
Commit:    one commit: "sessions: a drawer row under each session's tabs (addDrawer), its layout part, one stored
           height, and Alt+j/k into and out of it"

## Proof

Commit 16bd1ef9 · proof: diff read: SessionDrawerView, SessionDrawerHandle, addDrawer and the drawer layout part present as planned; typecheck clean in its files; oxfmt applied (main agent, tooling) · concerns: no CHANGELOG line (task 10 owns it); one-pane tree move rows assume pane-tree-view returns false for down/up/left, unchecked; layout.js drawer leaves its input unused
