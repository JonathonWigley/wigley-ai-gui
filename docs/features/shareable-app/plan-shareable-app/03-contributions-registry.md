# 03 — Contributions registry: the `contributions` plugin and config problems

Status: not started
Type: Task
Rung: deep · crosses the harness install lists, file watches with a debounce, and the ConfigStore's served problems
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

The contract is `docs/features/feature-contributions/design.md` § The file, § The registry, § Picking a strategy and
§ Names and types. Read those sections in full first. This task builds the registry and the file types. It registers
no feature reader: each feature task (04, 07, 08, 09, 10) registers its own.

All paths are under `wigley-ai-gui/`.

Files:
- create `src/contracts/contributions.ts`
- create `src/shared/contributions-schema.ts`
- create `src/plugins/contributions/manifest.ts`
- create `src/plugins/contributions/contract.ts`
- create `src/plugins/contributions/main/start.ts`
- create `src/plugins/contributions/main/sources.ts`
- create `src/plugins/contributions/main/registry.ts`
- create `src/plugins/contributions/main/reload.ts`
- create `src/plugins/contributions/page/start.ts`
- create `src/plugins/contributions/page/control-kinds.ts`
- test `src/plugins/contributions/contract.test.ts`
- test `src/plugins/contributions/main/sources.test.ts`
- test `src/plugins/contributions/main/registry.test.ts`
- test `src/plugins/contributions/main/start.test.ts`
- test `src/plugins/contributions/page/control-kinds.test.ts`
- modify `src/contracts/plugin.ts` (add `MainServices.configProblems` and `ConfigProblemsService`)
- modify `src/contracts/agent.ts` (add `HarnessConfigRoots.installedPluginsFile`)
- modify `src/plugins/claude-code/main/claude-code-harness.ts` (fill `installedPluginsFile`)
- modify `src/shared/fake-agent-harness.ts` (fill `installedPluginsFile`)
- modify `src/main/plugins/main-api.ts` (the per-plugin `configProblems` view)
- modify `src/main/main.ts` (build the service; hand its problems to the ConfigStore)
- modify `src/main/config/config-store.ts` (add `setServiceProblems`)
- test `src/main/config/config-store.test.ts` (add rows)
- test `src/main/plugins/main-api.test.ts` (add a row)
- modify `src/main/plugin-catalog/plugin-types.ts` (write `auri.schema.json`)
- test `src/main/plugin-catalog/plugin-types.test.ts` (add the file to the listed files)
- modify `src/shared/plugin-part-harness.test-support.ts` (a fake `configProblems`)
- modify `src/plugins/manifests.ts`, `src/plugins/main.ts`, `src/plugins/page.ts` (register the plugin)
- modify `src/plugins/sessions/contract.ts` (re-export `ActivityTone` and `RowEmphasis` from `src/contracts/contributions.ts`)

Consumes:
- `AGENT_PLUGIN_NAME`, `APP_PLUGIN_KEY`, `CONTRIBUTIONS_FILE`, `CONTRIBUTIONS_VERSION`, `agentPluginDir(appDir, paths)` in
  `src/shared/agent-plugin.ts` ← 01
- `MainServices.appDir: string` in `src/contracts/plugin.ts` ← 01
- `createHarnessFolders(deps)` (`src/shared/harness-folders.ts`), `coreAgentHarnessesSlot`, `SettingsPageExports.addControlKind`
  and `settingsPageKey` (`src/plugins/settings/contract.ts`): already in the tree.

Produces:
- `src/contracts/contributions.ts`: `FeatureKey`, `AuriFile`, `WorkflowDecl`, `StageDecl`, `TriggerDecl`, `PredicateDecl`,
  `CounterDecl`, `ActivityDecl`, `ActionDecl`, `PlanFormat`, `RetroContribution`, `BacklogContribution`,
  `DocsContribution`, `CommandPattern`, `LiveViewContribution`, each exactly as design.md § Names and types › The file
  writes it. Also `FEATURE_KEYS: readonly FeatureKey[]` (`['workflows', 'planFormat', 'retro', 'backlog', 'docs',
  'liveView']`) and `qualifiedWorkflowId(pluginName: string, id: string): string` (returns `<pluginName>:<id>`).
  `ActivityTone` and `RowEmphasis` move here: `scripts/check-layers.mts` gives `src/contracts`
  `{ layers: [], packages: [] }` (line 605, measured at plan time), so a `contracts/` file cannot import a plugin
  contract. Declare both unions in `contracts/contributions.ts` with the members `src/plugins/sessions/contract.ts`
  holds today (lines 611 and 631), delete them there, and have `sessions/contract.ts` re-export them
  (`export type { ActivityTone, RowEmphasis } from '../../contracts/contributions'`), so every existing importer
  compiles unchanged and the unions have one home.
