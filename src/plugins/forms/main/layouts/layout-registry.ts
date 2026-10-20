import type { Files } from '../../../../contracts/files';
import type { Log } from '../../../../contracts/log';
import { errorText } from '../../../../shared/error-text';
import type { LayoutChoice } from '../../contract';

// The layouts in forms' data folder, the active one among them, and the
// revision the page loads them at. `cycle` and `copy` persist the new active
// layout and send it; a save under the active layout's folder sends a reload.
export interface LayoutRegistry {
  current(): LayoutChoice;
  cycle(step: 1 | -1): Promise<LayoutChoice>;
  copy(): Promise<LayoutChoice>;
  dispose(): void;
}

export interface LayoutRegistryDeps {
  // Scoped to forms' data folder.
  data: Files;
  send(choice: LayoutChoice): void;
  log: Log;
  // The text of `layout.d.ts`, written to `layouts/layout.d.ts` at start.
  layoutTypes: string;
  // The text of the built-in `default` layout's `layout.js`.
  defaultLayout: string;
}

const LAYOUTS = 'layouts';
const ACTIVE_FILE = `${LAYOUTS}/active`;
const DEFAULT_NAME = 'default';

interface ListedLayout {
  name: string;
  hasCss: boolean;
}

export async function startLayoutRegistry(
  deps: LayoutRegistryDeps,
): Promise<LayoutRegistry> {
  const { data, send, log } = deps;
  let defaultSkipLogged = false;
  // Paths, relative to `layouts`, the registry wrote whose next watch report
  // is its own write.
  const ownWrites = new Set<string>();
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
        'forms',
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

  const writeOwn = async (relative: string, text: string) => {
    ownWrites.add(relative);
    await data.write(`${LAYOUTS}/${relative}`, text);
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
    if (ownWrites.delete(changed)) {
      return;
    }
    const slash = changed.indexOf('/');
    const folder = slash === -1 ? null : changed.slice(0, slash);
    if (folder === null || folder === DEFAULT_NAME) {
      return;
    }
    revision++;
    if (folder !== active.name) {
      return;
    }
    serially(reloadActive).catch((error: unknown) =>
      log('forms', `layout ${folder} not reloaded: ${errorText(error)}`),
    );
  };

  const watch = data.watch(LAYOUTS, onChange);

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
              const text = await data.read(`${source}/${entry.path}`);
              await writeOwn(`${name}/${entry.path}`, text);
            }
          }
          hasCss = active.hasCss;
        }
        return activate({ name, hasCss }, 'copied');
      }),
    dispose: () => watch.close(),
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
