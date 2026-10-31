# 05b — Sessions panes

Status: not started
Type: Task
Wave: 3 · Depends on: 01, 02, 03, 04, 05a
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/sessions/manifest.ts` · modify `src/plugins/keymap.ts` · modify `src/plugins/sessions/page/start.ts` · modify `src/plugins/sessions/page/sessions-view.ts` · modify `src/plugins/sessions/page/session-tabs-view.ts` · modify `src/plugins/sessions/page/sidebar-view.ts` · modify `src/plugins/sessions/page/tabs.ts` (`hasOtherSession` only) · modify `src/plugins/sessions/page/layout/sessions-parts.ts`, `layout/read-sessions-layout.ts` · modify `src/plugins/sessions/layouts/layout.d.ts`, `layouts/default/layout.js` · modify `src/plugins/sessions/page/sessions.css` · modify `src/plugins/sessions/page/preview.ts` (row input only) · modify `src/plugins/sessions/main/start.ts` and create `src/plugins/sessions/main/selftest-script.ts` (the self-test, registered as forms registers its script) · test `layout/sessions-parts.test.ts`, `layout/read-sessions-layout.test.ts`, `preview.test.ts`, `tabs.test.ts`

Consumes:  `OuterPanes`, `PaneDirection`, `api.panes.setOuterPanes(panes: OuterPanes | null)` ← 01
           the `any` binds of `panes.focus*` ← 02
           `createPaneTreeView(options: PaneTreeViewOptions): PaneTreeView`, `SplitAxis`, `PaneTree`, `parsePaneTree(value: unknown): PaneTree | null`, `leafIds(tree: PaneTree): string[]` ← 03
           `SessionTabView.icon` ← 04
           `PaneSessions`, `activationTarget`, `shownElsewhere`, `panesToClose`, `pickerRows`, `restorePanes`, `stepSession(state, step, skip)` ← 05a

Produces:  sessions commands, each `runsIn: 'page'`, group `panes`, with these labels:
           `splitDown` `split the pane, new pane below` · `splitRight` `split the pane, new pane right` · `closePane` `close the pane` ·
           `swapPaneLeft` `swap with the pane on the left` · `swapPaneRight` `swap with the pane on the right` · `swapPaneUp` `swap with the pane above` · `swapPaneDown` `swap with the pane below`
           binds in `src/plugins/keymap.ts`, scope `any`: `<A-'>` splitDown · `<A-;>` splitRight · `<A-w>` closePane · `<C-A-h>` swapPaneLeft · `<C-A-j>` swapPaneDown · `<C-A-k>` swapPaneUp · `<C-A-l>` swapPaneRight
           in `layout.d.ts`: `SessionRowInput.onScreen: boolean`; a `pane` part `pane?(parent: HTMLElement, input: PaneInput, kit: PaneKit): PanePart` with `PaneInput { isFocused: boolean; edges: PaneDirection[] }`, `PanePart extends SessionsPart { body: HTMLElement }`, and `PaneKit extends SessionsKit { focusEdge(parent: HTMLElement, direction: PaneDirection): HTMLElement }`; `TabBarKit` gains `splitRightHint`, `splitDownHint` and `closePaneHint`, each `(parent: HTMLElement) => HTMLElement`
           uiState key `panes` in the sessions scope: `{ tree: PaneTree; sessions: Record<string, string | null> }` (pane id → host session id)

## Decisions

**Where state lives.**
- The page part owns the pane view (03) and a `PaneSessions` map (05a). Main does not change.
- The side bar's selected row, the title bar context, `exports.selectedSessionId()` and the
  `activeChanged` event all follow the focused pane's session, null for an empty pane.
  `activeChanged` is emitted when that session changes, not when main's selection changes.
- `stepToSession` calls `stepSession` with `{ ...state, selectedSessionId: <focused pane's
  session> }`, so an empty focused pane steps from no selection.
- The visible tab is the focused pane's session's selected tab while the mode shows. `checkVisible`,
  `isVisible` and `shown` follow it. A focus change between panes runs `checkVisible`; an empty
  focused pane sets scope `idle`.

