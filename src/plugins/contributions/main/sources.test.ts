import { describe, expect, it } from 'vitest';
import { errorText } from '../../../shared/error-text';
import type { HarnessPlugin } from '../../../shared/harness-folders';
import { createMemoryFiles } from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import { scanSources } from './sources';

const APP_DIR = '/app';
const APP_ROOT = '/app/agent-plugin';
const FILE_TEXT = '{ "version": 1 }';

function install(
  key: string,
  installDir: string,
  version: string | null,
): HarnessPlugin {
  return {
    harnessId: 'fake',
    plugin: { key, installDir, version, listedAt: null },
  };
}

// Memory files holding `auri.json` in each of `roots`, and a scan over them
// that records its log lines.
async function setUp(roots: readonly string[]) {
  const files = createMemoryFiles();
  for (const root of roots) {
    await files.write(`${root}/auri.json`, FILE_TEXT);
  }
  const logged: string[] = [];
  const scan = (plugins: readonly HarnessPlugin[]) =>
    scanSources(
      {
        files,
        paths: posixPaths,
        appDir: APP_DIR,
        log: (message) => logged.push(message),
      },
      plugins,
    );
  return { files, logged, scan };
}

describe('scanSources', () => {
  // Catches versions compared as text, and a lost source order.
  it.each<{
    name: string;
    roots: string[];
    plugins: HarnessPlugin[];
    kept: string[];
    dropped: string;
  }>([
    {
      name: 'one folder listed by two profiles',
      roots: ['/p/wigley'],
      plugins: [
        install('wigley@m', '/p/wigley', '1.0.0'),
        install('wigley@m', '/p/wigley', '1.0.0'),
      ],
      kept: ['wigley@m'],
      dropped: 'dropped wigley@m at /p/wigley: same folder as wigley@m',
    },
    {
      name: '1.2.0 against 1.10.0',
      roots: ['/p/a', '/p/b'],
      plugins: [
        install('wigley@m', '/p/a', '1.2.0'),
        install('wigley@n', '/p/b', '1.10.0'),
      ],
      kept: ['wigley@n'],
      dropped: 'dropped wigley@m at /p/a: wigley@n at /p/b wins',
    },
    {
      name: 'null against 0.1.0',
      roots: ['/p/a', '/p/b'],
      plugins: [
        install('wigley@m', '/p/a', null),
        install('wigley@n', '/p/b', '0.1.0'),
      ],
      kept: ['wigley@n'],
      dropped: 'dropped wigley@m at /p/a: wigley@n at /p/b wins',
    },
    {
      name: 'a tie',
      roots: ['/p/a', '/p/b'],
      plugins: [
        install('wigley@m', '/p/a', '1.0.0'),
        install('wigley@n', '/p/b', '1.0.0'),
      ],
      kept: ['wigley@m'],
      dropped: 'dropped wigley@n at /p/b: wigley@m at /p/a wins',
    },
    {
      name: "an installed auri against the app's own",
      roots: [APP_ROOT, '/p/auri'],
      plugins: [install('auri@m', '/p/auri', '9.0.0')],
      kept: ['auri@app'],
      dropped: `dropped auri@m at /p/auri: auri@app at ${APP_ROOT} wins`,
    },
  ])('dedupes $name', async ({ roots, plugins, kept, dropped }) => {
    const { logged, scan } = await setUp(roots);

    const sources = await scan(plugins);

    expect(sources.map(({ source }) => source.pluginKey)).toEqual(kept);
    expect(logged).toEqual([dropped]);
  });

  it('keeps sources in candidate order', async () => {
    const { scan } = await setUp([APP_ROOT, '/p/b', '/p/a']);

    const sources = await scan([
      install('beta@m', '/p/b', '1.0.0'),
      install('alpha@m', '/p/a', '1.0.0'),
    ]);

    expect(sources.map(({ source }) => source.pluginKey)).toEqual([
      'auri@app',
      'beta@m',
      'alpha@m',
    ]);
  });

  it('reads an install as a source with its name, root and file', async () => {
    const { scan } = await setUp(['/p/wigley']);

    const sources = await scan([install('wigley@m', '/p/wigley', '2.0.0')]);

    expect(sources).toEqual([
      {
        source: {
          pluginName: 'wigley',
          pluginKey: 'wigley@m',
          version: '2.0.0',
          root: '/p/wigley',
          harnessId: 'fake',
        },
        file: { text: FILE_TEXT },
      },
    ]);
  });

  // Catches a candidate with no file, or no folder, shown as a source.
  it('leaves out, with no log, a root with no auri.json and a missing root', async () => {
    const { files, logged, scan } = await setUp([]);
    await files.write('/p/empty/README.md', 'no contributions');

    const sources = await scan([
      install('empty@m', '/p/empty', '1.0.0'),
      install('gone@m', '/p/gone', '1.0.0'),
    ]);

    expect(sources).toEqual([]);
    expect(logged).toEqual([]);
  });

  // Catches an unreadable file that vanishes with no problem shown.
  it('keeps a source whose auri.json read fails, carrying the error', async () => {
    const { files, scan } = await setUp(['/p/odd']);
    const denied = new Error('EACCES: permission denied');
    const read = files.read;
    files.read = (path) =>
      path === '/p/odd/auri.json' ? Promise.reject(denied) : read(path);
    const error = errorText(denied);

    const sources = await scan([install('odd@m', '/p/odd', '1.0.0')]);

    expect(sources.map(({ file }) => file)).toEqual([{ error }]);
  });
});
