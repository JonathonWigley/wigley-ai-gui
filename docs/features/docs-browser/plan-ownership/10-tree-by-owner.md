# 10 — Tree by owner

Status: done
Type: Task
Wave: 3 · Depends on: 06
Plan: [plan.md](plan.md)
Repo: wigley-ai-gui

Files:     modify `src/plugins/docs/tree.ts` · test `src/plugins/docs/tree.test.ts`
Consumes:  `IndexEntry.owner: DocOwner` ← 06 · `DocKind` member `'skill-file'` ← 06 · `DOC_KINDS` holding
           `'skill-file'` right after `'skill'` ← 06 (it mirrors `model.py`'s `KINDS`) · `metaString(entry, key)` in
           `src/plugins/docs/index-document.ts` (the tree already holds it) · `tree.test.ts`'s `entry()` helper with
           an `owner` field ← 06
Produces:  `export const MINE_ROOT_ID = 'owner:mine';` in `src/plugins/docs/tree.ts`
           `export const THIRD_PARTY_ROOT_ID = 'owner:third-party';` in `src/plugins/docs/tree.ts`
           `export function buildTree(entries: readonly IndexEntry[], homeDir: string, paths: Paths): TreeNode[]` in
           `src/plugins/docs/tree.ts` (signature unchanged; roots by owner)
           `'skill-file': 'Skill files'` in `KIND_TITLES` in `src/plugins/docs/tree.ts`
Decisions:
- Roots, pinned by lead: `Mine` (id `owner:mine`), then `Third-party` (id `owner:third-party`). Each is left out when
  it has no entries. An entry is Mine when `owner === 'mine'`, Third-party when `owner === 'third-party'`.
- Mine children, pinned by lead: Global (id `global`), then the repo nodes (`repo:<name>`, clone split as today),
  then the unknown sources (`source:<source>`).
- The Mine `Plugins` node (id `owner:mine/plugins`) sits right after Global, before the repo nodes. Decided: it is
  today's place of the `Plugins` root, so the self-test's relative tree moves keep working (task 12).
- A Mine `Plugins` child per plugin key has id `owner:mine/plugins/<key>` and title the key. Its children are kind
  groups, as today. Decided: today's `plugins/<key>` id moved under its new parent.
- An owned plugin key "is carried by a repo" when some Mine entry with `source: 'repo'` has that `plugin` key.
  Installed-only entries (`source: 'plugin'`, `owner: 'mine'`) of a carried key go to the plugin node of the first
  repo, in repo order, whose clone entries carry it; inside a split repo, to the first clone node, in clone order,
  whose entries carry it. Decided: the index merges an install into "the first such clone in walk order", and a leaf
  id must stay unique, so each installed-only entry shows once.
- A repo node's children, pinned by lead: the kind groups of its entries with `plugin === null`, then one node per
  plugin key among its entries (id `<repoId>/plugin:<key>`, title the key), then the Features node. A plugin node
  holds that plugin's kind groups (its clone entries plus the installed-only `kind: 'plugin'` entries of that key),
  then an `Installed only` node (id `<pluginNodeId>/installed`). The Installed only node holds the other
  installed-only entries of that key, as kind groups (ids `<pluginNodeId>/installed/<kind>`). It is left out when
  it has none. Decided: kind groups inside Installed only, the same shape as every other leaf container.
- With a clone split, pinned by lead: the plugin-key nodes sit inside each clone node (ids
  `repo:<name>/clone:<root>/plugin:<key>`). The Features node stays on the repo node, after the clone nodes.
- Third-party children, pinned by lead: `Synced skills` (id `owner:third-party/synced`; the kind groups of the
  third-party entries with `source !== 'plugin'`), then one node per plugin key of the third-party
  `source: 'plugin'` entries (id `owner:third-party/plugin:<key>`, title the key, kind groups), keys in
  `compareTitles` order.
- Skill groups, pinned by lead, in every kind group: a `skill` entry is a group when the same entry list holds
  `skill-file` entries whose `meta.skill` is the skill's id. The group's id is `skill:<entryId>`, its title the
  skill's title. It holds the SKILL.md leaf first, titled `SKILL.md`, then its skill-file leaves sorted by
  `byTitleThenId`. Those skill-file entries are not listed again. A skill-file whose skill is not in the same list
  goes in the `Skill files` kind group (id `<parentId>/skill-file`).
- The SKILL.md leaf keeps id `entry:<entryId>`; only its title becomes `SKILL.md`. A skill group sorts among the
  Skills group's leaves by the skill's title with `byTitleThenId`. Decided: the group takes the leaf's place.
- A group's `folder` comes from the entries it stands for, without the installed copies. A repo node and a clone
  node take the common folder of their `repo` and `features` entries only. A plugin node takes it from its clone
  entries only. An Installed only node takes it from its own entries. Decided: an installed copy sits in the plugin
  cache, on another drive on this machine, which makes the common folder `null` and leaves `A` with no start
  folder.
- `KIND_TITLES['skill-file']` is `'Skill files'` (pinned by lead). 06 adds `'skill-file'` to `DocKind`, so 06's
  commit may already hold this key to keep the typecheck green; if it does not, this task adds it.
- Ids stay stable across rebuilds, and every ordering rule of today holds: `compareTitles` for keys, repos, clones
  and plugin keys; `byTitleThenId` for leaves; `DOC_KINDS` order, then unknown kinds by id.
- `buildTree`'s doc comment says (replace today's): "Two roots by owner: Mine (`owner:mine`), holding Global, the
  user's installed-only plugins without a clone (`owner:mine/plugins`), one node per repo and one node per source
  the app does not know; then Third-party (`owner:third-party`), holding Synced skills and one node per plugin. A
  repo holds its kind groups, then one node per plugin of a marketplace clone (its kind groups, then Installed
  only), then Features. A root with no entries is left out."

