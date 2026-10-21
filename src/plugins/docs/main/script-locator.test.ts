import { describe, expect, it } from 'vitest';
import { createMemoryFiles } from '../../../shared/memory-files';
import { locateScript, readClaudeConfigDirs } from './script-locator';

const HOME = '/Users/u';
const SCRIPT_IN_INSTALL = 'scripts/docs-index/docs_index.py';

function installs(...installPaths: string[]): string {
  return JSON.stringify({
    plugins: {
      'wigley@wigley-ai-marketplace': installPaths.map((installPath) => ({
        installPath,
      })),
    },
  });
}

describe('locateScript', () => {
  it('locateScript_SettingSet_ReturnsItExpanded', async () => {
    const files = createMemoryFiles();

    const script = await locateScript(files, HOME, '~/src/docs_index.py');

    expect(script).toBe('/Users/u/src/docs_index.py');
  });

  it('locateScript_InstalledInDefaultDir_ReturnsInstallScript', async () => {
    const files = createMemoryFiles();
    const install = '/Users/u/.claude/plugins/cache/w/wigley/9.9.9';
    await files.write(
      '/Users/u/.claude/plugins/installed_plugins.json',
      installs(install),
    );
    await files.write(`${install}/${SCRIPT_IN_INSTALL}`, '');

    const script = await locateScript(files, HOME, '');

    expect(script).toBe(`${install}/${SCRIPT_IN_INSTALL}`);
  });

  it('locateScript_SecondConfigDir_Found', async () => {
    const files = createMemoryFiles();
    const install = '/Users/u/.claude-personal/plugins/cache/w/wigley/1.0.0';
    await files.write(
      '/Users/u/.agents/wigley-docs/config.json',
      '{"claudeConfigDirs":["~/.claude","~/.claude-personal"]}',
    );
    await files.write(
      '/Users/u/.claude-personal/plugins/installed_plugins.json',
      installs(install),
    );
    await files.write(`${install}/${SCRIPT_IN_INSTALL}`, '');

    const script = await locateScript(files, HOME, '');

    expect(script).toBe(`${install}/${SCRIPT_IN_INSTALL}`);
  });

  it('locateScript_InstallPathWithoutScript_SkipsIt', async () => {
    const files = createMemoryFiles();
    const missing = '/Users/u/.claude/plugins/cache/w/wigley/1.0.0';
    const present = '/Users/u/.claude/plugins/cache/w/wigley/2.0.0';
    await files.write(
      '/Users/u/.claude/plugins/installed_plugins.json',
      installs(missing, present),
    );
    await files.write(`${present}/${SCRIPT_IN_INSTALL}`, '');

    const script = await locateScript(files, HOME, '');

    expect(script).toBe(`${present}/${SCRIPT_IN_INSTALL}`);
  });

  it('locateScript_NothingInstalled_Null', async () => {
    const files = createMemoryFiles();

    expect(await locateScript(files, HOME, '')).toBeNull();
  });
});

describe('readClaudeConfigDirs', () => {
  it.each([
    '{"claudeConfigDirs":[]}',
    '{"claudeConfigDirs":"~/.x"}',
    '{"claudeConfigDirs":[1]}',
    'not json',
  ])('readClaudeConfigDirs_EmptyOrWrongShape_Default %s', async (config) => {
    const files = createMemoryFiles();
    await files.write('/Users/u/.agents/wigley-docs/config.json', config);

    expect(await readClaudeConfigDirs(files, HOME)).toEqual([
      '/Users/u/.claude',
    ]);
  });
});
