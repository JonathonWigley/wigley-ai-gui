# 06 — Grouped side bar wiring, commands and keys

Status: done
Type: Task
Wave: 3 · Depends on: 02, 03, 04, 05
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/sessions/page/sidebar-view.ts` · modify `src/plugins/sessions/page/sessions-view.ts` ·
           modify `src/plugins/sessions/page/start.ts` · modify `src/plugins/sessions/page/preview.ts` ·
           modify `src/plugins/sessions/manifest.ts` · modify `src/plugins/keymap.ts` ·
           modify `src/plugins/sessions/main/selftest-script.ts` · modify `src/plugins/sessions/page/sessions-view-fakes.ts` ·
           test `src/plugins/sessions/page/sessions-view.test.ts` (create when absent) · test every existing test that
           reads side bar rows and breaks once rows nest in sections (`sessions-parts.test.ts`, `preview.test.ts` among them)
Consumes:  `SessionRow.project` ← 02 · `createDragReorder`, `DragReorder`, `ReorderDrop` ← 03 ·
           `sidebarSections`, `drawnRows`, `createSessionRecency`, `createProjectFavorites` ← 04 ·
           `SessionsParts.section`, `SessionsParts.group`, `DrawnGroup`, `SectionInput`, `GroupInput`, `sessionsPartsSetup` ← 05
Produces:  commands `favoriteProject`, `moveProjectUp`, `moveProjectDown` in `src/plugins/sessions/manifest.ts`
           `orderedRows(): SessionRow[]` on `interface SessionsView` in `src/plugins/sessions/page/sessions-view.ts`
Decisions: step keys follow drawn order (Decided) · recency from arrival and needs you, never a pick (round 2) ·
           keys `<Leader>pf` / `<Leader>pk` / `<Leader>pj`, group `projects` (correction round) · labels shown only while
           a favorite shows (Decided) · star click toggles (Decided) · the header is the drag source; empty sections
           become drop targets during a drag; the side bar holds redraws during a drag; the preview never touches the
           user's favorites (plan read)

- **start.ts** creates `createSessionRecency(api.services.clock, uiState)` and `createProjectFavorites(uiState)`
  and hands both to `mountSessionsView`.
- **sessions-view.ts** computes `sidebarSections(state.rows, favorites.list(), recency.stamps())` in
  `drawSidebar` and hands the sections to the side bar. `render` calls `recency.noteArrived` for each added row,
  then `recency.keepOnly` with the rows main holds. `setActivity`, when the top activity changed to one whose
  word and tone equal `NEEDS_YOU_ACTIVITY`'s and the session has a row in the state, calls `recency.noteNeedsYou`
  (a needs you set before the row arrives is covered by the arrival stamp). `orderedRows()` returns `drawnRows`
  of the same sections. The preview draws its sample through `sidebarSections` with its own constant favorites
  `['wigley-ai-gui']` and an empty stamps map; while the preview shows, the star and drops do nothing.
- **sidebar-view.ts** `render` draws both `section`s every time — `Favorites` with drop hint
  `Drop a project here to favorite it`, `Recent` with `Drop a project here to unfavorite it`, `isEmpty` when it holds
  no groups — a `group` per project into its section's `groups`, and its rows into the group's `rows` through the
  existing `drawRow`. It sets `has-favorites` on the `rows` box while Favorites holds a group. `disposeRows`
  disposes rows, then groups, then sections, and calls `dragReorder.clear()`.
  It holds one `createDragReorder` for the page load: each group is an item (`element` the group, `source` its
  `header`, key its project) in zone `favorites` or `recent`; each section's `groups` box is a zone, `favorites`
  `ordered: true`, `recent` `ordered: false`. `started` sets `is-reordering` on the `rows` box and `ended`
  clears it. While `isDragging()`, a render is held and runs once on `ended`, so a state arriving mid-drag cannot
  remove the dragged header. The star's click and a drop call back into the view, which owns what they mean:
  - star → `favorites.toggle(project)`, redraw, log `favorited <project>` or `unfavorited <project>`; a group whose
    `favoriteToggle` is null has no click target (the keys still work)
  - drop in `favorites` → `favorites.place(project, index, shownFavorites)`, `shownFavorites` being the Favorites
    section's projects as drawn, dragged one included (`place` leaves it out when counting); redraw; log
    `moved <project> to favorites <index>`
  - drop in `recent` of a favorite → `favorites.remove(project)`, redraw, log `unfavorited <project>`; of a recent
    group → nothing
  `hasOtherSession` reads the drawn order.
- **start.ts** `stepToSession` steps over `{ ...state, rows: view.orderedRows() }`, so `⌥⇧O` / `⌥⇧I` follow the drawn
  order. New commands act on the focused pane's session's project, like `renameSession`: mode hidden → log
  `projects ignored: Sessions mode is hidden`; no session → log `no session for projects`. `favoriteProject` logs as
  the star does. `moveProjectUp` / `moveProjectDown` call `favorites.move(project, -1 | 1, shownFavorites)` and log
  `moved <project> up` / `moved <project> down`, `<project> cannot move up` / `<project> cannot move down` at the
  edge, and `<project> is not a favorite` for a non-favorite. Each change redraws the side bar.
- **manifest.ts** — labels `favorite or unfavorite the project`, `move the project up`, `move the project down`,
  group `projects`, `runsIn: 'page'`. **keymap.ts** — `groups` gains `'<Leader>p': 'projects'`; binds
  `<Leader>pf` → `sessions.favoriteProject`, `<Leader>pk` → `sessions.moveProjectUp`, `<Leader>pj` →
  `sessions.moveProjectDown`, each `scope: 'any'`, in the sessions banner section.
- **sessions-view-fakes.ts** — `drawnRows(sideBar)` finds every `session-row` under `session-sidebar`, in drawn
  order, so the tests that read rows keep working; fix each existing test this breaks, asserting the drawn order.
- **selftest-script.ts** — a group `projects` (`why`: favorites toggle and reorder by key, and the side bar draws
  sections) after the rename group, reusing the script's fixture sessions (`panes-a`, `panes-b`, `panes-c`, each its
  own project, since no fixture folder is a clone) with no new folders. panes-a is focused after the rename
  group: `<Leader>pf` → `[sessions] favorited panes-a`; `<Leader>pk` → `[sessions] panes-a cannot move up`;
  `<Leader>pj` → `[sessions] panes-a cannot move down`. Then focus a second session with the pane keys the script
  already uses, read off the pane tree the earlier groups leave, and `<Leader>pf` → `favorited <it>`;
  `<Leader>pk` → `moved <it> up`, with a `screenshot` `project-groups` on that step; `<Leader>pf` →
  `unfavorited <it>`; focus panes-a, `<Leader>pf` → `unfavorited panes-a`, so the script ends with no favorites.

GIVEN rows in alpha and gamma, favorites [gamma] WHEN the view renders THEN `orderedRows()` lists gamma's rows first
GIVEN rows a1 (alpha, arrived first) and b1 (beta, arrived second) WHEN `setActivity(a1, 'forms', NEEDS_YOU_ACTIVITY)` THEN `orderedRows()` lists a1 first; WHEN the user then activates b1 THEN the order is unchanged
GIVEN the preview shows WHEN its star is clicked THEN the saved favorites are unchanged
Tests:     `sessions-view.test.ts` — `sidebarOrderFollowsFavoritesAndNeedsYou`, one table over the three GIVENs through
           `sessionsViewSetup` · the self-test group above
Done when: compiles; lint passes; the test gate runs the tests above; `npm run selftest -- --plugin sessions` passes
Commit:    one commit for the group

## Proof

Commit 9126f731 · proof: diff read; the three commands and orderedRows present; compile clean; the worker's lint clean, sessions self-test 6 of 6 with its project-groups capture read · concerns: no real mouse drag has run; a plugin re-setting needs you after a reload re-stamps that row, so a reload may reorder it; rows added in one state can straddle a millisecond; a lost dragend freezes the side bar until the next drag
