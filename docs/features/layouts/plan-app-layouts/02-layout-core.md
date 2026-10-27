# 02 — Core layout service and page host

Status: in progress
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

The layouts folder moves from each plugin's data folder to the user config folder, behind one core service. The page
gets one host that every owner uses. Forms and chat switch to `api.layouts` in this task, so the tree compiles at its
commit. Forms and chat keep their own drawing code (`page/layout/`, `entry-list.ts`) until tasks 03 and 04.

Files:

- create `src/main/layouts/layout-service.ts` · test `src/main/layouts/layout-service.test.ts`
- create `src/shared/layout-url.ts` · test `src/shared/layout-url.test.ts`
- create `src/shared/page/layout-host/kit.d.ts`
- create `src/shared/page/layout-host/read-layout-module.ts` · test `read-layout-module.test.ts`
- create `src/shared/page/layout-host/draw-part.ts` · test `draw-part.test.ts`
- create `src/shared/page/layout-host/pick.ts` · test `pick.test.ts`
- create `src/shared/page/layout-host/base-kit.ts` · test `base-kit.test.ts`
- create `src/shared/page/layout-host/show-layouts.ts` · test `show-layouts.test.ts`
- move `src/shared/page/layout-loader.ts` → `src/shared/page/layout-host/layout-loader.ts`; its test moves to
  `layout-loader.test.ts` beside it, and the `showLayouts` cases move to `show-layouts.test.ts`
- modify `src/shared/layouts/layout-registry.ts` · test `src/shared/layouts/layout-registry.test.ts`
- modify `src/contracts/layouts.ts`, `src/contracts/plugin.ts`, `src/contracts/bridge.ts`
- modify `src/main/main.ts`, `src/main/plugins/main-api.ts` · test `src/main/plugins/main-api.test.ts`
- modify `src/main/data-protocol/data-protocol.ts`
- modify `src/preload/preload.ts`
- modify `src/renderer/plugins/page-api.ts` · test `src/renderer/plugins/page-api.test.ts`
- modify `src/renderer/renderer.ts` (builds the page layouts and hands them to `createPageApi`)
- modify `index.html` (CSP)
- modify `scripts/check-layers.mts`
- modify `src/plugins/forms/main/start.ts`, `src/plugins/forms/main/selftest-script.ts`,
  `src/plugins/forms/main/round.ts`, `src/plugins/forms/contract.ts`, `src/plugins/forms/page/start.ts`,
  `src/plugins/forms/page/forms-view.ts`, `src/plugins/forms/page/round-view.ts`
- modify `src/plugins/chat/main/start.ts` · test `src/plugins/chat/main/start.test.ts`,
  `src/plugins/chat/contract.ts`, `src/plugins/chat/page/start.ts`
- create `src/plugins/gallery/main/start.ts`, `src/plugins/keys/main/start.ts`; modify `src/plugins/main.ts`
- create placeholder `src/plugins/gallery/layouts/layout.d.ts` and `src/plugins/keys/layouts/layout.d.ts`
- modify `src/shared/page/list-picker.ts` · test `src/shared/page/list-picker.test.ts` (create it if missing)
- modify `src/shared/page/confirm-prompt.ts` · test `src/shared/page/confirm-prompt.test.ts` (create it if missing)
- modify every test fake of `MainApi` or `PageApi` that the compiler flags for the new `layouts` member

Consumes: nothing from another task. Tree members: `Files`, `scopedFiles`, `relativeSegments`, `Paths`,
`recordingAnchor` / `disposeAnchors` (`src/shared/page/ui/key-anchors.ts`), the primitives `textButton`, `card`,
`tag`, `kbd`, `sectionHeader` (`src/shared/page/ui/`), `element` / `markdownElement` (`src/shared/page/dom.ts`).

## Produces

Every name below is the interface the other tasks consume. Where it differs from `plan.md`'s shared-names block, the
difference is marked **(changed)** with its reason; the lead updates `plan.md` to match.

`src/contracts/layouts.ts` (extended in place; `LayoutEntry` and `LayoutSet` unchanged):

```ts
// The owner of a layouts folder: a plugin id, or 'shell'.
export type LayoutOwner = string;
```

`src/contracts/plugin.ts`:

- `MainApi` gains **(changed: the type is `MainApi`, not `MainPluginApi`)**:
  ```ts
  layouts: {
    register(options: { layoutTypes: string }): Disposable;
    names(): string[];
  };
  ```
- `PageApi` gains **(changed: the type is `PageApi`, not `PagePluginApi`)**:
  ```ts
  layouts: { show<L>(options: ShowLayoutOptions<L>): LayoutShow };
  ```
