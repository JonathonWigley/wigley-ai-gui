import { beforeEach, describe, expect, it } from 'vitest';
import { manifestSchema } from '../../shared/plugin-catalog/manifest-schema';
import { createMemoryFiles, type MemoryFiles } from '../../shared/memory-files';
import { posixPaths } from '../../shared/paths/posix-paths';
import { emittedTypesFolder, writePluginTypes } from './plugin-types';

const TYPES_FOLDER = '/config/plugins/_types';
const EMITTED_FOLDER = '/app/.plugin-types';

let files: MemoryFiles;
let logLines: string[];

beforeEach(() => {
  files = createMemoryFiles();
  logLines = [];
});

function writeTypes(): Promise<void> {
  return writePluginTypes({
    files,
    typesFolder: TYPES_FOLDER,
    emittedFolder: EMITTED_FOLDER,
    paths: posixPaths,
    log: (source, message) => logLines.push(`[${source}] ${message}`),
  });
}

async function typesFolderFiles(): Promise<string[]> {
  return (await files.list(TYPES_FOLDER, { recursive: true }))
    .filter((entry) => entry.kind === 'file')
    .map((entry) => entry.path)
    .sort();
}

describe('writePluginTypes', () => {
  it('writePluginTypes_CopiesEveryDtsAtItsRelativePath', async () => {
    await files.write(`${EMITTED_FOLDER}/contracts/plugin.d.ts`, 'plugin');
    await files.write(`${EMITTED_FOLDER}/plugins/chat/contract.d.ts`, 'chat');
    await files.write(`${EMITTED_FOLDER}/.tsbuildinfo`, '{}');

    await writeTypes();

    expect(await typesFolderFiles()).toEqual([
      'contracts/plugin.d.ts',
      'manifest.schema.json',
      'plugin.d.ts',
      'plugins/chat/contract.d.ts',
    ]);
    expect(await files.read(`${TYPES_FOLDER}/plugins/chat/contract.d.ts`)).toBe(
      'chat',
    );
    expect(logLines).toEqual([]);
  });

  it('writePluginTypes_WritesPluginDtsAndSchema', async () => {
    await files.makeFolder(EMITTED_FOLDER);

    await writeTypes();

    expect(await files.read(`${TYPES_FOLDER}/plugin.d.ts`)).toBe(
      "export type * from './contracts/user-plugin';\n",
    );
    const schemaText = await files.read(`${TYPES_FOLDER}/manifest.schema.json`);
    expect(JSON.parse(schemaText)).toEqual(manifestSchema);
    expect(schemaText.endsWith('}\n')).toBe(true);
  });

  it('writePluginTypes_NoEmittedFolder_LogsAndStillWritesTheRest', async () => {
    await expect(writeTypes()).resolves.toBeUndefined();

    expect(logLines).toEqual([
      `[plugins] plugin types not written: ${EMITTED_FOLDER} is missing`,
    ]);
    expect(await typesFolderFiles()).toEqual([
      'manifest.schema.json',
      'plugin.d.ts',
    ]);
  });
});

describe('emittedTypesFolder', () => {
  it.each([
    { isPackaged: true, expected: '/Resources/.plugin-types' },
    { isPackaged: false, expected: '/repo/.plugin-types' },
  ])(
    'emittedTypesFolder_PicksResourcesWhenPackaged: packaged $isPackaged',
    ({ isPackaged, expected }) => {
      expect(
        emittedTypesFolder(
          { isPackaged, appPath: '/repo', resourcesPath: '/Resources' },
          posixPaths,
        ),
      ).toBe(expected);
    },
  );
});
