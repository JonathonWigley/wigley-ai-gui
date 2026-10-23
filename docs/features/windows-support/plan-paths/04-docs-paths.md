# 04 — Docs plugin on Paths

Status: done
Type: Batch
Wave: 3 · Depends on: 02
Plan: [plan.md](plan.md)

The whole docs plugin (`src/plugins/docs/`) stops using `doc-paths.ts` and calls `Paths`. The batch has five items:
the shared pure modules, the main part, the page part, the self-test, and the removal of `doc-paths.ts`. Every
docs file that joins, splits, compares or shows a full path calls `Paths`. No docs file reads `process.platform`,
writes `'/'` into a full path, or compares two full paths with `===`.

Files:
- modify `src/plugins/docs/tree.ts` · `src/plugins/docs/links.ts` · `src/plugins/docs/kinds.ts` ·
  `src/plugins/docs/path-guard.ts` · `src/plugins/docs/path-completion.ts`
- modify `src/plugins/docs/main/doc-files.ts` · `src/plugins/docs/main/index-sources.ts` ·
  `src/plugins/docs/main/script-locator.ts` · `src/plugins/docs/main/selftest-fixture.ts` ·
  `src/plugins/docs/main/selftest-script.ts` · `src/plugins/docs/main/start.ts`
- modify `src/plugins/docs/page/doc-view.ts` · `src/plugins/docs/page/docs-dialogs.ts` ·
  `src/plugins/docs/page/docs-state.ts` · `src/plugins/docs/page/docs-view.ts` · `src/plugins/docs/page/start.ts`
- delete `src/plugins/docs/doc-paths.ts` · `src/plugins/docs/doc-paths.test.ts`
- test `src/plugins/docs/tree.test.ts` · `links.test.ts` · `kinds.test.ts` · `path-guard.test.ts` ·
  `path-completion.test.ts` · `index-document.test.ts` (all in `src/plugins/docs/`)
- test `src/plugins/docs/main/doc-files.test.ts` · `index-sources.test.ts` · `script-locator.test.ts` ·
  `start.test.ts` (all in `src/plugins/docs/main/`)
- test `src/plugins/docs/page/docs-state.test.ts`

Consumes:
- `Paths` in `src/contracts/paths.ts` ← 01 (members: `separator`, `isAbsolute`, `normalize`, `join`, `parent`,
  `base`, `samePath`, `isInside`, `segmentsBelow`, `commonFolder`, `tilde`, `expandTilde`)
- `posixPaths` in `src/shared/paths/posix-paths.ts` and `windowsPaths` in `src/shared/paths/windows-paths.ts`
  ← 01 (tests only)
- `src/shared/paths` in the `layers` of the `LAYERS` entries `src/plugins/docs`, `src/plugins/docs/main` and
  `src/plugins/docs/page` in `scripts/check-layers.mts` ← 01 (plan.md: "listed in every layer that imports it",
  the test layers included). This task does not edit `scripts/check-layers.mts`.
- `MainServices.paths: Paths` and `PageServices.paths: Paths` in `src/contracts/plugin.ts` ← 02 (read as
  `api.services.paths`)

Produces (rule: `paths: Paths` is the last parameter of each changed function; a deps object gets a
`paths: Paths` field):
- `src/plugins/docs/tree.ts`: `buildTree(entries: readonly IndexEntry[], homeDir: string, paths: Paths): TreeNode[]`;
  `TreeGroup.folder: string | null`
- `src/plugins/docs/links.ts`: `resolveLink(href: string, fromFile: string, homeDir: string, paths: Paths): LinkTarget`
- `src/plugins/docs/kinds.ts`: `placesFor(kind: CreateKind, entries: readonly IndexEntry[], homeDir: string, paths: Paths): CreatePlace[]` ·
  `createTarget(kind: CreateKind, place: CreatePlace, name: string, paths: Paths): CreateTarget` ·
  `skillFolder(path: string, paths: Paths): string | null` · `nameProblem(kind: CreateKind, name: string): string | null` (signature kept)
- `src/plugins/docs/path-guard.ts`: `isIndexedPath(path: string, entries: readonly IndexEntry[], paths: Paths): boolean` ·
  `changeRefusal(target: string, entries: readonly IndexEntry[], folders: GuardFolders, paths: Paths): string | null`
