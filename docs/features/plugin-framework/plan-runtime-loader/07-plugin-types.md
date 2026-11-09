# 07 — Contract types for user plugins

Status: not started
Type: Task
Wave: 3 · Depends on: 01, 02, 08
Plan: [plan.md](plan.md)

Design: `docs/features/plugin-framework/design.md` § Runtime loader (Wave 4 step 3), bullet "Types for every contract".
The build emits `.d.ts` files for every contract. At start, the app writes them to `<config folder>/plugins/_types/`
with `plugin.d.ts` and `manifest.schema.json`, so a user `main.js` or `page.js` can type itself with `// @ts-check`.

Files:
- create `tsconfig.plugin-types.json`
- modify `forge.config.mts` (a `generateAssets` hook, and `packagerConfig.extraResource`)
- modify `.gitignore` (add `.plugin-types/`)
- create `src/main/plugin-catalog/plugin-types.ts` · test `src/main/plugin-catalog/plugin-types.test.ts`

Consumes:
- `manifestSchema: object` in `src/shared/plugin-catalog/manifest-schema.ts` ← 02
- `src/contracts/user-plugin.ts` ← 08: `UserMainApi`, `UserMainStart`, `UserPageApi`, `UserPageStart`,
  `UserMainModule`, `UserPageModule`. A user `main.js` and `page.js` each export a named `start(api)`.
- the `src/main/plugin-catalog` layer and its `CORE_LAYERS` entry ← 01
- `Files` (`write`, `list`, `read`, `makeFolder`, `stat`) and `Paths` from `src/contracts/`, as the tree holds them

Produces (in `src/main/plugin-catalog/plugin-types.ts`):

```ts
export function writePluginTypes(deps: {
  files: Files;          // takes absolute paths
  typesFolder: string;   // <config folder>/plugins/_types
  emittedFolder: string; // what emittedTypesFolder returns
  paths: Paths;
  log: Log;
}): Promise<void>;
// Where the build put the emitted .d.ts tree: `<resourcesPath>/plugin-types`
// when packaged, else `<appPath>/.plugin-types`.
export function emittedTypesFolder(app: {
  isPackaged: boolean;
  appPath: string;
  resourcesPath: string;
}): string;
```

Task 13 calls both once at start, after the config store loads, as
`writePluginTypes({ files, typesFolder, emittedFolder, paths, log: pageLog.log })`. Its `main.ts` passes
`app.isPackaged`, `app.getAppPath()` and `process.resourcesPath` to `emittedTypesFolder`. The order against the
user-folder source does not matter: the source's watch skips `_types`.

`plan.md` § Shared names gives this signature, with `paths` and `log`: the function joins paths and logs a skip.

Decisions:
- **Which Forge hook.** Read from `node_modules/@electron-forge/core` 8.0.1, `dist/api/start.js`,
  `dist/api/package.js` and `dist/util/hook.js`, read-only. `generateAssets` runs for `electron-forge start` and
  for `package`/`make`, before `preStart`/`prePackage`. The Vite plugin's own `preStart` and `prePackage` hooks
  (`@electron-forge/plugin-vite` 8.0.1, `VitePlugin.js`) run `rm -rf .vite`. A forgeConfig hook always runs
  before the plugins' hooks of the same name. As a result, no forgeConfig hook can write into `.vite/` and keep its
  output. The types therefore go outside `.vite`:
  - `hooks.generateAssets` runs `tsc -p tsconfig.plugin-types.json`. It calls `execFileSync` on the repo's
    `node_modules/.bin/tsc` (`tsc.cmd` on Windows, with `shell: true` as `scripts/selftest.mts` does), with `cwd`
    set to the repo. It does not use `npx`. A non-zero exit throws an error that holds tsc's stdout. Start and
    packaging then stop, because shipping stale or missing types is worse, and `npm run typecheck` keeps the
    contracts clean.
  - `packagerConfig.extraResource: ['.plugin-types']`. Packager copies the folder to
    `<Resources>/plugin-types` (macOS) or `resources/plugin-types` (Windows), outside the asar.
    `@electron/packager` 20.3.0 documents `extraResource` as "copied directly into the app's
    `Contents/Resources`".
  - Keep the existing `postPackage` hook unchanged.
- **`tsconfig.plugin-types.json`:** `"extends": "./tsconfig.json"`. Set these compilerOptions: `noEmit: false`,
  `declaration: true`, `emitDeclarationOnly: true`, `rootDir: "src"`, `outDir: ".plugin-types"`,
  `sourceMap: false`, `declarationMap: false`, `incremental: true`,
  `tsBuildInfoFile: ".plugin-types/.tsbuildinfo"`. The build-info file sits in the output folder, so deleting the
  folder also forces a full emit. `"include": ["src/contracts/*.ts", "src/plugins/*/contract.ts"]`.
  `"exclude": ["src/**/*.test.ts", "src/**/*.test-d.ts", "src/**/*.test-support.ts"]`.
  - tsc also emits the files that the contracts import, such as `src/shared/json.ts`,
    `src/shared/call-each.ts`, `src/shared/plan-progress.ts` and `src/shared/followups/followup-file.ts`, under
    `.plugin-types/shared/...`. This is wanted: the contracts' `.d.ts` files import them by relative path.
  - Suppose the emit fails because a file in that closure needs an ambient declaration from outside the include,
    such as a `?raw` module. Then add that declaration file to a `"files"` list in this tsconfig. Do not widen the
    include.
