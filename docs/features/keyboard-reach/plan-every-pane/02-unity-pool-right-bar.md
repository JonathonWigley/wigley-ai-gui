# 02 — Unity-pool right-bar stop

Status: in progress
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/unity-pool/page/start.ts` · modify `src/plugins/unity-pool/page/pool-view-model.ts` ·
           modify `src/plugins/unity-pool/layouts/layout.d.ts` · modify `src/plugins/unity-pool/layouts/default/layout.js` ·
           modify `src/plugins/unity-pool/layouts/default/layout.css` · modify `src/plugins/unity-pool/manifest.ts` ·
           modify `src/plugins/keymap.ts` · modify `src/plugins/unity-pool/main/selftest-script.ts` ·
           test `src/plugins/unity-pool/page/pool-view-model.test.ts` (and every `HolderInput` literal in
           `src/plugins/unity-pool/page/*.test.ts` gains `isCursor`)
Consumes:  `RightBarOptions` with `focus?(): void`, taken by `api.areas.rightBar.contribute` ← 01 ·
           `[page] focus back in main` log line ← 01 · `Mode.focusMain` (Sessions' `checkVisible(true)`) ← 01
Produces:  scope `unity-pool.panel` (manifest `scopes: { panel: 'In the Unity pool panel' }`)
           commands in `src/plugins/unity-pool/manifest.ts`, each `group: 'panel'`, `runsIn: 'page'`:
           `cursorDown` (label `next session`) · `cursorUp` (`previous session`) · `cursorTop` (`first session`) ·
           `cursorBottom` (`last session`) · `showHolder` (`show the session`)
           binds in `src/plugins/keymap.ts`, a new `// ── Unity pool ──` banner section after Notes:
           `j` → `unity-pool.cursorDown` · `k` → `unity-pool.cursorUp` · `gg` → `unity-pool.cursorTop` ·
           `G` → `unity-pool.cursorBottom` · `<CR>` → `unity-pool.showHolder`, each `scope: 'unity-pool.panel'`
           in `src/plugins/unity-pool/layouts/layout.d.ts`: `HolderInput.isCursor: boolean`
           in `src/plugins/unity-pool/page/pool-view-model.ts`:
           `export type CursorMove = 'down' | 'up' | 'top' | 'bottom'`
           `export function movedCursor(cursor: number, count: number, move: CursorMove): number`
           `export function sessionHolders(input: PanelInput): HolderInput[]`
           `panelInput(pool, rows, now, pending, actions, cursor: number | null): PanelInput` (new last parameter)
           log lines (`[unity-pool] <text>`): `panel focused` · `cursor on <label>` · `showed <label>` ·
           `no session holder`
           self-test group `panel keys` in `src/plugins/unity-pool/main/selftest-script.ts`
Decisions: the panel is a right-bar stop with a cursor over its session holders, Enter as the mouse link (brief,
           plan Decisions) · every key is one of vim's own (`src/shared/vim-keys.ts`), so no anchor and no key
           hint (AGENTS.md § Key hints) · no `Esc` bind: Alt+h is the way back, since a plugin reaches main only
           through the core (plan Boundary rules) (agent) · `unity-pool.panel` stays off the `<C-n>` per-scope list,
           which holds main views (`docs/keymap.md` § Layers) (agent) · the cursor walks holders of kind
           `session` only, in panel order: each clone's holder in clone order, then each queue ticket's; user holds
           and app-unknown agents are text, not rows (agent) · the cursor is an index, clamped to the holders'
           count before each draw, kept while the panel lacks the keys (agent) · the cursor draws only while the
           panel holds the keys, so the one focus ring always marks where keys go (`DESIGN.md` § Keys and focus)
           (agent) · the panel always passes `focus`, holders or none: with none, each command logs
           `no session holder` (agent)

## Cold-read rulings

Lead rulings; each overrides any line below that says otherwise.

- The panel ends its turn (`hasKeys = false`, redraw) from `RightBarOptions.left`, which the core calls (Task 01's
  rulings), not from its own `focusout`. It passes `left` beside `focus`.
- Re-entry: `focus()` puts the cursor on the shown session's holder when it holds a clone, else index 0. Add a
  self-test step that re-enters after Alt+h and expects that row.
- Self-test step: with the panel holding the keys, write the unknown-version state, expecting `[unity-pool] panel
  hidden` and `[page] focus back in main`.
- Enter on a holder whose session has no pool: the panel can hide (and the core log `focus back in main`) before or
  after the new tab's `shown`; either order is accepted, and no step asserts the line's absence.

## Behaviour

- **Contribute.** `drawPanel`'s first `api.areas.rightBar.contribute(panelSlot, { order: PANEL_ORDER, focus })`.
  `panelSlot.tabIndex = -1` at creation, so it takes the DOM focus; the Hold/Release buttons and holder links still
  never take it.
- **`focus()`.** `hasKeys = true`, `api.keys.setScope('panel')`, `panelSlot.focus()`, redraw, log `panel focused`.
- **The turn ends** on a `focusout` from `panelSlot` whose `relatedTarget` is not inside it (null included):
  `hasKeys = false`, redraw. `hidePanel` also sets `hasKeys = false` before disposing the contribution (the core
  then calls the shown mode's `focusMain`, Task 01).
- **Draw.** `drawPanel` builds the input, clamps the stored `cursor` to `max(0, sessionHolders(input).length - 1)`,
  and passes `hasKeys ? cursor : null` to `panelInput`; it keeps the drawn holders for the commands. While
  `hasKeys`, after the draw it scrolls `panelSlot.querySelector('.is-cursor')` into view with
  `{ block: 'nearest' }`.
- **Cursor commands** (`cursorDown`/`Up`/`Top`/`Bottom`): with no session holder drawn, log `no session holder`;
  else `cursor = movedCursor(cursor, holders.length, move)`, redraw, log `cursor on <label>` — logged on every press,
  moved or clamped, so a press at an end still shows in the log.
- **`showHolder`** (Enter): no holder → log `no session holder`; else call the cursor holder's `select()` (the
  link's click path, `sessions.activate`), log `showed <label>`. Showing a session the pane already shows changes no
  scope, so the panel keeps the keys; showing another one gives its tab the keys through its `shown`, which ends the
  panel's turn (Task 01's base-change reset).
- **`movedCursor`**: `down` +1, `up` −1, `top` 0, `bottom` `count - 1`, the result clamped to `[0, count - 1]`; 0
  for `count` 0.
- **`panelInput`**: every holder's `isCursor` is false except the session holder at index `cursor` in
  `sessionHolders` order; `cursor` null, or past the last holder, marks none. Its doc comment names the parameter.
- **`sessionHolders`**: each clone's `holder` in `clones` order, then each queue ticket's `holder`, keeping those
  with `kind === 'session'`.

## Layout contract and default layout

- `layout.d.ts` header: the "no keys and no focus" bullet becomes the app keeping the keys and the focus: Alt+l past
  main's right edge gives the panel the keys, `j`/`k`/`gg`/`G` walk a cursor over the session holders and Enter
  shows the cursor's session, as the holder's click does; the buttons and links still never take focus.
- `HolderInput.isCursor` doc: true on the one session holder the keyboard cursor is on while the panel holds the
  keys; the layout adds `is-cursor` to that holder's element, and the app scrolls the first `.is-cursor` in the
  panel into view.
- `layout.js` `drawHolder`: `element.classList.toggle('is-cursor', holder.isCursor)`. The file's header comment
  names the cursor.
- `layout.css`: `[data-layout-owner='unity-pool'][data-layout='default'] .unity-pool-holder.is-cursor` draws the one
  focus ring as Settings' default layout does (`box-shadow: inset 0 0 0 1px var(--wg-focus-border)`,
  `src/plugins/settings/layouts/default/layout.css:59`), with the padding and radius tokens the holder needs so the
  ring clears the text; no other colour.
- `manifest.ts` header comment names the panel's keys.

GIVEN the shown session holds clone 1 and main's chain turns Alt+l down WHEN Alt+l is pressed THEN the panel logs
`[unity-pool] panel focused`, the scope is `unity-pool.panel` and the holder carries the focus ring.
GIVEN the panel holds the keys over one session holder WHEN `G` THEN `[unity-pool] cursor on <label>` logs and the
cursor stays on it.
GIVEN the panel holds the keys WHEN Enter THEN the holder's session is shown as a click on it shows it, and
`[unity-pool] showed <label>` logs.
GIVEN the panel holds the keys WHEN Alt+h, or a click into main THEN the ring goes and main holds the keys.
GIVEN the panel holds the keys WHEN the shown session leaves the pool THEN the panel hides and the core logs
`[page] focus back in main`.

Tests:
- `pool-view-model.test.ts`, `movedCursor moves and clamps: $case` (`it.each`): `(1, 3, 'down')` → 2;
  `(2, 3, 'down')` → 2; `(0, 3, 'up')` → 0; `(2, 4, 'top')` → 0; `(0, 4, 'bottom')` → 3; `(0, 0, 'down')` → 0
  [a missing clamp or an off-by-one at either end].
- `pool-view-model.test.ts`, under `panelInput`, table `marks the cursor's session holder only: $case`, over one
  pool built in the test: clone 1 held by the user, clone 2 claimed by row A, clone 3 handed off to row B, one
  ticket queued by row C and one by a session with no row. Rows: cursor 0 → only clone 2's holder `isCursor`;
  cursor 2 → only row C's ticket holder; cursor null → none; cursor 9 → none [a user or agent holder counted, the
  queue walked before the clones, a stale mark]. The same pool's `sessionHolders` labels are asserted whole once
  (`[A, B, C]`).
- No `start.test.ts` row: the wiring (contribute with `focus`, the scope, focusout, the commands) is proved by the
  self-test group below.

Self-test: `src/plugins/unity-pool/main/selftest-script.ts`, a new group `panel keys` between `badge and panel` and
`tiles`, on the `panel` stage's state (clone 1 claimed by the session's row, clone 2 free):
- `why`: `Alt+l past main's right edge gives the Unity pool panel the keys with its cursor on the session holding
  clone 1; G keeps it on the one holder, Enter shows that session, and Alt+h gives the keys back to main.`
- step `{ keys: ['<A-l>', '<A-l>'], expect: '[unity-pool] panel focused', screenshot: 'panel-cursor' }` — two
  presses so the step holds once Task 06 puts the session hub between the Chat tab and the right bar: today the
  second press logs `no pane right` in the right bar
- step `{ keys: ['G'], expect: '[unity-pool] cursor on unity-pool-selftest' }`
- step `{ keys: ['Enter'], expect: '[unity-pool] showed unity-pool-selftest' }`
- step `{ keys: ['<A-h>'], expect: '[page] focus back in main' }`
The script's header comment gains one line naming the group; "Hold and Release are clicks" stays true.

Done when: `npm run typecheck`, `npm run lint` and the tests above pass; `grep -En "unity-pool\.(cursorDown|cursorUp|cursorTop|cursorBottom|showHolder)" src/plugins/keymap.ts` finds the five binds.
Commit:    one commit for the group

## Proof

