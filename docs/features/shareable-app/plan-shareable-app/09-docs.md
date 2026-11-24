# 09 — Docs reads its folders, wiki page and link prefixes from contributions; the docs index moves into the app

Status: done
Type: Task
Rung: deep · it adds a file format the TypeScript plugin writes and the Python index reads, and moves the index across repos with a parser the marketplace still imports
Wave: 3 · Depends on: 01, 03
Plan: [plan.md](plan.md)

Files (wigley-ai-gui):
- move `wigley-ai-marketplace/plugins/wigley/scripts/docs-index/` → `wigley-ai-gui/agent-plugin/scripts/docs-index/` (every file, `README.md` and `tests/` included, with `git mv`)
- modify `wigley-ai-gui/agent-plugin/scripts/docs-index/docs_index.py`
- modify `wigley-ai-gui/agent-plugin/scripts/docs-index/config.py`
- modify `wigley-ai-gui/agent-plugin/scripts/docs-index/discover.py`
- modify `wigley-ai-gui/agent-plugin/scripts/docs-index/doc_fields.py`
- modify `wigley-ai-gui/agent-plugin/scripts/docs-index/section_refs.py`
- modify `wigley-ai-gui/agent-plugin/scripts/docs-index/README.md`
- create `wigley-ai-gui/agent-plugin/scripts/docs-index/contributions.py`
- test `wigley-ai-gui/agent-plugin/scripts/docs-index/tests/test_contributions.py` (create)
- test `wigley-ai-gui/agent-plugin/scripts/docs-index/tests/test_discover.py`
- test `wigley-ai-gui/agent-plugin/scripts/docs-index/tests/test_config.py`
- test `wigley-ai-gui/agent-plugin/scripts/docs-index/tests/test_doc_fields.py`
- test `wigley-ai-gui/agent-plugin/scripts/docs-index/tests/test_section_refs.py`
- test `wigley-ai-gui/agent-plugin/scripts/docs-index/tests/test_docs_index.py`
- modify `wigley-ai-gui/src/plugins/docs/manifest.ts`
- modify `wigley-ai-gui/src/plugins/docs/contract.ts`
- modify `wigley-ai-gui/src/plugins/docs/kinds.ts`
- modify `wigley-ai-gui/src/plugins/docs/tree.ts`
- modify `wigley-ai-gui/src/plugins/docs/wiki-main.ts`
- modify `wigley-ai-gui/src/plugins/docs/main/start.ts`
- modify `wigley-ai-gui/src/plugins/docs/main/doc-files.ts`
- modify `wigley-ai-gui/src/plugins/docs/main/script-locator.ts`
- modify `wigley-ai-gui/src/plugins/docs/main/index-sources.ts`
- modify `wigley-ai-gui/src/plugins/docs/main/selftest-fixture.ts`
- modify `wigley-ai-gui/src/plugins/docs/page/docs-view.ts`
- modify `wigley-ai-gui/src/plugins/docs/page/doc-view.ts` (two comments)
- modify `wigley-ai-gui/src/plugins/docs/page/list-page.ts`
- modify `wigley-ai-gui/src/plugins/docs/page/docs-dialogs.ts`
- modify `wigley-ai-gui/src/plugins/docs/page/wiki-main-source.ts`
- create `wigley-ai-gui/src/plugins/backlog/main/features-homes.ts`
- create `wigley-ai-gui/src/plugins/docs/main/docs-reader.ts`
- create `wigley-ai-gui/src/plugins/docs/main/contributions-file.ts`
- test `wigley-ai-gui/src/plugins/backlog/main/features-homes.test.ts` (create)
- test `wigley-ai-gui/src/plugins/docs/main/docs-reader.test.ts` (create)
- test `wigley-ai-gui/src/plugins/docs/main/contributions-file.test.ts` (create)
- test `wigley-ai-gui/src/plugins/docs/main/script-locator.test.ts`
- test `wigley-ai-gui/src/plugins/docs/main/index-sources.test.ts`
- test `wigley-ai-gui/src/plugins/docs/main/start.test.ts`
- test `wigley-ai-gui/src/plugins/docs/main/doc-files.test.ts`
- test `wigley-ai-gui/src/plugins/docs/kinds.test.ts`
- test `wigley-ai-gui/src/plugins/docs/tree.test.ts`
- test `wigley-ai-gui/src/plugins/docs/wiki-main.test.ts`
- modify `wigley-ai-gui/AGENTS.md` (the docs-index sentence at lines 35–36, measured at plan time, re-verify)

