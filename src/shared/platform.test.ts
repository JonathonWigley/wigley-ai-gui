import { describe, expect, it } from 'vitest';
import { launchCommand, platformFor, type PlatformInputs } from './platform';

const INPUTS: PlatformInputs = {
  username: 'tester',
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
    'platformFor_Inputs_LaunchIsLaunchCommand: %s',
    (os) => {
      const { relay } = platformFor(os, INPUTS);

      expect(relay.launch).toEqual(
        launchCommand(INPUTS.env, INPUTS.execPath, INPUTS.cwd, INPUTS.isDev),
      );
      expect(relay.username).toBe('tester');
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
