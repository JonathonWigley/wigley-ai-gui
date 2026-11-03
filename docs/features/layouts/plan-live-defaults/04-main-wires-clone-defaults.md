# 04 — Main learns the clone path and wires each owner's default folder

Status: done
Type: Batch
Wave: 2 · Depends on: 01, 02
Plan: [plan.md](plan.md)

Files:     modify `vite.main.config.mts` · modify `vite.renderer.config.mts` · create `src/main/clone-dir.d.ts` · create `src/main/clone-dir.ts` · test `src/main/clone-dir.test.ts` · modify `scripts/install-app.mts` · modify `src/main/layouts/layout-service.ts` · modify `src/main/plugins/main-api.ts` · modify `src/contracts/plugin.ts` (the `MainApi` `layouts.register` comment only) · modify `src/main/main.ts` · test `src/main/layouts/layout-service.test.ts` · test `src/main/plugins/main-api.test.ts`
Consumes:  `defaultFolder: Files | null` on `LayoutRegistryDeps` ← 01
           `export function serveLayoutScheme(layoutsRoot: string, paths: Paths, defaultFolderOf: (owner: LayoutOwner) => string | null): void` ← 02
Produces:  `register(owner: LayoutOwner, layoutTypes: string, defaultFolder: string): Disposable` on `LayoutService` in `src/main/layouts/layout-service.ts`
           `defaultFolderPath(owner: LayoutOwner): string | null` on `LayoutService` in `src/main/layouts/layout-service.ts`
           `repoDir: string | null` on `LayoutServiceDeps` in `src/main/layouts/layout-service.ts`
           `declare const WIGLEY_CLONE_DIR: string;` in `src/main/clone-dir.d.ts`
           `repoDir: string | null` on `StartInputs` in `src/main/main.ts`

Decisions:
- **The stable build carries the clone path; the dev app uses its own repo** (plan.md § Decisions, Decided). The
  path is a build-time constant in the main bundle. No setting and no override exist (plan.md § Out of scope).
- **`vite.main.config.mts`** defines the global `WIGLEY_CLONE_DIR` through Vite's `define`, as a JSON string. Its
  value is the build's `WIGLEY_CLONE_DIR` environment variable when set and not empty. Else it is the config file's
  own folder (from `import.meta.url`): the repo the build runs in. So `npm start`, the self-test, a drive run and a
  local `npm run package` all read the repo they run from. Check `define` against Vite's documentation, and check
  that the forge Vite plugin keeps a user `define` beside its own (`MAIN_WINDOW_VITE_DEV_SERVER_URL`).
- **`vite.renderer.config.mts`** stops the dev server watching every `layouts/default/` folder
  (`server.watch.ignored`, with a glob for `**/layouts/default/**`). Then a save in a default folder reaches the dev
  app only through the live path, as it reaches the stable app, and Vite does not reload the page. Check
  `server.watch.ignored` against Vite's documentation, and check that the forge Vite plugin keeps it.
- **`src/main/clone-dir.d.ts`** declares the constant for `tsc`, with a comment that says what sets it. It is a file
  of its own, so `src/declarations.d.ts` stays free for task 05.
- **`scripts/install-app.mts`**: the `npm run package` step (line 48) runs with `WIGLEY_CLONE_DIR` set to
  `REPO_DIR` (line 27), the main clone, never the `.wigley-ai-gui-build` worktree. Extend `runNpmStep` (line 111)
  with an optional environment, or pass it at that one call; the `npm ci` step (line 165) gets none. Update the
  file's head comment to say the build bakes in the clone's path.
- **`main.ts` resolves `repoDir`** in `readStartInputs` (line 503): `WIGLEY_CLONE_DIR` when `files.stat` finds a
  folder there, else null. `StartInputs` (line 389) gains `repoDir: string | null` with a comment.
- **`LayoutServiceDeps.repoDir`**: the absolute repo clone, or null when it is missing.
- **`LayoutService.register(owner, layoutTypes, defaultFolder)`** (plan.md § File Structure): `defaultFolder` is
  relative to the clone root, with `/` separators. `register` hands the registry
  `scopedFiles(files, paths.join(repoDir, defaultFolder), paths)` as `defaultFolder`, or null when `repoDir` is
  null. It replaces task 01's `defaultFolder: null`. The owner and duplicate checks stay as they are.
- **`LayoutService.defaultFolderPath(owner)`**: the absolute default folder of a registered owner, joined as
  `register` joins it. Null when the owner holds no registration or `repoDir` is null. The scheme calls it on each
  request.
- Update the `LayoutService` comment (lines 25–33) for the third argument and `defaultFolderPath`.
- **The plugin host** (`src/main/plugins/main-api.ts` line 71) passes `` `src/plugins/${manifest.id}/layouts/default` ``
  as `defaultFolder`. `MainApi.layouts.register` keeps its `{ layoutTypes }` options. Update its comment in
  `src/contracts/plugin.ts` (lines 694–698) to say it also watches the plugin's default folder in the repo clone.