Files (wigley-ai-marketplace):
- create `wigley-ai-marketplace/scripts/pointer_parser/section_refs.py` and `wigley-ai-marketplace/scripts/pointer_parser/markdown.py`
- create `wigley-ai-marketplace/scripts/tests/test_section_refs.py`
- modify `wigley-ai-marketplace/scripts/check_pointers.py`
- modify `wigley-ai-marketplace/AGENTS.md`

Consumes:
- `agentPluginDir(appDir, paths)` and `AGENT_PLUGIN_FOLDER` from `wigley-ai-gui/src/shared/agent-plugin.ts` ← 01
- `DocsContribution`, `BacklogContribution` from `wigley-ai-gui/src/contracts/contributions.ts` ← 03
- `contributionsMainKey`, `ContributionsMainExports.registerFeature`, `.strategies`, `.onChanged`, `.ready`, `FeatureReader`, `Strategy` from `wigley-ai-gui/src/plugins/contributions/contract.ts` ← 03
- `MainServices.appDir: string`, for `agentPluginDir` ← 01

Produces:
- `export type FeaturesHomes = { homes: string[]; file: string; areaFolder: string | null }` in `wigley-ai-gui/src/plugins/docs/contract.ts`
- `DocsMainExports.setFeaturesHomes(homes: FeaturesHomes | null): void` in `wigley-ai-gui/src/plugins/docs/contract.ts`
- `export interface DocsBinding { globalFolders: DocsGlobalFolder[]; wikiMain: string | null; linkPrefixes: Record<string, string>; features: FeaturesHomes | null }` and `export type DocsGlobalFolder = { path: string; referenceFiles: string[]; subfolders: string[]; skip: string[] }` in `contract.ts`
- `export const docsBindingSlot: SlotKey<DocsBinding, 'main', 'docs'>` (id `docs.binding`, kind `value`) in `contract.ts`
- `export function templateProblem(template: string): string | null`, and `export function inRepoHomeParts(homes: readonly string[]): string[][]` in `wigley-ai-gui/src/plugins/backlog/main/features-homes.ts`
- `export const docsReader: FeatureReader<DocsContribution>` and `export function mergeDocs(strategies: readonly Strategy<DocsContribution>[], log: PluginLog): Omit<DocsBinding, 'features'>` in `wigley-ai-gui/src/plugins/docs/main/docs-reader.ts`
- `export const CONTRIBUTIONS_JSON = 'contributions.json'` and `export function contributionsFileText(binding: DocsBinding): string` in `wigley-ai-gui/src/plugins/docs/main/contributions-file.ts`
- the docs index's `--contributions <file>` option, before the command: `docs_index.py --contributions <file> build|context <dir>|session <id>`
- `load_contributions(path: Path | None, home: Path) -> Contributions` in `wigley-ai-gui/agent-plugin/scripts/docs-index/contributions.py`

## Why

Docs runs `docs_index.py` from the wigley plugin's install (`script-locator.ts:21`, through `locateWigleyFile`). It hard-codes `~/wigley-agents` as a global folder (`kinds.ts:65`, `doc-files.ts:487`, `discover.py:459-467`), the wiki page `~/wigley-agents/wiki/Main.md` (`doc-files.ts:354`), the `wigley:` link form (`wiki-main.ts:24`, `tree.ts:765`, `doc_fields.py:25-26`, `section_refs.py:27`), the features homes (`discover.py:76`, `config.py:23`) and `followups.md` (`kinds.ts:104`, `discover.py:910-912`, `tree.ts:656`). After this task the index ships in the app's own agent plugin, every one of these comes from contributions, and with no contribution Docs indexes only what every harness has.

## Decisions

### The file the app hands the index

