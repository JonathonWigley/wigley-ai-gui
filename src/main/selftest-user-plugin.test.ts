import { describe, expect, it } from 'vitest';
import type { Files } from '../contracts/files';
import type { Paths } from '../contracts/paths';
import type {
  CatalogChange,
  CatalogEntry,
  PluginOrigin,
} from '../contracts/plugin-catalog';
import { createMemoryFiles, type MemoryFiles } from '../shared/memory-files';
import {
  SELFTEST_USER_ID,
  seedSelfTestUserPlugin,
  userPluginSelfTestScript,
} from './selftest-user-plugin';

const PLUGINS = '.config/wigley-ai-gui/plugins';
const FIXTURE = `${PLUGINS}/${SELFTEST_USER_ID}`;
const GALLERY = `${PLUGINS}/gallery`;
const RUN = 3;
const READY = `log selftest-user: fixture ready for run ${RUN}`;

// The seed joins paths only; src/main may not import the shared Paths adapters.
const joinPaths = {
  join: (...segments: string[]) => segments.join('/'),
} as Paths;

// Lets every pending promise chain run.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function seed(files: Files) {
  return seedSelfTestUserPlugin({
    files,
    paths: joinPaths,
    pluginsFolder: PLUGINS,
  });
}

// Every file under `folder` with its text, by path under it.
async function folderTexts(files: MemoryFiles, folder: string) {
  const entries = await files.list(folder, { recursive: true });
  const texts: Record<string, string> = {};
  for (const entry of entries.filter((each) => each.kind === 'file')) {
    texts[entry.path] = await files.read(`${folder}/${entry.path}`);
  }
  return texts;
}

// A catalog holding `entries` (id → origin and revision), recording each
// `reload` in `events`, its changes fired by the test.
function fakeCatalog(
  events: string[],
  entries: Map<string, { origin: PluginOrigin; revision: number }>,
) {
  const listeners = new Set<(change: CatalogChange) => void>();
  return {
    catalog: {
      entry: (id: string) => entries.get(id) as CatalogEntry | undefined,
      reload: async (id: string) => {
        events.push(`reload ${id}`);
      },
      onChanged(listener: (change: CatalogChange) => void) {
        listeners.add(listener);
        return { dispose: () => listeners.delete(listener) };
      },
    },
    fire(change: Partial<CatalogChange>) {
      for (const listener of listeners) {
        listener({ added: [], removed: [], reloaded: [], ...change });
      }
    },
  };
}

// The script over `files` (rooted at the temp home), a fake catalog holding
// the fixture at revision 1 and the built-in gallery, and a `settled` that
// records each call and, unless `holdsSettled`, resolves at once; each held
// call's resolve is in `releases`. `events` holds the settles, the home's
// writes and trashes, reloads and log lines, in order.
function scriptOver(files: MemoryFiles, holdsSettled = false) {
  const events: string[] = [];
  const releases: (() => void)[] = [];
  const entries = new Map<string, { origin: PluginOrigin; revision: number }>([
    [SELFTEST_USER_ID, { origin: 'user', revision: 1 }],
    ['gallery', { origin: 'built-in', revision: 0 }],
  ]);
  const recorded: Files = {
    ...files,
    write: async (path, text) => {
      events.push(`write ${path.replace(`${FIXTURE}/`, '')}`);
      await files.write(path, text);
    },
    trash: async (path) => {
      events.push(`trash ${path}`);
      await files.trash(path);
    },
  };
  const fake = fakeCatalog(events, entries);
  const script = userPluginSelfTestScript({
    homeFiles: recorded,
    catalog: fake.catalog,
    settled: () => {
      events.push('settled');
      return holdsSettled
        ? new Promise<void>((resolve) => releases.push(resolve))
        : Promise.resolve();
    },
    log: (source, message) => events.push(`log ${source}: ${message}`),
  });
  return { script, events, releases, entries, fire: fake.fire };
}

