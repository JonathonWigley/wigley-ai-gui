# 07 — Docs reads harness config roots from the adapter

Status: not started
Type: Task
Wave: 5 · Depends on: 05
Plan: [plan.md](plan.md)

Files:     create `src/plugins/docs/main/harness-folders.ts` · modify `src/plugins/docs/main/doc-files.ts` ·
           modify `src/plugins/docs/main/script-locator.ts` · modify `src/plugins/docs/main/index-sources.ts` ·
           modify `src/plugins/docs/main/plugin-status.ts` · modify `src/plugins/docs/main/start.ts` ·
           modify `src/plugins/docs/main/selftest-fixture.ts` · modify `src/plugins/docs/index-document.ts` ·
           modify `src/plugins/docs/kinds.ts` · modify `src/plugins/docs/contract.ts` ·
           modify `src/plugins/docs/page/docs-state.ts` · modify `src/plugins/docs/page/doc-view.ts` ·
           modify `src/plugins/docs/page/docs-view.ts` · modify `src/plugins/docs/page/docs-dialogs.ts` ·
           modify `src/plugins/docs/page/start.ts` · modify `src/plugins/docs/layouts/layout.d.ts` ·
           modify `docs/features/docs-browser/design.md` · modify `docs/features/followups.md` ·
           modify `docs/features/intent-alignment/master-plan.md` ·
           modify `.agents/skills/drive/SKILL.md` (line 82 at plan time: the `docs.seed` `indexDelayMs` text) ·
           create test `src/plugins/docs/main/harness-folders.test.ts` · test `src/plugins/docs/main/doc-files.test.ts` ·
           test `src/plugins/docs/main/script-locator.test.ts` · test `src/plugins/docs/main/plugin-status.test.ts` ·
           test `src/plugins/docs/main/start.test.ts` · test `src/plugins/docs/main/selftest-fixture.test.ts` ·
           test `src/plugins/docs/index-document.test.ts` · test `src/plugins/docs/kinds.test.ts` ·
           test `src/plugins/docs/page/docs-state.test.ts` · test `src/plugins/docs/page/doc-view.test.ts` ·
           test `src/plugins/docs/page/docs-dialogs.test.ts` · test `src/plugins/docs/page/start.test.ts` ·
Consumes:  `AgentHarness.configRoots(profileDir: string | null): HarnessConfigRoots` ← 04 ·
           `AgentHarness.installedPlugins(profileDir: string | null): Promise<InstalledPlugin[]>` ← 04 ·
           `InstalledPlugin { key; installDir; version; listedAt }`, `HarnessConfigRoots { configDir; pluginCacheDirs }` ← 04 ·
           `AgentHarnessInfo.projectConfigFolder`, `.label` ← 01, 04 · `coreAgentHarnessesSlot` ← 01 ·
           `AgentHarnessRegistry.get` / `list`, `services.agentHarnesses` ← 01 ·
           `harnessLabel(infos, id)` in `src/shared/agent-harness-label.ts` ← 01 · `IndexHarness` as `string` ← 01 ·
           `registeredProfiles(infos): RegisteredProfile[]` in `src/shared/harness-profiles.ts` ← 05 ·
           `FAKE_PROFILES` in `src/shared/fake-agent-harness.ts` ← 05 ·
           `FakeAgentHarness.setInstalledPlugins(configDir: string, plugins: readonly InstalledPlugin[]): void` ← 04 ·
           `isFakeAgentHarness` (today, `src/shared/fake-agent-harness.ts`)