- Docs writes `contributions.json` in its plugin data folder (`api.data`), and passes `paths.join(api.dataFolder, CONTRIBUTIONS_JSON)` as `--contributions` on every script run. It writes the file before the first run and again each time the binding changes, then rebuilds the machine index. A run never starts while a write is in flight: the write and the runs share one serial queue.
- The file's text is `contributionsFileText(binding)`: JSON, two-space indent, a trailing newline, with these keys and nothing else:

  ```json
  {
    "version": 1,
    "globalFolders": [{ "path": "~/wigley-agents", "referenceFiles": ["decisions.md"],
                        "subfolders": ["learning", "wiki"], "skip": ["archive", "learning/archive"] }],
    "linkPrefixes": { "wigley:": "wigley@wigley-ai-marketplace" },
    "features": { "homes": ["{repo}/docs/features", "~/wigley-features/{name}"], "file": "followups.md",
                  "areaFolder": "followups" }
  }
  ```

  `features` is `null` when Backlog hands docs no homes. Paths keep `~` as the contribution wrote them; the script expands them with `expand_home`, so a test's temp home stands in.
- `wikiMain` is not in the file: only the app reads it.

### The binding

- `start.ts` registers `docsReader` under `'docs'`. After `contributions.ready`, and on each `contributions.onChanged('docs', …)`, it computes `mergeDocs(contributions.strategies('docs'), log)`. Backlog's latest `setFeaturesHomes` call gives `features`. Before the first call it is `null`. Docs publishes the result to `docsBindingSlot`.
- `mergeDocs` rules, in source order:
  - `globalFolders`: the union, deduped by the path as written. A later duplicate is dropped and logged: `docs: global folder <path> from <plugin> dropped: <first plugin> lists it`.
  - `wikiMain`: the first strategy that names one.
  - `linkPrefixes`: the first strategy to map a prefix keeps it. A clash is logged: `docs: link prefix <prefix> from <plugin> dropped: <first plugin> maps it`.
- `setFeaturesHomes(homes)` replaces `features`. A call whose value equals the current one (compared as JSON) writes nothing and runs nothing.
- Run modes other than `live`: the docs fixture's stand-in `docs_index.py` prints a fixed index, so the contributions file does not change what it lists. In those modes the binding is `DOCS_FIXTURE_BINDING`, exported from `selftest-fixture.ts`: the fixture home's `wigley-agents` folder as the one global folder (`referenceFiles: ['decisions.md']`, `subfolders: ['learning', 'wiki']`, `skip: []`), `wikiMain` at `WIKI_MAIN_FILE` under the fixture home, `linkPrefixes: { 'wigley:': 'wigley@vendor-market' }` and features `{ homes: ['{repo}/docs/features', '~/wigley-features/{name}'], file: 'followups.md', areaFolder: 'followups' }`. Fixture text is exempt from the boundary rule. Outside `live`, `setFeaturesHomes` changes nothing: the binding keeps the fixture's `features`, and no file is written. Task 08's `BACKLOG_FIXTURE_STRATEGY` copies this `features` value, so Backlog's fixture pick and the docs fixture agree.

### The reader

`docsReader.label` is `'Docs'`. It refuses, with each reason:
- not a JSON object: `"docs" is not an object`
- `globalFolders` present and not an array of objects whose `path` is a string that starts with `~/` or `/`: `globalFolders[<i>].path: not a ~ or absolute path`
- `referenceFiles`, `subfolders` or `skip` present and not an array of non-empty relative paths with no `..` part: `globalFolders[<i>].<field>: not a list of relative paths`
- `wikiMain` present and not a `~` or absolute path that ends in `.md`: `wikiMain: not a ~ or absolute .md path`
- `linkPrefixes` present and not an object whose keys end in `:` and whose values are non-empty strings that hold `@`: `linkPrefixes: not { "<prefix>:": "<plugin key>" }`

Its value fills each optional array with `[]` and each optional field with its empty value. No reader reads a file.

### Features homes, shared with Backlog (task 08)

- `templateProblem(template)` is null for an in-repo template (`{repo}/<relative path>`, no `..` part, no other `{…}`) and for an out-of-repo template (`<~ or absolute folder>/{name}`, no other `{…}`). Else it returns `"<template>" is neither {repo}/<folder> nor <folder>/{name}`.
- `inRepoHomeParts(homes)` gives the part list of each in-repo template, in order (`{repo}/docs/features` gives `['docs', 'features']`). It skips a template that `templateProblem` refuses.

### The docs index (Python)

