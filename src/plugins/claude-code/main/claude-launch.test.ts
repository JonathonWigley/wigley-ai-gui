import { describe, expect, it } from 'vitest';
import {
  AGENT_PLUGIN_NAME,
  AGENT_SERVER_NAME,
  claudePluginToolName,
} from '../../../shared/agent-plugin';
import { posixPaths } from '../../../shared/paths/posix-paths';
import { windowsPaths } from '../../../shared/paths/windows-paths';
import { NESTED_SESSION_ENV } from '../../../shared/session-env';
import {
  CLAUDE_DROPPED_OUT_KEYS,
  CLAUDE_IDLE_RULE,
  claudeConfigFolder,
  claudeEnv,
  claudeLaunch,
  claudeSpawn,
} from './claude-launch';

const TOOL = claudePluginToolName(
  AGENT_PLUGIN_NAME,
  AGENT_SERVER_NAME,
  'permission_prompt',
);

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
      { HOME: '/h', CLAUDE_CONFIG_DIR: '/x' },
      '/h',
      posixPaths,
      '/app/agent-plugin',
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
      '--plugin-dir',
      '/app/agent-plugin',
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
      env,
      '/h',
      posixPaths,
      '/app/agent-plugin',
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
        {},
        '/h',
        posixPaths,
        '/app/agent-plugin',
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
        {},
        '/h',
        posixPaths,
        '/app/agent-plugin',
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
      {
        HOME: '/h',
        CLAUDECODE: '1',
        CLAUDE_CODE_SESSION_ID: 'parent-session',
        CLAUDE_CODE_USE_BEDROCK: '1',
      },
      '/h',
      posixPaths,
      '/app/agent-plugin',
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
        { CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS: '300000' },
        '/h',
        posixPaths,
        '/app/agent-plugin',
      );

      expect(launch.env.CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS).toBe(expected);
    },
  );

  it.each<{ name: string; env: Record<string, string> }>([
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
      env,
      '/h',
      posixPaths,
      '/app/agent-plugin',
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
      { HOME: '/elsewhere' },
      '/Users/u',
      posixPaths,
      '/app/agent-plugin',
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
      {},
      'C:\\Users\\jo',
      windowsPaths,
      '/app/agent-plugin',
    );

    expect(launch.env.CLAUDE_CONFIG_DIR).toBe('C:\\Users\\jo\\.claude-work');
  });

  it.each([
    { label: 'no profile', profileDir: null, unsetsConfigDir: false },
    {
      label: 'the default folder',
      profileDir: '~/.claude',
      unsetsConfigDir: true,
    },
    { label: 'another folder', profileDir: '/p', unsetsConfigDir: false },
  ])(
    'claudeLaunch_UnsetEnv_NamesWhatClaudeEnvRemoves: $label',
    ({ profileDir, unsetsConfigDir }) => {
      const appNames = [
        'CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS',
        'WIGLEY_SESSION_ROW',
      ];
      const everyName = [
        ...NESTED_SESSION_ENV,
        ...appNames,
        'CLAUDE_CONFIG_DIR',
      ];
      const inherited = Object.fromEntries(
        everyName.map((name) => [name, 'inherited']),
      );

      const launch = claudeLaunch(
        {
          processId: 'p-1',
          sessionId: 's-1',
          resume: false,
          projectDir: '/proj',
          profileDir,
          controls: {},
          instructions: [],
          idleCompactMinTokens: 5000,
          rowId: 'row-1',
        },
        inherited,
        '/h',
        posixPaths,
        '/app/agent-plugin',
      );
      const cleaned = claudeEnv(inherited, profileDir, '/h', posixPaths);

      expect(launch.unsetEnv).toEqual([
        ...NESTED_SESSION_ENV,
        ...appNames,
        ...(unsetsConfigDir ? ['CLAUDE_CONFIG_DIR'] : []),
      ]);
      expect(launch.unsetEnv.filter((name) => name in cleaned)).toEqual([]);
      expect(launch.unsetEnv.filter((name) => name in launch.env)).toEqual(
        appNames,
      );
      expect(launch.env.WIGLEY_SESSION_ROW).toBe('row-1');
      expect(launch.env.CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS).toBe('5000');
    },
  );
});

describe('claudeSpawn', () => {
  it('claudeSpawn_Request_IsTheLaunchUnderTheProcessId', () => {
    const request = {
      processId: 'p-3',
      sessionId: 's-1',
      resume: false,
      projectDir: '/proj',
      profileDir: '~/.claude',
      controls: { mode: 'plan' },
      instructions: [],
      idleCompactMinTokens: null,
      rowId: 'row-1',
    };
    const env = { HOME: '/h', CLAUDECODE: '1' };

    const spawn = claudeSpawn({
      request,
      program: { command: '/bin/claude', args: ['--lead'] },
      env,
      homeDir: '/h',
      paths: posixPaths,
      pluginDir: '/app/agent-plugin',
      stdin: ['line-1'],
      inheritEnv: true,
    });

    const launch = claudeLaunch(
      request,
      env,
      '/h',
      posixPaths,
      '/app/agent-plugin',
    );
    expect(spawn.id).toBe('p-3');
    expect(spawn.command).toBe('/bin/claude');
    expect(spawn.args).toEqual(['--lead', ...launch.args]);
    expect(spawn.args).toContain('/app/agent-plugin');
    expect(spawn.cwd).toBe(launch.cwd);
    expect(spawn.unsetEnv).toEqual(launch.unsetEnv);
    expect(spawn.stdin).toEqual(['line-1']);
    expect(spawn.inheritEnv).toBe(true);
    expect(spawn.env).toEqual({ HOME: '/h', WIGLEY_SESSION_ROW: 'row-1' });
    expect(spawn.idleRule).toBe(CLAUDE_IDLE_RULE);
    expect(spawn.droppedOutKeys).toBe(CLAUDE_DROPPED_OUT_KEYS);
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
