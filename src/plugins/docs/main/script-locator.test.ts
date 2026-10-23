import { describe, expect, it } from 'vitest';
import type { Files } from '../../../contracts/files';
import { createMemoryFiles } from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import { windowsPaths } from '../../../shared/paths/windows-paths';
import { locateScript, readClaudeConfigDirs } from './script-locator';

const HOME = '/Users/u';
const SCRIPT_IN_INSTALL = 'scripts/docs-index/docs_index.py';
const CONFIG_FILE = '/Users/u/.agents/wigley-docs/config.json';

const ignoreLog = () => undefined;

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

    const script = await locateScript(
      files,
      HOME,
      '~/src/docs_index.py',
      ignoreLog,
      posixPaths,
    );

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

    const script = await locateScript(files, HOME, '', ignoreLog, posixPaths);

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

    const script = await locateScript(files, HOME, '', ignoreLog, posixPaths);

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

    const script = await locateScript(files, HOME, '', ignoreLog, posixPaths);

    expect(script).toBe(`${present}/${SCRIPT_IN_INSTALL}`);
  });

  it('locateScript_NothingInstalled_Null', async () => {
    const files = createMemoryFiles();

    expect(
      await locateScript(files, HOME, '', ignoreLog, posixPaths),
    ).toBeNull();
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
    await files.write(CONFIG_FILE, config);

    expect(
      await readClaudeConfigDirs(files, HOME, ignoreLog, posixPaths),
    ).toEqual(['/Users/u/.claude']);
  });

  it('readClaudeConfigDirs_RelativeEntries_Dropped', async () => {
    const files = createMemoryFiles();
    await files.write(
      CONFIG_FILE,
      '{"claudeConfigDirs":[".", "~/.claude-personal", "rel/dir", "/abs"]}',
    );

    expect(
      await readClaudeConfigDirs(files, HOME, ignoreLog, posixPaths),
    ).toEqual(['/Users/u/.claude-personal', '/abs']);
  });

  it('readClaudeConfigDirs_OnlyRelativeEntries_Default', async () => {
    const files = createMemoryFiles();
    await files.write(CONFIG_FILE, '{"claudeConfigDirs":[".", "~user/x"]}');

    expect(
      await readClaudeConfigDirs(files, HOME, ignoreLog, posixPaths),
    ).toEqual(['/Users/u/.claude']);
  });

  it('readClaudeConfigDirs_UnparsableConfig_DefaultAndLogged', async () => {
    const files = createMemoryFiles();
    await files.write(CONFIG_FILE, 'not json');
    const logged: string[] = [];

    const dirs = await readClaudeConfigDirs(
      files,
      HOME,
      (source, message) => logged.push(`[${source}] ${message}`),
      posixPaths,
    );

    expect(dirs).toEqual(['/Users/u/.claude']);
    expect(logged).toHaveLength(1);
    expect(logged[0].startsWith(`[docs] ${CONFIG_FILE} not read: `)).toBe(true);
  });

  it('readClaudeConfigDirs_UnreadableConfig_DefaultAndLogged', async () => {
    const memory = createMemoryFiles();
    const files: Files = {
      ...memory,
      read: async () => {
        throw new Error('EACCES: permission denied');
      },
    };
    const logged: string[] = [];

    const dirs = await readClaudeConfigDirs(
      files,
      HOME,
      (source, message) => logged.push(`[${source}] ${message}`),
      posixPaths,
    );

    expect(dirs).toEqual(['/Users/u/.claude']);
    expect(logged).toEqual([
      `[docs] ${CONFIG_FILE} not read: EACCES: permission denied`,
    ]);
  });

  it('readClaudeConfigDirs_NoConfig_DefaultNothingLogged', async () => {
    const files = createMemoryFiles();
    const logged: string[] = [];

    const dirs = await readClaudeConfigDirs(
      files,
      HOME,
      (_source, message) => logged.push(message),
      posixPaths,
    );

    expect(dirs).toEqual(['/Users/u/.claude']);
    expect(logged).toEqual([]);
  });
});

describe('locateScript failures', () => {
  it('locateScript_UnreadableInstalledPlugins_NullAndLogged', async () => {
    const memory = createMemoryFiles();
    const installed = '/Users/u/.claude/plugins/installed_plugins.json';
    const files: Files = {
      ...memory,
      read: async (path) => {
        if (path === installed) {
          throw new Error('EACCES: permission denied');
        }
        return memory.read(path);
      },
    };
    const logged: string[] = [];

    const script = await locateScript(
      files,
      HOME,
      '',
      (_source, message) => logged.push(message),
      posixPaths,
    );

    expect(script).toBeNull();
    expect(logged).toEqual([
      `${installed} not read: EACCES: permission denied`,
    ]);
  });
});

describe('on Windows', () => {
  // The memory files refuse Windows paths, so `read` serves `texts` by exact
  // path and rejects every other path as missing.
  function servingFiles(texts: Record<string, string>): Files {
    return {
      ...createMemoryFiles(),
      read: async (path) => {
        const text = texts[path];
        if (text === undefined) {
          throw Object.assign(new Error(`${path} is missing`), {
            code: 'ENOENT',
          });
        }
        return text;
      },
    };
  }

  it('readClaudeConfigDirs_WindowsEntries_AbsoluteKeptNormalized', async () => {
    const files = servingFiles({
      'C:\\Users\\u\\.agents\\wigley-docs\\config.json':
        '{"claudeConfigDirs":["C:/claude/","\\\\x","rel","~/.claude-personal"]}',
    });

    expect(
      await readClaudeConfigDirs(
        files,
        'C:\\Users\\u',
        ignoreLog,
        windowsPaths,
      ),
    ).toEqual(['C:\\claude', 'C:\\Users\\u\\.claude-personal']);
  });
});