Produces:  `export interface HarnessFolders` in `src/plugins/docs/main/harness-folders.ts`
Produces:  `export function createHarnessFolders(deps: HarnessFoldersDeps): HarnessFolders` in `src/plugins/docs/main/harness-folders.ts`
Produces:  `export function docsFixtureInstalls(home: string, paths: Paths): InstalledPlugin[]` in `src/plugins/docs/main/selftest-fixture.ts`
Produces:  `export interface HarnessChip extends Chip { harness: string }` in `src/plugins/docs/page/docs-state.ts`
Produces:  `harness: string;` on `ChipInput` in `src/plugins/docs/layouts/layout.d.ts`
Decisions:
- Docs' "open the plugin's config line" (`pluginConfigFile`, the `i` key on a plugin) needs the file and line that
  list a plugin key, and finding it is the harness's file format. `InstalledPlugin.listedAt` (task 04) carries it: the
  harness's config file that lists this install and the 1-based line holding its key, null when the harness has no
  such line. The Claude adapter fills it from `installed_plugins.json` (task 04). Docs only reads it.
- Every root comes from a registered profile (design doc § Docs and a harness's folders). For each
  `registeredProfiles(slot.all())` entry, in that order, docs calls `registry.get(harnessId)` and asks it
  `configRoots(profile.configDir)` and `installedPlugins(profile.configDir)`. A profile whose harness `get` misses is
  left out. The `~/.agents/wigley-docs/config.json` file keeps `claudeConfigDirs` for `docs_index.py`; docs stops
  reading it (plan.md Decisions).
- Docs expands `~` in each root against the docs home and normalizes it, and drops a root that is not absolute
  then, as `readClaudeConfigDirs` does today (drafter: the fake's `configFolder` returns `~/…` unexpanded).
- Guard folders after the change (`guardFolders` in `doc-files.ts`): global doc folders are each root's `configDir`,
  then `~/.agents`, then `~/wigley-agents`. Plugin caches are each root's `pluginCacheDirs`. Third-party folders are
  each root's `configDir` joined with `skills/synced` (drafter: `skills/synced` is the user's wigley sync folder, not
  the harness's layout). Each is made real as today, and a docs folder at or above home is still dropped.
- Codex has no adapter yet, so docs shows nothing for Codex: `~/.codex` is no guard folder (a write there is
  refused `Refused: <path> is outside the indexed folders`), `~/.codex/plugins/cache` is no cache, no chip, no
  `Not installed · …` text and no rollup part names Codex, and `pluginConfigFile(key, 'codex')` returns null (the
  page toasts `No config file lists <key>`). The index still lists Codex entries; a Codex plugin entry's `Harness`
  detail row shows the raw id `codex` (plan.md Decisions: an unregistered id shows as its raw id).
- `installedPluginsFile`, `readClaudeConfigDirs`, `DEFAULT_CLAUDE_CONFIG_DIRS`, `readJson`, `installedScripts`,
  `DOCS_CONFIG_FILE` and `quotedKeyForms` leave docs. `WIGLEY_PLUGIN_KEY` and `SCRIPT_IN_INSTALL` stay in
  `script-locator.ts`: they name the marketplace plugin and its script, not a harness file.
- `locateScript(files, homeDir, scriptPath, folders: Pick<HarnessFolders, 'installedPlugins'>, paths)`: a non-empty
  `scriptPath` is returned expanded as today; else each installed plugin whose `key` is `WIGLEY_PLUGIN_KEY`, in
  `installedPlugins()` order, gives `paths.join(installDir, SCRIPT_IN_INSTALL)`, and the first that stats as a file
  wins; null when none does. The `log` parameter goes.
- `HarnessFolders` (drafter internal shape):
  `roots(): ProfileRoots[]` with `interface ProfileRoots { harnessId: string; profile: string; roots: HarnessConfigRoots }`,
  and `installedPlugins(): Promise<HarnessPlugin[]>` with `interface HarnessPlugin { harnessId: string; plugin: InstalledPlugin }`.
  `HarnessFoldersDeps = { harnesses: Pick<AgentHarnessRegistry, 'get'>; infos(): ReadonlyMap<string, AgentHarnessInfo>; log: PluginLog }`.
  Both read the slot at each call. A profile whose `installedPlugins` rejects is logged
  `installed plugins of <profile name> not read: <errorText>` and lists none.
- `pluginConfigFile(key, harness)`: the `listedAt` of the first installed plugin with that `harnessId` and `key` and a
  non-null `listedAt`; null when none.
- Plugin status (`readPluginStatus`) judges `Not installed` only for registered harness ids: its `options` gain
  `harnesses: readonly string[]`, which replaces `INDEX_HARNESSES` in `pluginHarnesses`; docs main passes
  `[...slot.all().keys()]`. An index `meta.harness` or copy `harness` value matches a registered id by equality.
- The index's own `meta.harness` values stay `claude` and `codex`: `docs_index.py` is unchanged. Two rules
  read them as the script's vocabulary and stay: `sessionRun` in `index-sources.ts` (a relay harness `codex` runs
  `context`, since the script's `session` reads a Claude transcript) and `isSessionStale` in `docs-state.ts` (the
  `claude` copy's version). Each comment names `docs_index.py` as the owner of the value (drafter).
- `INDEX_HARNESSES` and `HARNESS_NAMES` go. `isInstalledCopy` accepts any string `harness` (task 01 may already have
  made this change).
- The chip record becomes a list (plan.md Decisions). Page functions take
  `infos: ReadonlyMap<string, AgentHarnessInfo>` (the type `harnessLabel` takes), which `page/start.ts` takes from
  `slot.all()`; its key order is registration order. Changed signatures:
  `chips(context, entryId, isPending, infos): HarnessChip[]` (one per key, in key order, text from `info.label`);
  `detailFields(entry, homeDir, paths, infos)` (the `Harness` row is `harnessLabel(infos, harness)`, `—` when the
  entry has no `harness`); `statusTexts(entry, status, loadedPlugins, infos)` (one `Not installed · <label>` per key
  in key order that `status.notInstalled` holds); `StatusCounts.notInstalled: Record<string, number>` starting `{}`;
  `rollupText(counts, infos)` (one `<n> not installed for <label>` part per key, count `?? 0`);
  `treeRowStatus(node, textsOf, files, clones, formatTime, paths, infos)`.
- Page reads: `DocsViewDeps` gains `infos(): ReadonlyMap<string, AgentHarnessInfo>` and
  `projectConfigFolders(): readonly string[]`; `DocsDialogsDeps` gains `projectConfigFolders(): readonly string[]`.
  `page/start.ts` builds both from `api.state.read(coreAgentHarnessesSlot)` at each call:
  `projectConfigFolders` is each info's `projectConfigFolder`, in key order, each once. Nothing redraws on a slot
  change: the next draw reads the new list (drafter: harnesses register at app start, before Docs draws).
- `DocViewDeps.chipsOf(entryId, path): HarnessChip[]`; the header input's `chips` is `chipsOf(…)`, `[]` for a file no
  entry names. `ChipInput.harness` becomes `string`, commented `// The id of the harness the chip is for.`; the docs
  layout contract changes in place (plan.md Decisions). The default `layout.js` reads only `text`, `tooltip` and
  `state`, so it is unchanged.
- No user layout is orphaned: `~/.config/wigley-ai-gui/layouts/docs/` holds only `layout.d.ts`, the contract copy
  the app writes there (`src/shared/layouts/layout-registry.ts`); no user `layout.js` exists (measured at plan time,
  re-verify).
- `kinds.ts`: `KindRule.placeFolder(entry, paths, projectConfigFolders: readonly string[])` and
  `placesFor(kind, entries, homeDir, paths, projectConfigFolders: readonly string[])`. `instructionsFolder` drops a
  trailing folder whose name is in `projectConfigFolders` for a repo's own instructions, where it checks `'.claude'`
  today (plan.md Decisions).
- `docs-view.ts` `pluginFile`: passes `metaString(entry, 'harness')`; null toasts `No config file lists <title>` and
  asks main nothing (drafter: `docs_index.py` writes `harness` on every plugin entry).
- Self-test and fake runs: the fake stands in for Claude with no file format. Task 04's
  `FakeAgentHarness.setInstalledPlugins(configDir, plugins)` sets the list `installedPlugins(configDir)` returns
  (`[]` before). The fake's profiles are `FAKE_PROFILES` (task 05: `work` at `~/.claude`, `personal` at
  `~/.claude-personal`). In a run whose `runMode` is not `live`, `startDocs` calls
  `setInstalledPlugins(profile.configDir, docsFixtureInstalls(homeDir, paths))` once per `FAKE_PROFILES` entry, on
  every `services.agentHarnesses.list()` member `isFakeAgentHarness` passes, whether or not it wrote the fixture (a
  drive restart keeps the fixture and builds a new fake).
- `docsFixtureInstalls(home, paths)` returns, in order:
  `{ key: WIGLEY_PLUGIN_KEY, installDir: <fixture wigleyInstall>, version: '0.0.0', listedAt: { path: <installed>, line: 2 } }`,
  `{ key: 'selftest-plugin@selftest-market', installDir: <fixture pluginRoot>, version: '1.0.0', listedAt: { path: <installed>, line: 3 } }`,
  where `<installed>` is `paths.join(home, '.claude', 'plugins', 'installed_plugins.json')`. The fixture still writes
  that file (the `i` step opens it, and a drive run on the real Claude adapter reads it); the fixture names the path
  itself once `installedPluginsFile` is gone.
- `startDocs` gets the registry and the harness infos (drafter): today it takes
  `Pick<MainServices, 'files' | 'processes' | 'log' | 'homeDir' | 'runMode' | 'paths'>` and no `api`. Its new signature:
  `startDocs(services: Pick<MainServices, 'files' | 'processes' | 'log' | 'homeDir' | 'runMode' | 'paths' | 'agentHarnesses'>, scriptPath: () => string, entries: () => readonly IndexEntry[], infos: () => ReadonlyMap<string, AgentHarnessInfo>): Promise<DocsMain>`.
  It builds `createHarnessFolders({ harnesses: services.agentHarnesses, infos, log: services.log })`, and reads
  `services.agentHarnesses.list()` for the fixture installs below. The call site in `docsMainPart.start`
  (`src/plugins/docs/main/start.ts`, line 234 at plan time) reads the slot once,
  `const harnessInfos = api.state.read(coreAgentHarnessesSlot);`, and passes `() => harnessInfos.all()` as the
  fourth argument. `src/plugins/docs/main/start.test.ts` calls `startDocs` (line 35 at plan time) with a fake
  registry in `services.agentHarnesses` and `() => <a map built from the fake's id and info()>`.
- The drive action `docs.seed`'s description (`src/plugins/docs/main/start.ts`, line 169 at plan time) says
  `the Docs tree's pending chip` where it says `the Docs tree's "Claude pending" chip`. The drive skill
  (`.agents/skills/drive/SKILL.md`, line 82 at plan time) says `keeps the Docs tree's pending chip on screen long
  enough to see` where it says `keeps the Docs tree's "Claude pending" chip on screen long enough to see`. The
  `indexDelayMs` comment in `selftest-fixture.ts` (line 82 at plan time) already reads `tree's pending chip` and
  stays.
Mandatory: AGENTS.md § Architecture paragraphs "A slot", "An agent harness", "A layout" (the layout contract);
           plan.md Mandatory Reads; `docs/features/docs-browser/design.md` whole;
           `docs/features/agent-harnesses/design.md` § Docs and a harness's folders.
GIVEN profiles `work` (`~/.claude`) and `personal` (`~/.claude-personal`) registered under `claude` WHEN docs judges a
  write THEN each profile's resolved config folder is writable, and each folder's plugin caches and `skills/synced`
  are refused.
GIVEN a write target inside `~/.codex` WHEN docs judges it THEN docs refuses it as outside the indexed folders.
GIVEN `docs.scriptPath` is empty WHEN docs runs the index THEN it runs the first `docs_index.py` that exists under an
  install of `wigley@wigley-ai-marketplace` among the registered profiles' installed plugins.
GIVEN the second profile's installs list `p@m` at line 3 WHEN the page asks `pluginConfigFile('p@m', 'claude')` THEN
  main returns that file and line 3.
GIVEN harnesses `claude` (`Claude Code`) then `b` (`Bee`) registered WHEN the doc header draws THEN its chips read
  `Claude Code …` then `Bee …`, and a Codex load state in the index draws no chip.
GIVEN a repo instructions file in a folder named for a registered harness's `projectConfigFolder` WHEN the create
  dialog lists places THEN the place is that folder's parent.
Tests:
- `src/plugins/docs/main/harness-folders.test.ts › roots_TwoProfiles_SlotOrder` — slot `claude` with `work`, `personal`;
  `roots()` lists `work` then `personal` with the fake harness's `configRoots` of each `configDir`.
- `harness-folders.test.ts › roots_HarnessNotRegistered_LeftOut` — a slot entry whose id `get` misses gives `[]`.
- `harness-folders.test.ts › installedPlugins_OneRejects_LoggedAndLeftOut` — the second profile rejects `nope`: the
  list holds the first profile's plugins only, log `['installed plugins of personal not read: nope']`.
- `src/plugins/docs/main/doc-files.test.ts`: `setUp` gains `folders` (a `HarnessFolders` stub with roots
  `/Users/u/.claude` and `/Users/u/.claude-personal`, caches `<dir>/plugins/cache`), replacing the
  `config.json` writes. Every existing guard test keeps its expected refusal. New
  `write_InsideCodexFolder_RefusedOutsideIndexedFolders` — writing `/Users/u/.codex/AGENTS.md` rejects with
  `Refused: /Users/u/.codex/AGENTS.md is outside the indexed folders`.
- `doc-files.test.ts › pluginConfigFile_ClaudeSecondDir_KeyLine` — becomes
  `pluginConfigFile_SecondProfileListsKey_ItsListedAt`: installs `p@m` on profile 2 with
  `listedAt { path: '/Users/u/.claude-personal/plugins/installed_plugins.json', line: 3 }` → that value; `q@m` → null.
  `pluginConfigFile_Codex_ConfigToml` and `pluginConfigFile_CodexKeyPrefixOfAnother_MatchesWholeKey` become one
  `pluginConfigFile_UnregisteredHarness_Null` (`'codex'` → null).
- `src/plugins/docs/main/script-locator.test.ts`: the `readClaudeConfigDirs` describe and
  `readClaudeConfigDirs_WindowsEntries_AbsoluteKeptNormalized` go; the `locateScript_*` tests take installs from a
  `folders` stub (`locateScript_SecondConfigDir_Found` becomes `locateScript_SecondProfilesInstall_Found`);
  `locateScript_UnreadableInstalledPlugins_NullAndLogged` goes (harness-folders owns that log).
- `src/plugins/docs/main/plugin-status.test.ts`: each `readPluginStatus` call passes
  `harnesses: ['claude', 'codex']` and keeps its expectation; new `readPluginStatus_UnregisteredHarness_NotChecked` —
  `harnesses: ['claude']`, a differing Codex copy → no `notInstalled` for that entry.
- `src/plugins/docs/index-document.test.ts › installedCopies_AnyHarnessString_Kept` — a copy with `harness: 'other'`
  is kept.
- `src/plugins/docs/kinds.test.ts › placesFor_InstructionsInDotClaude_DropsDotClaude` becomes the table
  `placesFor_RepoInstructions_given $given`: `projectConfigFolders ['.claude']`,
  `/Users/u/dev/r/.claude/CLAUDE.md` → folder `/Users/u/dev/r`; `['.agentx']`, `/Users/u/dev/r/.agentx/AGENTS.md` →
  `/Users/u/dev/r`; `[]`, `/Users/u/dev/r/.claude/CLAUDE.md` → `/Users/u/dev/r/.claude`. Existing `placesFor` calls
  pass `['.claude']`.
- `src/plugins/docs/page/docs-state.test.ts`: `chips_*` take `infos` a map holding `claude` → `{ label: 'Claude Code', … }` and assert
  a one-chip list; new `chips_TwoHarnesses_RegistrationOrderAndLabels` (`b` `Bee` then `claude` `Claude Code` → harness
  ids `['b', 'claude']`, texts `Bee —`, `Claude Code —`) and `chips_NoHarnesses_Empty` (an empty map → `[]`).
  `statusTexts_EverySet_InPinnedOrder` with a map holding `claude` and `notInstalled: ['codex', 'claude']` expects
  `['Uncommitted', 'Unpushed', 'Not installed · Claude Code', 'Session stale']`. `rollupText_*` take a map holding
  `claude`, `codex` with labels `Claude Code`, `Codex` and keep their expectations. `detailFields_Plugin_InstallsJoined`
  passes a map holding `claude` and keeps `['Harness', 'Claude Code']`; new `detailFields_UnregisteredHarness_RawId` —
  `meta.harness` `'codex'` with a map holding `claude` → first row `['Harness', 'codex']`.
- `src/plugins/docs/page/doc-view.test.ts`: the `chipsOf` stub returns a `HarnessChip[]`; the header test expects
  `chips` to equal it.
- `src/plugins/docs/page/docs-dialogs.test.ts`, `src/plugins/docs/page/start.test.ts`,
  `src/plugins/docs/main/start.test.ts`, `src/plugins/docs/main/selftest-fixture.test.ts`: deps edits only; the
  docs main start test registers a fake harness whose `info().profiles` holds `work` (task 05's `FAKE_PROFILES`).
- `src/plugins/docs/main/start.test.ts › startDocs_NonLiveRun_SetsTheFixtureInstallsOnEachFakeProfile` — a fake
  harness in a non-live run: `installedPlugins('~/.claude')` and `installedPlugins('~/.claude-personal')` each equal
  `docsFixtureInstalls(home, paths)`; a live run sets nothing (`[]`).
- Self-test: no new step. `src/plugins/docs/main/selftest-script.ts` steps `'[docs] editing installed_plugins.json'`
  and `'[docs] closed the editor on installed_plugins.json'` now pass through the fake's `listedAt`, and every docs
  index step through `locateScript` finding the stand-in script by the fake's installs.
Approach:
- `docs/features/docs-browser/design.md`: lines 102–103 say the script is found through the wigley install each
  registered harness profile lists (`installedPlugins`); line 131 says one load-state chip per registered harness, in
  registration order, with the adapter's label; lines 150–153 say each registered profile's config folder,
  `~/.agents` and `~/wigley-agents`, and the adapter's plugin caches; line 240's rollup example reads
  `3 uncommitted · 12 not installed for Claude Code`. Line 184 (plan B history) stays.
Done when: compiles (`npm run lint` and `npm run typecheck` per the repo's scripts); the test gate runs the tests above;
           `grep -rn "'\.codex'\|config\.toml\|readClaudeConfigDirs\|installedPluginsFile\|HARNESS_NAMES\|INDEX_HARNESSES" src/plugins/docs`
           finds nothing (it finds 48 lines in 8 files today, measured at plan time).
Commit:    one commit for the group; it also removes "Docs reads harness config roots from the adapter" from
           `docs/features/followups.md` § Harness seams and ticks its box in
           `docs/features/intent-alignment/master-plan.md` step 3 (`[ ] Docs reads harness config roots from the adapter`).

## Proof

