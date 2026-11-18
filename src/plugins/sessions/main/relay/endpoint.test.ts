import { describe, expect, it } from 'vitest';
import type { Files } from '../../../../contracts/files';
import { createMemoryFiles } from '../../../../shared/memory-files';
import { posixPaths } from '../../../../shared/paths/posix-paths';
import {
  type OfflineAnswer,
  type RelayEndpoint,
  textResult,
  type ToolDefinition,
} from '../../contract';
import { createEndpointWriter, endedDriveRunLaunch } from './endpoint';

async function readJson(files: Files, file: string): Promise<unknown> {
  return JSON.parse(await files.read(file));
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

describe('createEndpointWriter', () => {
  const endpoint: RelayEndpoint = {
    protocol: 1,
    channel: '/Users/jon/.agents/wigley-ai-gui/app.sock',
    launch: { command: ['/opt/electron'], cwd: '/work/app' },
    pid: 4242,
  };
  const moved: RelayEndpoint = {
    ...endpoint,
    launch: { command: ['/b'], cwd: '/c' },
  };
  const tools: ToolDefinition[] = [
    {
      name: 'ask_round',
      description: 'Ask a round.',
      inputSchema: { type: 'object' },
    },
  ];
  const offline: Record<string, OfflineAnswer> = {
    ask_round: { result: textResult('closed'), replay: false },
  };
  const dir = '/home/.agents/wigley-ai-gui';
  let logged: string[];

  function writerOver(files: Files) {
    logged = [];
    return createEndpointWriter(files, posixPaths, dir, (line) =>
      logged.push(line),
    );
  }

  it('writes the endpoint and the tool list into a folder it creates', async () => {
    const files = createMemoryFiles();
    const writer = writerOver(files);

    writer.write(endpoint, tools, offline);
    await writer.flushed();

    expect(await readJson(files, `${dir}/endpoint.json`)).toEqual(endpoint);
    expect(await readJson(files, `${dir}/tools.json`)).toEqual({ tools });
    expect(await readJson(files, `${dir}/offline.json`)).toEqual({
      tools: offline,
    });
  });

  it('replaces the files of an earlier start and leaves no temp file', async () => {
    const files = createMemoryFiles();
    const writer = writerOver(files);
    writer.write(endpoint, tools, offline);

    writer.write(moved, [], {});
    await writer.flushed();

    expect(await readJson(files, `${dir}/endpoint.json`)).toEqual(moved);
    expect(await readJson(files, `${dir}/tools.json`)).toEqual({ tools: [] });
    expect(await readJson(files, `${dir}/offline.json`)).toEqual({ tools: {} });
    expect((await files.list(dir)).map((entry) => entry.path).sort()).toEqual([
      'endpoint.json',
      'offline.json',
      'tools.json',
    ]);
  });

  // Breaks if writes run in parallel.
  it('writes in call order behind a held write', async () => {
    const files = createMemoryFiles();
    const held = Promise.withResolvers<void>();
    let calls = 0;
    const writer = writerOver({
      ...files,
      write: async (file, text) => {
        calls += 1;
        if (calls === 1) {
          await held.promise;
        }
        await files.write(file, text);
      },
    });

    writer.write(endpoint, tools, {});
    writer.write(moved, tools, offline);
    held.resolve();
    await writer.flushed();

    expect(await readJson(files, `${dir}/endpoint.json`)).toEqual(moved);
    expect(await readJson(files, `${dir}/offline.json`)).toEqual({
      tools: offline,
    });
  });

  it('logs a failed write and still runs the next', async () => {
    const files = createMemoryFiles();
    let calls = 0;
    const writer = writerOver({
      ...files,
      write: (file, text) => {
        calls += 1;
        return calls === 1
          ? Promise.reject(new Error('EACCES'))
          : files.write(file, text);
      },
    });

    writer.write(endpoint, tools, {});
    writer.write(moved, [], {});
    await writer.flushed();

    expect(logged).toEqual([
      expect.stringContaining('endpoint files not written'),
    ]);
    expect(await readJson(files, `${dir}/endpoint.json`)).toEqual(moved);
    expect(await readJson(files, `${dir}/tools.json`)).toEqual({ tools: [] });
  });
});
