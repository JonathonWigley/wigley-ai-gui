import type { Paths } from '../../contracts/paths';
import type { IndexEntry } from './contract';

// The folders a change may land in that no index entry names, as real paths.
export interface GuardFolders {
  // The folders the index walks for global docs.
  globalDocFolders: readonly string[];
  // Plugin install caches: nothing inside one is changed.
  pluginCaches: readonly string[];
}

// Whether a link may open `path`: an indexed file, or a file inside an
// entry's root (plugins included).
export function isIndexedPath(
  path: string,
  entries: readonly IndexEntry[],
  paths: Paths,
): boolean {
  return entries.some(
    (entry) =>
      paths.samePath(path, entry.path) ||
      (entry.root !== null && paths.isInside(path, entry.root)),
  );
}

// Why a write, create, rename or trash at `target` (its folder a real path)
// is refused, or null when it is allowed: at an entry's own file, inside a
// `repo` or `features` entry's root, or inside a global docs folder.
// Anything inside a plugin cache or a listed plugin install is refused, even
// inside an allowed folder.
export function changeRefusal(
  target: string,
  entries: readonly IndexEntry[],
  folders: GuardFolders,
  paths: Paths,
): string | null {
  const cachingPlugin = entries.find(
    (entry) =>
      entry.source === 'plugin' &&
      entry.root !== null &&
      paths.isInside(target, entry.root),
  );
  if (cachingPlugin !== undefined) {
    return `Refused: ${target} is inside the plugin cache of ${cachingPlugin.plugin}`;
  }
  const cache = folders.pluginCaches.find((folder) =>
    paths.isInside(target, folder),
  );
  if (cache !== undefined) {
    return `Refused: ${target} is inside the plugin cache ${cache}`;
  }
  const isEntryOrInsideRoot = entries.some(
    (entry) =>
      paths.samePath(target, entry.path) ||
      ((entry.source === 'repo' || entry.source === 'features') &&
        entry.root !== null &&
        paths.isInside(target, entry.root)),
  );
  const isInsideGlobalDocFolder = folders.globalDocFolders.some((folder) =>
    paths.isInside(target, folder),
  );
  return isEntryOrInsideRoot || isInsideGlobalDocFolder
    ? null
    : `Refused: ${target} is outside the indexed folders`;
}
