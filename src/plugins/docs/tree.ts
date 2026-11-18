import type { Paths } from '../../contracts/paths';
import { codeUnitOrder } from './code-unit-order';
import type { DocKind, IndexEntry } from './contract';
import {
  DOC_KINDS,
  isKnownKind,
  isKnownSource,
  metaString,
  ownsRoot,
} from './index-document';
import { resolveLink } from './links';
import type { WikiItem, WikiShelf, WikiTarget } from './wiki-main';

export type TreeNode =
  | TreeGroup
  | TreeLeaf
  | TreeWikiLink
  | TreeWikiLabel
  | TreeHeadingMatch;

// Node ids stay the same across rebuilds of the same index.
export interface TreeGroup {
  type: 'group';
  id: string;
  title: string;
  // The common folder of the paths of the entries the group stands for (a
  // repo, clone or plugin node leaves out its installed-only entries); null
  // when the entries are on different roots.
  folder: string | null;
  role: GroupRole;
  children: TreeNode[];
}

// What a group stands for, for the page's status rollups: a repo (`clone`
// its one clone's root, null when it has none or is split by clone), one
// clone of a split repo, a plugin inside a repo or clone, or any other group.
export type GroupRole =
  | { type: 'repo'; clone: string | null }
  | { type: 'clone'; clone: string }
  | { type: 'plugin' }
  | { type: 'other' };

const OTHER_ROLE: GroupRole = { type: 'other' };

export interface TreeLeaf {
  type: 'entry';
  id: string;
  title: string;
  entryId: string;
}

// A `Main.md` link that is not a page row: a `wiki:` link, or a page the index
// does not list (`isDangling`). `count` is the size of a kind or owner list.
export interface TreeWikiLink {
  type: 'wikiLink';
  id: string;
  title: string;
  target: WikiTarget;
  count: number | null;
  isDangling: boolean;
}

export interface TreeWikiLabel {
  type: 'wikiLabel';
  id: string;
  title: string;
}

// A section heading the filter matched, shown under its doc's leaf `leafId`.
// Only `visibleRows` makes one: no tree holds one and no builder returns one.
export interface TreeHeadingMatch {
  type: 'headingMatch';
  id: string;
  title: string;
  entryId: string;
  line: number;
  docTitle: string;
  leafId: string;
}

export const KIND_TITLES: Record<DocKind, string> = {
  instructions: 'Instructions',
  reference: 'References',
  learning: 'Learnings',
  rule: 'Rules',
  skill: 'Skills',
  'skill-file': 'Skill files',
  subagent: 'Subagents',
  command: 'Commands',
  prompt: 'Prompts',
  hook: 'Hooks',
  plugin: 'Plugins',
  annotation: 'Annotations',
  feature: 'Features',
  task: 'Tasks',
  plan: 'Plans',
  'feature-doc': 'Feature docs',
  followup: 'Follow-ups',
};

// Case-insensitive, ties broken by code-unit order, so the order never
// depends on input order.
export function compareTitles(a: string, b: string): number {
  return (
    a.localeCompare(b, undefined, { sensitivity: 'base' }) ||
    codeUnitOrder(a, b)
  );
}