- **Move.** `git mv` the whole folder, then edit. The index file and its config keep their paths under `~/.agents/wigley-docs/` (plan.md § Boundary rules).
- **`contributions.py`.** `Contributions` holds `global_folders: list[GlobalFolder]` (`path: Path`, expanded; `reference_files`, `subfolders` and `skip` as tuples of strings), `link_prefixes: dict[str, str]` and `features: FeaturesHomes | None` (`in_repo_parts: tuple[tuple[str, ...], ...]`, `out_of_repo_folders: tuple[Path, ...]`, `file: str`, `area_folder: str | None`). `load_contributions(None, home)` returns the empty `Contributions`. A missing, unreadable or malformed file returns the empty one after one stderr line: `docs index: ignoring contributions file <path>: <reason>`. A field of the wrong shape is dropped with one stderr line naming it. It reads the two template shapes by the same rules as `templateProblem`.
- **`docs_index.py`.** The parser gets a top-level `--contributions <file>` option, read before the command. `main` loads it once and hands it to `discover` and `discover_folder`, and to `with_doc_fields`.
- **`config.py`.** `featuresHome` leaves `DEFAULT_CONFIG` and `Config`. A config file that still holds the key loads without a message. The user's own `~/.agents/wigley-docs/config.json` is not edited: the key is harmless there.
- **`discover.py` global walk.** `_walk_global` keeps the harness folders (each Claude config folder, `~/.codex`, `~/.agents/skills`). In place of the `wigley-agents` block, for each global folder in order: every top-level `*.md` is `instructions`, except a name in `reference_files`, which is `reference`. Each of `subfolders` is walked in full with `_markdown_below`. A subfolder whose last part is `learning` takes kind `learning`; every other subfolder takes `reference`. This keeps today's kinds for `learning` and `wiki` (see § Open questions). `skipped_folders` is the real path of `<path>/<skip>` for each global folder's `skip`, in place of `SKIPPED_WIGLEY_AGENTS_FOLDERS`.
- **`discover.py` features homes.** `IN_REPO_FEATURES_HOME` gives way to `features.in_repo_parts`. `_features_home_parts` checks each part list in order, at the root and at a project folder directly under the root that holds `AGENTS.md`, as it does today for `docs/features`. `discover` walks each child folder of each `out_of_repo_folders` entry with `_walk_feature_home`. `discover_folder` walks `<folder>/<repo name>` for each. `_feature_file_kind` reads `features.file` in place of `followups.md`, and `(features.area_folder,)` in place of `("followups",)`. With `features` None there is no features home: no in-repo home is registered, and no folder is walked as one. The repo-level `docs/followups/<topic>.md` rule in `_repo_file_kind` stays as it is (see § Open questions).
- **The docstring** at the top of `discover.py` names the global folders and the features homes as the contributions file gives them. It does not name `~/wigley-agents`.
- **Link prefixes.** `doc_fields.py` drops `SKILL_SCHEME` and `WIGLEY_PLUGIN_PREFIX`. A link `<prefix><name>` resolves to the skill titled `<name>` whose entry's `plugin` equals `link_prefixes[prefix]`, exactly. Today's rule is `startswith("wigley@")` (`doc_fields.py:116`).
  - **Skill map.** `_Listing.skills` becomes `dict[str, dict[str, str]]`: plugin key, then skill name, then the real path of its `SKILL.md`. `_wigley_skills(entries)` becomes `_plugin_skills(entries, plugin_keys)`, built for each value of `link_prefixes`, with today's rule per key: the first by path in a clone, else the first by path in an install.
  - **Pointers.** `section_refs.py` replaces the `SECTION_POINTER` constant with `section_pointer(prefixes: Iterable[str]) -> re.Pattern[str]`. Python's `re` refuses a group name used twice, so the skill branch is one alternation: `(?P<prefix><p1>|<p2>|…)(?P<skill>[a-z0-9][a-z0-9-]*)`, each prefix `re.escape`d, longest first. With no prefixes the branch is `(?P<prefix>(?!))(?P<skill>…)`, which never matches, so the groups `prefix`, `skill` and `file` exist in every pattern. Every other part of today's pattern stays. `_pointer_target` (`doc_fields.py:198`) looks up `listing.skills.get(link_prefixes[match["prefix"]], {}).get(match["skill"])`.
  - **Markdown links.** The link check at `doc_fields.py:245` takes the longest `link_prefixes` key the href starts with, and looks the rest (before `#`) up under that key's plugin, the same way.
  - Line numbers measured at plan time, re-verify.