- exported beside them; this block is the one source of their members:
  ```ts
  // What an owner hands `show`. The host supplies log, logSource (the owner) and toast from `PageLayoutsDeps`,
  // so they are not options.
  export interface ShowLayoutOptions<L> {
    defaultLayout: L;
    // The owner's reader: the layout a user's `layout.js` module holds, or a throw naming the first part it gets wrong.
    read(module: unknown, name: string): L;
    // The setting's layout name, read again on each set and each `refresh()`.
    userLayout(): string;
    // The names the owner's content names beside the user's, read again on each set and each `refresh()`.
    // Left out: no names (`[]`).
    namesInUse?(): readonly string[];
    setLayouts(shown: ShownLayouts<L>): void;
  }
  // The layouts a page draws with, by name, `default` always included, and the name of the user's layout: the
  // setting's when `layouts` holds it, else `default`. (Moved unchanged from `layout-loader.ts`.)
  export interface ShownLayouts<L> {
    layouts: ReadonlyMap<string, L>;
    user: string;
  }
  export interface LayoutShow {
    // Reads the setting and the names in use again, after either may have changed.
    refresh(): void;
    // (new) Stops the show hearing sets, removes its stylesheet links, and calls `setLayouts` no more.
    dispose(): void;
  }
  ```
  `ShownLayouts` moves here from the loader; forms' `forms-view.ts` and `round-view.ts` import it from here. The
  loader's `ShowLayoutsDeps` and `LayoutChannel` go: `createPageLayouts` builds the channel and loader for each
  owner.

`src/contracts/bridge.ts`:

```ts
BRIDGE_CHANNELS.layoutsRead = 'bridge:layouts-read'
BRIDGE_CHANNELS.layoutsChanged = 'bridge:layouts-changed'
// Bridge:
layouts(owner: LayoutOwner): Promise<LayoutSet | null>;   // null until the owner's registry has listed
onLayouts(listener: (owner: LayoutOwner, set: LayoutSet) => void): void;
```

`src/main/layouts/layout-service.ts`:

```ts
export interface LayoutServiceDeps {
  files: Files;        // absolute paths
  paths: Paths;
  folder: string;      // the absolute `layouts` folder in the user config folder
  kitTypes: string;    // the text of src/shared/page/layout-host/kit.d.ts
  send(owner: LayoutOwner, set: LayoutSet): void;
  log: Log;
}
export interface LayoutService {
  register(owner: LayoutOwner, layoutTypes: string): Disposable;
  names(owner: LayoutOwner): string[];
  read(owner: LayoutOwner): Promise<LayoutSet | null>;
  dispose(): void;
}
export function createLayoutService(deps: LayoutServiceDeps): LayoutService;
```

The shell (task 13) registers from `src/main/main.ts` with `layoutService.register('shell', layoutTypes)`, and
shows from `src/renderer/renderer.ts` with `pageLayouts.show('shell', options)` on the `PageLayouts` that
`renderer.ts` builds with `createPageLayouts` (below); `api.layouts.show` wraps the same call with the plugin's id.

`src/shared/layouts/layout-registry.ts` (reworked): `LayoutRegistryDeps.data` becomes `folder: Files`, scoped to
`layouts/<owner>/`. The registry lists `<name>/layout.js` at that root and writes `layout.d.ts` at that root.
`startLayoutRegistry`, `LayoutRegistry` keep their names and members.

`src/shared/layout-url.ts`:

```ts
export const LAYOUT_SCHEME = 'wigley-layout';
// `wigley-layout://<owner>/<name>/~<revision>/<path>`, each segment of `name` and `path` URI-encoded.
export function layoutUrl(owner: LayoutOwner, name: string, revision: number, path: string): string;
// `<layoutsRoot>/<owner>/<name>/<path>` joined by `paths`; null for any other URL (see Tests).
export function layoutFilePath(url: string, layoutsRoot: string, paths: Paths): string | null;
```

`src/main/data-protocol/data-protocol.ts`: `registerDataScheme()` becomes `registerFileSchemes()`, which registers
`wigley-data` and `wigley-layout` in one `protocol.registerSchemesAsPrivileged` call, with the privileges
`wigley-data` has today. Electron takes that call once, before the app is ready, so both schemes go in it.
`serveLayoutScheme(layoutsRoot: string, paths: Paths): void` serves `wigley-layout:` the way `serveDataScheme`
serves `wigley-data:` (same content types, 404 rules and CORS header); the two share one private serving function.

`src/shared/page/layout-host/`:

```ts
// kit.d.ts — imports nothing; written verbatim to `layouts/kit.d.ts`
export type TagTone; export type ButtonVariant; export interface KitButtonOptions;   // as forms' today
export type DotStatus = 'idle' | 'running' | 'success' | 'warning' | 'attention' | 'error';  // the status-dot primitive's
export interface KeyHintOptions { className?: string; label?: boolean | string }
export interface KitRowOptions {   // the row primitive's RowOptions
  density: 'list' | 'tree'; label: string; detail?: string | null; leading?: HTMLElement | null;
  trailing?: HTMLElement | null; depth?: number; tag?: 'div' | 'li'; onClick?: () => void;
}
export interface BaseKit {
  // el, markdown, inlineMarkdown, section, keys, command, keysFor, card, tag, kbd, button, sectionHeader:
  // the shapes and comments of forms' HeadKit today (src/plugins/forms/layouts/layout.d.ts), with
  // "a forms command" worded as "the owner's command".
  keyHint(parent: HTMLElement, command: string, options?: KeyHintOptions): HTMLElement;   // (changed: was className)
  statusDot(parent: HTMLElement, status: DotStatus): HTMLElement;                       // (new)
  setDotStatus(dot: HTMLElement, status: DotStatus): void;                               // (new)
  row(parent: HTMLElement, options: KitRowOptions): HTMLElement;                        // (new)
  emptyState(parent: HTMLElement, text: string, hint?: HTMLElement | null): HTMLElement; // (new)
  keyPrompt(parent: HTMLElement, keys: string, label?: string): HTMLElement;            // (new)
}
// Owner-only parts (rowTrailing, edgePrompt, chat's chip, iconButton, floatingPanel) stay in owner kits.
// An owner kit that needs its own `row` member renames it (as 05's `railRow`) or extends `Omit<BaseKit, 'row'>`
// (as 03's ReviewKit), since `BaseKit.row` takes `KitRowOptions`.

