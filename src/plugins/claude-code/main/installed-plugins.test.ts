import { describe, expect, it } from 'vitest';
import type { Files } from '../../../contracts/files';
import { createMemoryFiles } from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import { readInstalledPlugins } from './installed-plugins';

const CONFIG = '/home/u/.claude';
const INSTALLED = `${CONFIG}/plugins/installed_plugins.json`;

// Reads `text` as `INSTALLED` (none when null) through `files`, the memory files when not given.
async function readWith(text: string | null, files?: Files) {
  const memory = createMemoryFiles();
  if (text !== null) {
    await memory.write(INSTALLED, text);
  }
  const logged: string[] = [];
  const records = await readInstalledPlugins(
    {
      files: files ?? memory,
      paths: posixPaths,
      log: (_source, message) => logged.push(message),
    },
    CONFIG,
  );
  return { records, logged };
}

describe('readInstalledPlugins', () => {
  it('readInstalledPlugins_ListsEveryInstallInFileOrder', async () => {
    const text = [
      '{',
      '  "version": 2,',
      '  "plugins": {',
      '    "wigley@wigley-ai-marketplace": [',
      '      { "scope": "user", "installPath": "/cache/wigley/1.0", "version": "1.0" },',
      '      { "scope": "project", "projectPath": "/repo", "installPath": "/cache/wigley/2.0" }',
      '    ],',
      '    "tools@x": [',
      '      { "scope": "user", "installPath": "/cache/tools/1.0", "version": "1.0" }',
      '    ]',
      '  }',
      '}',
    ].join('\n');

    const { records } = await readWith(text);

    expect(records).toMatchObject([
      {
        key: 'wigley@wigley-ai-marketplace',
        installDir: '/cache/wigley/1.0',
        version: '1.0',
        listedAt: { path: INSTALLED, line: 4 },
      },
      {
        key: 'wigley@wigley-ai-marketplace',
        installDir: '/cache/wigley/2.0',
        version: null,
        listedAt: { path: INSTALLED, line: 4 },
      },
      {
        key: 'tools@x',
        installDir: '/cache/tools/1.0',
        version: '1.0',
        listedAt: { path: INSTALLED, line: 8 },
      },
    ]);
    expect(records).toHaveLength(3);
  });

  it('readInstalledPlugins_KeyOnLine3_ListedAtLine3', async () => {
    const { records } = await readWith(
      '{\n"plugins":{\n"p@m":[{"installPath":"/x","version":"1"}]\n}}',
    );

    expect(records.map((record) => record.listedAt)).toEqual([
      { path: INSTALLED, line: 3 },
    ]);

    // The key is written with an escape, so no line holds `"p@m"`.
    const escaped = await readWith(
      '{"plugins":{"p\\u0040m":[{"installPath":"/x"}]}}',
    );

    expect(escaped.records).toEqual([
      expect.objectContaining({ key: 'p@m', listedAt: null }),
    ]);
  });

  it.each<{
    case: string;
    text: string | null;
    throwing: boolean;
    records: unknown[];
    logged: string[];
  }>([
    {
      case: 'missing file',
      text: null,
      throwing: false,
      records: [],
      logged: [],
    },
    {
      case: 'not JSON',
      text: 'not json',
      throwing: false,
      records: [],
      logged: [`installed plugins not read: ${INSTALLED} is not JSON`],
    },
    {
      case: 'a read that throws',
      text: null,
      throwing: true,
      records: [],
      logged: ['installed plugins not read: boom'],
    },
    {
      case: 'a record with no installPath',
      text: JSON.stringify({
        plugins: { 'p@m': [{ scope: 'user' }, { installPath: '/x' }] },
      }),
      throwing: false,
      records: [expect.objectContaining({ key: 'p@m', installDir: '/x' })],
      logged: [],
    },
  ])(
    'readInstalledPlugins_UnreadableFile ($case)',
    async ({ text, throwing, records, logged }) => {
      const throwingFiles: Files = {
        ...createMemoryFiles(),
        read: async () => {
          throw new Error('boom');
        },
      };

      const read = await readWith(text, throwing ? throwingFiles : undefined);

      expect(read.records).toEqual(records);
      expect(read.logged).toEqual(logged);
    },
  );

  it('readInstalledPlugins_ScopeAndProjectPath_Carried', async () => {
    const { records } = await readWith(
      JSON.stringify({
        plugins: {
          'p@m': [
            { scope: 'project', projectPath: '/repo', installPath: '/x' },
            { installPath: '/y' },
          ],
        },
      }),
    );

    expect(
      records.map(({ installDir, scope, projectPath }) => ({
        installDir,
        scope,
        projectPath,
      })),
    ).toEqual([
      { installDir: '/x', scope: 'project', projectPath: '/repo' },
      { installDir: '/y', scope: null, projectPath: null },
    ]);
  });
});
