import { describe, expect, it } from 'vitest';
import { launchCommand, platformFor, type PlatformInputs } from './platform';

const INPUTS: PlatformInputs = {
  username: 'tester',
  pid: 4242,
  env: {
    npm_node_execpath: '/opt/node/bin/node',
    npm_execpath: '/opt/node/lib/npm-cli.js',
    INIT_CWD: '/work/wigley-ai-gui',
  },
  execPath: '/app/exe',
  cwd: '/app',
  isDev: true,
};

describe('platformFor', () => {
  it.each(['macos', 'windows', 'linux'] as const)(
    'platformFor_Inputs_RelayCarriesLaunchAndPid: %s',
    (os) => {
      const { relay } = platformFor(os, INPUTS);

      expect(relay.launch).toEqual(
        launchCommand(INPUTS.env, INPUTS.execPath, INPUTS.cwd, INPUTS.isDev),
      );
      expect(relay.username).toBe('tester');
      expect(relay.pid).toBe(4242);
      expect(relay.serverName).toBe('auri');
    },
  );

  it.each([
    { os: 'macos', keys: { optionMatchesByCode: true, altGraphTypes: false } },
    {
      os: 'windows',
      keys: { optionMatchesByCode: false, altGraphTypes: true },
    },
    { os: 'linux', keys: { optionMatchesByCode: false, altGraphTypes: true } },
  ] as const)('gives $os its chord matching flags', ({ os, keys }) => {
    expect(platformFor(os, INPUTS).keys).toEqual(keys);
  });

  const posixPrograms = {
    python: [
      { command: 'python3', args: [] },
      { command: 'python', args: [] },
    ],
    claude: [
      { command: 'claude', args: [] },
      { command: '~/.local/bin/claude', args: [] },
    ],
    unity: [
      { command: 'unity', args: [] },
      { command: '~/.unity/bin/unity', args: [] },
    ],
    shell: [{ command: '/bin/zsh', args: ['-l'] }],
  };

  // The order decides which Python runs.
  it.each([
    { os: 'macos', programs: posixPrograms },
    {
      os: 'windows',
      programs: {
        python: [
          { command: 'py', args: ['-3'] },
          { command: 'python', args: [] },
          { command: 'python3', args: [] },
        ],
        claude: [
          { command: 'claude.exe', args: [] },
          { command: '~/.local/bin/claude.exe', args: [] },
        ],
        unity: [
          { command: 'unity', args: [] },
          { command: '~/.unity/bin/unity', args: [] },
        ],
        shell: [
          { command: 'pwsh', args: ['-NoLogo'] },
          { command: 'powershell.exe', args: ['-NoLogo'] },
        ],
      },
    },
    { os: 'linux', programs: posixPrograms },
  ] as const)(
    'gives $os its program candidates in lookup order',
    ({ os, programs }) => {
      expect(platformFor(os, INPUTS).programs).toEqual(programs);
    },
  );

  const SHELL_ROWS = [
    {
      shell: '/opt/homebrew/bin/fish',
      candidates: [
        { command: '/opt/homebrew/bin/fish', args: ['-l'] },
        { command: '/bin/zsh', args: ['-l'] },
      ],
    },
    { shell: '/bin/zsh', candidates: [{ command: '/bin/zsh', args: ['-l'] }] },
    { shell: '', candidates: [{ command: '/bin/zsh', args: ['-l'] }] },
  ];

  it.each(
    (['macos', 'linux'] as const).flatMap((os) =>
      SHELL_ROWS.map((row) => ({ os, ...row })),
    ),
  )(
    'gives $os a shell from SHELL, then /bin/zsh: SHELL $shell',
    ({ os, shell, candidates }) => {
      const inputs = { ...INPUTS, env: { ...INPUTS.env, SHELL: shell } };

      expect(platformFor(os, inputs).programs.shell).toEqual(candidates);
    },
  );
});

describe('launchCommand', () => {
  const npmEnv = {
    npm_node_execpath: '/opt/node/bin/node',
    npm_execpath: '/opt/node/lib/npm-cli.js',
    INIT_CWD: '/work/wigley-ai-gui',
  };

  it('runs npm start from the folder npm started in for the dev app', () => {
    expect(launchCommand(npmEnv, '/opt/electron', '/elsewhere', true)).toEqual({
      command: ['/opt/node/bin/node', '/opt/node/lib/npm-cli.js', 'start'],
      cwd: '/work/wigley-ai-gui',
    });
  });

  it('runs the executable itself for a stable app npm started', () => {
    expect(launchCommand(npmEnv, '/opt/electron', '/work/app', false)).toEqual({
      command: ['/opt/electron'],
      cwd: '/work/app',
    });
  });

  it('falls back to the given folder when npm names none', () => {
    const env = {
      npm_node_execpath: '/opt/node/bin/node',
      npm_execpath: '/opt/node/lib/npm-cli.js',
    };

    expect(launchCommand(env, '/opt/electron', '/work/app', true).cwd).toBe(
      '/work/app',
    );
  });

  it('runs the executable itself outside npm', () => {
    expect(launchCommand({}, '/opt/electron', '/work/app', true)).toEqual({
      command: ['/opt/electron'],
      cwd: '/work/app',
    });
  });
});
