import type { LayoutEntry, LayoutSet } from '../../contracts/layouts';
import type { Log } from '../../contracts/log';
import type { ToastTone } from '../../contracts/plugin';
import { errorText } from '../error-text';

export interface LayoutLoaderDeps<L> {
  importModule(url: string): Promise<unknown>;
  dataUrl(path: string, revision: number): string;
  defaultLayout: L;
  head: HTMLElement;
  // The plugin's layout validator: the layout a user's `layout.js` module
  // holds, or a throw naming the first part it lacks.
  read(module: unknown, name: string): L;
}

export interface LayoutLoader<L> {
  load(entry: LayoutEntry): Promise<L>;
}

// The URLs of a user layout's files in the plugin's data folder, at its revision.
export function layoutUrls(
  entry: LayoutEntry,
  dataUrl: (path: string, revision: number) => string,
): { script: string; style: string | null } {
  const folder = `layouts/${entry.name}`;
  return {
    script: dataUrl(`${folder}/layout.js`, entry.revision),
    style: entry.hasCss
      ? dataUrl(`${folder}/layout.css`, entry.revision)
      : null,
  };
}

// Loads each layout it is handed, keeping one stylesheet link in `head` for the
// user layout's CSS. The stylesheet changes only once the script has loaded,
// so a failed load keeps the last good look whole.
export function createLayoutLoader<L>(
  deps: LayoutLoaderDeps<L>,
): LayoutLoader<L> {
  let link: HTMLLinkElement | null = null;
  const showStyle = (url: string | null) => {
    if (url === null) {
      link?.remove();
      link = null;
      return;
    }
    if (link === null) {
      link = deps.head.ownerDocument.createElement('link');
      link.rel = 'stylesheet';
      deps.head.append(link);
    }
    link.href = url;
  };
  return {
    async load(entry) {
      if (entry.builtIn) {
        showStyle(null);
        return deps.defaultLayout;
      }
      const urls = layoutUrls(entry, deps.dataUrl);
      const layout = deps.read(
        await deps.importModule(urls.script),
        entry.name,
      );
      showStyle(urls.style);
      return layout;
    },
  };
}

// Main's layout channel as the page hears it: `layoutChanged` messages and the
// `layout` answer.
export interface LayoutChannel {
  onLayoutChanged(listener: (set: LayoutSet) => void): void;
  readLayout(): Promise<LayoutSet>;
}

export interface ShowLayoutsDeps<L> {
  channel: LayoutChannel;
  loader: LayoutLoader<L>;
  // The name of the layout the user chose, read again on each set and on each
  // `onChosenChanged`.
  chosen(): string;
  onChosenChanged(listener: () => void): void;
  setLayout(layout: L, name: string): void;
  log: Log;
  // The source name every log line carries.
  logSource: string;
  toast(text: string, tone: ToastTone): void;
}

const DEFAULT_NAME = 'default';

// Shows the chosen layout from main's latest set, or `default` when the set
// does not hold it, and loads it again whenever a set or a new choice changes
// its name or revision, so a change in a layout nobody draws loads nothing.
// Loads run one at a time in arrival order; a layout that fails to load leaves
// the current one shown, and its next revision is tried again. A set heard
// before main answers `layout` is newer, so the answer is then dropped.
export function showLayouts<L>(deps: ShowLayoutsDeps<L>): void {
  const { channel, loader, log, logSource, toast } = deps;
  let queue = Promise.resolve();
  let heardChange = false;
  let latest: LayoutSet | null = null;
  let queued: LayoutEntry | null = null;
  let missingLogged: string | null = null;

  const shown = (layout: L, entry: LayoutEntry) => {
    deps.setLayout(layout, entry.name);
    log(logSource, `layout ${entry.name} shown (revision ${entry.revision})`);
  };
  const failed = (error: unknown, entry: LayoutEntry) => {
    log(logSource, `layout ${entry.name} failed: ${errorText(error)}`);
    toast(`Layout ${entry.name} failed: ${errorText(error)}`, 'error');
  };
  const show = (entry: LayoutEntry) => {
    queue = queue
      .then(() =>
        loader.load(entry).then(
          (layout) => shown(layout, entry),
          (error: unknown) => failed(error, entry),
        ),
      )
      .catch((error: unknown) =>
        log(logSource, `layout ${entry.name} not shown: ${errorText(error)}`),
      );
  };

  // The set's entry for the chosen layout, or its `default` entry, logging a
  // missing name once until the choice changes or is found.
  const target = (set: LayoutSet): LayoutEntry => {
    const name = deps.chosen();
    const found = set.layouts.find((layout) => layout.name === name);
    if (found !== undefined) {
      missingLogged = null;
      return found;
    }
    if (missingLogged !== name) {
      missingLogged = name;
      log(logSource, `layout ${name} not found, drawing ${DEFAULT_NAME}`);
    }
    const fallback = set.layouts.find((layout) => layout.builtIn);
    if (fallback === undefined) {
      throw new Error(`layout set holds no ${DEFAULT_NAME} entry`);
    }
    return fallback;
  };

  const showTarget = () => {
    if (latest === null) {
      return;
    }
    const entry = target(latest);
    const isQueued =
      queued !== null &&
      queued.name === entry.name &&
      queued.revision === entry.revision;
    if (isQueued) {
      return;
    }
    queued = entry;
    show(entry);
  };

  const heard = (set: LayoutSet) => {
    latest = set;
    showTarget();
  };

  channel.onLayoutChanged((set) => {
    heardChange = true;
    heard(set);
  });
  deps.onChosenChanged(showTarget);
  channel
    .readLayout()
    .then((set) => {
      if (!heardChange) {
        heard(set);
      }
    })
    .catch((error: unknown) =>
      log(logSource, `layout not read: ${errorText(error)}`),
    );
}
