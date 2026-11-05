import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RelayEndpoint, ToolDefinition } from '../../contract';
import { endedDriveRunLaunch, writeEndpointFiles } from './endpoint';

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

describe('endedDriveRunLaunch', () => {
  it('exits 1 from the home filesystem root, naming the home, on macOS and Linux', () => {
    expect(endedDriveRunLaunch('macos', '/work/app/.drive/r1/home')).toEqual({
      command: [
        '/bin/sh',
        '-c',
        'echo "$0" >&2; exit 1',
        expect.stringContaining('/work/app/.drive/r1/home'),
      ],
      cwd: '/',
    });
  });

  it('exits 1 from the home drive root, naming the home, on Windows', () => {
    expect(
      endedDriveRunLaunch('windows', 'C:\\work\\.drive\\r1\\home'),
    ).toEqual({
      command: [
        'cmd.exe',
        '/d',
        '/c',
        expect.stringMatching(/^exit 1 & rem .*C:\\work\\\.drive\\r1\\home/),
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