// read-layout-module.ts — as plan.md
export function readLayoutModule(module: unknown, name: string): Record<string, unknown>;
export function isRecord(value: unknown): value is Record<string, unknown>;

// draw-part.ts
export interface PartPick<L> { name: string; layout: L }
export interface RollbackDeps { recordBox(destroy: () => void): void; recordAnchor(anchor: Disposable): void }
export interface DrawPartOptions<L extends object, B, R extends { element: HTMLElement }> {   // (changed)
  owner: LayoutOwner;   // (new) set as `data-layout-owner` on the part root
  parent: HTMLElement;
  pick: PartPick<L>;
  defaultLayout: L;
  part(layout: L): B | undefined;
  build(builder: B, parent: HTMLElement, rollback: RollbackDeps): R;              // (changed)
  log: Log;
  logSource: string;
  partName: string;
}
export function drawPart<L extends object, B, R extends { element: HTMLElement }>(
  options: DrawPartOptions<L, B, R>): { built: R; layoutName: string; dispose(): void };   // (changed)
// `built.element` carries `data-layout="<layoutName>"` and `data-layout-owner="<owner>"`.
// `dispose` disposes every anchor and runs every box `destroy` recorded through the successful attempt's
// `RollbackDeps`, once; a second call does nothing. It does not remove `built.element`.
export function requireElementIn(parent: HTMLElement, element: unknown, partName: string): HTMLElement;

// pick.ts — as plan.md
export function pickLayout<L>(chain: readonly string[], layouts: ReadonlyMap<string, L>,
  defines: (layout: L) => boolean): PartPick<L>;

// base-kit.ts
export interface BaseKitDeps {
  markdown: MarkdownRenderer;
  keys: {                                                                          // (changed)
    anchor(element: HTMLElement, command: CommandId,
      options?: { scope?: ViewScope; label?: boolean | string }): Disposable;
    keysFor(command: CommandId, scope?: ViewScope): string | null;
  };
  commands: KitCommands;
  scope: ViewScope | null;   // null: the kit's anchors carry no scope and `keys`/`keysFor` read any scope
  commandNamed(short: string): CommandId | null;
  platform: Platform;
}
export function createBaseKit(deps: BaseKitDeps): BaseKit;
export interface KitCommands { exists(id: CommandId): boolean; run(id: CommandId): void }        // (changed)
export function commandRunner(qualifiedId: CommandId, commands: KitCommands): () => void;     // (changed)

// layout-loader.ts — moved; `dataUrl` dep becomes `layoutUrl(name: string, revision: number, path: string): string`
export function createLayoutLoader<L>(deps: LayoutLoaderDeps<L>): LayoutLoader<L>;

// show-layouts.ts
export interface PageLayoutsDeps {
  bridge: Pick<Bridge, 'layouts' | 'onLayouts'>;
  importModule(url: string): Promise<unknown>;
  head: HTMLElement;
  log: Log;
  toast(text: string, tone: ToastTone): void;
}
export interface PageLayouts { show<L>(owner: LayoutOwner, options: ShowLayoutOptions<L>): LayoutShow }
export function createPageLayouts(deps: PageLayoutsDeps): PageLayouts;
```

`src/shared/page/list-picker.ts` (`ListPickerRequest<T>` gains an optional member; owners fill it in their own
tasks):

```ts
// Draws the row for `item` into `parent` (the picker's list) and returns it, appended to `parent`; the picker
// draws its built-in row when left out. The input holds no `atCursor`: the picker sets `is-cursor` on the returned
// row, and a layout styles the cursor row through that class. The owner hands each key anchor its row part names to
// `recordAnchor`. The picker owns their lifetime: it disposes every recorded anchor before each row draw pass (a
// filter change, `redraw()`) and when it closes.
drawRow?(parent: HTMLElement, item: T, input: { label: string; trailing: HTMLElement | null;
  recordAnchor(anchor: Disposable): void }): HTMLElement;
