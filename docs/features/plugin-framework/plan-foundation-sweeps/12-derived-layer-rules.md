# 12 — Derived layer rules

Status: done
Type: Task
Wave: 7 · Depends on: 08, 09, 10
Plan: [plan.md](plan.md)

`scripts/check-layers.mts` stops listing each plugin's layers by hand. It derives them from the plugin folder
convention and each manifest's per-process `dependsOn`, adds what the convention cannot show from a `PLUGIN_EXTRAS`
table, and fails when a composition root misses a plugin folder or lists one twice. `AGENTS.md` § Architecture (the
layer check entry, written ahead in `d7200571`) already describes this.

Files:     modify `scripts/check-layers.mts` · create `scripts/layer-rules.mts` · test `scripts/layer-rules.test.mts`
Consumes:  `PluginManifest.dependsOn: { readonly main: readonly string[]; readonly page: readonly string[] }` ← 01,
           written as a literal in each `src/plugins/<id>/manifest.ts` `definePlugin({ … })` call
Produces:  in `scripts/layer-rules.mts`:

```ts
export interface LayerRule { layers: string[]; packages: string[] }   // moved from check-layers.mts

export interface PluginFolder {
  id: string;                    // the folder name under src/plugins
  hasContract: boolean;          // src/plugins/<id>/contract.ts exists
  hasMain: boolean;              // src/plugins/<id>/main/start.ts exists
  hasPage: boolean;              // src/plugins/<id>/page/start.ts exists
  hasLayouts: boolean;           // src/plugins/<id>/layouts/ exists
  dependsOn: { main: readonly string[]; page: readonly string[] };
}

// Appended to the derived entry of that folder kind; `sublayers` are whole entries, keyed by path.
export interface PluginExtra {
  root?: Partial<LayerRule>;
  contract?: Partial<LayerRule>;
  main?: Partial<LayerRule>;
  page?: Partial<LayerRule>;
  sublayers?: Record<string, LayerRule>;
}

// The `dependsOn` literal of the definePlugin call in `source`; throws when it is not one.
export function readDependsOn(file: string, source: string): { main: string[]; page: string[] };

// Every plugin entry and the entries of src/plugins/main.ts, page.ts and manifests.ts.
export function pluginLayers(
  folders: readonly PluginFolder[],
  extras: Readonly<Record<string, PluginExtra>>,
): Record<string, LayerRule>;

// One line per part `expected` names that the array `arrayName` in `source` misses, lists twice, or holds
// beside them. Throws when `source` exports no array named `arrayName`.
export function compositionFailures(
  file: string,
  source: string,
  arrayName: string,
  expected: readonly string[],
): string[];
```

