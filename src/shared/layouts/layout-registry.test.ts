import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Files } from '../../contracts/files';
import type { LayoutEntry, LayoutSet } from '../../contracts/layouts';
import { createMemoryFiles, type MemoryFiles } from '../memory-files';
import { type LayoutRegistry, startLayoutRegistry } from './layout-registry';

const LAYOUT_TYPES = 'declare const types: 1;';

let files: MemoryFiles;
let sent: LayoutSet[];
let logLines: string[];

beforeEach(() => {
  files = createMemoryFiles();
  sent = [];
  logLines = [];
});

function start(data: Files = files): Promise<LayoutRegistry> {
  return startLayoutRegistry({
    data,
    send: (set) => sent.push(set),
    log: (source, message) => logLines.push(`[${source}] ${message}`),
    logSource: 'demo',
    layoutTypes: LAYOUT_TYPES,
  });
}

async function writeLayouts(...names: string[]): Promise<void> {
  for (const name of names) {
    await files.write(`layouts/${name}/layout.js`, `// ${name}`);
  }
}

function entryIn(set: LayoutSet, name: string): LayoutEntry | undefined {
  return set.layouts.find((layout) => layout.name === name);
}

// `files` whose watch hands its options' `onError` to `fail`.
function withFailingWatch(inner: Files): {
  data: Files;
  fail(error: unknown): void;
} {
  let onWatchError: ((error: unknown) => void) | undefined;
  return {
    data: {
      ...inner,
      watch: (folder, onChange, options) => {
        onWatchError = options?.onError;
        return inner.watch(folder, onChange);
      },
    },
    fail: (error) => onWatchError?.(error),
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

    expect(await files.read('layouts/layout.d.ts')).toBe(LAYOUT_TYPES);
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
      expect.stringMatching(/^\[demo\] .*layouts\/default/),
    );
  });

  it('start_FolderWithoutLayoutJs_IsNotListed', async () => {
    await files.write('layouts/notes/readme.json', '{}');

    const registry = await start();

    expect(registry.names()).toEqual(['default']);
  });
});

describe('watch', () => {
  it('watch_SaveInAnyUserFolder_BumpsOnlyThatLayout', async () => {
    await writeLayouts('alpha', 'beta');
    await start();

    await files.write('layouts/beta/layout.js', '// saved');

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].changed).toBe('beta');
    expect(entryIn(sent[0], 'beta')?.revision).toBe(2);
    expect(entryIn(sent[0], 'alpha')?.revision).toBe(1);
  });

  it('watch_LayoutJsRemoved_SendsSetWithoutIt', async () => {
    await writeLayouts('alpha');
    const registry = await start();

    files.remove('layouts/alpha/layout.js');

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].changed).toBe('alpha');
    expect(entryIn(sent[0], 'alpha')).toBeUndefined();
    expect(registry.names()).toEqual(['default']);
  });

  it('watch_LayoutRemovedThenWrittenAgain_TakesAHigherRevision', async () => {
    await writeLayouts('alpha');
    await start();

    files.remove('layouts/alpha/layout.js');
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

    await files.write('layouts/notes/readme.json', '{}');
    await files.write('layouts/alpha/layout.js', '// saved');

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].changed).toBe('alpha');
  });

  it('watch_SaveInDefaultFolder_SendsNothing', async () => {
    await writeLayouts('alpha');
    await start();

    await files.write('layouts/default/layout.js', '// mine');
    await files.write('layouts/alpha/layout.js', '// saved');

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

    await files.write(`layouts/${sideFile}`, 'scratch');
    await files.write('layouts/alpha/layout.js', '// saved');

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

    await files.write(`layouts/${saved}`, '// saved');

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].changed).toBe('alpha');
  });

  it('watch_LayoutFolderRenamed_OldLeavesAndNewJoins', async () => {
    await writeLayouts('alpha', 'beta');
    const registry = await start(withFolderNameWatch(files));

    await files.rename('layouts/alpha', 'layouts/gamma');

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

      await files.write(`layouts/${saved}`, '// saved');
      await files.write('layouts/alpha/layout.js', '// saved');

      await vi.waitFor(() => expect(sent).toHaveLength(1));
      expect(sent[0].changed).toBe('alpha');
    },
  );

  it('watch_Fails_LogsIt', async () => {
    const failing = withFailingWatch(files);
    await start(failing.data);

    failing.fail(new Error('EMFILE'));

    expect(logLines).toContainEqual(
      expect.stringMatching(/^\[demo\] .*watch.*EMFILE/),
    );
  });

  it('hasCss_TrueWhenLayoutCssPresent', async () => {
    await writeLayouts('alpha');
    const registry = await start();
    expect(entryIn(registry.current(), 'alpha')?.hasCss).toBe(false);

    await files.write('layouts/alpha/layout.css', 'body {}');

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(entryIn(sent[0], 'alpha')?.hasCss).toBe(true);
    expect(entryIn(registry.current(), 'alpha')?.hasCss).toBe(true);
  });
});
