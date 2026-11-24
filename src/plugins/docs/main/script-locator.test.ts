import { describe, expect, it } from 'vitest';
import { createMemoryFiles } from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import { locateScript } from './script-locator';

const HOME = '/Users/u';
const PLUGIN_DIR = '/Applications/App.app/Contents/Resources/agent-plugin';
const PLUGIN_SCRIPT = `${PLUGIN_DIR}/scripts/docs-index/docs_index.py`;

describe('locateScript', () => {
  it.each<{
    case: string;
    scriptPath: string;
    written: string[];
    folders: string[];
    expected: string | null;
  }>([
    {
      case: 'a set scriptPath, expanded, over the plugin copy',
      scriptPath: '~/src/docs_index.py',
      written: [PLUGIN_SCRIPT],
      folders: [],
      expected: '/Users/u/src/docs_index.py',
    },
    {
      case: "an empty scriptPath, the agent plugin's copy",
      scriptPath: '',
      written: [PLUGIN_SCRIPT],
      folders: [],
      expected: PLUGIN_SCRIPT,
    },
    {
      case: 'no copy in the plugin, null',
      scriptPath: '',
      written: [],
      folders: [],
      expected: null,
    },
    {
      case: 'a folder where the copy belongs, null',
      scriptPath: '',
      written: [],
      folders: [PLUGIN_SCRIPT],
      expected: null,
    },
  ])(
    'locateScript gives $case',
    async ({ scriptPath, written, folders, expected }) => {
      const files = createMemoryFiles();
      for (const path of written) {
        await files.write(path, '');
      }
      for (const folder of folders) {
        await files.makeFolder(folder);
      }

      const script = await locateScript(
        files,
        HOME,
        scriptPath,
        PLUGIN_DIR,
        posixPaths,
      );

      expect(script).toBe(expected);
    },
  );
});