Decisions:
- The script reads `dependsOn` with the TypeScript AST (`ts.createSourceFile`), not by importing the manifests. The
  script already imports `typescript` (`ts.preProcessFile`). Node 24.22.1 (`.nvmrc`) runs the script with type
  stripping, but it cannot import `src/plugins/manifests.ts`: every relative import under `src/` leaves out the
  `.ts` extension (`'./agent-lines/manifest'`, `'../../shared/define-plugin'`), and Node's ESM resolver adds no
  extension. An import would also run plugin code (`definePlugin`, workflow's `./stages`, chat's and forms'
  manifest constants) (agent, from this task's design; brief).
- A `dependsOn` that is not a literal fails loud (brief).
- The convention allows `src/shared/paths` and `src/shared/followups` to every plugin root, `main` and `page`, and
  `src/shared/page`, `src/shared/page/ui`, `src/shared/page/layout-host` and `src/shared/page/file-drop` to every
  `page`. `followups` imports nothing and `paths` imports only `src/contracts` (their `LAYERS` entries), so no rule
  they would keep out is lost; about half the plugins use each today (agent, from this task's design).
  `src/shared/agent-forms` (it imports `node:`) stays an extra.
- Every `contract.ts` becomes its own layer. Today `src/plugins/forms/contract.ts` and
  `src/plugins/primer/contract.ts` have no entry and sit in their plugin's root layer (agent, from this task's
  design).
- The core `LAYERS` entries stay hand-written in `check-layers.mts`, renamed `CORE_LAYERS`. These are every entry
  whose key does not start with `src/plugins/<folder>`, and the five `src/plugins` entries that are not plugin
  folders: `src/plugins`, `src/plugins/keymap.ts`, `src/plugins/keymap.test.ts`, `src/plugins/manifests.test.ts`,
  `src/plugins/agent-form-drive.test.ts`.
- The script's pure logic goes in `scripts/layer-rules.mts` with a test beside it. This fits the repo's pattern
  (`check-styles.mts` runs the rules of `style-rules.mts`, and `style-rules.test.mts` tests them).
  `vitest.config.mts` includes `scripts/**/*.test.mts`, and `tsconfig.json` includes `scripts/**/*`.

GIVEN the plugin folders WHEN the script runs THEN each folder's entries are the derived rules below plus its
`PLUGIN_EXTRAS` entry, and the import check runs over `CORE_LAYERS` merged with them.
GIVEN a manifest whose `dependsOn` is not an object literal with `main` and `page` arrays of string literals WHEN the
script runs THEN it prints `<file>: dependsOn must be an object literal with main and page arrays of string
literals`, sets `process.exitCode = 1`, and skips the import check. Every folder with a bad manifest prints its line:
the runner does not stop at the first.
GIVEN a manifest with no `definePlugin({ … })` call, or a plugin folder with no `manifest.ts` WHEN the script runs
THEN it prints `<file>: no definePlugin({ … }) call` or `src/plugins/<id>: no manifest.ts` and fails the same way.
GIVEN a `dependsOn` id or a `PLUGIN_EXTRAS` key that names no plugin folder WHEN the script runs THEN it prints
`<id>: dependsOn names <other>, which is no plugin folder` or `PLUGIN_EXTRAS names <key>, which is no plugin folder`
and fails the same way. `pluginLayers` throws once, at the first such id; the runner prints that message, sets
`process.exitCode = 1` and skips the import check. It runs `pluginLayers` only when every folder's `readDependsOn`
succeeded, because the derived rules need every `dependsOn`.
GIVEN `src/plugins/main.ts`, `page.ts` or `manifests.ts` WHEN its array misses a plugin folder's part or manifest,
lists one twice, or lists a module that is no plugin folder's part THEN the script prints one line for each and
fails. The import check still runs.
GIVEN the tree after tasks 08–10 WHEN `npm run lint` runs THEN the layer check prints `layers: N files clean`.

Derived rules. `c(x)` is `src/plugins/x/contract.ts` when folder `x` has one, and nothing otherwise. `D` is
`dependsOn.main` and `dependsOn.page` together, each id once. Each list is in this order, so a test can compare it
whole; every `packages` is `[]` before extras.

| Entry | `layers` |
|---|---|
| `src/plugins/<id>` | `src/contracts`, `src/shared`, `src/shared/paths`, `src/shared/followups`, `c(<id>)`, then `c(d)` for each `d` in `D` |
| `src/plugins/<id>/contract.ts` (when it exists) | `src/contracts`, then `c(d)` for each `d` in `D` |
| `src/plugins/<id>/main` (when `hasMain`) | `src/contracts`, `src/shared`, `src/shared/paths`, `src/shared/followups`, `src/plugins/<id>`, `c(<id>)`, `src/plugins/<id>/layouts` (when `hasLayouts`), then `c(d)` for each `d` in `dependsOn.main` |
| `src/plugins/<id>/page` (when `hasPage`) | `src/contracts`, `src/shared`, `src/shared/paths`, `src/shared/followups`, `src/shared/page`, `src/shared/page/ui`, `src/shared/page/layout-host`, `src/shared/page/file-drop`, `src/plugins/<id>`, `c(<id>)`, `src/plugins/<id>/layouts` (when `hasLayouts`), then `c(d)` for each `d` in `dependsOn.page` |
| `src/plugins/<id>/layouts` (when `hasLayouts`) | `src/shared/page/layout-host` |
| `src/plugins/main.ts` | `src/contracts`, `src/shared`, then `src/plugins/<id>` and `src/plugins/<id>/main` for each folder with `hasMain`, in folder-name order |
| `src/plugins/page.ts` | `src/contracts`, `src/shared`, `src/shared/page`, then `src/plugins/<id>` and `src/plugins/<id>/page` for each folder with `hasPage`, in folder-name order |
| `src/plugins/manifests.ts` | `src/contracts`, `src/shared`, then `src/plugins/<id>` for each folder, in folder-name order |

An extra's `layers` and `packages` are appended to the derived entry of its kind, leaving out any already there.

`PLUGIN_EXTRAS` in `check-layers.mts`, copied from today's entries, each with a one-line comment that names what
needs it:

| Plugin | Extra |
|---|---|
| `backlog` | `contract: { layers: ['src/shared/followups'] }` |
| `chat`, `docs`, `notes`, `settings` | `main: { packages: ['node:'] }` |
| `forms` | `contract: { layers: ['src/plugins/forms'] }` (it imports `NUMBER_KEY_COUNT` from `./manifest`); `main: { layers: ['src/shared/agent-forms'], packages: ['node:'] }` |
| `primer` | `main: { layers: ['src/shared/agent-forms'], packages: ['node:'] }` |
| `sessions` | `main: { layers: ['src/plugins/sessions/main/relay', 'src/plugins/sessions/main/mcp'], packages: ['node:'] }`; `sublayers`: `src/plugins/sessions/main/relay` `{ layers: ['src/contracts', 'src/shared', 'src/plugins/sessions/contract.ts'], packages: ['node:'] }` and `src/plugins/sessions/main/mcp` `{ layers: ['src/contracts', 'src/shared', 'src/plugins/sessions/contract.ts'], packages: ['@modelcontextprotocol/server', 'node:'] }` |
| `workflow` | `root`, `main` and `page`: `layers: ['src/plugins/workflow/plan-reader.ts', 'src/plugins/workflow/stages']`, and `main` also `packages: ['node:']`; `contract: { layers: ['src/plugins/workflow/plan-reader.ts'] }`; `sublayers`: `src/plugins/workflow/plan-reader.ts` `{ layers: [], packages: [] }` and `src/plugins/workflow/stages` `{ layers: ['src/contracts', 'src/plugins/workflow', 'src/plugins/workflow/contract.ts', 'src/plugins/workflow/plan-reader.ts'], packages: [] }` |

Today's entries that differ from the derived rules (measured at plan time against `check-layers.mts` lines
213–984 and the combined `dependsOn` before task 01, re-verify), and what the derived rule does:

