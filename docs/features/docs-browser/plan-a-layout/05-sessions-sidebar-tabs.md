# 05 — Sessions mode: the sidebar and each session's tabs

Status: not started
Type: Task
Wave: 3 · Depends on: 01, 02, 04
Plan: [plan.md](plan.md)

Files:
- modify `src/plugins/sessions/contract.ts` (page side), `src/plugins/sessions/manifest.ts`
- modify `src/plugins/sessions/page/start.ts`
- modify `src/plugins/sessions/page/sessions-view.ts` (rewritten as the mode's root)
- create `src/plugins/sessions/page/sidebar-view.ts`, `src/plugins/sessions/page/session-tabs-view.ts`
- modify `src/plugins/sessions/page/tabs.ts` · test `src/plugins/sessions/page/tabs.test.ts`
- modify `src/plugins/sessions/page/sessions.css`
- modify `src/plugins/forms/page/start.ts`, `src/plugins/forms/page/forms-view.ts`, `src/plugins/forms/page/forms.css`
- modify `src/plugins/forms/page/forms-commands.ts` · test `src/plugins/forms/page/forms-commands.test.ts`
- modify `src/plugins/forms/page/form-state.ts` · test `src/plugins/forms/page/form-state.test.ts` (one rename)
- modify `scripts/check-layers.mts` (`LAYERS`)

Consumes:
- `EditorBind.scope`, `PluginKeys.editor[].scope` ← 01
- `SessionRow { sessionId; label; harness; marked; projectDir; hostSessionId }`, `SessionsState { rows;
  selectedSessionId }`, `SessionsChannel` (`state`, `activate`, `closeSession`; messages `stateChanged`,
  `activated: { sessionId }`), `Harness` ← 02
- `PageApi.modes: Modes`, `Modes.add(mode: Mode): ModeHandle`, `Mode { id; title; element; shown(): void }`,
  `ModeHandle { show(); isShown() }`, `Modes.onChanged(listener)` ← 04
- `KeysPageExports.keysFor(command, scope?)` (in the tree)

Produces (in `src/plugins/sessions/contract.ts`; `SessionView` and the `fill` export are deleted):
```ts
// `beforeClose` returns whether the session may close now; false keeps it. `shown` runs each time this tab becomes
// the visible tab: the selected tab of the selected session while Sessions mode shows. Its plugin sets its base key
// scope there.
export interface SessionTabView {
  id: string; title: string; element: HTMLElement; beforeClose(): boolean; shown(): void;
}
// `isVisible` reads, at the moment of the call, whether this tab is the visible tab.
export interface SessionTabHandle {
  setStatus(status: string): void; select(): void; remove(): void; isVisible(): boolean;
}
export interface SessionsPageExports {
  addTab(sessionId: string, tab: SessionTabView): SessionTabHandle;
  selectedSessionId(): string | null;
  activate(sessionId: string): void;
  closeSession(sessionId: string): void;
}
export interface SessionsPageEvents extends EventShape {
  activeChanged: { sessionId: string | null };
  sessionAdded: { sessionId: string; projectDir: string | null; harness: Harness | null; hostSessionId: string | null };
  sessionRemoved: { sessionId: string };
}
```
Pure helpers in `src/plugins/sessions/page/tabs.ts` (each tested):
```ts
export function stepSession(state: SessionsState, step: 1 | -1): string | null;
export function stepTab(tabIds: readonly string[], selectedTabId: string | null, step: 1 | -1): string | null;
export function rowStatus(statuses: readonly string[]): string | null;          // today's tabTitle, renamed
export function harnessText(harness: Harness | null): string;
export function roundToastText(label: string, keys: string | null): string;
export function rowChanges(before: readonly SessionRow[], after: readonly SessionRow[]):
  { added: SessionRow[]; removed: string[] };
export function isRoundToast(before: string | null | undefined, after: string | null, isModeShown: boolean): boolean;
export function showsEmptyText(state: SessionsState | null): boolean;          // kept, on rows
export function showsNoSelectionText(state: SessionsState | null): boolean;
export function mayClose(views: readonly Pick<SessionTabView, 'beforeClose'>[]): boolean; // kept
// What Sessions mode shows: the selected tab of the selected session; `'none'` while the mode shows no tab;
// null while the mode is hidden.
export type VisibleTab = { sessionId: string; tabId: string } | 'none' | null;
export function visibleTab(isModeShown: boolean, selectedSessionId: string | null,
  selectedTabId: string | null): VisibleTab;
export function isSameVisibleTab(a: VisibleTab, b: VisibleTab): boolean;
// The sidebar's page-local state: hidden by the user while the window is wide, and open over the content while it
// is narrow (below 680 px).
export interface SidebarState { isHiddenWide: boolean; isOverlayOpen: boolean; }
export type SidebarLayout = 'beside' | 'over' | 'hidden';
export const SIDEBAR_START: SidebarState;                     // { isHiddenWide: false, isOverlayOpen: false }
export function sidebarLayout(state: SidebarState, isNarrow: boolean): SidebarLayout;
export function toggledSidebar(state: SidebarState, isNarrow: boolean): SidebarState;
export function sidebarAfterResize(state: SidebarState, isNarrow: boolean): SidebarState;
```
`tabText`, `tabTitle`, `keepsPane`, `showsIdleText` are deleted with the strip they served.

Decisions:

**Manifest** (`sessions/manifest.ts`; plan.md Decisions, design.md § Modes and layout):
- `dependsOn: ['keys']` (for `keysFor`); `scopes: { idle: 'Sessions' }` (no binds name it; it is the base scope
  while Sessions mode shows no tab); the comment says Sessions mode, the sidebar and tabs.
- Commands, each `runsIn: 'page'`, labels verbatim:
  `showMode` — `Sessions mode · toggle the sidebar`, group `sessions`;
  `nextSession` — `next session`, group `sessions`; `prevSession` — `previous session`, group `sessions`;
  `nextTab` — `next tab`, group `tabs`; `prevTab` — `previous tab`, group `tabs`;
  `closeSession` — `close the session`, group `sessions`. `closeTab` goes.
- Page binds, all scope `any`, in this order: `[' ', 'k', 's']` → `showMode`; `['<A-S-o>']` → `nextSession`;
  `['<A-S-i>']` → `prevSession`; `['<A-o>']` → `nextTab`; `['<A-i>']` → `prevTab`; `['<D-w>']` → `closeSession`;
  `[' ', ';']` → `closeSession`.
- Editor binds, scope `any`: `<Leader>ks` → `showMode`; `<Leader>;` → `closeSession`.

**Mode and layout**:
- The page part registers `api.modes.add({ id: 'sessions', title: 'Sessions', element: root, shown })` and keeps
  the handle; it no longer contributes to `areas.main`. `shown` and the scope rule are under **The visible tab and the
  key scope** below.
- `root` (`.sessions`, `position: relative`) is a two-column grid: the sidebar (`.session-sidebar`, `16rem`, the
  shell side bar's width) and the tab area (`.session-area`: the tab strip `.session-tabs` over the bodies).
- **Width** (the user's choice): the window's minimum width stays `420`. While the window is narrower than `680px`
  the sidebar hides itself, and `Space k s` (`showMode` while Sessions shows) opens it **over** the content, until
  pressed again or the window widens. The form keeps the whole width at 420 px, where it was fitted.
- **State rule** (pure, in `tabs.ts`; the page holds one `SidebarState`, starting `SIDEBAR_START`, lost on reload):
  - `sidebarLayout(state, isNarrow)`: wide → `'hidden'` when `isHiddenWide`, else `'beside'`; narrow → `'over'`
    when `isOverlayOpen`, else `'hidden'`.
  - `toggledSidebar(state, isNarrow)`: wide → flips `isHiddenWide`; narrow → flips `isOverlayOpen`. The other field
    stays.
  - `sidebarAfterResize(state, isNarrow)`: wide → `isOverlayOpen: false` (the window widening ends the overlay);
    narrow → unchanged. `isHiddenWide` always stays, so a user who hid the sidebar while wide finds it hidden when the
    window widens again.
- **Narrow detection**: the page reads `window.matchMedia('(max-width: 679px)')` once at start and listens for its
  `change` event; on each change it applies `sidebarAfterResize` and redraws. (The page's 16 px root size makes
  16rem 256 px; 680 = 420 + 256, so beside-layout never squeezes the form under its fitted width.)
- **Drawing each layout**: `'beside'` → the two-column grid, sidebar visible; `'hidden'` → `root` gains
  `is-sidebar-hidden`, the grid has one column (`minmax(0, 1fr)`), the sidebar element is `hidden`; `'over'` → `root`
  gains `is-sidebar-over`, the grid has one column, and the sidebar is `position: absolute; inset-block: 0; left: 0;
  width: 16rem; z-index: 1`, with `box-shadow: 0 0 1rem var(--wg-bg-deep)` and its normal background, drawn over the
  tab area. A row click while it is over activates the session and leaves the overlay open (only `Space k s` or a
  wider window closes it).
- **Log** after a toggle, by the new layout (source `sessions`): `'beside'` → `sidebar shown`; `'over'` →
  `sidebar shown over the content`; `'hidden'` → `sidebar hidden`. A resize logs nothing.

**Rows** (`sidebar-view.ts`; plan.md Decisions):
- One `button.session-row` per state row, in state order; `is-selected` and `aria-current="true"` on the selected
  row; a click runs `activate(sessionId)`.
- First line: `.session-row-label` (the row's `label`, one line, ellipsis), then `.session-row-harness` with
  `harnessText(harness)` dimmed (`Claude`, `Codex`; element hidden on `''`), then `.session-row-marker` `●`, hidden
  unless `marked`.
- Second line `.session-row-status`: `rowStatus(the session's tab statuses in tab-add order)`; the element is hidden
  on `null`. The button's `title` is the label, then ` · ` and the status when there is one.
- CSS (`sessions.css`, theme variables only): sidebar `background: var(--wg-bg-pane)`, `border-right: 1px solid
  var(--wg-border)`, `overflow-y: auto`; row text `var(--wg-text-muted)`; selected row `background:
  var(--wg-surface-selected)`, `color: var(--wg-text)`, `border-left: 2px solid var(--wg-accent)`; harness
  `var(--wg-text-faint)`; marker `var(--wg-accent)`; status one line with ellipsis. Tab strip and tab rules keep
  today's `.session-tabs` / `.session-tab` / `.session-tab-label` look.

**Tabs** (`session-tabs-view.ts`; design.md § Modes and layout, § Core services and seams; plan.md Decisions):
- The view holds, per session id, its tabs in add order and the selected tab id. `addTab` attaches `tab.element`
  inside that session's body before returning (editors mount into attached elements), appends the tab, and selects it
  when it is the session's first. A second tab with an id the session already holds throws
  `Session <sessionId> already has a tab "<id>"`.
- A tab may be added for a session with no row yet; it waits and shows once the row arrives.
- `handle.setStatus(status)` stores it and redraws the row's second line. `handle.select()` selects that tab inside
  its session; it never changes the selected session. `handle.remove()` removes the element and the tab; a removed
  selected tab passes selection to its right neighbour, else its left. Every handle call on a tab already dropped
  does nothing.
- Only the selected session's body shows, and in it only its selected tab's element. The strip shows the selected
  session's tabs by `title` (`.session-tab-label`), the selected one `is-active`; a click selects it.
- Tabs are not closable. A session's tabs drop when its row leaves the state (the user closed it, or it ended), and
  `sessionRemoved` tells their plugins to forget them; a row that comes back gets new tabs from its plugins
  (`sessionAdded`, forms' next round).
- Texts (verbatim; title as `h1`, text as `p`, classes `.sessions-empty*` as today):
  - no rows: `No sessions` / `An agent session shows here once its relay connects: when it starts while the app runs, or at its first round.`
  - rows, none selected: `No session selected` / `Pick a session in the sidebar.`
  - the selected session has no tab: `Nothing open` / `This session has nothing open yet. Its first round opens a Form tab here.`
- Nothing shows before main's first state, as today.

**Keys' behaviour** (page `start.ts`; plan.md Decisions):
- `showMode`: Sessions hidden → `handle.show()`; shown → `toggledSidebar(state, isNarrow)`, redraw, and log by the
  new layout as **Width** above pins.
- `nextSession` / `prevSession`: Sessions hidden → `handle.show()` first; then `stepSession(state, ±1)`; a result
  runs `activate`. `stepSession`: no rows → null; none selected → the first row for `1`, the last for `-1`; one row
  that is selected → null; else wraps.
- `nextTab` / `prevTab`: Sessions hidden → `handle.show()` first (drafter's decision, symmetric with session steps);
  no selected session → nothing; `stepTab(tabIds, selectedTabId, ±1)` null → log `no other tab in <label>`; else
  select it and log `showed <title> tab in <label>`. `stepTab`: fewer than two tabs → null; selected null → first
  for `1`, last for `-1`; else wraps.
- `closeSession`: Sessions hidden → log `close ignored: Sessions mode is hidden` and do nothing (drafter's decision:
  Cmd+W in another mode never closes an unseen row); no selected session → nothing; else the export
  `closeSession(selectedSessionId)`.
- Export `closeSession(sessionId)`: asks every tab of the session `beforeClose` in add order (`mayClose`, stopping at
  the first `false`); all allow → invoke `closeSession`; main answering `false` logs
  `session close kept by main: <label>`; a rejected invoke logs `session not closed: <error>`. Export `activate`
  invokes `activate`, logging `session not activated: <error>` on failure. `selectedSessionId()` reads the state.

**State, events and the round toast** (page `start.ts`; plan.md Decisions):
- Each state main sends (`stateChanged`, or the first `state` read, with today's stale-read rule) is applied in this
  order: draw; drop the tabs of every removed row; emit `sessionRemoved` per removed row (before-state order); emit
  `sessionAdded` per added row (after-state order) with `{ sessionId, projectDir, harness, hostSessionId }` from the
  row; when the selected session changed, log `activated <label>` (as today) and emit `activeChanged`; then the
  visible-tab check (below); then the toast check.
- `isRoundToast(before, after, isModeShown)` is true only when `before` is `null` (not `undefined`, which marks the
  first state), `after` is not null, and Sessions is hidden: main selects on its own only through `markRound` with
  none selected, so a selection moving from one session to another (a close, an end) never toasts.
- The toast: `services.toast(roundToastText(label, keys), 'info')`, `keys` =
  `keysFor(qualify('sessions', 'showMode'))` from the keys plugin's exports (first page bind in any scope).
  `roundToastText` returns `Round from <label> — <keys> to answer`, or `Round from <label>` when `keys` is null
  (e.g. `Round from wigley-ai-gui — Space k s to answer`). (Text pinned in plan.md.)
- `activated` (main's message): `handle.show()`. Main sends it before the state it changes, so a notification click
  shows Sessions mode and never toasts.

**The visible tab and the key scope** (lead's ruling: a hidden view never keeps its key scope; page `start.ts` and
`session-tabs-view.ts`, the decision in `tabs.ts`):
- The page keeps `isModeShown`, a boolean: `true` in its mode's `shown()`, and set to `modeId === 'sessions.sessions'`
  in an `api.modes.onChanged` listener. It never reads the mode handle inside `shown()` (04: the first `shown()` runs
  before `add` returns).
- It keeps `lastVisible: VisibleTab`, starting `null`. The **visible-tab check** computes
  `next = visibleTab(isModeShown, state.selectedSessionId, selected tab id of that session or null)` and, when
  `!isSameVisibleTab(lastVisible, next)`, stores `next` and acts on it: an object → that tab's `view.shown()`;
  `'none'` → `api.keys.setScope('idle')` and log `nothing shown in <label>` (a session is selected) or
  `nothing shown` (none is); `null` → nothing (the mode now shown sets its own scope).
- The check runs after every change that can move the visible tab: the mode's `shown()`; an `onChanged` hearing
  another mode; each applied state (after `activeChanged`, so forms' store already follows the new session); `addTab`;
  `handle.select()`; `handle.remove()`; a tab click; `nextTab` / `prevTab`; the tabs dropped with a removed row.
- `visibleTab(isModeShown, selectedSessionId, selectedTabId)`: `!isModeShown` → `null`; a session and a tab id →
  `{ sessionId, tabId }`; else `'none'`. `isSameVisibleTab`: both `null`, both `'none'`, or both objects with equal
  `sessionId` and `tabId`.
- `handle.isVisible()` is live, not `lastVisible`: `isModeShown`, its session selected in the current state, and it the
  session's selected tab. A plugin reads it to decide whether a change of its own may set the scope.
- At page start the mode's first `shown()` runs before main's first state: the check gives `'none'`, so the base
  scope starts as `sessions.idle` and logs `nothing shown`.

**Forms' Form tab** (`forms/page/forms-view.ts`, `start.ts`; design.md § Modes and layout; plan.md Decisions):
- The Form tab's `shown()` sets forms' base scope: `api.keys.setScope(store.get().view)`, as forms' store
  subscription does today in `forms/page/start.ts` (`store.subscribe(() => api.keys.setScope(store.get().view))` and
  the call after it).
- That subscription now sets the scope only while a Form tab is visible: `mountFormsView` returns
  `isFormShown(): boolean`, true when any of its Form tab handles' `isVisible()` is true (at most one is). The
  unconditional `api.keys.setScope(store.get().view)` at start goes: sessions owns the starting scope.
- One Form tab per session, added through `sessions.addTab(sessionId, { id: 'form', title: 'Form', element,
  beforeClose: () => deps.beforeClose(sessionId), shown: () => deps.formShown() })`. Forms adds it only where a
  round view is created (`syncRoundViews` building a new round's view, where the `select()` below runs), when that
  session has no Form tab entry; a render that finds a round whose view already exists never adds one. `start.ts`
  passes `formShown: () => api.keys.setScope(store.get().view)`. Its element (`.form-tab`) holds that session's
  round views and an idle section.
- The idle section shows while the session has no round in the forms state; text verbatim, moved from sessions:
  title `No round open`, text `This session has no round for you now. Its agent's next round opens here.`; its rules
  move from `sessions.css` (`.session-idle*`) to `forms.css` as `.form-idle`, `.form-idle-title`, `.form-idle-text`.
- When a round view is created, its session's Form tab `select()`s (the Form tab is selected when its round shows).
- Status: `setStatus(sessionTitle(round))` while the session has a round (today's tab title), `setStatus('')` when it
  has none; sent only when it changed, as `sendTitles` does today.
- `mountFormsView` returns `{ forgetSession(sessionId: string): void; isFormShown(): boolean }`; `start.ts` calls
  `forgetSession` on `sessions.sessionRemoved`. It drops the session's Form tab entry; the next round of that session adds a new one.
- `FormsViewDeps.sessions` is `Pick<SessionsPageExports, 'addTab'>`; `start.ts` reads
  `sessions.selectedSessionId()` for `initialState` and passes `closeSession: (id) => sessions.closeSession(id)`.
- Renames for the row (forms-commands and form-state): the dep `closeTab` → `closeSession`; the state field
  `confirmClosesTab` → `confirmClosesSession`; `guardClose`'s logs read `closing the session asks to cancel <label>`
  and `session close kept: <label> is open in the background`.

**Layers**: `LAYERS['src/plugins/sessions/page'].layers` gains `'src/plugins/keys/contract.ts'`. No plugin imports
`src/renderer`. (plan.md File Structure, Boundary rules.)

GIVEN Sessions mode hidden and no session selected WHEN a round's session is selected by main THEN the page keeps the
shown mode and toasts `Round from <label> — Space k s to answer`.
GIVEN Sessions mode shown in a window 680 px wide or more WHEN `Space k s` is pressed twice THEN the sidebar hides,
then shows beside the content, logging `sidebar hidden`, then `sidebar shown`.
GIVEN a window narrower than 680 px WHEN Sessions mode shows THEN the sidebar is hidden and the tab area takes the
whole width; `Space k s` opens it over the content (`sidebar shown over the content`), and pressing it again or
widening the window past 680 px closes the overlay.
GIVEN session A selected with one tab WHEN `<A-o>` THEN the page logs `no other tab in <A's label>`.
GIVEN A's Form tab visible WHEN the user steps to session C, which has no tab THEN the base scope is `sessions.idle`,
the page logs `nothing shown in <C's label>`, and forms' `j` no longer runs; stepping back to A runs A's Form tab
`shown()`, and forms' scope (`forms.forms`) is back.
GIVEN Sessions mode hidden WHEN a round arrives for the selected session THEN forms' store changes but the base scope
stays where the shown mode set it.
GIVEN a session whose round is open WHEN Cmd+W THEN forms' Form tab `beforeClose` asks to cancel and the row stays.

Tests (`src/plugins/sessions/page/tabs.test.ts`; `stateOf(ids, selected)` builds rows with `label` = id,
`harness: null`, `marked: false`, `projectDir: null`, `hostSessionId: null`):
- `stepSession wraps at both ends` — rows `a b c`: from `a` `1` → `b`; from `c` `1` → `a`; from `a` `-1` → `c`.
- `stepSession picks an end when none is selected` — rows `a b`, none: `1` → `a`, `-1` → `b`.
- `stepSession finds nothing with no rows or one selected row` — `[]` → null; `a` selected `a` → null.
- `stepTab wraps, picks an end with none selected, and finds nothing under two tabs` — `['form','docs']` from
  `form` `1` → `docs`, from `docs` `1` → `form`; none `-1` → `docs`; `['form']` → null.
- `rowStatus takes the last non-empty status in add order` — `['a 1/2', '', 'b']` → `b`; `['', '']` → null.
- `harnessText names each harness and nothing for none` — `claude` → `Claude`; `codex` → `Codex`; null → `''`.
- `roundToastText names the keys, or only the session with none bound` — (`x`, `Space k s`) →
  `Round from x — Space k s to answer`; (`x`, null) → `Round from x`.
- `rowChanges lists added rows in their order and removed ids` — before `a b`, after `b c d` → added `c d`,
  removed `['a']`.
- `isRoundToast only when main selects from none while the mode is hidden` — (null, `a`, false) → true;
  (null, `a`, true) → false; (`b`, `a`, false) → false; (undefined, `a`, false) → false; (null, null, false) → false.
- `showsEmptyText` and `showsNoSelectionText` — null state → both false; no rows → empty true, no-selection false;
  rows `a`, none selected → empty false, no-selection true; `a` selected → both false.
- `mayClose` keeps today's test.
- `sidebarLayout draws beside or hidden while wide, over or hidden while narrow` — wide: `SIDEBAR_START` →
  `'beside'`, `{ isHiddenWide: true, isOverlayOpen: false }` → `'hidden'`; narrow: `SIDEBAR_START` → `'hidden'`,
  `{ isHiddenWide: false, isOverlayOpen: true }` → `'over'`, `{ isHiddenWide: true, isOverlayOpen: true }` →
  `'over'`.
- `toggledSidebar flips the hidden flag while wide and the overlay while narrow` — wide from `SIDEBAR_START` →
  `{ isHiddenWide: true, isOverlayOpen: false }`; narrow from `SIDEBAR_START` → `{ isHiddenWide: false,
  isOverlayOpen: true }`; narrow from `{ isHiddenWide: true, isOverlayOpen: true }` → `{ isHiddenWide: true,
  isOverlayOpen: false }`.
- `sidebarAfterResize closes the overlay when the window widens and keeps the user's hidden choice` — wide from
  `{ isHiddenWide: true, isOverlayOpen: true }` → `{ isHiddenWide: true, isOverlayOpen: false }`; narrow from
  `{ isHiddenWide: false, isOverlayOpen: true }` → unchanged.
- `visibleTab is null while the mode is hidden, none with no tab, else the selected tab` — (false, `a`, `form`) →
  null; (true, null, null) → `'none'`; (true, `a`, null) → `'none'`; (true, `a`, `form`) →
  `{ sessionId: 'a', tabId: 'form' }`.
- `isSameVisibleTab compares by value` — (null, null) → true; (`'none'`, `'none'`) → true; (`{a, form}`,
  `{a, form}` built separately) → true; (`{a, form}`, `{b, form}`) → false; (`'none'`, null) → false.

`src/plugins/forms/page/forms-commands.test.ts`: the fake dep `closeTab` → `closeSession`; the two log
expectations read `closing the session asks to cancel project · r1` and
`session close kept: project · r2 is open in the background`. `form-state.test.ts`: the field rename only.

Live checks (layout, the sidebar's look, focus after closing a row) belong to task 08; keys get self-test steps in
task 06. The self-test may fail between this group and 06 (its steps still press `<A-o>` for sessions), so this
group's gate is the commands below.

Done when: `npm run typecheck`, `npm test`, `npm run lint` pass; `grep -rn "fill(\|closeTab\|activeSessionId()" src/plugins/sessions src/plugins/forms`
finds nothing.
Commit: one commit for the group.

## Proof

