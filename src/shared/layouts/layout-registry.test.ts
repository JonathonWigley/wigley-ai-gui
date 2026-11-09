import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Files } from '../../contracts/files';
import type { LayoutEntry, LayoutSet } from '../../contracts/layouts';
import { createMemoryFiles, type MemoryFiles } from '../memory-files';
import { posixPaths } from '../paths/posix-paths';
import { scopedFiles } from '../scoped-files';
import { type LayoutRegistry, startLayoutRegistry } from './layout-registry';

const LAYOUT_TYPES = 'declare const types: 1;';
const DEFAULT_PATH = 'clone/src/plugins/demo/layouts/default';

let files: MemoryFiles;
// The repo clone, which holds the owner's default folder at `DEFAULT_PATH`.
let clone: MemoryFiles;
let defaultFolder: Files;
let sent: LayoutSet[];
let logLines: string[];

beforeEach(() => {
  files = createMemoryFiles();
  clone = createMemoryFiles();
  defaultFolder = scopedFiles(clone, DEFAULT_PATH, posixPaths);
  sent = [];
  logLines = [];
});

function start(
  folder: Files = files,
  layoutTypes = LAYOUT_TYPES,
  defaultFolder: Files | null = null,
): Promise<LayoutRegistry> {
  return startLayoutRegistry({
    folder,
    defaultFolder,
    send: (set) => sent.push(set),
    log: (source, message) => logLines.push(`[${source}] ${message}`),
    logSource: 'demo',
    layoutTypes,
  });
}

async function writeLayouts(...names: string[]): Promise<void> {
  for (const name of names) {
    await files.write(`${name}/layout.js`, `// ${name}`);
  }
}

async function writeDefaultFiles(...names: string[]): Promise<void> {
  for (const name of names) {
    await defaultFolder.write(name, `/* ${name} */`);
  }
}

function startWithDefault(): Promise<LayoutRegistry> {
  return start(files, LAYOUT_TYPES, defaultFolder);
}

function entryIn(set: LayoutSet, name: string): LayoutEntry | undefined {
  return set.layouts.find((layout) => layout.name === name);
}

function defaultIn(set: LayoutSet): LayoutEntry | undefined {
  return entryIn(set, 'default');
}

// `files` whose watch hands its options' `onError` to `fail`, or throws
// `startError` from `watch` when one is given.
function withFailingWatch(
  inner: Files,
  startError?: Error,
): {
  folder: Files;
  fail(error: unknown): void;
} {
  let onWatchError: ((error: unknown) => void) | undefined;
  return {
    folder: {
      ...inner,
      watch: (folder, onChange, options) => {
        if (startError !== undefined) {
          throw startError;
        }
        onWatchError = options?.onError;
        return inner.watch(folder, onChange);
      },
    },
    fail: (error) => onWatchError?.(error),
  };
}

// `inner` whose watch reports no change and adds its options' `onMissed` to
// `missed`.
function withUnreportedWatch(inner: Files, missed: (() => void)[]): Files {
  return {
    ...inner,
    watch: (_folder, _onChange, options) => {
      if (options?.onMissed !== undefined) {
        missed.push(options.onMissed);
      }
      return { dispose() {} };
    },
  };
}

// `files` whose watch reports each change as the top entry's name only, as
// Node's `fs.watch` reports a folder renamed or moved inside the watched one.
function withFolderNameWatch(inner: Files): Files {
  return {
    ...inner,
    watch: (folder, onChange, options) =>
      inner.watch(folder, onChange, { ...options, recursive: false }),
  };
}