// ListPicker gains: draws the open request's rows again, as after a new layout; nothing when closed.
redraw(): void;
```

`src/shared/page/confirm-prompt.ts` (owners fill the hook in their own tasks; the prompt keeps its scrim, panel,
title, scope and lifecycle):

```ts
export interface ConfirmBodyParts {
  body: string;
  // Each appends the prompt's own button (label, variant, key anchor in the prompt's scope) to `parent`.
  keepButton(parent: HTMLElement): HTMLButtonElement;
  confirmButton(parent: HTMLElement): HTMLButtonElement;
}
// ConfirmPromptDeps gains:
drawBody?(parent: HTMLElement, parts: ConfirmBodyParts): void;
// ConfirmPrompt gains: empties the body and actions and draws them again, as after a new layout.
redraw(): void;
```

No other task edits `list-picker.ts` or `confirm-prompt.ts`.

Reasons for each **(changed)** item:

- `build` takes the rollback recorder and returns the owner's own built object: the host makes a fresh recorder for
  each attempt, so a fallback never undoes the first attempt's work twice. Forms needs its card's `update` and kit
  back, and chat its entry view and kit. `rollback` leaves the options for the same reason.
- `drawPart` returns `dispose`: the recorder already holds every anchor and box the drawn part made, so the owner
  disposes them through it on a redraw and when the view goes, and keeps no second list.
- `owner` joins the options: `drawPart` sets `data-layout-owner` on each part root, so two owners' layouts of one
  name never share selectors. `pick` names only the layout, and `logSource` is a log name, so neither carries the
  owner.
- `keys.keysFor` returns `string | null` and `label` takes `boolean | string`: these are the shapes of
  `KeysPageExports` today (`src/plugins/keys/contract.ts`). The host restates them because `src/shared/page` may not
  import a plugin's contract.
- `KitCommands` and `commandRunner` keep today's shapes (`src/plugins/forms/page/layout/kit-commands.ts`): the kit's
  `command(id)` throws `no command <id>` while the part builds, so the part falls back to `default`. A runner that
  checks only at run time would let a part with a bad id draw.
- `keyHint` takes an options object: docs and other owners draw hints with labels. No built-in layout calls
  `keyHint` with a class name today, so the change touches only forms' kit and tests (task 03).
- An owner's repo `layout.d.ts` writes `import type { BaseKit } from '../../../shared/page/layout-host/kit';`. That
  specifier resolves from `src/plugins/<owner>/layouts/` and from `src/renderer/shell/layouts/` alike. The registry
  rewrites it to `'../kit'` when it writes `layouts/<owner>/layout.d.ts`. A repo file that wrote `'../kit'` would not
  compile in the repo, since `src/plugins/<owner>/kit.d.ts` does not exist.

## Decisions

- **Folder.** `main.ts` gets one `configFolder(homeDir)` (`<homeDir>/.config/wigley-ai-gui`), used by
  `configStoreDeps` and by the layouts folder `<configFolder>/layouts`. The self-test and a drive run get their own
  layouts folder from their temp home with no further code. The ConfigStore's watch already ignores `layouts/`.
- **Service.** `createLayoutService` writes `kit.d.ts` at its folder's root at creation; a failed write is logged
  under source `layouts` and changes nothing else. `register(owner, layoutTypes)` starts one registry over
  `scopedFiles(files, <folder>/<owner>, paths)` with `logSource` = owner, so forms' lines stay `[forms] …`. When the
  registry has listed, the service sends that owner's first set (`changed: null`). `register` throws
  `layouts of <owner> already registered` for a second registration and `<owner> is no layout owner` for an owner
  that is not lowercase letters, digits and `-`. Disposing the registration closes the watch and drops the owner:
  `names` reads `['default']` and `read` resolves null. `names` reads `['default']` before the first listing and for
  an unregistered owner. `read` resolves the current set once listed, else null. A registry start that fails is logged
  as `<owner>: layouts not started: <error>` under the owner's source, as forms and chat log today.
- **Wiring.** `main.ts` creates the service in `createWindow` before `startMainParts`, with `send` going through
  `livePage(window)` on `BRIDGE_CHANNELS.layoutsChanged` with `(owner, set)`, and handles
  `BRIDGE_CHANNELS.layoutsRead` with `service.read(owner)`. It disposes the service on quit and on self-test exit,
  after the parts. `main.ts` imports `kit.d.ts?raw` and hands it as `kitTypes`. `startApp` calls
  `serveLayoutScheme(<configFolder>/layouts, paths)` beside `serveDataScheme`.
- **Main API.** `createMainApi` takes a `layouts: LayoutService` dep: `register` calls
  `layouts.register(manifest.id, options.layoutTypes)`, `names` calls `layouts.names(manifest.id)`.
- **Bridge.** The page asks for an owner's set with `layouts(owner)` and hears every owner's set on one
  `onLayouts` listener. The old per-plugin `layout()` invoke and `layoutChanged` message go from `FormsChannel` and
  `ChatChannel`, with forms' `LayoutEntry, LayoutSet` re-export.
- **Page layouts.** `createPageLayouts` takes one bridge listener and hands each set to the live shows of its owner.
  `show(owner, options)` runs today's `showLayouts` logic over a loader for that owner, with
  `layoutUrl(name, revision, path)` bound to the owner, `namesInUse` defaulting to `[]`, `log` and `logSource` = the
  owner, and today's log and toast lines unchanged. A `read` that resolves null waits for the owner's first set. A
  read that rejects logs `layout not read: <error>` as today. `LayoutShow.dispose()` stops the show hearing sets,
  removes its stylesheet links and calls `setLayouts` no more.
- **Page API.** `createPageApi` takes a `layouts: PageLayouts` dep. `api.layouts.show(options)` calls
  `layouts.show(manifest.id, options)` and refreshes the show on each change of the plugin's settings, until the
  show's `dispose`. So a plugin no longer calls `refresh` from `onSettingsChanged`; forms still calls it on each
  store change, since `namesInUse` reads its rounds. `renderer.ts` builds the page layouts with
  `importModule: (url) => import(/* @vite-ignore */ url)`, `head: document.head`, and the page's log and toast.
- **Links.** Each link keeps `data-layout="<name>"` and gains `data-layout-owner="<owner>"`, so two owners' layouts
  of one name keep separate links.
- **Layout CSS.** Every part root carries `data-layout="<name>"` and `data-layout-owner="<owner>"` (see drawPart). A
  layout's `layout.css` selects under `[data-layout-owner="<owner>"][data-layout="<name>"]`, so it restyles nothing
  that another owner's layout of the same name drew. The shell's chrome areas carry the same two attributes
  (task 13).
- **drawPart.** It draws `part(pick.layout)` when defined, else `part(defaultLayout)` with name `default`. Each
  attempt runs `build` with a fresh recorder and then `requireElementIn(parent, built.element, partName)`. On a throw
  it runs each recorded `destroy`, disposes each recorded anchor, removes the nodes the attempt appended to `parent`,
  logs `layout <name> <partName> failed: <error text>` under `logSource`, and draws with `default`. A throw from the
  `default` attempt rolls back the same way and is rethrown, with no log and no second attempt. The returned
  element carries `data-layout` naming the layout that drew it and `data-layout-owner` holding `options.owner`. The
  owner passes its own id (`forms`, `chat`, `shell`); the logSource is often the same text, but `drawPart` reads
  only `owner` for the attribute. `drawPart` throws `layout default has no <partName>`
  when `part(defaultLayout)` is undefined and the pick lacks the part.
- **Disposing a drawn part.** `drawPart` keeps the successful attempt's recorder and returns its `dispose`. An owner
  calls the previous draw's `dispose` before it draws the same part again (a redraw, a new layout, a new input), and
  when the view goes. The owner then removes or replaces the old element itself. So no owner keeps its own list of a
  part's anchors and boxes.
- **requireElementIn.** Throws `<partName> returned no element` for a value that is not an `HTMLElement`, and
  `<partName>'s element is not appended to parent` for one whose parent node is not `parent` (forms' texts today).
