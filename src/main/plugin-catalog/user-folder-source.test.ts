import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Files } from '../../contracts/files';
import type {
  SourceLoad,
  WatchedPluginSource,
} from '../../contracts/plugin-catalog';
import { createMemoryFiles, type MemoryFiles } from '../../shared/memory-files';
import { posixPaths } from '../../shared/paths/posix-paths';
import {
  createUserFolderSource,
  PLUGIN_IMPORT_TIMEOUT_MS,
  PLUGIN_SETTLE_MS,
} from './user-folder-source';

const USER_ROOT = '/config/plugins';
const CODE_ROOT = '/data/plugin-code';
const GOOD_MODULE = { start: () => ({ commands: {} }) };

let plugins: MemoryFiles;
let code: MemoryFiles;
let imported: string[];
// The module or promise the fake `importModule` gives for a plugin id; a good
// module for any id not set.
let modules: Map<string, Promise<Record<string, unknown>>>;
let logLines: string[];
// The absolute paths the fake `removeFolder` received, in order.
let removed: string[];
// The paths the fake `removeFolder` rejects with `busy`.
let failingRemovals: Set<string>;

beforeEach(() => {
  vi.useFakeTimers();
  plugins = createMemoryFiles();
  code = createMemoryFiles();
  imported = [];
  modules = new Map();
  logLines = [];
  removed = [];
  failingRemovals = new Set();
});

afterEach(() => {
  vi.useRealTimers();
});

function createSource(pluginsFolder: Files = plugins): WatchedPluginSource {
  return createUserFolderSource({
    pluginsFolder,
    userRoot: USER_ROOT,
    codeFolder: code,
    codeRoot: CODE_ROOT,
    paths: posixPaths,
    importModule: (filePath) => {
      imported.push(filePath);
      const id = filePath.slice(CODE_ROOT.length + 1).split('/')[0];
      return modules.get(id) ?? Promise.resolve(GOOD_MODULE);
    },
    removeFolder: async (folderPath) => {
      removed.push(folderPath);
      if (failingRemovals.has(folderPath)) {
        throw new Error('busy');
      }
    },
    log: (source, message) => logLines.push(`[${source}] ${message}`),
  });
}

function manifestText(id: string, change: Record<string, unknown> = {}) {
  return JSON.stringify({
    id,
    label: id,
    description: `The ${id} plugin.`,
    dependsOn: { main: [], page: [] },
    reads: { main: [], page: [] },
    commands: {},
    scopes: {},
    settings: {},
    settingInfo: {},
    themeTokens: {},
    ...change,
  });
}

async function writePlugin(folder: string, id = folder): Promise<void> {
  await plugins.write(`${folder}/manifest.json`, manifestText(id));
  await plugins.write(`${folder}/main.js`, 'export function start() {}');
}

function failing(message: string): Promise<Record<string, unknown>> {
  return Promise.reject(new Error(message));
}

