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

// The `default` entry at revision and style revision 1.
function defaultEntry(hasCss: boolean, builtIn: boolean): LayoutEntry {
  return { name: 'default', revision: 1, styleRevision: 1, hasCss, builtIn };
}

function entryIn(set: LayoutSet, name: string): LayoutEntry | undefined {
  return set.layouts.find((layout) => layout.name === name);
}

function defaultIn(set: LayoutSet): LayoutEntry | undefined {
  return entryIn(set, 'default');
}

// Each change from `previous` to `next`, sorted: `<name> revision` and
// `<name> style` for each entry whose revision or style revision rose,
// `<name> joined` and `<name> left`, and `<name> built-in` or `<name> live`
// for an entry whose `builtIn` flipped.
function changesIn(previous: LayoutSet, next: LayoutSet): string[] {
  const changes: string[] = [];
  for (const layout of next.layouts) {
    const before = entryIn(previous, layout.name);
    if (before === undefined) {
      changes.push(`${layout.name} joined`);
      continue;
    }
    if (layout.revision > before.revision) {
      changes.push(`${layout.name} revision`);
    }
    if (layout.styleRevision > before.styleRevision) {
      changes.push(`${layout.name} style`);
    }
    if (layout.builtIn !== before.builtIn) {
      changes.push(`${layout.name} ${layout.builtIn ? 'built-in' : 'live'}`);
    }
  }
  for (const layout of previous.layouts) {
    if (entryIn(next, layout.name) === undefined) {
      changes.push(`${layout.name} left`);
    }
  }
  return changes.sort();
}

