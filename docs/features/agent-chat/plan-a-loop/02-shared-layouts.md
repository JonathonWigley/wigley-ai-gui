# 02 — Shared layout machinery

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     create `src/contracts/layouts.ts`
           · create `src/shared/layouts/layout-registry.ts` (moved from `src/plugins/forms/main/layouts/layout-registry.ts`)
           · test `src/shared/layouts/layout-registry.test.ts` (moved from `src/plugins/forms/main/layouts/layout-registry.test.ts`)
           · create `src/shared/page/layout-loader.ts` (moved from `src/plugins/forms/page/layout/layout-loader.ts`, less `readLayout`)
           · test `src/shared/page/layout-loader.test.ts` (moved from `src/plugins/forms/page/layout/layout-loader.test.ts`, less the `readLayout` tests)
           · create `src/plugins/forms/page/layout/read-layout.ts` · test `src/plugins/forms/page/layout/read-layout.test.ts`
           · modify `src/plugins/forms/contract.ts` · modify `src/plugins/forms/main/start.ts` · modify `src/plugins/forms/page/start.ts`
           · delete `src/plugins/forms/main/layouts/` (both files) and `src/plugins/forms/page/layout/layout-loader.ts` (+test)
Consumes:  members the tree holds: `Files` (`src/contracts/files.ts`), `Log` (`src/contracts/log.ts`), `ToastTone`
           (`src/contracts/plugin.ts`), `errorText` (`src/shared/error-text.ts`), `createMemoryFiles` /
           `MemoryFiles` (`src/shared/memory-files.ts`, tests only)
Produces:  `src/contracts/layouts.ts`:
             `export interface LayoutChoice { name: string; revision: number; hasCss: boolean; builtIn: boolean;
               reason: 'start' | 'cycled' | 'reloaded' | 'copied' }`
           `src/shared/layouts/layout-registry.ts`:
             `export interface LayoutRegistry { current(): LayoutChoice; cycle(step: 1 | -1): Promise<LayoutChoice>;
               copy(): Promise<LayoutChoice>; dispose(): void }`
             `export interface LayoutRegistryDeps { data: Files; send(choice: LayoutChoice): void; log: Log;
               logSource: string; layoutTypes: string; defaultLayout: string }`
             `export function startLayoutRegistry(deps: LayoutRegistryDeps): Promise<LayoutRegistry>`
           `src/shared/page/layout-loader.ts`:
             `export interface LayoutLoaderDeps<L> { importModule(url: string): Promise<unknown>;
               dataUrl(path: string, revision: number): string; defaultLayout: L; head: HTMLElement;
               read(module: unknown, name: string): L }`
             `export interface LayoutLoader<L> { load(choice: LayoutChoice): Promise<L> }`
             `export function createLayoutLoader<L>(deps: LayoutLoaderDeps<L>): LayoutLoader<L>`
             `export function layoutUrls(choice: LayoutChoice, dataUrl: (path: string, revision: number) => string):
               { script: string; style: string | null }`
             `export interface LayoutChannel { onLayoutChanged(listener: (choice: LayoutChoice) => void): void;
               readLayout(): Promise<LayoutChoice> }`
             `export interface ShowLayoutsDeps<L> { channel: LayoutChannel; loader: LayoutLoader<L>;
               setLayout(layout: L, name: string): void; log: Log; logSource: string; dataFolderLabel: string;
               toast(text: string, tone: ToastTone): void }`
             `export function showLayouts<L>(deps: ShowLayoutsDeps<L>): void`
           `src/plugins/forms/page/layout/read-layout.ts`:
             `export function readLayout(module: unknown, name: string): Layout` (unchanged body and messages)
           `src/plugins/forms/contract.ts`: `export type { LayoutChoice } from '../../contracts/layouts';`
