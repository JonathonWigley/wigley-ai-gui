# 08 — Backlog reads its homes, file and assistant text from the picked backlog strategy

Status: done
Type: Task
Rung: hard · it adds a reader and a pick, and hands the pick to the docs index through 09's new export
Wave: 4 · Depends on: 03, 09
Plan: [plan.md](plan.md)

Files:
- modify `wigley-ai-gui/src/plugins/backlog/manifest.ts`
- modify `wigley-ai-gui/src/plugins/backlog/main/start.ts`
- modify `wigley-ai-gui/src/plugins/backlog/main/assistant.ts`
- modify `wigley-ai-gui/src/plugins/backlog/main/repo-folder.ts`
- modify `wigley-ai-gui/src/plugins/backlog/main/selftest-fixture.ts` (adds `BACKLOG_FIXTURE_STRATEGY`)
- modify `wigley-ai-gui/src/shared/followups/followup-file.ts` (its header comment only)
- create `wigley-ai-gui/src/plugins/backlog/main/backlog-reader.ts`
- test `wigley-ai-gui/src/plugins/backlog/main/backlog-reader.test.ts` (create)
- test `wigley-ai-gui/src/plugins/backlog/main/repo-folder.test.ts`
- test `wigley-ai-gui/src/plugins/backlog/main/assistant.test.ts`
- test `wigley-ai-gui/src/plugins/backlog/main/start.test.ts`

Consumes:
- `BacklogContribution` from `wigley-ai-gui/src/contracts/contributions.ts` ← 03
- `contributionsMainKey`, `ContributionsMainExports.registerFeature`, `.strategies`, `.onChanged`, `.ready`, `FeatureReader`, `pickStrategy`, `StrategyPick`, `strategyControlKind` from `wigley-ai-gui/src/plugins/contributions/contract.ts` ← 03
- `pickProblemText(featureLabel, pick)` ← 03
- `DOCS_FIXTURE_BINDING` from `wigley-ai-gui/src/plugins/docs/main/selftest-fixture.ts` ← 09 (its `features` value, for the fixture strategy)
- `DocsMainExports.setFeaturesHomes(homes: FeaturesHomes | null): void` and `type FeaturesHomes` in `wigley-ai-gui/src/plugins/docs/contract.ts` ← 09
- `templateProblem(template: string): string | null` and `inRepoHomeParts(homes: readonly string[]): string[][]` in `wigley-ai-gui/src/plugins/backlog/main/features-homes.ts` ← 09
- the skill `auri:backlog-format` (`wigley-ai-gui/agent-plugin/skills/backlog-format/SKILL.md`), which documents the follow-up file format ← drafter B5's task (the app-feature skills)

Produces:
- `export const backlogReader: FeatureReader<BacklogContribution>` in `wigley-ai-gui/src/plugins/backlog/main/backlog-reader.ts`
- `export function assistantInstructions(extra: string | null): string` in `wigley-ai-gui/src/plugins/backlog/main/assistant.ts`, in place of `ASSISTANT_INSTRUCTIONS`
- `export const BACKLOG_FIXTURE_STRATEGY: BacklogContribution` in `wigley-ai-gui/src/plugins/backlog/main/selftest-fixture.ts`

## Why

