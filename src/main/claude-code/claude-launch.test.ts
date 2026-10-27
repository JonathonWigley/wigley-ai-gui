import { describe, expect, it } from 'vitest';
import { posixPaths } from '../../shared/paths/posix-paths';
import { windowsPaths } from '../../shared/paths/windows-paths';
import { claudeConfigFolder, claudeLaunch } from './claude-launch';

const TOOL = 'mcp__plugin_wigley_wigley-forms__permission_prompt';

describe('claudeLaunch', () => {
  it('claudeLaunch_NewSession_PinnedArgsAndProfileEnv', () => {
    const launch = claudeLaunch(
      {
        sessionId: 's-1',
        resume: false,
        projectDir: '/proj',
        profileDir: '/p',
      },
      TOOL,
      { HOME: '/h', CLAUDE_CONFIG_DIR: '/x' },
      '/h',
      posixPaths,
    );

    expect(launch.args).toEqual([
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--include-partial-messages',
      '--verbose',
      '--session-id',
      's-1',
      '--permission-mode',
      'auto',
      '--permission-prompt-tool',
      TOOL,
    ]);
    expect(launch.cwd).toBe('/proj');
    expect(launch.env).toEqual({ HOME: '/h', CLAUDE_CONFIG_DIR: '/p' });
  });

  it('claudeLaunch_Resume_ResumeFlagAndInheritedConfigDir', () => {
    const env = { CLAUDE_CONFIG_DIR: '/x' };

    const launch = claudeLaunch(
      { sessionId: 's-1', resume: true, projectDir: '/proj', profileDir: null },
      TOOL,
      env,
      '/h',
      posixPaths,
    );

    expect(launch.args.slice(7, 9)).toEqual(['--resume', 's-1']);
    expect(launch.args).not.toContain('--session-id');
    expect(launch.env.CLAUDE_CONFIG_DIR).toBe('/x');
    expect(launch.env).not.toBe(env);
  });

  it('claudeLaunch_NestedSessionEnv_StripsListedNamesOnly', () => {
    const launch = claudeLaunch(
      {
        sessionId: 's-1',
        resume: false,
        projectDir: '/proj',
        profileDir: '/p',
      },
      TOOL,
      {
        HOME: '/h',
        CLAUDECODE: '1',
        CLAUDE_CODE_SESSION_ID: 'parent-session',
        CLAUDE_CODE_USE_BEDROCK: '1',
      },
      '/h',
      posixPaths,
    );

    expect(launch.env).toEqual({
      HOME: '/h',
      CLAUDE_CODE_USE_BEDROCK: '1',
      CLAUDE_CONFIG_DIR: '/p',
    });
  });

  it("expands a profile folder against the adapter's home", () => {
    const launch = claudeLaunch(
      {
        sessionId: 's-1',
        resume: false,
        projectDir: '/proj',
        profileDir: '~/.claude-personal',
      },
      TOOL,
      { HOME: '/elsewhere' },
      '/Users/u',
      posixPaths,
    );

    expect(launch.env.CLAUDE_CONFIG_DIR).toBe('/Users/u/.claude-personal');
  });

  it('claudeLaunch_WindowsProfile_ExpandsUnderHome', () => {
    const launch = claudeLaunch(
      {
        sessionId: 's-1',
        resume: false,
        projectDir: 'C:\\proj',
        profileDir: '~/.claude-work',
      },
      TOOL,
      {},
      'C:\\Users\\jo',
      windowsPaths,
    );

    expect(launch.env.CLAUDE_CONFIG_DIR).toBe('C:\\Users\\jo\\.claude-work');
  });
});

describe('claudeConfigFolder', () => {
  it("claudeConfigFolder expands a profile folder against the adapter's home", () => {
    expect(
      claudeConfigFolder(
        '~/.claude-personal',
        { CLAUDE_CONFIG_DIR: '/c' },
        '/Users/u',
        posixPaths,
      ),
    ).toBe('/Users/u/.claude-personal');
  });

  it('claudeConfigFolder_WindowsDefault_IsHomeClaude', () => {
    expect(claudeConfigFolder(null, {}, 'C:\\Users\\jo', windowsPaths)).toBe(
      'C:\\Users\\jo\\.claude',
    );
  });
});
