import { describe, expect, it } from 'vitest';
import type {
  CatalogChange,
  CatalogEntry,
  PluginOrigin,
  SourceLoad,
  WatchedPluginSource,
} from '../../contracts/plugin-catalog';
import { startPluginCatalog } from './plugin-catalog';

// A source whose `loadAll` resolves `loads`, whose watch keeps its listener
// for `send`, and whose `reload` resolves `nextReload`.
interface FakeSource extends WatchedPluginSource {
  send(load: SourceLoad): void;
  reloaded: string[];
  nextReload: SourceLoad | null;
}

function fakeSource(loads: readonly SourceLoad[]): FakeSource {
  let listener: ((load: SourceLoad) => void) | null = null;
  const source: FakeSource = {
    loadAll: async () => loads,
    watch: (watcher) => {
      listener = watcher;
      return { dispose: () => (listener = null) };
    },
    reload: async (id) => {
      source.reloaded.push(id);
      return source.nextReload ?? { kind: 'gone', id };
    },
    send: (load) => listener?.(load),
    reloaded: [],
    nextReload: null,
  };
  return source;
}

// A load of `id`, its manifest depending in main on `dependsOn`.
function loaded(id: string, dependsOn: string[] = []): SourceLoad {
  return {
    kind: 'loaded',
    entry: {
      manifest: {
        id,
        label: id,
        description: `The ${id} plugin.`,
        dependsOn: { main: dependsOn, page: [] },
        reads: { main: [], page: [] },
        commands: {},
        scopes: {},
        settings: {},
        settingInfo: {},
        themeTokens: {},
      },
      revision: 0,
      main: null,
      pageUrl: null,
      folder: null,
    },
  };
}

function failed(id: string): SourceLoad {
  return { kind: 'failed', id, message: `${id} broke` };
}

function gone(id: string): SourceLoad {
  return { kind: 'gone', id };
}

const NO_CHANGE: CatalogChange = { added: [], removed: [], reloaded: [] };

async function startWith(
  builtIns: readonly SourceLoad[],
  users: readonly SourceLoad[],
  log: (source: string, message: string) => void = () => {},
) {
  const builtIn = fakeSource(builtIns);
  const user = fakeSource(users);
  const catalog = await startPluginCatalog({ builtIn, user, log });
  const changes: CatalogChange[] = [];
  catalog.onChanged((change) => changes.push(change));
  return { catalog, builtIn, user, changes };
}

const ids = (entries: readonly CatalogEntry[]) =>
  entries.map((entry) => entry.manifest.id);

