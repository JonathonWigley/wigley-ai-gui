import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RelayEndpoint, ToolDefinition } from '../../contract';
import {
  channelPath,
  endedDriveRunLaunch,
  launchCommand,
  writeEndpointFiles,
} from './endpoint';

const folders: string[] = [];

afterEach(() => {
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true });
  }
});

function tempFolder(): string {
  const folder = mkdtempSync(path.join(tmpdir(), 'wigley-endpoint-'));
  folders.push(folder);
  return folder;
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function first8HexOfSha256(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 8);
}

const STABLE = 'wigley-ai-gui';
const DEV = 'wigley-ai-gui-dev';

describe('channelPath', () => {
  it('names the Windows pipe by instance, user and home', () => {
    expect(channelPath('win32', 'C:\\Users\\u', 'u', STABLE)).toBe(
      `\\\\.\\pipe\\wigley-ai-gui-u-${first8HexOfSha256('C:\\Users\\u')}`,
    );
  });

  it('names the Windows pipe after the dev instance', () => {
    expect(channelPath('win32', 'C:\\Users\\u', 'u', DEV)).toBe(
      `\\\\.\\pipe\\wigley-ai-gui-dev-u-${first8HexOfSha256('C:\\Users\\u')}`,
    );
  });

  it('names a different Windows pipe for a different home', () => {
    expect(channelPath('win32', 'C:\\Users\\u', 'u', STABLE)).not.toBe(
      channelPath('win32', 'D:\\drive\\home', 'u', STABLE),
    );
  });

  it('puts the socket in the instance folder of the agents folder on macOS', () => {
    expect(channelPath('darwin', '/Users/u', 'u', STABLE)).toBe(
      '/Users/u/.agents/wigley-ai-gui/app.sock',
    );
  });

  it.each(['win32', 'darwin'] as const)(
    'never gives the stable and dev instances one channel on %s',
    (platform) => {
      expect(channelPath(platform, '/Users/u', 'u', STABLE)).not.toBe(
        channelPath(platform, '/Users/u', 'u', DEV),
      );
    },
  );

  // 82 bytes of home and 31 of `/.agents/wigley-ai-gui/app.sock`: 113.
  const longHome = `/Users/u/${'d'.repeat(73)}`;
  // `wigley-ai-gui-u-<8 hex>.sock` is 29 bytes, 30 with its `/`.
  const socketName = `wigley-ai-gui-u-${first8HexOfSha256(longHome)}.sock`;

  it('falls back to a per-home socket in the temp folder when it fits in 103 bytes', () => {
    const tempDir = `/T${'t'.repeat(103 - 30 - 2)}`;

    expect(channelPath('darwin', longHome, 'u', STABLE, tempDir)).toBe(
      `${tempDir}/${socketName}`,
    );
    expect(Buffer.byteLength(`${tempDir}/${socketName}`)).toBe(103);
  });

  // Windows has no /tmp, no process.getuid and no POSIX mode bits.
  it.skipIf(process.platform === 'win32')(
    'falls back to a folder of /tmp only the user can enter when the temp folder socket would be 104 bytes',
    () => {
      const username = `wigley-endpoint-test-${process.pid}`;
      const privateDir = `/tmp/wigley-ai-gui-${username}`;
      folders.push(privateDir);
      const tempDir = `/T${'t'.repeat(104 - 30 - 2)}`;

      const channel = channelPath(
        'darwin',
        longHome,
        username,
        STABLE,
        tempDir,
      );

      expect(channel).toBe(`${privateDir}/${first8HexOfSha256(longHome)}.sock`);
      expect(statSync(privateDir).mode & 0o777).toBe(0o700);
    },
  );

  // Windows has no /tmp, no process.getuid and no POSIX mode bits.
  it.skipIf(process.platform === 'win32')(
    'throws when the /tmp folder exists open to others',
    () => {
      const username = `wigley-endpoint-open-${process.pid}`;
      const privateDir = `/tmp/wigley-ai-gui-${username}`;
      folders.push(privateDir);
      mkdirSync(privateDir, { mode: 0o755 });
      const tempDir = `/T${'t'.repeat(104 - 30 - 2)}`;

      expect(() =>
        channelPath('darwin', longHome, username, STABLE, tempDir),
      ).toThrow(privateDir);
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

describe('endedDriveRunLaunch', () => {
  it('exits 1 from the home filesystem root, naming the home, on macOS and Linux', () => {
    expect(endedDriveRunLaunch('darwin', '/work/app/.drive/r1/home')).toEqual({
      command: [
        '/bin/sh',
        '-c',
        'echo "$0" >&2; exit 1',
        'The drive run whose home is /work/app/.drive/r1/home has ended',
      ],
      cwd: '/',
    });
  });

  it('exits 1 from the home drive root, naming the home, on Windows', () => {
    expect(endedDriveRunLaunch('win32', 'C:\\work\\.drive\\r1\\home')).toEqual({
      command: [
        'cmd.exe',
        '/d',
        '/c',
        'exit 1 & rem The drive run whose home is C:\\work\\.drive\\r1\\home has ended',
      ],
      cwd: 'C:\\',
    });
  });
});

describe('writeEndpointFiles', () => {
  const endpoint: RelayEndpoint = {
    protocol: 1,
    channel: '/Users/jon/.agents/wigley-ai-gui/app.sock',
    launch: { command: ['/opt/electron'], cwd: '/work/app' },
  };
  const tools: ToolDefinition[] = [
    {
      name: 'ask_round',
      description: 'Ask a round.',
      inputSchema: { type: 'object' },
    },
  ];

  it('writes the endpoint and the tool list into a folder it creates', () => {
    const dir = path.join(tempFolder(), 'wigley-ai-gui');

    writeEndpointFiles(dir, endpoint, tools);

    expect(readJson(path.join(dir, 'endpoint.json'))).toEqual(endpoint);
    expect(readJson(path.join(dir, 'tools.json'))).toEqual({ tools });
  });

  it('replaces the files of an earlier start and leaves no temp file', () => {
    const dir = tempFolder();
    writeEndpointFiles(dir, endpoint, tools);
    const moved = { ...endpoint, launch: { command: ['/b'], cwd: '/c' } };

    writeEndpointFiles(dir, moved, []);

    expect(readJson(path.join(dir, 'endpoint.json'))).toEqual(moved);
    expect(readJson(path.join(dir, 'tools.json'))).toEqual({ tools: [] });
    expect(readdirSync(dir).sort()).toEqual(['endpoint.json', 'tools.json']);
  });
});
