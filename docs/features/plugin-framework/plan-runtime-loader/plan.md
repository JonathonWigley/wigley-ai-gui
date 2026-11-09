# Runtime plugin loader — plan

Feature: plugin framework, Wave 4 step 3 of `docs/features/intent-alignment/master-plan.md` · Implements: none · Ticket: none
Target: `main` of wigley-ai-gui · Written: 2026-11-09

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

**Contents**

- **Goal** — what the loader lands, and the three follow-ups it closes.
- **Architecture** — the systems this plan touches.
- **Preconditions** — the repository state the plan rests on, with the commands that verify it.
- **Docs written ahead** — the docs committed before the plan.
- **Mandatory Reads** — the rule files every implementer reads.
- **Design Overview** — the after-state flow, the decisions and what is out of scope.
- **File Structure** — every shared name and signature, new folders, and the files each task touches.
- **Tasks** — the checklist by wave.
- **Run log** — written by `wigley:make`.

## Goal

Load plugins at runtime from `~/.config/wigley-ai-gui/plugins/<id>/`, and reload them with new code:

1. A user plugin (`manifest.json`, optional `main.js`, optional `page.js`, optional `layouts/default/`) loads at start.
2. A save under its folder reloads it once the edits settle. The `core.reloadPlugin` command reloads it with no change.
3. A reload stops the plugin's dependents first, swaps the code, and starts them all again.
4. A load that fails keeps the last good version and shows the error as a config problem and on the Settings row.
5. A user plugin with a built-in's id replaces the whole built-in.
6. The app writes `plugin.d.ts`, every contract's `.d.ts` and `manifest.schema.json` to `plugins/_types/` at start.
7. Settings and binds under a plugin that is not loaded are kept and ignored.

The plan also closes three follow-ups in `docs/features/followups.md` that a user-run reload exposes:

- **A page part started live gets no restore window** — every live start opens a restore window.
- **A restart leaves a page part's keys with no handler** — the binds leave at the page stop and return at the start.
- **Visual reads chat's focused entry through a slot** — no plugin holds another plugin's DOM element across a reload.

## Architecture

Systems touched:

- **Contracts** (`src/contracts/`): `plugin.ts`, `plugin-catalog.ts` (new), `user-plugin.ts` (new), `core-state.ts`, `bridge.ts`,
  `settings.ts`, `commands.ts`.
- **Plugin host** (`src/shared/plugin-host.ts`): live add and remove of parts.
- **Plugin catalog** (new): `src/shared/plugin-catalog/` (manifest checks and schema, pure) and
  `src/main/plugin-catalog/` (the module import, the two sources, the catalog, the types writer).
- **Main core**: `main.ts`, the ConfigStore and its checks (`src/main/config/`), the plugin switch and its drive
  actions (`src/main/plugins/`), `page-parts.ts`, the data protocol (`src/main/data-protocol/`), the LayoutService
  (`src/main/layouts/`), core commands (`src/config/`).
- **Page core**: `renderer.ts`, `page-restores.ts`, `plugin-parts-answer.ts`, `index.html` (CSP).
- **Shared**: `plugin-manifests.ts` (served config, keymap layers), `define-plugin.ts`, a new `plugin-url.ts`.
- **Page shell**: `src/renderer/shell/modes.ts` (the shown mode survives a restart).
- **Plugins**: `sessions`, `chat` and `docs` page parts (prune on settle), `chat` and `visual` (focused entry slot),
  `settings` page (Plugins rows).
- **Build**: `forge.config.mts`, `.gitignore`, a new `tsconfig.plugin-types.json`.
- **Self-test and drive**: a fixture user plugin and its script steps.
- **Layer check** (`scripts/check-layers.mts`): two new core layers.

## Preconditions

`wigley:make` re-runs each command before the first dispatch. `<gui>` is the wigley-ai-gui clone or worktree.

- The docs written ahead are in the tree: `git -C <gui> log --oneline -1 -- docs/features/plugin-framework/design.md`
  shows `f9de483c` or a later commit.
- The static lists still feed main: `grep -n "requireListed(mainParts, manifests)" <gui>/src/main/main.ts` finds one
  line (line 595 at plan time).
- The page imports its parts statically: `grep -n "from '../plugins/page'" <gui>/src/renderer/renderer.ts` finds one
  line.
- Main has no dynamic import yet: `grep -rn "import(" <gui>/src --include=*.ts | grep -v test | grep -v "import(/\* @vite-ignore \*/ url)" | grep -v "declarations.d.ts"`
  prints nothing.