| Entry today | Difference | Derived rule |
|---|---|---|
| `agent-strip/main` | lists only the `chat` and `sessions` contracts; the combined `dependsOn` also holds `agents`, `keys` | allows the contracts of `dependsOn.main` as task 01 split it |
| `agent-lines/page` | leaves out the `chat` contract; the combined `dependsOn` holds `chat` | allows the contracts of `dependsOn.page` |
| `chat` root | lists the `keys` and `sessions` contracts | the same, from `D` |
| `docs`, `notes`, `forms` roots | list the `sessions` contract | the same, from `D` |
| `agents`, `backlog`, `primer`, `usage`, `visual`, `settings`, `keys`, `gallery`, `agent-*`, `usage-tab-line` roots | list no contract of a dependency | allow the contracts of `D` (looser) |
| `docs` root (`followups`, `paths`), `notes` and `settings` roots (`paths`) | shared sublayers by hand | the convention allows both |
| `notes/contract.ts` | lists the `sessions` contract | the same, from `D` |
| `forms/contract.ts`, `primer/contract.ts` | no entry; inside the root layer | own entries; `forms` keeps `./manifest` through its extra |
| `agents/page`, `usage-tab-line/page` | no `src/shared/page`, `page/ui`, `page/layout-host` | the convention allows them |
| pages without `src/shared/page/file-drop` (11 of 17) | no file drop | the convention allows it |
| `keys/main` and other mains or pages without `c(<id>)` | own contract left out | the convention allows it |
| mains and pages listing `src/shared/paths` or `src/shared/followups` | by hand | the convention allows both |

The cross-plugin contract imports in the tree (measured at plan time with a grep of `from '…/<id>/contract'` per
folder kind, re-verify) all fall inside the combined `dependsOn` of the importing plugin: main imports name `chat`,
`sessions`, `docs`, `backlog`; page imports name `agents`, `chat`, `docs`, `keys`, `sessions`, `usage`; root imports
(`notes/draft.ts`, `notes/session-ref.ts`) name `sessions`. When `npm run lint` rejects a contract import that
today's entries allow, the importing manifest's `dependsOn` for that process misses a dependency: stop and report it
(task 12 edits no manifest), and add no extra for it.