GIVEN entries of both owners WHEN `buildTree` runs THEN the roots are `Mine`, `Third-party`, ids `owner:mine`,
      `owner:third-party`
GIVEN no third-party entry WHEN `buildTree` runs THEN the only root is `Mine`; GIVEN only third-party entries THEN the
      only root is `Third-party`
GIVEN Mine global, installed-only (key no repo carries), repo and unknown-source entries WHEN `buildTree` runs THEN
      Mine's children are Global, Plugins, the repos, then the unknown sources
GIVEN a repo whose clone entries carry plugin key `w@m` WHEN `buildTree` runs THEN the repo holds its `plugin === null`
      kind groups, then node `repo:<name>/plugin:w@m`, then Features
GIVEN installed-only entries of a carried key WHEN `buildTree` runs THEN a `kind: 'plugin'` one sits in the plugin
      node's `Plugins` kind group and the rest in its `Installed only` node, after the plugin node's kind groups
GIVEN a split repo WHEN `buildTree` runs THEN each clone node holds its own plugin nodes, and installed-only entries
      go to the first clone carrying their key
GIVEN third-party synced and plugin entries WHEN `buildTree` runs THEN Third-party holds `Synced skills`, then one node
      per plugin key
GIVEN a skill with skill-file entries in the same list WHEN `buildTree` runs THEN they form group `skill:<entryId>`,
      SKILL.md first, files by title, and no `Skill files` group shows
