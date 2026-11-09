import type { Files, FileWatch } from '../../contracts/files';
import type { LayoutEntry, LayoutSet } from '../../contracts/layouts';
import type { Log } from '../../contracts/log';
import { errorText } from '../error-text';

// The layouts in an owner's layouts folder, each at the revision the page
// loads it at, after the owner's `default`. A save of a code, style, data,
// image or font file in any layout's folder lists the layouts again and sends
// the new set, naming that layout as changed; so does renaming, moving or
// deleting a layout's whole folder. `default` is live while the owner's
// default folder holds `layout.js`, and built in otherwise; a save of its
// `layout.js` or `layout.css` sends the set naming `default`. A watch failure
// is logged, and saves then go unseen until the next start; a default watch
// that fails to start leaves the user layouts listed and watched.
export interface LayoutRegistry {
  current(): LayoutSet;
  names(): string[];
  dispose(): void;
}

export interface LayoutRegistryDeps {
  // Scoped to the owner's layouts folder, `layouts/<owner>/`.
  folder: Files;
  // Scoped to the owner's default folder in the repo clone; null with no
  // clone. Watched only when the folder exists at start, and never made.
  defaultFolder: Files | null;
  send(set: LayoutSet): void;
  log: Log;
  // The source name every log line carries: the owner's id, which the lines
  // about a user `default` folder and the default-folder watch name too.
  logSource: string;
  // The text of the owner's `layout.d.ts`, written to the folder's root at
  // start with its repo kit specifier rewritten to `'../kit'`.
  layoutTypes: string;
}

// The folder's root, as its scoped `Files` names it.
const ROOT = '';
const DEFAULT_NAME = 'default';
// The files directly in the default folder that make and style a live
// default; any other file there changes nothing.
const DEFAULT_CODE = 'layout.js';
const DEFAULT_STYLE = 'layout.css';
const BUILT_IN_DEFAULT: LayoutEntry = {
  name: DEFAULT_NAME,
  revision: 1,
  hasCss: false,
  builtIn: true,
};
// How an owner's repo `layout.d.ts` names the shared kit types, and how its
// copy in the user's folder names them, beside `layouts/kit.d.ts`.
const REPO_KIT_SPECIFIER = "'../../../shared/page/layout-host/kit'";
const USER_KIT_SPECIFIER = "'../kit'";
// The files a layout can load: code, style, data, images and fonts. Saves of
// any other file, such as an editor's swap or backup file, change nothing.
const LAYOUT_FILE =
  /\.(js|mjs|css|json|svg|png|jpg|jpeg|gif|webp|woff|woff2|ttf|otf)$/;

// Whether a save of `fileName` can change what a layout loads: a code, style,
// data, image or font file whose name does not start with `.`.
export function isLayoutFileName(fileName: string): boolean {
  return LAYOUT_FILE.test(fileName) && !fileName.startsWith('.');
}

// An owner's repo `layout.d.ts` text as the user's folder holds it: its kit
// specifier rewritten to name `layouts/kit.d.ts`.
export function userLayoutTypes(layoutTypes: string): string {
  return layoutTypes.replaceAll(REPO_KIT_SPECIFIER, USER_KIT_SPECIFIER);
}

interface ListedLayout {
  name: string;
  hasCss: boolean;
}

// What the default folder holds: whether it makes a live default, and whether
// that default has a stylesheet.
interface DefaultFiles {
  hasCode: boolean;
  hasCss: boolean;
}

async function listDefaultFiles(defaultFolder: Files): Promise<DefaultFiles> {
  const names = new Set(
    (await defaultFolder.list(ROOT))
      .filter((entry) => entry.kind === 'file')
      .map((entry) => entry.path),
  );
  return { hasCode: names.has(DEFAULT_CODE), hasCss: names.has(DEFAULT_STYLE) };
}

async function isFolder(files: Files): Promise<boolean> {
  return (await files.stat(ROOT))?.isFolder === true;
}