// A title for a kind or source the app does not know, from its id: each `-`
// and `_` a space, the first character upper-cased.
export function titleFromId(id: string): string {
  const spaced = id.replace(/[-_]/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export const STARRED_ROOT_ID = 'owner:starred';
export const MINE_ROOT_ID = 'owner:mine';
export const THIRD_PARTY_ROOT_ID = 'owner:third-party';

// Up to three roots: Starred (`owner:starred`), listing every entry whose id
// is in `starred`, newest loaded first, when there is one; then two roots by
// owner: Mine (`owner:mine`), holding Global, the user's installed-only
// plugins without a clone (`owner:mine/plugins`), one node per repo and one
// node per source the app does not know; then Third-party
// (`owner:third-party`), holding Synced skills and one node per plugin. A
// repo holds its kind groups, then one node per plugin of a marketplace clone
// (its kind groups, then Installed only), then Features. A root with no
// entries is left out. Inside every group, docs sort newest loaded first,
// then the never-loaded ones in the group's own order; a skill group sorts by
// its newest file.
export function buildTree(
  entries: readonly IndexEntry[],
  homeDir: string,
  paths: Paths,
  starred: ReadonlySet<string>,
): TreeNode[] {
  const roots: TreeNode[] = [];
  const starredEntries = entries.filter((entry) => starred.has(entry.id));
  if (starredEntries.length > 0) {
    roots.push(starredNode(starredEntries, paths));
  }
  const mine = entries.filter((entry) => entry.owner === 'mine');
  if (mine.length > 0) {
    roots.push(
      group(
        MINE_ROOT_ID,
        'Mine',
        mine,
        mineChildren(mine, homeDir, paths),
        paths,
      ),
    );
  }
  const thirdParty = entries.filter((entry) => entry.owner === 'third-party');
  if (thirdParty.length > 0) {
    roots.push(
      group(
        THIRD_PARTY_ROOT_ID,
        'Third-party',
        thirdParty,
        thirdPartyChildren(thirdParty, paths),
        paths,
      ),
    );
  }
  return roots;
}

// One leaf per starred entry, ids `owner:starred/entry:<entryId>`, titled as
// the entry, so each stays unique beside its leaf in its usual place.
function starredNode(entries: readonly IndexEntry[], paths: Paths): TreeGroup {
  const leaves = newestLoadedFirst(entries)
    .map(leaf)
    .map((usual) => ({ ...usual, id: `${STARRED_LEAF_PREFIX}${usual.id}` }));
  return group(STARRED_ROOT_ID, 'Starred', entries, leaves, paths);
}

// The newest `lastLoaded` first, then the never-loaded, each by title then id.
export function newestLoadedFirst(
  entries: readonly IndexEntry[],
): IndexEntry[] {
  return [...entries].sort(byLoaded(byTitleThenId));
}

const STARRED_LEAF_PREFIX = `${STARRED_ROOT_ID}/`;

// True for the id of a leaf under Starred, false for an entry's usual leaf.
export function isStarredLeafId(id: string): boolean {
  return id.startsWith(STARRED_LEAF_PREFIX);
}

// Global, then Plugins (installed-only entries whose key no clone carries),
// then one node per repo, then one node per source the app does not know,
// ids `source:<source>`; a node with no entries is left out.
function mineChildren(
  entries: readonly IndexEntry[],
  homeDir: string,
  paths: Paths,
): TreeNode[] {
  const children: TreeNode[] = [];
  const global = entries.filter((entry) => entry.source === 'global');
  if (global.length > 0) {
    children.push(
      group(
        'global',
        'Global',
        global,
        kindGroups('global', global, paths),
        paths,
      ),
    );
  }
  const carriedKeys = new Set(
    entries
      .filter((entry) => entry.source === 'repo' && entry.plugin !== null)
      .map((entry) => entry.plugin),
  );
  const installedOnly = entries.filter((entry) => entry.source === 'plugin');
  const uncarried = installedOnly.filter(
    (entry) => !carriedKeys.has(entry.plugin),
  );
  if (uncarried.length > 0) {
    const id = `${MINE_ROOT_ID}/plugins`;
    children.push(
      group(
        id,
        'Plugins',
        uncarried,
        pluginNodes(`${id}/`, uncarried, paths),
        paths,
      ),
    );
  }
  const unclaimed = new Map(
    groupedBy(
      installedOnly.filter((entry) => carriedKeys.has(entry.plugin)),
      (entry) => entry.plugin ?? '',
    ),
  );
  const repoOwned = entries.filter((entry) => ownsRoot(entry));
  for (const [name, repoEntries] of groupedBy(repoOwned, (e) => e.repo ?? '')) {
    children.push(repoNode(name, repoEntries, unclaimed, homeDir, paths));
  }
  const unknownSourced = entries.filter(
    (entry) => !isKnownSource(entry.source),
  );
  for (const [source, sourceEntries] of groupedBy(
    unknownSourced,
    (entry) => entry.source,
  )) {
    const id = `source:${source}`;
    children.push(
      group(
        id,
        titleFromId(source),
        sourceEntries,
        kindGroups(id, sourceEntries, paths),
        paths,
      ),
    );
  }
  return children;
}

// Synced skills (every entry not from a plugin), then one node per plugin
// key, ids `owner:third-party/plugin:<key>`.
function thirdPartyChildren(
  entries: readonly IndexEntry[],
  paths: Paths,
): TreeNode[] {
  const children: TreeNode[] = [];
  const synced = entries.filter((entry) => entry.source !== 'plugin');
  if (synced.length > 0) {
    const id = `${THIRD_PARTY_ROOT_ID}/synced`;
    children.push(
      group(id, 'Synced skills', synced, kindGroups(id, synced, paths), paths),
    );
  }
  const plugins = entries.filter((entry) => entry.source === 'plugin');
  children.push(
    ...pluginNodes(`${THIRD_PARTY_ROOT_ID}/plugin:`, plugins, paths),
  );
  return children;
}

function group(
  id: string,
  title: string,
  entries: readonly IndexEntry[],
  children: TreeNode[],
  paths: Paths,
  role: GroupRole = OTHER_ROLE,
): TreeGroup {
  const folder = paths.commonFolder(entries.map((entry) => entry.path));
  return { type: 'group', id, title, folder, role, children };
}

function leaf(entry: IndexEntry): TreeLeaf {
  return {
    type: 'entry',
    id: `entry:${entry.id}`,
    title: entry.title,
    entryId: entry.id,
  };
}

// The entries keyed by `keyOf`, in key order (`compareTitles`).
function groupedBy(
  entries: readonly IndexEntry[],
  keyOf: (entry: IndexEntry) => string,
): [string, IndexEntry[]][] {
  const groups = new Map<string, IndexEntry[]>();
  for (const entry of entries) {
    const key = keyOf(entry);
    const members = groups.get(key);
    if (members === undefined) {
      groups.set(key, [entry]);
    } else {
      members.push(entry);
    }
  }
  return [...groups].sort(([a], [b]) => compareTitles(a, b));
}

type EntryOrder = (a: IndexEntry, b: IndexEntry) => number;

function byTitleThenId(a: IndexEntry, b: IndexEntry): number {
  return compareTitles(a.title, b.title) || codeUnitOrder(a.id, b.id);
}

// Entries with a time first, newest first, then those with none; equal times
// and the never-loaded keep `fallback`'s order. `loadedOf` is the time of the
// node an entry stands for.
function byLoaded(
  fallback: EntryOrder,
  loadedOf: (entry: IndexEntry) => number | null = loadedTime,
): EntryOrder {
  return (a, b) => {
    const aLoaded = loadedOf(a);
    const bLoaded = loadedOf(b);
    if (aLoaded === bLoaded) {
      return fallback(a, b);
    }
    if (aLoaded === null) {
      return 1;
    }
    if (bLoaded === null) {
      return -1;
    }
    return bLoaded - aLoaded;
  };
}

// `lastLoaded` as a `Date.parse` value, so differently written equal instants
// compare equal; null when never loaded.
function loadedTime(entry: IndexEntry): number | null {
  return entry.lastLoaded === null ? null : Date.parse(entry.lastLoaded);
}

// The newest time among `entries`; null when none was loaded.
function newestLoaded(entries: readonly IndexEntry[]): number | null {
  let newest: number | null = null;
  for (const entry of entries) {
    const loaded = loadedTime(entry);
    if (loaded !== null && (newest === null || loaded > newest)) {
      newest = loaded;
    }
  }
  return newest;
}

// One group per kind present, in `DOC_KINDS` order, ids `<parentId>/<kind>`;
// then one per kind the app does not know, by kind id, ids
// `<parentId>/kind:<kind>` so no such kind meets a known node's id. A skill
// whose skill-files are in `entries` becomes a skill group holding them, timed
// by its newest file.
function kindGroups(
  parentId: string,
  entries: readonly IndexEntry[],
  paths: Paths,
): TreeNode[] {
  const filesBySkill = skillFilesBySkill(entries);
  const listed = entries.filter(
    (entry) =>
      entry.kind !== 'skill-file' ||
      !filesBySkill.has(metaString(entry, 'skill') ?? ''),
  );
  const nodeLoaded = (entry: IndexEntry): number | null =>
    newestLoaded([entry, ...(filesBySkill.get(entry.id) ?? [])]);
  const nodesOf = (ofKind: readonly IndexEntry[]): TreeNode[] =>
    [...ofKind]
      .sort(byLoaded(byTitleThenId, nodeLoaded))
      .map((entry) => skillGroupOrLeaf(entry, filesBySkill, paths));
  const groups: TreeNode[] = [];
  for (const kind of DOC_KINDS) {
    const ofKind = listed.filter((entry) => entry.kind === kind);
    if (ofKind.length > 0) {
      groups.push(
        group(
          `${parentId}/${kind}`,
          KIND_TITLES[kind],
          ofKind,
          nodesOf(ofKind),
          paths,
        ),
      );
    }
  }
  const unknownKinded = listed.filter((entry) => !isKnownKind(entry.kind));
  for (const [kind, ofKind] of groupedBy(unknownKinded, (e) => e.kind)) {
    groups.push(
      group(
        `${parentId}/kind:${kind}`,
        titleFromId(kind),
        ofKind,
        nodesOf(ofKind),
        paths,
      ),
    );
  }
  return groups;
}

// The skill-file entries of each skill in `entries`, by the skill's id; a
// skill-file whose skill is not in `entries` is in none.
function skillFilesBySkill(
  entries: readonly IndexEntry[],
): Map<string, IndexEntry[]> {
  const filesBySkill = new Map<string, IndexEntry[]>();
  const skillIds = new Set(
    entries.filter((entry) => entry.kind === 'skill').map((entry) => entry.id),
  );
  for (const entry of entries) {
    const skillId = metaString(entry, 'skill');
    const hasListedSkill =
      entry.kind === 'skill-file' && skillId !== null && skillIds.has(skillId);
    if (hasListedSkill) {
      const files = filesBySkill.get(skillId);
      if (files === undefined) {
        filesBySkill.set(skillId, [entry]);
      } else {
        files.push(entry);
      }
    }
  }
  return filesBySkill;
}

// A skill with files: group `skill:<entryId>` titled as the skill, holding
// its SKILL.md leaf (titled `SKILL.md`), then its files newest loaded first,
// the never-loaded by title. Any other entry: its leaf.
function skillGroupOrLeaf(
  entry: IndexEntry,
  filesBySkill: ReadonlyMap<string, readonly IndexEntry[]>,
  paths: Paths,
): TreeNode {
  const files = entry.kind === 'skill' ? filesBySkill.get(entry.id) : undefined;
  if (files === undefined) {
    return leaf(entry);
  }
  const children = [
    { ...leaf(entry), title: 'SKILL.md' },
    ...[...files].sort(byLoaded(byTitleThenId)).map(leaf),
  ];
  return group(
    `skill:${entry.id}`,
    entry.title,
    [entry, ...files],
    children,
    paths,
  );
}

// One node per plugin key, ids `<idPrefix><key>`, titled the key.
function pluginNodes(
  idPrefix: string,
  entries: readonly IndexEntry[],
  paths: Paths,
): TreeNode[] {
  return groupedBy(entries, (entry) => entry.plugin ?? '').map(
    ([plugin, pluginEntries]) => {
      const id = `${idPrefix}${plugin}`;
      return group(
        id,
        plugin,
        pluginEntries,
        kindGroups(id, pluginEntries, paths),
        paths,
      );
    },
  );
}

// A repo's clone docs, split by clone when its entries span several roots,
// then its Features node. Each repo or clone node takes from `unclaimed` the
// installed-only entries of the plugin keys its clone entries carry, so the
// first one in tree order holds them.
function repoNode(
  name: string,
  entries: readonly IndexEntry[],
  unclaimed: Map<string, IndexEntry[]>,
  homeDir: string,
  paths: Paths,
): TreeGroup {
  const id = `repo:${name}`;
  const cloneEntries = entries.filter((entry) => entry.source === 'repo');
  const featureEntries = entries.filter((entry) => entry.source === 'features');
  const clones = groupedBy(cloneEntries, (entry) => entry.root ?? '');
  const children: TreeNode[] =
    clones.length > 1
      ? cloneNodes(id, clones, unclaimed, homeDir, paths)
      : cloneChildren(id, cloneEntries, unclaimed, paths);
  if (featureEntries.length > 0) {
    children.push(featuresNode(id, featureEntries, paths));
  }
  const clone = clones.length === 1 ? clones[0][0] : null;
  return group(id, name, entries, children, paths, { type: 'repo', clone });
}

function cloneNodes(
  repoId: string,
  clones: [string, IndexEntry[]][],
  unclaimed: Map<string, IndexEntry[]>,
  homeDir: string,
  paths: Paths,
): TreeNode[] {
  return clones
    .map(([root, cloneEntries]) => ({
      root,
      cloneEntries,
      title: paths.tilde(root, homeDir),
    }))
    .sort((a, b) => compareTitles(a.title, b.title))
    .map(({ root, cloneEntries, title }) => {
      const id = `${repoId}/clone:${root}`;
      return group(
        id,
        title,
        cloneEntries,
        cloneChildren(id, cloneEntries, unclaimed, paths),
        paths,
        { type: 'clone', clone: root },
      );
    });
}

// The kind groups of the entries with no plugin, then one node per plugin key
// among the entries, ids `<parentId>/plugin:<key>`.
function cloneChildren(
  parentId: string,
  cloneEntries: readonly IndexEntry[],
  unclaimed: Map<string, IndexEntry[]>,
  paths: Paths,
): TreeNode[] {
  const ownDocs = cloneEntries.filter((entry) => entry.plugin === null);
  const pluginDocs = cloneEntries.filter((entry) => entry.plugin !== null);
  const pluginKeyNodes = groupedBy(pluginDocs, (e) => e.plugin ?? '').map(
    ([key, keyEntries]) => {
      const installedOnly = unclaimed.get(key) ?? [];
      unclaimed.delete(key);
      return clonePluginNode(parentId, key, keyEntries, installedOnly, paths);
    },
  );
  return [...kindGroups(parentId, ownDocs, paths), ...pluginKeyNodes];
}

// A marketplace clone's plugin: the kind groups of its clone entries and its
// installed-only `plugin` entries, then Installed only (id
// `<pluginNodeId>/installed`) for its other installed-only entries, left out
// when it has none.
function clonePluginNode(
  parentId: string,
  key: string,
  keyEntries: readonly IndexEntry[],
  installedOnly: readonly IndexEntry[],
  paths: Paths,
): TreeGroup {
  const id = `${parentId}/plugin:${key}`;
  const installedPlugins = installedOnly.filter((e) => e.kind === 'plugin');
  const installedFiles = installedOnly.filter((e) => e.kind !== 'plugin');
  const children = kindGroups(id, [...keyEntries, ...installedPlugins], paths);
  if (installedFiles.length > 0) {
    const installedId = `${id}/installed`;
    children.push(
      group(
        installedId,
        'Installed only',
        installedFiles,
        kindGroups(installedId, installedFiles, paths),
        paths,
      ),
    );
  }
  return group(id, key, keyEntries, children, paths, { type: 'plugin' });
}

// One node per feature slug, ids `<featuresId>/feature:<slug>` so no slug
// meets a kind group's id, then kind groups for the entries with none.
function featuresNode(
  repoId: string,
  entries: readonly IndexEntry[],
  paths: Paths,
): TreeGroup {
  const id = `${repoId}/features`;
  const withSlug = entries.filter(
    (entry) => featureSlug(entry, paths) !== null,
  );
  const withoutSlug = entries.filter(
    (entry) => featureSlug(entry, paths) === null,
  );
  const slugNodes = groupedBy(
    withSlug,
    (entry) => featureSlug(entry, paths) ?? '',
  ).map(([slug, slugEntries]) => {
    const leaves = [...slugEntries].sort(byLoaded(byKindThenTitle)).map(leaf);
    return group(`${id}/feature:${slug}`, slug, slugEntries, leaves, paths);
  });
  return group(
    id,
    'Features',
    entries,
    [...slugNodes, ...kindGroups(id, withoutSlug, paths)],
    paths,
  );
}

// Known kinds in `DOC_KINDS` order, then unknown kinds by kind id.
function byKindThenTitle(a: IndexEntry, b: IndexEntry): number {
  return (
    kindRank(a.kind) - kindRank(b.kind) ||
    (isKnownKind(a.kind) ? 0 : compareTitles(a.kind, b.kind)) ||
    byTitleThenId(a, b)
  );
}

// A kind's place in `DOC_KINDS`; every unknown kind ranks after them all.
function kindRank(kind: string): number {
  return isKnownKind(kind) ? DOC_KINDS.indexOf(kind) : DOC_KINDS.length;
}

// `meta.feature` (task, plan), else `meta.slug` (feature), else the first
// folder below the home's root other than `followups`.
function featureSlug(entry: IndexEntry, paths: Paths): string | null {
  const named = metaString(entry, 'feature') ?? metaString(entry, 'slug');
  if (named !== null) {
    return named;
  }
  const below =
    entry.root === null ? null : paths.segmentsBelow(entry.path, entry.root);
  if (below === null) {
    return null;
  }
  // A file directly in the root has one segment below it.
  const inSubfolder = below.length > 1;
  return inSubfolder && below[0] !== 'followups' ? below[0] : null;
}

// One root group per shelf of `Main.md`, in file order, an empty one included,
// ids `shelf:<title>` and for a repeated title `shelf:<title>#<n>`. A shelf's
// children are its items in file order, ids carrying the item's index: a label
// `<shelfId>/label:<index>`, a link `<shelfId>/link:<index>`. A page the index
// lists is a leaf titled the link's text, id `entry:<entryId>` for the entry's
// first leaf, as `buildTree` names it, and `<shelfId>/<index>/entry:<entryId>`
// for a later one.
export function buildWikiTree(
  shelves: readonly WikiShelf[],
  entries: readonly IndexEntry[],
  mainFolder: string,
  homeDir: string,
  paths: Paths,
): TreeNode[] {
  const mainFile = paths.join(mainFolder, 'Main.md');
  const shelfIds = new Set<string>();
  const placedEntryIds = new Set<string>();
  return shelves.map((shelf) => {
    const shelfId = unusedShelfId(shelf.title, shelfIds);
    shelfIds.add(shelfId);
    const leafEntries: IndexEntry[] = [];
    const children = shelf.items.map((item, index): TreeNode => {
      if (item.type === 'label') {
        const id = `${shelfId}/label:${index}`;
        return { type: 'wikiLabel', id, title: item.title };
      }
      const page = pageEntry(item, entries, mainFile, homeDir, paths);
      if (page === null) {
        return wikiLink(item, `${shelfId}/link:${index}`, entries);
      }
      const isFirstLeaf = !placedEntryIds.has(page.id);
      placedEntryIds.add(page.id);
      leafEntries.push(page);
      return {
        type: 'entry',
        id: isFirstLeaf
          ? `entry:${page.id}`
          : `${shelfId}/${index}/entry:${page.id}`,
        title: item.title,
        entryId: page.id,
      };
    });
    return leafEntries.length === 0
      ? {
          type: 'group',
          id: shelfId,
          title: shelf.title,
          folder: null,
          role: OTHER_ROLE,
          children,
        }
      : group(shelfId, shelf.title, leafEntries, children, paths);
  });
}

function unusedShelfId(title: string, used: ReadonlySet<string>): string {
  let id = `shelf:${title}`;
  for (let nth = 2; used.has(id); nth++) {
    id = `shelf:${title}#${nth}`;
  }
  return id;
}

type WikiPageItem = Extract<WikiItem, { type: 'page' }>;

// The entry a page item's `path` or `skill` target names; null for any other
// target and for one no entry answers.
function pageEntry(
  { target }: WikiPageItem,
  entries: readonly IndexEntry[],
  mainFile: string,
  homeDir: string,
  paths: Paths,
): IndexEntry | null {
  if (target.type === 'path') {
    return pathEntry(target.path, entries, mainFile, homeDir, paths);
  }
  if (target.type === 'skill') {
    return findSkillEntry(target.name, entries);
  }
  return null;
}

// The whole-file entry at the path `href` resolves to, else the one that walks
// through that path.
function pathEntry(
  href: string,
  entries: readonly IndexEntry[],
  mainFile: string,
  homeDir: string,
  paths: Paths,
): IndexEntry | null {
  const resolved = resolveLink(href, mainFile, homeDir, paths);
  if (resolved.type !== 'file') {
    return null;
  }
  const wholeFiles = entries.filter((entry) => entry.id === entry.path);
  const atPath = wholeFiles.filter((entry) =>
    paths.samePath(entry.path, resolved.path),
  );
  const walkedThrough = wholeFiles.filter((entry) =>
    entry.walked.some((walked) => paths.samePath(walked, resolved.path)),
  );
  return preferredEntry(atPath.length > 0 ? atPath : walkedThrough);
}

const WIKI_SKILL_PLUGIN_PREFIX = 'wigley@';

// The skill titled `name` in the plugin the `wigley:` link form names.
export function findSkillEntry(
  name: string,
  entries: readonly IndexEntry[],
): IndexEntry | null {
  return preferredEntry(
    entries.filter(
      (entry) =>
        entry.kind === 'skill' &&
        entry.title === name &&
        entry.plugin?.startsWith(WIKI_SKILL_PLUGIN_PREFIX) === true,
    ),
  );
}

// `owner` `mine` first, then `source` `repo` first, then `id` in code-unit
// order, so the pick never depends on index order.
function preferredEntry(candidates: readonly IndexEntry[]): IndexEntry | null {
  const rankOf = (entry: IndexEntry) =>
    (entry.owner === 'mine' ? 0 : 2) + (entry.source === 'repo' ? 0 : 1);
  const [first] = [...candidates].sort(
    (a, b) => rankOf(a) - rankOf(b) || codeUnitOrder(a.id, b.id),
  );
  return first ?? null;
}

function wikiLink(
  { title, target }: WikiPageItem,
  id: string,
  entries: readonly IndexEntry[],
): TreeWikiLink {
  // `pageEntry` found no entry for it.
  const isDangling = target.type === 'path' || target.type === 'skill';
  const count =
    target.type === 'kind' || target.type === 'owner'
      ? wikiListEntries(target, entries).length
      : null;
  return { type: 'wikiLink', id, title, target, count, isDangling };
}

// The docs a `kind` or `owner` link's list page shows, in input order: the
// user's own docs of that kind, or the third-party docs.
export function wikiListEntries(
  target: Extract<WikiTarget, { type: 'kind' | 'owner' }>,
  entries: readonly IndexEntry[],
): IndexEntry[] {
  return target.type === 'kind'
    ? entries.filter(
        (entry) => entry.owner === 'mine' && entry.kind === target.kind,
      )
    : entries.filter((entry) => entry.owner === target.owner);
}

// The tree the wiki view's filter searches, since the shelves hold only the
// pages `Main.md` links: the user's own docs under their usual groups.
export function buildWikiFilterTree(
  entries: readonly IndexEntry[],
  homeDir: string,
  paths: Paths,
): TreeNode[] {
  const mine = entries.filter((entry) => entry.owner === 'mine');
  return buildTree(mine, homeDir, paths, new Set());
}
