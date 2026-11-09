# 08 — Plugin sources and the catalog

Status: not started
Type: Task
Wave: 2 · Depends on: 01, 02
Plan: [plan.md](plan.md)

Files:     create `src/contracts/plugin-catalog.ts`, `src/contracts/user-plugin.ts` · create `src/shared/plugin-url.ts` · test `src/shared/plugin-url.test.ts` ·
           create `src/main/plugin-catalog/built-in-source.ts`, `user-folder-source.ts`, `plugin-catalog.ts` ·
           test `src/main/plugin-catalog/built-in-source.test.ts`, `user-folder-source.test.ts`, `plugin-catalog.test.ts` ·
           modify `src/shared/layouts/layout-registry.ts` · test `src/shared/layouts/layout-registry.test.ts` (unchanged, must pass)
Consumes:  `importModuleFrom(filePath: string): Promise<Record<string, unknown>>` ← 01 (main passes it in; the source
           takes it as a dependency) · the `'src/main/plugin-catalog'` layer ← 01
           `validateManifest(raw: unknown): ManifestCheck` ← 02 · `pluginIdProblem(id: string): string | null` in
           `src/shared/define-plugin.ts` ← 02
           in the tree: `Files`, `isMissingFile`, `readIfPresent` (`src/contracts/files.ts`), `Paths`, `Log`,
           `Disposable`, `MainPart`, `PluginManifest`, `requireListed` and `dependencyOrder`
           (`src/shared/plugin-manifests.ts`), `encodedPath` (`src/shared/file-url.ts`), `errorText`
Produces:  `src/contracts/plugin-catalog.ts`, exactly as plan.md § Shared names gives it: `PluginOrigin`,
           `CatalogEntry`, `CatalogProblem`, `CatalogChange`, `SourceLoad`, `PluginSource`, `PluginCatalog`,
           `ServedPlugin`.
           `src/contracts/user-plugin.ts` (imports only `src/contracts/plugin.ts`):
           ```ts
           export type UserMainApi = MainApi<PluginManifest, ChannelShape, UntypedEvents, UntypedEvents>;
           export type UserMainStart = MainStart<PluginManifest>;
           export type UserPageApi = PageApi<PluginManifest, ChannelShape, UntypedEvents, UntypedEvents>;
           export type UserPageStart = PageStart<PluginManifest>;
           // What a user plugin's `main.js` exports.
           export interface UserMainModule { start(api: UserMainApi): UserMainStart; }
           // What a user plugin's `page.js` exports.
           export interface UserPageModule { start(api: UserPageApi): UserPageStart; }
           ```
           Task 07 emits it as `.d.ts` with the other contracts, for a user plugin's `// @ts-check` JSDoc types.
           `src/shared/plugin-url.ts`: `export const PLUGIN_SCHEME = 'wigley-plugin';` and
           `export function pluginUrl(pluginId: string, revision: number, path: string): string`
           (task 11 adds `pluginFilePath` to this file).
           `src/shared/layouts/layout-registry.ts`: `export function isLayoutFileName(fileName: string): boolean`
           `src/main/plugin-catalog/built-in-source.ts`:
           `export function createBuiltInSource(deps: { manifests: readonly PluginManifest[]; mainParts: readonly MainPart[] }): PluginSource`
           `src/main/plugin-catalog/user-folder-source.ts`:
           ```ts
           export const PLUGIN_SETTLE_MS = 300;
           export const PLUGIN_IMPORT_TIMEOUT_MS = 5000;
           export interface UserFolderSourceDeps {
             pluginsFolder: Files; // scoped to <config folder>/plugins
             userRoot: string;     // the absolute path of <config folder>/plugins
             codeFolder: Files;    // scoped to <user data>/plugin-code
             codeRoot: string;     // the absolute path of <user data>/plugin-code
             paths: Paths;
             importModule: (filePath: string) => Promise<Record<string, unknown>>;
             log: Log;
           }
           export function createUserFolderSource(deps: UserFolderSourceDeps): PluginSource;
           ```
           `src/main/plugin-catalog/plugin-catalog.ts`:
           `export function startPluginCatalog(deps: { builtIn: PluginSource; user: PluginSource; log: Log }): Promise<PluginCatalog & Disposable>`