- **Tree under `_types/`.** The tree mirrors `src/`, and `writePluginTypes` copies every `*.d.ts` file under
  `emittedFolder` to the same relative path under `typesFolder`. It skips every other file (`.tsbuildinfo`). The
  result:
  - `_types/contracts/<module>.d.ts` (`_types/contracts/plugin.d.ts`, `_types/contracts/state.d.ts`, …)
  - `_types/plugins/<id>/contract.d.ts` (`_types/plugins/chat/contract.d.ts`, …)
  - `_types/shared/…` (whatever the closure emitted)
  - `_types/plugin.d.ts`, written with exactly this text:
    `export type * from './contracts/user-plugin';` plus a final newline.
  - `_types/manifest.schema.json`: `JSON.stringify(manifestSchema, null, 2)` plus a final newline.
- **How a user file references the types.** A user file is plain JS, so it uses the JSDoc `@import` tag (TypeScript
  5.5 or later; the repo has TypeScript ^6). These paths work from `plugins/<id>/main.js` and
  `plugins/<id>/page.js`, which is one folder under `plugins/`:
  - `/** @import { UserMainApi, UserMainStart } from '../_types/plugin' */`
  - `/** @import { ChatMainExports } from '../_types/plugins/chat/contract' */`
  - `/** @import { PluginManifest } from '../_types/contracts/plugin' */`
  - `manifest.json`: `"$schema": "../_types/manifest.schema.json"`. Task 02's `validateManifest` must accept the
    `$schema` key. If 02 rejects unknown keys, this is a Concern to report.
  - Put these four example lines in the doc comment over `writePluginTypes`. Task 15 puts the same four lines in the
    AGENTS.md bullet "A user plugin" (it holds none at plan time); this task does not edit `AGENTS.md`.
- **Missing emitted folder.** This happens on a dev start that ran no hook, such as a vitest or a bare `electron .`.
  The check is `files.stat(emittedFolder)`: the folder is missing when `stat` returns null or a stat that is not a
  folder. Do not use `files.list` for this check: it returns `[]` for a missing folder and for an empty one. An
  empty folder that exists copies nothing and logs nothing. When the folder is missing, log one line under source
  `plugins`:
  `plugin types not written: <emittedFolder> is missing`. Then still write `plugin.d.ts` and
  `manifest.schema.json`, and resolve. The function never rejects. Every other failure (a read, a write, a
  list) is logged under source `plugins` as `plugin types not written: <error text>` and stops the copy. Start
  goes on in every case. The whole body runs inside one `try`, so the promise never rejects; task 13 awaits it with
  no `catch`.
- **Old files.** The function overwrites files in `_types/`. It does not delete files that a newer build no longer
  emits. A stale `.d.ts` is harmless, and deleting under the user's config folder is not this task's call.
- **Folder making.** `files.makeFolder` runs on each target folder before the write, because `Files.write` is not
  documented to make parents.

GIVEN an emitted tree holding `contracts/plugin.d.ts`, `plugins/chat/contract.d.ts` and `.tsbuildinfo`
WHEN `writePluginTypes` runs THEN `_types/` holds those two `.d.ts` files at the same relative paths, plus
`plugin.d.ts` and `manifest.schema.json`, and holds no `.tsbuildinfo`.
GIVEN no emitted folder WHEN `writePluginTypes` runs THEN it resolves, logs `plugin types not written: <emittedFolder>
is missing`, and `_types/` still holds `plugin.d.ts` and `manifest.schema.json`.
GIVEN `isPackaged` true / false WHEN `emittedTypesFolder` runs THEN it returns `<resourcesPath>/plugin-types` /
`<appPath>/.plugin-types`.

Tests (`plugin-types.test.ts`, over the in-memory or temp-folder `Files` the other main tests use):
- `writePluginTypes_CopiesEveryDtsAtItsRelativePath`. Use a nested tree two levels deep, with one non-`.d.ts`
  file. The test asserts the full set of paths under `_types/`. It breaks if the copy flattens paths, misses a
  nested folder, or copies the build-info file.
- `writePluginTypes_WritesPluginDtsAndSchema`. Assert the `plugin.d.ts` text exactly: it is a protocol that the
  user's tsc parses. Assert that `manifest.schema.json` parses back to `manifestSchema`. It breaks if either
  file is dropped or the re-export path changes.
- `writePluginTypes_NoEmittedFolder_LogsAndStillWritesTheRest`. Assert the full log line. It breaks if a missing
  folder rejects or skips the two written files.
- `emittedTypesFolder_PicksResourcesWhenPackaged`. A table with two rows. It breaks on a flipped branch.
- Live: task 16, check 9 ("Types written").

Done when: compiles; `npm run lint` passes (the layer check included); the tests above pass by name;
`node_modules/.bin/tsc -p tsconfig.plugin-types.json` exits 0 and leaves `.plugin-types/contracts/plugin.d.ts`,
`.plugin-types/contracts/user-plugin.d.ts` and `.plugin-types/plugins/chat/contract.d.ts`. The implementer runs it
once by hand; it is the hook's own command.
Commit:    one commit for the task

Concerns: `generateAssets` now runs tsc on every `npm start`, self-test and drive start. The incremental build
info keeps a re-run fast. If a cold run adds more than about 10 s, report the time in the Proof.

## Proof
