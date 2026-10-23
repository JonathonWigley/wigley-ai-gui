# 06 — Page views by source id, `addView` and `openDoc`

Status: not started
Type: Task
Wave: 4 · Depends on: 05
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/docs/contract.ts` · `src/plugins/docs/page/docs-view.ts` · `src/plugins/docs/page/start.ts` ·
           `src/plugins/docs/main/start.ts` (the `docs.openDoc` drive action) · `src/plugins/docs/main/selftest-script.ts`
           test `src/plugins/docs/main/start.test.ts`
Consumes:  `DocsChannel.invoke.loadIndex(sourceId)`, `rebuildIndex(sourceId)`, `SourceRead` ← 05
Produces:  in `src/plugins/docs/contract.ts`:
           `export interface DocsViewHandle { element: HTMLElement; shown(): void; hasUnsavedEdits(): boolean; dispose(): void }`
           `export interface DocsPageExports { addView(sourceId: string, options: { isVisible(): boolean }): DocsViewHandle; openDoc(path: string, line?: number): void }`
           `DocsChannel.messages.openDoc: { path: string; line: number | null }`
           in `src/plugins/docs/page/docs-view.ts`: `DocsViewDeps.sourceId: string` (replacing `source`),
           `DocsView.openDoc(path: string, line: number | null): void`
           the docs page part's `exports: DocsPageExports`; the drive action `docs.openDoc` (`{ path: string; line?: number }`)
Decisions: `addView` returns one element holding the split (design review: depth) plus `hasUnsavedEdits()` (the
           session tab's close guard) · `openDoc` shows Docs mode and opens there, refusing an unlisted path with a
           toast (round 1) · the view's first show runs `load`, then `rebuild` when `canRebuild` (round 2 notice) ·
           the drive action reaches the page through a channel message (decided while planning)

## Behaviour

- **docs-view.ts**:
  - `DocsSource`, `sourceRun` and the machine read at creation go.
  - Every view starts with the status `Not read yet`. Its first show runs `loadIndex(sourceId)` with the busy line
    `Reading the docs index…`, and when that read's `canRebuild` is true, `rebuildIndex(sourceId)` with
    `Rebuilding the docs index…`. `rescan`, and every re-run after a create, rename or trash (`applyDocChange`,
    `outsideChange`, today's `runSource`), runs `rebuildIndex` with `Rebuilding the docs index…`, since only a
    build lists a new file.
  - Today's `source.type` checks (lines near 248, 443, 508, 632, 741) become `sourceId === 'machine'`: the
    machine view keeps the context folder, `contextChoices` and the picker; every other view uses its document's
    single context, toasts `A session's Docs tab uses the session's own load states` on `c` as today, and does
    nothing in `outsideChange` before its first read. The machine view now also does nothing in `outsideChange`
    before its first show, since it no longer reads at creation.
  - Each result logs `<title> read: <n> entries` (a load, or a `rebuildIndex` whose `canRebuild` is false) or
    `<title> rebuilt: <n> entries` (a `rebuildIndex` whose `canRebuild` is true), or
    `<title>: <message>`, the title from the `SourceRead`. A rejection logs `<sourceId>: <error>`, since no title
    came back.
  - The pending-change settling (`settledSeq`) and the stale-result guard work as today.
  - `openDoc(path, line)` waits until the view's first read has settled (resolved or rejected), then runs today's
    `followFile(path, line, null)`. That path toasts `Not an indexed doc: <path>` for an unlisted path and selects
    the entry's row.
- **page/start.ts**:
  - The session-tab block becomes an internal `addView(sourceId, options)`. Each view gets a unique `viewId`
    (`view:<n>`; the machine view stays `machine`). It builds the split from `SESSION_TREE_SPLIT` with `stateKey`
    `'sessionTree'`, as today, holds `{ view, split, isTreeHidden, isVisible }` in one map of added views, and
    returns the handle. `shown()` does today's tab `shown` body; `dispose()` removes the view from the map and
    disposes it.
  - `activeView`, `isTreeHiddenIn`, `toggleTree`, `closeOverlaysBesides` and change propagation read that map, so
    every added view gets the session tab's keys and `Space v t`.
  - `sessions.sessionAdded` calls `addView('session:<sessionId>', { isVisible: () => handle?.isVisible() === true })`
    and passes the handle's `element`, `shown` and `hasUnsavedEdits` (inside today's `beforeClose`) to `addTab`.
    `sessionRemoved` disposes it.
  - `openDoc(path, line)` shows Docs mode when it is not shown (`mode.show()`), then calls
    `machineView.openDoc(path, line ?? null)`.
  - The `openDoc` channel message calls the same `openDoc`.
  - `start` returns `exports: { addView, openDoc }`.
- **main/start.ts**: the drive action `openDoc`, args `{ path: string; line?: number }`, description
  `Shows Docs mode and opens the doc at path (line 1-based), or toasts that the machine index does not list it.` It
  waits for `started`, then sends the `openDoc` message with `line ?? null` and returns `{}`.
- **selftest-script.ts**: lines 46 and 190's `[docs] index rebuilt: <n> entries` become
  `[docs] machine index rebuilt: <n> entries`, with the counts unchanged. Lines 301 and 343, and forms line 416, keep
  their text: the session title is `session index`.

GIVEN the drive action `docs.openDoc` with a path the machine index lists WHEN it runs THEN the channel sends
`openDoc` with that path and `line: null`
GIVEN docs main started WHEN the drive action runs before the fixture write has settled THEN it waits for `started`

Tests:     `start.test.ts`: `driveOpenDoc_SendsOpenDocMessage`, `driveOpenDoc_WaitsForStart` · the view and page
           start have no unit harness (DOM); their paths are covered by the self-test lines above and task 08
Done when: `npm run typecheck` (green again for the whole tree), `npm run lint` and the tests above pass
Commit:    one commit for the group

## Proof