- **pickLayout.** Walks `chain` up to `default`; returns the first name `layouts` holds whose layout `defines`; else
  `{ name: 'default', layout: <default> }`. Throws `layout default is not loaded` when `layouts` lacks `default`.
- **readLayoutModule.** Returns `module.default` when it is a record; else throws
  `layout <name>: the default export is missing or not an object`.
- **createBaseKit.** The members of forms' `createHeadKit` today, with `formsCommandNamed` replaced by
  `deps.commandNamed`, `deps.keysFor(id)` by `deps.keys.keysFor(id, deps.scope)`, and the anchor by
  `deps.keys.anchor(node, id, { scope: deps.scope })`. `section` draws as forms' `buildSection` draws today
  (`section.context` holding the section header and a `div.context-body.md`), and returns null for blank text.
  `keyHint` passes `{ scope: deps.scope, label: options.label }` to the anchor and gives the span
  `options.className`. `statusDot`, `setDotStatus` and `row` append the `statusDot`, `setDotStatus` and `row`
  primitives (`src/shared/page/ui/status-dot.ts`, `row.ts`) to `parent`. `createBaseKit` holds no state and builds
  nothing until a member is called, so an owner calls it once per part draw. `deps.scope` is the qualified scope id
  the part's keys fire in (`docs.tree`); an owner with parts in several scopes makes one kit per part. With `scope:
  null` the kit anchors with no `scope` option, so the hint shows in every scope (the title bar's Keys button), and
  reads keys with `keysFor(id)`.
- **Kit commands.** An owner builds `KitCommands` from its page API: `exists: (id) => api.keys.command(id) !==
  undefined`, `run: (id) => api.commands.run(id)`, as forms' `page/start.ts` does today.
- **Repo type checks.** Each owner's `layouts/layout.d.ts` in the repo imports `BaseKit` and the shared kit types from
  `'../../../shared/page/layout-host/kit'`, and its `layouts/default/layout.js` (`// @ts-check`) imports types from
  `'../layout'` as today. Both resolve in the repo with no tsconfig change. The registry rewrites the kit specifier
  to `'../kit'` in the copy it writes to `layouts/<owner>/layout.d.ts`, where `layouts/kit.d.ts` sits one folder up.
