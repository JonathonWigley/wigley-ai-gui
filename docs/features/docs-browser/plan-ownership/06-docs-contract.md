# 06 — Docs contract and index parse, schema 3

Status: not started
Type: Task
Wave: 2 · Depends on: 07
Plan: [plan.md](plan.md)
Repo: wigley-ai-gui

Files:     modify `src/plugins/docs/contract.ts` · `src/plugins/docs/index-document.ts` · `src/plugins/docs/tree.ts`
           (`KIND_TITLES` only) · `src/plugins/docs/page/docs-state.ts` (`provisionalEntry` only) ·
           `src/plugins/docs/main/selftest-fixture.ts`
           test `src/plugins/docs/index-document.test.ts` · `src/plugins/docs/kinds.test.ts` ·
           `src/plugins/docs/path-guard.test.ts` · `src/plugins/docs/tree.test.ts` ·
           `src/plugins/docs/main/doc-files.test.ts` · `src/plugins/docs/main/index-sources.test.ts` ·
           `src/plugins/docs/main/start.test.ts` · `src/plugins/docs/main/selftest-fixture.test.ts` ·
           `src/plugins/docs/page/docs-state.test.ts`
Consumes:  `isJsonObject`, `isStringArray` in `src/shared/json.ts`; `IndexHarness` in `contract.ts` (exists)
Produces:  `export type DocOwner = 'mine' | 'third-party';` in `src/plugins/docs/contract.ts`
           `owner: DocOwner;` (member of `IndexEntry`) in `src/plugins/docs/contract.ts`
           `export interface InstalledCopy { harness: IndexHarness; version: string; path: string }` in `src/plugins/docs/contract.ts`
           `loadedPlugins: Record<string, string>;` (member of `IndexContext`) in `src/plugins/docs/contract.ts`
           `schemaVersion: 3;` (member of `IndexDocument`) in `src/plugins/docs/contract.ts`
           `export interface FileStatus { uncommitted: boolean; unpushed: boolean; notInstalled: IndexHarness[] }` in `src/plugins/docs/contract.ts`
           `export interface CloneStatus { root: string; fetchedAt: string | null; fetchFailed: boolean; files: Record<string, FileStatus> }` in `src/plugins/docs/contract.ts`
           `export interface PluginStatusRead { clones: CloneStatus[] }` in `src/plugins/docs/contract.ts`
           `pluginStatus(sourceId: string, fetch: boolean): Promise<PluginStatusRead>;` (in `DocsChannel.invoke`) in `src/plugins/docs/contract.ts`
           `export const INDEX_SCHEMA_VERSION = 3;` in `src/plugins/docs/index-document.ts`
           `export function installedCopies(entry: IndexEntry): InstalledCopy[] | null` in `src/plugins/docs/index-document.ts`
           `'skill-file'` in `DocKind` and in `DOC_KINDS`, right after `'skill'`
           `'skill-file': 'Skill files',` in `KIND_TITLES` in `src/plugins/docs/tree.ts`
Decisions: - The contract names are `plan.md` § File Structure word for word (pinned by lead).
           - `INDEX_SCHEMA_VERSION = 3`; schema 2 is refused with the existing message, no fallback (pinned by lead;
             `AGENTS.md` § Intent, one user).
           - `DOC_KINDS` gains `'skill-file'` after `'skill'`, as `model.py`'s `KINDS` orders it (pinned by lead).
           - The parse rejects an entry whose `owner` is not `'mine'` or `'third-party'`, with field name `owner`.
             It checks `owner` right after `source`, the order `to_json` writes them (pinned by lead).
           - The parse rejects a context whose `loadedPlugins` is not an object whose every value is a string, with
             field name `loadedPlugins`. It checks it after `sessionId` and before `states` (pinned by lead).
           - `installedCopies(entry)` returns null when `entry.meta.installed` is absent (`undefined`). It returns
             `[]` when the value is present but not an array. Otherwise it returns the array's elements that are an
             object with `harness` `'claude'` or `'codex'`, `version` a string and `path` a string, in array order,
             each as a new `{ harness, version, path }` object; it drops every other element (pinned by lead;
             "present but not an array → `[]`" Decided). No other module reads `meta.installed` (plan.md Boundary
             rules).
           - `DocKind` gains a member, so the compiler fails on `KIND_TITLES: Record<DocKind, string>` in `tree.ts`.
             This task adds `'skill-file': 'Skill files'` there and changes nothing else in `tree.ts`; task 10 owns
             the tree grouping (Decided).
           - `provisionalEntry` in `page/docs-state.ts` sets `owner: 'mine'`. A new file lands only in a mine place,
             and main's guard refuses third-party paths (task 09) (Decided).
           - Every test helper that builds an `IndexEntry` defaults `owner: 'mine'`. Every `IndexContext` literal
             gains `loadedPlugins: {}`. Every `IndexDocument` literal says `schemaVersion: 3` (pinned by lead).
           - Self-test fixture: `indexDocument` writes `schemaVersion: 3`. Every entry has `owner: 'mine'`, the two
             `pluginOwned` entries (the `plugin` entry and the `cached` skill, in `plugins/cache/selftest-market/…`)
             included: they stand for an installed-only file of the user's own plugin, so today's plugin-cache and
             detail-view self-test moves hold (lead, settling 06 against 12; task 12 adds the third-party docs). Each context, the session document's context
             included, has `loadedPlugins: {}`. The fixture gains no new docs (pinned by lead; owner values Decided).
           - The stand-in `docs_index.py` (`standInScript`) appends each new rule entry with `"owner": "mine"`
             after `"source": "global"`. It writes no other new field: the rest comes from `index.fixture.json`
             (pinned by lead).
           - The file header comment of `contract.ts` says schema 3.