Decisions: a move, not a rewrite: every body keeps today's behaviour; the only changes are the ones listed here
           (plan.md File Structure; design.md Layouts: "the registry … and the loader take a plugin's data folder,
           contract text, default layout and validator as inputs")
           · **`LayoutChoice`** keeps forms' fields in forms' order. Its comment drops what is forms-only: "The
             layout a plugin's page builds with. `revision` grows on every change to a layout's files and every
             switch, so a URL holding it loads fresh modules; `builtIn` marks the `default` layout, which has no
             files in the plugin's data folder." Forms' `contract.ts` imports it for `FormsChannel` and re-exports
             it, so `../contract` imports of `LayoutChoice` keep compiling.
           · **Registry**: every `log('forms', …)` becomes `log(deps.logSource, …)` — three lines today: the
             `layouts/default is ignored…` line, `layout <folder> not reloaded: …`, `layouts watch failed: …`. The
             `data` comment reads "Scoped to the plugin's data folder." Nothing else in it names forms.
           · **Loader**: `createLayoutLoader<L>` calls `deps.read(module, choice.name)` where it calls `readLayout`
             today. `readLayout`, `CARD_KINDS` and `isRecord` stay in forms, in `page/layout/read-layout.ts`
             (forms' Layout contract is forms' own; `src/shared/page` may not import `src/plugins/forms`).
           · **`showLayouts`** moves with the loader, generic over `L`: its four `log('forms', …)` lines (`layout <n>
             shown (<reason>, revision <r>)`, `layout <n> failed: …`, `layout <n> not shown: …`, `layout not read:
             …`) use `deps.logSource`, and the copied toast reads `` `Layout copied to layouts/${choice.name} in
             ${deps.dataFolderLabel}` ``. Forms passes `logSource: 'forms'` and `dataFolderLabel: "forms' data
             folder"`, so forms' toast text is unchanged. Chat's page (task 09) is its second caller.
           · **Plan-time tree**: `showLayouts`, `LayoutChannel`, `ShowLayoutsDeps`, the registry's `OWN_WRITE_MS` /
             `LAYOUT_FILE` handling and the `quiet` presenter were uncommitted forms-layouts review fixes in the
             working tree when this was written (`git show HEAD:src/plugins/forms/page/layout/layout-loader.ts | grep
             -c showLayouts` → 0, measured at plan time, re-verify). The plan's "tree clean" precondition makes them
             committed before the run. If `showLayouts` is then still in `src/plugins/forms/page/start.ts` and not in
             the loader, the task moves it out of `start.ts` into the shared loader in the shape above.
           · **Forms wiring**: `main/start.ts` imports `startLayoutRegistry` and `LayoutRegistry` from
             `../../../shared/layouts/layout-registry` and adds `logSource: 'forms'`. `page/start.ts` imports
             `createLayoutLoader` and `showLayouts` from `../../../shared/page/layout-loader` and `readLayout` from
             `./layout/read-layout`, calls `createLayoutLoader<Layout>({ …today's fields, read: readLayout })`, and
             adds `logSource: 'forms'` and `dataFolderLabel: "forms' data folder"` to `showLayouts`.
           · **Layers**: `scripts/check-layers.mts` needs no edit. A file takes the layer of its longest matching
             path, so `src/shared/layouts/layout-registry.ts` is in layer `src/shared` (it imports `src/contracts` and
             `src/shared/error-text.ts`, both allowed) and `src/shared/page/layout-loader.ts` is in layer
             `src/shared/page` (it imports `src/contracts` and `src/shared`, both allowed). Forms' main lists
             `src/shared` and forms' page lists `src/shared/page` already; chat's layer entries (task 05) list the
             same two. plan.md's "tasks 02 (shared layouts)" on `check-layers.mts` is therefore a no-op for this task.
GIVEN forms with a user layout `alpha` active WHEN the user saves `alpha/layout.js` THEN forms' page redraws with the
      reloaded layout and the log line reads `[forms] layout alpha shown (reloaded, revision <n>)`, as before the move
GIVEN a registry started with `logSource: 'demo'` WHEN a user folder named `default` is listed, or the watch fails
      THEN the log lines are `[demo] layouts/default is ignored; the built-in default layout wins` and `[demo] layouts
      watch failed: EMFILE`
GIVEN a loader whose `read` returns a marker value WHEN it loads a user layout THEN `read` got the imported module
      and the choice's name, and `load` resolves to that marker
GIVEN `showLayouts` with `dataFolderLabel: "demo's data folder"` WHEN main reports a `copied` choice named `mine-2`
      THEN the toast is `success: Layout copied to layouts/mine-2 in demo's data folder`
Tests:     `src/shared/layouts/layout-registry.test.ts` — every test of today's
           `src/plugins/forms/main/layouts/layout-registry.test.ts` (25 cases: 18 plain `it`s plus `it.each` tables of 4 and 3
           rows, measured at plan time, re-verify), same names and assertions, its `start()` helper passing `logSource: 'demo'` and
           `LayoutChoice` imported from `../../contracts/layouts`; the two log assertions change to
           `'[demo] layouts/default is ignored; the built-in default layout wins'`
           (`start_UserFolderNamedDefault_IsSkippedAndLogged`) and `'[demo] layouts watch failed: EMFILE'`
           (`watch_Fails_LogsIt`)
           `src/shared/page/layout-loader.test.ts` — today's `layoutUrls`, `createLayoutLoader` and `showLayouts`
           describes, same names and assertions, over a test-built `interface TestLayout { tag: string }` in place of
           forms' `Layout` (`defaultLayout: { tag: 'built-in' }`, `read` returning `(module as { default: TestLayout
           }).default`); `showing()` passes `logSource: 'demo'` and `dataFolderLabel: "demo's data folder"`, and each
           expected log line's `[forms]` becomes `[demo]` (e.g. `'[demo] layout first shown (cycled, revision 2)'`,
           `'[demo] layout mine failed: broken'`, `'[demo] layout first not shown: rebuild failed'`, `'[demo] layout
           not read: not started'`); plus
           `load_UserLayout_HandsReadTheModuleAndName` — `read` records `[module, name]` and returns `{ tag: 'read' }`;
             after `load(choice(false))` over an import resolving `{ default: { tag: 'mine' } }`, the record is
             `[[{ default: { tag: 'mine' } }, 'mine']]` and `load` resolved to `{ tag: 'read' }`
           `load_ReadThrows_RejectsAndKeepsStylesheet` — after a good load with CSS (`href`
             `'url:layouts/mine/layout.css@4'`), a `read` throwing `'layout mine: cards.notice is missing'` makes
             `load({ ...choice(true), revision: 5 })` reject with that message; one link appended, `href` still
             `'url:layouts/mine/layout.css@4'`, `removed: false`
           `showLayouts_Copied_ToastsTheDataFolderLabel` — `change(named('mine-2', 'copied'))`, finished; toasts
             `['success: Layout copied to layouts/mine-2 in demo\'s data folder']`
           `src/plugins/forms/page/layout/read-layout.test.ts` — today's four `readLayout` tests, same names and
           messages (`readLayout_MissingNoticeCard_ThrowsNamingIt` → `'layout mine: cards.notice is missing or not a
           function'`, `readLayout_NoDefaultExport_Throws` → `'layout mine: the default export is missing or not an
           object'`, `readLayout_HeadNotFunction_Throws` → `'layout mine: head is not a function'`,
           `readLayout_ValidModule_ReturnsItsDefault`)
Done when: compiles; `npm run lint` passes, its layer check printing `layers: <n> files clean`;
           `test -e src/plugins/forms/main/layouts || echo gone` → `gone`;
           `grep -rln "LayoutChoice" src/plugins/forms` lists `contract.ts` and no file under `main/layouts` or
           `page/layout/layout-loader*`; `grep -rn "'forms'" src/shared` → empty; the test gate runs the tests above
           and forms' self-test (`npm run selftest`) still ends `[selftest] all passed`
Commit:    one commit for the group

## Proof

a646bb4 · diff read: every Produces present (`LayoutChoice` in `src/contracts/layouts.ts`, registry, loader, `showLayouts`, `readLayout`, forms' re-export); `npm run typecheck` and `npm run lint` pass. Concerns: `grep -rn "'forms'" src/shared` is not empty, but only because of plugin-id fixtures in `data-url.test.ts` and `event-bus.test.ts` that were there before this run; the old `showLayouts` describe held 5 `[forms]` lines, not the 4 the task named, and all 5 became `[demo]`.
