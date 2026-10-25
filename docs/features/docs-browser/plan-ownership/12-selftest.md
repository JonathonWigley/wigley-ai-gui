# 12 — Self-test steps

Status: not started
Type: Task
Wave: 5 · Depends on: 11
Plan: [plan.md](plan.md)
Repo: wigley-ai-gui

Files:     modify `src/plugins/docs/main/selftest-fixture.ts` · `src/plugins/docs/main/selftest-script.ts`
           test `src/plugins/docs/main/selftest-fixture.test.ts`
Consumes:  the schema 3 fixture (`schemaVersion: 3`, `owner` on every entry, `loadedPlugins` on every context) ← 06
           `buildTree` roots and ids (`Mine`, `Third-party`, `Synced skills`, Mine's `Plugins` right after Global) ← 10
           `defaultExpandedIds` (Mine and its children expanded, Third-party collapsed) ← 11
           log line `[docs] refused to edit <file name>, a downloaded copy` ← 11
           the tree view's log lines `[docs] selected <title>`, `[docs] expanded <title>`, `[docs] collapsed <title>`,
           `[docs] opened <file name>`, `[docs] doc focused`, `[docs] tree focused` (the tree already holds them)
Produces:  the self-test group `ownership` in `src/plugins/docs/main/selftest-script.ts`
           fixture paths `syncedSkill` and `vendorSkill` in `fixturePaths` in `src/plugins/docs/main/selftest-fixture.ts`
Decisions:
- Synced skill, pinned by lead: a skill under the temp home's `~/.claude/skills/synced/<bucket>/` with
  `owner: 'third-party'`. Decided: path `.claude/skills/synced/selftest-bucket/synced-demo/SKILL.md`, text
  `---\nname: synced-demo\ndescription: A synced skill.\n---\n\n# Synced demo\n`; entry `kind: 'skill'`,
  `source: 'global'`, `owner: 'third-party'`, `repo`, `root` and `plugin` null, `title: 'synced-demo'`,
  `meta: { name: 'synced-demo', description: 'A synced skill.' }`.
- Third-party plugin install, pinned by lead. Decided: install folder
  `.claude/plugins/cache/vendor-market/vendor-plugin/2.0.0`, one skill `skills/vendored/SKILL.md` in it, text
  `---\nname: vendored\ndescription: A third-party plugin skill.\n---\n\n# Vendored\n`; entry `kind: 'skill'`,
  `source: 'plugin'`, `owner: 'third-party'`, `root` the install folder, `plugin: 'vendor-plugin@vendor-market'`,
  `title: 'vendored'`, `meta: { name: 'vendored', description: 'A third-party plugin skill.' }`.
  `installed_plugins.json` does not change: no step opens this plugin's detail view, and the file's line 3 keeps the
  fixture plugin's key.
- Both new entries go right after the follow-up entry and before the load-state docs, so `sessionDocument`'s
  positions `[0, 1, 4, 5]` still name the same four entries. Both files are in `writeDocsFixture`'s `writes`, so the
  stand-in `docs_index.py`'s `build` keeps both entries (it drops an entry whose file is missing).
- The fixture plugin's two entries (`selftest-plugin@selftest-market`, the `kind: 'plugin'` entry and the `cached`
  skill) are `owner: 'mine'`: installed-only entries whose key no repo carries, so they show under Mine's `Plugins`
  and today's detail-view and plugin-cache steps keep their moves. Decided; 06 sets them so.
- Entry counts: the two new entries add 2 to every machine count. 06 adds no machine entry, so `R` in the doc editor
  group expects `[docs] machine index rebuilt: 10 entries` (today 8) and `R` in trash and rescan expects
  `[docs] machine index rebuilt: 11 entries` (today 9). The session index keeps `4 entries`.
- New steps, pinned by lead, in a group of their own named `ownership`, placed after `plugin cache` and before
  `pickers`. Its `why`: "The tree holds the user's docs under Mine and downloaded copies under Third-party, collapsed
  until expanded; Synced skills is Third-party's first node, and i refuses to edit a synced skill as a downloaded
  copy." It starts where `plugin cache` ends (tree focused) and ends with Third-party collapsed again, so the later
  groups' moves hold. Its steps, in order:
  1. keys `['G']`, expect `[docs] selected Third-party`, why "Third-party is the tree's last row."
  2. keys `['l']`, expect `[docs] expanded Third-party`, why "l expands only a collapsed group, so Third-party was
     collapsed."
  3. keys `['l']`, expect `[docs] selected Synced skills`, why "Synced skills is Third-party's first node."
  4. keys `['l']`, expect `[docs] expanded Synced skills`
  5. keys `['j', 'l']`, expect `[docs] expanded Skills`
  6. keys `['j', 'l']`, expect `[docs] opened SKILL.md`, `checksFit: true`, `screenshot: 'third-party'`
  7. keys `['<A-l>']`, expect `[docs] doc focused`
  8. keys `['i']`, expect `[docs] refused to edit SKILL.md, a downloaded copy`
  9. keys `['<A-h>']`, expect `[docs] tree focused`
  10. keys `['h', 'h', 'h', 'h', 'h', 'h']`, expect `[docs] collapsed Third-party`, why "h steps up from the skill
      and collapses each group on the way: Skills, Synced skills, Third-party."
