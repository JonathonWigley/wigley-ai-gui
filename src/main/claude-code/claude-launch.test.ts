import { describe, expect, it } from 'vitest';
import { posixPaths } from '../../shared/paths/posix-paths';
import { windowsPaths } from '../../shared/paths/windows-paths';
import { claudeConfigFolder, claudeEnv, claudeLaunch } from './claude-launch';

const TOOL = 'mcp__plugin_wigley_wigley-forms__permission_prompt';

describe('claudeLaunch', () => {
  it('claudeLaunch_NewSession_PinnedArgsAndProfileEnv', () => {
    const launch = claudeLaunch(
      {
        processId: 'p-1',
        sessionId: 's-1',
        resume: false,
        projectDir: '/proj',
        profileDir: '/p',
        controls: {},
        instructions: [],
        idleCompactMinTokens: null,
        rowId: 'row-1',
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
    expect(launch.env).toEqual({
      HOME: '/h',
      CLAUDE_CONFIG_DIR: '/p',
      WIGLEY_SESSION_ROW: 'row-1',
    });
  });

  it('claudeLaunch_Resume_ResumeFlagAndInheritedConfigDir', () => {
    const env = { CLAUDE_CONFIG_DIR: '/x' };

    const launch = claudeLaunch(
      {
        processId: 'p-1',
        sessionId: 's-1',
        resume: true,
        projectDir: '/proj',
        profileDir: null,
        controls: {},
        instructions: [],
        idleCompactMinTokens: null,
        rowId: 'row-1',
      },
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

  it.each<{
    name: string;
    controls: Record<string, string>;
    present: string[][];
    absent: string[][];
  }>([
    {
      name: 'all three controls',
      controls: { model: 'sonnet', effort: 'high', mode: 'plan' },
      present: [
        ['--model', 'sonnet'],
        ['--effort', 'high'],
        ['--permission-mode', 'plan'],
      ],
      absent: [['--permission-mode', 'auto']],
    },
    {
      name: 'no controls',
      controls: {},
      present: [['--permission-mode', 'auto']],
      absent: [['--model'], ['--effort']],
    },
    {
      name: 'mode only',
      controls: { mode: 'manual' },
      present: [['--permission-mode', 'manual']],
      absent: [['--permission-mode', 'auto'], ['--model'], ['--effort']],
    },
    {
      name: 'an unknown id',
      controls: { verbosity: 'loud', effort: 'low' },
      present: [
        ['--effort', 'low'],
        ['--permission-mode', 'auto'],
      ],
      absent: [['--verbosity'], ['loud'], ['--model']],
    },
  ])(
    'claudeLaunch_Controls_BecomeLaunchFlags ($name)',
    ({ controls, present, absent }) => {
      const launch = claudeLaunch(
        {
          processId: 'p-1',
          sessionId: 's-1',
          resume: false,
          projectDir: '/proj',
          profileDir: null,
          controls,
          instructions: [],
          idleCompactMinTokens: null,
          rowId: 'row-1',
        },
        TOOL,
        {},
        '/h',
        posixPaths,
      );

      for (const flag of present) {
        expect(adjacentRuns(launch.args, flag.length)).toContainEqual(flag);
      }
      for (const flag of absent) {
        expect(adjacentRuns(launch.args, flag.length)).not.toContainEqual(flag);
      }
    },
  );

  it.each<{ name: string; instructions: string[]; expected: string }>([
    {
      name: 'one instruction',
      instructions: ['Use the wigley:visuals skill.'],
      expected: 'Use the wigley:visuals skill.',
    },
    {
      name: 'two instructions',
      instructions: ['First note.', 'Second note.\nIts second line.'],
      expected: 'First note.\n\nSecond note.\nIts second line.',
    },
  ])(
    'claudeLaunch_Instructions_JoinIntoOneAppendedPrompt ($name)',
    ({ instructions, expected }) => {
      const launch = claudeLaunch(
        {
          processId: 'p-1',
          sessionId: 's-1',
          resume: false,
          projectDir: '/proj',
          profileDir: null,
          controls: {},
          instructions,
          idleCompactMinTokens: null,
          rowId: 'row-1',
        },
        TOOL,
        {},
        '/h',
        posixPaths,
      );

      const flagIndex = launch.args.indexOf('--append-system-prompt');
      expect(
        launch.args.filter((arg) => arg === '--append-system-prompt'),
      ).toHaveLength(1);
      expect(launch.args.slice(flagIndex, flagIndex + 2)).toEqual([
        '--append-system-prompt',
        expected,
      ]);
    },
  );

  it('claudeLaunch_NestedSessionEnv_StripsListedNamesOnly', () => {
    const launch = claudeLaunch(
      {
        processId: 'p-1',
        sessionId: 's-1',
        resume: false,
        projectDir: '/proj',
        profileDir: '/p',
        controls: {},
        instructions: [],
        idleCompactMinTokens: null,
        rowId: 'row-1',
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
      WIGLEY_SESSION_ROW: 'row-1',
    });
  });

  it.each<{ name: string; minTokens: number | null; expected?: string }>([
    {
      name: 'a setting replaces the inherited value',
      minTokens: 150000,
      expected: '150000',
    },
    { name: 'no setting drops the inherited value', minTokens: null },
  ])(
    'claudeLaunch_IdleCompactMinTokens_ComesFromTheRequest ($name)',
    ({ minTokens, expected }) => {
      const launch = claudeLaunch(
        {
          processId: 'p-1',
          sessionId: 's-1',
          resume: false,
          projectDir: '/proj',
          profileDir: null,
          controls: {},
          instructions: [],
          idleCompactMinTokens: minTokens,
          rowId: 'row-1',
        },
        TOOL,
        { CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS: '300000' },
        '/h',
        posixPaths,
      );

      expect(launch.env.CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS).toBe(expected);
    },
  );

  it.each<{ name: string; env: NodeJS.ProcessEnv }>([
    { name: 'nothing inherited', env: {} },
    {
      name: 'the request replaces an inherited row',
      env: { WIGLEY_SESSION_ROW: 'parent-row' },
    },
  ])('claudeLaunch_RowId_SetsWigleySessionRow ($name)', ({ env }) => {
    const launch = claudeLaunch(
      {
        processId: 'p-1',
        sessionId: 's-1',
        resume: false,
        projectDir: '/proj',
        profileDir: null,
        controls: {},
        instructions: [],
        idleCompactMinTokens: null,
        rowId: 'row-7',
      },
      TOOL,
      env,
      '/h',
      posixPaths,
    );

    expect(launch.env.WIGLEY_SESSION_ROW).toBe('row-7');
  });

  it("expands a profile folder against the adapter's home", () => {
    const launch = claudeLaunch(
      {
        processId: 'p-1',
        sessionId: 's-1',
        resume: false,
        projectDir: '/proj',
        profileDir: '~/.claude-personal',
        controls: {},
        instructions: [],
        idleCompactMinTokens: null,
        rowId: 'row-1',
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
        processId: 'p-1',
        sessionId: 's-1',
        resume: false,
        projectDir: 'C:\\proj',
        profileDir: '~/.claude-work',
        controls: {},
        instructions: [],
        idleCompactMinTokens: null,
        rowId: 'row-1',
      },
      TOOL,
      {},
      'C:\\Users\\jo',
      windowsPaths,
    );

    expect(launch.env.CLAUDE_CONFIG_DIR).toBe('C:\\Users\\jo\\.claude-work');
  });
});

describe('claudeEnv', () => {
  it('claudeEnv_InheritedSessionRow_IsDropped', () => {
    const env = claudeEnv(
      { HOME: '/h', WIGLEY_SESSION_ROW: 'parent-row' },
      '/p',
      '/h',
      posixPaths,
    );

    expect(env).not.toHaveProperty('WIGLEY_SESSION_ROW');
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

// Every run of `length` consecutive args, so a flag is matched with its value.
function adjacentRuns(args: string[], length: number): string[][] {
  return args
    .slice(0, args.length - length + 1)
    .map((_, index) => args.slice(index, index + length));
}
