# 01 — Main imports a module from disk

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     create `src/main/plugin-catalog/import-module.ts` · test `src/main/plugin-catalog/import-module.test.ts` ·
           modify `scripts/check-layers.mts`
Consumes:  none
Produces:  `export function importModuleFrom(filePath: string): Promise<Record<string, unknown>>` in
           `src/main/plugin-catalog/import-module.ts`
           `CORE_LAYERS` entries `'src/shared/plugin-catalog'` and `'src/main/plugin-catalog'` in `scripts/check-layers.mts`

Decisions:
- `importModuleFrom` is the one dynamic import in main. It turns the absolute `filePath` into a file URL with
  `pathToFileURL` from `node:url`, and returns `import(/* @vite-ignore */ url)`. It catches nothing: a missing file,
  a syntax error or a throw at module top level rejects the promise with Node's error.
- Main is a CommonJS bundle (`.vite/build/main.cjs`, built by Vite 8 with Rolldown through Forge's Vite plugin).
  Rolldown's `output.dynamicImportInCjs` keeps an external dynamic import as `import(...)` in CommonJS output, and its
  default is `true` (rolldown.rs, OutputOptions.dynamicImportInCjs). A specifier held in a variable is not resolved
  at build time. So the source needs only `/* @vite-ignore */`, which stops Vite's warning about a variable
  specifier. Do not change `vite.main.config.mts` in this task.
- Node caches a module by its URL. The source (task 08) imports each revision from its own folder, so each revision
  is a new module. This function does no cache busting: no query string, no timestamp.
- The comment above the function says: Node keeps every imported module until quit, so call it once per file path.
- New layers. Add both entries to `CORE_LAYERS`, next to the `'src/main/layouts'` entry:
  - `'src/shared/plugin-catalog': { layers: ['src/contracts', 'src/shared'], packages: [] }` — pure. It imports
    `src/shared` because `validateManifest` (task 02) calls the checks in `src/shared/plugin-manifests.ts` and
    `src/shared/define-plugin.ts`.
  - `'src/main/plugin-catalog': { layers: ['src/contracts', 'src/shared', 'src/shared/paths', 'src/shared/plugin-catalog'], packages: ['node:'] }`.
  - Add `'src/main/plugin-catalog'` and `'src/shared/plugin-catalog'` to the `'src/main/main.ts'` entry's `layers`.
  - `renderer.ts` imports neither layer, so its entry does not change. A later task that imports a new layer from
    another layer (task 10 in `src/main/plugins`, task 09 in `src/main/config`) adds it to that layer's entry itself.

GIVEN a folder holding `package.json` `{"type":"module"}`, `main.js` and `helper.js`, where `main.js` imports
`./helper.js` WHEN `importModuleFrom(<folder>/main.js)` runs THEN it resolves to the module namespace, and its
`start` export returns the value `helper.js` exports.
GIVEN two folders `1/` and `2/` whose `main.js` export different values WHEN each is imported THEN each resolves to
its own value.
GIVEN a path with no file, or a file with a syntax error WHEN `importModuleFrom` runs THEN the promise rejects.

What the unit test proves. Vitest runs the test file and the source through its own module runner. The runner
rewrites the `import()` in the source it transforms, so the unit test does not run Node's native `import`. The unit
test proves the function's contract: one module per path, relative imports, a rejection on a bad file. The live
check in Done when proves Node's native `import` in the built main bundle, and task 16's check 1 proves it again
after every task lands. Keep the unit test under vitest. Do not change `vitest.config.mts`.

Tests:     `import-module.test.ts`, over a real temp folder from `fs.mkdtemp(path.join(os.tmpdir(), 'import-module-'))`,
           removed in `afterEach`:
           - `imports the ES module at a path, with its relative imports, one module per path` — writes
             `1/package.json` and `2/package.json` as `{"type":"module"}`; `1/helper.js` exports `const word = 'first'`,
             `2/helper.js` exports `const word = 'second'`; each `main.js` is
             `import { word } from './helper.js'; export function start() { return word; }`. Asserts
             `(await importModuleFrom(<tmp>/1/main.js)).start()` is `'first'` and the same for `2/` is
             `'second'`. Catches: a cache key that makes the second path return the first module, and a relative
             import that does not resolve beside the imported file.
           - `rejects for a file it cannot import` — `it.each` rows: `{ name: 'missing file', file: 'none.js', text: null }`,
             `{ name: 'syntax error', file: 'bad.js', text: 'export default {' }`. Asserts `rejects.toThrow()`.
             Catches: an implementation that swallows the error and resolves `{}`.
           When the first test fails because vitest's runner refuses or cannot load a file outside the repo (the error
           names the temp path, not the module's code), stop and report the error. Do not move the temp folder into
           the repo, and do not change the vitest config. The lead then drops the unit test and keeps the live check
           as the only proof.
Done when:
- `npm test -- src/main/plugin-catalog/import-module.test.ts` passes, and `npm run lint` passes the layer check.
- Live check, run once, because every later task rests on it: build main with `npm start` (quit the app once its
  window opens). Then `grep -n "pathToFileURL" .vite/build/main.cjs` finds the import function, and the line that
  calls the import, read with `grep -n "import(" .vite/build/main.cjs`, still holds `import(` and not `require(`.
  Report both lines in the Proof.
- When the bundle holds `require(` or a `Promise.resolve().then` wrapper in place of `import(`, stop and report the
  bundle line. Do not choose a fix. The fallback the lead picks from is: set
  `build.rolldownOptions.output.dynamicImportInCjs: true` in `vite.main.config.mts`; or, if that does not keep it,
  build `import-module.ts` as a separate ES module entry.
Commit:    one commit for the group

## Proof

Commit cb945bea · proof: diff read; Produces present; import-module tests pass; layer check clean · concerns: the bundle's import( vs require( check needs a build: deferred to the test gate and task 14's self-test, which imports a real main.js
