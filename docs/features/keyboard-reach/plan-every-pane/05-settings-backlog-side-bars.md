# 05 — Settings sections and Backlog homes on the core side-bar rule

Status: not started
Type: Batch
Wave: 5 · Depends on: 01
Plan: [plan.md](plan.md)

Two items sharing one rule: (a) Settings mode's sections and (b) Backlog mode's homes become the mode's side bar for
the core's area chain (Task 01), each mode giving `focusSideBar` and `focusMain`, and each list takes the side-bar
list rule of `docs/keymap.md` § Layers: `Enter` opens the cursor's item and focuses main, `l` opens it and keeps
focus in the list.

Files:     modify `src/plugins/settings/page/settings-view.ts` · modify `src/plugins/settings/page/start.ts` ·
           modify `src/plugins/settings/manifest.ts` ·
           modify `src/plugins/backlog/page/backlog-view.ts` · modify `src/plugins/backlog/page/start.ts` ·
           modify `src/plugins/backlog/page/backlog-state.ts` · modify `src/plugins/backlog/page/layout/backlog-kit.ts` ·
           modify `src/plugins/backlog/manifest.ts` · modify `src/plugins/backlog/layouts/layout.d.ts` ·
           modify `src/plugins/backlog/layouts/default/layout.js` · modify `src/plugins/backlog/layouts/default/layout.css` ·
           modify `src/plugins/keymap.ts` ·
           modify `src/plugins/settings/main/selftest-script.ts` · modify `src/plugins/backlog/main/selftest-script.ts` ·
           test `src/plugins/settings/page/settings-view.test.ts` · test `src/plugins/backlog/page/backlog-view.test.ts` ·
           test `src/plugins/backlog/page/backlog-state.test.ts`

Beyond plan.md's File Structure row for 05: the manifests (a new command and a new scope), `backlog-state.ts` (the
reducer owns what `l` and Enter do on the homes), `backlog-kit.ts` and the backlog layout files (the homes take a scope
of their own, so their key hints draw in it), and both self-test scripts. Task 08 touches the same two scripts, both
manifests and `settings-view.ts` / `backlog-view.ts` later (Wave 8).

