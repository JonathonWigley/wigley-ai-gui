import type { DocsContribution } from '../../../contracts/contributions';
import type { PluginLog } from '../../../contracts/log';
import { isJsonObject } from '../../../shared/json';
import type { FeatureReader, Strategy } from '../../contributions/contract';
import type { DocsBinding, DocsGlobalFolder } from '../contract';

const GLOBAL_FOLDER_LISTS = ['referenceFiles', 'subfolders', 'skip'] as const;

function isRootedPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    (value.startsWith('~/') || value.startsWith('/'))
  );
}

function isRelativePathList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every(
      (each) =>
        typeof each === 'string' &&
        each !== '' &&
        !each.startsWith('/') &&
        !each.split('/').includes('..'),
    )
  );
}

function isLinkPrefixMap(value: unknown): value is Record<string, string> {
  return (
    isJsonObject(value) &&
    Object.entries(value).every(
      ([prefix, key]) =>
        prefix.endsWith(':') && typeof key === 'string' && key.includes('@'),
    )
  );
}

// The global folder at `index` with each absent list filled with `[]`, or the
// reasons it is refused.
function readGlobalFolder(
  item: unknown,
  index: number,
): { folder: DocsGlobalFolder } | { reasons: string[] } {
  const name = `globalFolders[${index}]`;
  if (!isJsonObject(item) || !isRootedPath(item.path)) {
    return { reasons: [`${name}.path: not a ~ or absolute path`] };
  }
  const folder: DocsGlobalFolder = {
    path: item.path,
    referenceFiles: [],
    subfolders: [],
    skip: [],
  };
  const reasons: string[] = [];
  for (const field of GLOBAL_FOLDER_LISTS) {
    const list = item[field];
    if (list === undefined) {
      continue;
    }
    if (isRelativePathList(list)) {
      folder[field] = [...list];
    } else {
      reasons.push(`${name}.${field}: not a list of relative paths`);
    }
  }
  return reasons.length > 0 ? { reasons } : { folder };
}

// The `docs` section of `auri.json`: its `globalFolders`, `wikiMain` and
// `linkPrefixes`, with every other key dropped. Each absent list is `[]` and
// an absent `linkPrefixes` is `{}`; an absent `wikiMain` stays absent.
export const docsReader: FeatureReader<DocsContribution> = {
  label: 'Docs',
  read(section) {
    if (!isJsonObject(section)) {
      return { ok: false, reasons: ['"docs" is not an object'] };
    }
    const { globalFolders, wikiMain, linkPrefixes } = section;
    const reasons: string[] = [];
    const folders: DocsGlobalFolder[] = [];
    if (globalFolders !== undefined && !Array.isArray(globalFolders)) {
      reasons.push('globalFolders: not a list of folders');
    }
    if (Array.isArray(globalFolders)) {
      globalFolders.forEach((item, index) => {
        const read = readGlobalFolder(item, index);
        if ('reasons' in read) {
          reasons.push(...read.reasons);
        } else {
          folders.push(read.folder);
        }
      });
    }
    const isWikiMainPath = isRootedPath(wikiMain) && wikiMain.endsWith('.md');
    if (wikiMain !== undefined && !isWikiMainPath) {
      reasons.push('wikiMain: not a ~ or absolute .md path');
    }
    if (linkPrefixes !== undefined && !isLinkPrefixMap(linkPrefixes)) {
      reasons.push('linkPrefixes: not { "<prefix>:": "<plugin key>" }');
    }
    if (reasons.length > 0) {
      return { ok: false, reasons };
    }
    // Every reason above is empty, so each field holds the type its check read.
    const value: DocsContribution = {
      globalFolders: folders,
      linkPrefixes: { ...((linkPrefixes ?? {}) as Record<string, string>) },
    };
    return {
      ok: true,
      value: typeof wikiMain === 'string' ? { ...value, wikiMain } : value,
    };
  },
};

// The binding the strategies give, in source order: every global folder,
// deduped by its path as written; the first `wikiMain`; each link prefix as
// the first strategy to map it maps it. A dropped duplicate or clash logs one
// line.
export function mergeDocs(
  strategies: readonly Strategy<DocsContribution>[],
  log: PluginLog,
): Omit<DocsBinding, 'features'> {
  const globalFolders: DocsGlobalFolder[] = [];
  const folderOwners = new Map<string, string>();
  const linkPrefixes: Record<string, string> = {};
  const prefixOwners = new Map<string, string>();
  let wikiMain: string | null = null;
  for (const strategy of strategies) {
    for (const folder of strategy.value.globalFolders ?? []) {
      const owner = folderOwners.get(folder.path);
      if (owner !== undefined) {
        log(
          `docs: global folder ${folder.path} from ${strategy.id} dropped: ${owner} lists it`,
        );
        continue;
      }
      folderOwners.set(folder.path, strategy.id);
      globalFolders.push({
        path: folder.path,
        referenceFiles: folder.referenceFiles ?? [],
        subfolders: folder.subfolders ?? [],
        skip: folder.skip ?? [],
      });
    }
    wikiMain ??= strategy.value.wikiMain ?? null;
    for (const [prefix, pluginKey] of Object.entries(
      strategy.value.linkPrefixes ?? {},
    )) {
      const owner = prefixOwners.get(prefix);
      if (owner !== undefined) {
        log(
          `docs: link prefix ${prefix} from ${strategy.id} dropped: ${owner} maps it`,
        );
        continue;
      }
      prefixOwners.set(prefix, strategy.id);
      linkPrefixes[prefix] = pluginKey;
    }
  }
  return { globalFolders, wikiMain, linkPrefixes };
}