GIVEN an index with `schemaVersion` 2 WHEN parsed THEN it fails `Unsupported docs index schema 2; this app reads 3`
GIVEN an entry with no `owner`, or `owner` `'theirs'` WHEN parsed THEN it fails `Docs index entry 0 is malformed: owner`
GIVEN an entry with `owner` `'third-party'` WHEN parsed THEN it loads with that owner
GIVEN a context with no `loadedPlugins`, or `{ "w@m": 3 }` WHEN parsed THEN it fails `Docs index context 0 is malformed: loadedPlugins`
GIVEN a context with `loadedPlugins` `{ "wigley@wigley-ai-marketplace": "1.9.1" }` WHEN parsed THEN the context keeps it
GIVEN an entry with no `meta.installed` WHEN `installedCopies` THEN null
GIVEN `meta.installed` `[]` WHEN `installedCopies` THEN `[]`
GIVEN `meta.installed` with good and bad elements WHEN `installedCopies` THEN only the good ones, in order
GIVEN the self-test fixture WHEN written THEN its index parses as schema 3 and every entry carries an owner
Tests:     in `index-document.test.ts` (its `entry` helper gains `owner: 'mine'`; `documentText` writes `schemaVersion: 3`;
           the context literal in `parse_ValidDocument_ReturnsEntriesAndContexts` and in
           `parse_ContextWithoutFolder_NamesFolder` gains `loadedPlugins: {}`):
           `parse_Schema1_Unsupported` — message changes to `Unsupported docs index schema 1; this app reads 3`
           `parse_Schema2_Unsupported` — `{ ok: false, message: 'Unsupported docs index schema 2; this app reads 3' }`
           `parse_MissingOwner_NamesOwner` — entry without `owner` → `Docs index entry 0 is malformed: owner`
           `parse_UnknownOwner_NamesOwner` — `owner: 'theirs'` → `Docs index entry 0 is malformed: owner`
           `parse_ThirdPartyOwner_Loads` — `owner: 'third-party'` → `parsed.document.entries[0].owner` is `'third-party'`
           `parse_ContextWithoutLoadedPlugins_NamesLoadedPlugins` — `{ folder: '/u', sessionId: null, states: {} }` →
             `Docs index context 0 is malformed: loadedPlugins`
           `parse_LoadedPluginsNotStrings_NamesLoadedPlugins` — `loadedPlugins: { 'w@m': 3 }` → same message
           `parse_LoadedPlugins_Kept` — `loadedPlugins: { 'wigley@wigley-ai-marketplace': '1.9.1' }` is in
             `parsed.document.contexts[0].loadedPlugins`, equal
           `docKinds_SkillFileAfterSkill` — `DOC_KINDS.indexOf('skill-file')` is `DOC_KINDS.indexOf('skill') + 1`
           `installedCopies_NoInstalled_Null` — `meta: {}` → `null`
           `installedCopies_Empty_Empty` — `meta: { installed: [] }` → `[]`
           `installedCopies_NotAList_Empty` — `meta: { installed: 'x' }` → `[]`
           `installedCopies_Copies_InOrder` — `[{ harness: 'claude', version: '1.9.1', path: '/c/a.md' },
             { harness: 'codex', version: '0.17.1', path: '/x/a.md' }]` → the same two, in that order
           `installedCopies_WrongShape_Dropped` — `[{ harness: 'vim', version: '1', path: '/p' },
             { harness: 'claude', version: 2, path: '/p' }, 'x', null, { harness: 'codex', version: '1' },
             { harness: 'claude', version: '1.0.0', path: '/ok' }]` → `[{ harness: 'claude', version: '1.0.0', path: '/ok' }]`
           in `index-sources.test.ts`: `load_SchemaThree_PinnedMessage` becomes `load_SchemaFour_PinnedMessage` — the file
             holds `{"schemaVersion":4}`; the message is `Unsupported docs index schema 4; this app reads 3`; the
             loaded entries are `[]`. `ENTRY` gains `owner: 'mine'`; `documentOf` writes `schemaVersion: 3`.
           in `selftest-fixture.test.ts`:
           `GIVEN the fixture WHEN the index fixture is read back THEN each entry has an owner and each context empty loadedPlugins`
             — every entry's `owner` is `'mine'`; every context's `loadedPlugins` equals `{}`
           `GIVEN the fixture WHEN the stand-in script is read back THEN a new rule entry is owned mine` — the script
             contains `"owner": "mine"`
           in `docs-state.test.ts`: `provisionalEntry_NewFile_OwnerMine` — `provisionalEntry('/Users/u/dev/r/notes.md',
             null, repoEntries, posixPaths).owner` is `'mine'`
           every other changed test file changes only its helpers and literals (owner, `loadedPlugins: {}`,
             `schemaVersion: 3`), with no assertion changed: `kinds.test.ts` (`entry`), `path-guard.test.ts`
             (`entry`), `tree.test.ts` (`entry`), `main/doc-files.test.ts` (`entry`), `main/start.test.ts`
             (`SESSION_DOCUMENT`), `page/docs-state.test.ts` (`entry`, `context`, `documentOf`, the
             `contextChoices` document, each context literal)
Done when: `npm run typecheck`, `npm test` and `npm run lint` pass; `grep -n "schemaVersion: 2" -r src/plugins/docs`
           finds nothing
Commit:    one commit for the group, in wigley-ai-gui, committed by path only (peer sessions have uncommitted edits)

## Proof