- `src/plugins/docs/path-completion.ts`: `completionQuery(typed: string, homeDir: string, paths: Paths): CompletionQuery` ·
  `completions(entries: readonly { name: string; isFolder: boolean }[], prefix: string, paths: Paths): Completion[]` ·
  `completeTyped(typed: string, matches: readonly Completion[], paths: Paths): string`
- `src/plugins/docs/main/doc-files.ts`: `DocFilesDeps.paths: Paths`
- `src/plugins/docs/main/index-sources.ts`: `IndexSourcesDeps.paths: Paths`
- `src/plugins/docs/main/script-locator.ts`: `installedPluginsFile(configDir: string, paths: Paths): string` ·
  `readClaudeConfigDirs(files: Files, homeDir: string, log: Log, paths: Paths): Promise<string[]>` ·
  `locateScript(files: Files, homeDir: string, scriptPath: string, log: Log, paths: Paths): Promise<string | null>`
- `src/plugins/docs/main/selftest-fixture.ts`: `writeDocsFixture(files: Files, homeDir: string, paths: Paths): Promise<void>`
- `src/plugins/docs/main/selftest-script.ts`: `DocsSelfTestDeps.paths: Paths` ·
  `connectDocsFixtureSession(files: Files, homeDir: string, sessions: Pick<SessionsMainExports, 'connect' | 'activate'>, sessionId: string, paths: Paths): Promise<ConnectedSession>`
- `src/plugins/docs/main/start.ts`: `startDocs(services: Pick<MainServices, 'files' | 'processes' | 'log' | 'homeDir' | 'runMode' | 'paths'>, scriptPath: () => string): Promise<DocsMain>` ·
  `DocsDriveDeps.paths: Paths`
- `src/plugins/docs/page/docs-state.ts`: `contextChoices(document, homeDir, paths)` · `applyChange(document, change, paths)` ·
  `reapplyChange(document, change, paths)` · `renameRecord(path, renamed, paths)` ·
  `changeableEntry(node, entryOf, groupText, unsavedPaths, paths)` · `trashQuestion(targets, homeDir, keys, paths)` ·
  `provisionalEntry(path, kind, entries, paths)` · `detailFields(entry, homeDir, paths)`; each existing parameter
  keeps its type, and `paths: Paths` is added last
- `src/plugins/docs/page/docs-view.ts`: `DocsViewDeps.paths: Paths` · `src/plugins/docs/page/doc-view.ts`:
  `DocViewDeps.paths: Paths` · `src/plugins/docs/page/docs-dialogs.ts`: `DocsDialogsDeps.paths: Paths` (and the
  private `TextBoxDeps.paths: Paths`)

Decisions:
- Display: native separators, home as `~` (plan.md, round 1). Every shown path goes through `paths.tilde`.
- Typed input: either separator on Windows (plan.md, round 1). The path box splits the typed text at its last `/`
  or its last `paths.separator`, whichever is later.
- The docs index runs as `python3 -X utf8 <script> <command> <args>` on every OS (plan.md, Decided, round 1).
- A shared pure module takes `paths` as a parameter; a main or page part reads `api.services.paths` (plan.md,
  Design Overview).
- Error copy that named `/` is OS-neutral, so no copy depends on the adapter (this task, Decided):
  `absolutePath` throws `A path is absolute or starts with ~` (was `A path starts with / or ~`).
  `nameProblem` refuses a name that holds `/` or `\` on every OS, with the copy
  `A name holds no / or \ and does not start with .` (was `A name holds no / and does not start with .`).
- A link whose href `paths.isAbsolute` accepts is a file link, checked before the scheme check, so `C:/r/x.md`
  opens on Windows and stays unsupported on macOS (this task, Decided). A `file://` URL whose path has a `/`
  before a drive (`file:///C:/r/y.md`) drops that `/` when the rest is absolute by `paths.isAbsolute`.
- The memory files fake (`src/shared/memory-files.ts`) refuses Windows path syntax. So a Windows case that must
  reach `Files` hands a stub `Files` whose `read` serves fixed texts by exact path and rejects every other path
  with an `ENOENT`-coded error (`isMissingFile` accepts it). The stub spreads `createMemoryFiles()` for the other
  members. Every other Windows case tests a pure module.