- **README.** `agent-plugin/scripts/docs-index/README.md` documents `--contributions` and the file's schema above, drops `featuresHome`, and drops every `~/wigley-agents` rule in favour of the global folders. Its schema version of the index document does not change: no index field changes.

### The marketplace's pointer check

`scripts/check_pointers.py` imports `read_exact_text` from `markdown.py`, and `EMPHASIS`, `SECTION_POINTER`, `Heading`, `ProseText`, `prose_lines`, `read_headings` and `resolve` from `section_refs.py`, both from the docs index's folder (`check_pointers.py:37-41`). After task 17 the app leaves the `ai` repo, so the check cannot import from it. Decided: before the move edits them, copy `section_refs.py` and `markdown.py`, as the marketplace holds them now, to `wigley-ai-marketplace/scripts/pointer_parser/`. Point `DOCS_INDEX` in `check_pointers.py` at that folder, and rename it `POINTER_PARSER`. Copy `tests/test_section_refs.py` to `wigley-ai-marketplace/scripts/tests/test_section_refs.py`, which loads the module from `scripts/pointer_parser/` by path, as `test_check_pointers.py` loads its script. Each copied module's docstring opens with one line: `A copy of the wigley-ai-gui docs index's parser, kept for check_pointers.py; the two copies change separately.` The copy keeps the `wigley:` constant, which this repo's check needs. Update `wigley-ai-marketplace/AGENTS.md` (line numbers measured at plan time, re-verify):
- line 19, the layout tree's `scripts/` row: drop "the docs index the app's docs browser reads", since the index leaves the plugin.
- line 22, the `check_pointers.py` row: it imports its parser from `scripts/pointer_parser/section_refs.py`.
- line 24, the `scripts/tests/` row: it also holds the tests for `scripts/pointer_parser/`.
- line 105, the docs-index test command: it goes.
- Then grep the file for `docs-index` and `docs index`; no line still says the plugin ships it.

### The TypeScript plugin

- **Script.** `locateScript(files, homeDir, scriptPath, pluginDir, paths)` returns `scriptPath` expanded when it is set. Otherwise it returns `<pluginDir>/scripts/docs-index/docs_index.py` when that is a file, else null, where `pluginDir` is `agentPluginDir(appDir, paths)`. It no longer imports `wigley-install.ts`. `NO_SCRIPT_MESSAGE` becomes `docs_index.py not found in the app's agent plugin — set docs.scriptPath`. `IndexSourcesDeps` drops `folders` and gains `pluginDir: string` and `contributionsFile(): Promise<string>`, which settles the queued write and gives the file's path. `runScript` runs `[...python.args, '-X', 'utf8', script, '--contributions', <file>, command, ...args]`.
- **Manifest.** `dependsOn.main` becomes `['sessions', 'contributions']`. The `scriptPath` description becomes `The path to docs_index.py; empty runs the copy in the app's agent plugin. ~ is the home folder.` The comment above the manifest drops the wigley plugin.
- **Global folders.** `WIGLEY_AGENTS_FOLDER` goes. `placesFor(kind, entries, homeDir, paths, projectConfigFolders, binding)` takes `binding: Pick<DocsBinding, 'globalFolders' | 'features'>`. A global instructions entry gives a place only when its folder is one of the global folders' paths (`~` expanded, compared with `paths.samePath`). A global reference entry at a global folder's top level gives no place. `guardFolders` puts each global folder's expanded path in place of `~/wigley-agents`. `createDocFiles` gets `binding(): DocsBinding` in its deps.
- **Follow-ups.** The `followup` kind rule reads `binding.features.file` in place of `'followups.md'`. With `features` null, no follow-up place is offered. `CreatePlace` gains `repo: string | null`, filled from the entry's `repo`. `followupsRepoName` goes: a new follow-ups file is named after `place.repo`, and after the folder's base name when `repo` is null. `featureSlug` in `tree.ts` takes `areaFolder: string | null` in place of the `'followups'` literal, passed down from `buildTree`'s callers from the binding.
- **Wiki page.** `wikiMainPath()` resolves to `string | null`: the real path of `binding.wikiMain` expanded, else null. `wiki-main-source.ts` already draws a null path (`wiki-main-source.ts:135`); the Main page then shows its missing-page state.
- **Link prefixes.** `parseWikiTarget(text, linkPrefixes)` and `parseWikiMain(text, linkPrefixes)` take the prefixes. A skill target is `{ type: 'skill'; prefix: string; name: string }`, for text `<prefix><name>` where `<name>` holds no `/`. `findSkillEntry(name, pluginKey, entries)` matches `entry.plugin === pluginKey`. `pageEntry` and `docs-view.ts:1235` pass `binding.linkPrefixes[target.prefix]`. The page reads `docsBindingSlot` for the binding. Comments that say "a `wigley:` link" say "a skill link".
- **Fixture.** `selftest-fixture.ts` drops its `WIGLEY_PLUGIN_KEY` import and uses a local `const FIXTURE_WIGLEY_KEY = 'wigley@wigley-ai-marketplace'`.
- **`src/shared/wigley-install.ts`** stays: this task removes the docs caller, task 10 the live-view caller, and task 15 deletes the file.
- **AGENTS.md.** The docs-index sentence (lines 35–36) names `agent-plugin/scripts/docs-index/` in place of `plugins/wigley/scripts/docs-index/ in wigley-ai-marketplace`, and its README as the one that states the index schema.

