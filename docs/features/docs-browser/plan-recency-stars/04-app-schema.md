# 04 — Schema 4 in the app

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)
Repo: wigley-ai-gui

Files:     modify `src/plugins/docs/contract.ts` · `src/plugins/docs/index-document.ts` ·
           `src/plugins/docs/main/selftest-fixture.ts` · `src/plugins/docs/page/docs-state.ts` (`provisionalEntry` only)
           test `src/plugins/docs/index-document.test.ts` · `src/plugins/docs/kinds.test.ts` ·
           `src/plugins/docs/path-guard.test.ts` · `src/plugins/docs/tree.test.ts` ·
           `src/plugins/docs/main/doc-files.test.ts` · `src/plugins/docs/main/index-sources.test.ts` ·
           `src/plugins/docs/main/plugin-status.test.ts` · `src/plugins/docs/main/start.test.ts` ·
           `src/plugins/docs/main/selftest-fixture.test.ts` · `src/plugins/docs/page/docs-state.test.ts`
Consumes:  `isJsonObject`, `isStringArray` in `src/shared/json.ts` (exist)
           the index's schema 4 entry field `lastLoaded` (wigley-ai-marketplace `plugins/wigley/scripts/docs-index/README.md`
           § Entries and § Last loaded, committed ahead in `86be58f`; tasks 01–02 make the index write it)
Produces:  `lastLoaded: string | null;` (member of `IndexEntry`, right after `walked`) in `src/plugins/docs/contract.ts`
           `schemaVersion: 4;` (member of `IndexDocument`) in `src/plugins/docs/contract.ts`
           `export const INDEX_SCHEMA_VERSION = 4;` in `src/plugins/docs/index-document.ts`
           `lastLoaded: null` on the entry `provisionalEntry` returns, in `src/plugins/docs/page/docs-state.ts`
           `lastLoaded: null` as the default of the fixture's `entry()` helper, in `src/plugins/docs/main/selftest-fixture.ts`
Decisions:
- The field name, place and type are `plan.md` § File Structure word for word: `IndexEntry.lastLoaded: string | null`.
  The member goes right after `walked`, the order the README's entry example writes it (pinned by lead).
- Its doc comment in `contract.ts`: "The transcript timestamp (ISO 8601) of the latest load of the entry; null when no
  transcript read shows one. Machine-wide in the `machine` source, the session's own in a `session:<id>` source."
- `INDEX_SCHEMA_VERSION = 4`. Schema 3 is refused with the existing message, with no fallback (`AGENTS.md` § Intent,
  one user; `plan.md` Boundary rules).
- The parse checks `lastLoaded` as the last check of `malformedEntryField`, after `walked`. Field name `lastLoaded`.
  It is valid when it is `null`, or a string for which `Date.parse` does not return `NaN`. An absent field fails
  (`undefined` is neither). Decided: today's parse checks each field's type only, but the app relies on this string
  being a time (the tree sorts by it and the rows draw it), so the one check at the boundary keeps every reader free of
  a `NaN` branch.
- `malformedEntryField`'s comment gains: "`lastLoaded` is null or a time `Date.parse` reads."
- The file header comment of `contract.ts` says schema 4.
- `provisionalEntry` sets `lastLoaded: null`: a doc the app has just made was never loaded (pinned by lead). Its
  comment gains "never loaded".
- A rename keeps the entry's time. `renamedDocument` in `page/docs-state.ts` builds each moved entry as
  `{ ...entry, id, path, title }`, so `lastLoaded` already carries over. This task changes nothing there; a test pins
  it. A trash drops the entry, its time with it.
- Self-test fixture: `indexDocument` writes `schemaVersion: 4`. The `entry()` helper defaults `lastLoaded: null`, so
  every fixture entry is never loaded. Task 08 sets one entry's time (it changes values only).
- The stand-in `docs_index.py` (`standInScript`) appends each new rule entry with `"lastLoaded": None` after
  `"walked": []`. Without it, the app refuses the built index as malformed (pinned by lead; read from the script
  text in `selftest-fixture.ts`).
