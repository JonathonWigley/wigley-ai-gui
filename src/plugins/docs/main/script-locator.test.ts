import { describe, expect, it } from 'vitest';
import { createMemoryFiles } from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import type { HarnessFolders, HarnessPlugin } from './harness-folders';
import { locateScript, WIGLEY_PLUGIN_KEY } from './script-locator';

const HOME = '/Users/u';
const SCRIPT_IN_INSTALL = 'scripts/docs-index/docs_index.py';

// A folders stub listing `plugins` (key, install folder), in order.
function foldersListing(
  ...plugins: [key: string, installDir: string][]
): Pick<HarnessFolders, 'installedPlugins'> {
  const listed: HarnessPlugin[] = plugins.map(([key, installDir]) => ({
    harnessId: 'claude',
    plugin: { key, installDir, version: null, listedAt: null },
  }));
  return { installedPlugins: async () => listed };
}

describe('locateScript', () => {
  it('locateScript_SettingSet_ReturnsItExpanded', async () => {
    const files = createMemoryFiles();

    const script = await locateScript(
      files,
      HOME,
      '~/src/docs_index.py',
      foldersListing(),
      posixPaths,
    );

    expect(script).toBe('/Users/u/src/docs_index.py');
  });

  it('locateScript_InstalledInDefaultDir_ReturnsInstallScript', async () => {
    const files = createMemoryFiles();
    const install = '/Users/u/.claude/plugins/cache/w/wigley/9.9.9';
    await files.write(`${install}/${SCRIPT_IN_INSTALL}`, '');

    const script = await locateScript(
      files,
      HOME,
      '',
      foldersListing([WIGLEY_PLUGIN_KEY, install]),
      posixPaths,
    );

    expect(script).toBe(`${install}/${SCRIPT_IN_INSTALL}`);
  });

  it('locateScript_SecondProfilesInstall_Found', async () => {
    const files = createMemoryFiles();
    const other = '/Users/u/.claude/plugins/cache/m/other/1.0.0';
    const install = '/Users/u/.claude-personal/plugins/cache/w/wigley/1.0.0';
    await files.write(`${other}/${SCRIPT_IN_INSTALL}`, '');
    await files.write(`${install}/${SCRIPT_IN_INSTALL}`, '');

    const script = await locateScript(
      files,
      HOME,
      '',
      foldersListing(['other@m', other], [WIGLEY_PLUGIN_KEY, install]),
      posixPaths,
    );

    expect(script).toBe(`${install}/${SCRIPT_IN_INSTALL}`);
  });

  it('locateScript_InstallPathWithoutScript_SkipsIt', async () => {
    const files = createMemoryFiles();
    const missing = '/Users/u/.claude/plugins/cache/w/wigley/1.0.0';
    const present = '/Users/u/.claude/plugins/cache/w/wigley/2.0.0';
    await files.write(`${present}/${SCRIPT_IN_INSTALL}`, '');

    const script = await locateScript(
      files,
      HOME,
      '',
      foldersListing([WIGLEY_PLUGIN_KEY, missing], [WIGLEY_PLUGIN_KEY, present]),
      posixPaths,
    );

    expect(script).toBe(`${present}/${SCRIPT_IN_INSTALL}`);
  });

  it('locateScript_NothingInstalled_Null', async () => {
    const files = createMemoryFiles();

    expect(
      await locateScript(files, HOME, '', foldersListing(), posixPaths),
    ).toBeNull();
  });
});