- The page CSP allows two code schemes: `grep -c "script-src 'self' wigley-data: wigley-layout:;" <gui>/index.html`
  prints `1`.
- The three follow-ups are still open: `grep -c "A page part started live gets no restore window\|A restart leaves a page part's keys with no handler\|Visual reads chat's focused entry through a slot" <gui>/docs/features/followups.md`
  prints `3`.
- The restores host has no reopen: `grep -c "reopen" <gui>/src/renderer/page-restores.ts` prints `0`.

## Docs written ahead

Commits `f9de483c` and `eb5988ec` (the named `start(api)` export, in `AGENTS.md` and `design.md`):

- `docs/features/plugin-framework/design.md` § Runtime loader (Wave 4 step 3) — every settled decision.
- `AGENTS.md` — the Intent's hot reload line, the "A plugin" bullet's list sentence, and the new "A user plugin"
  bullet.
- `docs/features/followups.md` — the Runtime plugin loader item's reload sentence.
- `docs/features/intent-alignment/master-plan.md` — the Plans paragraph.

## Mandatory Reads

Every implementer reads these before its first edit:

- `AGENTS.md` at the repo root: § Intent, and § Architecture's bullets "A plugin", "A user plugin", "A
  registration", "A disabled plugin", "A plugin talks", "A slot", "A command", "Plugin data", "A layout", and the
  layer-check bullets. A task that adds a self-test step also reads § Running and testing.
