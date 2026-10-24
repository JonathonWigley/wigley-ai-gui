import type { Files } from '../../contracts/files';
import type { LayoutEntry, LayoutSet } from '../../contracts/layouts';
import type { Log } from '../../contracts/log';
import { errorText } from '../error-text';

// The layouts in a plugin's data folder, each at the revision the page loads
// it at. A save of a code, style, data, image or font file in any layout's
// folder lists the layouts again and sends the new set, naming that layout as
// changed. A watch failure is logged, and saves then go unseen until the next
// start.
export interface LayoutRegistry {
  current(): LayoutSet;
  names(): string[];
  dispose(): void;
}

export interface LayoutRegistryDeps {
  // Scoped to the plugin's data folder.
  data: Files;
  send(set: LayoutSet): void;
  log: Log;
  // The source name every log line carries.
  logSource: string;
  // The text of `layout.d.ts`, written to `layouts/layout.d.ts` at start.
  layoutTypes: string;
}

const LAYOUTS = 'layouts';
const DEFAULT_NAME = 'default';
// The files a layout can load: code, style, data, images and fonts. Saves of
// any other file, such as an editor's swap or backup file, change nothing.
const LAYOUT_FILE =
  /\.(js|mjs|css|json|svg|png|jpg|jpeg|gif|webp|woff|woff2|ttf|otf)$/;

interface ListedLayout {
  name: string;
  hasCss: boolean;
}

export async function startLayoutRegistry(
  deps: LayoutRegistryDeps,
): Promise<LayoutRegistry> {
  const { data, send, log, logSource } = deps;
  let defaultSkipLogged = false;
  // Each user layout's revision, kept for the life of the process so a layout
  // that goes and comes back never reuses a revision.
  const revisions = new Map<string, number>();
  let queue: Promise<unknown> = Promise.resolve();

  const listLayouts = async (): Promise<ListedLayout[]> => {
    const entries = await data.list(LAYOUTS, { recursive: true });
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
        'layouts/default is ignored; the built-in default layout wins',
      );
    }
    const users = userNames
      .filter((name) => name !== DEFAULT_NAME)
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ name, hasCss: files.has(`${name}/layout.css`) }));
    return [{ name: DEFAULT_NAME, hasCss: false }, ...users];
  };

  // Gives every listed user layout the registry has not seen revision 1.
  const holdListing = (layouts: ListedLayout[]): ListedLayout[] => {
    for (const layout of layouts) {
      if (layout.name !== DEFAULT_NAME && !revisions.has(layout.name)) {
        revisions.set(layout.name, 1);
      }
    }
    return layouts;
  };

  await data.write(`${LAYOUTS}/layout.d.ts`, deps.layoutTypes);
  let listed = holdListing(await listLayouts());

  const entry = (layout: ListedLayout): LayoutEntry => {
    const builtIn = layout.name === DEFAULT_NAME;
    return {
      name: layout.name,
      revision: builtIn ? 1 : (revisions.get(layout.name) ?? 1),
      hasCss: layout.hasCss,
      builtIn,
    };
  };

  const setOf = (changed: string | null): LayoutSet => ({
    layouts: listed.map(entry),
    changed,
  });

  // Runs `work` after every earlier queued step, so two listings never
  // interleave.
  const serially = <T>(work: () => Promise<T>): Promise<T> => {
    const run = queue.then(work);
    queue = run.catch(() => undefined);
    return run;
  };

  // Lists again after a change in `folder` and announces it when `folder` is
  // a layout now or was one before; a folder that never held a layout sends
  // nothing.
  const relist = async (folder: string): Promise<void> => {
    const layouts = await listLayouts();
    const wasListed = listed.some((layout) => layout.name === folder);
    const isListed = layouts.some((layout) => layout.name === folder);
    if (!wasListed && !isListed) {
      return;
    }
    const seen = revisions.get(folder);
    revisions.set(folder, seen === undefined ? 1 : seen + 1);
    listed = holdListing(layouts);
    send(setOf(folder));
  };

  const onChange = (changed: string) => {
    const slash = changed.indexOf('/');
    const folder = slash === -1 ? null : changed.slice(0, slash);
    const fileName = changed.slice(changed.lastIndexOf('/') + 1);
    const isLayoutFile =
      LAYOUT_FILE.test(fileName) && !fileName.startsWith('.');
    if (folder === null || folder === DEFAULT_NAME || !isLayoutFile) {
      return;
    }
    serially(() => relist(folder)).catch((error: unknown) =>
      log(logSource, `layout ${folder} not reloaded: ${errorText(error)}`),
    );
  };

  const watch = data.watch(LAYOUTS, onChange, {
    onError: (error) =>
      log(logSource, `layouts watch failed: ${errorText(error)}`),
  });

  return {
    current: () => setOf(null),
    names: () => listed.map((layout) => layout.name),
    dispose: () => watch.close(),
  };
}
