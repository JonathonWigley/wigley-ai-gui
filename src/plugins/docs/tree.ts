import type { Paths } from '../../contracts/paths';
import type { DocKind, IndexEntry } from './contract';
import {
  DOC_KINDS,
  isKnownKind,
  isKnownSource,
  metaString,
} from './index-document';

export type TreeNode = TreeGroup | TreeLeaf;

// Node ids stay the same across rebuilds of the same index.
export interface TreeGroup {
  type: 'group';
  id: string;
  title: string;
  // The common folder of every descendant entry's path; null when the
  // entries are on different roots.
  folder: string | null;
  children: TreeNode[];
}

export interface TreeLeaf {
  type: 'entry';
  id: string;
  title: string;
  entryId: string;
}

export const KIND_TITLES: Record<DocKind, string> = {
  instructions: 'Instructions',
  reference: 'References',
  learning: 'Learnings',
  rule: 'Rules',
  skill: 'Skills',
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
    (a < b ? -1 : a > b ? 1 : 0)
  );
}

// A title for a kind or source the app does not know, from its id: each `-`
// and `_` a space, the first character upper-cased.
export function titleFromId(id: string): string {
  const spaced = id.replace(/[-_]/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// Global, then Plugins, then one node per repo, then one node per source the
// app does not know, ids `source:<source>`; a root with no entries is left
// out.
export function buildTree(
  entries: readonly IndexEntry[],
  homeDir: string,
  paths: Paths,
): TreeNode[] {
  const roots: TreeNode[] = [];
  const global = entries.filter((entry) => entry.source === 'global');
  if (global.length > 0) {
    roots.push(
      group(
        'global',
        'Global',
        global,
        kindGroups('global', global, paths),
        paths,
      ),
    );
  }
  const plugins = entries.filter((entry) => entry.source === 'plugin');
  if (plugins.length > 0) {
    roots.push(
      group('plugins', 'Plugins', plugins, pluginNodes(plugins, paths), paths),
    );
  }
  const repoOwned = entries.filter(
    (entry) => entry.source === 'repo' || entry.source === 'features',
  );
  for (const [name, repoEntries] of groupedBy(repoOwned, (e) => e.repo ?? '')) {
    roots.push(repoNode(name, repoEntries, homeDir, paths));
  }
  const unknownSourced = entries.filter(
    (entry) => !isKnownSource(entry.source),
  );
  for (const [source, sourceEntries] of groupedBy(
    unknownSourced,
    (entry) => entry.source,
  )) {
    const id = `source:${source}`;
    roots.push(
      group(
        id,
        titleFromId(source),
        sourceEntries,
        kindGroups(id, sourceEntries, paths),
        paths,
      ),
    );
  }
  return roots;
}

function group(
  id: string,
  title: string,
  entries: readonly IndexEntry[],
  children: TreeNode[],
  paths: Paths,
): TreeGroup {
  const folder = paths.commonFolder(entries.map((entry) => entry.path));
  return { type: 'group', id, title, folder, children };
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

function byTitleThenId(a: IndexEntry, b: IndexEntry): number {
  return (
    compareTitles(a.title, b.title) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

// One group per kind present, in `DOC_KINDS` order, ids `<parentId>/<kind>`;
// then one per kind the app does not know, by kind id, ids
// `<parentId>/kind:<kind>` so no such kind meets a known node's id.
function kindGroups(
  parentId: string,
  entries: readonly IndexEntry[],
  paths: Paths,
): TreeNode[] {
  const groups: TreeNode[] = [];
  for (const kind of DOC_KINDS) {
    const ofKind = entries.filter((entry) => entry.kind === kind);
    if (ofKind.length > 0) {
      const leaves = [...ofKind].sort(byTitleThenId).map(leaf);
      groups.push(
        group(`${parentId}/${kind}`, KIND_TITLES[kind], ofKind, leaves, paths),
      );
    }
  }
  const unknownKinded = entries.filter((entry) => !isKnownKind(entry.kind));
  for (const [kind, ofKind] of groupedBy(unknownKinded, (e) => e.kind)) {
    const leaves = [...ofKind].sort(byTitleThenId).map(leaf);
    groups.push(
      group(
        `${parentId}/kind:${kind}`,
        titleFromId(kind),
        ofKind,
        leaves,
        paths,
      ),
    );
  }
  return groups;
}

function pluginNodes(entries: readonly IndexEntry[], paths: Paths): TreeNode[] {
  return groupedBy(entries, (entry) => entry.plugin ?? '').map(
    ([plugin, pluginEntries]) => {
      const id = `plugins/${plugin}`;
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

// A repo's kind groups, split by clone when its entries span several roots,
// then its Features node.
function repoNode(
  name: string,
  entries: readonly IndexEntry[],
  homeDir: string,
  paths: Paths,
): TreeGroup {
  const id = `repo:${name}`;
  const cloneEntries = entries.filter((entry) => entry.source === 'repo');
  const featureEntries = entries.filter((entry) => entry.source === 'features');
  const clones = groupedBy(cloneEntries, (entry) => entry.root ?? '');
  const children: TreeNode[] =
    clones.length > 1
      ? cloneNodes(id, clones, homeDir, paths)
      : kindGroups(id, cloneEntries, paths);
  if (featureEntries.length > 0) {
    children.push(featuresNode(id, featureEntries, paths));
  }
  return group(id, name, entries, children, paths);
}

function cloneNodes(
  repoId: string,
  clones: [string, IndexEntry[]][],
  homeDir: string,
  paths: Paths,
): TreeNode[] {
  return clones
    .map(([root, cloneEntries]) => {
      const id = `${repoId}/clone:${root}`;
      const title = paths.tilde(root, homeDir);
      return group(
        id,
        title,
        cloneEntries,
        kindGroups(id, cloneEntries, paths),
        paths,
      );
    })
    .sort((a, b) => compareTitles(a.title, b.title));
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
    const leaves = [...slugEntries].sort(byKindThenTitle).map(leaf);
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