**Tab frames.** `session-tabs-view.ts` gives each session its own frame: its tab bar (the
`tabBar` part, drawn once per session) over its body. A frame shows in the body of the pane that
holds its session. A frame that no pane holds waits in a hidden holder, as an unrowed session's
body waits today. Moving a frame between panes moves the same element; never rebuild a tab's
element. The empty text draws in an empty pane's body (`NO_SELECTION_TEXT`), or in the only pane
when there are no rows (`EMPTY_TEXT`). `NOTHING_OPEN_TEXT` draws in a frame with no tabs.

**Pane frames.** The pane view's slot for each pane holds the layout's `pane` part. `isFocused` is
true for the focused pane when two panes or more exist. `edges` lists the directions where the
focused pane has a neighbour (`paneToward`), and is empty on other panes. The default layout draws
the frame with class `session-pane` (`is-focused` when focused), and draws `kit.focusEdge` for each
edge. `focusEdge` draws one edge prompt, built with `keyEdge` and `keyChevron` from
`src/shared/page/ui/key-anchors.ts`. It holds the focus key (`panes.focus<Dir>`) and the swap key
(`sessions.swapPane<Dir>`), with the chevron toward the direction, and anchors both with no scope.

**Tab bar controls.** The default `tabBar` draws, after `closeHint`, three icon buttons:
`split-horizontal` (runs `sessions.splitRight`), `split-vertical` (runs `sessions.splitDown`),
`close` (runs `sessions.closePane`). Each holds its key as a control hint (DESIGN.md § Keys and
focus). The kit builds them as `splitRightHint`, `splitDownHint` and `closePaneHint`. In every
frame that is not in the focused pane, the view sets `is-no-target` on the tab bar's prompts
(previous and next tab, close) and on these three hints, since their keys act on the focused pane
only. A click on a control in an unfocused pane focuses that pane first, then runs the command.

**Focus border.** `pane-tree.css` (03) draws the focused pane's border. `sessions.css` draws
nothing for `.session-pane.is-focused`: the class is there for user layouts.

**Side bar rows.** `onScreen` is true for a row shown in an unfocused pane. The default layout adds
class `is-on-screen`, and `sessions.css` draws it as a 1px inset ring in `var(--wg-border-strong)`.

**Activation.**
- `exports.activate(S)` places S at once: `activationTarget` → focus that pane, or load S into the
  focused pane (its old session's frame goes to the holder). When S differs from the selected id
  of the last state main sent, it records S in a `pendingEchoes` queue. Then it invokes main's
  `activate`. When the invoke fails, it clears the queue.
- `apply(next)`, for every state, changed selection or not: when the selected id equals the first
  pending echo, remove that echo and leave the panes as they are. Otherwise, when the selected id
  changed, place it with `activationTarget` the same way. This covers main's own selections (an
  `open` that selects, a `mark` with none selected).
- Main's fallback pick: when the state that removes the previously selected session also selects
  another row, and two panes or more remain after the removed panes close, do not place main's
  pick. Call `exports.activate` for the focused pane's session instead (none when that pane is
  empty). With one pane left, place main's pick into it, as today's single view shows the next row.
- A focus change to a pane with a session that main does not hold as selected calls
  `exports.activate` for it.
- A side bar click runs `exports.activate`, as it does today, then `mode.picked()`.
- `stepToSession` passes `shownElsewhere(panes, focusedPaneId)` as `skip`. `hasOtherSession`,
  which hides the side bar's step prompts, takes the same set.

**Commands.** Each pane command, run while Sessions mode is hidden, logs
`pane keys ignored: Sessions mode is hidden` under `sessions` and does nothing.
- `splitDown` / `splitRight` split the focused pane (`column` / `row`) with a new pane id and focus
  the new pane. A refused split (03) logs `pane too small to split`. A split logs
  `pane split down` or `pane split right`, then opens the picker.
- The picker is one `createListPicker` (`src/shared/page/list-picker.ts`) owned by the page part,
  title `Show session`. Its items are `pickerRows` (label: the row's label), then one
  `New session` item when `commands.exists('chat.newSession')`. Choosing a row loads it into the
  new pane, logs `pane loaded <label>`, then calls `exports.activate`. Choosing `New session` runs `chat.newSession` and keeps
  the empty pane focused, and main's selection of the started session then loads it (the
  `apply` path). `cancelled`: when the new pane still holds no session, close it and log
  `split cancelled`.
- `closePane` closes the focused pane and logs `pane closed`. With one pane it does nothing and
  logs `last pane stays`.