describe('start', () => {
  it('start_WritesLayoutTypes', async () => {
    await start();

    expect(await files.read('layout.d.ts')).toBe(LAYOUT_TYPES);
  });

  it('start_LayoutTypes_KitSpecifierRewritten', async () => {
    const repo = "'../../../shared/page/layout-host/kit'";
    await start(
      files,
      `import type { BaseKit } from ${repo};\nimport type { DotStatus } from ${repo};\n`,
    );

    expect(await files.read('layout.d.ts')).toBe(
      "import type { BaseKit } from '../kit';\nimport type { DotStatus } from '../kit';\n",
    );
  });

  it('start_ListsDefaultFirstThenUsersByName', async () => {
    await writeLayouts('beta', 'alpha');

    const registry = await start();

    expect(registry.current()).toEqual({
      layouts: [
        { name: 'default', revision: 1, builtIn: true, hasCss: false },
        { name: 'alpha', revision: 1, builtIn: false, hasCss: false },
        { name: 'beta', revision: 1, builtIn: false, hasCss: false },
      ],
      changed: null,
    });
  });

  it('start_UserFolderNamedDefault_IsSkippedAndLogged', async () => {
    await writeLayouts('default', 'alpha');

    const registry = await start();

    expect(registry.names()).toEqual(['default', 'alpha']);
    expect(logLines).toContainEqual(
      expect.stringMatching(/^\[demo\] layouts\/demo\/default is ignored/),
    );
  });

  it.each<{
    row: string;
    folder: 'none' | 'clone';
    written: string[];
    expected: LayoutEntry;
  }>([
    {
      row: 'no clone',
      folder: 'none',
      written: [],
      expected: { name: 'default', revision: 1, hasCss: false, builtIn: true },
    },
    {
      row: 'folder missing',
      folder: 'clone',
      written: [],
      expected: { name: 'default', revision: 1, hasCss: false, builtIn: true },
    },
    {
      row: 'only layout.test.ts',
      folder: 'clone',
      written: ['layout.test.ts'],
      expected: { name: 'default', revision: 1, hasCss: false, builtIn: true },
    },
    {
      row: 'layout.js only',
      folder: 'clone',
      written: ['layout.js'],
      expected: { name: 'default', revision: 1, hasCss: false, builtIn: false },
    },
    {
      row: 'layout.js and layout.css',
      folder: 'clone',
      written: ['layout.js', 'layout.css'],
      expected: { name: 'default', revision: 1, hasCss: true, builtIn: false },
    },
  ])(
    'start_DefaultEntry_FollowsTheDefaultFolder ($row)',
    async ({ folder, written, expected }) => {
      await writeDefaultFiles(...written);
      await writeLayouts('alpha');

      const registry = await start(
        files,
        LAYOUT_TYPES,
        folder === 'clone' ? defaultFolder : null,
      );

      expect(registry.current().layouts[0]).toEqual(expected);
    },
  );

  it('start_DefaultFolderMissing_IsNotWatchedOrMade', async () => {
    const watched: string[] = [];
    const recording: Files = {
      ...defaultFolder,
      watch: (folder, onChange, options) => {
        watched.push(folder);
        return defaultFolder.watch(folder, onChange, options);
      },
    };

    await start(files, LAYOUT_TYPES, recording);

    expect(watched).toEqual([]);
    expect(await defaultFolder.stat('')).toBeNull();
  });

  it('start_FolderWithoutLayoutJs_IsNotListed', async () => {
    await files.write('notes/readme.json', '{}');

    const registry = await start();

    expect(registry.names()).toEqual(['default']);
  });
});

