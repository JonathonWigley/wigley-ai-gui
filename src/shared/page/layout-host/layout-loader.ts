import {
  DEFAULT_LAYOUT_NAME,
  type LayoutEntry,
  type LayoutOwner,
  type LayoutSet,
} from '../../../contracts/layouts';
import { isRecord } from './read-layout-module';

// `layoutUrl` is the URL of the file at `path` in the owner's layout `name`, at
// `revision`: the entry's `revision` for its script, its `styleRevision` for
// its stylesheet. `owner` marks each stylesheet link. `defaultLayout` is the
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
// at the set's revision; the entries this load imported and read; the entries
// whose import, read or part check failed in this load; and, in the set's
// order, the entries whose good version is at that entry and whose stylesheet
// link this load moved, added or removed without importing their script, a
// built-in `default` left out.
export interface LayoutLoad<L> {
  layouts: ReadonlyMap<string, L>;
  loaded: LayoutEntry[];
  failed: { entry: LayoutEntry; error: unknown }[];
  restyled: LayoutEntry[];
}

// `dispose` removes every stylesheet link the loader added, the default's
// included; a load after it adds them again.
export interface LayoutLoader<L> {
  load(set: LayoutSet, names: readonly string[]): Promise<LayoutLoad<L>>;
  dispose(): void;
}

