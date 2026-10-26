# 05 — Tree order and the Starred group

Status: not started
Type: Task
Wave: 2 · Depends on: 04
Plan: [plan.md](plan.md)
Repo: wigley-ai-gui

Files:     modify `src/plugins/docs/tree.ts` · `src/plugins/docs/page/docs-view.ts` (the one `buildTree` call only)
           test `src/plugins/docs/tree.test.ts`
Consumes:  `lastLoaded: string | null;` (member of `IndexEntry`) in `src/plugins/docs/contract.ts` ← 04
           `tree.test.ts`'s `entry()` helper with `lastLoaded: null` ← 04
Produces:  `export const STARRED_ROOT_ID = 'owner:starred';` in `src/plugins/docs/tree.ts`
           `export function buildTree(entries: readonly IndexEntry[], homeDir: string, paths: Paths, starred: ReadonlySet<string>): TreeNode[]`
           in `src/plugins/docs/tree.ts`
           Starred leaf ids `owner:starred/entry:<entryId>`
Decisions:
- Names and ids are `plan.md` § File Structure word for word (pinned by lead). `starred` holds entry ids. The tree
  module stays pure: the star set enters as data (design review).
- Starred root, pinned by lead (round 1 Q3, design doc § Recency and stars): title `Starred`, id `owner:starred`, the
  first root, above Mine. It shows only when some entry of `entries`, of either owner, has its id in `starred`. A
  starred id no entry holds adds nothing; it stays in the set, hidden until the entry returns (design doc).
- The Starred root's children are leaves only, one per starred entry, never groups. Each leaf has
  `id: \`owner:starred/entry:${entry.id}\``, `title: entry.title`, `entryId: entry.id`. Decided: the `owner:starred/`
  prefix keeps every leaf id unique, so `selectEntry` (`entry:<entryId>`) still finds the usual place, and a starred
  skill shows its skill's title, not `SKILL.md`.
- Each starred entry also stays in its usual place, its leaf unchanged (round 1 Q3).
- The Starred root is built with the file's `group()` helper: `role` is `{ type: 'other' }`, so the page draws no
  rollup on it (design review: counts are not doubled). `folder` is the common folder of its entries, as for any
  group.
- Recency order, pinned by lead (round 1 Q2): inside a group, docs with a time come first, newest first; docs with
  none follow. Times compare as `Date.parse` values, never as text: `2026-10-26T10:00:00Z` and
  `2026-10-26T10:00:00.000Z` are equal (lead: times compare as parsed datetimes). 04's parse refuses a string
  `Date.parse` cannot read.
- Ties and the never-loaded docs keep the group's order of today (design doc: "by title as before"). In a kind group,
  in Starred and inside a skill group, that is `byTitleThenId` (title, then id), as the brief pins. In a feature slug
  node it is `byKindThenTitle`. Decided: a feature folder lists its docs by kind today, and "as before" keeps that
  order for the docs the recency sort does not place.
- Write the order as one comparator factory in `tree.ts`, for example
  `function byLoaded(fallback: (a: IndexEntry, b: IndexEntry) => number)`, used by every sort below. Each node is
  sorted by its time; the fallback compares entries.
- Skill groups, pinned by lead (design doc): a skill group sorts among its siblings in the kind group by the newest
  time of any of its entries (the SKILL.md entry and its skill-file entries); a group with no time sorts with the
  never-loaded docs, by the skill entry's `byTitleThenId`. Inside the group the SKILL.md leaf stays first; the
  skill-file leaves after it sort by `byLoaded(byTitleThenId)`.
- Where the order changes, and nowhere else:
  - `kindGroups`' `nodesOf`: leaves and skill groups, by `byLoaded(byTitleThenId)` on each node's time
  - `skillGroupOrLeaf`: the files after SKILL.md
  - `featuresNode`: the leaves of each slug node, by `byLoaded(byKindThenTitle)`
  - the Starred root's leaves, by `byLoaded(byTitleThenId)`
- Every other group keeps its fixed place (round 1 Q2): the roots, Global, Plugins, repos, clones, plugin keys,
  Installed only, Features, slug nodes, and the kind groups in `DOC_KINDS` order. `groupedBy` and `compareTitles` do
  not change.
- `buildTree`'s doc comment says (replace today's first line): "Up to three roots: Starred (`owner:starred`), listing
  every entry whose id is in `starred`, newest loaded first, when there is one; then two roots by owner: Mine …". Add
  after the comment's last sentence: "Inside every group, docs sort newest loaded first, then the never-loaded ones
  in the group's own order; a skill group sorts by its newest file."
- The one caller, `showDocument` in `page/docs-view.ts`, passes an empty set in this task:
  `buildTree(next?.entries ?? [], deps.homeDir, deps.paths, new Set<string>())`. Task 07 hands it the page's star set
  (`deps.starred.ids()`). No other code calls `buildTree` (grep at plan time: `tree.test.ts` and `docs-view.ts` only).
- `tree.test.ts` gets a constant `const NO_STARS: ReadonlySet<string> = new Set();`. Every existing `buildTree` call,
  `mineChildren` included, passes it. Their assertions stay. Each fixture time below is a literal in the test.