- `doc-paths.test.ts` is deleted without moving its cases: `src/shared/paths/paths.test.ts` (01) covers them.

## Item 1 — shared pure modules

`tree.ts`:
- `group` sets `folder` from `paths.commonFolder(...)`, which is `null` when the entries share no root (two Windows
  drives). `TreeGroup.folder` becomes `string | null`. Its comment says: null when the entries are on different
  roots. `docs-view.ts`'s `selectedFolder` already returns `string | null`, and null opens the path box at the home
  folder, so a group on two drives opens `A` at `~`.
- `cloneNodes` titles a clone `paths.tilde(root, homeDir)`.
- `featureSlug` uses `paths.segmentsBelow(entry.path, entry.root)` in place of the `isInside` check and the
  `entry.path.slice(entry.root.length)` split. Null → null. It returns `below[0]` when `below.length > 1` and
  `below[0] !== 'followups'`, else null.
- `buildTree`, `group`, `kindGroups`, `pluginNodes`, `repoNode`, `cloneNodes`, `featuresNode` and `featureSlug` pass
  `paths` down.

`links.ts`:
- `fileTarget`: `paths.expandTilde` on the decoded path; then `paths.isAbsolute(expanded) ? paths.normalize(expanded)
  : paths.join(paths.parent(fromFile), expanded)`.
- `resolveLink`: before the `ANY_SCHEME` test, an href with `paths.isAbsolute(href)` goes to `fileTarget`. The
  `file://` branch drops the leading `/` of its path when `paths.isAbsolute(filePath.slice(1))`.

`kinds.ts`:
- Every `joinPath`, `parentFolder`, `baseName`, `tildePath` becomes `paths.join`, `paths.parent`, `paths.base`,
  `paths.tilde`. `KindRule.placeFolder` and `KindRule.targetPath` take `paths` last.
- `nameProblem` refuses `trimmed.includes('/') || trimmed.includes('\\') || trimmed.startsWith('.')` with the copy
  in Decisions.

`path-guard.ts`: each `isInside` becomes `paths.isInside`; each `path === entry.path` and `target === entry.path`
becomes `paths.samePath(...)`.

`path-completion.ts`:
- `typedFolderPart(typed, paths)`: the typed text up to and including its last `/` or `paths.separator`, whichever
  is later; `''` when it holds neither.
- `completionQuery`: `paths.expandTilde(folderPart, homeDir)`, then `paths.isAbsolute(expanded) ?
  paths.normalize(expanded) : paths.join(homeDir, expanded)`.
- `completions`: a folder's `text` is `` `${name}${paths.separator}` ``. The `Completion.text` comment says "with a
  trailing separator for a folder".

## Item 2 — main part

`doc-files.ts`:
- `absolutePath(path, homeDir, paths)`: `const full = paths.expandTilde(path, homeDir)`; when
  `!paths.isAbsolute(full)` it throws `A path is absolute or starts with ~`; else it returns `paths.normalize(full)`.
- `createAtPath`: refuses `requested.endsWith('/') || requested.endsWith(paths.separator)` with the copy it has now,
  `A path names a file, not a folder`.
- `realTarget(files, path, paths)`: the loop stops at a root by `paths.parent(existing) !== existing` in place of
  `existing !== '/'`. It joins with `paths.join`.
- `folderRealTarget`, `isDanglingLink`, `trashedPath`, `guardFolders` take `paths` last and use `paths.join`,
  `paths.parent`, `paths.base`, `paths.isInside`. `skillFolder` and `createTarget` get `paths`.
  `pluginConfigFile` maps `(dir) => installedPluginsFile(dir, paths)`. `changeRefusal` gets `paths`.
- `rename`'s `isCaseOnly` check and its `toPath === fromPath` check stay: they compare one volume's spellings.

`index-sources.ts`:
- `indexFile` is `paths.join(homeDir, MACHINE_INDEX_FILE)`. `MACHINE_INDEX_FILE` stays
  `'.agents/wigley-docs/index.json'` (a `join` segment may hold separators).