Backlog finds its homes through the docs index, which hard-codes the in-repo `docs/features` home and the `~/wigley-features` folder. Backlog itself hard-codes `followups.md` (`start.ts:102`) and `docs/features` (`start.ts:105`, `repo-folder.ts`). Its assistant's instructions point at `wigley-ai-marketplace's skills/review/triage.md` (`assistant.ts:21`). After this task, the picked `backlog` strategy names the homes, the file and the area folder, and the assistant points at the `auri:backlog-format` skill. With no pick, Backlog lists no home and shows its empty state.

## Decisions

- **Settings.** `settings` gains `strategy: ''`, and `settingControls` becomes `{ layout: 'layout', strategy: strategyControlKind('backlog') }`, which is `'strategy:backlog'`. The `strategy` setting info: label `Backlog plugin`, description `The plugin whose follow-up homes Backlog lists. Automatic picks the only one installed.` `dependsOn.main` becomes `['docs', 'chat', 'sessions', 'scoped-agents', 'contributions']`.
- **Reader.** `backlogReader.label` is `'Backlog'`. `read(section)` returns the section's `label` (when present), `homes`, `file`, `areaFolder` (when present) and `assistant` (when present), and no other keys. It refuses, with each reason it finds:
  - not a JSON object: `"backlog" is not an object`
  - `homes` not an array of one or more strings: `homes: not a list of folder templates`
  - a template that is neither shape below: `homes[<i>]: "<template>" is neither {repo}/<folder> nor <folder>/{name}`
  - `file` not a non-empty string that ends in `.md` and holds no `/` or `\`: `file: not a .md file name`
  - `areaFolder` present and not a non-empty string with no `/` or `\`: `areaFolder: not a folder name`
  - `assistant` present and not `{ "instructions": <non-empty string> }`: `assistant: not { "instructions": text }`
  - `label` present and not a string: `label: not a string`
- **Template shapes.** An **in-repo template** starts with `{repo}/`. The rest is a relative path with no `..` part, no `{repo}` and no `{name}`. It names a folder below a clone's root (`{repo}/docs/features`). An **out-of-repo template** ends with `/{name}` and holds no other `{…}`. The part before `/{name}` starts with `~/` or `/`, and names the folder that holds one home per repo (`~/wigley-features/{name}`). Task 09's `templateProblem` owns these two shapes: the reader calls it for each template and puts `homes[<i>]: ` before the text it returns. The docs index's Python reader (task 09) reads the same shapes.
- **Hand-off to the docs index.** Backlog owns the pick. `start.ts` registers `backlogReader` under `'backlog'` and computes `pickStrategy(contributions.strategies('backlog'), api.settings().strategy)` after `contributions.ready`, on every `contributions.onChanged('backlog', …)` and on every `api.onSettingsChanged(…)`. When the pick changes, it calls `docs.setFeaturesHomes(...)`:
  - on `picked`: `{ homes, file, areaFolder: areaFolder ?? null }` from the strategy's value
  - on any other pick: `null`
  The docs plugin writes these into its contributions file and rebuilds the index (task 09). Backlog's load then reads the new homes as it does today, through `docs.machineIndex()`.
- **Redraw on every pick change.** Some pick changes leave the `setFeaturesHomes` value as it was (`none` to `choose`, `picked` to `missing`), so docs writes and runs nothing and no machine-index event comes. On every pick change, whether or not the docs value changed, `start.ts` also sends the channel's `changed` with `{ homeRoot: null }`, as the `reload` hook does today (`start.ts:1064`, measured at plan time, re-verify), so `readHomes` re-runs with the new pick's message.
- **First load.** The channel's load awaits `contributions.ready` before it reads the pick, so the first load never shows `none` for a strategy the registry has not listed yet.
- **Run modes other than `live`** (`selfTest` and `drive`, demo steps included): no contributions plugin is installed there, yet the self-test and the notes self-test file into the fixture repo's homes. In those modes the pick is always `picked`, its value `BACKLOG_FIXTURE_STRATEGY`, exported from `selftest-fixture.ts`, whatever the registry and the `strategy` setting hold. Its value is `{ label: 'Fixture', homes, file, areaFolder }` copied from `DOCS_FIXTURE_BINDING.features` (09), so both plugins read one value: `{ homes: ['{repo}/docs/features', '~/wigley-features/{name}'], file: 'followups.md', areaFolder: 'followups' }`. Backlog still calls `setFeaturesHomes` with it; 09 keeps the fixture binding's `features` in those modes, so the call changes nothing there. Fixture text is exempt from the boundary rule.
- **Empty state.** While the pick is not `picked`, `readHomes` returns `{ homes: [], message: pickProblemText('Backlog', pick) }` and reads no index entry. The table status draws `message`, as it draws a load message today (`backlog-view.ts:469`). While the pick is `picked` and the index lists no home, the status stays `No features homes found`.
- **File name.** `CREATE_TARGET_FILE` goes. The create target's file is the picked strategy's `file`. `followupPathsOf`, and the two create paths at `start.ts:554` and `start.ts:579` (line numbers measured at plan time, re-verify), take it from the pick.
- **In-repo homes.** `FEATURES_FOLDER` goes. `clonesFeaturesFolders(paths, topLevel, root, homeParts)` gives, for each part list of `inRepoHomeParts(strategy.homes)`, the clone's own `<topLevel>/<parts>` and the project folder's `<topLevel>/<project>/<parts>`, as it does today for `docs/features`. The project folder is `paths.parent` applied `parts.length` times to `root` (today's `paths.parent(paths.parent(root))` is the two-part case, `start.ts:165`), and is skipped for a part list `root` does not end with. `repoFolderOf(home, isInClone, settings, paths, homeDir, homeParts)` reads a home as in-repo when its root ends with one of the part lists, compared part by part from the end, and then returns `paths.parent` applied that list's `parts.length` times to the root. The first matching list in order wins. The project folder rule (a folder directly under the root that holds `AGENTS.md`) stays as it is today: it is the index's rule too (task 09).
- **Create target.** `markCreateTargets` keeps its rule: the first home in git by root order, else the first home. design.md § Section: backlog says "The first that exists is the home". This task keeps today's rule, in which every existing home lists. See § Open questions.
- **Assistant.** `assistantInstructions(extra)` returns today's text with its third paragraph's first sentence changed to: `Edit a follow-up file directly, in the shape it already has: the auri:backlog-format skill gives the format.` The first sentence stays `You are the Backlog assistant in wigley-ai-gui.` until task 17's rename pass, as the app name is not a boundary name. When `extra` is a string, the result is the text, a blank line, then `extra`. `start.ts:961` passes `instructions: () => Promise.resolve(assistantInstructions(<picked strategy's assistant?.instructions ?? null>))`, read at each call. With no pick, the assistant gets `assistantInstructions(null)`.
- **Follow-up parser comment.** `followup-file.ts:4` names `wigley-ai-marketplace`. The comment then names the `auri:backlog-format` skill as the format's one description. The parser code does not change: the format stays as it is, and drafter B5's skill documents it.
- **Notes.** The notes plugin reads Backlog's homes through Backlog's exports and does not change.

## Behaviour

- GIVEN one installed backlog strategy `{ homes: ['{repo}/docs/features', '~/wigley-features/{name}'], file: 'followups.md', areaFolder: 'followups' }` WHEN Backlog loads THEN the docs plugin receives `setFeaturesHomes({ homes: ['{repo}/docs/features', '~/wigley-features/{name}'], file: 'followups.md', areaFolder: 'followups' })`, and the homes list as today.
- GIVEN no installed backlog strategy WHEN Backlog loads THEN the docs plugin receives `setFeaturesHomes(null)`, Backlog lists no home, and the status reads `No installed plugin binds Backlog.`
- GIVEN a strategy with `file: 'todo.md'` WHEN a note files a new follow-up into a home with no follow-up file THEN the write goes to `<home>/todo.md`.
- GIVEN a strategy with `assistant.instructions: 'Tag each item.'` WHEN the assistant starts THEN its instructions end with a blank line and `Tag each item.`

## Tests

- `backlog-reader.test.ts` (new) — one table over `backlogReader.read`: the user's section reads ok and its value equals the section. Then one row per reason, each asserting the exact text. Template rows: `{repo}/docs/features` and `~/wigley-features/{name}` are accepted. `docs/features`, `{repo}/../x`, `{repo}/{name}`, `wigley-features/{name}` and `~/x/{name}/y` are each refused.
- `repo-folder.test.ts` — the existing rows pass `[['docs', 'features']]`. Add `repoFolderOf_CustomInRepoParts_ReadsTheCloneFolder`: parts `[['notes', 'todo']]` and root `/r/notes/todo` in a clone give `/r`. Add `repoFolderOf_DocsFeaturesWithOtherParts_IsNotInRepo`: parts `[['notes', 'todo']]` and root `/r/docs/features` give the settings fallback. Each catches a leftover `docs/features` literal. Add `repoFolderOf_OneAndThreePartLists_ClimbThatManyLevels`: parts `[['features']]` and root `/r/features` give `/r`; parts `[['a', 'b', 'c']]` and root `/r/a/b/c` give `/r`. Catches a fixed two-level climb. `start.test.ts` gets the matching `clonesFeaturesFolders` rows through a load with a one-part template.
- `assistant.test.ts` — `assistantInstructions_NoExtra_NamesTheFormatSkill`: the text holds `auri:backlog-format` and not `triage.md`. `assistantInstructions_Extra_AppendedAfterABlankLine`.
- `start.test.ts` — the harness's docs fake records `setFeaturesHomes` calls, and a contributions fake holds the backlog strategies. Today's tests run with the user's strategy, and their expectations stay. Add:
  - `load_NoStrategy_EmptyStateMessageAndNoHomes` — also asserts `setFeaturesHomes(null)`.
  - `load_TwoStrategiesAutomatic_ChooseMessage` — status `Several plugins bind Backlog: pick one in Settings.`
  - `pickChanged_SendsTheNewHomesToDocs` — fire `onChanged('backlog')` with a second strategy picked by setting, and assert the recorded call.
  - `fileNote_StrategyFile_CreatesThatFile` — `file: 'todo.md'`.
  - `pickChanged_NoneToChoose_StatusRedraws` — start with no strategy, install two and fire `onChanged('backlog')`: the docs fake records no second call (the value stays `null`), yet a `changed` is sent and the next load's status reads `Several plugins bind Backlog: pick one in Settings.` Catches a redraw tied to the docs value.
  - `load_BeforeReady_WaitsForTheRegistry` — `ready` settles after the first load starts: the load shows the strategy's homes, never the `none` message.
  - `selfTestMode_FixtureStrategyPicked` — `runMode: 'selfTest'` with an empty registry: the pick is `BACKLOG_FIXTURE_STRATEGY` and the fixture home lists.

## Verification

```
cd /Users/jonathonwigley/Documents/ai/wigley-ai-gui
npm test -- src/plugins/backlog src/plugins/notes src/shared/followups
npm run typecheck
npm run lint
grep -rn "wigley-ai-marketplace\|triage.md\|'followups.md'\|'docs/features'" src/plugins/backlog src/shared/followups --include='*.ts' | grep -v '\.test\.ts'
```

The grep prints nothing.

## Done when

- The checks above pass, and the grep prints nothing.
- Runtime check: deferred to the final verification task (Backlog lists the user's homes once task 13's `auri.json` is installed, and shows the empty state with the wigley plugin's `backlog` section removed).

Commit: one commit for the group.

## Open questions

- design.md § Section: backlog says of `homes`: "The first that exists is the home." Today a repo with both an in-repo home and a `~/wigley-features/<repo>` folder lists both, and `markCreateTargets` picks the create target. This task keeps today's behaviour, so the user's Backlog runs as today. If the user wants one home per repo, `groupHomes` must drop the homes after a repo's first existing template, and the docs index must do the same (task 09).

## Proof

Commit e01c387f6 · proof: diff read: backlogReader, strategy setting, contributions dependency, setFeaturesHomes call, assistantInstructions present; wave 4 typecheck + lint pass · concerns: fixtureStrategy throws if DOCS_FIXTURE_BINDING.features is null; pickProblemText ?? '' only for the type
