# 09 — Write guard and create places by owner

Status: not started
Type: Task
Wave: 3 · Depends on: 06
Plan: [plan.md](plan.md)
Repo: wigley-ai-gui

Files:     modify `src/plugins/docs/path-guard.ts` · `src/plugins/docs/main/doc-files.ts` · `src/plugins/docs/kinds.ts`
           test `src/plugins/docs/path-guard.test.ts` · `src/plugins/docs/main/doc-files.test.ts` ·
           `src/plugins/docs/kinds.test.ts`
Consumes:  `IndexEntry.owner: DocOwner` ← 06 (`contract.ts`); `readClaudeConfigDirs` in `main/script-locator.ts`
           and `realTarget` in `main/doc-files.ts` (exist)
Produces:  `thirdPartyFolders: readonly string[];` (member of `GuardFolders`) in `src/plugins/docs/path-guard.ts`
           `is a downloaded copy (` (the refusal text) in `src/plugins/docs/path-guard.ts`
           `entry.owner === 'third-party'` (the `placesFor` skip) in `src/plugins/docs/kinds.ts`
Decisions: - `GuardFolders.thirdPartyFolders` holds `<config folder>/skills/synced` for each Claude config folder, as a real
             path. `guardFolders` in `main/doc-files.ts` builds it from the same `readClaudeConfigDirs` list as
             `pluginCaches`, through `realTarget`, and drops none (pinned by lead).
           - `changeRefusal` checks, in this order (order Decided):
             1. A target `paths.samePath` to the `path` of an entry with `owner: 'third-party'` →
                `Refused: <target> is a downloaded copy (<entry.plugin>)`, or `(synced skill)` when `entry.plugin` is null.
             2. A target `paths.isInside` a `thirdPartyFolders` folder → `Refused: <target> is a downloaded copy (synced skill)`.
             3. The two plugin cache rules, unchanged: `is inside the plugin cache of <plugin>`, then
                `is inside the plugin cache <cache>`.
             4. The allow rules, unchanged.
             The text is pinned by lead. Rule 1 comes first so a third-party plugin's own file names its plugin key
             as a downloaded copy; a new file inside a third-party plugin's root, which no entry names, still gets the
             cache refusal.
           - An installed-only entry (`source: 'plugin'`, `owner: 'mine'`) keeps the cache refusal, unchanged (pinned
             by lead).
           - `isIndexedPath` is unchanged: third-party docs stay readable and their links open (pinned by lead).
           - `placesFor` skips every entry with `owner: 'third-party'`, so no create place comes from a synced skill
             or a third-party plugin (pinned by lead). Its comment says so.
           - The `changeRefusal`, `GuardFolders` and `guardFolders` comments name the new rule and folders.
           - The page's own read-only handling (the `i`, rename and delete refusals and the read-only line) is task 11.
