# 11 — Page loads user page parts

Status: done
Type: Task
Wave: 4 · Depends on: 04, 09, 10
Plan: [plan.md](plan.md)

Design: `docs/features/plugin-framework/design.md` § Runtime loader (Wave 4 step 3), bullets "Main imports from a
per-revision copy" and "A user plugin draws through its layout kit". The page imports `page.js` on a new
`wigley-plugin:` scheme. The scheme serves the per-revision copy that task 08 makes, so the page and main run the same
revision. The page builds its parts from the served `AppConfig.plugins`, and it answers the switch's `reload` and
`remove` requests. A page part draws a part of its layouts through its own base kit with `draw` on the show that
`api.layouts.show` returns, so a user `page.js` draws through its layout kit and never imports `src/shared`.

Files:
- modify `src/shared/plugin-url.ts` · test `src/shared/plugin-url.test.ts` (task 08 creates both)
- modify `scripts/check-layers.mts` (the `renderer.ts` entry gains the `src/shared/plugin-catalog` layer)
- modify `src/main/data-protocol/data-protocol.ts` (no test file exists; the URL rule is tested in `plugin-url.test.ts`)
- modify `index.html` (CSP and its comment)
- create `src/renderer/page-part-loader.ts` · test `src/renderer/page-part-loader.test.ts`
- modify `src/renderer/renderer.ts`
- modify `src/renderer/plugin-parts-answer.ts` · test `src/renderer/plugin-parts-answer.test.ts`
- modify `src/main/layouts/layout-service.ts` · test `src/main/layouts/layout-service.test.ts`
- modify `src/contracts/plugin.ts` (the `layouts.register` doc line, and the show's `draw`: `PageLayoutShow`,
  `DrawnLayoutPart`, the part types and `PageApi.layouts.show`'s return)
- create `src/shared/page/layout-host/owner-show.ts` · test `src/shared/page/layout-host/owner-show.test.ts` · type
  test `src/shared/page/layout-host/owner-show.test-d.ts`
- modify `src/renderer/plugins/page-api.ts` · test `src/renderer/plugins/page-api.test.ts`
- modify `src/shared/plugin-part-harness.test-support.ts` (its fake show draws through `ownerLayoutShow`)
- modify `src/plugins/workflow/page/layout/workflow-draw.test.ts` (its fake show gains `draw`, so it type-checks)

Consumes:
- `ServedPlugin` (with `manifest`, see below) and `PluginOrigin` in `src/contracts/plugin-catalog.ts` ← 08
- `AppConfig.plugins: readonly ServedPlugin[]` ← 09
- `PluginPartsRequest` `| { kind: 'reload'; id: string }` and `| { kind: 'remove'; id: string }`, and
  `PluginPartsReply` `| { reloaded: readonly string[]; problem: string | null }` in `src/contracts/bridge.ts` ← 10.
  Task 10 sends `reload` after stopping the part through `stop`, and sends `start` after `reload`.
- the `start` reply `{ started: readonly string[]; problems: readonly CatalogProblem[] }` in `src/contracts/bridge.ts`
  (it replaces `{ started: readonly string[] }`), and `page-parts.ts`' empty start reply
  `{ started: [], problems: [] }` ← 10. Task 10 records each `problems` item's `message`, verbatim, as the start
  problem of its `id`, on every page `start` it sends (launch, added, restart, reload, switch-on).
- `dependencyOrder(manifests)` in `src/shared/plugin-manifests.ts` (in the tree)
- `LayoutService`'s `OWNER` check, which task 02 changes to `new RegExp(PLUGIN_ID_PATTERN)` ← 02. This task does not
  edit that line.
- `PluginHost<Started, Part>.add(part)`, `.remove(id)` ← 03
- `PluginPartsAnswerDeps.restores` and the `start` case's `reopen` → start → `partsReady` → reapply order ← 04
- `handlerProblems(manifest, process, commands): string[]` in `src/shared/plugin-catalog/validate-manifest.ts` ← 02
- `UserPageModule` (a named `start(api)` export) in `src/contracts/user-plugin.ts` ← 08
- `PLUGIN_SCHEME` and `pluginUrl(pluginId, revision, path)` in `src/shared/plugin-url.ts` ← 08
- the `src/shared/plugin-catalog` layer rule ← 01. Task 01 lists the new layers for `main.ts` only, so this task adds
  `src/shared/plugin-catalog` to the `renderer.ts` entry in `scripts/check-layers.mts`
- in the tree: `createLayoutParts` (`layout-parts.ts`), `drawPart` and `DrawnPart` (`draw-part.ts`), `createBaseKit`,
  `ownerBaseKitDeps`, `OwnerKitServices` and `kitCommandsOf` (`base-kit.ts`), all in `src/shared/page/layout-host/`,
  and `requireDeclaredScope` (`src/shared/plugin-manifests.ts`)

Produces:
- `src/shared/plugin-url.ts` (task 08 created it with `PLUGIN_SCHEME` and `pluginUrl`; this task adds):
  ```ts
  // `<codeRoot>/<pluginId>/<revision>/<path>` joined by `paths`, the revision
  // kept as a folder (the per-revision copy); null when `url` is not a plugin URL
  // with an id and a `~<n>` revision, when the id is not one plain segment, or
  // when `decodedPathSegments` refuses the path.
  export function pluginFilePath(url: string, codeRoot: string, paths: Paths): string | null;
  ```
  `plan.md` gives `pluginFilePath(url, codeRoot)`. This task adds `paths: Paths`, as `dataFilePath` and
  `layoutFilePath` take it.
- `src/main/data-protocol/data-protocol.ts`:
  - `registerAppSchemes()` registers `PLUGIN_SCHEME` with `FILE_SCHEME_PRIVILEGES`, beside `DATA_SCHEME` and
    `LAYOUT_SCHEME`. `main.ts` already calls it before ready, so task 13 adds no call for registration.
  - `export function servePluginScheme(codeRoot: string, paths: Paths): void`, built through `serveFiles` as
    `serveDataScheme` is. Task 13 calls it beside `serveDataScheme`, with `codeRoot` set to the `plugin-code` folder
    that task 08's user-folder source copies into.
- `src/renderer/page-part-loader.ts`:
  ```ts
  export interface PagePartLoaderDeps {
    builtIns: readonly PagePart[];             // the static `pageParts`
    importModule(url: string): Promise<unknown>;
  }
  // The page part `plugin` runs: the built-in part of that id for origin
  // `built-in` (null when the built-in has no page part); for `user` and
  // `replaces-built-in`, null when `pageUrl` is null, else the module at
  // `pageUrl` paired with `plugin.manifest`. Rejects with
  // `page.js of <id> exports no start function` when the module has no
  // function `start`, and with the import's own error when it fails.
  export function loadPagePart(plugin: ServedPlugin, deps: PagePartLoaderDeps): Promise<PagePart | null>;
  // The ids of `plugins` that have a page part: a `built-in` whose id
  // `builtIns` holds, or a non-built-in whose `pageUrl` is not null (a page.js
  // that failed to load included). In `dependencyOrder` over the served
  // manifests. A main-only plugin is never in the list.
  export function pagePartIds(plugins: readonly ServedPlugin[], builtIns: readonly PagePart[]): string[];
  // The ids the page starts after load, one at a time: every id whose origin
  // is not `built-in`, and every id that depends on one of those through
  // `dependsOn.page`, repeated until the set stops growing. In
  // `dependencyOrder` over the served manifests, so a dependency comes before
  // its dependent.
  export function deferredPageIds(plugins: readonly ServedPlugin[]): string[];
  // Runs `start(part)`. For an origin that is not `built-in`, it then calls
  // `handlerProblems(part.manifest, 'page', started.commands)`, and throws
  // `Error('<id>: ' + problems.join(', '))` when the list is not empty, before
  // it returns, so the caller registers no handler of the part.
  export function startCheckedPart<S extends { commands: object }>(
    part: PagePart,
    origin: PluginOrigin,
    start: (part: PagePart) => S,
  ): S;
  ```
- `PluginPartsAnswerDeps` (in `plugin-parts-answer.ts`) gains:
  `served(): AppConfig` (the last push) and `loadPart(plugin: ServedPlugin): Promise<PagePart | null>`.
  The host parameter becomes `Pick<PluginHost<unknown, PagePart>, 'started' | 'start' | 'stop' | 'mayStop' | 'add' | 'remove'>`.
  Also add `holds(id: string): boolean` to the host Pick if task 03's host exposes one; otherwise the answer
  keeps its own `Set` of the ids it added (see Decisions).
- `LayoutServiceDeps` (in `layout-service.ts`) gains
  `userPluginFolder(owner: LayoutOwner): string | null`. It returns the user plugin's folder
  (`<config folder>/plugins/<id>`) for an owner the catalog holds as a user plugin, and null otherwise. Task 13
  passes `(id) => catalog.entry(id)?.folder ?? null`.
- `src/contracts/plugin.ts` (the show's `draw`; every type it names lives in this file):
  ```ts
  // A layout part `draw` draws: `(parent, input, kit)` returning an object
  // whose `element` it appended to `parent`. The kit parameter is matched as
  // `never`, so this file names no kit type.
  type LayoutPartShape = (parent: HTMLElement, input: never, kit: never) => { element: HTMLElement };
  // The names of `L`'s parts of that shape (an optional part included).
  export type LayoutPartName<L> = { [K in keyof L]-?: NonNullable<L[K]> extends LayoutPartShape ? K : never }[keyof L] & string;
  // The input and the returned object of part `K` of `L`, read from its builder.
  export type LayoutPartInput<L, K extends keyof L> = NonNullable<L[K]> extends (parent: HTMLElement, input: infer I, kit: never) => unknown ? I : never;
  export type LayoutPartBuilt<L, K extends keyof L> = NonNullable<L[K]> extends (...args: never[]) => infer R ? R : never;
  // A drawn part: the part's returned object, the name of the layout that
  // drew it, and the dispose of every anchor, slot subscription and markdown
  // mount its kit recorded. `dispose` does not remove `built.element`.
  export interface DrawnLayoutPart<R> {
    built: R;
    layoutName: string;
    dispose(): void;
  }
  // `scope` is a short scope the plugin's manifest declares; the part's key
  // hints show in it. Left out: no scope, so a hint shows in every scope.
  export interface LayoutPartDrawOptions {
    scope?: string;
  }
  // The show a page part's `layouts.show` returns.
  export interface PageLayoutShow<L> extends LayoutShow {
    // Draws part `part` into `parent` with the layout the show picks now, and
    // with the plugin's base kit. See task 11, Decisions, "The show's `draw`".
    draw<K extends LayoutPartName<L>>(
      part: K,
      parent: HTMLElement,
      input: LayoutPartInput<L, K>,
      options?: LayoutPartDrawOptions,
    ): DrawnLayoutPart<LayoutPartBuilt<L, K>>;
  }
  ```
  `PageApi.layouts` becomes `{ show<L>(options: ShowLayoutOptions<L>): PageLayoutShow<L> }`. `LayoutShow` and
  `ShowLayoutOptions` do not change, and `PageLayouts.show` in `show-layouts.ts` still returns `LayoutShow`.
  `UserPageApi` (task 08) is `PageApi<…>`, so it gains `draw` with no edit to `user-plugin.ts`.
- `src/shared/page/layout-host/owner-show.ts`:
  ```ts
  export interface OwnerShowDeps<L> {
    manifest: Pick<PluginManifest, 'id' | 'commands' | 'scopes'>;
    kit: OwnerKitServices;   // the plugin's own services, as a built-in's start builds them
    log: PluginLog;          // the plugin's log
    options: ShowLayoutOptions<L>;
    // Starts the show over the options the owner show hands it.
    show(options: ShowLayoutOptions<L>): LayoutShow;
  }
  // A show of `options` that also draws parts with the owner's base kit.
  export function ownerLayoutShow<L>(deps: OwnerShowDeps<L>): PageLayoutShow<L>;
  ```
  `L` stays unconstrained, as `PageApi.layouts.show<L>` has it. `createLayoutParts` and `drawPart` take
  `L extends object`, so `ownerLayoutShow` narrows `L` once, inside, with a comment that says why.

Decisions:
- **`ServedPlugin.manifest`.** `ServedPlugin` gains `readonly manifest: PluginManifest`. The coordinator accepted
  this, and tasks 08 and 09 fill it. The page needs a user plugin's manifest for `PagePart.manifest` and for the
  `known` list that `startPlugins` takes. Built-in parts keep their compiled part object.
- **`lastPush` and the live `known`.** Move `let lastPush = served;` above the `startPlugins` call, so every reader
  below can use it (a function that reads it during the first start would otherwise meet the temporal dead zone).
  The page's `known` is the function `() => lastPush.plugins.map((p) => p.manifest)` (task 03 reads it at each
  check). It replaces the static `manifests` import in `renderer.ts`. Reason: a user plugin added live with a
  dependency added in the same change must find that dependency, and a dependent of a plugin the last push no longer
  lists must fail its start with `depends on plugins not in the list`.
- **Scheme.** Use `wigley-plugin` with the same privileges as `wigley-layout` (`standard`, `secure`,
  `supportFetchAPI`, `corsEnabled`). It serves files under `codeRoot` only: a URL naming no file, a folder, a
  missing revision, or a path that `decodedPathSegments` refuses answers 404, through the shared `serveFiles`.
  Relative imports inside `page.js` resolve under the same `~<revision>` segment, so they load from that revision's
  copy.
- **Id segment.** Use `relativeSegments` and require exactly one segment equal to the hostname, as `layout-url.ts`'s
  `plainSegment` does. Move `plainSegment` from `layout-url.ts` to `file-url.ts` as an export and use it from
  both modules; this edit also touches `src/shared/file-url.ts`, and `layout-url.test.ts` must stay green.
- **CSP** (`index.html`), the new content in full:
  `default-src 'self'; script-src 'self' wigley-data: wigley-layout: wigley-plugin:; style-src 'self' 'unsafe-inline' wigley-data: wigley-layout: wigley-plugin:; font-src 'self' data: wigley-layout: wigley-plugin:; img-src 'self' data: wigley-layout: wigley-plugin:; connect-src 'self' wigley-layout: wigley-plugin: ws://localhost:*; frame-src wigley-visual:`.
  The comment above it adds: `wigley-plugin: carries a user plugin's page.js and the files it imports.`
- **Page part list at load** (`renderer.ts`):
  - Read `served.plugins` in order. Call `loadPagePart` on each one, all at once (`Promise.allSettled`), with
    `importModule: (url) => import(/* @vite-ignore */ url)` (the call `createPageLayouts` already uses).
  - A rejected load is logged under source `plugin-switch` as `page.js of <id> not loaded: <error>`, and that
    part is left out. The page start goes on. This load-time failure is not sent to main from here. It reaches the
    Settings row through the `start` reply (see "Page problems reach main"), because main's launch job always sends
    a page `start` for each user id it started.
  - A null load (no page part) is left out.
  - A replaced built-in's static page part never loads, because its served origin is `replaces-built-in` and the
    user's `pageUrl` is loaded instead.
- **Deferred user starts.** `startPlugins` rethrows a start that throws, and that would fail the whole page.
  So the initial `disabled` list passed to `startPlugins` is
  `served.settings.plugins.disabled` ∪ `deferredPageIds(served.plugins)`.
  - The host keeps these parts. They start in the existing `toStart` path after `restores.partsReady()`.
  - `toStart` is `notStarted()` minus `loadDisabled`. `notStarted()` is already in `dependencyOrder`, so a user
    plugin `a-tool` that depends on user plugin `z-base` starts after `z-base`, as main's launch job orders them.
  - Each id in `toStart` gets its own `answerPluginParts` `start` request, in that order, so a throw in one part
    does not stop the next one. This replaces today's one request with every id.
  - The ids in `loadDisabled` stay unstarted, as they are today.
- **`handlerProblems` on a user start.** The `startPlugins` start callback calls
  `startCheckedPart(part, origin, start)`, where `origin` is the origin of the `lastPush.plugins` entry with the
  part's id, and `start` is today's `part.start(createPageApi(...))` call. The callback registers the handlers only
  after `startCheckedPart` returns. A throw then reaches the host, which disposes the part's registrations, and the
  answer records it (see "Page problems reach main"). Built-ins skip the check, because `definePlugin` already
  makes it at compile time.
- **`requireServedSettings`** stays, and reads `lastPush`, not the load-time `config`: call it as
  `requireServedSettings(lastPush, id)`. Reason: a user plugin that appears after the page loaded (its first load
  failed and a good save followed, or its folder was made while the app ran) has `pluginSettings` only in a later
  push. Its message changes to `Plugin "<id>" has a page part but main served no settings for it`. Its comment
  changes to: "Throws for a page part main served no settings for: main did not admit its plugin, so it would get
  no keys, labels or settings."
- **`notStarted`.** Change it to
  `pagePartIds(lastPush.plugins, pageParts).filter((id) => !pageHost.started.has(id))`. Only plugins with a page
  part are in it. Reason: `startedPluginsConfig` strips every page and editor bind whose command belongs to an id in
  `notStarted`, and a page bind can name a `runsIn: 'main'` command. A main-only plugin (`auto-compact`,
  `session-log`, `window`, or a user plugin with only `main.js`) must keep its binds, as it does today. A user plugin
  whose `page.js` failed to load stays in the list, so its page binds stay stripped and `requireRegistered` meets no
  bind with no handler.
- **Page problems reach main.** The design shows an import failure on the Settings row, and main never imports
  `page.js`. So the `start` answer replies `{ started, problems }`:
  - A requested id the host does not hold, whose `loadPart` rejects, adds
    `{ id, message: 'page.js of <id> failed to load: <error text>' }`.
  - When `host.start(ids)` throws, the answer adds `{ id, message: 'Page part did not start: <error text>' }` for
    the first requested id, in the host's start order, that the host holds and that is not started after the throw.
    The host stops at the part that threw, so that is the part that threw. A missing handler gives
    `Page part did not start: selftest-user: missing hello`.
  - Every other start reply holds `problems: []`.
  - The renderer's own load-time starts (`toStart`) log a problem and send nothing. Main's launch job, and every
    other switch path, sends its own page `start` for the id, and that reply carries the problem. After a page
    reload with no switch work, a page-side failure is logged only; the row keeps the problem main recorded before.
- **`remove` answer.** Call `host.remove(id)`. Reply `{ stopped }` with the ids it stopped, in stop order, which is
  `[]` when the host holds no such part. A throw is logged as `page remove failed: <error>`, and the reply holds the
  ids that left `started`, as the `stop` case does.
- **`reload` answer** (task 10 has already stopped the part and its page dependents; the answer starts nothing):
  1. Find `deps.served().plugins` entry `id`.
  2. If there is no entry, or `loadPart` resolves null: `host.remove(id)` and reply
     `{ reloaded: [], problem: null }`. Examples: a user replacement whose new revision dropped `page.js`, or a
     plugin removed between push and reload.
  3. Else `await loadPart(entry)`. If the import rejects, change nothing in the host, so the old part stays held
     and the following `start` brings the last good page part back. Reply
     `{ reloaded: [], problem: 'page.js of <id> failed to load: <error text>' }` and log the same text under
     `plugin-switch`. Task 10 shows `problem` as the plugin's problem.
  4. Else: if the host holds `id`, `await host.remove(id)` (it stops nothing, since the part is already stopped);
     then `host.add(part)`. Reply `{ reloaded: [id], problem: null }`.
  - The same steps cover the swap back from a replacement to its built-in. When the user folder of a replaced
    built-in goes, the served origin becomes `built-in`, and `loadPart` returns the static part.
  - The answer never calls `reopen` or `partsReady`. The following `start` request opens the restore window
    (task 04).
  - Task 04's document says "Task 11's reload answer calls it (`reopen`) the same way the start answer does". That
    line predates the coordinator's ruling that `reload` starts nothing. This task follows the ruling. Task 15's
    re-read finds no doc to fix.
- **`start` of an id the host does not hold.** For each requested id the host does not hold:
  - Find the served entry and call `loadPart`, then `host.add` on a part that loads.
  - An id with no entry, or a null part, is skipped with no log.
  - A rejected load is logged under `plugin-switch` as `page start failed: page.js of <id> failed to load: <error>`,
    the id is left out of the start, and the reply's `problems` holds it.
  - Then the existing start case runs (task 04's order) over the ids the host holds.
  - "Holds" means the host's `holds` member if task 03 adds one. Otherwise the answer tracks the ids itself: the
    renderer seeds the set with the ids it handed `startPlugins`, `add` adds an id, and `remove` deletes it. Pick
    the first one the code allows, and say which in the Proof.
- **The user default layout folder.** `register(owner, layoutTypes, defaultFolder)` computes the default folder
  path as follows:
  - `paths.join(userPluginFolder(owner), 'layouts', 'default')` when `userPluginFolder(owner)` is not null. This is
    the live user folder, not the revision copy, so a save there reloads the layout alone through
    `wigley-layout:`, without a plugin reload.
  - For a user plugin, `register` makes that folder (`files.makeFolder`) before it starts the owner's registry,
    when the folder does not exist. Reason: `startLayoutRegistry` leaves a default folder that is missing at start
    unwatched until the next start (`layout-registry.ts`, the `watchedDefault` comment), and task 08's watcher skips
    every path under `layouts`. Without the folder, a `layouts/default/layout.js` that the user makes later never
    shows until a restart. An empty default folder lists no `layout.js`, so the owner keeps its built-in default
    until the user writes one. The made folder starts no plugin reload, because task 08's watcher skips it.
  - Else `paths.join(repoDir, defaultFolder)` as today, or null with no `repoDir`.
  - The `OWNER` constant (line 55 at plan time) and the `OWNER.test` at the top of `register` stay as task 02 leaves
    them. This task edits only the `defaultFolderPath` lines and the registry start below them.
  - A user plugin gets its live default even with no clone: `repoDir` null still gives the user folder.
  - `register` reads the folder at registration time, so a reload that replaces a built-in registers again with the
    user folder. `main-api.ts` is not edited: it still passes `src/plugins/<id>/layouts/default`, which is used only
    when `userPluginFolder` returns null.
  - Update the `LayoutService` doc comment, and the `MainApi` `layouts.register` doc line in
    `src/contracts/plugin.ts`: "…and the plugin's default folder: `layouts/default` in a user plugin's own folder,
    else `src/plugins/<id>/layouts/default` in the repo clone…". This edit also touches `src/contracts/plugin.ts`.
- **The show's `draw`** (design.md: "A user plugin draws through its layout kit"). A user `page.js` gets only
  `UserPageApi`, and it cannot import `src/shared`, so the page API draws for it:
  - **Where it lives.** `draw` is a member of the show that `api.layouts.show` returns. The show already holds the
    owner, the shown layouts and `defaultLayout`, so `draw` takes only the part, the parent and the input. Built-ins
    and user plugins reach it through the same `api.layouts.show`. This task moves no built-in to it; each built-in
    keeps its own `createLayoutParts` path, which `draw` is built on.
  - **Rejected: a member that returns the owner's base kit.** A kit must record each anchor, slot subscription and
    markdown mount into one drawing attempt's rollback, so the page part would also need `RollbackDeps` and the
    fallback to `default` on a throw. That copies `drawPart` into every user plugin.
  - **Rejected: `show` hands the kit to the layout.** A show has no drawing attempt, so the kit's anchors would
    outlive each redraw. Also, the contract would have to name `BaseKit`.
  - **The kit type is never named in `src/contracts`.** `BaseKit` lives in `src/shared/page/layout-host/kit.d.ts`.
    Task 07's tsc emit does not copy a `.d.ts` input into `.plugin-types/`, so a contract that imports it would
    point at a file `_types/` does not hold. Under `--skipLibCheck` (task 16 check 9), that import becomes `any`
    with no error. So `LayoutPartShape` matches the kit parameter as `never`: a part typed `kit: BaseKit`, or a
    narrower kit, matches it, and the types `draw` names all live in `src/contracts/plugin.ts`. A user layout
    still types its kit from the `kit.d.ts` that the layout service writes beside its `layout.d.ts`.
  - **Behaviour.** `ownerLayoutShow` makes one `createLayoutParts` with the owner's id, `options.defaultLayout` and
    the plugin's log. It starts the show through `deps.show` with `options`, where `setLayouts` first calls the
    parts' `setLayouts` and then `options.setLayouts`. So a `draw` inside the owner's `setLayouts` draws with the
    new layouts. Before the first set, `draw` draws with `defaultLayout`.
  - `draw(part, parent, input, options)`:
    1. When `options.scope` is set, `requireDeclaredScope(manifest, scope)` runs first and throws for a scope
       the manifest does not declare.
    2. It calls the parts' `draw(part, parent, build)`. `build` calls the builder as
       `builder(slot, input, kit)`, with `kit` = `createBaseKit(ownerBaseKitDeps(manifest, deps.kit, scope ?? null,
       rollback))` made for each attempt.
    3. So the picking, the fallback to `defaultLayout`, the one log line per failed layout, the rollback, and the
       `data-layout` and `data-layout-owner` marks are `drawPart`'s, unchanged.
    4. It throws as `drawPart` throws. A throw inside the owner's `setLayouts` reaches `show-layouts.ts`'
       `layouts not shown: <error>` log.
  - **Lifetime.** The owner show keeps each draw that is not yet disposed. A draw's `dispose` disposes once and
    forgets it. The show's `dispose` disposes every kept draw, then the inner show. A part stop disposes the show,
    because `page-api.ts` tracks it, so a user part that never disposes its draws leaks no anchor, subscription or
    mount. Removing a drawn element stays with the caller, as with `drawPart`.
  - **`page-api.ts`.** `layouts.show` becomes
    `track(ownerLayoutShow({ manifest, kit, log, options, show: (o) => deps.layouts.show(manifest.id, o) }))`.
    `kit` is made from the plugin's own API members, as a built-in's start makes it: `markdown` the tracked markdown,
    `keys` the API's `anchor` and `keysFor`, `commands` from `kitCommandsOf` over the API's `keys.command`,
    `commands` and `log`, `platform` the API's `platform.os`, `state` the API's `state.forLayouts`, and `log` the
    plugin log.
  - **Fakes.** The harness's fake `layouts.show` returns `ownerLayoutShow` over its `fakeLayoutShow`, with the kit
    made from the fake API's members, so a built-in's harness test can draw. `workflow-draw.test.ts`'s fake show
    adds a `draw` that throws `not faked`.
- **What task 13 wires** (this task edits no part of `main.ts`): `servePluginScheme(codeRoot, paths)` beside
  `serveDataScheme`, and `userPluginFolder` in `serveLayouts`' `createLayoutService` deps. Until 13 lands,
  `main.ts` does not compile against the new required dep. Make the dep required anyway, and leave the `main.ts`
  line to 13. Task 13 waits for this task, and both land before any run.

GIVEN `pluginUrl('my-tool', 3, 'lib/a b.js')` THEN it returns `wigley-plugin://my-tool/~3/lib/a%20b.js`, and
`pluginFilePath` on it with codeRoot `/c` returns `/c/my-tool/3/lib/a b.js`.
GIVEN served plugins `[built-in a (page part), user u (pageUrl), replaces-built-in b (pageUrl)]` WHEN the page builds
its parts THEN it holds a's static part, u's and b's imported parts, and not b's static part.
GIVEN a held, stopped part `u` and a served entry at a new revision WHEN `reload u` is answered THEN the host holds the
new part, nothing started, and the reply is `{ reloaded: ['u'], problem: null }`.
GIVEN a `reload u` whose import rejects THEN the host still holds the old part and the reply carries
`page.js of u failed to load: <error>`.
GIVEN a user page part whose start returns no handler for a declared command `hello` WHEN `startCheckedPart` runs it
THEN it throws `u: missing hello` before it returns.
GIVEN a `start u` request whose `page.js` import rejects THEN the reply is
`{ started: [], problems: [{ id: 'u', message: 'page.js of u failed to load: <error>' }] }`.
GIVEN served plugins `[user a-tool (depends on z-base through page), user z-base, built-in b]` THEN
`deferredPageIds` returns `['z-base', 'a-tool']`.
GIVEN a served main-only user plugin `m` (null `pageUrl`) THEN `pagePartIds` leaves `m` out, so its page binds stay.
GIVEN a user plugin folder WHEN its main part registers layouts THEN `defaultFolderPath(id)` is
`<folder>/layouts/default`, also with no clone, and that folder exists after `register` even when it did not before.
GIVEN a user plugin `u` whose manifest declares command `hello` and scope `view`, and a shown live `default` whose
`view(parent, input, kit)` calls `kit.keyHint(root, 'hello')` WHEN its `setLayouts` calls
`show.draw('view', parent, { text: 't' }, { scope: 'view' })` THEN the live default draws the root, the root carries
`data-layout="default"` and `data-layout-owner="u"`, and the hint anchors `u.hello` in scope `u.view`.
GIVEN a shown user layout whose `view` throws WHEN `draw('view', …)` runs THEN `defaultLayout` draws in its place,
and the log holds one `layout <name> view failed: <error>` line.
GIVEN a show with one draw not disposed WHEN the show is disposed THEN that draw's anchor is disposed, and the inner
show is disposed after it.

Tests:
- `src/shared/plugin-url.test.ts`, modelled on `data-url.test.ts` and `layout-url.test.ts`:
  - `pluginFilePath_RoundTripsPluginUrl`. Use an id with `-`, revision 12, and a two-segment path with a space.
    It breaks if the revision is dropped from the file path (main imports and the page would then read different
    copies).
  - `pluginFilePath_RefusesMalformed`, a table with these rows: another scheme; no revision segment; a revision
    without `~`; an empty path; an encoded `/` in a segment; a `..` climb.
  - `pluginFilePath_WindowsRoot_JoinsWithBackslash`, using `windowsPaths`.
- `src/renderer/page-part-loader.test.ts`: `loadPagePart_PicksThePartByOrigin`, a table with these rows: built-in
  with a page part; built-in without one (null); user with `pageUrl` (part with the served manifest and the module's
  `start`); user with null `pageUrl` (null, no import made); `replaces-built-in` (the imported part, not the
  static one); a module without `start` (rejects with the pinned message). It breaks if a replaced built-in's
  static part leaks in, or if a missing `start` slips through.
- `src/renderer/page-part-loader.test.ts`: `pagePartIds_OnlyPluginsWithAPagePart`, a table with these rows: a
  built-in with a page part (in); a built-in with none (out); a user plugin with `pageUrl` (in); a main-only user
  plugin with null `pageUrl` (out); a dependent listed before its dependency (returned after it). It breaks if a
  main-only plugin's binds would be stripped, or if the order is served order.
- `src/renderer/page-part-loader.test.ts`: `deferredPageIds_UserIdsAndTheirPageDependents`, a table with these rows:
  only built-ins (`[]`); one user id; a built-in that depends on a replaced built-in through `dependsOn.page` (both);
  a transitive dependent; a dependent user id named before its user dependency (dependency first); a built-in that
  depends on a user id only through `dependsOn.main` (out).
- `src/renderer/page-part-loader.test.ts`: `startCheckedPart_ChecksHandlersOfNonBuiltIns`, a table with these rows:
  user part with every handler (returns the start); user part missing `hello` (throws `u: missing hello`);
  `replaces-built-in` part missing a handler (throws); built-in part missing a handler (returns, no check). It
  breaks if a missing user handler slips through, or if the check runs after the caller could register.
- `src/renderer/plugin-parts-answer.test.ts`: extend the existing table and fake host with `add` and `remove`, and
  the fake deps with `served` and `loadPart`.
  - Rows for `reload`: a swap of a held part (reply, the held part is the new one, `started` unchanged); an add of
    an id the host does not hold; a served entry gone (removed, `reloaded: []`); an import that rejects (old part
    kept, reply problem text, log line).
  - Rows for `remove`: a held, started part with a dependent (`stopped` in stop order); an id the host does not
    hold (`stopped: []`).
  - Rows for `start`: an id the host does not hold (loaded, added, started, in `started`, `problems: []`); an id
    the host does not hold whose import rejects (not added, `problems` holds the `page.js of <id> failed to load:`
    item); a held id whose start throws (`problems` holds `Page part did not start: <error>` for that id); a
    held, started id (`started: []`, `problems: []`).
  - Every existing `start` row's expected reply gains `problems: []`.
  - Task 04's `steps` column carries `add <id>` and `remove <id>` too, so the rows show that `reload` records no
    `reopen` and no `start`.
  - It breaks if `reload` starts the part, if a failed import drops the old part, if `start` refuses an id it
    could load, or if a page-side failure leaves the reply with no problem.
- `src/main/layouts/layout-service.test.ts`: add rows to `register_DefaultFolder_ReadFromTheClone`, and rename it
  `register_DefaultFolder_ReadFromTheUserFolderElseTheClone`:
  - "user plugin, clone present" → `<userFolder>/layouts/default`, live default
  - "user plugin, no clone" → the same path, live default
  - "user plugin, no default folder on disk" → the folder exists after `register`, and a `layout.js` written into
    it afterwards becomes the owner's default (the next set `send` receives lists a non-built-in `default`)
  - The existing rows keep `userPluginFolder` returning null.
  - It breaks if the user folder is ignored, if no clone hides it, or if a default folder made after load is never
    watched.
- `src/shared/page/layout-host/owner-show.test.ts` (a fake inner show that records its options and its dispose, and
  the fake kit services `context-section.test.ts` uses):
  - `ownerLayoutShow_Draw_PicksTheShownLayoutElseDefault`, a table with these rows: before the first set
    (`defaultLayout` draws); a set whose user layout defines the part (it draws); a set whose user layout lacks the
    part (`defaultLayout` draws); a user part that throws (`defaultLayout` draws, one log line); a `draw` made inside
    the owner's `setLayouts` (it draws with the layouts of that set). It breaks if the parts' `setLayouts` runs
    after the owner's, or if `draw` skips `drawPart`'s fallback.
  - `ownerLayoutShow_Draw_KitIsTheOwners`, a table with these rows: `kit.keyHint(root, 'hello')` with scope `view`
    (anchors `u.hello` in scope `u.view`); with no scope (anchors with no scope); scope `nope`, which the manifest
    does not declare (throws `Plugin "u" declares no scope "nope"` and draws nothing). It breaks if the kit is
    built for another owner or scope.
  - `ownerLayoutShow_Dispose_DisposesKeptDraws`: two draws, the first disposed by its caller. The show's dispose
    disposes the second draw's anchor once, does not dispose the first again, and then disposes the inner show. It
    breaks if a part stop leaks a draw's anchors or disposes one twice.
- `src/shared/page/layout-host/owner-show.test-d.ts`: over a layout type with a part
  `view?(parent: HTMLElement, input: { text: string }, kit: BaseKit): { element: HTMLElement }` and a field
  `name: string`, `draw('view', parent, { text: 't' })` type-checks and its `built` is `{ element: HTMLElement }`;
  `draw('view', parent, { text: 1 })` and `draw('name', …)` are errors (`@ts-expect-error`). It breaks if the input
  is not read from the part, or if a part typed with `BaseKit` no longer matches the shape.
- `src/renderer/plugins/page-api.test.ts`: `createPageApi_LayoutsShowDraw_DrawsWithThePluginsKit`. A fake
  `PageLayouts` hands a set with a layout whose part calls `kit.keyHint(root, 'hello')`. `show.draw` anchors
  `<id>.hello` through `deps.anchors`, and the root carries `data-layout-owner="<id>"`. It breaks if `page-api.ts`
  wires the kit to another manifest or skips the owner show. The existing `layouts.show` rows keep passing.
- The wiring in `renderer.ts` (the live `known`, `requireServedSettings(lastPush, …)`, one request per deferred
  id) has no unit seam: `renderer.ts` is the composition root. Task 03's tests prove the host reads a `known`
  function at each check. Task 14's self-test steps cover the deferred start (`hello from v1` runs only if it
  registered the handler). Task 16 checks 2 (a plugin added while the app runs), 3 and 6 (the `page.js` failures)
  cover the rest live. Task 14's step 5 and task 16 check 11 draw a user plugin's default layout through `draw`
  live.

Done when: compiles; `npm run lint` passes; the tests above pass by name; `grep -c "wigley-plugin:" index.html`
prints `2` (the comment line and the CSP line); `grep "script-src" index.html | grep -o "wigley-plugin:" | wc -l`
prints `5`.
Commit:    one commit for the task

Concerns: the renderer's start grows. `pagePartIds`, `deferredPageIds` and `startCheckedPart` already hold the
rules. If the remaining loading code in `start()` passes about 40 lines, move it into `page-part-loader.ts` as a
function the renderer calls. Report that choice in the Proof.

## Proof

Commit 70101139 · proof: diff read; servePluginScheme, pluginFilePath, page-part-loader, ownerLayoutShow, PageLayoutShow, userPluginFolder, CSP present; task tests pass; tsc red only in main.ts (13) · concerns: harness fake show.draw throws (layer rule); deferred user parts are host.add-ed after startPlugins, not disabled; initial config strips deferred and failed page binds; renderer's load code kept inline (~40 lines)