describe('createUserFolderSource', () => {
  it('loads a plugin folder into a revision copy', async () => {
    await writePlugin('notes');
    await plugins.write('notes/page.js', '// page');
    await plugins.write('notes/lib/helper.js', '// helper');
    await plugins.write('notes/.notes.swp', 'swap');

    const load = await createSource().reload('notes');

    const copied = (await code.list('notes/1', { recursive: true }))
      .filter((entry) => entry.kind === 'file')
      .map((entry) => entry.path)
      .sort();
    expect(copied).toEqual([
      'lib/helper.js',
      'main.js',
      'manifest.json',
      'package.json',
      'page.js',
    ]);
    expect(await code.read('notes/1/package.json')).toBe('{"type":"module"}');
    expect(imported).toEqual([`${CODE_ROOT}/notes/1/main.js`]);
    expect(load).toMatchObject({
      kind: 'loaded',
      entry: {
        revision: 1,
        pageUrl: 'wigley-plugin://notes/~1/page.js',
        folder: `${USER_ROOT}/notes`,
      },
    });
    expect(logLines).toEqual([
      '[plugin-catalog] plugin notes loaded at revision 1',
    ]);
  });

  it('gives a plugin with no page.js a null pageUrl', async () => {
    await writePlugin('notes');

    const load = await createSource().reload('notes');

    expect(load).toMatchObject({ kind: 'loaded', entry: { pageUrl: null } });
  });

  it.each<{
    name: string;
    folder: string;
    arrange: () => Promise<void>;
    message: string;
  }>([
    {
      name: 'no manifest.json',
      folder: 'notes',
      arrange: () => plugins.write('notes/main.js', '//'),
      message: 'plugins/notes/manifest.json is missing',
    },
    {
      name: 'a manifest that is not JSON',
      folder: 'notes',
      arrange: () => plugins.write('notes/manifest.json', '{'),
      message: 'plugins/notes/manifest.json is not valid JSON',
    },
    {
      name: 'a manifest that fails its checks',
      folder: 'notes',
      arrange: () =>
        plugins.write(
          'notes/manifest.json',
          manifestText('notes', { label: 1 }),
        ),
      message: 'label must be a string',
    },
    {
      name: 'a manifest id that is not its folder',
      folder: 'notes',
      arrange: () => writePlugin('notes', 'other'),
      message: 'manifest id "other" does not match its folder "notes"',
    },
    {
      name: 'a folder name that is not an id',
      folder: 'Notes',
      arrange: () => writePlugin('Notes'),
      message: 'must be lowercase letters',
    },
    {
      name: 'an import that rejects',
      folder: 'notes',
      arrange: async () => {
        await writePlugin('notes');
        modules.set('notes', failing('bad syntax'));
      },
      message: 'main.js failed to import: bad syntax',
    },
    {
      name: 'a start that is not a function',
      folder: 'notes',
      arrange: async () => {
        await writePlugin('notes');
        modules.set('notes', Promise.resolve({ start: 1 }));
      },
      message: 'main.js must export a start function',
    },
    {
      name: 'a start under the default export only',
      folder: 'notes',
      arrange: async () => {
        await writePlugin('notes');
        modules.set(
          'notes',
          Promise.resolve({ default: { start: GOOD_MODULE.start } }),
        );
      },
      message: 'main.js must export a start function',
    },
  ])(
    'fails a load with a message, without throwing: $name',
    async ({ folder, arrange, message }) => {
      await arrange();

      const load = await createSource().reload(folder);

      expect(load).toMatchObject({ kind: 'failed', id: folder });
      expect(load.kind === 'failed' ? load.message : '').toContain(message);
      expect(logLines).toEqual([
        expect.stringContaining(`[plugin-catalog] plugin ${folder} failed: `),
      ]);
    },
  );

  it('numbers revisions above the copies already on disk', async () => {
    await code.makeFolder('notes/1');
    await code.makeFolder('notes/4');
    await writePlugin('notes');
    const source = createSource();
    const revisionOf = (load: SourceLoad) =>
      load.kind === 'loaded' ? load.entry.revision : load.kind;

    const good = await source.reload('notes');
    modules.set('notes', failing('bad syntax'));
    const rejected = await source.reload('notes');
    modules.delete('notes');
    await plugins.write('notes/manifest.json', '{');
    const notJson = await source.reload('notes');
    await plugins.write('notes/manifest.json', manifestText('notes'));
    const goodAgain = await source.reload('notes');

    expect(revisionOf(good)).toBe(5);
    expect(rejected.kind).toBe('failed');
    expect(await code.stat('notes/6/main.js')).not.toBeNull();
    expect(notJson.kind).toBe('failed');
    expect(revisionOf(goodAgain)).toBe(7);
    expect(removed).toEqual([`${CODE_ROOT}/notes/1`, `${CODE_ROOT}/notes/4`]);
  });

  it('loads a plugin whose old revision cannot be deleted, and logs the failure', async () => {
    await code.makeFolder('notes/1');
    await writePlugin('notes');
    failingRemovals.add(`${CODE_ROOT}/notes/1`);

    const load = await createSource().reload('notes');

    expect(load).toMatchObject({ kind: 'loaded', entry: { revision: 2 } });
    expect(logLines).toContain(
      '[plugin-catalog] plugin notes old revision 1 not deleted: busy',
    );
  });

  it('deletes the code of plugins no longer in the folder on loadAll', async () => {
    await code.makeFolder('old/3');
    await writePlugin('notes');

    await createSource().loadAll();

    expect(removed).toEqual([`${CODE_ROOT}/old`]);
  });

  // Breaks if the sweep reads only the listed names, deleting the running
  // copy of a plugin a reload loaded this launch.
  it('keeps the code of a plugin loaded this launch on loadAll', async () => {
    await writePlugin('notes');
    const source = createSource();
    await source.reload('notes');
    plugins.remove('notes');
    await code.makeFolder('old/3');

    await source.loadAll();

    expect(removed).toEqual([`${CODE_ROOT}/old`]);
  });

  it('fails an import that does not settle, and moves on', async () => {
    await writePlugin('slow');
    await writePlugin('tasks');
    modules.set('slow', new Promise(() => {}));
    let loads: readonly SourceLoad[] | null = null;

    const loading = createSource()
      .loadAll()
      .then((all) => {
        loads = all;
      });
    await vi.advanceTimersByTimeAsync(PLUGIN_IMPORT_TIMEOUT_MS - 1);
    const settledEarly = loads !== null;
    await vi.advanceTimersByTimeAsync(1);
    await loading;

    expect(settledEarly).toBe(false);
    expect(loads).toMatchObject([
      {
        kind: 'failed',
        id: 'slow',
        message: `main.js did not finish importing in ${PLUGIN_IMPORT_TIMEOUT_MS} ms`,
      },
      { kind: 'loaded', entry: { manifest: { id: 'tasks' } } },
    ]);
  });

  it('loads a plugin folder that is a link, and skips a top-level file', async () => {
    await writePlugin('notes');
    await plugins.write('README.md', '# Plugins');
    // As the Node adapter lists and stats a link to a folder.
    const linked: Files = {
      ...plugins,
      list: async (folder, options) =>
        (await plugins.list(folder, options)).map((entry) =>
          folder === '' && entry.path === 'notes'
            ? { path: 'notes', kind: 'file' }
            : entry,
        ),
      stat: async (path) =>
        path === 'notes'
          ? { isFolder: true, isLink: true }
          : plugins.stat(path),
    };

    const loads = await createSource(linked).loadAll();

    expect(loads).toMatchObject([
      { kind: 'loaded', entry: { manifest: { id: 'notes' } } },
    ]);
  });

  // Breaks if a link to a folder is read as a file (the whole load fails),
  // or if a link back to a folder already listed is followed again.
  it('copies the files of a linked folder, each real folder once', async () => {
    await writePlugin('notes');
    await plugins.write('_store/pkg/index.js', '// pkg');
    const links: Record<string, string> = {
      'notes/node_modules/pkg': '_store/pkg',
      'notes/loop': 'notes',
    };
    const targetOf = (path: string) => {
      for (const [link, target] of Object.entries(links)) {
        if (path === link || path.startsWith(`${link}/`)) {
          return target + path.slice(link.length);
        }
      }
      return path;
    };
    // As the Node adapter lists, stats and resolves a link to a folder.
    const linked: Files = {
      ...plugins,
      list: async (folder, options) => [
        ...(await plugins.list(targetOf(folder), options)),
        ...(folder === 'notes'
          ? Object.keys(links).map((link) => ({
              path: link.slice('notes/'.length),
              kind: 'file' as const,
            }))
          : []),
      ],
      stat: async (path) =>
        path in links ? { isFolder: true, isLink: true } : plugins.stat(path),
      realPath: async (path) => targetOf(path),
      readBytes: (path) => plugins.readBytes(targetOf(path)),
    };

    const load = await createSource(linked).reload('notes');

    const copied = (await code.list('notes/1', { recursive: true }))
      .filter((entry) => entry.kind === 'file')
      .map((entry) => entry.path)
      .sort();
    expect(load.kind).toBe('loaded');
    expect(copied).toEqual([
      'main.js',
      'manifest.json',
      'node_modules/pkg/index.js',
      'package.json',
    ]);
  });

  describe('watch', () => {
    // Waits for every load the watch queued to finish and reach the listener.
    async function loadsDone(source: WatchedPluginSource): Promise<void> {
      await source.reload('settled-probe');
    }

    // `plugins` whose watch reports nothing itself: `report` and
    // `reportMissed` call the watch's `onChange` and `onMissed`.
    function handWatched() {
      const hand = {
        report: (_path: string) => {},
        reportMissed: () => {},
      };
      const files: Files = {
        ...plugins,
        watch: (_folder, onChange, options) => {
          hand.report = onChange;
          hand.reportMissed = options?.onMissed ?? (() => {});
          return { dispose() {} };
        },
      };
      return { files, hand };
    }

    function loadedIds(loads: SourceLoad[]): string[] {
      return loads.map((load) =>
        load.kind === 'loaded' ? load.entry.manifest.id : load.kind,
      );
    }

    // `apartMs` between saves; each id's settle timer runs from its own last
    // save.
    it.each<{ written: string[]; apartMs?: number; loadedIds: string[] }>([
      {
        written: ['notes/main.js', 'notes/lib/helper.js'],
        apartMs: 100,
        loadedIds: ['notes'],
      },
      {
        written: ['notes/main.js', 'tasks/main.js'],
        loadedIds: ['notes', 'tasks'],
      },
      { written: ['notes/layouts/default/layout.js'], loadedIds: [] },
      { written: ['_types/plugin.d.ts'], loadedIds: [] },
      { written: ['notes/lib/helper.cjs'], loadedIds: ['notes'] },
      {
        written: ['notes/main.js.swp', 'notes/main.js~', 'notes/.cache/a.js'],
        loadedIds: [],
      },
    ])(
      'reloads a plugin once its saves settle: $written',
      async ({ written, apartMs = 0, loadedIds }) => {
        await writePlugin('notes');
        await writePlugin('tasks');
        const source = createSource();
        const loads: SourceLoad[] = [];
        source.watch((load) => loads.push(load));

        for (const [index, path] of written.entries()) {
          if (index > 0) {
            await vi.advanceTimersByTimeAsync(apartMs);
          }
          await plugins.write(path, '// saved');
        }
        await vi.advanceTimersByTimeAsync(PLUGIN_SETTLE_MS - 1);
        await loadsDone(source);
        const loadsBeforeSettle = loads.length;
        await vi.advanceTimersByTimeAsync(1);
        await loadsDone(source);

        expect(loadsBeforeSettle).toBe(0);
        expect(
          loads.map((load) =>
            load.kind === 'loaded' ? load.entry.manifest.id : load.kind,
          ),
        ).toEqual(loadedIds);
      },
    );

    // Each row sends `events` as the watch reports them, against a source
    // that holds `notes`. A path of one segment is how macOS reports a change
    // inside the folder as well as the folder's own.
    it.each<{
      events: string[];
      arrange?: () => Promise<void>;
      loads: string[];
    }>([
      { events: ['notes'], loads: [] },
      { events: ['notes', 'notes/main.js'], loads: ['notes'] },
      {
        events: ['fresh'],
        arrange: () => writePlugin('fresh'),
        loads: ['fresh'],
      },
      {
        events: ['notes'],
        arrange: async () => plugins.remove('notes'),
        loads: ['gone'],
      },
    ])(
      'loads on a folder event only when the folder came or went: $events',
      async ({ events, arrange, loads: expected }) => {
        await writePlugin('notes');
        let report: (path: string) => void = () => {};
        const reported: Files = {
          ...plugins,
          watch: (_folder, onChange) => {
            report = onChange;
            return { dispose() {} };
          },
        };
        const source = createSource(reported);
        await source.reload('notes');
        const loads: SourceLoad[] = [];
        source.watch((load) => loads.push(load));
        await arrange?.();

        for (const event of events) {
          report(event);
        }
        await vi.advanceTimersByTimeAsync(PLUGIN_SETTLE_MS);
        await loadsDone(source);

        expect(
          loads.map((load) =>
            load.kind === 'loaded' ? load.entry.manifest.id : load.kind,
          ),
        ).toEqual(expected);
      },
    );

    // Each row changes the plugins folder with no event reported, against a
    // source that loaded `notes` and `tasks`, then the watch reports that it
    // may have missed changes.
    it.each<{
      change: string;
      arrange: () => Promise<void> | void;
      loads: string[];
    }>([
      {
        change: 'a save in notes',
        arrange: () => plugins.write('notes/main.js', '// saved'),
        loads: ['notes'],
      },
      { change: 'nothing', arrange: () => {}, loads: [] },
      {
        change: 'a new folder',
        arrange: () => writePlugin('fresh'),
        loads: ['fresh'],
      },
      {
        change: 'notes deleted',
        arrange: () => plugins.remove('notes'),
        loads: ['gone'],
      },
      {
        change: 'a save in notes/layouts',
        arrange: () =>
          plugins.write('notes/layouts/default/layout.js', '// saved'),
        loads: [],
      },
      {
        change: 'an editor swap file and a package in notes',
        arrange: async () => {
          await plugins.write('notes/main.js.swp', 'swap');
          await plugins.write('notes/node_modules/pkg/index.js', '// pkg');
        },
        loads: [],
      },
    ])(
      'loads after a missed change only what changed since its load: $change',
      async ({ arrange, loads: expected }) => {
        plugins = createMemoryFiles({ now: () => Date.now() });
        await writePlugin('notes');
        await writePlugin('tasks');
        const { files, hand } = handWatched();
        const source = createSource(files);
        await source.loadAll();
        const loads: SourceLoad[] = [];
        source.watch((load) => loads.push(load));
        await vi.advanceTimersByTimeAsync(1);
        await arrange();

        hand.reportMissed();
        await vi.advanceTimersByTimeAsync(PLUGIN_SETTLE_MS);
        await loadsDone(source);

        expect(loadedIds(loads)).toEqual(expected);
      },
    );

    // Breaks if a missed change before `loadAll` loads a folder, which
    // `loadAll` then loads again.
    it('loads nothing on a missed change before loadAll', async () => {
      plugins = createMemoryFiles({ now: () => Date.now() });
      await writePlugin('notes');
      const { files, hand } = handWatched();
      const source = createSource(files);
      const loads: SourceLoad[] = [];
      source.watch((load) => loads.push(load));

      hand.reportMissed();
      await vi.advanceTimersByTimeAsync(PLUGIN_SETTLE_MS);
      await loadsDone(source);

      expect(loadedIds(loads)).toEqual([]);
    });

    // Breaks if a load reads its files' times after it copies, so a save
    // while it imports matches them and a missed change loads nothing.
    it('loads again after a missed save made while a load imports', async () => {
      plugins = createMemoryFiles({ now: () => Date.now() });
      await writePlugin('notes');
      const { files, hand } = handWatched();
      const source = createSource(files);
      let finishImport: (module: Record<string, unknown>) => void = () => {};
      modules.set(
        'notes',
        new Promise((resolve) => {
          finishImport = resolve;
        }),
      );
      const loads: SourceLoad[] = [];
      source.watch((load) => loads.push(load));

      const loading = source.reload('notes');
      await vi.waitUntil(() => imported.length > 0);
      await plugins.write('notes/main.js', '// saved');
      finishImport(GOOD_MODULE);
      await loading;
      hand.reportMissed();
      await vi.advanceTimersByTimeAsync(PLUGIN_SETTLE_MS);
      await loadsDone(source);

      expect(loadedIds(loads)).toEqual(['notes']);
    });

    // Breaks if a rescan that found a save before that save's own load ran
    // loads it a second time after.
    it('loads a save once when a rescan queued ahead of its load finds it', async () => {
      plugins = createMemoryFiles({ now: () => Date.now() });
      await writePlugin('notes');
      await writePlugin('tasks');
      const { files, hand } = handWatched();
      const source = createSource(files);
      await source.loadAll();
      const loads: SourceLoad[] = [];
      source.watch((load) => loads.push(load));
      let finishImport: (module: Record<string, unknown>) => void = () => {};
      modules.set(
        'tasks',
        new Promise((resolve) => {
          finishImport = resolve;
        }),
      );
      await vi.advanceTimersByTimeAsync(1);

      const slowLoad = source.reload('tasks');
      await plugins.write('notes/main.js', '// saved');
      hand.reportMissed();
      hand.report('notes/main.js');
      await vi.advanceTimersByTimeAsync(PLUGIN_SETTLE_MS);
      finishImport(GOOD_MODULE);
      await slowLoad;
      await vi.advanceTimersByTimeAsync(PLUGIN_SETTLE_MS);
      await loadsDone(source);

      expect(loadedIds(loads)).toEqual(['notes']);
    });

    it('reports a deleted folder as gone, once', async () => {
      await writePlugin('notes');
      await plugins.write('stray/data.json', '{}');
      const source = createSource();
      await source.reload('notes');
      const loads: SourceLoad[] = [];
      source.watch((load) => loads.push(load));

      plugins.remove('notes');
      plugins.remove('stray');
      await vi.advanceTimersByTimeAsync(PLUGIN_SETTLE_MS);
      await loadsDone(source);

      expect(loads).toEqual([{ kind: 'gone', id: 'notes' }]);
    });
  });
});
