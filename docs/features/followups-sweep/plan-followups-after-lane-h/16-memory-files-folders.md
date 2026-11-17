# 16 — Memory Files reports folder events

Status: not started
Type: Task
Rung: standard · one test double reports three more kinds of change; every test that watches it reruns
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Follow-up: **Memory Files folder watch events** (`followups.md` L733).

Files:     modify `src/shared/memory-files.ts` · test `src/shared/memory-files.test.ts`

Preconditions (Lane H tree, 2026-11-17; re-run on merged `main` from the `wigley-ai-gui/` folder):
- `grep -n "madeFolders.add(key);" src/shared/memory-files.ts` → one line, in `makeFolder`, with no `report` call
  after it.
- `grep -n "report(removed);" src/shared/memory-files.ts` → one line, ending `removeKey`: it reports file keys only.
- `grep -n "report(movedContents.flatMap" src/shared/memory-files.ts` → one line, ending `rename`: file keys only.
- The scheduled-tasks plan reads this file (its task 11 builds stores over `createMemoryFiles`) and does not edit it:
  `git diff main...scheduled-tasks-plan --stat -- wigley-ai-gui/src/shared/memory-files.ts` (from the `ai` root,
  before that branch merges) → nothing.

Consumes: nothing from another task.

Produces: no new name. `createMemoryFiles`' watches hear folder keys as well as file keys.

Decisions:
- **Each folder a call makes or takes away is reported, as Node's `fs.watch` names it.** Through `report`, so a
  non-recursive watch hears the top folder's name once and a recursive one hears each path:
  - `makeFolder(path)`: the folders it creates, shallowest first, from the first one missing down to `path`. A folder
    that already existed reports nothing, as a recursive `mkdir` over an existing folder fires no event. Compute the
    list before adding: walk from `key` up with `parentOf` while `statKey(folder) === null`.
  - `removeKey` (`remove` and `trash`): the target when it was a folder (`statKey(target)?.isFolder` read before the
    delete), every made folder at or under it, then the removed files, in one `report` call.
  - `rename`: when `from` is a folder, its key and the new key, plus each made folder moved (old and new keys),
    with the moved files, in one `report` call. The item names `makeFolder` and the `removeKey` callers; `rename` of an
    empty folder is the same gap (it reports nothing today), so it is fixed with them.
- **The header comment** of `MemoryFiles` changes "report each changed file's path" to "report each changed file's
  and folder's path", and names `makeFolder` with the reporting calls.
- **Other tests.** Many plugin tests watch this double. A watch that now also hears a folder key may run its handler
  once more. Run the whole `npm test`; a test that asserted an exact report list or a handler count is updated to the
  new reports only where the extra key is the folder event this change adds. A test that breaks for any other reason
  stops the task and is reported.

GIVEN a recursive watch on `/h` WHEN `makeFolder('/h/a/b')` runs on an empty tree THEN the watch hears `a`, then `a/b`;
a non-recursive watch hears `a` once.
GIVEN `/h/a` exists WHEN `makeFolder('/h/a')` runs THEN no watch hears anything.
GIVEN an empty made folder `/h/e` WHEN `trash('/h/e')` or `remove('/h/e')` runs THEN a recursive watch on `/h` hears
`e`.
GIVEN an empty made folder `/h/e` WHEN `rename('/h/e', '/h/f')` runs THEN the watch hears `e` and `f`.

Tests (in `memory-files.test.ts`):
- `makeFolder_NewNestedFolder_ReportsEachMadeFolder`: recursive watch on `/h`, `makeFolder('/h/a/b')` → reports
  `['a', 'a/b']`; a second, non-recursive watch on `/h` → `['a']`.
- `makeFolder_ExistingFolder_ReportsNothing`: `makeFolder('/h/a')` twice, watch added between → `[]`.
- `it.each` over `trash` and `remove`: `removeEmptyFolder_$method` → reports `['e']`. (Title ends on its variable:
  task 13's rule.)
- `rename_EmptyFolder_ReportsBothNames` → sorted reports `['e', 'f']`.
- `rename_Folder_MovesSubtreeAndReports` (existing): its expected list gains the folder keys: sorted
  `['s', 's/SKILL.md', 's/ref.md', 't', 't/SKILL.md', 't/ref.md']`. The three `watch_NotRecursive_*` tests stay as they
  are.

Done when: compiles (`npm run typecheck`); `npm test` (whole suite, Decisions) green, with
`src/shared/memory-files.test.ts`' new tests among them and the shared `describeFilesContract` rows still green;
`npm run lint` clean.

Commit: one commit for the group, e.g. "Memory Files reports made, removed and renamed folders to its watches
(follow-up: Memory Files folder watch events)"