- Every test helper and literal that builds an `IndexEntry` adds `lastLoaded: null`. Every `IndexDocument` literal
  says `schemaVersion: 4`. The full list, read from the tree at plan time (the compiler flags any missed):
  - `entry()` helpers: `index-document.test.ts`, `kinds.test.ts`, `path-guard.test.ts`, `tree.test.ts`,
    `main/doc-files.test.ts`, `main/plugin-status.test.ts`, `page/docs-state.test.ts`
  - `ENTRY` and `documentOf` in `main/index-sources.test.ts`
  - `documentText` in `index-document.test.ts` (JSON text, so the compiler does not flag it: change it by hand)
  - `SESSION_DOCUMENT` in `main/start.test.ts`
  - `documentOf` and the `contextChoices_HomeFirstThenByFolder` document literal in `page/docs-state.test.ts`
  - the `toMatchObject` object of the `provisionalEntry` scratch-source test in `page/docs-state.test.ts` (near the
    end of the file) gains `lastLoaded: null`

GIVEN an index with `schemaVersion` 3 WHEN parsed THEN it fails `Unsupported docs index schema 3; this app reads 4`
GIVEN an entry with no `lastLoaded` WHEN parsed THEN it fails `Docs index entry 0 is malformed: lastLoaded`
GIVEN an entry with `lastLoaded` `3` or `"yesterday"` WHEN parsed THEN it fails `Docs index entry 0 is malformed: lastLoaded`
GIVEN an entry with `lastLoaded` `null` WHEN parsed THEN it loads with `lastLoaded` null
GIVEN an entry with `lastLoaded` `"2026-10-26T21:01:32.174Z"` WHEN parsed THEN it loads with that exact string
GIVEN a new file WHEN `provisionalEntry` builds its entry THEN `lastLoaded` is null
GIVEN a loaded entry WHEN a rename moves it THEN the moved entry keeps its `lastLoaded`
GIVEN the self-test fixture WHEN written THEN its index parses as schema 4

Tests:     in `index-document.test.ts` (helpers as above; `documentText` writes `schemaVersion: 4`):
           `parse_Schema1_Unsupported`, `parse_Schema2_Unsupported` — messages end `this app reads 4`
           `parse_Schema3_Unsupported` — `{ ok: false, message: 'Unsupported docs index schema 3; this app reads 4' }`
           `parse_MissingLastLoaded_NamesLastLoaded` — an entry without `lastLoaded` →
             `Docs index entry 0 is malformed: lastLoaded`
           `parse_LastLoadedNotATime_NamesLastLoaded` — `lastLoaded: 3`, then `lastLoaded: 'yesterday'` → the same message
           `parse_LastLoadedNull_Loads` — `parsed.document.entries[0].lastLoaded` is `null`
           `parse_LastLoadedTime_KeptVerbatim` — `lastLoaded: '2026-10-26T21:01:32.174Z'` →
             `parsed.document.entries[0].lastLoaded` is `'2026-10-26T21:01:32.174Z'`
           in `main/index-sources.test.ts`: `load_SchemaFour_PinnedMessage` becomes `load_SchemaFive_PinnedMessage` — the
             file holds `{"schemaVersion":5}`; the message is `Unsupported docs index schema 5; this app reads 4`; the
             loaded entries are `[]`
           in `page/docs-state.test.ts`:
           `provisionalEntry_NewFile_NeverLoaded` — `provisionalEntry('/Users/u/dev/r/notes.md', null, [], posixPaths).lastLoaded`
             is `null`
           `applyChange_Renamed_KeepsLastLoaded` — an entry at `/Users/u/.claude/rules/a.md` with
             `lastLoaded: '2026-10-26T09:00:00Z'`, renamed to `/Users/u/.claude/rules/b.md`: the entry with id
             `/Users/u/.claude/rules/b.md` has `lastLoaded` `'2026-10-26T09:00:00Z'`
           in `main/selftest-fixture.test.ts`:
           `GIVEN the fixture WHEN the stand-in script is read back THEN a new rule entry is never loaded` — the script
             contains `"lastLoaded": None`
           the existing `GIVEN loadStates on WHEN the index fixture is parsed THEN the app reads it` covers the schema 4
             parse of the fixture; it changes nothing
           every other changed test file changes only its helpers and literals (`lastLoaded: null`, `schemaVersion: 4`),
             with no assertion changed
Done when: `npm run typecheck` passes; `npm test -- src/plugins/docs` passes (`npx` is denied on this machine) with every test above; `npm run lint`
           passes; `grep -rn "schemaVersion: 3" src/plugins/docs` finds nothing
Commit:    one commit for the group, in wigley-ai-gui, committed by path only (peer sessions may have uncommitted edits)

## Proof

Commit c3f1719 · proof: diff read: all 5 Produces present; typecheck pass; worker ran docs tests (442) and lint green · concerns: Done-when grep for schemaVersion: 3 still hits index-document.test.ts:98, the required parse_Schema3_Unsupported input — kept