- **Page-only owners.** `gallery` and `keys` get a main part each, `src/plugins/<id>/main/start.ts`, listed in
  `src/plugins/main.ts` after `notesMainPart`. Each `start` imports `../layouts/layout.d.ts?raw`, calls
  `api.layouts.register({ layoutTypes })`, and returns `{ commands: {}, dispose }` disposing the registration. This
  task creates each `layouts/layout.d.ts` as a placeholder holding one comment line and `export {};`; tasks 11 and 12
  fill it and edit neither the main part nor `src/plugins/main.ts`. A main part keeps the registration path the same for every plugin; a manifest field would be
  a second path.
- **List picker.** `draw` empties the list, then for each visible item calls `request.drawRow(list, item, { label,
  trailing, recordAnchor })` when set, else draws today's row. Before each draw pass the picker disposes every anchor
  recorded for the rows of the pass before, and it disposes the rest when it closes. The owner never disposes a row's anchors. On the returned element the picker sets `title`, toggles
  `is-selected` and `is-cursor`, and adds the click that chooses the item, as it does on its own row today. The
  owner's `drawRow` goes through `drawPart`, which owns the fallback to `default`. `redraw()` runs `draw` for the open
  request and does nothing while closed.
- **Confirm prompt.** With no `drawBody`, the prompt draws as today. With `drawBody`, `redraw` (and creation) empties
  the dialog's body and actions, disposes the anchors of the buttons it drew before, and calls
  `drawBody(dialog.body, parts)`. A button the layout did not draw through `parts` is appended to the actions, so
  both commands always hold an anchor on the page. The owner's `drawBody` goes through `drawPart`.
- **Failure log once.** `drawPart` logs a failure once per layout object and `partName`: it keeps a module-level
  `WeakMap<object, Set<string>>` keyed by `pick.layout`. The loader makes a new layout object for each revision, so a
  saved fix or a new break logs again, and a part redrawn many times under one revision logs once. So `L extends
  object` in `drawPart` and `DrawPartOptions`. The fallback and the rollback run on every failure; only the log line
  is once.
- **Registry.** The `default` folder log becomes `layouts/<owner>/default is ignored; the built-in default layout wins`.
  When writing `layout.d.ts`, it replaces every `'../../../shared/page/layout-host/kit'` in `layoutTypes` with
  `'../kit'`.
- **Scheme and CSP.** `wigley-layout:` is a new scheme, not a host on `wigley-data:`: the layouts folder is core and
  owners include `shell`, which has no plugin data folder. `wigley-data:` and `api.dataUrl` stay for plugin data.
  The CSP becomes:
  `default-src 'self'; script-src 'self' wigley-data: wigley-layout:; style-src 'self' 'unsafe-inline' wigley-data: wigley-layout:; font-src 'self' data: wigley-layout:; img-src 'self' data: wigley-layout:; connect-src 'self' ws://localhost:*`.
  Images and fonts join because the registry already reloads on a layout's image and font saves, and a layout's CSS
  can name them.
- **Forms.** Main drops `serveLayouts` and its registry; `layoutNames` becomes `() => api.layouts.names()`, which
  still feeds `withKnownLayouts` and the preview, so `requireKnownLayouts` reads the folder's names as before. In
  the self-test, forms writes `SELFTEST_LAYOUTS` with `services.files` under
  `<homeDir>/.config/wigley-ai-gui/layouts/forms/` first, then calls `register`; otherwise it registers at once.
  `SELFTEST_LAYOUTS` paths drop their `layouts/` prefix (`selftest/layout.js`); `layoutSave` writes
  `.config/wigley-ai-gui/layouts/forms/<path>`, as the script's settings and keymap files name the config folder
  today. `dispose` disposes the registration. Page: `api.layouts.show<Layout>({ defaultLayout, read: readLayout,
  userLayout: () => api.settings().layout, namesInUse: <as today>, setLayouts: (shown) => view.setLayouts(shown) })`.
  The tool contract's `layout` names are unchanged.