- **`main.ts` composition:**
  - `serveLayouts` (line 605) takes the `repoDir` and passes it to `createLayoutService`. When `repoDir` is null it
    logs once under source `layouts`: `clone folder <WIGLEY_CLONE_DIR> is missing; each default draws its bundled
    copy`.
  - The shell registers with `layouts.register('shell', shellLayoutTypes, 'src/renderer/shell/layouts/default')`
    (line 770).
  - The scheme (line 959) passes a lookup that calls the service's `defaultFolderPath`. It replaces task 02's
    `() => null`. The scheme is registered before `createWindow` makes the service, so keep the service where the
    lookup can reach it; the lookup returns null while no service exists.
- Boundary rules (plan.md § File Structure): main imports no page code; no `process.platform` check is added.

GIVEN `repoDir` `/clone` and a file `/clone/src/plugins/forms/layouts/default/layout.js` WHEN `forms` registers
with `src/plugins/forms/layouts/default` THEN its first set lists `default` with `builtIn: false`
GIVEN `repoDir` null WHEN an owner registers THEN its first set lists `default` built in, and
`defaultFolderPath(owner)` is null
GIVEN a plugin `p` WHEN it calls `api.layouts.register({ layoutTypes })` THEN the service receives
`('p', layoutTypes, 'src/plugins/p/layouts/default')`
GIVEN `npm run install-app` WHEN it packages THEN the main bundle's `WIGLEY_CLONE_DIR` is the main clone's path

Tests:
- `src/main/layouts/layout-service.test.ts` — `createService` gains a `repoDir` argument (default null), and the
  `registered` helper passes a `defaultFolder`. Every existing `register` call gains the third argument.
  - `register_DefaultFolder_ReadFromTheClone` — new `it.each`. Rows: `repoDir` `/clone` with
    `/clone/src/plugins/forms/layouts/default/layout.js` written → the first set's `default` has
    `builtIn: false`, and `defaultFolderPath('forms')` is `/clone/src/plugins/forms/layouts/default`; `repoDir`
    null → `default` built in, and `defaultFolderPath('forms')` is null.
  - `names_And_read_FollowTheOwnersRegistration` — add `defaultFolderPath` to each row: null for never registered,
    for disposed, and for every row while `repoDir` is null.
- `src/main/plugins/main-api.test.ts`
  - `createMainApi_Layouts_RunUnderThePluginId` — the fake `register` records its third argument; the expected
    call becomes `['register', 'p', 'types', 'src/plugins/p/layouts/default']`.
- The Vite `define`, `install-app` and the `main.ts` wiring earn no unit test: they are composition, and task 07's
  live run reads the default from the repo.

Done when: `npm run typecheck` passes; `npm run lint` passes (it runs `scripts/check-layers.mts`); the test gate runs
the tests above.
Commit:    one commit for the group.

## Decisions from the cold plan read

These close gaps a cold reader found. Each binds as the Decisions above do.

- **The clone dir is a pure function.** Put the choice in a small exported function in `src/main/` (`src/main/clone-dir.ts`:
  `resolveCloneDir(baked: string, isFolder: (path: string) => Promise<boolean>): Promise<string | null>`): the baked
  path when it is absolute and a folder, else null. `main.ts` calls it. Test: an `it.each` with rows absolute
  folder → the path; absolute missing → null; empty → null; relative → null. The registry's own tests (task 01)
  then cover what a null clone draws.
- **The config's own folder** is `path.dirname(fileURLToPath(import.meta.url))` in `vite.main.config.mts`. The
  environment variable counts only when it is not empty and is absolute.
- **`runNpmStep`'s environment** is `{ ...process.env, WIGLEY_CLONE_DIR: REPO_DIR }`, because `spawnSync`'s `env`
  replaces the child's whole environment.
- **The scheme lookup** reads a module-level `let layoutService: LayoutService | null` in `main.ts`, assigned in
  `serveLayouts`. Before it is assigned, and after `dispose()` drops every owner, `defaultFolderPath` gives null and
  the request answers 404. Add no second guard.
- **`defaultFolderPath` before the first listing.** It returns the path while the registration exists, even before
  the registry has listed. Test: a row in `register_DefaultFolder_ReadFromTheClone` for a registered owner whose
  first set is not yet sent.
- **No inlined default CSS.** `vite.renderer.config.mts` sets `build.assetsInlineLimit` so a `.css` asset is never
  inlined as a `data:` URL (the page's CSP has no `data:` in `style-src`, so an inlined `layout.css` would not
  load). Check the option's function form against Vite's documentation; task 07 check 7 checks the packaged result.
- **Proof of the two Vite claims** (forge keeps a user `define`; `server.watch.ignored` reaches forge's dev server)
  is task 07's checks 1 and 7. Record in this task's Proof which Vite and forge documentation pages were read.

## Proof

Commit 61a1518b · proof: diff read: register(owner, layoutTypes, defaultFolder), defaultFolderPath, repoDir on LayoutServiceDeps and declare const WIGLEY_CLONE_DIR present; whole-tree typecheck clean; resolve-clone-dir, layout-service, main-api tests 28/28; oxlint 0; oxfmt clean on its 13 files · concerns: Vite server.watch.ignored behaviour rests on the vite 8.3.4 source, not its docs; the assetsInlineLimit .css check could miss a path carrying a query string (task 07 check 7 checks the package); a drive run or self-test reads defaults from its own repo, uncommitted edits included; install-app baking the main clone has no test until a real install-app run