describe('watch', () => {
  it('watch_SaveInAnyUserFolder_BumpsOnlyThatLayout', async () => {
    await writeLayouts('alpha', 'beta');
    await start();

    await files.write('beta/layout.js', '// saved');

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].changed).toBe('beta');
    expect(entryIn(sent[0], 'beta')?.revision).toBe(2);
    expect(entryIn(sent[0], 'alpha')?.revision).toBe(1);
  });

  it('watch_LayoutJsRemoved_SendsSetWithoutIt', async () => {
    await writeLayouts('alpha');
    const registry = await start();

    files.remove('alpha/layout.js');

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].changed).toBe('alpha');
    expect(entryIn(sent[0], 'alpha')).toBeUndefined();
    expect(registry.names()).toEqual(['default']);
  });

  it('watch_LayoutRemovedThenWrittenAgain_TakesAHigherRevision', async () => {
    await writeLayouts('alpha');
    await start();

    files.remove('alpha/layout.js');
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    await writeLayouts('alpha');

    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(entryIn(sent[1], 'alpha')?.revision).toBeGreaterThan(2);
  });

  it('watch_NewFolder_JoinsTheSet', async () => {
    await start();

    await writeLayouts('gamma');

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].changed).toBe('gamma');
    expect(entryIn(sent[0], 'gamma')?.revision).toBe(1);
  });

  it('watch_SaveInFolderThatIsNoLayout_SendsNothing', async () => {
    await writeLayouts('alpha');
    await start();

    await files.write('notes/readme.json', '{}');
    await files.write('alpha/layout.js', '// saved');

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].changed).toBe('alpha');
  });

  it('watch_SaveInDefaultFolder_SendsNothing', async () => {
    await writeLayouts('alpha');
    await start();

    await files.write('default/layout.js', '// mine');
    await files.write('alpha/layout.js', '// saved');

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].changed).toBe('alpha');
  });

  it.each([
    'alpha/.layout.js.swp',
    'alpha/4913',
    'alpha/layout.js~',
    'alpha/.#layout.js',
  ])('watch_EditorSideFile_%s_ChangesNothing', async (sideFile) => {
    await writeLayouts('alpha');
    await start();

    await files.write(`${sideFile}`, 'scratch');
    await files.write('alpha/layout.js', '// saved');

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(entryIn(sent[0], 'alpha')?.revision).toBe(2);
  });

  it.each([
    'alpha/parts/card.mjs',
    'alpha/strings.json',
    'alpha/icons/check.svg',
  ])('watch_SaveOf_%s_SendsTheChange', async (saved) => {
    await writeLayouts('alpha');
    await start();

    await files.write(`${saved}`, '// saved');

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].changed).toBe('alpha');
  });

  it('watch_LayoutFolderRenamed_OldLeavesAndNewJoins', async () => {
    await writeLayouts('alpha', 'beta');
    const registry = await start(withFolderNameWatch(files));

    await files.rename('alpha', 'gamma');

    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(sent.map((set) => set.changed)).toEqual(['alpha', 'gamma']);
    expect(entryIn(sent[1], 'alpha')).toBeUndefined();
    expect(entryIn(sent[1], 'gamma')?.revision).toBeGreaterThanOrEqual(1);
    expect(registry.names()).toEqual(['default', 'beta', 'gamma']);
  });

  it.each(['layout.d.ts', 'default/layout.js'])(
    'watch_FolderNameReportFor_%s_SendsNothing',
    async (saved) => {
      await writeLayouts('alpha', 'default');
      await start(withFolderNameWatch(files));

      await files.write(`${saved}`, '// saved');
      await files.write('alpha/layout.js', '// saved');

      await vi.waitFor(() => expect(sent).toHaveLength(1));
      expect(sent[0].changed).toBe('alpha');
    },
  );

  it.each([
    {
      watch: 'layouts',
      when: 'running',
      line: /^\[demo\] layouts watch.*EMFILE/,
    },
    {
      watch: 'default',
      when: 'running',
      line: /^\[demo\] default layout watch.*EMFILE/,
    },
    {
      watch: 'default',
      when: 'starting',
      line: /^\[demo\] default layout watch.*ENOENT/,
    },
  ])('watch_Fails_LogsIt ($watch, $when)', async ({ watch, when, line }) => {
    await writeDefaultFiles('layout.js');
    await writeLayouts('alpha');
    const failing = withFailingWatch(
      watch === 'layouts' ? files : defaultFolder,
      when === 'starting' ? new Error('ENOENT') : undefined,
    );
    const registry =
      watch === 'layouts'
        ? await start(failing.folder, LAYOUT_TYPES, defaultFolder)
        : await start(files, LAYOUT_TYPES, failing.folder);

    failing.fail(new Error('EMFILE'));

    expect(registry.names()).toEqual(['default', 'alpha']);
    expect(logLines).toContainEqual(expect.stringMatching(line));
  });

  it.each([
    { saved: 'layout.js', started: ['layout.js', 'layout.css'], hasCss: true },
    { saved: 'layout.css', started: ['layout.js', 'layout.css'], hasCss: true },
    { saved: 'layout.css', started: ['layout.js'], hasCss: true },
    { saved: 'layout.js', started: ['layout.test.ts'], hasCss: false },
  ])(
    'watch_SaveInDefaultFolder_RaisesTheDefaultRevision ($saved, from $started)',
    async ({ saved, started, hasCss }) => {
      await writeDefaultFiles(...started);
      const registry = await startWithDefault();
      const startRevision = defaultIn(registry.current())?.revision ?? 0;

      await writeDefaultFiles(saved);

      await vi.waitFor(() => expect(sent).toHaveLength(1));
      expect(sent[0].changed).toBe('default');
      expect(defaultIn(sent[0])).toMatchObject({ builtIn: false, hasCss });
      expect(defaultIn(sent[0])?.revision).toBeGreaterThan(startRevision);
    },
  );

  // Each row changes the folders with no event reported, then both watches
  // report that they may have missed changes.
  it.each<{ change: string; arrange: () => Promise<void>; changed: string[] }>([
    {
      change: 'a save in beta',
      arrange: () => files.write('beta/layout.js', '// saved'),
      changed: ['beta'],
    },
    { change: 'nothing', arrange: async () => {}, changed: [] },
    {
      change: 'a new layout',
      arrange: () => writeLayouts('gamma'),
      changed: ['gamma'],
    },
    {
      change: 'a save in the default folder',
      arrange: () => writeDefaultFiles('layout.css'),
      changed: ['default'],
    },
  ])(
    'watch_MissedChange_ListsAgainOnlyWhatChanged: $change',
    async ({ arrange, changed }) => {
      let now = 1;
      files = createMemoryFiles({ now: () => now });
      clone = createMemoryFiles({ now: () => now });
      defaultFolder = scopedFiles(clone, DEFAULT_PATH, posixPaths);
      await writeLayouts('alpha', 'beta');
      await writeDefaultFiles('layout.js');
      const missed: (() => void)[] = [];
      await start(
        withUnreportedWatch(files, missed),
        LAYOUT_TYPES,
        withUnreportedWatch(defaultFolder, missed),
      );
      now = 2;
      await arrange();

      for (const reportMissed of missed) {
        reportMissed();
      }
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(sent.map((set) => set.changed)).toEqual(changed);
    },
  );

  it('watch_DefaultLayoutCssRemoved_SendsDefaultWithoutCss', async () => {
    await writeDefaultFiles('layout.js', 'layout.css');
    const registry = await startWithDefault();
    const startRevision = defaultIn(registry.current())?.revision ?? 0;

    clone.remove(`${DEFAULT_PATH}/layout.css`);

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].changed).toBe('default');
    expect(defaultIn(sent[0])).toMatchObject({ builtIn: false, hasCss: false });
    expect(defaultIn(sent[0])?.revision).toBeGreaterThan(startRevision);
  });

  it.each([
    { saved: 'layout.test.ts', started: ['layout.js'] },
    { saved: 'parts/card.js', started: ['layout.js'] },
    { saved: 'layout.css', started: ['layout.test.ts'] },
  ])(
    'watch_OtherFileInDefaultFolder_SendsNothing ($saved, from $started)',
    async ({ saved, started }) => {
      await writeDefaultFiles(...started);
      await writeLayouts('alpha');
      await startWithDefault();

      await writeDefaultFiles(saved);
      await files.write('alpha/layout.js', '// saved');

      await vi.waitFor(() => expect(sent).toHaveLength(1));
      expect(sent[0].changed).toBe('alpha');
    },
  );

  it('watch_DefaultLayoutJsRemovedThenWritten_BuiltInThenHigherRevision', async () => {
    await writeDefaultFiles('layout.js');
    const registry = await startWithDefault();
    const liveRevision = defaultIn(registry.current())?.revision ?? 0;

    clone.remove(`${DEFAULT_PATH}/layout.js`);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    await writeDefaultFiles('layout.js');

    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(sent.map((set) => set.changed)).toEqual(['default', 'default']);
    expect(defaultIn(sent[0])).toEqual({
      name: 'default',
      revision: 1,
      hasCss: false,
      builtIn: true,
    });
    expect(defaultIn(sent[1])?.builtIn).toBe(false);
    expect(defaultIn(sent[1])?.revision).toBeGreaterThan(liveRevision);
  });

  it('dispose_ClosesTheDefaultWatch', async () => {
    await writeDefaultFiles('layout.js');
    const registry = await startWithDefault();

    registry.dispose();
    await writeDefaultFiles('layout.js');
    // Lets a relist the write may have queued run to its send.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sent).toEqual([]);
  });

  it('hasCss_TrueWhenLayoutCssPresent', async () => {
    await writeLayouts('alpha');
    const registry = await start();
    expect(entryIn(registry.current(), 'alpha')?.hasCss).toBe(false);

    await files.write('alpha/layout.css', 'body {}');

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(entryIn(sent[0], 'alpha')?.hasCss).toBe(true);
    expect(entryIn(registry.current(), 'alpha')?.hasCss).toBe(true);
  });
});