describe('startPluginCatalog', () => {
  it('merges the sources, a user plugin replacing a built-in in its place', async () => {
    const { catalog } = await startWith(
      [loaded('a'), loaded('b')],
      [loaded('b'), loaded('c')],
    );

    expect(ids(catalog.entries())).toEqual(['a', 'b', 'c']);
    expect(catalog.entries().map((entry) => entry.origin)).toEqual([
      'built-in',
      'replaces-built-in',
      'user',
    ]);
    expect(catalog.manifests().map((manifest) => manifest.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  // Each step sends one user load; `problems` maps each id with a problem to
  // a part of its message, in `problems()` order.
  it.each<{
    name: string;
    builtIns: SourceLoad[];
    users: SourceLoad[];
    steps: {
      load: SourceLoad;
      change: CatalogChange;
      ids: string[];
      origins?: Record<string, PluginOrigin>;
      problems: [string, string][];
    }[];
  }>([
    {
      name: 'a new user plugin',
      builtIns: [loaded('a'), loaded('b')],
      users: [],
      steps: [
        {
          load: loaded('c'),
          change: { ...NO_CHANGE, added: ['c'] },
          ids: ['a', 'b', 'c'],
          origins: { c: 'user' },
          problems: [],
        },
      ],
    },
    {
      name: 'a user plugin over a built-in',
      builtIns: [loaded('a'), loaded('b')],
      users: [],
      steps: [
        {
          load: loaded('b'),
          change: { ...NO_CHANGE, reloaded: ['b'] },
          ids: ['a', 'b'],
          origins: { b: 'replaces-built-in' },
          problems: [],
        },
      ],
    },
    {
      name: 'a replacement gone',
      builtIns: [loaded('a'), loaded('b')],
      users: [loaded('b')],
      steps: [
        {
          load: gone('b'),
          change: { ...NO_CHANGE, reloaded: ['b'] },
          ids: ['a', 'b'],
          origins: { b: 'built-in' },
          problems: [],
        },
      ],
    },
    {
      name: 'a user-only plugin gone',
      builtIns: [loaded('a')],
      users: [loaded('c')],
      steps: [
        {
          load: gone('c'),
          change: { ...NO_CHANGE, removed: ['c'] },
          ids: ['a'],
          problems: [],
        },
      ],
    },
    {
      name: 'a failed load of a good plugin, then a good load',
      builtIns: [loaded('a')],
      users: [loaded('c')],
      steps: [
        {
          load: failed('c'),
          change: NO_CHANGE,
          ids: ['a', 'c'],
          problems: [['c', 'c broke']],
        },
        {
          load: loaded('c'),
          change: { ...NO_CHANGE, reloaded: ['c'] },
          ids: ['a', 'c'],
          problems: [],
        },
      ],
    },
    {
      name: 'a failed load of a plugin never loaded',
      builtIns: [loaded('a')],
      users: [],
      steps: [
        {
          load: failed('d'),
          change: NO_CHANGE,
          ids: ['a'],
          problems: [['d', 'd broke']],
        },
      ],
    },
    {
      name: 'a plugin whose dependency is not loaded, then is',
      builtIns: [loaded('a')],
      users: [],
      steps: [
        {
          load: loaded('e', ['f']),
          change: NO_CHANGE,
          ids: ['a'],
          problems: [['e', 'needs plugin "f", which is not loaded']],
        },
        {
          load: loaded('f'),
          change: { ...NO_CHANGE, added: ['e', 'f'] },
          ids: ['a', 'e', 'f'],
          problems: [],
        },
      ],
    },
    {
      name: "a replacement's dependency gone, then back",
      builtIns: [loaded('a'), loaded('b')],
      users: [loaded('b', ['g']), loaded('g')],
      steps: [
        {
          load: gone('g'),
          change: { ...NO_CHANGE, removed: ['g'], reloaded: ['b'] },
          ids: ['a', 'b'],
          origins: { b: 'built-in' },
          problems: [['b', 'needs plugin "g", which is not loaded']],
        },
        {
          load: loaded('g'),
          change: { ...NO_CHANGE, added: ['g'], reloaded: ['b'] },
          ids: ['a', 'b', 'g'],
          origins: { b: 'replaces-built-in' },
          problems: [],
        },
      ],
    },
    {
      name: 'a load that makes a dependency cycle',
      builtIns: [loaded('a')],
      users: [loaded('c'), loaded('d', ['c'])],
      steps: [
        {
          load: loaded('c', ['d']),
          change: NO_CHANGE,
          ids: ['a', 'c', 'd'],
          problems: [['c', 'cycle']],
        },
      ],
    },
  ])(
    'announces each load as a change by id: $name',
    async ({ builtIns, users, steps }) => {
      const { catalog, user, changes } = await startWith(builtIns, users);

      for (const step of steps) {
        const before = catalog.entries();
        changes.length = 0;

        user.send(step.load);

        expect(changes).toEqual([step.change]);
        expect(ids(catalog.entries())).toEqual(step.ids);
        for (const [id, origin] of Object.entries(step.origins ?? {})) {
          expect(catalog.entry(id)?.origin).toBe(origin);
        }
        for (const old of before) {
          const id = old.manifest.id;
          if (step.ids.includes(id) && !step.change.reloaded.includes(id)) {
            expect(catalog.entry(id)).toBe(old);
          }
        }
        expect(catalog.problems().map((problem) => problem.id)).toEqual(
          step.problems.map(([id]) => id),
        );
        for (const [index, [, message]] of step.problems.entries()) {
          expect(catalog.problems()[index].message).toContain(message);
        }
      }
    },
  );

  it('keeps problems in the order first recorded, a returning one at the end', async () => {
    const { catalog, user } = await startWith([], [loaded('c'), loaded('d')]);

    user.send(failed('c'));
    user.send(failed('d'));
    user.send(loaded('c'));
    user.send(failed('c'));

    expect(catalog.problems().map((problem) => problem.id)).toEqual(['d', 'c']);
  });

  it('a throwing listener does not stop the next', async () => {
    const logLines: string[] = [];
    const { catalog, user } = await startWith([], [], (source, message) =>
      logLines.push(`[${source}] ${message}`),
    );
    const heard: CatalogChange[] = [];
    catalog.onChanged(() => {
      throw new Error('listener broke');
    });
    catalog.onChanged((change) => heard.push(change));

    user.send(loaded('c'));

    expect(heard).toEqual([{ ...NO_CHANGE, added: ['c'] }]);
    expect(logLines).toEqual([
      '[plugin-catalog] change listener failed: listener broke',
    ]);
  });

  // Breaks if the watch starts after the start loads, or if a load it sent
  // in that time is applied over the start load of its id.
  it('loads again an id the watch loaded while the start loads ran', async () => {
    const builtIn = fakeSource([]);
    const user = fakeSource([]);
    const startLoad = loaded('c');
    user.loadAll = async () => {
      user.send(loaded('c'));
      return [startLoad];
    };
    const reload = loaded('c');
    user.nextReload = reload;

    const catalog = await startPluginCatalog({
      builtIn,
      user,
      log: () => {},
    });

    expect(user.reloaded).toEqual(['c']);
    expect(catalog.entry('c')?.manifest).toBe(
      reload.kind === 'loaded' ? reload.entry.manifest : null,
    );
  });

  it.each<{ id: string; rejects: string | null }>([
    { id: 'c', rejects: null },
    {
      id: 'a',
      rejects: 'Plugin "a" is built in; it reloads only with a rebuild',
    },
    { id: 'zzz', rejects: 'No plugin "zzz"' },
  ])(
    'reload asks the user source, and refuses a built-in or unknown id: $id',
    async ({ id, rejects }) => {
      const { catalog, user, changes } = await startWith(
        [loaded('a')],
        [loaded('c')],
      );
      user.nextReload = loaded('c');

      const reloading = catalog.reload(id);

      if (rejects === null) {
        await reloading;
        expect(user.reloaded).toEqual(['c']);
        expect(changes).toEqual([{ ...NO_CHANGE, reloaded: ['c'] }]);
      } else {
        await expect(reloading).rejects.toThrow(rejects);
        expect(user.reloaded).toEqual([]);
      }
    },
  );
});