describe('userPluginSelfTestScript', () => {
  it.each<{
    given: string;
    setUp(files: MemoryFiles): Promise<void>;
    fileWork: string[];
    loads: 'reload' | 'change';
  }>([
    {
      given: 'the first version on disk',
      setUp: seed,
      fileWork: [],
      loads: 'reload',
    },
    {
      given: 'main.js changed',
      setUp: async (files) => {
        await seed(files);
        await files.write(`${FIXTURE}/main.js`, 'export const v = 2;');
      },
      fileWork: ['write main.js'],
      loads: 'change',
    },
    {
      given: 'the folder gone',
      setUp: async () => {},
      fileWork: [
        'write manifest.json',
        'write main.js',
        'write page.js',
        'write layouts/default/layout.js',
      ],
      loads: 'change',
    },
    {
      given: "gallery's user folder beside the first version",
      setUp: async (files) => {
        await seed(files);
        await files.write(`${GALLERY}/page.js`, 'export {};');
      },
      fileWork: [`trash ${GALLERY}`],
      loads: 'reload',
    },
    {
      given: 'only the default layout changed',
      setUp: async (files) => {
        await seed(files);
        await files.write(`${FIXTURE}/layouts/default/layout.js`, 'v2');
      },
      fileWork: ['write layouts/default/layout.js'],
      loads: 'reload',
    },
  ])(
    'open_WritesOnlyChangedFilesElseReloads: $given',
    async ({ setUp, fileWork, loads }) => {
      const files = createMemoryFiles();
      await setUp(files);
      const { script, events, releases, fire } = scriptOver(files, true);

      script.open(RUN);
      await flush();
      releases[0]();
      await flush();
      if (loads === 'change') {
        events.push('change');
        fire({ reloaded: [SELFTEST_USER_ID] });
        await flush();
      }
      const beforeSecondSettle = [...events];
      releases[1]?.();
      await flush();

      const load = loads === 'change' ? 'change' : `reload ${SELFTEST_USER_ID}`;
      expect(beforeSecondSettle).toEqual([
        'settled',
        ...fileWork,
        load,
        'settled',
      ]);
      expect(events).toEqual([...beforeSecondSettle, READY]);
      const firstVersion = createMemoryFiles();
      await seed(firstVersion);
      expect(await folderTexts(files, PLUGINS)).toEqual(
        await folderTexts(firstVersion, PLUGINS),
      );
    },
  );

  it.each<{ result: object; expected: string[] }>([
    {
      result: {
        loadedAtStart: true,
        galleryOrigin: 'built-in',
        isStillHeld: false,
      },
      expected: [],
    },
    {
      result: {
        loadedAtStart: false,
        galleryOrigin: 'built-in',
        isStillHeld: false,
      },
      expected: ['selftest-user was not loaded at start'],
    },
    {
      result: {
        loadedAtStart: true,
        galleryOrigin: 'user',
        isStillHeld: false,
      },
      expected: ['gallery is user after its user folder went, not built-in'],
    },
    {
      result: { loadedAtStart: true, galleryOrigin: null, isStillHeld: false },
      expected: ['gallery is none after its user folder went, not built-in'],
    },
    {
      result: {
        loadedAtStart: true,
        galleryOrigin: 'built-in',
        isStillHeld: true,
      },
      expected: ['selftest-user is still in the catalog after its folder went'],
    },
  ])('problems_NamesEachFailedCheck: $expected', ({ result, expected }) => {
    const { script } = scriptOver(createMemoryFiles());

    expect(script.problems(result)).toEqual(expected);
  });

  it('result_ResolvesOnTheChangeThatRemovesTheFixture', async () => {
    const files = createMemoryFiles();
    await seed(files);
    const { script, entries, fire } = scriptOver(files);
    const { result } = script.open(RUN);
    let settledWith: unknown = null;
    void result.then((value) => {
      settledWith = value;
    });
    await flush();

    fire({ removed: ['other'] });
    await flush();
    expect(settledWith).toBeNull();

    entries.delete(SELFTEST_USER_ID);
    fire({ removed: [SELFTEST_USER_ID] });
    await flush();
    expect(settledWith).toEqual({
      loadedAtStart: true,
      galleryOrigin: 'built-in',
      isStillHeld: false,
    });
    expect(script.problems(settledWith)).toEqual([]);
  });
});
