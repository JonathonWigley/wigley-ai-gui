# 08 — Self-test steps

Status: not started
Type: Task
Wave: 4 · Depends on: 07
Plan: [plan.md](plan.md)
Repo: wigley-ai-gui

Files:     modify `src/plugins/docs/main/selftest-fixture.ts` (one entry's `lastLoaded` value only) ·
           `src/plugins/docs/main/selftest-script.ts`
           test `src/plugins/docs/main/selftest-fixture.test.ts`
Consumes:  the schema 4 fixture: `schemaVersion: 4`, `lastLoaded: null` as the `entry()` helper's default, the stand-in
           script writing `"lastLoaded": None` ← 04
           recency order inside a kind group (loaded docs first, never-loaded after by title), the Starred root titled
           `Starred` above Mine ← 05
           log lines `[docs] starred <entry title>` and `[docs] unstarred <entry title>`; key `s` in `docs.tree`; a
           Starred group that shows in a later tree starts expanded (round 3) ← 07
           the tree view's log lines `[docs] selected <title>`, `[docs] expanded <title>`, `[docs] collapsed <title>`
           (exist)
Produces:  the self-test group `recency and stars` in `src/plugins/docs/main/selftest-script.ts`
           `lastLoaded: '2026-10-18T12:00:00.000Z'` on the style rule entry in `src/plugins/docs/main/selftest-fixture.ts`
Decisions:
- Fixture values only (04 owns the schema change): the style rule entry (`fixture.styleRule`, title `Style`) gets
  `lastLoaded: '2026-10-18T12:00:00.000Z'`. Every other entry stays never loaded. Decided: Global's Rules group holds
  `Style` and, by the time the new group runs, the never-loaded `neat.md` the earlier steps created (`fresh.md` is
  trashed by then). By title `neat.md` comes first; by recency `Style` does, so one step proves the order. No new
  entry is added, so every entry count in the script holds (`10 entries`, `11 entries`, `4 entries`).
- The time does not move any existing step. Checked against each step that reads Rules or its rows: `create and
  rename` and `trash and rescan` select their docs by id; `tree filter`'s rows under `neat` are Mine, Global, Rules
  and `neat.md` (`Style` does not match `neat`); the session tab's `style` filter and Docs mode from a session's
  `neat` filter read the same rows as today; `detail views` starts with Rules collapsed.
- The session fixture's entries are machine entries 0, 1, 4 and 5 (`sessionDocument`), the style rule among them, so
  the session index carries the same time. No session step reads it.
- New group, pinned by lead, named `recency and stars`, placed after `tree filter` and before `detail views`. It
  starts where `tree filter` ends (Rules collapsed and selected, tree focused) and ends the same way, so `detail
  views`' moves hold. Its `why`: "Rules lists its loaded doc before a never-loaded one that comes first by title; s
  stars a doc into a Starred group above Mine, shown expanded and starred in both places, and s on its usual row
  unstars it and removes the group." Its steps, in order:
  1. keys `['l']`, expect `[docs] expanded Rules`
  2. keys `['l']`, expect `[docs] selected Style`, why "Style was loaded and neat.md never was, so Style leads Rules
     though neat.md comes first by title."
  3. keys `['s']`, expect `[docs] starred Style`, `checksFit: true`, `screenshot: 'starred'`, why "The screenshot shows
     the star on both Style rows and Style's time at its row's end."
  4. keys `['g', 'g']`, expect `[docs] selected Starred`, why "The Starred group shows above Mine."
  5. keys `['l']`, expect `[docs] selected Style`, why "A Starred group that first shows starts expanded, and it holds
     Style."
  6. keys `['j', 'j', 'j', 'j', 'j', 'j', 's']`, expect `[docs] unstarred Style`, why "Six rows down from Starred's
     Style are Mine, Global, Instructions, CLAUDE.md, Rules, then Style in its usual place."
  7. keys `['g', 'g']`, expect `[docs] selected Mine`, why "Unstarring the only starred doc removes the Starred group."
  8. keys `['j', 'j', 'j', 'j', 'h']`, expect `[docs] collapsed Rules`, why "Global, Instructions, CLAUDE.md, then
     Rules; h collapses it, where detail views starts."
- Row counts in steps 6 and 8 rest on the expansions earlier groups leave: `doc editor` expands Instructions (`j j l`)
  and nothing collapses it before this group. The implementer re-reads the groups before `tree filter` to confirm
  this. The self-test run in task 10 proves it.
- The star set lives in the self-test's temp home (`ui-state.json` under it, `src/main/main.ts` `uiStateFilePath`), so
  every self-test run starts with no star. The group ends with none, so later groups see no Starred row.
- No step for `s` on a group row: it logs nothing, and a step needs an expected line. The page log's
  `[page] s ran docs.toggleStar` would pass whatever the handler did.
- The group is added to the returned list between `tree filter` and `detail views`. No other group changes.

GIVEN the fixture WHEN the index fixture is read back THEN the style rule alone carries a last-loaded time
GIVEN Rules expanded after `tree filter` WHEN `l` steps in THEN `Style` is selected before `neat.md`
GIVEN Style selected WHEN `s` THEN the log says `starred Style` and `g g` selects `Starred`
GIVEN Style's usual row WHEN `s` THEN the log says `unstarred Style` and `g g` selects `Mine`
GIVEN the group's end WHEN `detail views` runs THEN Rules is collapsed and selected, as today

Tests:     in `main/selftest-fixture.test.ts`:
           `GIVEN the fixture WHEN the index fixture is read back THEN the style rule alone carries a last-loaded time` —
             `writeDocsFixture(files, '/home', posixPaths)`, then the index fixture's entry with path
             `/home/.claude/rules/style.md` has `lastLoaded` `'2026-10-18T12:00:00.000Z'`, and every other entry's
             `lastLoaded` is `null`
           The steps themselves run in `npm run selftest`, in task 10.
Done when: `npm run typecheck` passes; `npm test -- src/plugins/docs/main/selftest-fixture.test.ts` passes with the test
           above (`npx` is denied on this machine); `npm run lint` passes. `npm run selftest` with the docs groups runs
           in task 10.
Commit:    one commit for the group, in wigley-ai-gui, committed by path only (peer sessions may have uncommitted edits)

## Proof