- `swapPane<Dir>` runs `swap`; it logs `panes swapped` on success and `no pane <dir>` otherwise.
- A focus change logs `pane focused <label>`, or `pane focused empty` for an empty pane.

**Session leaves.** In `apply`, before the tabs drop, close each pane in `panesToClose` for the
removed ids. The last pane never closes: it takes main's pick (Activation, above), or stays empty
when main selects none.

**Outer panes.** In the mode's `shown`, call `api.panes.setOuterPanes(paneView.outer)`; in
`hidden`, call `api.panes.setOuterPanes(null)`.

**Persistence.** After each `changed(tree)` and each assignment change, write uiState `panes`:
the tree, and each pane's session as its row's `hostSessionId` (null for an empty pane or a row
with none). On the first `apply`, read it once. Parse it with `parsePaneTree` and map it with
`restorePanes`. Restore the tree, then close each pane that maps to null. When nothing valid is
saved, or no saved pane maps to a session, start one pane holding main's selected session. When the restored focused pane's session
differs from main's selection, call `exports.activate` for it.

## Behaviour

GIVEN panes p1 (s1, focused) and p2 (s2) WHEN the user clicks the s2 row THEN p2 takes focus and p1 still shows s1
GIVEN panes p1 (s1, focused) and p2 (s2) WHEN the user clicks the s3 row THEN p1 shows s3 and s1 goes off screen
GIVEN panes p1 (s1, focused) and p2 (s2) and rows s1–s3 WHEN `Alt+Shift+o` runs THEN p1 shows s3
GIVEN a split picker open over a new pane WHEN the user presses Esc THEN the new pane closes and focus returns to the pane it came from
GIVEN panes p1 (s1) and p2 (s2) WHEN s2's row closes THEN p2 closes and p1 takes the space
GIVEN the page sent `activate(s2)` then `activate(s3)` WHEN main's state with s2 selected arrives THEN the panes do not change
GIVEN panes p1 (s1, focused) and p2 (s2), rows s1, s3, s2 WHEN s1's row closes and main selects s3 THEN p1 closes, p2 keeps s2 and takes focus
GIVEN one pane showing s1, rows s1, s2 WHEN s1's row closes and main selects s2 THEN the pane shows s2
GIVEN a saved layout of two panes on host ids h1 and h9 WHEN the page loads with rows for h1 only THEN one pane shows h1's session

## Tests

- `read-sessions-layout.test.ts` and `sessions-parts.test.ts`: add rows for the `pane` part and the
  three tab bar hints in the existing tables (a layout missing `pane` falls back to `default`).
- `preview.test.ts`: the preview rows carry `onScreen: false`.
- `tabs.test.ts`: add one `hasOtherSession` row with a skip set.
- The rules behind the behaviour lines are pinned by `pane-sessions.test.ts` (05a) and
  `pane-tree.test.ts` (03). The wiring earns self-test steps:
- Self-test (`src/plugins/sessions/main/selftest-script.ts`, groups with a `why` each): connect
  three fixture sessions with `DRIVE_SESSION_DEFAULTS`, with project dirs `panes-a`, `panes-b` and
  `panes-c`, in that row order, `panes-a` selected. Each label below is the row label the session
  list gives that project dir; read it from `session-list.ts` and write the literal in the expect.
  Group `split and pick` (why: a split opens the picker and loads the chosen session): `<A-;>`
  expects `pane split right`; Enter expects `pane loaded <panes-b label>`; screenshot
  `panes-side-by-side`. Group `focus and swap` (why: smart-splits focus reaches chat panes and swap
  moves the session): `<A-h>` expects `pane focused <panes-a label>`; `<C-A-l>` expects
  `panes swapped`. Group `stacked resize` (why: vertical dividers resize): `<A-'>` expects
  `pane split down`; Enter expects `pane loaded <panes-c label>`; `<A-S-j>` runs with no log
  expect (the step waits on its screenshot); screenshot `panes-stacked`. Group `cancel and close`
  (why: Esc undoes a split and Alt+w closes only the pane): `<A-;>` expects `pane split right`;
  Esc expects `split cancelled`; `<A-w>` expects `pane closed`; the group's result check (in
  `problems`, as forms' script checks main's state) fails unless main still holds all three
  sessions. The end-of-run unplaced-key check covers every new bind.

Done when: `npm run typecheck`, `npm run lint` and `npm run selftest` pass; the test gate runs the
tests above.
Commit:    one commit for the group

## Proof
