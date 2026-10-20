import type { IndexEntry } from './contract';
import { isInside, parentFolder } from './doc-paths';

// Whether a link may open `path`: an indexed file, or a file inside an
// entry's root (plugins included) or a global entry's folder.
export function isIndexedPath(
  path: string,
  entries: readonly IndexEntry[],
): boolean {
  return entries.some(
    (entry) =>
      path === entry.path ||
      (entry.root !== null && isInside(path, entry.root)) ||
      insideGlobalEntryFolder(path, entry),
  );
}

// Why a write, create, rename or trash at `realTarget` (a real path) is
// refused, or null when it is allowed. Plugin caches are refused even inside
// an allowed folder.
export function changeRefusal(
  realTarget: string,
  entries: readonly IndexEntry[],
  claudeConfigDirs: readonly string[],
): string | null {
  const cachingPlugin = entries.find(
    (entry) =>
      entry.source === 'plugin' &&
      entry.root !== null &&
      isInside(realTarget, entry.root),
  );
  if (cachingPlugin !== undefined) {
    return `Refused: ${realTarget} is inside the plugin cache of ${cachingPlugin.plugin}`;
  }
  const insideIndexedFolder = entries.some(
    (entry) =>
      realTarget === entry.path ||
      (entry.source !== 'plugin' &&
        entry.root !== null &&
        isInside(realTarget, entry.root)) ||
      insideGlobalEntryFolder(realTarget, entry),
  );
  const insideConfigDir = claudeConfigDirs.some((dir) =>
    isInside(realTarget, dir),
  );
  return insideIndexedFolder || insideConfigDir
    ? null
    : `Refused: ${realTarget} is outside the indexed folders`;
}

function insideGlobalEntryFolder(path: string, entry: IndexEntry): boolean {
  return entry.source === 'global' && isInside(path, parentFolder(entry.path));
}