// The changes each set in `sets` makes to the one before it, the first to
// `first`.
function changesPerSet(first: LayoutSet, sets: LayoutSet[]): string[][] {
  return sets.map((set, i) => changesIn(i === 0 ? first : sets[i - 1], set));
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

// `inner` whose watch reports changes as `inner`'s does and adds its options'
// `onMissed` to `missed`.
function withMissedWatch(inner: Files, missed: (() => void)[]): Files {
  return {
    ...inner,
    watch: (folder, onChange, options) => {
      if (options?.onMissed !== undefined) {
        missed.push(options.onMissed);
      }
      return inner.watch(folder, onChange, options);
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
  it('writes the layout types on start', async () => {
    await start();

    expect(await files.read('layout.d.ts')).toBe(LAYOUT_TYPES);
  });

  it('rewrites the kit specifier in the layout types on start', async () => {
    const repo = "'../../../shared/page/layout-host/kit'";
    await start(
      files,
      `import type { BaseKit } from ${repo};\nimport type { DotStatus } from ${repo};\n`,
    );

    expect(await files.read('layout.d.ts')).toBe(
      "import type { BaseKit } from '../kit';\nimport type { DotStatus } from '../kit';\n",
    );
  });

  it('lists the default first and then users by name', async () => {
    await writeLayouts('beta', 'alpha');

    const registry = await start();

    expect(registry.current()).toEqual({
      layouts: [
        {
          name: 'default',
          revision: 1,
          styleRevision: 1,
          builtIn: true,
          hasCss: false,
        },
        {
          name: 'alpha',
          revision: 1,
          styleRevision: 1,
          builtIn: false,
          hasCss: false,
        },
        {
          name: 'beta',
          revision: 1,
          styleRevision: 1,
          builtIn: false,
          hasCss: false,
        },
      ],
    });
  });

  it('skips and logs a user folder named default', async () => {
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
      expected: defaultEntry(false, true),
    },
    {
      row: 'folder missing',
      folder: 'clone',
      written: [],
      expected: defaultEntry(false, true),
    },
    {
      row: 'only layout.test.ts',
      folder: 'clone',
      written: ['layout.test.ts'],
      expected: defaultEntry(false, true),
    },
    {
      row: 'layout.js only',
      folder: 'clone',
      written: ['layout.js'],
      expected: defaultEntry(false, false),
    },
    {
      row: 'layout.js and layout.css',
      folder: 'clone',
      written: ['layout.js', 'layout.css'],
      expected: defaultEntry(true, false),
    },
  ])(
    'makes the default entry follow the default folder ($row)',
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

  it('neither watches nor makes a missing default folder', async () => {
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

  it('does not list a folder without a layout.js', async () => {
    await files.write('notes/readme.json', '{}');

    const registry = await start();

    expect(registry.names()).toEqual(['default']);
  });
});

describe('watch', () => {
  it('bumps only that layout on a save in any user folder', async () => {
    await writeLayouts('alpha', 'beta');
    const before = (await start()).current();

    await files.write('beta/layout.js', '// saved');

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(changesIn(before, sent[0])).toEqual(['beta revision']);
  });

  it('sends the set without a layout whose layout.js is removed', async () => {
    await writeLayouts('alpha');
    const registry = await start();
    const before = registry.current();

    files.remove('alpha/layout.js');

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(changesIn(before, sent[0])).toEqual(['alpha left']);
    expect(registry.names()).toEqual(['default']);
  });

  it('takes a higher revision for a layout removed and then written again', async () => {
    await writeLayouts('alpha');
    await start();

    files.remove('alpha/layout.js');
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    await writeLayouts('alpha');

    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(entryIn(sent[1], 'alpha')?.revision).toBe(3);
    expect(entryIn(sent[1], 'alpha')?.styleRevision).toBe(3);
  });

  it('joins a new folder to the set', async () => {
    const before = (await start()).current();

    await writeLayouts('gamma');

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(changesIn(before, sent[0])).toEqual(['gamma joined']);
    expect(entryIn(sent[0], 'gamma')?.revision).toBe(1);
  });

  it('sends nothing for a save in a folder that is no layout', async () => {
    await writeLayouts('alpha');
    const before = (await start()).current();

    await files.write('notes/readme.json', '{}');
    await files.write('alpha/layout.js', '// saved');

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(changesIn(before, sent[0])).toEqual(['alpha revision']);
  });

  it('sends nothing for a save in the default folder', async () => {
    await writeLayouts('alpha');
    const before = (await start()).current();

    await files.write('default/layout.js', '// mine');
    await files.write('alpha/layout.js', '// saved');

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(changesIn(before, sent[0])).toEqual(['alpha revision']);
  });

  it.each([
    'alpha/.layout.js.swp',
    'alpha/4913',
    'alpha/layout.js~',
    'alpha/.#layout.js',
  ])('changes nothing for the editor-side file %s', async (sideFile) => {
    await writeLayouts('alpha');
    const before = (await start()).current();

    await files.write(`${sideFile}`, 'scratch');
    await files.write('alpha/layout.js', '// saved');

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(changesIn(before, sent[0])).toEqual(['alpha revision']);
  });

  it.each([
    { saved: 'alpha/layout.css', changes: ['alpha style'] },
    { saved: 'alpha/theme/extra.css', changes: ['alpha style'] },
    { saved: 'alpha/layout.js', changes: ['alpha revision'] },
    { saved: 'alpha/parts/card.mjs', changes: ['alpha revision'] },
    { saved: 'alpha/strings.json', changes: ['alpha revision'] },
    {
      saved: 'alpha/icons/check.svg',
      changes: ['alpha revision', 'alpha style'],
    },
    {
      saved: 'alpha/fonts/body.woff2',
      changes: ['alpha revision', 'alpha style'],
    },
  ])(
    'raises the revision its kind keys on a save of $saved',
    async ({ saved, changes }) => {
      await writeLayouts('alpha');
      const before = (await start()).current();

      await files.write(saved, '// saved');

      await vi.waitFor(() => expect(sent).toHaveLength(1));
      expect(changesIn(before, sent[0])).toEqual(changes);
    },
  );

  it('removes the old name and joins the new one when a layout folder is renamed', async () => {
    await writeLayouts('alpha', 'beta');
    const registry = await start(withFolderNameWatch(files));
    const before = registry.current();

    await files.rename('alpha', 'gamma');

    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(changesIn(before, sent[1])).toEqual(['alpha left', 'gamma joined']);
    expect(registry.names()).toEqual(['default', 'beta', 'gamma']);
  });

  // A folder-name report names no file, so the save in `alpha` raises both.
  it.each(['layout.d.ts', 'default/layout.js'])(
    'sends nothing for a folder-name report for %s',
    async (saved) => {
      await writeLayouts('alpha', 'default');
      const before = (await start(withFolderNameWatch(files))).current();

      await files.write(`${saved}`, '// saved');
      await files.write('alpha/layout.js', '// saved');

      await vi.waitFor(() => expect(sent).toHaveLength(1));
      expect(changesIn(before, sent[0])).toEqual([
        'alpha revision',
        'alpha style',
      ]);
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
  ])('logs a failing watch ($watch, $when)', async ({ watch, when, line }) => {
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
    {
      saved: 'layout.js',
      started: ['layout.js', 'layout.css'],
      hasCss: true,
      changes: ['default revision'],
    },
    {
      saved: 'layout.css',
      started: ['layout.js', 'layout.css'],
      hasCss: true,
      changes: ['default style'],
    },
    {
      saved: 'layout.css',
      started: ['layout.js'],
      hasCss: true,
      changes: ['default style'],
    },
    {
      saved: 'layout.js',
      started: ['layout.test.ts'],
      hasCss: false,
      changes: ['default live', 'default revision', 'default style'],
    },
  ])(
    'raises the revision its file keys on a save in the default folder ($saved, from $started)',
    async ({ saved, started, hasCss, changes }) => {
      await writeDefaultFiles(...started);
      const before = (await startWithDefault()).current();

      await writeDefaultFiles(saved);

      await vi.waitFor(() => expect(sent).toHaveLength(1));
      expect(changesIn(before, sent[0])).toEqual(changes);
      expect(defaultIn(sent[0])).toMatchObject({ builtIn: false, hasCss });
    },
  );

  // Each row changes the folders with no event reported, then both watches
  // report that they may have missed changes.
  it.each<{
    change: string;
    arrange: () => Promise<void>;
    changes: string[][];
  }>([
    {
      change: 'a save in beta',
      arrange: () => files.write('beta/layout.js', '// saved'),
      changes: [['beta revision']],
    },
    {
      change: 'a css save in beta',
      arrange: () => files.write('beta/layout.css', 'body {}'),
      changes: [['beta style']],
    },
    {
      change: 'a js and a css save in beta',
      arrange: async () => {
        await files.write('beta/layout.js', '// saved');
        await files.write('beta/layout.css', 'body {}');
      },
      changes: [['beta revision', 'beta style']],
    },
    { change: 'nothing', arrange: async () => {}, changes: [] },
    {
      change: 'a new layout',
      arrange: () => writeLayouts('gamma'),
      changes: [['gamma joined']],
    },
    {
      change: 'a save in the default folder',
      arrange: () => writeDefaultFiles('layout.css'),
      changes: [['default style']],
    },
    {
      change: 'a js save in the default folder',
      arrange: () => writeDefaultFiles('layout.js'),
      changes: [['default revision']],
    },
  ])(
    'lists again only what changed after a missed change: $change',
    async ({ arrange, changes }) => {
      let now = 1;
      files = createMemoryFiles({ now: () => now });
      clone = createMemoryFiles({ now: () => now });
      defaultFolder = scopedFiles(clone, DEFAULT_PATH, posixPaths);
      await writeLayouts('alpha', 'beta');
      await writeDefaultFiles('layout.js');
      const missed: (() => void)[] = [];
      const registry = await start(
        withUnreportedWatch(files, missed),
        LAYOUT_TYPES,
        withUnreportedWatch(defaultFolder, missed),
      );
      const before = registry.current();
      now = 2;
      await arrange();

      for (const reportMissed of missed) {
        reportMissed();
      }
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(changesPerSet(before, sent)).toEqual(changes);
    },
  );

  // Breaks if a reported save leaves its layout's stamps stale, so the next
  // missed change lists it again.
  it('sends once for a reported save that is then missed', async () => {
    let now = 1;
    files = createMemoryFiles({ now: () => now });
    await writeLayouts('alpha', 'beta');
    const missed: (() => void)[] = [];
    const before = (await start(withMissedWatch(files, missed))).current();
    now = 2;

    await files.write('beta/layout.js', '// saved');
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    for (const reportMissed of missed) {
      reportMissed();
    }
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(changesPerSet(before, sent)).toEqual([['beta revision']]);
  });

  // Breaks if a file whose modified time cannot be read fails the start or a
  // save's listing.
  it('still lists saves when a file time is unreadable', async () => {
    await writeLayouts('alpha', 'beta');
    const unreadable: Files = {
      ...files,
      modified: async (path) => {
        if (path === 'beta/layout.js') {
          throw Object.assign(new Error('denied'), { code: 'EACCES' });
        }
        return files.modified(path);
      },
    };
    const before = (await start(unreadable)).current();

    await files.write('alpha/layout.js', '// saved');

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(changesIn(before, sent[0])).toEqual(['alpha revision']);
  });

  it('sends the default without css when its layout css is removed', async () => {
    await writeDefaultFiles('layout.js', 'layout.css');
    const before = (await startWithDefault()).current();

    clone.remove(`${DEFAULT_PATH}/layout.css`);

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(changesIn(before, sent[0])).toEqual(['default style']);
    expect(defaultIn(sent[0])).toMatchObject({ builtIn: false, hasCss: false });
  });

  it.each([
    { saved: 'layout.test.ts', started: ['layout.js'] },
    { saved: 'parts/card.js', started: ['layout.js'] },
    { saved: 'layout.css', started: ['layout.test.ts'] },
  ])(
    'sends nothing for another file in the default folder ($saved, from $started)',
    async ({ saved, started }) => {
      await writeDefaultFiles(...started);
      await writeLayouts('alpha');
      const before = (await startWithDefault()).current();

      await writeDefaultFiles(saved);
      await files.write('alpha/layout.js', '// saved');

      await vi.waitFor(() => expect(sent).toHaveLength(1));
      expect(changesIn(before, sent[0])).toEqual(['alpha revision']);
    },
  );

  it('sends the built-in and then a higher revision when the default layout.js is removed and written again', async () => {
    await writeDefaultFiles('layout.js');
    const before = (await startWithDefault()).current();

    clone.remove(`${DEFAULT_PATH}/layout.js`);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    await writeDefaultFiles('layout.js');

    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(changesPerSet(before, sent)).toEqual([
      ['default built-in'],
      ['default live', 'default revision', 'default style'],
    ]);
    expect(defaultIn(sent[0])).toEqual(defaultEntry(false, true));
  });

  it('closes the default watch on dispose', async () => {
    await writeDefaultFiles('layout.js');
    const registry = await startWithDefault();

    registry.dispose();
    await writeDefaultFiles('layout.js');
    // Lets a relist the write may have queued run to its send.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sent).toEqual([]);
  });

  it('reports hasCss true when a layout.css is present', async () => {
    await writeLayouts('alpha');
    const registry = await start();
    expect(entryIn(registry.current(), 'alpha')?.hasCss).toBe(false);

    await files.write('alpha/layout.css', 'body {}');

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(entryIn(sent[0], 'alpha')).toMatchObject({
      hasCss: true,
      revision: 1,
      styleRevision: 2,
    });
    expect(entryIn(registry.current(), 'alpha')?.hasCss).toBe(true);
  });
});