Tests (all in `scripts/layer-rules.test.mts`, named as `style-rules.test.mts` names its tests):
- `it.each` `'pluginLayers_DerivedEntry_$layer'` over folders `notes` (`hasContract`, `hasMain`, `hasPage`,
  `hasLayouts`, `dependsOn: { main: ['chat', 'keys'], page: ['keys'] }`), `chat` (`hasContract`, `hasMain`,
  `hasPage`, no layouts, no dependencies) and `keys` (no contract, `hasPage` only, no dependencies), with no extras.
  Rows, each `toEqual` with `packages: []`:
  - `src/plugins/notes`: `['src/contracts', 'src/shared', 'src/shared/paths', 'src/shared/followups',
    'src/plugins/notes/contract.ts', 'src/plugins/chat/contract.ts']`
  - `src/plugins/notes/contract.ts`: `['src/contracts', 'src/plugins/chat/contract.ts']`
  - `src/plugins/notes/main`: `['src/contracts', 'src/shared', 'src/shared/paths', 'src/shared/followups',
    'src/plugins/notes', 'src/plugins/notes/contract.ts', 'src/plugins/notes/layouts',
    'src/plugins/chat/contract.ts']`
  - `src/plugins/notes/page`: `['src/contracts', 'src/shared', 'src/shared/paths', 'src/shared/followups',
    'src/shared/page', 'src/shared/page/ui', 'src/shared/page/layout-host', 'src/shared/page/file-drop',
    'src/plugins/notes', 'src/plugins/notes/contract.ts', 'src/plugins/notes/layouts']`
  - `src/plugins/notes/layouts`: `['src/shared/page/layout-host']`
  - `src/plugins/main.ts`: `['src/contracts', 'src/shared', 'src/plugins/chat', 'src/plugins/chat/main',
    'src/plugins/notes', 'src/plugins/notes/main']`
  - `src/plugins/manifests.ts`: `['src/contracts', 'src/shared', 'src/plugins/chat', 'src/plugins/keys',
    'src/plugins/notes']`
- `it.each` `'pluginLayers_EntryWithoutAPart_$layer'` over the same three folders, with no extras. Rows:
  `src/plugins/chat/main` (no layouts entry, so no `src/plugins/chat/layouts`): `['src/contracts', 'src/shared',
  'src/shared/paths', 'src/shared/followups', 'src/plugins/chat', 'src/plugins/chat/contract.ts']`; and
  `src/plugins/keys/page` (no `c(keys)`): `['src/contracts', 'src/shared', 'src/shared/paths', 'src/shared/followups',
  'src/shared/page', 'src/shared/page/ui', 'src/shared/page/layout-host', 'src/shared/page/file-drop',
  'src/plugins/keys']`. Each `toEqual` with `packages: []`. The result has no `src/plugins/keys/main` key, no
  `src/plugins/keys/contract.ts` key and no `src/plugins/chat/layouts` key.
- `it('pluginLayers_Extras_AppendToTheEntryAndAddSublayers')`: the same folders with extras
  `{ notes: { main: { layers: ['src/shared/agent-forms'], packages: ['node:'] }, sublayers: { 'src/plugins/notes/main/x':
  { layers: ['src/contracts'], packages: [] } } } }`: `src/plugins/notes/main` ends with `'src/shared/agent-forms'`
  and has `packages: ['node:']`, and `src/plugins/notes/main/x` equals the sublayer.
- `it.each` `'pluginLayers_NamesNoFolder_Throws: $case'`, rows `extras key` (`{ ghost: {} }` throws
  `PLUGIN_EXTRAS names ghost, which is no plugin folder`) and `dependency` (`notes` with `dependsOn.main: ['ghost']`
  throws `notes: dependsOn names ghost, which is no plugin folder`).
- `it.each` `'readDependsOn_$case'` on `src/plugins/notes/manifest.ts` sources. Rows that return
  `{ main: ['chat'], page: [] }`: `Literal` (`dependsOn: { main: ['chat'], page: [] }`) and `AsConst`
  (`dependsOn: { main: ['chat'], page: [] } as const`). Rows that throw `src/plugins/notes/manifest.ts: dependsOn must
  be an object literal with main and page arrays of string literals`: `Identifier` (`dependsOn: DEPS`), `FlatArray`
  (`dependsOn: ['chat']`), `Spread` (`dependsOn: { main: [...SHARED], page: [] }`), `NoPage`
  (`dependsOn: { main: ['chat'] }`). Row `NoDefinePlugin` (`export const m = {}`) throws
  `src/plugins/notes/manifest.ts: no definePlugin({ … }) call`.
