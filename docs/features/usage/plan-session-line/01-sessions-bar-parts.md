# 01 — Sessions bar parts

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/sessions/contract.ts` · rename `src/plugins/sessions/page/row-parts.ts` → `session-part-store.ts` · rename test `row-parts.test.ts` → `session-part-store.test.ts` · modify `src/plugins/sessions/page/start.ts`, `sessions-view.ts`, `sessions-view-fakes.ts`, `session-tabs-view.ts`, `layout/sessions-parts.ts`, `sessions.css` · modify `src/plugins/sessions/layouts/layout.d.ts`, `src/plugins/sessions/layouts/default/layout.js` · modify `src/plugins/agents/page/subagent-lines.ts` · test `src/plugins/sessions/page/layout/sessions-parts.test.ts`
Consumes:  none
Produces:  `export interface SessionPart` in `src/plugins/sessions/contract.ts` (replaces `SessionRowPart`; same members)
           `addBarPart(part: SessionPart): Disposable` on `SessionsPageExports` in `src/plugins/sessions/contract.ts`
           `export interface SessionPartStore` and `export function createSessionPartStore(): SessionPartStore` in `src/plugins/sessions/page/session-part-store.ts`
           `contributedParts(parent: HTMLElement): HTMLElement` on `TabBarKit` in `src/plugins/sessions/layouts/layout.d.ts`
           `tabBar(parent: HTMLElement, sessionId: string): DrawnPart<DrawnTabBar>` on `SessionsParts` in `src/plugins/sessions/page/layout/sessions-parts.ts`
Decisions: one `SessionPart` type for rows and bars (round 3) · the bar parts sit in the session's frame tab bar (round 2) · the default layout places them after `nextTabEdge` and before `closeHint` (round 2)

## Changes

- **Contract.** Rename `SessionRowPart` to `SessionPart` and update its comment: it is a part that another plugin
  draws for every session on a sessions surface. Add `addBarPart` beside `addRowPart`, with the same rules: it throws
  on a part id already added, and adding a part or disposing its `Disposable` draws the tab bars again. Update the
  `SessionsPageExports` comment.
- **Store.** Rename `row-parts.ts` to `session-part-store.ts`. `SessionRowParts` becomes `SessionPartStore`, and
  `createSessionRowParts` becomes `createSessionPartStore`. The name keeps the store apart from the `SessionsParts`
  drawer in `layout/sessions-parts.ts`, which imports it. The error text becomes `part <id> is already added`, because
  one store type now serves two surfaces. `start.ts` creates two stores: `rowParts` and `barParts`. `createExports`
  wires `addBarPart` to `barParts.add`.
- **Drawing.** `SessionsPartsDeps` gains `barParts: Pick<SessionPartStore, 'parts'>`. `tabBar` takes the session id. Its
  kit's `contributedParts` places `div.session-bar-parts` with one `div.session-bar-part` (`data-part="<id>"`) for
  each part, through the same helper as the row parts. Generalise `placeRowParts` to take the parts list, the class
  names and the log noun (`row part` / `bar part`). Keep the row behaviour exactly as it is:
  - a second call throws `tabBar placed contributed parts twice`
  - a layout that leaves the slot out gets the parts appended at the end of the bar element when any part is held
  - a part whose build throws is logged as `[sessions] bar part <id> failed: <error>` and its wrapper is removed
  - a dispose that throws is logged as `[sessions] bar part <id> dispose failed: <error>`
- **View.** `session-tabs-view.ts`: `drawBar` passes the frame's session id. `Frame` gains `sessionId`, set in
  `frameOf`. Add `redrawBars(): void` to `SessionTabsView`: for each frame, dispose
  its drawn tabs and its bar, draw the bar again, clear `scrolledTabId`, then run `draw()`. It does not touch the
  panes, the tab bodies or keyboard focus, so it needs none of the focus restore that `setLayouts` runs.
  `sessions-view.ts` takes `barParts: SessionPartStore` and calls `tabs.redrawBars()` on `barParts.onChanged`, as
  `rowParts.onChanged` redraws the side bar. Update the comments on `SessionsViewDeps` and
  `SessionTabsDeps` that name the parts.
- **Layout.** In `layout.d.ts`, `TabBarKit.contributedParts` gets a comment in the shape of `RowKit`'s. Update the
  header comment of the file: the tab bar part also places other plugins' bar parts. In `default/layout.js`, call
  `kit.contributedParts(element)` after `kit.nextTabEdge(element)` and update the header comment.
- **CSS** (`sessions.css`, read `DESIGN.md` first): `.session-bar-parts` is a flex row with `min-width: 0`,
  `overflow: hidden` and `flex: 0 1000 auto`. The large shrink factor makes the parts give up width well before the
  tab strip (`flex: 0 1 auto`) does. The line is cut hard, with no ellipsis. The close prompt and the pane controls
  keep their place at the bar's end. Put the rule after `.session-tabs-bar > * { flex: none; }`, so that it wins.
- **agents.** `subagent-lines.ts` imports `SessionPart` in place of `SessionRowPart`. Nothing else changes.

GIVEN two bar parts added WHEN a session's tab bar draws with `default` THEN the bar holds one `session-bar-parts`
with both parts in add order, each built with that session's id.
GIVEN a user `tabBar` layout that never calls `contributedParts` WHEN it draws with a part held THEN the parts holder
is the bar element's last child.
GIVEN a bar part added after the frames drew WHEN it is disposed THEN every tab bar draws again without it, and
the pane slots and the tab bodies are the same elements as before.

Tests: The existing `rowParts_*` tests in `sessions-parts.test.ts` become tables over the surface, with one row for
the session row and one row for the tab bar. Do not write copies:
- `sessionParts_DefaultLayout_BuildsEachPartInAddOrder ($surface)`: the part ids in each holder, and the build record
  with the session ids.
- `sessionParts_DrawAgain_DisposesBeforeRebuilding ($surface)`: the row surface draws again with `view.render`, and the
  bar surface with `view.tabs.redrawBars()`.
- `sessionParts_UserLayoutWithoutSlot_AppendsAtEnd ($surface)`
- `sessionParts_PartThrows_LogsAndOthersRun ($surface, $case)`: the log lines carry `row part` or `bar part`.
- `sessionParts_AddAndDispose_Redraws ($surface)`
The bar rows drive the view through `sessionsViewSetup` (extend it in `sessions-view-fakes.ts` to return `barParts`)
and `view.tabs.place` with one pane that shows session `a`. In `session-part-store.test.ts`, the renamed store tests keep
their three cases.
Done when: `npm run typecheck`, `npm run lint` and the tests above pass.
Commit:    one commit for the group

## Proof

Commit f034f08 · proof: diff read; Produces present (SessionPart, addBarPart, SessionPartStore/createSessionPartStore, TabBarKit.contributedParts, tabBar(parent, sessionId)); typecheck + lint pass; worker ran sessions+agents tests 255 pass · concerns: AddAndDispose same-element check is vacuous on the row surface; bar part build gets a session id and redrawBars runs only on add/dispose, so usage redraws in place