- `src/shared/contributions-schema.ts`: `auriFileSchema: JsonValue`, the JSON schema of `AuriFile` (draft 2020-12), with
  `version` as `const: 1` and every section's fields as design.md lists them.
- `src/plugins/contributions/contract.ts`: `ContributionSource`, `ReadResult<V>`, `FeatureReader<V>`, `Strategy<V>`,
  `FeatureStrategies`, `ContributionsMainExports`, `contributionsMainKey`, `contributionsFeaturesSlot`, `StrategyPick<V>`,
  `pickStrategy<V>(strategies, setting)`, `strategyControlKind(key)`, `WORKFLOW_LIST_CONTROL_KIND`, each exactly as
  design.md § Names and types › The registry writes it.
- `src/plugins/contributions/contract.ts`: `pickProblemText(featureLabel: string, pick: StrategyPick<unknown>): string | null`,
  pure, null for `picked`; `none` → `No installed plugin binds <label>.`, `choose` → `Several plugins bind <label>: pick
  one in Settings.`, `missing` → `<label> is set to <id>, which is not installed.` Tasks 07 and 08 consume it; one
  table row per pick in `contract.test.ts`.
- `src/contracts/plugin.ts`: `interface ConfigProblemsService { set(problems: readonly ConfigProblem[]): void }` and the
  field `configProblems: ConfigProblemsService` on `MainServices`.
- `src/contracts/agent.ts`: `HarnessConfigRoots.installedPluginsFile: string | null`, the file that lists the profile's
  plugin installs; Claude Code gives `<configDir>/plugins/installed_plugins.json`.
- `src/main/config/config-store.ts`: `ConfigStore.setServiceProblems(problems: readonly ConfigProblem[]): void`.
- `src/main/plugin-catalog/plugin-types.ts`: `writePluginTypes` also writes `auri.schema.json` (the text of
  `auriFileSchema`) into `typesFolder`.

Decisions:
- **A plugin, not core.** Id `contributions`, label `Contributions`, description `Reads each agent plugin's auri.json
  and offers its strategies to the app's features.` `dependsOn: { main: [], page: ['settings'] }`,
  `reads: { main: [], page: [] }`, no commands, no settings, `demoSkip: 'It has no screen of its own; each feature it
  feeds shows its strategies.'` It goes first in `builtInManifests` after `sessions`, because every feature that reads
  contributions lists it in `dependsOn.main`. (design.md § The registry)
- **Sources** (`main/sources.ts`, pure apart from the `Files` it takes). Each scan builds candidates in this order:
  1. The app's own plugin: root `agentPluginDir(services.appDir, services.paths)`, key `APP_PLUGIN_KEY`, plugin name
     `AGENT_PLUGIN_NAME`, version `null`, `harnessId: null`.
  2. Each `HarnessPlugin` from `createHarnessFolders({ harnesses: services.agentHarnesses, infos, log })
     .installedPlugins()`, in the order it returns them: root `plugin.installDir`, key `plugin.key`, plugin name the key
     up to its first `@` (the whole key when it has none), version `plugin.version`, `harnessId`.
  A candidate whose root `files.realPath` rejects is dropped with no log. `sources.ts` reads each candidate's
  `<root>/auri.json` once, with `files.read`: a read that rejects with a missing file (`isMissingFile`) means the
  candidate is not a source; any other rejection (EACCES, a folder named `auri.json`) keeps the candidate as a source
  carrying `{ error: errorText }`, and a read that succeeds carries `{ text }`. `ContributionSource.root` is the real
  path. `sources.ts` returns `{ source: ContributionSource; file: { text: string } | { error: string } }[]`;
  `registry.ts` parses from `file` and never reads, so a scan reads each file once and an unreadable file still
  shows its problem.
