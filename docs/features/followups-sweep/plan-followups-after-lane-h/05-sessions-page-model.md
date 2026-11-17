# 05 — Sessions page model

Status: not started
Type: Task
Rung: hard · moves a dozen interacting state fields and `apply`'s jobs across a new seam, keeping the view-then-model construction order and `apply`'s microtask and restore tracking exactly as they run now
Wave: 2 · Depends on: 03 (lists `src/plugins/sessions/page/start.ts`)
Plan: [plan.md](plan.md)

Follow-up **Sessions page model** (L551, `followups.md` on main at 9b671bd16): the sessions page `start`
(`src/plugins/sessions/page/start.ts`) moves its closure state and its multi-job `apply` into a DOM-free
`createSessionsPageModel`.

Files:
- create `src/plugins/sessions/page/sessions-page-model.ts`
- modify `src/plugins/sessions/page/start.ts` (everything listed under "Moves" leaves it; the part wires the model)
- modify `src/plugins/sessions/page/session-fakes.ts` (gains `savedSplit` and `hostRow`)
- modify `AGENTS.md` (the `sessions/` source-tree entry's `page/` list)
- test `src/plugins/sessions/page/sessions-page-model.test.ts` (create)
- test `src/plugins/sessions/page/start.test.ts` (imports `savedSplit` and `hostRow` from `session-fakes.ts`; no test changes)

Preconditions (run from the `wigley-ai-gui/` folder of the merged tree; checked 2026-11-17 on the Lane H branch):

| Claim | Command | Expected |
|---|---|---|
| The closure state sits in `start` | `grep -n -E "^    let (state\|hasPublished\|isModeShown\|lastVisible\|pendingEchoes\|hasRestored\|restoreFollowed\|waiting\|isPlacing\|isApplying\|midOperation)\b" src/plugins/sessions/page/start.ts` | 11 lines (`isPlacing` and `isApplying` on their own lines) |
| `apply` is a closure of `start` | `grep -n "    const apply = (next: SessionsState) => {" src/plugins/sessions/page/start.ts` | one line |
| No model yet | `grep -rn "createSessionsPageModel" src` | nothing |
| The view callbacks run no earlier than the first command or notice | `grep -n "panesChanged()\|paneFocused(paneId)\|tabsChanged()" src/plugins/sessions/page/start.ts` | each inside `mountSessionsView`'s deps, each reading `view` |
| The fixtures to share are local to `start.test.ts` | `grep -n "^function savedSplit\|^const hostRow" src/plugins/sessions/page/start.test.ts` | two lines |

Re-read `start.ts` on the merged code first: task 03 adds a press record and a `pointerdown` listener. It is DOM
wiring and stays in `start.ts`.

Consumes: nothing from another group.

Produces, in `src/plugins/sessions/page/sessions-page-model.ts`:
- `export function createSessionsPageModel(deps: SessionsPageModelDeps): SessionsPageModel`
- `export interface SessionsPageModelDeps`, members:
  - `view: SessionsPageModelView`
  - `uiState: UiState`
  - `readRows(): Iterable<SessionRow>` (main's rows, owners included; the model filters them)
  - `readSelection(): string | null`
  - `active: { get(): string | null | undefined; set(sessionId: string | null): void }`
  - `activateInMain(sessionId: string): Promise<SessionsState>` (the `activate` channel invoke)
  - `restores: Pick<PageRestores, 'track'>`
  - `setContext(focused: SessionRow | undefined): void` (the title bar; `start.ts` formats the detail path)
  - `markToast(mark: MarkOptions): void` (`start.ts` builds the text with the `showMode` keys and toasts it)
  - `setIdleScope(): void`
  - `tabShown(sessionId: string, tabId: string): void` (emits `tabShown`)
  - `log: PluginLog`
- `export interface SessionsPageModelView`: `render: SessionsView['render']`; `panes: Pick<SessionPanes, 'tree' | 'sessions' | 'focusedPaneId' | 'focusedSessionId' | 'load' | 'focus' | 'close' | 'restore'>`;
  `tabs: Pick<SessionTabsView, 'tabsOf' | 'selectedTabOf' | 'openPopupOf' | 'drop'>`; `list: Pick<SessionList, 'holdsKeys'>`
- `export interface SessionsPageModel`, members:
  - `ready(): void` (the first apply, of the slots' state now)
  - `applyNotice(): void` (applies the slots' state now, once `ready` ran; nothing before)
  - `state(): SessionsState`
  - `rowOf(sessionId: string): SessionRow | undefined`
  - `labelOf(sessionId: string): string`
  - `activate(sessionId: string): void`
  - `checkVisible(isShownAgain?: boolean): void`
  - `setMainScope(): void`
  - `paneLabel(paneId: string): string`
  - `setModeShown(isShown: boolean): void`
  - `isModeShown(): boolean`
  - `closeWaiting(): void`
  - `tabsChanged(): void`, `panesChanged(): void`, `paneFocused(paneId: string): void` (the view's callbacks)

Decisions:
- **Moves.** From `start.ts` into the model file: `PANES_KEY`, `SavedPanes`, `readSavedPanes`, `MidOperation`,
  `NO_MID_OPERATION`; the state `state`, `hasPublished`, `isModeShown`, `lastVisible`, `pendingEchoes`, `saved`,
  `hasRestored`, `restoreFollowed`, `waiting`, `isPlacing`, `isApplying`, `midOperation`; and `applyNotice`, `rowOf`,
  `labelOf`, `tabOfVisible`, `checkVisible`, `publishFocused`, `savePanes`, `mainSelection`, `tellMain`,
  `placeSession`, `activate`, `paneLabel`, `setMainScope`, `restoreSavedPanes`, `fillWaiting`, `closeWaiting`,
  `placeSelection`, `currentState` and `apply`, each body unchanged but for reading its deps. The bodies of the
  view's `tabsChanged`, `panesChanged` and `paneFocused` callbacks become the model's members of those names.
- **Stays in `start.ts`.** Everything that touches the DOM or the part's api registrations: `panePressed` (it reads
  `window.getSelection` and `document.activeElement`), `keysToFocusedPane` (`blurFocusedElement`, then
  `model.setMainScope()`), `focusMain` (`paneHolding(document.activeElement)`), `endListByMain` and its listeners,
  the mode (`shown` and `hidden` call `model.setModeShown` before what they do now), the slot publishes and
  `followRows`, the picker and `openSplitPicker`, the rename dialog, layouts, `closeSession`, `createExports` and
  every command. Commands read the model where they read the closure: `model.state()`, `model.rowOf`,
  `model.labelOf`, `model.activate`, `model.closeWaiting()`, `model.checkVisible(true)`.
- **DOM-free.** The model file imports no `document`, `window` or `shared/page/dom` helper; its view reaches it only
  through `SessionsPageModelView`'s members, so a test fakes them with plain objects. `queueMicrotask` stays as the
  global it is now.
- **Construction order.** `start` mounts the view first, its callbacks forwarding to a `model` const created right
  after the mount (`tabsChanged: () => model.tabsChanged()`); the callbacks fire only on later pane and tab changes,
  as their reads of `view` already require. `rows.on` and `selection.on` subscribe `model.applyNotice` after the
  model exists, and before `followRows`, as now. `ready()` calls `model.ready()`.
- **The owner filter moves with `currentState`.** The model keeps rows whose `owner` is null, as now.
- **One fixture home.** `savedSplit` and `hostRow` move from `start.test.ts` into `session-fakes.ts`, exported, so
  both suites build saved panes the same way.

GIVEN saved panes `a` and `b` showing `host-s1` and `host-s2`, `a` focused WHEN `ready` runs on rows `s1`, `s2` with `s1` selected THEN pane `a` shows `s1`, pane `b` shows `s2`, one restore is tracked, and after a microtask `active` is `s1` and the restore has settled.
GIVEN two panes showing `s1` and `s2`, `s2`'s focused and published WHEN a notice drops row `s2` with the selection still `s2` THEN `s2`'s pane closes at once but nothing publishes until the notice that selects a held row.
GIVEN one pane showing `s1` WHEN a notice drops row `s1` and selects `s2` THEN the last pane shows `s2` and `tabs.drop` hears `s1`.
GIVEN the model asked main to activate `s2` WHEN the notice selecting `s2` arrives THEN it places nothing and `activateInMain` was called once.

Tests:
- `sessions-page-model.test.ts`, `describe('sessions page model')`, over a fake `SessionsPageModelView` whose panes
  hold a `PaneTree` changed through `shared/page/pane-tree` (`leafIds`, `closePane`), whose `tabs` hold no tabs and
  record `drop` ids, and whose list holds no keys; `readRows` and `readSelection` read test-held values;
  `activateInMain` records its ids and resolves the state it was given:
  - `'places the saved panes at ready and settles the restore after its microtask'`: `savedSplit('a')`, rows
    `hostRow('s1')`, `hostRow('s2')`, selection `s1` → panes `{ a: 's1', b: 's2' }`, `restores.track` called once;
    after `await settle()`, the tracked promise has resolved and `active.get()` is `'s1'`.
  - `'publishes nothing for a rowless selection until the notice that settles it'`: `savedSplit('b')`, rows `s1`,
    `s2`, selection `s2`, `ready`, `await settle()` → `active.get()` is `'s2'`; `applyNotice` with rows `s1` only and
    selection `s2` → one pane, showing `s1`, and after `await settle()` `active.get()` is still `'s2'`; `applyNotice`
    with selection `s1` → after `await settle()` `active.get()` is `'s1'`.
  - `'empties nothing and loads the next row into the last pane when its row leaves'`: one pane on `s1`, rows `s2`
    only with selection `s2` → the pane shows `s2`; `drop` heard `['s1']`.
  - `'places nothing for the echo of its own activate'`: `savedSplit('a')` placed at `ready`; the fake focuses `b`, then
    `paneFocused('b')` → `activateInMain` heard `['s2']`; the notice selecting `s2` → focused pane still `b`, panes unchanged.
- `start.test.ts` (sessions) passes unchanged but for its fixture import: it is the net for the move.

Done when: compiles; `npm test` runs `sessions-page-model.test.ts` and passes it with `start.test.ts`,
`sessions-view.test.ts`, `pane-sessions.test.ts` and `session-tabs-view.test.ts`;
`grep -n -E "document\.|window\.|shared/page/dom" src/plugins/sessions/page/sessions-page-model.ts` prints nothing;
the precondition grep for the closure state in `start.ts` prints nothing; `AGENTS.md`'s `sessions/` entry names the
page model (`sessions-page-model.ts`: the page's state and how a rows or selection notice applies to the panes).

Commit: one commit for the group: "Sessions: the page's state and apply move into a DOM-free page model (follow-up
L551)".

## Proof