Consumes:
- `Mode.focusSideBar?(): void` and `Mode.focusMain(): void` ← 01 (`src/contracts/plugin.ts`)
- Settings' and Backlog's `focusMain` at the `api.modes.add` site in each `start.ts` ← 01
- The core's area chain ← 01: at main's left edge (a view's `FocusTarget.move('left')` returning false) the core calls
  the shown mode's `focusSideBar` while the side bar shows and sets the area to side; from the side area Alt+l calls
  `focusMain`; with the side bar hidden it logs `no pane left`; every base scope change the core did not make resets
  the area to main.

Produces:
- `SettingsView.focusSideBar(): void` and `SettingsView.focusMain(): void` in `src/plugins/settings/page/settings-view.ts`
- `SettingsCommand` member `openKeepingFocus`; `SettingsViewDeps.isSideBarShown` removed
- Settings manifest command `openKeepingFocus: { label: 'open the section, keep focus', group: 'settings', runsIn: 'page' }`
- `BacklogView.focusSideBar(): void` and `BacklogView.focusMain(): void` in `src/plugins/backlog/page/backlog-view.ts`
- `BacklogBaseScope = 'homes' | 'list' | 'detail' | 'editor'` in `src/plugins/backlog/page/layout/backlog-kit.ts`
- Backlog manifest scope `homes: 'In the backlog homes'`
- `BacklogAction` member `{ type: 'focusHomes' }` in `src/plugins/backlog/page/backlog-state.ts`

## Cold-read rulings

Lead rulings; each overrides any line below that says otherwise.

- **The homes bind only the table below** (j k gg G l CR R C and the four scroll keys). Every other `backlog.list`
  bind — `h`, `/`, `a`, `i`, `d`, `t`, `T`, `o` — is list-only, since none has a hint in the homes.
- **Repeat `focusSideBar()` in Settings** re-sets the scope each call (today's `focusSections`); only the log is
  deduped. The test expects scopes `sections, sections, rows`.
- Add `homeKeys_PickClosesOverlayOnlyOnEnter: $command` over `open` and `toggle` with focus on the homes:
  `homePicked` called 0 times for `open`, once for `toggle`.
- **Homes header track:** `.backlog-homes > .backlog-pane` becomes `grid-template-rows: auto auto minmax(0, 1fr)`,
  ordered header, status, rows. The `layout.d.ts` comment says a user layout's `homes` part draws the `rescan` and
  `commit` hints itself.
- **Overlay over the open editor:** accept the core's side area there. The editor row's rule becomes "any Alt+hjkl
  logs `pane keys ignored: the editor is open`, except after the overlay opened over the editor, where the side area
  logs `no pane <direction>` and Alt+l calls `focusMain` (the editor)".
- **`back` stays** an action: it returns the `focusHomes` result when `focus === 'items'`, else the state; the
  existing `backlogReducer_OpenHomeThenBack_…` test stays.

## Decisions

### Shared rule for both modes

- **The view target keeps only the step out of its side bar.** Neither view's `FocusTarget` moves left into its side
  bar any more: main's left edge returns false and the core calls `focusSideBar`. Each keeps the step **out** of the
  side bar to main (Settings sections → right → rows, Backlog homes → right → main's last pane), because the list can
  hold the keys while the core's area is main: a click on a section or home, Backlog's `h`, the narrow overlay opening
  (`sideBarOpenedOver`), the mode's first `shown`. Then Alt+l asks the view, not `focusMain`. Docs' tree does the same
  (Task 04, `tree → right → doc`).
- **Each focus change logs** one line naming the pane that took the keys, only when it changed, so self-test steps can
  prove where focus went: Settings `sections focused` / `rows focused`; Backlog `homes focused` / `list focused` /
  `detail focused` / `editor focused`. (Docs already logs `tree focused` / `doc focused`.)
- **A pick in the narrow overlay** (the side bar opened over main) still closes it on Enter and on a click (`picked()`);
  `l` keeps focus in the list, so it does not call `picked()` and the overlay stays open.

### (a) Settings

- **`focusSideBar`** at the `api.modes.add` site: `() => view.focusSideBar()`. `SettingsView.focusSideBar()` is
  today's `focusSections` (closes an open filter first, `focus = 'sections'`, `setScope('sections')`,
  `setFocusTarget(focusTarget)`, the sections take DOM focus, `markCursor`). The sections cursor stays where the user
  left it.
- **`focusMain`**: `() => view.focusMain()`, today's `focusRows`. If Task 01 wired Settings' `focusMain` to a view
  member that does this already, keep 01's member under its name and point `focusSideBar`'s twin at the same shape;
  add no second member.
- **`focusTarget.move` after**: `sections` + `right` → `focusRows()`, returns true; every other move returns false.
  `rows` + `left` no longer reads the side bar: the core decides. `SettingsViewDeps.isSideBarShown` has no other
  reader (`settings-view.ts:633` only): remove it and its wiring in `start.ts`.
- **Enter on a section** (`settings.open` while `focus === 'sections'`): `openSection(sectionsCursor)`,
  `deps.sectionPicked()`, then `focusRows()`. Today focus stays in the sections.
- **`l` on a section**: new command `settings.openKeepingFocus`: while `focus === 'sections'`, `openSection(sectionsCursor)`
  only (no `sectionPicked`, focus stays); with focus on the rows it does nothing. Bound in `settings.sections` only.
- **A click on a section** keeps today's order (`focusSections`, `openSection`, `sectionPicked`): a click is a pick,
  and focus stays in the sections as it does now.
- **Log lines**: `focus` changing to `'sections'` logs `sections focused`; to `'rows'` logs `rows focused`. Log inside
  `focusSections` / `focusRows` when the value changes (a repeat call logs nothing).

### (b) Backlog

- **The homes get their own scope `backlog.homes`.** Today the homes act under `backlog.list`, so Enter from the homes
  into the list changes no base scope, and the core's area would stay `side` while the list holds the keys (Alt+l would
  call `focusMain` instead of reaching the detail, Alt+h would log `no pane left`). `scopeOf(state)` returns `'homes'`
  when `state.focus === 'homes'` and no editor is open. The homes pane, its repo headers and home rows draw with
  `kitFor('homes')`; `layout.d.ts`'s kit-scope comment names `homes` and its rows `backlog.homes`.
- **Binds in `backlog.homes`** (all already bound in `backlog.list`, same commands): `j` `backlog.listDown`, `k`
  `backlog.listUp`, `gg` `backlog.listTop`, `G` `backlog.listBottom`, `l` `backlog.open`, `<CR>` `backlog.toggle`,
  `R` `backlog.rescan`, `C` `backlog.commit`, and `<C-j>`/`<C-k>`/`<C-S-j>`/`<C-S-k>` scrolling the detail
  (`backlog.lineDown` / `lineUp` / `halfPageDown` / `halfPageUp`). `'backlog.homes'` joins the `<C-n>` →
  `chat.startNewSession` scope list in `keymap.ts`, before `'backlog.list'`. `R` and `C` are not vim keys, so the
  default layout's `homes` part draws their hints in a header line above the rows: `hint(keys, kit, 'rescan', 'rescan')`
  and `hint(keys, kit, 'commit', 'commit')` in a `div.backlog-homes-header > span.backlog-list-keys`, styled as the list
  header in `layout.css`. **Decided (lead):** `/` (filter) and `a` (new follow-up) act on the open
  home's rows and draw their hints in the list header, so they are not bound in `backlog.homes`: from the homes they
  now need Enter first. Today both work while the homes hold the keys; they become list-only, so every bind's hint sits in the scope that
  holds it, and the homes match the other side-bar lists.
- **`focusSideBar`** at the `api.modes.add` site: `() => view.focusSideBar()`. With an editor open it does nothing
  (the editor blocks the pane keys, below). Otherwise it dispatches `{ type: 'focusHomes' }`.
- **`focusHomes` (reducer)**: from `items` or `detail`, focus `homes` with `homeCursor` on the open home (index of
  `openRoot` in `orderedHomes`, else the cursor kept); from `homes` unchanged. `back` (`h`) becomes `focusHomes`
  guarded to `focus === 'items'`, as today. `h` keeps revealing a hidden side bar first (`revealSideBar`), as today.
- **`focusMain`**: `() => view.focusMain()`. The view remembers main's last pane: a `lastMainFocus: 'items' | 'detail'`
  set in `render` whenever `state.focus` is `items` or `detail` (starts `items`). `focusMain()` with an editor open
  focuses the editor's DOM again (`syncFocus(state, true)`); otherwise it dispatches `{ type: 'focus', focus:
  lastMainFocus }`, then `{ type: 'focus', focus: 'items' }` if the detail refused (no row selected), and ends with the
  DOM focus on that pane (`syncFocus` with `always`).
- **`focusTarget.move` after** (`paneTo` and the editor guard):

  | from | direction | result |
  |---|---|---|
  | editor open | any | returns true, moves nothing, logs `pane keys ignored: the editor is open` |
  | `items` | right | `detail`, true |
  | `detail` | left | `items`, true |
  | `homes` | right | as `focusMain()`, true |
  | `items` | left | false (the core: side bar, or `no pane left`) |
  | any other | — | false |

  The editor row keeps today's behaviour (the editor cannot be left by pane keys): returning false there would send
  the core on to `focusSideBar` or the right bar while the editor holds the keys.
- **`l` on the homes** (`openOrStepIn`, `focus === 'homes'`): opens the cursor home (`openHomeAt`) and keeps
  `focus: 'homes'`. **Enter on the homes** (`toggle`, `focus === 'homes'`): `openHomeAt` as today, focus `items`.
  In the view, `commands.open` no longer calls `homePicked()`; `commands.toggle` still does when it ran on the homes.
  A click on a home row stays `openHome` + `homePicked()` (focus to the list).
- **`sideBarOpenedOver`** unchanged (focus `homes` unless an editor is open); it now sets scope `homes`.
- **Log lines**: `syncFocus` logs `<pane> focused` when `shownFocus` changes: `homes focused`, `list focused`
  (for `items`), `detail focused`, `editor focused`.

### Keys pinned (`src/plugins/keymap.ts`)

Settings section: add `{ keys: 'l', scope: 'settings.sections', command: 'settings.openKeepingFocus' }`.
Backlog section: the `backlog.homes` binds listed above, beside the `backlog.list` block. `l` and every homes key but
`R` and `C` are vim keys (`src/shared/vim-keys.ts`) and need no anchor.

## Behaviour

GIVEN Settings with the side bar shown and the rows focused WHEN Alt+h THEN the core calls `focusSideBar`, the sections
take focus and `[settings] sections focused` logs; WHEN Alt+l THEN `focusMain` runs and `[settings] rows focused` logs.
GIVEN Settings with the side bar hidden WHEN Alt+h on the rows THEN `[page] no pane left` logs and focus stays.
GIVEN the sections focused WHEN Enter THEN the section opens and the rows take focus; WHEN `l` THEN the section opens
and the sections keep focus.
GIVEN Backlog's list focused WHEN Alt+h THEN the homes take focus on the open home (`[backlog] homes focused`); WHEN
Alt+l THEN main's last pane takes focus again.
GIVEN the homes focused WHEN `l` THEN the cursor home opens and the homes keep focus; WHEN Enter THEN it opens and the
list takes focus (`[backlog] list focused`).
GIVEN the list focused WHEN `h` THEN the homes take focus (kept); WHEN Alt+l then THEN the list takes focus again.
GIVEN the follow-up editor open WHEN any Alt+hjkl THEN nothing moves and `[backlog] pane keys ignored: the editor is open`
logs.

## Tests

- `settings-view.test.ts` `focusTarget_MovesBetweenSectionsAndRows` table: drop the `bar` column and the
  `isSideBarShown` dep from `shownView`; rows become `sections right → rows, moved`, `rows left → rows, not moved`,
  `sections left → sections, not moved`, `rows up`, `sections down` (not moved). Catches: the view claiming the step
  into its side bar again.
- `settings-view.test.ts` new `it.each` `sectionKeys_OpenTheSection: $command` over `open` and `openKeepingFocus` with
  focus on the sections and the cursor on the second section: both log `section <second id>`; `open` leaves
  `activeElement` on `view.sheet` and calls `sectionPicked` once; `openKeepingFocus` leaves it on `view.sideBar` and
  calls `sectionPicked` never. Catches: Enter keeping focus, or `l` closing the narrow overlay.
- `settings-view.test.ts` new `focusSideBarThenFocusMain_MovesAndLogsOnce`: from the rows, `focusSideBar()` then
  `focusSideBar()` again then `focusMain()` logs `sections focused` once then `rows focused`, the scopes set being
  `sections` then `rows`.
- `backlog-state.test.ts` `backlogReducer_OpenHomeThenBack_MovesFocusBetweenHomesAndItems`: its open step becomes
  `{ type: 'toggle' }` (Enter). New `it.each` `backlogReducer_KeyOnHomes_OpensTheCursorHome: $action` with rows
  `open → focus homes, openRoot other` and `toggle → focus items, openRoot other`, from the loaded two-home state with
  the cursor moved down. New `backlogReducer_FocusHomes_FromItemsOrDetail` table: from `items` and from `detail`
  (a row selected) → `focus: 'homes'`, `homeCursor` on the open home; from `homes` the state is unchanged.
- `backlog-view.test.ts` `moves focus $direction from the $from to scope $scope` table: `homes right` becomes
  `scope: 'list', moved: true`; add `homes left → scope 'homes', moved false`; the `sideBarOpenedOver` row of
  `$name sets the scope…` expects `['setScope', 'homes']`. New `focusTarget_EditorOpen_IgnoresEveryMove`: after
  `commands.create()`, each of the four directions returns true, sets no scope and logs
  `pane keys ignored: the editor is open`. New `it.each` `focusMain_ReturnsToMainsLastPane: $last` with rows `list`
  (after a move left back) and `detail` (after `move('right')`), each then `focusSideBar()` then `focusMain()`: the last
  `setScope` is `list` / `detail`.

## Self-test steps

`src/plugins/settings/main/selftest-script.ts`, group `side bar` (`SIDE_BAR_STEPS`); it starts with focus on the
sections and ends on the rows of Core, where `number box` starts. Append after the two existing steps:
- `{ keys: ['<A-h>'], expect: '[settings] sections focused', why: "Option+h at the rows' left edge reaches the side bar through the mode's focusSideBar." }`
- `{ keys: ['<A-l>'], expect: '[settings] rows focused' }`
- `{ keys: ['<A-h>', 'G', 'l'], expect: '[settings] section keymap' }`
- `{ keys: ['g', 'g', 'Enter'], expect: '[settings] section core', alsoExpect: [/^\[settings\] rows focused$/], why: 'l kept focus in the sections, so G and gg moved the sections cursor; Enter opens Core and focuses its rows.' }`
- `{ keys: [' ', 'k', ','], expect: '[page] side bar hidden' }`
- `{ keys: ['<A-h>'], expect: '[page] no pane left', why: 'A hidden side bar is no stop.' }`
- `{ keys: [' ', 'k', ','], expect: '[page] side bar shown' }`

and the group's `why` becomes: `Space k , hides the side bar, focusing the rows, and shows it again; Option+h and Option+l move between the rows and the sections, Enter on a section opens it and focuses the rows, l opens it keeping focus, and with the side bar hidden Option+h stays put.`
`KEYMAP_STEPS`' first step (`Escape`, `<A-h>`, `G`, `Enter` → `section keymap`) and `TIMEOUT_RESET_STEPS`' first step
stay as they are: Enter now focuses the rows, where their next keys act anyway.

`src/plugins/backlog/main/selftest-script.ts`:
- Group `open`: the step `{ keys: ['g', 'g', 'l'], expect: openedGitHome }` becomes two steps:
  `{ keys: ['g', 'g', 'l'], expect: openedGitHome }` and
  `{ keys: ['Enter'], expect: '[backlog] list focused', why: 'l opened the home and kept focus on the homes; Enter on the open home focuses its list.' }`.
- Group `outside change`: `['h', 'j', 'l']` becomes `['h', 'j', 'Enter']`. Group `commit`: `['h', 'k', 'l']` becomes
  `['h', 'k', 'Enter']`.
- New group `side bar keys`, its steps in a new `sideBarKeys` array, listed last (after `plan`, which leaves the list
  focused on Second task in the git home):
  - `{ keys: ['<A-h>'], expect: '[backlog] homes focused', why: "Option+h at the list's left edge reaches the homes through the mode's focusSideBar." }`
  - `{ keys: ['<A-l>'], expect: '[backlog] list focused' }`
  - `{ keys: ['<A-l>'], expect: '[backlog] detail focused' }`
  - `{ keys: ['<A-h>'], expect: '[backlog] list focused' }`
  - `{ keys: ['h'], expect: '[backlog] homes focused' }`
  - `{ keys: ['<A-l>'], expect: '[backlog] list focused', why: 'h left the homes holding the keys with the area at main, so the view steps out of them.' }`
  - `{ keys: ['h', 'j', 'l'], expect: \`[backlog] opened selftest-repo ${shown('wigley-features/selftest-repo')}\` }`
  - `{ keys: ['k', 'Enter'], expect: openedGitHome, alsoExpect: [/^\[backlog\] list focused$/], why: 'l kept focus on the homes, so k moved the homes cursor back to the git home.' }`
  - `{ keys: ['a'], expect: '[backlog] editor open create' }`
  - `{ keys: ['<A-h>'], expect: '[backlog] pane keys ignored: the editor is open' }`
  - `{ keys: ['Escape', 'Escape', 'Escape'], expect: '[backlog] editor closed', why: 'Esc leaves insert mode, then the box, then cancels the unchanged editor.' }`

  Group `why`: `Option+h and Option+l move between the list, the homes and the detail; h still reaches the homes and Option+l steps out of them; l on a home opens it keeping focus and Enter opens it focusing the list; the open editor ignores the pane keys.`

`[page] no pane left` is the core's line after Task 01; if 01 renames it, use 01's line.

Done when: compiles; the tests above pass; the settings self-test groups `side bar` through `disabled plugins` and the
backlog groups `open` through `side bar keys` pass in filtered runs (`--plugin settings`, `--plugin backlog`); the
placement check and runtime and visual checks are Task 10's (Final verification).
Commit:    one commit for the group

## Proof
