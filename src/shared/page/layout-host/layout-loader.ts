import type {
  LayoutEntry,
  LayoutOwner,
  LayoutSet,
} from '../../../contracts/layouts';

// `layoutUrl` is the URL of the file at `path` in the owner's layout `name`, at
// `revision`. `owner` marks each stylesheet link.
export interface LayoutLoaderDeps<L> {
  owner: LayoutOwner;
  importModule(url: string): Promise<unknown>;
  layoutUrl(name: string, revision: number, path: string): string;
  defaultLayout: L;
  head: HTMLElement;
  // The owner's reader: the layout a user's `layout.js` module
  // holds, or a throw naming the first part it gets wrong.
  read(module: unknown, name: string): L;
}

// One load's outcome: `default`, every layout with a good version among the
// names asked for, and every other layout the set lists whose good version is
// at the set's revision; the entries this load imported and read; and the
// entries whose import or read failed in this load.
export interface LayoutLoad<L> {
  layouts: ReadonlyMap<string, L>;
  loaded: LayoutEntry[];
  failed: { entry: LayoutEntry; error: unknown }[];
}

// `dispose` removes every stylesheet link the loader added; a load after it
// adds them again.
export interface LayoutLoader<L> {
  load(set: LayoutSet, names: readonly string[]): Promise<LayoutLoad<L>>;
  dispose(): void;
}

const DEFAULT_NAME = 'default';

// The URLs of a user layout's files, at its revision.
function layoutUrls(
  entry: LayoutEntry,
  layoutUrl: LayoutLoaderDeps<unknown>['layoutUrl'],
): { script: string; style: string | null } {
  return {
    script: layoutUrl(entry.name, entry.revision, 'layout.js'),
    style: entry.hasCss
      ? layoutUrl(entry.name, entry.revision, 'layout.css')
      : null,
  };
}

// A layout that loaded and read, and the entry it loaded at.
interface GoodVersion<L> {
  layout: L;
  entry: LayoutEntry;
}

// An import and read of one entry, settled.
type Attempt<L> =
  | { entry: LayoutEntry; layout: L }
  | { entry: LayoutEntry; error: unknown };

// Loads the named layouts the set lists, each cached by name and revision: a
// revision that loaded, or failed, is not imported again. A failed name keeps
// its last good version. A name left out of a load stays in its layouts while
// its good version is at the set's revision, so content that names it again
// draws with it before the next load; at another revision it drops out.
// `head` holds one stylesheet link per layout in the load's layouts whose good
// version has CSS, marked `data-layout="<name>"` and
// `data-layout-owner="<owner>"`; a link moves only once its
// name's script has loaded and read, so a failed reload keeps the last good
// look whole, and a layout that drops out loses its link.
export function createLayoutLoader<L>(
  deps: LayoutLoaderDeps<L>,
): LayoutLoader<L> {
  const good = new Map<string, GoodVersion<L>>();
  const failedRevisions = new Map<string, number>();
  const links = new Map<string, HTMLLinkElement>();

  const attempt = async (entry: LayoutEntry): Promise<Attempt<L>> => {
    try {
      const urls = layoutUrls(entry, deps.layoutUrl);
      const module = await deps.importModule(urls.script);
      return { entry, layout: deps.read(module, entry.name) };
    } catch (error) {
      return { entry, error };
    }
  };

  return {
    async load(set, names) {
      const entries = listedEntries(set, names);
      const toImport = entries.filter(
        (entry) =>
          !entry.builtIn &&
          good.get(entry.name)?.entry.revision !== entry.revision &&
          failedRevisions.get(entry.name) !== entry.revision,
      );
      const attempts = await Promise.all(toImport.map(attempt));
      const loaded: LayoutEntry[] = [];
      const failed: LayoutLoad<L>['failed'] = [];
      for (const settled of attempts) {
        if ('error' in settled) {
          failedRevisions.set(settled.entry.name, settled.entry.revision);
          failed.push(settled);
        } else {
          good.set(settled.entry.name, settled);
          failedRevisions.delete(settled.entry.name);
          loaded.push(settled.entry);
        }
      }
      const layouts = new Map<string, L>([[DEFAULT_NAME, deps.defaultLayout]]);
      const shownVersions: GoodVersion<L>[] = [];
      for (const entry of set.layouts) {
        const version = entry.builtIn ? undefined : good.get(entry.name);
        const isAsked = entries.includes(entry);
        const isCurrent = version?.entry.revision === entry.revision;
        if (version !== undefined && (isAsked || isCurrent)) {
          layouts.set(entry.name, version.layout);
          shownVersions.push(version);
        }
      }
      syncStylesheets(shownVersions, links, deps);
      return { layouts, loaded, failed };
    },
    dispose() {
      for (const link of links.values()) {
        link.remove();
      }
      links.clear();
    },
  };
}

// The set's entry for each distinct name in `names`, skipping a name the set
// does not list.
function listedEntries(
  set: LayoutSet,
  names: readonly string[],
): LayoutEntry[] {
  return [...new Set(names)].flatMap((name) =>
    set.layouts.filter((entry) => entry.name === name),
  );
}

// Leaves `head` holding one stylesheet link per version with CSS, its href at
// that version's revision, and removes every other layout's link.
function syncStylesheets<L>(
  versions: GoodVersion<L>[],
  links: Map<string, HTMLLinkElement>,
  deps: Pick<LayoutLoaderDeps<L>, 'owner' | 'layoutUrl' | 'head'>,
): void {
  const styled = new Map<string, string>();
  for (const { entry } of versions) {
    const { style } = layoutUrls(entry, deps.layoutUrl);
    if (style !== null) {
      styled.set(entry.name, style);
    }
  }
  for (const [name, link] of links) {
    if (!styled.has(name)) {
      link.remove();
      links.delete(name);
    }
  }
  for (const [name, href] of styled) {
    let link = links.get(name);
    if (link === undefined) {
      link = deps.head.ownerDocument.createElement('link');
      link.rel = 'stylesheet';
      link.dataset.layout = name;
      link.dataset.layoutOwner = deps.owner;
      deps.head.append(link);
      links.set(name, link);
    }
    link.href = href;
  }
}