GIVEN a target inside `~/.claude/skills/synced/` WHEN a write, create, rename or trash is asked THEN it is refused as a downloaded copy (synced skill)
GIVEN a target inside a second config folder's `skills/synced/` WHEN written THEN it is refused the same way
GIVEN the path of a third-party plugin entry WHEN written THEN it is refused as a downloaded copy naming the plugin key
GIVEN a link `~/.claude/skills/pdf` to a synced skill folder WHEN its `SKILL.md` is trashed THEN neither the target nor the link moves
GIVEN `~/.claude/skills/mine/SKILL.md` or `~/.claude/skills/syncedx/SKILL.md` WHEN written THEN it is allowed
GIVEN an installed-only plugin file WHEN written THEN it is refused as inside the plugin cache of its plugin, as today
GIVEN a third-party entry WHEN a link to it is checked THEN `isIndexedPath` is true
GIVEN a synced skill and a mine skill WHEN the skill create places are listed THEN only the mine skill's folder is offered
Tests:     in `path-guard.test.ts` (`FOLDERS` gains `thirdPartyFolders: ['/Users/u/.claude/skills/synced',
           '/Users/u/.claude-personal/skills/synced']`; `NO_FOLDERS` gains `thirdPartyFolders: []`):
           `changeRefusal_InsideSyncedSkills_RefusedAsSyncedSkill` — `/Users/u/.claude/skills/synced/anthropic/pdf/SKILL.md` →
             `Refused: /Users/u/.claude/skills/synced/anthropic/pdf/SKILL.md is a downloaded copy (synced skill)`
           `changeRefusal_SecondConfigFolderSynced_Refused` — `/Users/u/.claude-personal/skills/synced/b/x.md` →
             `Refused: /Users/u/.claude-personal/skills/synced/b/x.md is a downloaded copy (synced skill)`
           `changeRefusal_ThirdPartyPluginEntry_RefusedNamingPlugin` — entry `owner: 'third-party'`, `source: 'plugin'`,
             `plugin: 'q@n'`, `root: '/Users/u/.claude/plugins/cache/n/q/2'`, path `…/2/skills/s/SKILL.md` → that path
             `is a downloaded copy (q@n)`, prefixed `Refused: `
           `changeRefusal_ThirdPartyEntryNoPlugin_SyncedSkill` — entry `owner: 'third-party'`, `source: 'global'`, path
             `/Users/u/notes/synced.md`, folders with `thirdPartyFolders: []` →
             `Refused: /Users/u/notes/synced.md is a downloaded copy (synced skill)`
           `changeRefusal_BesideSynced_Allowed` — `/Users/u/.claude/skills/mine/SKILL.md` and
             `/Users/u/.claude/skills/syncedx/SKILL.md` → null
           `changeRefusal_InsidePluginCache_RefusedNamingPlugin` — unchanged (its entry is `owner: 'mine'`)
           `changeRefusal_WindowsSyncedOtherCase_Refused` — folders `thirdPartyFolders: ['C:\\Users\\u\\.claude\\skills\\synced']`,
             target `c:\\users\\u\\.claude\\skills\\synced\\a\\SKILL.md` →
             `Refused: c:\\users\\u\\.claude\\skills\\synced\\a\\SKILL.md is a downloaded copy (synced skill)`
           `isIndexedPath_ThirdPartyEntry_Openable` — the `q@n` entry's path → true
           in `doc-files.test.ts`:
           `write_InsideSyncedSkills_RejectsAsDownloadedCopy` — `write('/Users/u/.claude/skills/synced/anthropic/pdf/SKILL.md', 'b', null)`
             rejects `Refused: /Users/u/.claude/skills/synced/anthropic/pdf/SKILL.md is a downloaded copy (synced skill)`;
             the file's `stat` is null
           `write_SecondConfigFolderSynced_Rejects` — config `{"claudeConfigDirs":["~/.claude","~/.claude-personal"]}` at
             `/Users/u/.agents/wigley-docs/config.json`; `write('/Users/u/.claude-personal/skills/synced/b/s/SKILL.md', …)` rejects
             `Refused: /Users/u/.claude-personal/skills/synced/b/s/SKILL.md is a downloaded copy (synced skill)`
           `trash_LinkToSyncedSkill_RefusedTrashesNeither` — target `/Users/u/.claude/skills/synced/anthropic/pdf` holding
             `SKILL.md`, link `/Users/u/.claude/skills/pdf` to it (`withLinks`); `trash('/Users/u/.claude/skills/pdf/SKILL.md')`
             rejects `Refused: /Users/u/.claude/skills/synced/anthropic/pdf is a downloaded copy (synced skill)`; the
             link map is unchanged and the target's `SKILL.md` still reads `skill`
           in `kinds.test.ts`:
           `placesFor_ThirdPartyEntries_NoPlace` — entries `/Users/u/.claude/skills/synced/anthropic/pdf/SKILL.md`
             (`kind: 'skill'`, `owner: 'third-party'`) and `/Users/u/.claude/skills/a/SKILL.md` (`kind: 'skill'`) →
             `[{ title: 'Global · ~/.claude/skills', folder: '/Users/u/.claude/skills', source: 'global' }]`
Done when: `npm run typecheck`, `npm test` and `npm run lint` pass. The page's read-only line and key refusals: task 11;
           live check: task 14.
Commit:    one commit for the group, in wigley-ai-gui, committed by path only (peer sessions have uncommitted edits)

## Proof