Decisions:
- **Where the code lives.** The `src/main/plugin-catalog` layer imports no `src/plugins` file. `main.ts` (task 13)
  passes `manifests` from `src/plugins/manifests.ts` and `mainParts` from `src/plugins/main.ts` to
  `createBuiltInSource`. Page parts stay a static import in `renderer.ts`; the built-in source has no page side.
- **`pluginUrl`.** This task creates `src/shared/plugin-url.ts` with `PLUGIN_SCHEME` and `pluginUrl`, since the
  user-folder source builds `pageUrl` with it and runs before task 11. The URL is
  `wigley-plugin://<id>/~<revision>/<path>`, each segment of `path` URI-encoded with `encodedPath`, as `layoutUrl` in
  `src/shared/layout-url.ts` builds its URL. Task 11 adds `pluginFilePath` and the protocol handler.
- **The module shape.** A user plugin's `main.js` is an ES module with a named export `start`:
  `export function start(api) { … return { commands: { … } }; }`. `page.js` takes the same shape (task 11 checks it on
  the page). `UserMainModule` and `UserPageModule` in `src/contracts/user-plugin.ts` type both. (Layouts differ: each
  `layout.js` ends `export default layout;`. The plugin shape follows the lead's ruling, not the layout form.) The
  source builds the `MainPart` as `{ manifest, start: (api) => module.start(api) }`, `module` read as
  `UserMainModule` once the check passes.
- **The source does not check handlers.** `handlerProblems` runs after a start, on what the start returned. That is
  the switch's job (task 10), not the source's or the catalog's.
- **Built-in source.** `createBuiltInSource` calls `requireListed(mainParts, manifests)` first, so a main part whose
  manifest is not in the list throws at start. (`main.ts`'s own call goes; task 13 keeps `requireListed` in
  `plugin-manifests.ts` for this caller.) `loadAll()` resolves one `loaded` per manifest, in `manifests` order, with
  `revision: 0`, `main` the part whose `manifest` is that manifest object (`===`) or null, `pageUrl: null`,
  `folder: null`. `watch()` returns a disposable that does nothing and never calls the listener. `reload(id)` resolves
  the same load for a listed id and `{ kind: 'gone', id }` for any other id.
- **User-folder source: what is a plugin.** `loadAll()` lists `pluginsFolder` at its top level (`list('')`, not
  recursive) and drops each name that starts with `_` or `.`. It sorts the rest by name (`localeCompare`) and loads
  each in turn. Step 1 of the load gives `gone` for a name that is not a folder; `loadAll()` leaves every `gone` out
  of its result and logs nothing for it. It resolves the other loads in name order. A missing `plugins/` folder lists as `[]`.
  Do not filter on the listed `kind`: the Node adapter lists a symlink as `kind: 'file'`, and `stat` follows links.
  So a link to a folder (`plugins/<id>` linked to a repo folder) is a plugin.
- **Links inside a plugin folder.** The recursive `list` does not follow a link inside the plugin folder, and lists it
  as `kind: 'file'`. A link to a file is copied as its target's bytes (`readBytes` follows it). A link to a folder
  makes `readBytes` reject, so the load fails with `plugins/<id> could not be copied: <errorText>`. The watch may
  not follow a link, so a save inside a linked plugin folder can go unseen; `core.reloadPlugin` then loads it.
- **User-folder source: one load of `<id>`**, in this order. Each failure resolves `{ kind: 'failed', id, message }`
  with the message given, logs `plugin <id> failed: <message>` under the source `plugin-catalog`, and stops the load.
  1. `pluginsFolder.stat(<id>)` is null or not a folder → resolve `{ kind: 'gone', id }`. Log nothing.
  2. `pluginIdProblem(id)` not null → fail with that text.
  3. Read `<id>/manifest.json`. Missing → `plugins/<id>/manifest.json is missing`. `JSON.parse` throws →
     `plugins/<id>/manifest.json is not valid JSON: <errorText>`.
  4. `validateManifest(raw)` not ok → fail with its problems joined by `; `.
  5. `manifest.id !== id` → `manifest id "<manifest.id>" does not match its folder "<id>"`.
  6. Take the next revision for `<id>` (rule below).
  7. Copy every file under `<id>/` (`list(<id>, { recursive: true })`, files only, `readBytes` then `writeBytes`) to
     `codeFolder` at `<id>/<revision>/<same relative path>`, skipping entries whose path has a segment starting with
     `.`. Then write `<id>/<revision>/package.json` as `{"type":"module"}` (over any copied one), so Node reads every
     `.js` in the copy as an ES module. A copy failure → `plugins/<id> could not be copied: <errorText>`.
  8. When the copy holds `main.js`: `deps.importModule(paths.join(codeRoot, id, String(revision), 'main.js'))`.
     A rejection → `main.js failed to import: <errorText>`. An import that has not settled
     `PLUGIN_IMPORT_TIMEOUT_MS` (5000 ms) after it began → `main.js did not finish importing in 5000 ms` (the
     number read from the constant). The load then fails at once and the queue moves on. Clear the timer when the
     import settles. A timed-out import that settles later is ignored: its module stays in memory, since Node cannot
     cancel an import. This bounds a top-level `await` that never settles. A `main.js` that blocks the thread (an
     endless synchronous loop) blocks the app; that needs a sandbox, which is out of scope. An export `start` that is
     not a function → `main.js must export a start function`. With no `main.js`, `main` is null.
  9. `pageUrl` is `pluginUrl(id, revision, 'page.js')` when the copy holds `page.js`, else null.
  10. Resolve `{ kind: 'loaded', entry: { manifest, revision, main, pageUrl, folder: paths.join(userRoot, id) } }`
      and log `plugin <id> loaded at revision <revision>`.
  The two log lines are pinned: task 14's self-test waits on them.
- **Revisions.** Each revision is a new folder, so Node imports it as a new module, and old revisions stay in memory
  until quit. The source keeps a counter per id for the life of the process and never lowers it. The first revision of
  `<id>` in a launch is one above the highest whole-number folder name in `codeFolder` `<id>/` (1 when there is none),
  so a launch never writes into a folder an earlier launch imported. Each load that reaches step 6 takes the next
  number, a load that then fails included, so revision numbers in the catalog can skip. Old revision folders stay on
  disk; their cleanup is a follow-up (task 15 records it).
- **Watch.** `watch(listener)` calls `pluginsFolder.watch('', onChange, { onError })` once. A watch failure logs
  `plugins watch failed: <errorText>` and later saves go unseen until the next start. `onChange(path)`:
  - The first segment is the id. Skip the path when the id starts with `_` (this skips `_types/`) or `.`.
  - Skip a path whose second segment is `layouts`: the layout registry reloads a plugin's own layouts
    (`layouts/default/`, wired by task 11), and a layout save does not restart the plugin.
  - A path with one segment (the plugin folder itself made, renamed or deleted) is never skipped further.
  - A deeper path is skipped when `isLayoutFileName(<last segment>)` is false: the layout registry's filter, which
    passes code, style, data, image and font files and refuses a name starting with `.`, editor swap, backup and lock
    files. `layout-registry.ts` exports it as `isLayoutFileName(fileName)` (its `LAYOUT_FILE` test and the leading-`.`
    test) and its own `onChange` calls it, so the registry's behaviour does not change.
  - Otherwise (re)start a timer for that id: `PLUGIN_SETTLE_MS` (300 ms) after the last change under the id, the
    load runs. `Files.watch` already folds a burst on one path (100 ms in the Node adapter); this timer folds a save
    that writes several files.
  - Loads run one at a time through one queue for the source (the `serially` pattern in `layout-registry.ts`). Each
    load calls `listener(load)`. A `gone` is sent only for an id the source loaded or failed before; the source then
    forgets that it had the id, but keeps its revision counter.
  The returned disposable disposes the watch and clears every pending timer; a load already running finishes and its
  result is dropped.
- **`reload(id)`** runs one load through the same queue and resolves to it. It does not cancel a pending timer.
- **Catalog: start.** `startPluginCatalog` awaits `builtIn.loadAll()`, then `user.loadAll()`, applies every load as
  below with no `onChanged` call, then subscribes to both `watch()`es. Problems from start show in `problems()`.
- **Catalog: what it holds.** For each id it keeps the last good load from each source (the candidates), and one
  load problem at most. The catalog builds a candidate's `CatalogEntry` object once, when it applies the load
  (`{ ...load.entry, origin }`), and keeps that object. `origin` is `built-in` for a built-in candidate; `user` for a
  user candidate, or `replaces-built-in` when the id has a built-in candidate. (Built-in candidates are all in place
  before the first user load, and the built-in source never sends a watched load, so a kept origin stays true.)
- **Catalog: entries.** The catalog computes the shown entries at start and again after each applied load, and keeps
  the list. `entries()` returns the kept list. The list holds the kept candidate objects, never copies, so an id whose
  shown candidate did not change keeps the same object. The computation:
  1. Each id shows its user candidate when it has one, else its built-in candidate.
  2. Repeat until nothing changes: an id whose shown candidate's `dependsOn.main` or `dependsOn.page` names an id that
     shows nothing is held back. A held-back user candidate gives way to the built-in candidate of its id, when there
     is one, and the next pass checks that built-in candidate. Else the id shows nothing. So a user replacement whose
     dependency is gone does not take the built-in away, and does not hold back the built-ins that depend on its id.
  3. A held-back candidate gives its id the held-back problem `needs plugin "<dependency>", which is not loaded` (the
     first such id in `main` then `page` order). The id has it also when its built-in candidate shows in place of
     the held-back user candidate. A load problem of the id wins over its held-back problem. A held-back problem
     clears at the first computation that does not hold the candidate back.
  4. Order: built-in ids in the built-in source's order, each in its own place whether the built-in or its replacement
     shows; then user-only ids in name order. `manifests()` is `entries().map((entry) => entry.manifest)`.
  `entry(id)` reads the kept list.
- **Catalog: applying a load.**
  - `loaded`: run `dependencyOrder` over the would-be manifests (the candidate swapped in). When it throws, the load
    counts as failed with the thrown text. Else the candidate becomes the last good load and the id's load problem
    clears.
  - `failed`: the last good candidate stays; the id's problem becomes the message. With no earlier candidate, the id
    has no entry.
  - `gone`: the source's candidate and the id's problem go. A built-in candidate of that id shows again.
- **Catalog: changes.** After each applied load, compare entries by id: `added` is an id absent before and present
  after; `removed` is present before and absent after; `reloaded` is present both times with a different entry
  object. So a user plugin taking over a built-in, and its folder deleted so the built-in returns, are both
  `reloaded: [id]`. `added` and `reloaded` are in the new entries' order; `removed` in the old order. When an entry
  changed, or only `problems()` changed, the catalog calls every `onChanged` listener once, synchronously, with the
  change: three empty lists mean only problems changed. A listener that throws is logged as
  `change listener failed: <errorText>` under `plugin-catalog`, and the next listener still runs.
- **Catalog: problems.** `problems()` lists `{ id, message }` for each id with a problem (its load problem, else its
  held-back problem), in the order the problems were first recorded. A problem that clears and comes back is recorded
  again, at the end.
- **Catalog: `reload(id)`.** When the id has a user candidate or a user problem: await `user.reload(id)`, apply it as a
  watched load, and resolve once listeners ran. A failed reload resolves; its problem shows. When the id has only a
  built-in entry: reject with `Plugin "<id>" is built in; it reloads only with a rebuild`. Otherwise reject with
  `No plugin "<id>"`.
- **Catalog: `dispose()`** disposes both watches. It is the `Disposable` half of the return type.

GIVEN a user folder `notes/` with a valid manifest and `main.js` WHEN the source loads it THEN the copy is at
`notes/<rev>/` with `package.json` `{"type":"module"}`, `importModule` got that copy's `main.js`, and the entry has
`pageUrl` null.
GIVEN a save of `notes/main.js` and `notes/helper.js` 100 ms apart WHEN 300 ms pass after the last THEN the listener gets
one load.
GIVEN a user plugin `chat` and a built-in `chat` WHEN the catalog starts THEN `entry('chat').origin` is
`replaces-built-in`, and deleting the folder gives `reloaded: ['chat']` with origin `built-in`.
GIVEN a good `notes` and a later load that fails WHEN it applies THEN the entry stays, `problems()` holds it, and
`onChanged` gets three empty lists; a later good load gives `reloaded: ['notes']` and clears the problem.

Tests:     `src/shared/plugin-url.test.ts`
           - `builds the wigley-plugin URL of a plugin file` — `it.each` rows: `('notes', 3, 'page.js')` →
             `wigley-plugin://notes/~3/page.js`; `('notes', 12, 'lib/a b.js')` → `wigley-plugin://notes/~12/lib/a%20b.js`.
           `src/main/plugin-catalog/built-in-source.test.ts`
           - `loads each manifest with its main part, in list order` — two manifests, one main part for the second;
             asserts the loads' ids, `main` null then the part, `revision` 0, `pageUrl` and `folder` null.
           - `throws for a main part whose manifest is not listed` — asserts `requireListed`'s text.
           `src/main/plugin-catalog/user-folder-source.test.ts`, over `createMemoryFiles()`, `posixPaths`, a recording
           `importModule` fake that returns a set module per path, and `vi.useFakeTimers()`:
           - `loads a plugin folder into a revision copy` — `notes/` with `manifest.json`, `main.js`, `page.js`,
             `lib/helper.js`, `.notes.swp`; asserts the copy's files (no `.notes.swp`, plus `package.json`), the path
             handed to `importModule`, `pageUrl` `wigley-plugin://notes/~1/page.js`, `folder`, the log line
             `plugin notes loaded at revision 1`. Catches: a missing copy, an import of the user folder itself.
           - `fails a load with a message, without throwing` — `it.each` rows: no `manifest.json` → `is missing`;
             `{` → `is not valid JSON`; a manifest with `label: 1` → `label must be a string`; folder `notes` with id
             `other` → `does not match its folder`; folder `Notes` → `must be lowercase letters`; `importModule`
             rejects → `main.js failed to import`; module `{ start: 1 }` → `main.js must export a start function`;
             module `{ default: { start } }` (no named export) → `main.js must export a start function`.
             Asserts `kind: 'failed'`, the message substring, and the `plugin <id> failed:` log line.
           - `numbers revisions above the copies already on disk` — `codeFolder` holds `notes/1/` and `notes/4/`;
             four loads of `notes` in turn: a good load gives revision 5; a load whose `importModule` rejects fails
             and takes 6; a load whose `manifest.json` is `{` fails at step 3 and takes no number; a good load gives
             7. Catches: a revision reused across launches; a number taken before step 6.
           - `fails an import that does not settle, and moves on` — `pluginsFolder` holds `slow/` and `tasks/`,
             each with a valid manifest and `main.js`; the `importModule` fake returns a promise that never settles
             for `slow` and a module with `start` for `tasks`. Run `loadAll()`, advance by
             `PLUGIN_IMPORT_TIMEOUT_MS - 1` and assert it has not resolved; advance by 1 more. Asserts `slow` is
             `failed` with `main.js did not finish importing`, and `tasks` is `loaded`. Catches: no timeout; a timeout
             that does not free the queue.
           - `loads a plugin folder that is a link, and skips a top-level file` — wrap `createMemoryFiles()` so
             `list('')` reports `notes` as `kind: 'file'` and `stat('notes')` returns `{ isFolder: true, isLink: true }`;
             `pluginsFolder` also holds a file `README.md`. Asserts `loadAll()` resolves one `loaded` `notes`, and
             nothing for `README.md`. Catches: a filter on the listed `kind`, which drops a linked plugin folder.
           - `reloads a plugin once its saves settle` — `it.each` rows of written paths and the loads expected after
             `PLUGIN_SETTLE_MS`: `['notes/main.js', 'notes/lib/helper.js']` → one `notes` load;
             `['notes/main.js', 'tasks/main.js']` → one each; `['notes/layouts/default/layout.js']` → none;
             `['_types/plugin.d.ts']` → none; `['notes/main.js.swp', 'notes/main.js~']` → none. Advance by
             `PLUGIN_SETTLE_MS - 1` first and assert no load yet. Catches: no settle, a layout save restarting the
             plugin, `_types` loaded, a swap file reloading.
           - `reports a deleted folder as gone, once` — delete a loaded `notes/`; asserts one `{ kind: 'gone', id:
             'notes' }`; deleting a folder never loaded sends nothing.
           `src/main/plugin-catalog/plugin-catalog.test.ts`, over two fake `PluginSource`s whose `loadAll` resolves a
           set list, whose `watch` keeps the listener for the test to call, and whose `reload` resolves a set load:
           - `merges the sources, a user plugin replacing a built-in in its place` — built-ins `a`, `b`; user
             `b` and `c`; asserts `entries()` ids `['a', 'b', 'c']`, origins `built-in`, `replaces-built-in`, `user`.
           - `announces each load as a change by id` — `it.each` rows, each a start state, one watched load, the
             expected `CatalogChange`, origins and `problems()`:
             new user `c` → `added: ['c']`, `reloaded` empty, and `entry('a')` and `entry('b')` are the same objects
             as before the load (`toBe`);
             user `b` over built-in `b` → `reloaded: ['b']`, origin `replaces-built-in`;
             `gone` of user `b` over built-in `b` → `reloaded: ['b']`, origin `built-in`;
             `gone` of user-only `c` → `removed: ['c']`;
             `failed` of good `c` → three empty lists, entry kept, problem `c`;
             `loaded` of `c` after that failure → `reloaded: ['c']`, problem cleared;
             `failed` of `d`, never loaded → three empty lists, no entry, problem `d`;
             user `e` depending on `f`, not loaded → three empty lists, no entry, problem `needs plugin "f"`;
             then `f` loads → `added: ['e', 'f']` (name order), problem cleared;
             built-ins `a`, `b`, user `b` depending on user `g`, and user `g`; `gone` of `g` → `removed: ['g']`,
             `reloaded: ['b']`, `entry('b').origin` `built-in`, problem `b` `needs plugin "g"`; then `g` loads →
             `added: ['g']`, `reloaded: ['b']`, origin `replaces-built-in`, problem cleared;
             `c` reloaded to depend on `d` while `d` depends on `c` → three empty lists, old `c` kept, problem `cycle`.
             Catches: a wrong change kind, a replaced built-in shown twice, a lost last good entry, a problem not
             cleared, a dependent shown without its dependency, entry objects built anew at each read (every id
             `reloaded`), a held-back replacement that takes its built-in away.
           - `a throwing listener does not stop the next` — two listeners, the first throws; asserts the second ran and
             the log line `change listener failed`.
           - `reload asks the user source, and refuses a built-in or unknown id` — `it.each` rows: user `c` → the fake's
             `reload('c')` ran and the change announced; built-in `a` → rejects `is built in`; `zzz` → rejects
             `No plugin "zzz"`.
Done when: `npm test -- src/shared/plugin-url.test.ts src/shared/layouts/layout-registry.test.ts src/main/plugin-catalog/`
           passes; `npm run typecheck` and `npm run lint` pass. The live load of a real folder is task 16's check
           (through task 14's fixture).
Commit:    one commit for the group

## Proof
