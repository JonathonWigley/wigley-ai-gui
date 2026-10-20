import { describe, expect, it } from 'vitest';
import { claudeLaunch } from './claude-launch';

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
    );

    expect(launch.args.slice(7, 9)).toEqual(['--resume', 's-1']);
    expect(launch.args).not.toContain('--session-id');
    expect(launch.env.CLAUDE_CONFIG_DIR).toBe('/x');
    expect(launch.env).not.toBe(env);
  });
});
