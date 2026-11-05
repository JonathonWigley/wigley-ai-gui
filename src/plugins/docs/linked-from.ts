import { codeUnitOrder } from './code-unit-order';
import type { IndexEntry, IndexLink } from './contract';
import { compareTitles } from './tree';

export interface LinkedFromRow {
  entryId: string;
  title: string;
  path: string;
  // 1-based: the source's first link to the target.
  line: number;
}

// The user's docs that link to the doc at `targetPath`, one row per doc, a doc
// in several clones of one repo showing once. A link counts only when its
// `target` is exactly the doc's path or a path the index walked to reach it.
export function linkedFrom(
  entries: readonly IndexEntry[],
  targetPath: string,
): LinkedFromRow[] {
  const targetEntries = entries.filter(
    (entry) => entry.path === targetPath || entry.walked.includes(targetPath),
  );
  const targetPaths = new Set([
    targetPath,
    ...targetEntries.flatMap((entry) => [entry.path, ...entry.walked]),
  ]);
  const targetCloneKeys = new Set(targetEntries.map(cloneKey));

  const sourceByCloneKey = new Map<string, IndexEntry>();
  for (const entry of entries) {
    const key = cloneKey(entry);
    const isTheTarget = targetPaths.has(entry.path) || targetCloneKeys.has(key);
    const isOwnWholeDoc = entry.owner === 'mine' && entry.line === null;
    const linksTheTarget = matchingLinks(entry, targetPaths).length > 0;
    if (!isOwnWholeDoc || isTheTarget || !linksTheTarget) {
      continue;
    }
    const kept = sourceByCloneKey.get(key);
    if (kept === undefined || clonePrecedes(entry, kept, targetPath)) {
      sourceByCloneKey.set(key, entry);
    }
  }

  return [...sourceByCloneKey.values()]
    .map((entry) => ({
      entryId: entry.id,
      title: entry.title,
      path: entry.path,
      line: Math.min(
        ...matchingLinks(entry, targetPaths).map((link) => link.line),
      ),
    }))
    .sort(
      (a, b) =>
        compareTitles(a.title, b.title) || codeUnitOrder(a.path, b.path),
    );
}

function matchingLinks(
  entry: IndexEntry,
  targetPaths: ReadonlySet<string>,
): IndexLink[] {
  return entry.links.filter((link) => targetPaths.has(link.target));
}

// One doc's identity across clones of its repo or versions of its plugin: the
// owner and the path under the root, or the path when either is missing.
function cloneKey(entry: IndexEntry): string {
  const ownerKey = entry.repo ?? entry.plugin;
  const { root, path } = entry;
  if (ownerKey === null || root === null || !path.startsWith(root)) {
    return path;
  }
  return `${ownerKey}\0${path.slice(root.length)}`;
}

// Whether `candidate` outranks `kept`, a copy of one doc: a root holding the
// target comes first, then the lower root.
function clonePrecedes(
  candidate: IndexEntry,
  kept: IndexEntry,
  targetPath: string,
): boolean {
  const candidateHolds = rootHolds(candidate.root, targetPath);
  const keptHolds = rootHolds(kept.root, targetPath);
  if (candidateHolds !== keptHolds) {
    return candidateHolds;
  }
  return (candidate.root ?? '') < (kept.root ?? '');
}

function rootHolds(root: string | null, path: string): boolean {
  if (root === null || !path.startsWith(root)) {
    return false;
  }
  const next = path[root.length];
  const hasSeparatorAfterRoot = next === '/' || next === '\\';
  const hasTextAfterSeparator = path.length > root.length + 1;
  return hasSeparatorAfterRoot && hasTextAfterSeparator;
}