- **Forms refusal text.** `requireKnownLayout` says `Write ${name}/layout.js there first, or leave layout out.` in
  place of `Write layouts/${name}/layout.js there …`: the folder it names is now `layouts/forms/`, so the old path
  is wrong.
- **Chat.** Main drops `serveLayouts` and registers `{ layoutTypes }`; `dispose` disposes the registration. Page:
  `api.layouts.show<ChatLayout>({ defaultLayout, read: readChatLayout, userLayout: () => api.settings().layout,
  setLayouts: <as today> })`.
- **LAYERS** (`scripts/check-layers.mts`), so no later task edits the file:
  - new `src/shared/page/layout-host`: layers `src/contracts`, `src/shared`, `src/shared/page`,
    `src/shared/page/ui`.
  - `src/shared/page` adds `src/shared/page/layout-host` (the confirm prompt takes its look through the host).
  - new `src/main/layouts`: layers `src/contracts`, `src/shared`.
  - `src/main/main.ts` adds `src/main/layouts`, `src/shared/page/layout-host` (the `?raw` kit) and
    `src/renderer/shell/layouts` (the shell's `?raw` contract, task 13). `main.ts` is a layer of its own, so the
    `src/main` entry gets neither.
  - `src/renderer` (which holds `src/renderer/shell/`) adds `src/shared/page/layout-host` and
    `src/renderer/shell/layouts`; `src/renderer/renderer.ts` adds `src/shared/page/layout-host` and
    `src/renderer/shell/layouts` (the shell's `default` layout, task 13).
  - each owner `forms`, `chat`, `primer`, `docs`, `backlog`, `settings`, `notes`, `sessions`, `gallery`, `keys`:
    `src/plugins/<owner>/layouts` with layers `['src/shared/page/layout-host']` (replacing the empty entries of forms
    and chat); its `page` layer adds `src/plugins/<owner>/layouts` and `src/shared/page/layout-host`; its `main`
    layer adds `src/plugins/<owner>/layouts` (for the `?raw` contract; main imports nothing from the host). An
    owner's `page/layout/` folder is inside its `page` layer, since a file belongs to the longest matching entry.
  - `gallery` and `keys` have no main part today. Add `src/plugins/gallery/main` and `src/plugins/keys/main`
    (layers `src/contracts`, `src/shared`, `src/plugins/<owner>`, `src/plugins/<owner>/layouts`) and list both,
    with `src/plugins/gallery` and `src/plugins/keys`, in `src/plugins/main.ts`'s layers, for tasks 11 and 12.
  - new `src/renderer/shell/layouts`: layers `['src/shared/page/layout-host']`.

GIVEN forms and chat registered and a user writes `~/.config/wigley-ai-gui/layouts/chat/x/layout.js`
WHEN the watch reports it
THEN main sends `('chat', set)` holding `x` at revision 1, with `changed: 'x'`, and sends nothing for forms.

GIVEN the page loads before forms has registered
WHEN forms' show reads its set
THEN the read resolves null, and the show loads once main sends forms' first set.

GIVEN a picked rail that mounts a box, names an anchor, appends a node, and throws
WHEN `drawPart` draws it
THEN the box's destroy runs, the anchor is disposed, the node is gone, `[forms] layout fancy rail failed: boom` is
logged, and the default rail's element is returned with `data-layout="default"` and `data-layout-owner="forms"`.

## Tests

Host cases are written here once; tasks 03 and 04 delete their copies and add no host cases.

- `layout-service.test.ts` (memory files):
  - `create_WritesKitTypes` — `<folder>/kit.d.ts` holds `kitTypes`. Break: kit never written.
  - `register_ListsOnlyItsOwnersFolder` — forms and chat registered over one folder; each set lists only its own
    owner's layouts. Break: a registry rooted at `layouts/`.
  - `register_SendsFirstSetWithOwner` — after the listing, `send` got `('forms', { changed: null, … })`. Break: no
    first send, so a page that read null waits for ever.
  - `register_SameOwnerTwice_Throws`.
  - `register_BadOwner_Throws` — rows `''`, `'a/b'`, `'..'`, `'Forms'`. Break: an owner path escaping the folder.
  - `save_SendsOnlyThatOwnersSet` — a save under `chat/x/` sends `('chat', …)` and nothing for forms.
  - `names_UnregisteredOrUnlisted_IsDefault` and `read_UnregisteredOrUnlisted_IsNull` — rows: never registered,
    registered but not listed, registration disposed. Break: a stale registry kept after dispose.
- `layout-registry.test.ts`: existing cases with the root moved from `layouts/` to the scoped folder's root; add
  `start_LayoutTypes_KitSpecifierRewritten` — a text holding the repo specifier twice is written holding `'../kit'`
  twice and no repo specifier. Break: unrewritten import, a broken `layout.d.ts` in the user's folder.
- `layout-url.test.ts`: `layoutUrl_EncodesSegmentsAndPutsRevisionAfterName`; `layoutFilePath_RoundTripsLayoutUrl`;
  `layoutFilePath_Refused_ReturnsNull` — rows: other scheme, no revision segment, `..` host, encoded `/` in a
  segment, encoded `\`, a path whose `..` climbs out of the layout's folder; `layoutFilePath_WindowsRoot_JoinsWithBackslash`.
  Break: a URL that reads a file outside `<owner>/<name>/`.
- `main-api.test.ts`: `createMainApi_Layouts_RunUnderThePluginId` — a fake service records owner `p` for
  `register` and `names`.
- `page-api.test.ts`: `createPageApi_LayoutsShow_RunsUnderThePluginIdAndRefreshesOnItsSettings` — a fake page
  layouts records owner `p`; a change to `p`'s settings calls `refresh`, another plugin's does not, and none does
  after `dispose`.
- `layout-loader.test.ts`: the moved cases, the URL fake now `layoutUrl`; add `load_StylesheetLink_NamesOwner` —
  the link carries `data-layout-owner`.
- `show-layouts.test.ts`: the moved `showLayouts_*` cases over a fake bridge; add `show_ReadNull_WaitsForFirstSet`,
  `show_OtherOwnersSet_Ignored`, `show_Dispose_StopsSetsAndRemovesLinks`.
- `draw-part.test.ts`: `drawPart` as one table — rows: picked part draws (marked with the pick's name and the
  owner); pick lacks the part (default draws, no log, marked `default` and the owner); picked throws after mounting, anchoring and appending (all rolled back, logged,
  default draws); picked returns an element not in `parent` (logged with the not-appended text, default draws);
  default throws (rolled back, rethrown, `build` called once). `drawPart_Dispose_DisposesOnlyTheSuccessfulAttempt` —
  rows: picked draws after recording one anchor and one box (`dispose` disposes the anchor and runs the box's
  `destroy` once each; a second `dispose` does nothing); picked throws after recording, default records its own
  (`dispose` touches only default's, since the rollback already disposed the picked attempt's). Break: an owner's
  redraw that leaks anchors, or disposes an anchor twice. `drawPart_SameLayoutFailsTwice_LogsOnce` — two
  failing draws of one layout object log one line and fall back twice; a new layout object logs again. Break: a log
  per render, or a fix in a new revision never logged when it breaks again. `requireElementIn_Rejects` — rows: `undefined`, a
  string, an element in another parent.
- `pick.test.ts`: `pickLayout` table — rows: first defining name wins; unloaded name skipped; a name after
  `default` never reached; nothing defines (default returned); `layouts` lacks `default` (throws).
- `read-layout-module.test.ts`: table — rows: `null`, `{}`, `{ default: 3 }` (throw); `{ default: { a: 1 } }`
  returns `{ a: 1 }`.
- `list-picker.test.ts`: `drawRow_DrawsEachVisibleItemAndKeepsCursorAndClick` — with `drawRow` set, each visible
  item's row is the one `drawRow` returned, the cursor row carries `is-cursor` and the `cursorEnd` element in
  `trailing`, and a click on a row chooses its item. Break: the hook ignored, or the picker's classes and click lost
  on an owner's row.
- `list-picker.test.ts`: `drawRow_AnchorsRecordedInARowDraw_DisposedOnNextDrawAndOnClose` — a `drawRow` that records
  one anchor per row: a filter change or `redraw()` disposes the anchors of the pass before, once each, and closing
  disposes those of the last pass. Break: row anchors that leak, or are disposed twice.
- `confirm-prompt.test.ts`: `drawBody_ButtonLeftOut_AppendedToActions` — a `drawBody` that draws only the keep
  button leaves the confirm button in the actions with its anchor; `redraw_DisposesTheEarlierButtonsAnchors`.
  Break: a command with no anchor, or anchors leaking across redraws.
- `base-kit.test.ts`: `commandRunner_UnknownId_ThrowsAtCreationAndRunsOnlyOnCall`;
  `keyHint_AnchorsTheNamedCommandInScope` — rows: known short name (anchor with the qualified id, the scope and no
  label), known name with `label: 'Open'` (anchor with that label, span with the class), unknown name (empty span,
  no anchor); `keys_ReadsInScope` — rows: bound, unbound, unknown name;
  `section_BlankText_DrawsNothing`.

Done when: `npm test` and `npm run lint` pass. `grep -rn "layoutChanged\|layout(): Promise" src` prints nothing.
`grep -rln "startLayoutRegistry" src --include='*.ts' | grep -v '\.test\.ts'` prints only
`src/shared/layouts/layout-registry.ts` and `src/main/layouts/layout-service.ts`. `src/shared/page/layout-loader.ts`
is gone. The live checks go to task 17 (Final verification).

Commit: one commit for the group.

## Proof
