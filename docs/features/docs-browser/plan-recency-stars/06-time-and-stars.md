# 06 — Loaded-time text and the star set

Status: not started
Type: Batch
Wave: 2 · Depends on: 04 (both change `page/docs-state.ts` and its test)
Plan: [plan.md](plan.md)
Repo: wigley-ai-gui

Files:     create `src/plugins/docs/loaded-time.ts` · `src/plugins/docs/page/starred-docs.ts`
           modify `src/plugins/docs/page/docs-state.ts` (`renamedDocument` and two new exports only)
           test `src/plugins/docs/loaded-time.test.ts` (new) · `src/plugins/docs/page/starred-docs.test.ts` (new) ·
           `src/plugins/docs/page/docs-state.test.ts`
Consumes:  `UiState` in `src/contracts/ui-state.ts` (exists) · `Disposable` in `src/contracts/disposable.ts` (exists) ·
           `Paths` in `src/contracts/paths.ts` (exists) · `isStringArray` in `src/shared/json.ts` (exists) ·
           `DocChangeRecord` in `src/plugins/docs/page/docs-state.ts` (exists) ·
           `page/docs-state.test.ts` with `lastLoaded: null` in its helpers ← 04
Produces:  `export function loadedAgo(iso: string, now: number): string` in `src/plugins/docs/loaded-time.ts`
           `export function loadedAt(iso: string): string` in `src/plugins/docs/loaded-time.ts`
           `export function loadedLine(iso: string, now: number): string` in `src/plugins/docs/loaded-time.ts`
             (drafter addition to `plan.md` § File Structure: the doc view's sentence, task 07 consumes it)
           `export interface StarredDocs { ids(): ReadonlySet<string>; has(entryId: string): boolean; toggle(entryId: string): void; applyChange(change: DocChangeRecord): void; onChanged(listener: () => void): Disposable }`
             in `src/plugins/docs/page/starred-docs.ts`
           `export function createStarredDocs(uiState: UiState, paths: Paths): StarredDocs` in
             `src/plugins/docs/page/starred-docs.ts`
           `export function movedEntryId(entryId: string, from: string, to: string, paths: Paths): string | null` in
             `src/plugins/docs/page/docs-state.ts`
           `export function isEntryIdInside(entryId: string, path: string, paths: Paths): boolean` in
             `src/plugins/docs/page/docs-state.ts`
Decisions:
- Names and signatures are `plan.md` § File Structure word for word (pinned by lead); `loadedLine`, `movedEntryId` and
  `isEntryIdInside` are this task's additions.
- `loaded-time.ts` sits beside `tree.ts` at the plugin root: no DOM, no clock read; `now` comes in as epoch
  milliseconds (design review: ambient service injected). Its header comment: "The texts for when a doc was last
  loaded: short and relative on a tree row, the full local date and time on hover, and the doc view's sentence."
- `loadedAgo(iso, now)`, pinned by lead (design doc § Recency and stars, round 2 Q3). Let `elapsed = now -
  Date.parse(iso)` in milliseconds. Each N is the floor of `elapsed` in that unit. In order:
  - `elapsed < 60_000`, a negative `elapsed` (a time ahead of the clock) included → `now`
  - under 60 minutes → `<N>m` (`4m`)
  - under 24 hours → `<N>h` (`3h`)
  - under 7 days → `<N>d` (`2d`)
  - under 8 weeks (56 days) → `<N>w`, N the whole weeks (`5w`)
  - else the local date with English month names:
    `new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })` → `Mar 3`; when
    `new Date(iso).getFullYear() !== new Date(now).getFullYear()` (local years),
    `new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })` → `Mar 3, 2025`.
- `loadedAt(iso)`, pinned by lead: `new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })`,
  the user's locale and local time zone, for the row's hover text.
- `loadedLine(iso, now)`, pinned by lead (round 2 Q3): `Loaded just now` when `loadedAgo` gives `now`;
  `Loaded <loadedAgo> ago` for the `m`, `h`, `d` and `w` forms (`Loaded 3h ago`); `Loaded <date>` for the date form,
  with no `ago` (`Loaded Mar 3`, `Loaded Mar 3, 2025`). Decided: it lives here beside `loadedAgo` and shares its
  classification, so no caller parses `loadedAgo`'s text to tell the forms apart.
- Test times sit at 12:00 UTC, so the local date is the same day in every time zone from UTC−11 to UTC+11; the
  relative forms are pure arithmetic. `loadedAt` gets no test: its one line is the platform call above, and a test
  would restate it (`wigley:writing-tests` § What earns neither).
- The id rewrite, pinned by lead: widen the rename's id rewrite to an export and reuse it; never copy it. Today it is
  inline in the private `renamedDocument` (`page/docs-state.ts`): the id becomes the moved path plus the id's `#…`
  part. The star set holds ids only, with no entry path, so the export works on the id:
  - Both exports split the id at its first `#` into a path part and a suffix (empty when there is no `#`), compare
    the path part with the `Paths` rules (case-insensitive on Windows, as `renamedDocument` compares today), and keep
    the suffix.
  - `movedEntryId(entryId, from, to, paths)`: when `paths.segmentsBelow(pathPart, from)` is not null, returns
    `paths.join(to, ...below) + suffix` (for `below` empty, `to + suffix`); else null.
  - `isEntryIdInside(entryId, path, paths)`: `paths.isInside(pathPart, path)`.
  - `renamedDocument` takes each moved entry's new id from `movedEntryId(entry.id, from, to, paths) ?? entry.id`. It
    keeps computing the new path from `entry.path` as today. Every existing `applyChange` rename test passes
    unchanged. Add `movedEntryId_WindowsItemOtherCase_Moves`: `('C:\\R\\a.md#L4', 'c:\\r\\a.md',
    'C:\\R\\b.md', windowsPaths)` returns `'C:\\R\\b.md#L4'`, and `isEntryIdInside_WindowsItemOtherCase_True`:
    `('C:\\R\\a.md#L4', 'c:\\r\\a.md', windowsPaths)` returns true.
  - Comment on each export, for example: "The id an entry at or inside `from` gets when `from` moves to `to`: an id is
    its entry's path, with `#…` for an item inside the file. Null when the move does not reach it."
- Star set, pinned by lead (round 1, Decided: one star set; Decided: stable and dev apps differ):
  - `uiState` key `starred`; the value is an array of entry ids sorted by code-unit order (`[...ids].sort()`), so the
    saved value is the same for the same set.
  - `createStarredDocs` reads the key once. An array whose every element is a string (`isStringArray`) is the set. Any
    other value — absent, `null`, a string, an object, an array holding a non-string — reads as the empty set, and is
    not written back until a change.
  - `toggle(entryId)` adds an absent id, removes a present one, saves, then fires `onChanged`.
  - `applyChange(change)`: `created` does nothing; `renamed` replaces each id for which
    `movedEntryId(id, change.from, change.to, paths)` is not null with that id; `trashed` drops each id for which
    `isEntryIdInside(id, path, paths)` holds for any of `change.paths`. It saves and fires only when the set changed.
  - Every save writes the whole sorted array, `[]` included.
  - `onChanged` listeners run synchronously, in the order they subscribed, after the save. `dispose` removes that one
    listener.
  - `ids()` returns the live set as `ReadonlySet<string>`; callers read it and never change it.
- Header comment of `starred-docs.ts`: "The user's starred docs, by entry id, kept in the docs plugin's `uiState`
  under `starred` and shared by every docs view on the page. An in-app rename carries a star to the new path; an
  in-app trash drops the stars of what it removed; a starred doc that leaves the index another way keeps its star."
- Tests use a fake `UiState` over a `Map` built in the test file (the page layer may not import `src/renderer`).

GIVEN `elapsed` under a minute, or a time ahead of `now` WHEN `loadedAgo` THEN `now`
GIVEN each threshold WHEN `loadedAgo` THEN the floor in the unit below it, and the next unit at the threshold
GIVEN 56 days or more in the same local year WHEN `loadedAgo` THEN `Mar 3`; in another year THEN `Mar 3, 2025`
GIVEN each form WHEN `loadedLine` THEN `Loaded just now`, `Loaded 3h ago`, `Loaded Mar 3`
GIVEN no saved value, or a value of another shape WHEN the set is created THEN it is empty
GIVEN a set WHEN `toggle` adds or removes an id THEN the sorted array is saved and `onChanged` fires once
GIVEN a rename of a file, a folder, or a file holding items WHEN `applyChange` THEN each id at or inside it moves
GIVEN a trash WHEN `applyChange` THEN every id at or inside any trashed path goes
GIVEN a create, or a rename that reaches no id WHEN `applyChange` THEN nothing is saved and nothing fires

Tests:     in `loaded-time.test.ts`, with `NOW = Date.parse('2026-06-01T12:00:00Z')` and `ago(ms)` giving
           `new Date(NOW - ms).toISOString()`:
           `loadedAgo_UnderAMinute_Now` — `ago(0)` and `ago(59_999)` → `'now'`
           `loadedAgo_AheadOfClock_Now` — `ago(-5_000)` → `'now'`
           `loadedAgo_Minutes_Floor` — `ago(60_000)` → `'1m'`; `ago(3_599_999)` → `'59m'`
           `loadedAgo_Hours_Floor` — `ago(3_600_000)` → `'1h'`; `ago(86_399_999)` → `'23h'`
           `loadedAgo_Days_Floor` — `ago(86_400_000)` → `'1d'`; `ago(7 * 86_400_000 - 1)` → `'6d'`
           `loadedAgo_Weeks_Floor` — `ago(7 * 86_400_000)` → `'1w'`; `ago(56 * 86_400_000 - 1)` → `'7w'`
           `loadedAgo_EightWeeks_Date` — `ago(56 * 86_400_000)` (`2026-04-06T12:00:00.000Z`) → `'Apr 6'`
           `loadedAgo_SameYear_MonthAndDay` — `'2026-03-03T12:00:00Z'` → `'Mar 3'`
           `loadedAgo_OtherYear_WithYear` — `'2025-03-03T12:00:00Z'` → `'Mar 3, 2025'`
           `loadedLine_Now_JustNow` — `ago(1_000)` → `'Loaded just now'`
           `loadedLine_Relative_Ago` — `ago(3 * 3_600_000)` → `'Loaded 3h ago'`; `ago(5 * 7 * 86_400_000)` → `'Loaded 5w ago'`
           `loadedLine_Date_NoAgo` — `'2026-03-03T12:00:00Z'` → `'Loaded Mar 3'`; `'2025-03-03T12:00:00Z'` →
             `'Loaded Mar 3, 2025'`
           in `page/starred-docs.test.ts` (POSIX paths, `posixPaths`):
           `createStarredDocs_NoValue_Empty` — `[...ids()]` is `[]`
           `createStarredDocs_SavedIds_Read` — saved `['/r/b.md', '/r/a.md']`: `has('/r/a.md')` and `has('/r/b.md')` true
           `createStarredDocs_OtherShape_Empty` — for each of `'x'`, `{ a: 1 }`, `[1, '/r/a.md']`, `null`: `[...ids()]` is
             `[]` and no `set` call was made
           `toggle_Absent_AddsAndSavesSorted` — saved `['/r/b.md']`, `toggle('/r/a.md')`: the last saved value is
             `['/r/a.md', '/r/b.md']`; the listener ran once
           `toggle_Present_RemovesAndSavesEmpty` — saved `['/r/a.md']`, `toggle('/r/a.md')`: `has('/r/a.md')` false; the
             last saved value is `[]`
           `onChanged_Disposed_NotCalled` — a listener disposed before `toggle` is not called
           `applyChange_RenamedFile_MovesId` — `['/r/a.md']`, `{ type: 'renamed', from: '/r/a.md', to: '/r/b.md' }`:
             saved `['/r/b.md']`; the listener ran once
           `applyChange_RenamedFolder_MovesIdsInside` — `['/r/skills/s/SKILL.md', '/r/skills/s/ref.md', '/r/other.md']`,
             from `/r/skills/s` to `/r/skills/t`: saved `['/r/other.md', '/r/skills/t/SKILL.md', '/r/skills/t/ref.md']`
           `applyChange_RenamedFileWithItems_MovesItemIds` — `['/f/followups.md#L3']`, from `/f/followups.md` to
             `/f/later.md`: saved `['/f/later.md#L3']`
           `applyChange_RenameReachesNoId_NothingSaved` — `['/r/a.md']`, from `/r/x.md` to `/r/y.md`: no `set` call; the
             listener did not run
           `applyChange_Trashed_DropsIdsAtOrInside` — `['/r/a.md', '/r/s/SKILL.md', '/f/followups.md#L3', '/r/keep.md']`,
             `{ type: 'trashed', paths: ['/r/a.md', '/r/s', '/f/followups.md'] }`: saved `['/r/keep.md']`
           `applyChange_Created_Nothing` — a `created` change: no `set` call; the listener did not run
           in `page/docs-state.test.ts`:
           `movedEntryId_FileItself_ToPath` — `('/r/a.md', '/r/a.md', '/r/b.md')` → `'/r/b.md'`
           `movedEntryId_ItemOfFile_KeepsSuffix` — `('/f/followups.md#L3', '/f/followups.md', '/f/later.md')` →
             `'/f/later.md#L3'`
           `movedEntryId_InsideFolder_Joined` — `('/r/s/ref/x.md', '/r/s', '/r/t')` → `'/r/t/ref/x.md'`
           `movedEntryId_Outside_Null` — `('/r/a.md', '/r/x.md', '/r/y.md')` → `null`; `('/r/a.mdx', '/r/a.md', '/r/b.md')`
             → `null`
           `isEntryIdInside_AtInsideItemOutside` — `('/r/a.md', '/r/a.md')` true; `('/r/s/x.md', '/r/s')` true;
             `('/f/followups.md#L3', '/f/followups.md')` true; `('/r/ab.md', '/r/a')` false
           `movedEntryId_WindowsItemOtherCase_Moves` and `isEntryIdInside_WindowsItemOtherCase_True` — the two
             Windows cases in Decisions, with the Windows `Paths` adapter
Done when: `npm run typecheck` passes; `npm test -- src/plugins/docs` passes with every test above, the existing
           `applyChange` rename tests unchanged (`npx` is denied on this machine); `npm run lint` passes, its layer check
           with no new `LAYERS` entry
Commit:    one commit for the group, in wigley-ai-gui, committed by path only (peer sessions may have uncommitted edits)

## Proof

