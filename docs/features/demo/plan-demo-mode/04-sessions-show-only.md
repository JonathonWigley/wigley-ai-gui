# 04 — Sessions showOnly

Status: not started
Type: Task
Rung: hard · adds `showOnly`, which 07 and 10 consume, and changes the side bar's drawn rows, cursor, step keys and post-close selection
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:
- modify `wigley-ai-gui/src/plugins/sessions/contract.ts`
- modify `wigley-ai-gui/src/plugins/sessions/page/sidebar-order.ts`
- test `wigley-ai-gui/src/plugins/sessions/page/sidebar-order.test.ts`
- modify `wigley-ai-gui/src/plugins/sessions/page/sessions-view.ts`
- test `wigley-ai-gui/src/plugins/sessions/page/sessions-view.test.ts`
- modify `wigley-ai-gui/src/plugins/sessions/page/start.ts`
- test `wigley-ai-gui/src/plugins/sessions/page/start.test.ts`

Consumes: `SidebarSection` (`sessions/contract.ts:569`), `SessionsPageExports` (`:655-685`), `sessionsClaimedSlot` (`:759`), `sidebarSections` and `drawnRows` (`sessions/page/sidebar-order.ts`), `realSections`, `drawSidebar`, `publishClaimed` and `orderedRows` (`sessions/page/sessions-view.ts:296, 384, 366, 617`) — all in the tree now.

Produces:
- `SessionsPageExports.showOnly(sectionId: string): Disposable` in `wigley-ai-gui/src/plugins/sessions/contract.ts`
- `SessionsView.showOnly(sectionId: string): Disposable` in `wigley-ai-gui/src/plugins/sessions/page/sessions-view.ts`
- `export function onlySection(sections: SidebarSections, registered: readonly SidebarSection[], sectionId: string): SidebarSections` in `wigley-ai-gui/src/plugins/sessions/page/sidebar-order.ts` (`SidebarSections` is the `{ favorites, recent, plugins }` type `sidebarSections` returns)

## Decisions

- **Contract comment.** Add to the `SessionsPageExports` comment (`contract.ts:636-654`):
  "`showOnly`: while held, the side bar draws only that section — its header and its rows — and
  the list cursor, the next/previous session keys and the selection after a close move only
  among those rows. The latest holder wins; disposing it shows what the previous holder asked
  for, or every section. While a section shows alone, only its own `claims` decides its rows: a
  row another section also claims still draws in it. A section id no section registered gives an
  empty side bar."
- **Where the state lives.** The view owns a stack of holders. `SessionsView.showOnly` pushes a
  holder and redraws; the page export forwards to it (`start.ts` `createExports`, `:202`).
- **Stack rule.** The top holder decides. Disposing a holder below the top removes it and draws
  nothing new. Disposing the top one reveals the next one down, or every section. A second
  dispose of the same holder does nothing.
- **Only the shown section claims.** While a holder is held, every other section claims nothing:
  `realSections()` calls `sidebarSections` with `registered` filtered to the section whose
  `id === sectionId` (an empty list for an unregistered id), so a row that a lower-`order` section
  would win today (the Demo section, order 0, against auto-retro's Retro section) draws in the shown
  one. Task 10's Retro step relies on this: it holds `showOnly('auto-retro')` over the demo's
  `showOnly('demo')`, and the sample retro row, which both sections claim, draws under Retro.
- **The pure rule** `onlySection(sections, registered, sectionId)`, over the `sidebarSections`
  result computed with that filtered list: `favorites` and `recent` become empty; `plugins`
  becomes the one section with `id === sectionId`, with its rows, or with `rows: []` when the
  section is registered but claims no row now (its header draws over no rows); a `sectionId` with
  no registered section gives `plugins: []`. Today `sidebarSections` drops a plugin section that
  has no rows; `onlySection` reads `registered` so the held header still draws.
- **One source of shown sections.** `realSections()` (`sessions-view.ts:296`) applies the
  filtered `sidebarSections` call and `onlySection` while a holder is held. So `drawSidebar`, `orderedRows` (`:617`), the list's
  enter and move, the step keys (`start.ts:884` `stepToSession`) and the split picker
  (`start.ts:1030`) all follow the shown rows with no change of their own. `moveFavorite` reads
  the unfiltered sections, so a favorite keeps its place among every favorite.
- **The preview wins while it shows.** `sidebarDraw` draws the preview first, as today.
- **Post-close selection.** Main's `removeRow` (`session-list.ts:390`) already skips each row id
  in `claimed`. While a holder is held, `publishClaimed` (`:366`) publishes every row of the
  page's state that the side bar does not draw, in main's order, plus the rows it publishes
  today. Main then selects only a shown row after a close. Main is not touched. The slot keeps
  its name; its comment (`contract.ts:759`) gains: "While `showOnly` is held, also every row the
  side bar does not draw."
- **Log lines** (verbatim): `side bar shows only <sectionId>` when a holder becomes the top;
  `side bar shows every section` when the last holder goes.

GIVEN a Demo section that claims two rows, and three other rows in Recent
WHEN a host holds `showOnly('demo')`
THEN the side bar draws the Demo header and its two rows only, `orderedRows()` returns those two,
the next/previous keys move between them, and `claimed` holds the three Recent rows

GIVEN `showOnly('demo')` then `showOnly('other')`
WHEN the second holder is disposed
THEN the side bar shows only `demo`; and when the first is disposed, it shows every section and
logs `side bar shows every section`

GIVEN a row that both the Demo section (order 0) and a Retro section (order 1000) claim
WHEN `showOnly('demo')` then `showOnly('auto-retro')` are held
THEN the side bar draws the Retro header over that row; and when the Retro holder is disposed,
the row draws under Demo again

GIVEN `showOnly('demo')` while the Demo section claims no row
WHEN the side bar draws
THEN the Demo header draws over no rows

## Tests

- `sidebar-order.test.ts`: `describe('onlySection')` with one `it.each` table: held section with
  rows; held section registered with no rows; unregistered id; favorites and recent present and
  emptied.
- `sessions-view.test.ts`, built as `sessionsView_SectionAddedThenDisposed_RedrawsTheSideBar`
  (`:600`) with the fakes in `sessions-view-fakes.ts:153`:
  - `sessionsView_ShowOnly_DrawsOnlyThatSectionAndOrdersItsRows`
  - `sessionsView_ShowOnlyTwoHolders_LatestWinsAndDisposeReveals` (both log lines, a lower
    dispose draws nothing new, a second dispose does nothing)
  - `sessionsView_ShowOnly_ShownSectionKeepsARowAnotherSectionClaims`: the GIVEN above, a row both
    sections claim draws under the shown section. The break it catches is a shown section that
    loses its rows to a hidden one.
- `start.test.ts`: `showOnly_HidesRows_WritesThemToClaimed`, beside
  `addSection_ClaimsARow_WritesItToClaimed` (`:397`).

Done when: `npm run typecheck`, `npm run lint` and the tests above pass.

Commit: one commit for the group.

## Proof