- `docs/features/plugin-framework/design.md` § Hot reload (Wave 4) and § Runtime loader (Wave 4 step 3).
- `DESIGN.md`, for tasks 12 and 15 (a Settings row's look).
- The skills `wigley:writing-code`, `wigley:codebase-design` and `wigley:writing-tests`, read from the marketplace
  clone `/Users/jonathonwigley/Documents/ai-dev/wigley-ai-marketplace/plugins/wigley/skills/<skill>/SKILL.md`.

The repo has no `CLAUDE*.md` and no `.claude/rules/`.

Test rules for every task: run the tests a task adds or edits, and the tests of the code it changes, by name
(`npm test -- <file>`). The self-test runs filtered to the touched plugins (`npm run selftest -- --plugin <id>`);
the whole self-test runs only when the user asks for it in the current turn. No task installs a package: TypeScript,
Vite and Forge are already in `devDependencies`, and a new package is a stop and an ask.

## Design Overview

After-state flow at start and on a save:

```
 ~/.config/wigley-ai-gui/plugins/<id>/          src/plugins/{manifests,main,page}.ts
          │ watch, settle                                │
          ▼                                              ▼
   user-folder source ───────────┐        ┌──── built-in source (requireListed)
   (read manifest.json,          │        │
    validateManifest,            ▼        ▼
    copy to plugin-code/<id>/<rev>/, ─► plugin catalog  (user wins by id; problems kept;
    import main.js, read `start`)         │              last good entry kept on a failed load)
                                          │ onChanged({ added, removed, reloaded })
                    ┌─────────────────────┤                          ┌── types writer (start only)
                    ▼                     ▼                          ▼
             ConfigStore  ◄──setPlugins── plugin switch          plugins/_types/: plugin.d.ts,
        admits entries, rebuilds          main host: remove /    contracts .d.ts,
        schema and served config;         add / start; page over manifest.schema.json
        ignores absent plugins'           bridge:plugin-parts
        settings and binds                (stop, reload, remove, start)
                                          │
                                          ▼
                              page: imports page.js from
                              wigley-plugin://<id>/~<rev>/page.js,
                              page host remove / add on `reload`;
                              on `start`: restores.reopen() → parts start → partsReady()
```

A reload, in order (task 10 owns the detail): the switch pauses the binds of the plugin and its dependents and gives
the config store the new entries. When the store refuses the new entry, the reload stops nothing and the old version
runs. Else the switch asks the page to stop their page parts, removes the main part from the host (which stops its
main dependents), adds the new main part, and starts the main parts it stopped. When the new main part runs, the
switch asks the page to `reload` (the page imports the new module and swaps its part, starting nothing) and to
`start` (the page reopens the restore window and starts the parts). When the new main part fails to start, the switch
puts the last good part back the same way, and the page keeps its old part. A load
that fails in the source stops nothing: the old entry stays in the catalog and running, and the catalog records the
problem.

Decisions (each settled in the interview or the design review):

- Only user-folder plugins load at runtime; built-ins stay compiled (round 1).
- Reload on save and by `core.reloadPlugin`, unbound by default, also a drive action (round 1).
- A user plugin with a built-in's id replaces the whole built-in (round 1). Origin `replaces-built-in`.
- `manifest.json` with an app-written JSON Schema; `validateManifest` at load (round 1).
- Every built-in contract emitted as `.d.ts` at build time and written to `plugins/_types/` at start (round 1).
- A reload keeps the user's work and place: a restore window per live start (rounds 1 and 2).
- A user plugin draws only through its layout kit, its default layout in its own `layouts/default/` (round 2).
- A page part reaches its layout kit through the show's `draw`, not as a bare kit: `draw` keeps `drawPart`'s
  rollback and fallback in one place, and every type it names lives in `src/contracts/plugin.ts`, so task 07's
  emitted types hold it (a contract naming `BaseKit` from `kit.d.ts` would emit as `any`).
- Main imports from a per-revision copy of the folder under the app instance's user data folder (`plugin-code/`), so
  relative imports reload too. Old revisions stay in memory until quit, and their folders stay on disk (a follow-up,
  written by task 15) (Decided).
- Page code loads on a new `wigley-plugin:` scheme with the revision in its path (Decided).
- A reload stops dependents too (Decided).
- A bad load keeps the last good version (Decided).
- A built-in never depends on a user plugin (Decided).
- Settings and binds under a plugin that is not loaded are kept and ignored (Decided).
- Default keys of a replaced built-in apply only to commands the replacement declares (Decided).
- Deleting a plugin's folder stops it and clears its slots, as a switch-off does (Decided).
- A user plugin bundles its own packages; the loader resolves no bare specifier (Decided).
- A user plugin's `main.js` import that does not settle in 5 s fails the load (Decided, task 08).
- A user replacement whose dependency is gone gives way to the built-in, with a problem (Decided, task 08).
- User plugins and their dependents start after launch, one at a time, so one bad user plugin cannot fail the app
  start (Decided, tasks 10 and 11).
- Design review: the `PluginSource` seam has two adapters (built-in, user folder) and a test fake, so it is a real
  seam. The catalog is a deep module: three readers, one `onChanged`. The host grows by two members, `add` and
  `remove`; a swap is `remove`, `add`, `start`, so a third `reload` member would have no caller. `validateManifest`
  is pure, so its cases are one table test.

Out of scope:

- Hot reload of built-in plugins (the follow-up "Built-in plugin hot reload", written by task 15).
- A sandbox for user code.
- npm package resolution for user plugins.
- A key for `core.reloadPlugin` (unbound by default; the user binds it in `keymap.json`).
- Deleting old revision folders (the follow-up "Old plugin code revisions stay on disk", written by task 15).
- Lanes H, P, L and E of the master plan.

## File Structure

### Shared names

Every name below is used by more than one task. A task that produces it writes it exactly as here. The producing
task's document holds the full doc comments.

`src/contracts/plugin-catalog.ts` (new, task 08):

```ts
export type PluginOrigin = 'built-in' | 'user' | 'replaces-built-in';

// One plugin the catalog holds now. `revision` grows with each load of a user
// plugin and is 0 for a built-in. `main` is null when the plugin has no main
// part. `pageUrl` is the `wigley-plugin:` URL of a user plugin's page.js, null
// for a built-in or a plugin with no page.js.
export interface CatalogEntry {
  readonly manifest: PluginManifest;
  readonly origin: PluginOrigin;
  readonly revision: number;
  readonly main: MainPart | null;
  readonly pageUrl: string | null;
  readonly folder: string | null; // the user folder, null for a built-in
}

export interface CatalogProblem {
  readonly id: string;
  readonly message: string;
}

// Each id sorted by whether it was in the catalog before and after the load.
// A replacement of a built-in, and its removal, are `reloaded`. A change of
// `problems()` alone fires with three empty lists.
export interface CatalogChange {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly reloaded: readonly string[];
}

export type SourceLoad =
  | { readonly kind: 'loaded'; readonly entry: Omit<CatalogEntry, 'origin'> }
  | { readonly kind: 'failed'; readonly id: string; readonly message: string }
  | { readonly kind: 'gone'; readonly id: string };

export interface PluginSource {
  loadAll(): Promise<readonly SourceLoad[]>;
  watch(listener: (load: SourceLoad) => void): Disposable;
  reload(id: string): Promise<SourceLoad>;
}

export interface PluginCatalog {
  entries(): readonly CatalogEntry[];
  manifests(): readonly PluginManifest[];
  problems(): readonly CatalogProblem[];
  entry(id: string): CatalogEntry | undefined;
  onChanged(listener: (change: CatalogChange) => void): Disposable;
  // Rejects for a built-in id ("…built in; it reloads only with a rebuild")
  // and for an unknown id ("No plugin "<id>"").
  reload(id: string): Promise<void>;
}

// What the page needs about each plugin, served in `AppConfig.plugins`.
export interface ServedPlugin {
  readonly id: string;
  readonly origin: PluginOrigin;
  readonly revision: number;
  readonly pageUrl: string | null;
  readonly manifest: PluginManifest;
}
```

`src/contracts/user-plugin.ts` (new, task 08): `UserMainApi`, `UserMainStart`, `UserPageApi`, `UserPageStart`,
`UserMainModule { start(api: UserMainApi): UserMainStart }` and `UserPageModule`. A user `main.js` and `page.js` each
export a named `start(api)`; a module whose `start` is not a function is a failed load.

`src/main/plugin-catalog/` (new, task 08): `createBuiltInSource({ manifests, mainParts })` (it calls
`requireListed`), `createUserFolderSource(deps: UserFolderSourceDeps)` with `PLUGIN_SETTLE_MS = 300` and `PLUGIN_IMPORT_TIMEOUT_MS = 5000` (fail text
`main.js did not finish importing in <n> ms`), and
`startPluginCatalog({ builtIn, user, log }): Promise<PluginCatalog & Disposable>`. Log lines under the source
`plugin-catalog`: `plugin <id> loaded at revision <n>` and `plugin <id> failed: <message>`.

`src/shared/layouts/layout-registry.ts` (task 08): `isLayoutFileName(fileName)` is exported.

`src/shared/plugin-url.ts` (new, task 08; task 11 adds `pluginFilePath`):

```ts
export const PLUGIN_SCHEME = 'wigley-plugin';
export function pluginUrl(pluginId: string, revision: number, path: string): string; // task 08
export function pluginFilePath(url: string, codeRoot: string, paths: Paths): string | null; // task 11
```

`src/shared/define-plugin.ts` (task 02): `PLUGIN_ID_PATTERN` and `pluginIdProblem(id)`, the one home of the id rule;
`definePlugin`, `validateManifest` and `layout-service.ts`'s `OWNER` all use it.

`src/shared/plugin-catalog/validate-manifest.ts` (new, task 02):

```ts
export type ManifestCheck =
  | { readonly ok: true; readonly manifest: PluginManifest }
  | { readonly ok: false; readonly problems: readonly string[] };
// The shape of a command or scope short id; the scope name `any` is refused.
export const SHORT_ID_PATTERN = '^[A-Za-z][A-Za-z0-9]*$';
// Accepts a top-level "$schema" string and drops it from the manifest.
export function validateManifest(raw: unknown): ManifestCheck;
export function handlerProblems(
  manifest: PluginManifest,
  process: ProcessName,
  commands: object,
): string[];
```

`src/shared/plugin-catalog/manifest-schema.ts` (new, task 02): `export const manifestSchema: object`.

`src/main/plugin-catalog/import-module.ts` (new, task 01):
`export function importModuleFrom(filePath: string): Promise<Record<string, unknown>>`.

`src/shared/plugin-host.ts` (task 03): `PluginHost<Started, Part = unknown>` adds `add(part: Part): void` and
`remove(pluginId: string): Promise<string[]>`. `startPlugins`' `known` becomes
`readonly PluginManifest[] | (() => readonly PluginManifest[])`, read at each check. `start(ids)` throws
`depends on plugins not in the list` for an unknown dependency.

`src/renderer/page-restores.ts` (task 04): `PageRestoresHost.reopen(): void`.
`src/renderer/plugin-parts-answer.ts` (task 04): `PluginPartsAnswerDeps.restores: Pick<PageRestoresHost, 'reopen' | 'partsReady'>`;
task 11 adds `served()` and `loadPart()` to the deps.
`src/plugins/chat/contract.ts` (task 04): `ChatChannel.invoke.restored(): Promise<void>`.

`src/shared/plugin-manifests.ts` (task 05): `dependentsOf(pluginId, disabled, manifests): string[]` and
`withAppliedList(config, disabled, paused = [])`. `src/main/plugins/applied-plugins.ts` (task 05):
`AppliedPlugins.paused()` and `setPaused(ids)`. Task 09 adds `withoutUndeclaredDefaults(defaults, commands, scopes)`.

`src/plugins/chat/contract.ts` (task 06): `ChatFocus` and `chatFocusSlot` (id `chat.focus`).

`src/main/config/config-store.ts` (task 09): `setPlugins(entries: readonly CatalogEntry[]): Promise<void>`,
`plugins()` (the admitted entries), `pluginProblems()`, `setPluginProblems(problems)`, `checks()`. Plugin problems are
served as config problems with `file: 'plugins/<id>'`.

`src/contracts/settings.ts` (task 09): `AppConfig` gains `plugins: readonly ServedPlugin[]`.

`src/contracts/core-state.ts` (task 10): `PluginStatus` gains `readonly origin: PluginOrigin;` and
`readonly problem: string | null;`.

`src/contracts/bridge.ts` (task 10): `PluginPartsRequest` gains `| { kind: 'reload'; id: string }` and
`| { kind: 'remove'; id: string }`. `PluginPartsReply` gains `| { reloaded: readonly string[]; problem: string | null }`;
`remove` replies `{ stopped }`. The `start` reply becomes
`{ started: readonly string[]; problems: readonly CatalogProblem[] }` (page-side load and start failures). The page's `reload` swaps the part and starts nothing; the switch sends `start` after it.

`src/main/plugins/plugin-switch.ts` (task 10): `PluginSwitch.settled()`, `heldAtStart(entries)`, switch deps
`catalog`, `config`, `configDisabled`. The drive action `reloadPlugin` (`core.reloadPlugin` under `driveFor('core')`).

`src/main/plugin-catalog/plugin-types.ts` (new, task 07):
`writePluginTypes(deps: { files, typesFolder, emittedFolder, paths, log }): Promise<void>` and
`emittedTypesFolder({ isPackaged, appPath, resourcesPath }): string` (`<resourcesPath>/plugin-types` packaged,
`<appPath>/.plugin-types` otherwise).

`src/main/data-protocol/data-protocol.ts` (task 11): `servePluginScheme(codeRoot: string, paths: Paths): void`;
`registerAppSchemes()` registers `wigley-plugin`.
`src/main/layouts/layout-service.ts` (task 11): `LayoutServiceDeps.userPluginFolder(owner): string | null`.
`src/contracts/plugin.ts` (task 11): `PageApi.layouts.show` returns `PageLayoutShow<L>`, the `LayoutShow` plus
`draw(part, parent, input, { scope? })`, which draws one layout part through a fresh layout kit. Task 14's fixture
draws through it. `ownerLayoutShow` in `src/shared/page/layout-host/owner-show.ts` builds it.

Core command (task 13): `core.reloadPlugin` (`CORE_RELOAD_PLUGIN` in `src/contracts/commands.ts`), runs in main,
argument `string` (the plugin id), label `Reload plugin`, no default key.

Self-test (task 14): `SelfTestStep.remove?: string`; `SELFTEST_USER_ID = 'selftest-user'` in
`src/main/selftest-user-plugin.ts`. Task 14 replaces the built-in `gallery` (task 16's check 7 uses this id).

Folders, measured at plan time, re-verify:

- User plugins: `<config folder>/plugins/<id>/`, the config folder from `configFolder(homeDir)` in `main.ts`.
- Types: `<config folder>/plugins/_types/`.
- Per-revision copies: `<user data>/plugin-code/<id>/<revision>/` (`app.getPath('userData')` live; the self-test and a
  drive run use their own homes, as plugin data does). A launch starts one above the highest revision folder on disk.

### New layers

Task 01 adds both `CORE_LAYERS` entries in `scripts/check-layers.mts`: `src/shared/plugin-catalog` (pure; imports
`src/contracts` and `src/shared`) and `src/main/plugin-catalog` (imports `src/contracts`, `src/shared`,
`src/shared/paths`, `src/shared/plugin-catalog`, `node:`). Task 01 lists both for the `main.ts` entry. A later task
that imports a new layer from another entry adds it there: task 10 for `src/main/plugins`, task 11 for `renderer.ts`.

### Files by task

| Task | Files |
|---|---|
| 01 | create `src/main/plugin-catalog/import-module.ts` + test · modify `scripts/check-layers.mts` |
| 02 | create `src/shared/plugin-catalog/validate-manifest.ts`, `manifest-schema.ts` + tests · modify `src/shared/define-plugin.ts` + test, `src/main/layouts/layout-service.ts` (one line) |
| 03 | modify `src/shared/plugin-host.ts` + test |
| 04 | modify `src/renderer/page-restores.ts`, `plugin-parts-answer.ts`, `renderer.ts`, `src/renderer/shell/modes.ts`, `src/contracts/plugin.ts`, sessions, chat (page and main) and docs `start.ts`, sessions and chat `contract.ts`, doc wording in `place-slot.ts`, `page-api.ts`, `plugin-part-harness.test-support.ts`, notes · `AGENTS.md` + tests |
| 05 | modify `src/shared/plugin-manifests.ts`, `src/main/plugins/applied-plugins.ts`, `plugin-switch.ts`, `src/main/main.ts` (one line) · `AGENTS.md` + tests |
| 06 | modify `src/plugins/chat/contract.ts`, chat page `start.ts`, `chat-view.ts`, `entry-list.ts`, `entry-focus.ts`, `src/plugins/visual/manifest.ts`, `src/plugins/visual/page/*` · `AGENTS.md` (the `chat/` source-map line) + tests, chat `page/start.test.ts` |
| 07 | create `tsconfig.plugin-types.json`, `src/main/plugin-catalog/plugin-types.ts` + test · modify `forge.config.mts`, `.gitignore` |
| 08 | create `src/contracts/plugin-catalog.ts`, `src/contracts/user-plugin.ts`, `src/shared/plugin-url.ts`, `src/main/plugin-catalog/{built-in-source,user-folder-source,plugin-catalog}.ts` + tests · modify `src/shared/layouts/layout-registry.ts` |
| 09 | modify `src/main/config/{config-store,config-checks,user-settings,user-keymap,user-config}.ts`, `src/contracts/settings.ts`, `src/shared/plugin-manifests.ts`, the whole-`AppConfig` test fixtures + tests |
| 10 | modify `src/main/plugins/{plugin-switch,plugin-switch-drive,applied-plugins}.ts`, `src/main/page-parts.ts`, `src/contracts/{core-state,bridge}.ts`, `scripts/check-layers.mts`, settings' `plugin-rows.test.ts` and `settings-view.test.ts` helpers + tests |
| 11 | modify `src/shared/plugin-url.ts`, `src/main/data-protocol/data-protocol.ts`, `index.html`, `src/renderer/renderer.ts`, `plugin-parts-answer.ts`, `src/main/layouts/layout-service.ts`, `src/shared/file-url.ts`, `src/shared/layout-url.ts`, `src/contracts/plugin.ts` (a doc line, `PageLayoutShow` and its part types), `scripts/check-layers.mts`, `src/renderer/plugins/page-api.ts` + test, `src/shared/plugin-part-harness.test-support.ts`, `src/plugins/workflow/page/layout/workflow-draw.test.ts` · create `src/renderer/page-part-loader.ts` + tests, `src/shared/page/layout-host/owner-show.ts` + tests |
| 12 | modify `src/plugins/settings/page/plugin-rows.ts`, `plugin-rows-view.ts`, `src/plugins/settings/layouts/layout.d.ts`, the settings default layout + tests |
| 13 | modify `src/main/main.ts`, `src/config/keymap.ts`, `src/contracts/commands.ts` |
| 14 | create `src/main/selftest-user-plugin.ts` + test · modify `src/main/selftest-config.ts` + test, `src/main/main.ts`, `src/contracts/plugin.ts`, `src/main/selftest-runner.ts` + test · `AGENTS.md` |
| 15 | docs re-read · `AGENTS.md`, `DESIGN.md`, `docs/features/settings/design.md`, `docs/features/plugin-framework/design.md`, `docs/features/followups.md`, `docs/features/intent-alignment/master-plan.md`, `src/plugins/settings/page/settings-view.ts` (comments) |
| 16 | final verification |

Each task document holds its exact paths. Where this table and a task document disagree, the task document wins
for that task's own files. Tasks in one wave share no file.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Main imports a module from disk](01-main-module-import.md)
- [x] [Manifest checks and schema](02-manifest-checks.md)
- [x] [Host adds and removes parts](03-host-live-parts.md)
- [x] [A restore window per live start](04-live-restore-window.md)

### Wave 2
- [x] [Keys leave with a restarted page part](05-restart-keys-gap.md) — after 04
- [x] [Plugin sources and the catalog](08-plugin-catalog.md) — after 01, 02

### Wave 3
- [x] [Visual reads chat's focused entry through a slot](06-focused-entry-slot.md) — after 04 (chat's page start and contract), 05 (`AGENTS.md`)
- [x] [Contract types for user plugins](07-plugin-types.md) — after 01, 02, 08
- [x] [Config over a live catalog](09-config-live-catalog.md) — after 05, 08
- [x] [Switch over the catalog, with reload](10-switch-reload.md) — after 03, 05, 08

### Wave 4
- [x] [Page loads user page parts](11-page-loading.md) — after 04, 09, 10
- [x] [Settings shows a plugin's origin and problem](12-settings-plugin-rows.md) — after 10

### Wave 5
- [x] [Main composition over the catalog](13-main-wiring.md) — after 07, 08, 09, 10, 11

### Wave 6
- [ ] [Fixture user plugin in the self-test](14-selftest-fixture.md) — after 11, 12, 13 (13 and 14 both edit `main.ts`)

### Wave 7
- [ ] [Doc re-read](15-doc-re-read.md) — after 14

### Wave 8
- [ ] [Final verification](16-final-verification.md) — after 15

## Run log

Review base: 71b605ce

### Groups
- 01 · cb945bea · diff read; Produces present; import-module tests pass; layer check clean · concerns: the bundle's import( vs require( check needs a build: deferred to the test gate and task 14's self-test, which imports a real main.js
- 03 · 11ed15c4 · diff read; add/remove/known present; plugin-host tests 49 pass · concerns: an add of an id whose remove is still in flight throws duplicate id (a reload awaits remove first)
- 02 · e0fe3448 · diff read; validateManifest, handlerProblems, SHORT_ID_PATTERN, manifestSchema, PLUGIN_ID_PATTERN, pluginIdProblem present; 125 tests pass · concerns: validManifest builder moved to manifest.test-support.ts so the schema test can share it
- 04 · 2ce4dc5e · diff read; reopen, restores deps, ChatChannel.invoke.restored present; renderer, sessions/chat/docs/notes tests 1630 pass, no type errors · concerns: harness without holdsRestores fires onSettled inside start; no main-side test of chat's restored handler; AGENTS.md pruneKeys source-map line also corrected
- 05 · 6563da8a · diff read; dependentsOf, withAppliedList paused, AppliedPlugins.paused/setPaused, main.ts served() present; 189 tests pass, no type errors · concerns: runtime-wiring.ts servedChanged comment reworded (outside the file list)
- 08 · f4d2a555 · diff read; contracts, sources, startPluginCatalog, pluginUrl, isLayoutFileName present; 82 tests pass, no type errors · concerns: importModule called a microtask after the timer starts, so a sync throw reads as main.js failed to import; watch tests drain the queue through a probe reload
- 07 · 3f5ae444 · diff read; writePluginTypes, emittedTypesFolder, tsconfig, forge hook present; plugin-types tests pass; manual tsc emit exits 0 · concerns: forge generateAssets hook and extraResource not yet seen in a real start or package: checked at the test gate (self-test start runs the hook); emittedTypesFolder joins with / (mixed separators on Windows)
- 06 · 4615a79e · diff read; ChatFocus, chatFocusSlot present, focusedEntry/focusedBlock gone; chat page and visual tests 959 pass; filtered chat self-test deferred to the test gate (main.ts mid-edit by 09/10 at the time) · concerns: chat self-test not yet run; stale focusedEntry mention in docs/features/practice/plan-practice-mode/03-chat-page-mount.md (another feature's plan)
- 09 · 54640471 · diff read; setPlugins, plugins, pluginProblems, setPluginProblems, checks, AppConfig.plugins, withoutUndeclaredDefaults present; 322 tests pass · concerns: main.ts edited minimally to compile against the new store (task 13's file): builds built-in entries from manifests and mainParts
- 10 · 1e3f20fe · diff read; settled, heldAtStart, catalog/config/configDisabled deps, PluginStatus origin+problem, bridge reload/remove, reloadPlugin drive action present; 274 tests pass; tsc red only in main.ts (13) and plugin-parts-answer.ts (11) by plan order · concerns: typecheck red at HEAD until 11 and 13 land; the no-last-good row covered by a built-in returning after its replacement fails
- 12 · 211756ee · diff read; originText, PluginRowInput originText+problem, layout parts present; settings tests 155 pass; settings self-test deferred to the test gate (main.ts waits on 13) · concerns: settings self-test not yet run; a whitespace-only problem still draws a line
- 11 · 70101139 · diff read; servePluginScheme, pluginFilePath, page-part-loader, ownerLayoutShow, PageLayoutShow, userPluginFolder, CSP present; task tests pass; tsc red only in main.ts (13) · concerns: harness fake show.draw throws (layer rule); deferred user parts are host.add-ed after startPlugins, not disabled; initial config strips deferred and failed page binds; renderer's load code kept inline (~40 lines)
- 13 · 6173d6b5 · diff read: catalog started before loadConfig, catalog.entries() into the store, writePluginTypes, servePluginScheme, userPluginFolder, switch catalog/config/configDisabled, drive ids/reload, core.reloadPlugin registered; typecheck 0 (was 3), lint 0, selftest --plugin settings all passed · concerns: label 'Reload plugin' is sentence case unlike lowercase core labels; reload registration handle kept for window life; runtime claims (user plugin after built-ins, reload rejection, types-folder failure line) left to 16
### Contract changes
- startPlugins known: default function → optional parameter, left out reads the held parts' manifests · why: a parameter default cannot reach held · consumers: 10, 11, 13 · group 03
- validate-manifest.ts: as planned → also exports TOKEN_KINDS, PROCESS_NAMES, SETTING_KINDS, ARG_KINDS, BIND_WHERES, EDITOR_MODES (satisfies Record<Union, true>), which manifest-schema reads · why: one member list for checks and schema · consumers: 07 · group 02
- ChatFocus entryId of a queued stop: bare message id → queued:<id>, activity stops activity:<id> · why: matches entryIdOfStop · consumers: visual (06) · group 06
- ConfigSchema and KeymapNames gain plugins (admitted ids); heldBackUserBinds also returns ignored and filters unbinds; UserSettings gains ignored · why: ignore-and-keep for absent plugins · consumers: none outside 09 · group 09
- PluginSwitchDeps.config: Pick<ConfigStore,...> → inline type of the four task-09 members · why: src/main/plugins may not import src/main/config · consumers: 13 · group 10
- reload of an off or withheld plugin: start only → page reload then start · why: the page would otherwise start the old page.js it holds · consumers: 11 · group 10
- PluginPartsAnswerDeps: served()+loadPart() → also held: Set<string> · why: the host has no holds member · consumers: renderer.ts · group 11
- harness fake layouts.show: draws through ownerLayoutShow → draw throws 'layouts.show draw not faked' · why: src/shared may not import src/shared/page/layout-host · consumers: 14 (draws live, not through the harness) · group 11
### Rulings
- add and start count a dependency known when known names it or the host holds its part; construction checks known alone · group 03 · group 03
- remove of a held but unstarted part resolves [] and forgets it · group 03 · group 03
- a bind naming a malformed command gets no process problem; the command's own problem covers it · group 02 · group 02
- restores settled is logged by the host for every window; the renderer's listener for it is gone · group 04 · group 04
- modes keep the id of a shown mode that gave way and show it again when that id is re-added · group 04 · group 04
- restart's finally clears a still-set paused list after startWhatStopped · group 05 · group 05
- a load step's unhandled error resolves as failed with its error text · group 08 · group 08
- the cycle check runs over the entries that would show · group 08 · group 08
- both candidates held back: the problem names the user candidate's missing dependency · group 08 · group 08
- no makeFolder before each write: Files.write creates parent folders per its contract · group 07 · group 07
- EntryList.focusedStopId() added, since place() can return a saved place rather than the live cursor · group 06 · group 06
- an extra chat.focus write after tabs.set covers a cursor move during createTab · group 06 · group 06
- a keymap prefix is known when it is core, an admitted plugin id, or the prefix of a known command or scope (core ids use picker., modes.) · group 09 · group 09
- a dependent stopped by a removal is withheld with a Needs plugin problem, so the retry restarts it when the plugin returns · group 10 · group 10
- reload step 6 also starts the reloaded id itself · group 10 · group 10
- the launch job starts only the held ids that are withheld · group 10 · group 10
- originText is an exhaustive switch, so a new origin fails typecheck · group 12 · group 12
- deferred user page parts are host.add-ed after startPlugins rather than listed disabled, since the disabled check follows dependsOn.main · group 11 · group 11
- the initial page config strips binds of page parts not started at load; loads moved right after bridge.config() · group 11 · group 11
- the catalog is built in a startCatalog(inputs) helper; seeding (14) goes before its call · group 13
- types folder is path.join(inputs.pluginsFolder, '_types') · group 13
### Review rounds
### Test gate