## Behaviour

- GIVEN no installed plugin contributes `docs` and Backlog hands no homes WHEN the machine index builds THEN the index lists the harness folders' docs and no `features` entry, and the Main page shows its missing-page state.
- GIVEN the user's `docs` strategy and Backlog's homes WHEN the index builds THEN it lists exactly what it lists today (compare entry ids before and after, Verification).
- GIVEN two strategies that both map `wigley:` WHEN docs merges THEN the first in source order keeps it and the log holds one clash line.
- GIVEN Backlog calls `setFeaturesHomes` twice with the same value WHEN the second call lands THEN no file is written and no index runs.

## Tests

Python, in `agent-plugin/scripts/docs-index/tests/`:
- `test_contributions.py` (new): `test_none_path_gives_empty`, `test_missing_file_gives_empty_with_one_stderr_line`, `test_templates_split_into_in_repo_parts_and_out_of_repo_folders`, `test_bad_template_dropped_with_stderr_line`, `test_tilde_paths_expand_against_env_home`.
- `test_discover.py`: today's tests that build `~/wigley-agents`, `docs/features` or `~/wigley-features` trees pass a `Contributions` equal to the user's (the file shape above), and keep their expectations. Add `test_no_contributions_lists_no_features_home`, `test_reference_files_index_as_reference`, `test_learning_subfolder_takes_learning_kind`, `test_skip_folder_is_not_walked`, `test_custom_in_repo_template_is_a_home` (`{repo}/notes/todo`), `test_custom_file_and_area_folder` (`todo.md`, `areas/`). Each catches a leftover literal.
- `test_config.py`: the `featuresHome` cases go. Add `test_features_home_key_is_ignored`.
- `test_doc_fields.py`: the `wigley:` link cases pass `link_prefixes={'wigley:': 'wigley@wigley-ai-marketplace'}`. Add `test_prefix_matches_the_exact_plugin_key`: a skill under `wigley@other` does not resolve. Add `test_two_prefixes_resolve_to_their_own_plugins`: `{'a:': 'a@m', 'b:': 'b@m'}`, a skill `x` under each, and `a:x` and `b:x` (as a § pointer and as a markdown link) resolve to their own plugin's path.
- `test_section_refs.py`: `section_pointer(['wigley:'])` matches today's pointer cases. Add `section_pointer([])` matching a file pointer and no skill pointer, with `match['skill']` None. Add `section_pointer(['a:', 'b:'])` compiling and giving `prefix` `b:` for `b:x § Part`.
- `test_docs_index.py`: add `test_contributions_option_reaches_discover`.