GIVEN entries with one starred Mine doc WHEN `buildTree` runs THEN the roots are `Starred`, `Mine`
GIVEN a starred id no entry holds WHEN `buildTree` runs THEN no Starred root shows
GIVEN a starred doc WHEN `buildTree` runs THEN its usual leaf `entry:<id>` is still in its group
GIVEN starred docs with and without times WHEN `buildTree` runs THEN Starred lists them newest first, then the rest by title
GIVEN a kind group whose docs have times WHEN `buildTree` runs THEN they sort newest first, the never-loaded ones after by title
GIVEN two docs loaded at the same instant, written differently WHEN `buildTree` runs THEN they sort by title
GIVEN a skill group whose newest file is newer than a sibling skill WHEN `buildTree` runs THEN the group comes first, SKILL.md first inside
GIVEN a feature folder with a loaded and a never-loaded doc WHEN `buildTree` runs THEN the loaded doc comes first
GIVEN loaded repo docs and never-loaded global docs WHEN `buildTree` runs THEN Mine's children stay Global, then the repo

Tests:     in `tree.test.ts`:
           `buildTree_StarredDoc_StarredRootAboveMine` — a global rule `/Users/u/.claude/rules/a.md`, starred set
             `{ '/Users/u/.claude/rules/a.md' }`: root titles `['Starred', 'Mine']`, ids `['owner:starred', 'owner:mine']`;
             Starred's child ids `['owner:starred/entry:/Users/u/.claude/rules/a.md']`, its title `a.md`
           `buildTree_StarredDoc_StaysInItsPlace` — the same: Mine › Global › Rules child ids
             `['entry:/Users/u/.claude/rules/a.md']`
           `buildTree_StarredIdNotInIndex_NoStarredRoot` — one global rule, starred set `{ '/Users/u/gone.md' }`: root
             titles `['Mine']`
           `buildTree_StarredThirdParty_Listed` — a Mine rule and the third-party plugin skill of
             `thirdPartyPluginSkill('v@m')`, the skill starred: root titles `['Starred', 'Mine', 'Third-party']`
           `buildTree_StarredRoot_RoleOther` — Starred's `role` equals `{ type: 'other' }`
           `buildTree_Starred_NewestLoadedFirstThenByTitle` — four starred global rules: `b.md` loaded
             `'2026-10-20T10:00:00Z'`, `a.md` loaded `'2026-10-26T09:00:00.500Z'`, `d.md` and `c.md` never loaded:
             Starred's child titles `['a.md', 'b.md', 'c.md', 'd.md']`
           `buildTree_KindGroup_NewestLoadedFirstThenNeverByTitle` — global rules `zeta.md` loaded
             `'2026-10-26T10:00:00.000Z'`, `mid.md` loaded `'2026-10-25T10:00:00Z'`, `beta.md` and `alpha.md` never loaded:
             Rules' child titles `['zeta.md', 'mid.md', 'alpha.md', 'beta.md']`
           `buildTree_SameInstant_ByTitle` — global rules `b.md` loaded `'2026-10-26T10:00:00Z'` and `a.md` loaded
             `'2026-10-26T10:00:00.000Z'`: Rules' child titles `['a.md', 'b.md']`
           `buildTree_SkillGroup_SortsByNewestFile` — global skills: `a` (`/Users/u/.claude/skills/a/SKILL.md`, title `a`,
             loaded `'2026-10-20T10:00:00Z'`, no files) and `b` (`/Users/u/.claude/skills/b/SKILL.md`, title `b`, never
             loaded) with skill-files `/Users/u/.claude/skills/b/x.md` (title `x.md`, never loaded) and
             `/Users/u/.claude/skills/b/y.md` (title `y.md`, loaded `'2026-10-26T10:00:00Z'`), each with
             `meta: { skill: '/Users/u/.claude/skills/b/SKILL.md' }`: Skills' child titles `['b', 'a']`; group `b`'s child
             titles `['SKILL.md', 'y.md', 'x.md']`
           `buildTree_FeatureFolder_LoadedFirstNeverInKindOrder` — the entries of `buildTree_Features_GroupedBySlugThenKinds`
             with `a-feat/design.md` loaded `'2026-10-26T10:00:00Z'`: `a-feat`'s child ids
             `[\`entry:${root}/a-feat/design.md\`, \`entry:${root}/a-feat/checklist.md\`]`; with neither loaded, the
             existing test's order holds
           `buildTree_LoadedRepoDocs_GroupsKeepPlace` — a never-loaded global rule and a repo `r` AGENTS.md loaded
             `'2026-10-26T10:00:00Z'`: Mine's child titles `['Global', 'r']`
           `buildTree_SameIndexTwice_SameIds` builds with a starred set of one entry id too: both trees' flattened ids
             are equal
Done when: `npm run typecheck` passes; `npm test -- src/plugins/docs/tree.test.ts` passes with every test above
           (`npx` is denied on this machine); `npm run lint` passes
Commit:    one commit for the group, in wigley-ai-gui, committed by path only (peer sessions may have uncommitted edits)

## Proof

