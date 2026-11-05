import type { Paths } from '../../../contracts/paths';
import type { IndexEntry } from '../contract';
import type { ListPageInput, ListRowInput } from '../layouts/layout';
import { loadedMark } from '../loaded-time';
import { compareTitles, newestLoadedFirst, wikiListEntries } from '../tree';
import { parseWikiTarget, type WikiTarget } from '../wiki-main';

export type ListTarget = Extract<WikiTarget, { type: 'kind' | 'owner' }>;

// What the list pane draws: `entryIds[g][r]` is the id of group `g`'s row `r`.
export interface ListPageContent {
  place: string;
  input: ListPageInput;
  entryIds: string[][];
}

const GLOBAL_GROUP = 'Global';

// The link's own text, which is the list's place in a doc history.
export function listPlace(target: ListTarget): string {
  return target.type === 'kind'
    ? `wiki:kind/${target.kind}`
    : `wiki:owner/${target.owner}`;
}

// The list a history place names; null for a file's path.
export function listTargetOfPlace(path: string): ListTarget | null {
  const target = parseWikiTarget(path);
  return target?.type === 'kind' || target?.type === 'owner' ? target : null;
}

// `Global` first, then by title.
function compareGroups(a: string, b: string): number {
  return (
    Number(b === GLOBAL_GROUP) - Number(a === GLOBAL_GROUP) ||
    compareTitles(a, b)
  );
}

function listRow(
  entry: IndexEntry,
  homeDir: string,
  now: number,
  paths: Paths,
): ListRowInput {
  const path = paths.tilde(entry.path, homeDir);
  return {
    title: entry.title,
    path: entry.line === null ? path : `${path}:${entry.line}`,
    time: loadedMark(entry.lastLoaded, now),
  };
}

// The docs `target` lists, the same ones the sidebar counts: grouped by plugin
// for the third-party list and by repo for any other, `Global` holding a doc
// with neither and coming first, each group's rows newest loaded first.
export function listPageContent(
  target: ListTarget,
  title: string,
  entries: readonly IndexEntry[],
  homeDir: string,
  now: number,
  paths: Paths,
): ListPageContent {
  const listed = wikiListEntries(target, entries);
  const isByPlugin = target.type === 'owner' && target.owner === 'third-party';
  const grouped = new Map<string, IndexEntry[]>();
  for (const entry of listed) {
    const group = (isByPlugin ? entry.plugin : entry.repo) ?? GLOBAL_GROUP;
    grouped.set(group, [...(grouped.get(group) ?? []), entry]);
  }
  const groups = [...grouped.keys()].sort(compareGroups).map((group) => ({
    title: group,
    entries: newestLoadedFirst(grouped.get(group)!),
  }));
  return {
    place: listPlace(target),
    input: {
      title,
      count: listed.length,
      groups: groups.map((group) => ({
        title: group.title,
        rows: group.entries.map((entry) => listRow(entry, homeDir, now, paths)),
      })),
    },
    entryIds: groups.map((group) => group.entries.map((entry) => entry.id)),
  };
}
