import type { Files } from '../../contracts/files';
import type { LayoutChoice } from '../../contracts/layouts';
import type { Log } from '../../contracts/log';
import { errorText } from '../error-text';

// The layouts in a plugin's data folder, the active one among them, and the
// revision the page loads them at. `cycle` and `copy` persist the new active
// layout and send it; a save of a code, style, data, image or font file
// under the active layout's folder sends a reload. A watch failure is logged,
// and saves then go unseen until the next start.
export interface LayoutRegistry {
  current(): LayoutChoice;
  cycle(step: 1 | -1): Promise<LayoutChoice>;
  copy(): Promise<LayoutChoice>;
  dispose(): void;
}

export interface LayoutRegistryDeps {
  // Scoped to the plugin's data folder.
  data: Files;
  send(choice: LayoutChoice): void;
  log: Log;
  // The source name every log line carries.
  logSource: string;
  // The text of `layout.d.ts`, written to `layouts/layout.d.ts` at start.
  layoutTypes: string;
  // The text of the built-in `default` layout's `layout.js`.
  defaultLayout: string;
}

const LAYOUTS = 'layouts';
const ACTIVE_FILE = `${LAYOUTS}/active`;
const DEFAULT_NAME = 'default';
// How long a path the registry wrote waits for the watch report of that write.
const OWN_WRITE_MS = 1000;
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
  // Paths, relative to `layouts`, the registry wrote, each with the timer that
  // forgets it OWN_WRITE_MS after its write. A held path's next watch report
  // is the registry's own write.
  const ownWrites = new Map<
    string,
    ReturnType<typeof setTimeout> | undefined
  >();
  let revision = 1;
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

  await data.write(`${LAYOUTS}/layout.d.ts`, deps.layoutTypes);
  const listed = await listLayouts();
  const stored = await readActiveName(data);
  let active = listed.find((layout) => layout.name === stored) ?? listed[0];

  const choice = (reason: LayoutChoice['reason']): LayoutChoice => ({
    name: active.name,
    revision,
    hasCss: active.hasCss,
    builtIn: active.name === DEFAULT_NAME,
    reason,
  });

  const announce = (reason: LayoutChoice['reason']): LayoutChoice => {
    revision++;
    const announced = choice(reason);
    send(announced);
    return announced;
  };

  const activate = async (
    layout: ListedLayout,
    reason: LayoutChoice['reason'],
  ): Promise<LayoutChoice> => {
    active = layout;
    await data.write(ACTIVE_FILE, layout.name);
    return announce(reason);
  };

  // Runs `work` after every earlier queued step, so a cycle, a copy and a
  // reload never interleave.
  const serially = <T>(work: () => Promise<T>): Promise<T> => {
    const run = queue.then(work);
    queue = run.catch(() => undefined);
    return run;
  };

  // Drops the mark on `relative`, true when there was one.
  const forgetOwnWrite = (relative: string): boolean => {
    clearTimeout(ownWrites.get(relative));
    return ownWrites.delete(relative);
  };

  // Marked from before the write, so a report during it is ignored too; the
  // timer starts once the write settles.
  const writeOwn = async (relative: string, content: string | Uint8Array) => {
    forgetOwnWrite(relative);
    ownWrites.set(relative, undefined);
    try {
      const file = `${LAYOUTS}/${relative}`;
      await (typeof content === 'string'
        ? data.write(file, content)
        : data.writeBytes(file, content));
    } finally {
      if (ownWrites.has(relative)) {
        ownWrites.set(
          relative,
          setTimeout(() => ownWrites.delete(relative), OWN_WRITE_MS),
        );
      }
    }
  };

  const reloadActive = async (): Promise<void> => {
    const layouts = await listLayouts();
    const reloaded = layouts.find((layout) => layout.name === active.name);
    if (reloaded === undefined) {
      await activate(layouts[0], 'cycled');
      return;
    }
    active = reloaded;
    announce('reloaded');
  };

  const onChange = (changed: string) => {
    if (forgetOwnWrite(changed)) {
      return;
    }
    const slash = changed.indexOf('/');
    const folder = slash === -1 ? null : changed.slice(0, slash);
    const fileName = changed.slice(changed.lastIndexOf('/') + 1);
    const isLayoutFile =
      LAYOUT_FILE.test(fileName) && !fileName.startsWith('.');
    if (folder === null || folder === DEFAULT_NAME || !isLayoutFile) {
      return;
    }
    if (folder !== active.name) {
      return;
    }
    serially(reloadActive).catch((error: unknown) =>
      log(logSource, `layout ${folder} not reloaded: ${errorText(error)}`),
    );
  };

  const watch = data.watch(LAYOUTS, onChange, (error) =>
    log(logSource, `layouts watch failed: ${errorText(error)}`),
  );

  return {
    current: () => choice('start'),
    cycle: (step) =>
      serially(async () => {
        const layouts = await listLayouts();
        const at = Math.max(
          0,
          layouts.findIndex((layout) => layout.name === active.name),
        );
        const next = layouts[(at + step + layouts.length) % layouts.length];
        return activate(next, 'cycled');
      }),
    copy: () =>
      serially(async () => {
        const layouts = await listLayouts();
        const name = freeCopyName(active.name, layouts);
        let hasCss = false;
        if (active.name === DEFAULT_NAME) {
          await writeOwn(`${name}/layout.js`, deps.defaultLayout);
        } else {
          const source = `${LAYOUTS}/${active.name}`;
          const entries = await data.list(source, { recursive: true });
          for (const entry of entries) {
            if (entry.kind === 'file') {
              const bytes = await data.readBytes(`${source}/${entry.path}`);
              await writeOwn(`${name}/${entry.path}`, bytes);
            }
          }
          hasCss = active.hasCss;
        }
        return activate({ name, hasCss }, 'copied');
      }),
    dispose: () => {
      watch.close();
      for (const timer of ownWrites.values()) {
        clearTimeout(timer);
      }
      ownWrites.clear();
    },
  };
}

// The name in `layouts/active`, or null when the file is absent.
async function readActiveName(data: Files): Promise<string | null> {
  try {
    return (await data.read(ACTIVE_FILE)).trim();
  } catch {
    return null;
  }
}

// `<base>-<n>` for the lowest `n` of 2 or more that no listed layout holds.
function freeCopyName(base: string, layouts: ListedLayout[]): string {
  const names = new Set(layouts.map((layout) => layout.name));
  let n = 2;
  while (names.has(`${base}-${n}`)) {
    n++;
  }
  return `${base}-${n}`;
}