GIVEN a skill-file whose skill is not in its list WHEN `buildTree` runs THEN it sits in the `Skill files` kind group
Tests:     every existing `buildTree` test reads its groups under Mine through a helper `mineChildren(entries)`
           (`child(buildTree(entries, HOME, posixPaths), 'Mine').children`; the Windows tests pass their home and
           `windowsPaths`). Their other assertions stay. `buildTree_AllSources_RootsInOrder` becomes
           `buildTree_MineChildren_GlobalPluginsReposUnknownSources` below.
           `buildTree_BothOwners_MineThenThirdParty` — a Mine global rule and a third-party plugin skill (`v@m`):
           root titles `['Mine', 'Third-party']`, ids `['owner:mine', 'owner:third-party']`
           `buildTree_NoThirdParty_OnlyMine` — one Mine global rule: root titles `['Mine']`
           `buildTree_OnlyThirdParty_OnlyThirdPartyRoot` — one third-party plugin skill: root titles `['Third-party']`
           `buildTree_MineChildren_GlobalPluginsReposUnknownSources` — a global rule; an installed-only skill
           (`source: 'plugin'`, `owner: 'mine'`, plugin `p@m`, root `/Users/u/.claude/plugins/cache/m/p/1`); repos
           `zeta` and `Alpha`; unknown sources `scratch` and `my_notes`: Mine's child titles
           `['Global', 'Plugins', 'Alpha', 'zeta', 'My notes', 'Scratch']`; Plugins id `owner:mine/plugins`, its one
           child id `owner:mine/plugins/p@m`, title `p@m`
           `buildTree_MarketplaceClone_PluginNodeBetweenKindsAndFeatures` — repo `m` (root `/Users/u/dev/m`):
           `AGENTS.md` (plugin null), skill `/Users/u/dev/m/plugins/w/skills/f/SKILL.md` (plugin `w@m`), and a
           feature-home follow-up: repo child ids `['repo:m/instructions', 'repo:m/plugin:w@m', 'repo:m/features']`;
           the plugin node's title `w@m`, its child ids `['repo:m/plugin:w@m/skill']`
           `buildTree_InstalledOnly_KindPluginInNodeRestInInstalledOnly` — that repo plus an installed-only skill
           (plugin `w@m`, root `/Users/u/.claude/plugins/cache/m/w/1`) and an installed-only `kind: 'plugin'` entry
           (plugin `w@m`, title `w@m`): plugin node child ids `['repo:m/plugin:w@m/skill', 'repo:m/plugin:w@m/plugin',
           'repo:m/plugin:w@m/installed']`; the Installed only node's title `Installed only`, its child ids
           `['repo:m/plugin:w@m/installed/skill']`; the plugin node's `folder` is `/Users/u/dev/m/plugins/w/skills/f`
           `buildTree_InstalledOnly_NoMinePluginsNode` — the same entries: Mine's child titles hold no `Plugins`
           `buildTree_TwoClonesCarryKey_PluginNodesInClonesInstalledOnlyInFirst` — repo `m` cloned at `/Users/u/dev/m`
           and `/Users/u/work/m`, each with a `w@m` skill, and one installed-only `w@m` skill: clone
           `repo:m/clone:/Users/u/dev/m` holds `repo:m/clone:/Users/u/dev/m/plugin:w@m`, whose children end with
           `repo:m/clone:/Users/u/dev/m/plugin:w@m/installed`; clone `repo:m/clone:/Users/u/work/m`'s plugin node
           holds no `/installed` child
           `buildTree_ThirdParty_SyncedThenPluginsByKey` — third-party entries: a synced skill
           (`source: 'global'`, path `/Users/u/.claude/skills/synced/b/s/SKILL.md`), plugin skills `v@m` and `a@m`:
           Third-party child titles `['Synced skills', 'a@m', 'v@m']`, ids `['owner:third-party/synced',
           'owner:third-party/plugin:a@m', 'owner:third-party/plugin:v@m']`; Synced skills' child ids
           `['owner:third-party/synced/skill']`
           `buildTree_SkillWithFiles_GroupSkillMdFirstThenFilesByTitle` — global skill
           `/Users/u/.claude/skills/s/SKILL.md` (title `s`) and skill-files `/Users/u/.claude/skills/s/zeta.md`
           (title `zeta.md`) and `/Users/u/.claude/skills/s/ref/alpha.md` (title `alpha.md`), each with
           `meta: { skill: '/Users/u/.claude/skills/s/SKILL.md' }`: Global's child titles `['Skills']`; Skills' one
           child is a group with id `skill:/Users/u/.claude/skills/s/SKILL.md` and title `s`; its child titles
           `['SKILL.md', 'alpha.md', 'zeta.md']`, its child ids `['entry:/Users/u/.claude/skills/s/SKILL.md',
           'entry:/Users/u/.claude/skills/s/ref/alpha.md', 'entry:/Users/u/.claude/skills/s/zeta.md']`
           `buildTree_SkillGroupAmongSkills_SortedBySkillTitle` — global skills titled `b` (with one skill-file), `a`
           and `c`: Skills' child titles `['a', 'b', 'c']`; the second child's `type` is `'group'`, the others
           `'entry'`
           `buildTree_OrphanSkillFile_SkillFilesGroup` — one global skill-file whose `meta.skill` names
           `/Users/u/.claude/skills/gone/SKILL.md`, not in the index: Global's child titles `['Skill files']`, id
           `global/skill-file`
           `buildTree_SameIndexTwice_SameIds` — the entries of the clone test above, built twice: the two trees'
           flattened group and leaf ids are equal
Done when: `npm run typecheck` passes; `npx vitest run src/plugins/docs/tree.test.ts` passes with every test above;
           `npm run lint` passes
Commit:    one commit for the group, in wigley-ai-gui, committed by path only (peer sessions have uncommitted edits)

## Lead rulings (cold plan reader)

- The tree test pins Global's child order for the self-test fixture's entries: Instructions, Rules, then Hooks last (task 12's kept moves depend on it).

## Proof

Commit gui bcc3682d · proof: diff read: MINE_ROOT_ID, THIRD_PARTY_ROOT_ID and owner roots in tree.ts; tsc clean per worker, 08 in flight · concerns: design.md lists a skill's files 'by path' while the task pins 'by title' — built by title, design.md for 13's re-read
