import type {
  LayoutEntry,
  LayoutOwner,
  LayoutSet,
} from '../../../contracts/layouts';
import { isRecord } from './read-layout-module';

// `layoutUrl` is the URL of the file at `path` in the owner's layout `name`, at
// `revision`. `owner` marks each stylesheet link. `defaultLayout` is the
// bundled default and `defaultStylesheet` the bundled URL of its CSS, null for
// an owner with no default CSS.
export interface LayoutLoaderDeps<L> {
  owner: LayoutOwner;
  importModule(url: string): Promise<unknown>;
  layoutUrl(name: string, revision: number, path: string): string;
  defaultLayout: L;
  defaultStylesheet: string | null;
  head: HTMLElement;
  // The owner's reader: the layout a user's `layout.js` module holds, or a
  // throw naming the first part it gets wrong.
  read(module: unknown, name: string): L;
}

// One load's outcome: `default`, every layout with a good version among the
// names asked for, and every other layout the set lists whose good version is
// at the set's revision; the entries this load imported and read; and the
// entries whose import, read or part check failed in this load.
export interface LayoutLoad<L> {
  layouts: ReadonlyMap<string, L>;
  loaded: LayoutEntry[];
  failed: { entry: LayoutEntry; error: unknown }[];
}

// `dispose` removes every stylesheet link the loader added, the default's
// included; a load after it adds them again.
export interface LayoutLoader<L> {
  load(set: LayoutSet, names: readonly string[]): Promise<LayoutLoad<L>>;
  dispose(): void;
}

const DEFAULT_NAME = 'default';

// The URLs of a layout's files, at its revision.
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

// The default's stylesheet link, made once, and whether it is in `head`.
interface DefaultLink {
  element: HTMLLinkElement;
  isAttached: boolean;
}

// Loads the named layouts the set lists, and `default` on every load, each
// cached by name and revision: a revision that loaded, or failed, is not
// imported again. A built-in entry is never imported. A live `default` (an
// entry not built in) is read with the owner's reader and must define every
// part the bundled default defines. A failed name keeps its last good
// version; `default` without one, or built in, is the bundled default. A name
// left out of a load stays in its layouts while its good version is at the
// set's revision, so content that names it again draws with it before the
// next load; at another revision it drops out.
// `head` holds one stylesheet link per user layout in the load's layouts whose
// good version has CSS, marked `data-layout="<name>"` and
// `data-layout-owner="<owner>"`, and one `default` link before them: the live
// default's CSS while a live default is in the load's layouts, else
// `defaultStylesheet`; with no such CSS the default link is detached. A link
// moves only once its name's script has loaded and read, so a failed reload
// keeps the last good look whole, and a layout that drops out loses its link.
// The default link is in `head` from creation when `defaultStylesheet` is set.
export function createLayoutLoader<L>(
  deps: LayoutLoaderDeps<L>,
): LayoutLoader<L> {
  const good = new Map<string, GoodVersion<L>>();
  const failedRevisions = new Map<string, number>();
  const links = new Map<string, HTMLLinkElement>();
  const defaultLink: DefaultLink = {
    element: createLink(DEFAULT_NAME, deps),
    isAttached: false,
  };
  placeDefaultLink(deps.defaultStylesheet, defaultLink, links, deps.head);

  const attempt = async (entry: LayoutEntry): Promise<Attempt<L>> => {
    try {
      const urls = layoutUrls(entry, deps.layoutUrl);
      const module = await deps.importModule(urls.script);
      const layout = deps.read(module, entry.name);
      if (entry.name === DEFAULT_NAME) {
        requireEveryDefaultPart(layout, deps.defaultLayout);
      }
      return { entry, layout };
    } catch (error) {
      return { entry, error };
    }
  };

  return {
    async load(set, names) {
      const entries = listedEntries(set, [...names, DEFAULT_NAME]);
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
      placeDefaultLink(
        defaultStylesheetHref(shownVersions, deps),
        defaultLink,
        links,
        deps.head,
      );
      return { layouts, loaded, failed };
    },
    dispose() {
      for (const link of links.values()) {
        link.remove();
      }
      links.clear();
      defaultLink.element.remove();
      defaultLink.isAttached = false;
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

// Throws `layout default has no <part>` for the first key of `bundled` whose
// value is a function that `live` does not hold as a function, checking each
// object `bundled` holds by its own function keys, named `<key>.<part>`.
function requireEveryDefaultPart(live: unknown, bundled: unknown): void {
  const liveParts = isRecord(live) ? live : {};
  for (const [key, part] of Object.entries(bundled as object)) {
    if (typeof part === 'function' && typeof liveParts[key] !== 'function') {
      throw new Error(`layout ${DEFAULT_NAME} has no ${key}`);
    }
    if (isRecord(part)) {
      const liveNested = isRecord(liveParts[key]) ? liveParts[key] : {};
      for (const [nestedKey, nestedPart] of Object.entries(part)) {
        const isMissing =
          typeof nestedPart === 'function' &&
          typeof liveNested[nestedKey] !== 'function';
        if (isMissing) {
          throw new Error(`layout ${DEFAULT_NAME} has no ${key}.${nestedKey}`);
        }
      }
    }
  }
}

// The default link's href: the live default's CSS while a live default is
// among `versions` (null when it has none), else `defaultStylesheet`.
function defaultStylesheetHref<L>(
  versions: GoodVersion<L>[],
  deps: Pick<LayoutLoaderDeps<L>, 'layoutUrl' | 'defaultStylesheet'>,
): string | null {
  const live = versions.find(({ entry }) => entry.name === DEFAULT_NAME);
  return live === undefined
    ? deps.defaultStylesheet
    : layoutUrls(live.entry, deps.layoutUrl).style;
}

// Detaches the default link when `href` is null; else sets its href and, when
// detached, puts it back before the first user layout's link, else at the end
// of `head`.
function placeDefaultLink(
  href: string | null,
  defaultLink: DefaultLink,
  links: Map<string, HTMLLinkElement>,
  head: HTMLElement,
): void {
  if (href === null) {
    defaultLink.element.remove();
    defaultLink.isAttached = false;
    return;
  }
  defaultLink.element.href = href;
  if (!defaultLink.isAttached) {
    const firstUserLink = links.values().next().value;
    if (firstUserLink === undefined) {
      head.append(defaultLink.element);
    } else {
      head.insertBefore(defaultLink.element, firstUserLink);
    }
    defaultLink.isAttached = true;
  }
}

// A stylesheet link marked with the layout `name` and the owner.
function createLink(
  name: string,
  deps: Pick<LayoutLoaderDeps<unknown>, 'owner' | 'head'>,
): HTMLLinkElement {
  const link = deps.head.ownerDocument.createElement('link');
  link.rel = 'stylesheet';
  link.dataset.layout = name;
  link.dataset.layoutOwner = deps.owner;
  return link;
}

// Leaves `head` holding one stylesheet link per user layout version with CSS,
// its href at that version's revision, and removes every other user layout's
// link. The default's link is placed apart.
function syncStylesheets<L>(
  versions: GoodVersion<L>[],
  links: Map<string, HTMLLinkElement>,
  deps: Pick<LayoutLoaderDeps<L>, 'owner' | 'layoutUrl' | 'head'>,
): void {
  const styled = new Map<string, string>();
  for (const { entry } of versions) {
    const { style } = layoutUrls(entry, deps.layoutUrl);
    if (style !== null && entry.name !== DEFAULT_NAME) {
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
      link = createLink(name, deps);
      deps.head.append(link);
      links.set(name, link);
    }
    link.href = href;
  }
}