export async function startLayoutRegistry(
  deps: LayoutRegistryDeps,
): Promise<LayoutRegistry> {
  const { folder, defaultFolder, send, log, logSource } = deps;
  let defaultSkipLogged = false;
  // Each user layout's revision, kept for the life of the process so a layout
  // that goes and comes back never reuses a revision.
  const revisions = new Map<string, number>();
  // The live default's revision: it rises on every default change the
  // registry announces and never resets, so a default that goes built in and
  // comes back live takes a revision above every earlier one.
  let defaultRevision = 1;
  let queue: Promise<unknown> = Promise.resolve();

  const listLayouts = async (): Promise<ListedLayout[]> => {
    const entries = await folder.list(ROOT, { recursive: true });
    const files = new Set(
      entries
        .filter((entry) => entry.kind === 'file')
        .map((entry) => entry.path),
    );
    const userNames = entries
      .filter((entry) => entry.kind === 'folder' && !entry.path.includes('/'))
      .map((entry) => entry.path)
      .filter((name) => files.has(`${name}/layout.js`));
    if (userNames.includes(DEFAULT_NAME) && !defaultSkipLogged) {
      defaultSkipLogged = true;
      log(
        logSource,
        `layouts/${logSource}/default is ignored; the app's default layout wins`,
      );
    }
    return userNames
      .filter((name) => name !== DEFAULT_NAME)
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ name, hasCss: files.has(`${name}/layout.css`) }));
  };

  // Gives every listed user layout the registry has not seen revision 1.
  const holdListing = (layouts: ListedLayout[]): ListedLayout[] => {
    for (const layout of layouts) {
      if (!revisions.has(layout.name)) {
        revisions.set(layout.name, 1);
      }
    }
    return layouts;
  };

  const defaultEntryOf = (files: DefaultFiles): LayoutEntry =>
    files.hasCode
      ? {
          name: DEFAULT_NAME,
          revision: defaultRevision,
          hasCss: files.hasCss,
          builtIn: false,
        }
      : BUILT_IN_DEFAULT;

  await folder.write('layout.d.ts', userLayoutTypes(deps.layoutTypes));
  let listed = holdListing(await listLayouts());
  // `Files.watch` makes a missing folder, so a default folder missing at start
  // stays unwatched until the next start.
  const watchedDefault =
    defaultFolder !== null && (await isFolder(defaultFolder))
      ? defaultFolder
      : null;
  let defaultEntry =
    watchedDefault === null
      ? BUILT_IN_DEFAULT
      : defaultEntryOf(await listDefaultFiles(watchedDefault));

  const entry = (layout: ListedLayout): LayoutEntry => ({
    name: layout.name,
    revision: revisions.get(layout.name) ?? 1,
    hasCss: layout.hasCss,
    builtIn: false,
  });

  const setOf = (changed: string | null): LayoutSet => ({
    layouts: [defaultEntry, ...listed.map(entry)],
    changed,
  });

  // Runs `work` after every earlier queued step, so two listings never
  // interleave.
  const serially = <T>(work: () => Promise<T>): Promise<T> => {
    const run = queue.then(work);
    queue = run.catch(() => undefined);
    return run;
  };

  // Lists again after a change in the layout folder `name` and announces it
  // when `name` is a layout now or was one before; a folder that never held a
  // layout sends nothing.
  const relist = async (name: string): Promise<void> => {
    const layouts = await listLayouts();
    const wasListed = listed.some((layout) => layout.name === name);
    const isListed = layouts.some((layout) => layout.name === name);
    if (!wasListed && !isListed) {
      return;
    }
    const seen = revisions.get(name);
    revisions.set(name, seen === undefined ? 1 : seen + 1);
    listed = holdListing(layouts);
    send(setOf(name));
  };

  // Lists the default folder again and announces `default` when it is live
  // now or was before; a change while it stays built in sends nothing.
  const relistDefault = async (watched: Files): Promise<void> => {
    const files = await listDefaultFiles(watched);
    if (defaultEntry.builtIn && !files.hasCode) {
      return;
    }
    defaultRevision += 1;
    defaultEntry = defaultEntryOf(files);
    send(setOf(DEFAULT_NAME));
  };

  const relistInTurn = (name: string) => {
    serially(() => relist(name)).catch((error: unknown) =>
      log(logSource, `layout ${name} not reloaded: ${errorText(error)}`),
    );
  };

  // A path with no slash names a whole entry in the folder, as a watch reports
  // a folder renamed, moved or deleted; `relist` sends nothing for a name that
  // never was a layout, `layout.d.ts` included.
  const onChange = (changed: string) => {
    const slash = changed.indexOf('/');
    if (slash === -1) {
      if (changed !== DEFAULT_NAME) {
        relistInTurn(changed);
      }
      return;
    }
    const name = changed.slice(0, slash);
    const fileName = changed.slice(changed.lastIndexOf('/') + 1);
    if (name === DEFAULT_NAME || !isLayoutFileName(fileName)) {
      return;
    }
    relistInTurn(name);
  };

  const watch = folder.watch(ROOT, onChange, {
    onError: (error) =>
      log(logSource, `layouts watch failed: ${errorText(error)}`),
  });

  const logDefaultWatchFailed = (error: unknown) =>
    log(logSource, `default layout watch failed: ${errorText(error)}`);

  // Not recursive: a change in a subfolder reports the subfolder's name, which
  // is neither file a default loads.
  const watchDefault = (watched: Files): FileWatch | null => {
    try {
      return watched.watch(
        ROOT,
        (changed) => {
          if (changed !== DEFAULT_CODE && changed !== DEFAULT_STYLE) {
            return;
          }
          serially(() => relistDefault(watched)).catch((error: unknown) =>
            log(logSource, `layout default not reloaded: ${errorText(error)}`),
          );
        },
        { recursive: false, onError: logDefaultWatchFailed },
      );
    } catch (error) {
      logDefaultWatchFailed(error);
      return null;
    }
  };

  const defaultWatch =
    watchedDefault === null ? null : watchDefault(watchedDefault);

  return {
    current: () => setOf(null),
    names: () => [DEFAULT_NAME, ...listed.map((layout) => layout.name)],
    dispose: () => {
      watch.dispose();
      defaultWatch?.dispose();
    },
  };
}