- `runScript` runs `deps.processes.run('python3', ['-X', 'utf8', script, command, ...args])`. Its comment says
  `python3 -X utf8 <script> <command> <args>` and why: UTF-8 mode, so a cp1252 console on Windows prints the
  index's `→`. `locateScript` gets `deps.paths`.

`script-locator.ts`:
- `installedPluginsFile` uses `paths.join`. `readClaudeConfigDirs`: `.map((dir) => paths.expandTilde(dir, homeDir))
  .filter((dir) => paths.isAbsolute(dir)).map((dir) => paths.normalize(dir))`; the default uses
  `paths.expandTilde`. Its config file is `paths.join(homeDir, DOCS_CONFIG_FILE)`. `locateScript` returns
  `paths.expandTilde(scriptPath, homeDir)` for a set `scriptPath`.

`selftest-fixture.ts`:
- `writeDocsFixture(files, homeDir, paths)`. The local `paths` (the fixture's path record) is renamed `fixture`, and
  `fixturePaths(home)` becomes `fixturePaths(home, paths)`. Every path is built with `paths.join`, so on Windows the
  fixture and its index hold native paths. `installedPluginsFile(fixture.claudeDir, paths)`.
- The stand-in `docs_index.py` stays as it is: it builds paths with `os.path` and writes `HOME` as a JSON string,
  so the index its `build` writes holds native paths on each OS.

`start.ts`:
- `hasDocsFixture(files, homeDir, paths)` joins with `paths.join`. `startDocs` passes `services.paths` to
  `writeDocsFixture`, `createIndexSources` and `createDocFiles`.
- `docsMainPart.start` passes `paths: services.paths` to `docsSelfTestScript` and `addDriveActions`.
  `addDriveActions` passes `deps.paths` to `writeDocsFixture` and `connectDocsFixtureSession`.

## Item 3 — page part

`page/start.ts`: the title bar's context title is `services.paths.tilde(path, home)`. `createView` passes
`paths: services.paths` to `createDocsView`.

`docs-view.ts`: passes `deps.paths` to `createDocView`, `createDocsDialogs`, `buildTree`, `isIndexedPath`,
`contextChoices`, `detailFields`, `applyChange`, `reapplyChange` and `changeableEntry`. `cachingPlugin(document,
path, paths)` uses `paths.isInside`. Each `isInside`, `parentFolder`, `baseName`, `tildePath` becomes the `paths`
member. `candidate.path === path` (the open-path entry lookup) and `entry.path === path` (the entry at the open
path with no line) become `deps.paths.samePath(...)`. The `context ${...}` log line is
`` `context ${deps.paths.tilde(choice.folder, homeDir)}` ``.

`doc-view.ts`: `renderText(markdown, path, text, paths)` takes the extension from `paths.base(path)`.
`drawHeader` and the `Could not open …` failure use `deps.paths.tilde`. `followLink` calls
`resolveLink(href, fromFile, homeDir, deps.paths)`. Each `baseName` becomes `deps.paths.base`.

`docs-dialogs.ts`:
- `createTextBox` gets `paths` in `TextBoxDeps` and passes it to `completionQuery`, `completions` and
  `completeTyped`.
- `createByPath` opens the box at `` `${paths.tilde(folder ?? homeDir, homeDir)}${paths.separator}` ``.
- `rename` opens the box at `paths.tilde(entry.path, homeDir)`. `placesFor`, `provisionalEntry`, `renameRecord`,
  `trashQuestion` get `deps.paths`; `followupEntry` passes `paths` to `provisionalEntry`. Each `baseName` becomes
  `paths.base` (the `trashed.map(baseName)` call becomes `trashed.map((path) => paths.base(path))`).

`docs-state.ts`:
- `contextChoices`: `paths.samePath(context.folder, homeDir)` picks the home context.
- `applyChange` (trashed) and `renamedDocument` use `paths.isInside`. `renamedDocument` sets the moved `path` to
  `paths.join(to, ...(paths.segmentsBelow(entry.path, from) ?? []))`; the `id` keeps its prefix replace
  (`entry.id.startsWith(from)`), since an id may carry a `#…` suffix. `reapplyChange` uses `paths.isInside`.
- `renameRecord` uses `skillFolder(path, paths)` and `paths.parent`.
- `changeableEntry` uses `paths.base`, `skillFolder(..., paths)` and `paths.isInside`.
- `trashQuestion` uses `paths.base` and `paths.tilde`. `installsText` and `detailFields` use `paths.tilde`.
- `provisionalEntry` and `owningEntry` use `paths.isInside`, `skillFolder(..., paths)`, `paths.base`.
  `guessedKind(path, skill, owner, paths)` tests `path.includes(`${s}rules${s}`)`, `${s}agents${s}` and
  `${s}commands${s}` with `s = paths.separator` (the path is normalized, so it holds only that separator).

## Item 4 — self-test script

`selftest-script.ts`: the two lines that show a path are built per OS from the adapter the script receives, with no
platform check.
- `STEPS` becomes `docsSteps(paths: Paths, homeDir: string): SelfTestStep[]`, and `docsSelfTestScript` sets
  `steps: docsSteps(paths, homeDir)` from `deps.paths` and `deps.homeDir`. Inside, `const shown = (relative:
  string) => paths.tilde(paths.join(homeDir, relative), homeDir)`. The result does not depend on which home is
  given, since `tilde` of a path below the home is `~` + separator + the rest.
- `'[docs] completed to ~/.claude/rules/neat.md'` becomes `` `[docs] completed to ${shown('.claude/rules/neat.md')}` ``.
- `'[docs] context ~/dev/selftest-repo'` becomes `` `[docs] context ${shown('dev/selftest-repo')}` ``.
- On macOS these are the same strings as now; on Windows they are `[docs] completed to ~\.claude\rules\neat.md`
  and `[docs] context ~\dev\selftest-repo`.
- Typed keys stay as they are: the steps type names only (`neat.md`, `fresh.md`, `kept.md`, `tidy`), never a
  separator, and the seven Backspaces erase `tidy.md` and `neat.md` the same on both OSes. `STYLE_RULE_FILE` stays
  `'.claude/rules/style.md'`: `writeFile` paths are relative to the temp home's scoped `Files`, `/` on every OS.
- `connectDocsFixtureSession` sets `projectDir: paths.join(home, 'dev', 'selftest-repo')` and passes `paths` to
  `writeDocsFixture`.

## Item 5 — removal

Delete `src/plugins/docs/doc-paths.ts` and `src/plugins/docs/doc-paths.test.ts`. After the task, no file under
`src/` imports `doc-paths`.

GIVEN Windows paths WHEN `read('C:/Users/u/dev/r/a.md')` or `read('~/dev/r/a.md')` runs with home `C:\Users\u` THEN `Files.read` gets `C:\Users\u\dev\r\a.md`
GIVEN Windows paths WHEN `read('\dev\r\a.md')` or `read('C:dev\a.md')` runs THEN it rejects `A path is absolute or starts with ~` and reads nothing
GIVEN global entries on `C:\` and `D:\` WHEN the tree builds THEN the Global group's `folder` is null
GIVEN a doc at `C:\r\docs\a.md` WHEN its link `../x.md` resolves THEN the target is `C:\r\x.md`
GIVEN home `C:\Users\u` WHEN the path box is typed `~/.claude/` THEN it lists `C:\Users\u\.claude` with prefix `''`
GIVEN a repo root `C:\Users\u\dev\r` WHEN a change targets `c:\users\u\dev\r\docs\notes.md` THEN the guard allows it
GIVEN the self-test on Windows WHEN `n` and Tab complete in the path box THEN the step waits for `[docs] completed to ~\.claude\rules\neat.md`

Tests (each existing test passes `posixPaths` where a changed signature now takes `paths`, and keeps its asserted
values; each new case passes `windowsPaths`; Windows inputs use an uppercase drive letter, so no assertion depends
on how the adapter spells a drive):
- Existing tests move off `doc-paths`: `index-document.test.ts`, `kinds.test.ts`, `path-guard.test.ts` and
  `tree.test.ts` title entries with `posixPaths.base`; `doc-files.test.ts`'s `withLinks` and `caseInsensitive`
  use `posixPaths.join`, `posixPaths.parent`, `posixPaths.base`. `setUp` in `doc-files.test.ts` and
  `index-sources.test.ts` adds `paths: posixPaths`; in `start.test.ts` the services record the `start(files,
  runMode)` helper builds (line ~18) and the deps literal passed to `addDriveActions` (line ~62) each gain
  `paths: posixPaths`.
- `kinds.test.ts` `nameProblem_Rules_PinnedMessages`: the `a/b` and `.x` cases expect
  `A name holds no / or \ and does not start with .`; new case `nameProblem('rule', 'a\\b')` expects the same.
- `doc-files.test.ts` (find the current not-absolute test by its `A path starts with / or ~` expectation, near
  line 347): it expects `A path is absolute or starts with ~`.
- `index-sources.test.ts`: `BUILD` is `['-X', 'utf8', SCRIPT, 'build']`, and every scripted args array starts
  `'-X', 'utf8', SCRIPT` (`[SCRIPT, 'session', 'abc']` → `['-X', 'utf8', SCRIPT, 'session', 'abc']`, and so on).
- New, `doc-files.test.ts`:
  - `read_WindowsDrivePath_ReadsNormalized` — home `C:\Users\u`, a stub `Files` whose `read` records its path and
    returns `'x'`; `read('C:/Users/u/dev/r/a.md')` and `read('~/dev/r/a.md')` and `read('~\\dev\\r\\a.md')` each
    resolve `'x'`, and the recorded paths are each `C:\Users\u\dev\r\a.md`.
  - `read_WindowsNotAbsolute_Rejects` — `read('\\dev\\r\\a.md')` and `read('C:dev\\a.md')` reject
    `A path is absolute or starts with ~`; the stub records no read.
  - `create_WindowsTrailingBackslash_RejectsFolder` — `create({ type: 'path', path: 'C:\\Users\\u\\dev\\r\\new\\' })`
    rejects `A path names a file, not a folder`.
- New, `tree.test.ts`:
  - `buildTree_WindowsTwoDrives_GroupFolderNull` — global instructions at `C:\Users\u\.claude\CLAUDE.md` and
    `D:\agents\AGENTS.md`; the Global group's `folder` is `null`, and its Instructions group's `folder` is `null`.
  - `buildTree_WindowsFeatureSlug_FromFolderBelowRoot` — a `features` entry, no `meta.feature` or `meta.slug`, root
    `C:\Users\u\wigley-features\r`, path `C:\Users\u\wigley-features\r\login\design.md`, and a second one at
    `C:\Users\u\wigley-features\r\followups.md`; the Features node holds a node titled `login`, and the follow-ups
    file has no slug node.
  - `buildTree_WindowsTwoClones_TildeTitles` — repo `r` entries with roots `C:\Users\u\dev\r` and
    `C:\Users\u\src\r`, home `C:\Users\u`; the clone titles are `~\dev\r` and `~\src\r`.
- New, `links.test.ts`:
  - `resolve_WindowsRelativeParent_Resolved` — `resolveLink('../x.md', 'C:\\r\\docs\\a.md', 'C:\\Users\\u', windowsPaths)`
    is `{ type: 'file', path: 'C:\\r\\x.md', line: null, fragment: null }`.
  - `resolve_WindowsTildeWithLine_Expanded` — `'~/notes/b.md:4'` from the same doc is `C:\Users\u\notes\b.md`, line `4`.
  - `resolve_WindowsDrivePath_File` — `'C:/r/y.md'` is a file target `C:\r\y.md`; with `posixPaths`, `'C:/r/y.md'`
    is `{ type: 'unsupported', href: 'C:/r/y.md' }`.
  - `resolve_WindowsFileUrl_DropsSlashBeforeDrive` — `'file:///C:/r/y.md'` is a file target `C:\r\y.md`.
- New, `kinds.test.ts`:
  - `createTarget_WindowsSkill_NativePath` — place folder `C:\Users\u\dev\r\.claude\skills`, name `demo`; the path
    is `C:\Users\u\dev\r\.claude\skills\demo\SKILL.md`.
  - `skillFolder_WindowsSkillMd_Folder` — `C:\Users\u\dev\r\.claude\skills\demo\SKILL.md` gives
    `C:\Users\u\dev\r\.claude\skills\demo`.
  - `placesFor_WindowsGlobalInstructions_TildeTitle` — a global instructions entry at
    `C:\Users\u\wigley-agents\AGENTS.md`, home `C:\Users\u`; one place, folder `C:\Users\u\wigley-agents`, title
    `Global · ~\wigley-agents`.
- New, `path-guard.test.ts`:
  - `changeRefusal_WindowsOtherCase_Allowed` — a repo entry with root `C:\Users\u\dev\r`;
    `c:\users\u\dev\r\docs\notes.md` is allowed (null).
  - `changeRefusal_WindowsSiblingPrefix_Refused` — `C:\Users\u\dev\rx\a.md` is
    `Refused: C:\Users\u\dev\rx\a.md is outside the indexed folders`.
  - `isIndexedPath_WindowsOtherCase_Openable` — a global entry at `C:\Users\u\.claude\CLAUDE.md`, root null;
    `c:\users\u\.claude\claude.md` is openable.
- New, `path-completion.test.ts`:
  - `completionQuery_WindowsTildeSlash_Expanded` — `completionQuery('~/.claude/', 'C:\\Users\\u', windowsPaths)` is
    `{ folder: 'C:\\Users\\u\\.claude', prefix: '' }`; `'~\\.claude\\ru'` is `{ folder: 'C:\\Users\\u\\.claude', prefix: 'ru' }`;
    `'C:/'` is `{ folder: 'C:\\', prefix: '' }`.
  - `completions_WindowsFolder_TrailingBackslash` — `[{ name: 'rules', isFolder: true }]` with prefix `r` gives the
    text `rules\`.
  - `completeTyped_WindowsMixedSeparators_KeepsTypedFolder` — `completeTyped('~/.claude/ru', [rules folder], windowsPaths)`
    is `~/.claude/rules\`; `completeTyped('~\\.claude\\rules\\n', [file neat.md], windowsPaths)` is
    `~\.claude\rules\neat.md`.
- New, `script-locator.test.ts`:
  - `readClaudeConfigDirs_WindowsEntries_AbsoluteKeptNormalized` — home `C:\Users\u`; a stub `Files` serves
    `C:\Users\u\.agents\wigley-docs\config.json` as `{"claudeConfigDirs":["C:/claude/","\\x","rel","~/.claude-personal"]}`;
    the result is `['C:\\claude', 'C:\\Users\\u\\.claude-personal']`.
- New, `docs-state.test.ts`:
  - `contextChoices_WindowsHomeOtherCase_First` — contexts `C:\Users\u\dev\b`, `c:\users\u`, `C:\Users\u\dev\a`,
    home `C:\Users\u`; the order is `c:\users\u`, `C:\Users\u\dev\a`, `C:\Users\u\dev\b`.
  - `applyChange_WindowsRenamedFolder_MovesEntriesInside` — rename from `C:\r\.claude\skills\old` to
    `C:\r\.claude\skills\new`; the entry at `C:\r\.claude\skills\old\SKILL.md` moves to
    `C:\r\.claude\skills\new\SKILL.md`, and an entry at `C:\r\.claude\skills\older\SKILL.md` stays.
  - `trashQuestion_WindowsLinkAndTarget_TildePaths` — targets `C:\Users\u\wigley-agents\CLAUDE.md` and
    `C:\Users\u\.claude\CLAUDE.md`, home `C:\Users\u`, no keys; the text is
    `Move ~\wigley-agents\CLAUDE.md and its link ~\.claude\CLAUDE.md to the Trash?`.
  - `provisionalEntry_WindowsRulesFolder_Rule` — `C:\Users\u\.claude\rules\x.md` with no entries guesses kind
    `rule`, title `x.md`.

The self-test steps are not unit tested; task 08 runs `npm run selftest` on Windows.

Done when: `npm run typecheck` and `npm run lint` pass; no file under `src/` imports `doc-paths`; no file under
`src/plugins/docs/` reads `process.platform`; the test gate runs the tests above.

Commit: one commit for the group.

## Proof

Commit 9b94c49 (04a and 04b together). Proof: diff read — every Produces present with paths last; no doc-paths import or process.platform read under src/; python3 -X utf8; self-test path lines built from the adapter; whole-repo typecheck and lint clean; docs suite 14 files 243 passed. Concerns: realTarget's root stop on Windows is unit-untested (memory files refuse Windows paths), first proved by task 08's self-test.