// The URLs of a layout's files: its script at its revision, its stylesheet at
// its style revision.
function layoutUrls(
  entry: LayoutEntry,
  layoutUrl: LayoutLoaderDeps<unknown>['layoutUrl'],
): { script: string; style: string | null } {
  return {
    script: layoutUrl(entry.name, entry.revision, 'layout.js'),
    style: entry.hasCss
      ? layoutUrl(entry.name, entry.styleRevision, 'layout.css')
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

// A stylesheet link and the href the loader last set on it; a browser
// resolves `element.href` to an absolute URL, so it is never compared. The
// default's link, made once, is in `head` while `href` is not null.
interface StyleLink {
  element: HTMLLinkElement;
  href: string | null;
}

// Loads the named layouts the set lists, and `default` on every load, each
// module cached by name and revision: a revision that loaded, or failed, is
// not imported again; each stylesheet link's URL holds the version's
// `styleRevision`, so a change of style alone moves the link and imports
// nothing. A built-in entry is never imported. A live `default` (an
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
// follows the set entry while its name's good version is at the entry's
// revision, and moves to a new revision only once that script has loaded and
// read, so a failed reload keeps the last good look whole; a layout that drops
// out loses its link.
// The default link is in `head` from creation when `defaultStylesheet` is set.
export function createLayoutLoader<L>(
  deps: LayoutLoaderDeps<L>,
): LayoutLoader<L> {
  const good = new Map<string, GoodVersion<L>>();
  const failedRevisions = new Map<string, number>();
  const links = new Map<string, StyleLink>();
  const defaultLink: StyleLink = {
    element: createLink(DEFAULT_LAYOUT_NAME, deps),
    href: null,
  };
  placeDefaultLink(deps.defaultStylesheet, defaultLink, links, deps.head);

  const attempt = async (entry: LayoutEntry): Promise<Attempt<L>> => {
    try {
      const urls = layoutUrls(entry, deps.layoutUrl);
      const module = await deps.importModule(urls.script);
      const layout = deps.read(module, entry.name);
      if (entry.name === DEFAULT_LAYOUT_NAME) {
        requireEveryDefaultPart(layout, deps.defaultLayout);
      }
      return { entry, layout };
    } catch (error) {
      return { entry, error };
    }
  };

  return {
    async load(set, names) {
      const entries = listedEntries(set, [...names, DEFAULT_LAYOUT_NAME]);
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
      followSetEntries(set, good);
      const layouts = new Map<string, L>([
        [DEFAULT_LAYOUT_NAME, deps.defaultLayout],
      ]);
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
      const relinked = syncStylesheets(shownVersions, links, deps);
      const isDefaultRelinked = placeDefaultLink(
        defaultStylesheetHref(shownVersions, deps),
        defaultLink,
        links,
        deps.head,
      );
      if (isDefaultRelinked) {
        relinked.add(DEFAULT_LAYOUT_NAME);
      }
      const imported = new Set(toImport.map((entry) => entry.name));
      // A built-in entry, or one whose good version is older, is never the
      // good version's entry.
      const restyled = set.layouts.filter(
        (entry) =>
          relinked.has(entry.name) &&
          !imported.has(entry.name) &&
          good.get(entry.name)?.entry === entry,
      );
      return { layouts, loaded, failed, restyled };
    },
    dispose() {
      for (const link of links.values()) {
        link.element.remove();
      }
      links.clear();
      defaultLink.element.remove();
      defaultLink.href = null;
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
      throw new Error(`layout ${DEFAULT_LAYOUT_NAME} has no ${key}`);
    }
    if (isRecord(part)) {
      const liveNested = isRecord(liveParts[key]) ? liveParts[key] : {};
      for (const [nestedKey, nestedPart] of Object.entries(part)) {
        const isMissing =
          typeof nestedPart === 'function' &&
          typeof liveNested[nestedKey] !== 'function';
        if (isMissing) {
          throw new Error(
            `layout ${DEFAULT_LAYOUT_NAME} has no ${key}.${nestedKey}`,
          );
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
  const live = versions.find(({ entry }) => entry.name === DEFAULT_LAYOUT_NAME);
  return live === undefined
    ? deps.defaultStylesheet
    : layoutUrls(live.entry, deps.layoutUrl).style;
}

// Detaches the default link when `href` is null; else sets its href and, when
// detached, puts it back before the first user layout's link, else at the end
// of `head`. True when `href` differs from the one it held.
function placeDefaultLink(
  href: string | null,
  defaultLink: StyleLink,
  links: Map<string, StyleLink>,
  head: HTMLElement,
): boolean {
  const wasAttached = defaultLink.href !== null;
  if (href === defaultLink.href) {
    return false;
  }
  defaultLink.href = href;
  if (href === null) {
    defaultLink.element.remove();
    return true;
  }
  defaultLink.element.href = href;
  if (!wasAttached) {
    const firstUserLink = links.values().next().value;
    if (firstUserLink === undefined) {
      head.append(defaultLink.element);
    } else {
      head.insertBefore(defaultLink.element, firstUserLink.element);
    }
  }
  return true;
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

// Stores each set entry on its name's good version while that version is at
// the entry's revision, so its stylesheet follows the entry's `styleRevision`
// and `hasCss`. A good version at an older revision keeps its own entry.
function followSetEntries<L>(
  set: LayoutSet,
  good: Map<string, GoodVersion<L>>,
): void {
  for (const entry of set.layouts) {
    const version = good.get(entry.name);
    const isCurrent =
      !entry.builtIn && version?.entry.revision === entry.revision;
    if (version !== undefined && isCurrent) {
      good.set(entry.name, { layout: version.layout, entry });
    }
  }
}

// Leaves `head` holding one stylesheet link per user layout version with CSS,
// its href at that version's style revision, and removes every other user
// layout's link. The default's link is placed apart. Returns the names whose
// link it added, moved or removed.
function syncStylesheets<L>(
  versions: GoodVersion<L>[],
  links: Map<string, StyleLink>,
  deps: Pick<LayoutLoaderDeps<L>, 'owner' | 'layoutUrl' | 'head'>,
): Set<string> {
  const relinked = new Set<string>();
  const styled = new Map<string, string>();
  for (const { entry } of versions) {
    const { style } = layoutUrls(entry, deps.layoutUrl);
    if (style !== null && entry.name !== DEFAULT_LAYOUT_NAME) {
      styled.set(entry.name, style);
    }
  }
  for (const [name, link] of links) {
    if (!styled.has(name)) {
      link.element.remove();
      links.delete(name);
      relinked.add(name);
    }
  }
  for (const [name, href] of styled) {
    let link = links.get(name);
    if (link === undefined) {
      link = { element: createLink(name, deps), href: null };
      deps.head.append(link.element);
      links.set(name, link);
    }
    if (link.href !== href) {
      link.element.href = href;
      link.href = href;
      relinked.add(name);
    }
  }
  return relinked;
}