- Existing steps the new tree moves (`Mine` is the first row, Third-party the last), changed and nothing else:
  - doc editor: `{ keys: ['G'], expect: '[docs] selected Features' }` becomes `expect: '[docs] selected Third-party'`.
  - doc editor: `{ keys: ['g', 'g'], expect: '[docs] selected Global' }` becomes `expect: '[docs] selected Mine'`.
  - doc editor: the next step `{ keys: ['j', 'l'], expect: '[docs] expanded Instructions' }` becomes
    `keys: ['j', 'j', 'l']`, why "Mine's first child is Global, expanded, whose first child is Instructions."
  - tree filter: `{ keys: ['g', 'g'], expect: '[docs] selected Global' }` becomes `expect: '[docs] selected Mine'`.
  - tree filter: before `{ keys: ['Enter'], expect: '[docs] selected Rules', … }` a step
    `{ keys: ['Enter'], expect: '[docs] selected Global' }` is added, why "Under a filter Enter steps into Mine's
    first shown child."
  - The group `why` texts stay; `ownership` is added to the returned groups between `plugin cache` and `pickers`.
- Kept as they are, checked against the new tree: the detail views and plugin cache moves (Mine's `Plugins` sits
  where the `Plugins` root sat), the tree filter's `k k j j d` and `h h`, the session Docs tab steps (its four
  entries are all Mine), and Docs mode from a session's `j j j j r` (under the `neat` filter the rows are Mine,
  Global, Rules and `neat.md`, and the selection, Third-party, is not among them, so the first `j` takes the first
  row and the fourth reaches `neat.md`).
- Git statuses are not in the self-test, pinned by lead: 08's unit tests cover them, and task 14 checks them live.
  The fixture has no marketplace clone, so its `pluginStatus` replies hold no clone.

GIVEN the fixture WHEN the index fixture is read back THEN it lists the synced skill and the vendored skill, both
      `owner: 'third-party'`, and the fixture plugin's entries `owner: 'mine'`
GIVEN Docs mode after `R` WHEN `G` and `l` are pressed THEN Third-party was the last row and expands from collapsed
GIVEN Third-party expanded WHEN `l` is pressed THEN Synced skills is selected
GIVEN the synced skill open WHEN `i` is pressed in the doc THEN the log says `refused to edit SKILL.md, a downloaded copy`
GIVEN the ownership group's end WHEN the later groups run THEN Third-party is collapsed and their moves hold
Tests:     `GIVEN the fixture WHEN the index fixture is read back THEN it holds a synced skill and a third-party plugin
           skill, both owner third-party` — `writeDocsFixture(files, '/home', posixPaths)`, then the index fixture
           holds `expect.objectContaining({ path: '/home/.claude/skills/synced/selftest-bucket/synced-demo/SKILL.md',
           kind: 'skill', source: 'global', owner: 'third-party' })` and `expect.objectContaining({ path:
           '/home/.claude/plugins/cache/vendor-market/vendor-plugin/2.0.0/skills/vendored/SKILL.md', kind: 'skill',
           source: 'plugin', owner: 'third-party', plugin: 'vendor-plugin@vendor-market' })`, and both files exist
           `GIVEN the fixture WHEN the index fixture is read back THEN the fixture plugin's entries are owner mine` —
           every entry with `plugin: 'selftest-plugin@selftest-market'` has `owner: 'mine'`
           `GIVEN the fixture WHEN the session fixture is read back THEN it lists the same four entries` — the
           session fixture's entry paths are the CLAUDE.md, style rule, repo AGENTS.md and demo skill paths, in
           that order
Done when: `npm run typecheck` passes; `npx vitest run src/plugins/docs/main/selftest-fixture.test.ts` passes with the
           tests above; `npm run lint` passes. `npm run selftest` with the docs groups runs in task 14 (check 4).
Commit:    one commit for the group, in wigley-ai-gui, committed by path only (peer sessions have uncommitted edits)

## Proof
