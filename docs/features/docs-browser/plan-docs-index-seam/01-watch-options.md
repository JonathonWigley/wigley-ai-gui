# 01 — Files.watch takes options; docs watches one level

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/contracts/files.ts` · `src/main/files/node-files.ts` · `src/shared/memory-files.ts` ·
           `src/shared/scoped-files.ts` · `src/shared/layouts/layout-registry.ts` · `src/main/config/config-store.ts` ·
           `src/plugins/docs/main/doc-files.ts` (its `watch` only)
           test `src/main/files/node-files.test.ts` · `src/shared/memory-files.test.ts` ·
           `src/shared/scoped-files.test.ts` · `src/plugins/docs/main/doc-files.test.ts` (its `watch` describe only) ·
           `src/shared/layouts/layout-registry.test.ts` and `src/main/config/config-store.test.ts` (their watch fakes
           only: `withFailingWatch`, `withHeldReports`, and config-store's fakes near lines 726 and 750 read
           `options?.onError`)
Consumes:  none
Produces:  `export interface WatchOptions { recursive?: boolean; onError?(error: unknown): void }` in `src/contracts/files.ts`
           `watch(folder: string, onChange: (path: string) => void, options?: WatchOptions): FileWatch` on `Files` in `src/contracts/files.ts`
Decisions: an options object replaces the third `onError` argument; `recursive` defaults to true (round 2, Watch
           option shape) · docs' open-doc watch passes `recursive: false` (round 1, full scope)

## Behaviour

- `Files.watch`'s doc comment keeps today's text and adds: with `recursive: false` it reports only changes to
  entries directly in `folder`. `onError` keeps its meaning, now read from the options.
- Node adapter: `watchDebounced` passes `{ recursive: options?.recursive ?? true }` to `fs.watch`.
- Memory adapter: a watch with `recursive: false` reports a change only when its relative path holds no `/`.
- `scoped-files.ts` passes the options through with `folder` scoped as today. The layout registry and the config
  store move their `onError` callback into `{ onError }`; nothing else in them changes.
- `doc-files.ts` `watch` passes `{ recursive: false, onError }` with its existing `onError`.

GIVEN a memory watch with `recursive: false` WHEN a file in a subfolder changes THEN `onChange` is not called; WHEN a
file directly in the folder changes THEN it is called with its name
GIVEN a Node watch with `recursive: false` on a temp folder WHEN a file is written in a subfolder and then one in
the folder THEN only the folder's file is reported
GIVEN the docs watch on a doc WHEN it starts THEN it calls `Files.watch` on the doc's folder with `recursive: false`

Tests:     `memory-files.test.ts`: `watch_NotRecursive_SubfolderChangeNotReported`,
           `watch_NotRecursive_FolderChangeReported` · `node-files.test.ts`:
           `watch_NotRecursive_ReportsOnlyTheFolderOwnEntries` (create the subfolder before the watch starts, then
           write `sub/a.txt`, then `b.txt`; wait for `b.txt`'s report and assert the reports equal `['b.txt']`, so no
           fixed sleep decides the result) · `scoped-files.test.ts`:
           `watch_Options_PassedThrough` · `doc-files.test.ts`: `watch_WatchesFolderOneLevel` (through the existing watch fake that records its arguments,
           near line 929)
Done when: `npm run typecheck`, `npm run lint` and the tests above pass
Commit:    one commit for the group

## Proof

Commit 2884091 · proof: diff read: WatchOptions and watch(folder, onChange, options?) present in src/contracts/files.ts; typecheck clean · concerns: Node non-recursive watch reports a subfolder by its own name on macOS (memory adapter never does); test filters 'sub' — ride to review