- **Dedupe**, after the file check, in candidate order:
  - Two candidates with the same real root are one source: the first is kept.
  - Two candidates with the same plugin name and different roots keep one. The app's own plugin (`pluginKey ===
    APP_PLUGIN_KEY`) beats any install. Between installs, the higher `version` wins: compare the dot-separated parts
    as numbers from the left, a non-numeric part as text, and `null` lower than any version. A tie keeps the first.
  - Each dropped candidate logs `dropped <key> at <root>: <reason>`, with reason `same folder as <kept key>` or
    `<kept key> at <kept root> wins`.
  - The kept sources stay in candidate order: the app's own plugin first, then installs in profile order.
- **The file** (`main/registry.ts`). `JSON.parse` the source's `file.text`. One **file problem** and no section loads
  when the source carries `file.error` (`<plugin name>: auri.json not read: <errorText>`), the text is not JSON (`<plugin name>: auri.json is not
  JSON: <errorText>`), the value is not an object (`<plugin name>: auri.json is not an object`), or `version !==
  CONTRIBUTIONS_VERSION` (`<plugin name>: auri.json version is <JSON of the value>, not 1`). `$schema` is ignored. A top
  key that is not `version`, `$schema` or a registered feature key logs `<plugin name>: auri.json key <key> is read by
  no feature; ignored`, once per scan.
- **Readers.** `registerFeature(key, reader)` throws `feature <key> is already registered` for a held key. It runs
  `reader.read(section, source)` over every source holding the key, at once from the last scan's parsed files, and again
  on every scan. A refused section is one **section problem**: `<plugin name>: <key><reason>` for each reason, where a
  reason that starts with `[` or `.` follows the key directly (`wigley: workflows[2].stages[4].enter[0]: …`) and any
  other reason follows `: ` (`wigley: retro: command is not a string`). A reader that throws is a section problem with
  the reason `reader failed: <errorText>`. A source with no section for the key gives no strategy and no problem.
- **Strategies.** One `Strategy` per accepted section: `id` the source's plugin name, `label` the section's `label` when
  the section is an object holding a non-empty string `label`, else the plugin name, `source`, and `value` the reader's
  value. Source order is kept.
- **Slot and change.** The main part publishes `contributionsFeaturesSlot`: key the feature key, value
  `{ key, label: reader.label, strategies }`, for every registered key (an empty `strategies` array when none). After a
  scan or a registration, a key whose `JSON.stringify` of strategies is unchanged writes nothing and calls no listener;
  a changed key sets the slot, then calls each `onChanged(key)` listener with the new strategies. The dispose of a
  registration deletes the slot key, drops the key's section problems, and calls no listener.
- **Problems.** After each scan and each registration change, the part calls `services.configProblems.set` with every
  file problem, then every section problem, in source order then feature-key order (`FEATURE_KEYS`). Each problem's
  `file` is the full path `<root>/auri.json`. A fixed file clears its problems on the next scan.
- **`ready`** resolves after the first scan settles, fulfilled even when the scan logs an error. `strategies(key)`
  before `ready`, or for a key no reader holds, returns `[]`.
- **Reload** (`main/reload.ts`). The part rescans when any of these changes:
  - the file `installedPluginsFile` of any registered profile: watch its folder with `files.watch(folder, onChange,
    { recursive: false })`, and act only on a change whose path is the file's base name;
  - any source's `auri.json`: watch the source root the same way, acting only on `auri.json`;
  - the `core.agentHarnesses` slot (`coreAgentHarnessesSlot`): any change.
  A folder that `files.stat` reports absent is not watched (a watch creates a missing folder); each scan recomputes the
  watched folders, disposing watches it no longer needs and starting new ones. Every trigger restarts one 300 ms timer
  (`services.timers`); the scan runs when it fires. A scan that starts while one runs is queued once. Each watch
  passes `WatchOptions` (`src/contracts/files.ts`) with:
  - `onError`: logs `watch of <folder> failed: <errorText>` and forgets the watch (it has disposed itself), so the
    next scan starts it again;
  - `onMissed`: restarts the 300 ms timer, like a change.
  `files.watch` throws when it cannot start (`files.ts`: a start failure never reaches `onError`). The part catches
  that throw, logs the same `watch of <folder> failed: <errorText>` line, records no watch, and the next scan tries
  again.
- **`installedPluginsFile`.** The registry names no harness file. Claude Code's `configRoots` returns
  `paths.join(configDir, 'plugins', 'installed_plugins.json')`, the file `installed-plugins.ts` reads. The fake harness
  returns `<configDir>/plugins/installed_plugins.json` too. A harness with no such file returns `null`, and only its
  installs' `auri.json` files and the harness slot trigger a rescan for it.
- **`services.configProblems`.** `main.ts` keeps one map, plugin id → problems. `main-api.ts` gives each main part a
  view whose `set` replaces that plugin's entry, and whose part stop (the `registrations` dispose) deletes it. After each
  change `main.ts` calls `configStore.setServiceProblems` with every entry's problems, in plugin catalog order.
  The ConfigStore serves them last, after `...[...outsideProblems, ...admitted.problems]`, with each problem's own
  `file` and `message`. An unchanged list (by `JSON.stringify`) does not rebuild, as `setPluginProblems` does today.
  The test harness's fake records the last `set` per plugin.
- **`auri.schema.json`.** `writePluginTypes` writes it beside `manifest.schema.json` under
  `<config folder>/plugins/_types/` on every start (design.md § The file › Where it sits). It is data from
  `auriFileSchema`, so a plugin author's editor checks the file.
- **`pickStrategy`** in `contract.ts`, pure, exactly the five rules of design.md § Picking a strategy › Single-strategy
  features. `choose` lists the ids in source order.
- **`strategyControlKind(key)`** returns `` `strategy:${key}` ``.
- **Control kinds** (`page/control-kinds.ts`, `page/start.ts`). The page part reads `contributionsFeaturesSlot`. For
  each key in the slot it adds one kind through `settings.addControlKind`, id `strategyControlKind(key)`, and disposes
  it when the key leaves the slot:
  - `text(value)`: `''` → `Automatic`; an installed id → its strategy's label; any other string → `<value> (not
    installed)`.
  - `edit: { type: 'picker', items: () => ['', ...ids], label }`, where `label('')` is `Automatic` and `label(id)` is the
    strategy's label, else `<id> (not installed)`. `items` reads the slot at each call.
  It also adds `WORKFLOW_LIST_CONTROL_KIND` once, over the slot's `workflows` key, whose strategy values are
  `WorkflowDecl[]` (04's reader):
  - A row per declared workflow, id `qualifiedWorkflowId(strategy.id, decl.id)`, in source then array order.
  - `text(value)`: `All on` for an empty array; else `<n> off`.
  - `edit: { type: 'picker', items, label }`. Each item is the whole next `off` array: the current value with that row's
    id added when absent, removed when present. The current value is the user layer's value at `leaf.path` in
    `read.config`, else `leaf.fallback.value`, else `[]`. `label(item)` is `<decl.label> · <plugin name> · on` or
    `· off`, as the row will be after the pick.
  - With no `workflows` key or no declared workflow, `items` returns `[]`.

GIVEN no agent plugin holds `auri.json` and the app's own `agent-plugin/` holds none WHEN the part starts THEN `ready`
resolves, every registered key's slot value has `strategies: []`, and `configProblems.set` was called with `[]`.

GIVEN two profiles whose installs list one folder for `wigley@wigley-ai-marketplace` WHEN the registry scans THEN one
source is kept and one line `dropped wigley@wigley-ai-marketplace at <root>: same folder as wigley@wigley-ai-marketplace`
is logged.

GIVEN one plugin's `auri.json` with a bad `retro` section and a good `backlog` section WHEN both readers are registered
THEN `strategies('backlog')` holds the plugin's strategy, `strategies('retro')` is empty, and one problem names the
file's full path with a message starting `<plugin name>: retro`.

GIVEN a scan has run WHEN an `auri.json` changes twice 100 ms apart THEN one scan runs, 300 ms after the second change.

Tests (each names the break it catches; test doubles are the memory `Files`, the fake harness and the fake timers the
part harness gives):
- `contract.test.ts` › `pickStrategy` — one table: `('wigley', [wigley])` → picked; `('', [wigley])` → picked;
  `('', [])` → none; `('', [a, b])` → `choose` with `['a', 'b']`; `('gone', [a])` → `missing` with id `gone`. Catches a
  pick rule that drifts from the design. `strategyControlKind('retro')` is `strategy:retro`.
- `sources.test.ts` › dedupe — one table: same real root in two profiles; same name, versions `1.2.0` against
  `1.10.0` (`1.10.0` wins); `null` against `0.1.0`; a tie (first wins); an installed `auri` against the app's own (the
  app's wins). Each row asserts the kept keys in order and the logged drop line. Catches string version compare and a
  lost source order.
- `sources.test.ts` › candidate with no `auri.json` and candidate whose root does not exist — neither is a source, and
  nothing is logged. A candidate whose `auri.json` read rejects with a non-missing error is a source carrying
  `{ error }`. Catches an unreadable file that vanishes with no problem shown.
- `registry.test.ts` › problem order — two sources, the first with a section problem under `retro` and the second
  with a file problem, plus a section problem under `workflows` in the first: `configProblems.set` receives the file
  problem first, then the first source's `workflows` problem, then its `retro` problem (`FEATURE_KEYS` order).
  Catches problems served in registration order.
- `registry.test.ts` › strategy label — one table over a section's `label`: `'Wigley levels'` → that label; `''`,
  `5`, absent, and a section that is an array → the plugin name. Catches an empty or non-string label shown in
  Settings.
- `registry.test.ts` › late reader — a reader registered after the first scan runs at once over the stored parsed
  files (no new read: the memory `Files` read count is unchanged) and its strategies are in the slot.
- `start.test.ts` › watch failures — one table: an `onError` call logs `watch of <folder> failed: <text>` and the
  next scan starts a new watch on that folder; a `watch` that throws at start logs the same line and the next scan
  retries it; an `onMissed` call triggers one scan 300 ms later. A folder `files.stat` reports absent gets no watch.
  Catches a reload that dies after one watcher error, or a watch that creates a missing folder.
- `registry.test.ts` › file problems — one table: unreadable, not JSON, an array, `version: 2`. Each gives one problem
  with the exact message above and loads no section. Catches a bad file that leaks a section.
- `registry.test.ts` › section problem keeps the other sections — the GIVEN above. Catches one bad section dropping the
  whole plugin.
- `registry.test.ts` › problem message joins — a reason `[2].stages[4].enter[0]: "from" names no stage or group:
  featureRn` under key `workflows` gives `wigley: workflows[2].stages[4].enter[0]: …`; a reason `command is not a
  string` under `retro` gives `wigley: retro: command is not a string`.
- `registry.test.ts` › unknown key logs once per scan; `registerFeature` twice throws `feature retro is already
  registered`; a reader that throws gives `reader failed: <text>`.
- `registry.test.ts` › unchanged scan writes nothing — a second scan over the same files calls no `onChanged` listener
  and leaves the slot value the same object. Catches a slot write loop.
- `registry.test.ts` › dispose — removes the slot key and the key's problems.
- `start.test.ts` › reload debounce — the last GIVEN, with fake timers: no scan at 299 ms after the last change, one
  scan at 300 ms. A change to `installed_plugins.json` and a `core.agentHarnesses` change each trigger one scan. A
  change to another file in the watched folder triggers none.
- `start.test.ts` › problems reach the service — the fake `configProblems` holds the problem with `file` the full
  `auri.json` path; a fixed file clears it on the next scan.
- `control-kinds.test.ts` › strategy kind text and items — one table over `''`, an installed id and a missing id, and
  `items` is `['', 'wigley']` for one strategy.
- `control-kinds.test.ts` › workflow list toggle — with `off: ['wigley:large']`, the item for `wigley:large` is `[]` and
  its label ends `· on`; the item for `wigley:small` is `['wigley:large', 'wigley:small']`.
- `config-store.test.ts` › add a row: service problems serve after the plugin problems, with their own `file`; an equal
  list does not re-serve.
- `main-api.test.ts` › add a row: a part's stop clears its `configProblems` entry.
- `plugin-types.test.ts` › add `auri.schema.json` to the listed files.

Verification:
- `npm run typecheck`
- `npx` is denied on this machine: run tests through `npm test -- src/plugins/contributions src/main/config/config-store.test.ts src/main/plugins/main-api.test.ts src/main/plugin-catalog/plugin-types.test.ts src/plugins/manifests.test.ts`
- `npm run lint`
- `grep -rn "wigley" src/plugins/contributions src/contracts/contributions.ts src/shared/contributions-schema.ts` prints
  nothing outside test fixtures (boundary rule).

Done when: compiles; lint passes; the tests above pass; a start with no `auri.json` anywhere logs no error and serves no
config problem.

Commit: one commit for the group.

## Proof

