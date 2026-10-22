import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
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

describe('channelPath', () => {
  it('names the Windows pipe by user and home', () => {
    expect(channelPath('win32', 'C:\\Users\\u', 'u')).toBe(
      `\\\\.\\pipe\\wigley-ai-gui-u-${first8HexOfSha256('C:\\Users\\u')}`,
    );
  });

  it('names a different Windows pipe for a different home', () => {
    expect(channelPath('win32', 'C:\\Users\\u', 'u')).not.toBe(
      channelPath('win32', 'D:\\drive\\home', 'u'),
    );
  });

  it('puts the socket in the agents folder on macOS', () => {
    expect(channelPath('darwin', '/Users/u', 'u')).toBe(
      '/Users/u/.agents/wigley-ai-gui/app.sock',
    );
  });

  it('falls back to a per-home socket in /tmp past 103 bytes on macOS', () => {
    // 82 bytes of home and 31 of `/.agents/wigley-ai-gui/app.sock`: 113.
    const home = `/Users/u/${'d'.repeat(73)}`;

    expect(channelPath('darwin', home, 'u')).toBe(
      `/tmp/wigley-ai-gui-u-${first8HexOfSha256(home)}.sock`,
    );
  });
});

describe('launchCommand', () => {
  it('runs npm start from the folder npm started in', () => {
    const env = {
      npm_node_execpath: '/opt/node/bin/node',
      npm_execpath: '/opt/node/lib/npm-cli.js',
      INIT_CWD: '/work/wigley-ai-gui',
    };

    expect(launchCommand(env, '/opt/electron', '/elsewhere')).toEqual({
      command: ['/opt/node/bin/node', '/opt/node/lib/npm-cli.js', 'start'],
      cwd: '/work/wigley-ai-gui',
    });
  });

  it('falls back to the given folder when npm names none', () => {
    const env = {
      npm_node_execpath: '/opt/node/bin/node',
      npm_execpath: '/opt/node/lib/npm-cli.js',
    };

    expect(launchCommand(env, '/opt/electron', '/work/app').cwd).toBe(
      '/work/app',
    );
  });

  it('runs the executable itself outside npm', () => {
    expect(launchCommand({}, '/opt/electron', '/work/app')).toEqual({
      command: ['/opt/electron'],
      cwd: '/work/app',
    });
  });
});

describe('endedDriveRunLaunch', () => {
  it('exits 1 from the run folder root, naming the run, on macOS and Linux', () => {
    expect(endedDriveRunLaunch('darwin', '/work/app/.drive/r1')).toEqual({
      command: [
        '/bin/sh',
        '-c',
        'echo "$0" >&2; exit 1',
        'The drive run /work/app/.drive/r1 has ended',
      ],
      cwd: '/',
    });
  });

  it('exits 1 from the run folder drive root, naming the run, on Windows', () => {
    expect(endedDriveRunLaunch('win32', 'C:\\work\\.drive\\r1')).toEqual({
      command: [
        'cmd.exe',
        '/d',
        '/c',
        'exit 1 & rem The drive run C:\\work\\.drive\\r1 has ended',
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
