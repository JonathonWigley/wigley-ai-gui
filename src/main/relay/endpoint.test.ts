import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ToolDefinition } from '../../contracts/forms';
import type { RelayEndpoint } from '../../contracts/relay';
import { channelPath, launchCommand, writeEndpointFiles } from './endpoint';

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

describe('channelPath', () => {
  it('names a per-user named pipe on Windows', () => {
    expect(channelPath('win32', 'C:\\Users\\jon', 'jon')).toBe(
      '\\\\.\\pipe\\wigley-ai-gui-jon',
    );
  });

  it('puts the socket in the agents folder on macOS', () => {
    expect(channelPath('darwin', '/Users/jon', 'jon')).toBe(
      '/Users/jon/.agents/wigley-ai-gui/app.sock',
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