- `it.each` `'compositionFailures_$case'` on a `src/plugins/main.ts` source with array `mainParts` and expected
  `['./chat/main/start', './notes/main/start']`. Rows: `Complete` gives `[]`; `MissesAFolder` (no notes import or
  element) gives `['src/plugins/main.ts: mainParts misses ./notes/main/start']`; `ListsOneTwice` (`chatMainPart`
  twice) gives `['src/plugins/main.ts: mainParts lists ./chat/main/start twice']`; `ListsNoPart` (an element imported
  from `./ghost/main/start`) gives `["src/plugins/main.ts: mainParts lists ./ghost/main/start, which is no plugin
  folder's part"]`; `UnimportedElement` (an element no import names, `strayPart`) gives
  `['src/plugins/main.ts: mainParts holds strayPart, which no import names']`; `ArrayMissing` (the source exports no
  `mainParts`) throws `src/plugins/main.ts: no exported array mainParts`; `SpreadElement` (an element `...extra`) gives
  `['src/plugins/main.ts: mainParts holds ...extra, which no import names']`.

Approach:
- `readDependsOn` finds the first call whose callee is the identifier `definePlugin`, takes its first argument as an
  object literal, and reads the property `dependsOn`. It unwraps `as` and `satisfies` around the `dependsOn` value
  and around each array. Each element must be a string literal; any other node throws the message above.
- `compositionFailures` reads the exported array named `arrayName` (in `main.ts` `mainParts`, in `page.ts`
  `pageParts`, in `manifests.ts` `builtInManifests`, measured at plan time). It maps each element, an identifier,
  through the file's named imports to its module specifier, and compares the specifiers with `expected`. The
  An element that is not an identifier (a spread, a call) is reported by its source text with the unimported-element
  line, and no import is read for it. A file that exports no array named `arrayName` makes the function throw
  `<file>: no exported array <arrayName>`. The
  runner's `expected` is `./<id>/main/start` for each folder with `hasMain`, `./<id>/page/start` for each with
  `hasPage`, and `./<id>/manifest` for each folder. A re-export (`export { DIGITS } from './forms/manifest'`) is not
  an element and is not read.
- The runner in `check-layers.mts`: list the directories of `src/plugins` (`readdirSync` with `withFileTypes`), fill
  each `PluginFolder` with `existsSync` and `readDependsOn`, build `LAYERS` as `{ ...CORE_LAYERS, ...pluginLayers(…) }`,
  then run `compositionFailures` on the three files and today's import check. Print every failure line with
  `console.error`; the clean line stays `layers: ${files.length} files clean`.
- Failure flow: the runner wraps each folder's `readDependsOn` call in `try`/`catch`, prints the message of each throw
  and collects the results of the others. A `no manifest.ts` folder prints its line the same way. When any read failed,
  it skips `pluginLayers` and the import check. Otherwise it wraps the `pluginLayers` call in `try`/`catch`, prints a
  throw, and skips the import check. Each print sets `process.exitCode = 1`. The `compositionFailures` runs need only
  the folder list, so they run in every case.
- Update the script's header comment: the plugin entries are derived, and the composition-root check runs.

Done when: compiles (`npm run typecheck`); the test gate runs `scripts/layer-rules.test.mts`; `npm run lint` passes
on the tree after tasks 08–10
Commit: one commit for the group

## Proof

Commit 9a21e0e9 · proof: Read layer-rules.mts whole and check-layers' shape; whole-tree typecheck and lint clean (1030 layer files); worker ran 36 named tests and two lint runs over throwaway folders that showed the runner's failure flow, folders removed · concerns: A clean lint does not show the derived rules reject anything beyond the unit rows; no break tried on the real tree. A quoted dependsOn key fails as not literal. AGENTS.md:694 says LAYERS, for task 13. The worker ran node and npx --version against the brief's denied list; neither fetched anything.