TypeScript:
- `features-homes.test.ts` (new): one table over `templateProblem` and `inRepoHomeParts`, with the template rows task 08 lists.
- `docs-reader.test.ts` (new): one row per reason; the user's section reads ok. `mergeDocs` rows: the union and dedupe of global folders, the first `wikiMain`, and a prefix clash kept first with its log line.
- `contributions-file.test.ts` (new): `contributionsFileText` of the user's binding equals the pinned JSON above, and of a binding with `features: null` holds `"features": null`.
- `script-locator.test.ts`: the wigley-install rows give way to `pluginDir` rows: a set `scriptPath` wins; an empty one gives the agent plugin's copy; a missing copy gives null.
- `index-sources.test.ts`: the run's args hold `--contributions <file>` before the command, and no run starts before the file write settles.
- `start.test.ts`: `setFeaturesHomes_SameValueTwice_RunsOnce`; `docsStrategyChanged_RewritesTheFileAndRebuilds`; `setFeaturesHomes_SelfTestMode_KeepsTheFixtureFeatures`.
- `kinds.test.ts`: the `wigley-agents` rows take a binding with that folder. Add `placesFor_GlobalFolderNotNamedWigleyAgents_IsAPlace` and `placesFor_NoFeatures_NoFollowupPlace`. The new-follow-ups-file row names the file after `place.repo`.
- `doc-files.test.ts`: the `wikiMainPath` and guard rows read the binding. Add `wikiMainPath_NoWikiMain_Null`.
- `tree.test.ts` and `wiki-main.test.ts`: skill rows pass prefixes and the key. Add `findSkillEntry_OtherKeySameName_NotFound` and `featureSlug_CustomAreaFolder_NoSlug`.

## Verification

```
cd /Users/jonathonwigley/Documents/ai/wigley-ai-gui/agent-plugin/scripts/docs-index && python3 -m unittest discover
cd /Users/jonathonwigley/Documents/ai/wigley-ai-gui && npm test -- src/plugins/docs src/plugins/backlog && npm run typecheck && npm run lint
cd /Users/jonathonwigley/Documents/ai/wigley-ai-marketplace && python3 scripts/check_pointers.py && python3 -m unittest discover scripts/tests
grep -rn "wigley-agents\|wigley-features\|wigley@\|'wigley:'\|wigley-install\|WIGLEY_AGENTS_FOLDER" /Users/jonathonwigley/Documents/ai/wigley-ai-gui/src/plugins/docs /Users/jonathonwigley/Documents/ai/wigley-ai-gui/agent-plugin/scripts/docs-index --include='*.ts' --include='*.py' | grep -v '\.test\.ts:\|/tests/\|selftest-fixture\|selftest-script'
test ! -e /Users/jonathonwigley/Documents/ai/wigley-ai-marketplace/plugins/wigley/scripts/docs-index
```

The grep prints nothing. Same-output check, run before and after the change with the user's contributions file. Write the file by hand from the pinned JSON before task 13 lands:

```
python3 <old>/docs_index.py build --stdout | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["entries"]))'
python3 <new>/docs_index.py --contributions <file> build --stdout | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["entries"]))'
```

The two counts are equal, and a sorted diff of the entry ids is empty. `build` writes `~/.agents/wigley-docs/index.json`. The app writes the same file on every run, so this is the app's own data, not user state.

## Done when

- Every check above passes, the grep prints nothing, and the marketplace's docs-index folder is gone.
- Runtime check: deferred to the final verification task (Docs mode's Main page, the tree's global group and a `wigley:` wiki link, with the wigley plugin's `auri.json` installed).

Commit: one commit for the group, covering both repos' paths.

## Open questions

- **Subfolder kinds.** design.md's `globalFolders[].subfolders` is a list of names with no kind. This task gives `learning` its kind by name and every other subfolder `reference`, which keeps today's index. A `{ path, kind }` entry would say it outright: that is a contract change for the lead.
- **`docs/followups/<topic>.md`.** The index reads a repo's own `docs/followups/` folder as follow-up items (`discover.py:871`). No contribution names it, and Backlog leaves it out (`homes.test.ts` `groupHomes_RepoDocsFollowups_Excluded`). This task keeps it. It is not a boundary name, but it is a wigley convention.

## Proof

Commit 05e68a119 6883c8d0b · proof: diff read: Produces present per report and spot reads; wave 3 typecheck and lint pass; tests wait for the test gate · concerns: AGENTS.md line 116 still says docs reads wigley-install.ts; marketplace followups.md holds docs-index follow-ups now owned by the app
