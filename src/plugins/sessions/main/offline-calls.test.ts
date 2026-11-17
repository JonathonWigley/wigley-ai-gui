import { describe, expect, it } from 'vitest';
import type { Files } from '../../../contracts/files';
import { createMemoryFiles } from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import { type OfflineCall, replayOfflineCalls } from './offline-calls';

const FOLDER = '/home/.agents/app/offline-calls';
const ID = 'host-1';
const CALLS_FILE = `${FOLDER}/${ID}.jsonl`;
const CLAIMED_FILE = `${CALLS_FILE}.replaying`;

// One calls-file line as the relay writes it, `fields` laid over the defaults.
function line(tool: string, fields: Record<string, unknown> = {}): string {
  return JSON.stringify({
    tool,
    arguments: { step: tool },
    toolUseId: `toolu_${tool}`,
    at: 1000,
    replay: true,
    ...fields,
  });
}

// Replays `ID`'s calls from `files`, recording each routed call and log line;
// `route` answers each call, resolving by default.
async function replay(
  files: Files,
  route: (call: OfflineCall) => Promise<unknown> = async () => undefined,
  hostSessionId = ID,
) {
  const routed: OfflineCall[] = [];
  const logs: string[] = [];
  const count = await replayOfflineCalls(
    {
      files,
      paths: posixPaths,
      folder: FOLDER,
      route: (call) => {
        routed.push(call);
        return route(call);
      },
      log: (message) => logs.push(message),
    },
    hostSessionId,
  );
  return { count, routed, logs };
}

async function filesWith(text: string): Promise<Files> {
  const files = createMemoryFiles();
  await files.write(CALLS_FILE, text);
  return files;
}

describe('replayOfflineCalls', () => {
  it.each<{
    case: string;
    lines: string[];
    routed: string[];
    count: number;
    logs: string[];
  }>([
    {
      case: 'replay and non-replay lines mixed',
      lines: [
        line('a'),
        line('b', { replay: false }),
        line('c'),
        line('d', { replay: false }),
      ],
      routed: ['a', 'c'],
      count: 2,
      logs: [],
    },
    {
      case: 'a line that is not JSON',
      lines: [line('a'), '{not json', line('c')],
      routed: ['a', 'c'],
      count: 2,
      logs: [`offline call line 2 of ${ID} not read`],
    },
    {
      case: 'a line missing replay',
      lines: [line('a', { replay: undefined }), line('b')],
      routed: ['b'],
      count: 1,
      logs: [`offline call line 1 of ${ID} not read`],
    },
    {
      case: 'an empty trailing line',
      lines: [line('a'), ''],
      routed: ['a'],
      count: 1,
      logs: [],
    },
  ])(
    'routes each replayable line in order and deletes the file: $case',
    async ({ lines, routed, count, logs }) => {
      const files = await filesWith(lines.join('\n'));

      const result = await replay(files);

      expect(result.routed.map((call) => call.tool)).toEqual(routed);
      expect(result.count).toBe(count);
      expect(result.logs).toEqual(
        logs.map((text) => expect.stringContaining(text)),
      );
      expect(await files.stat(CALLS_FILE)).toBeNull();
      expect(await files.stat(CLAIMED_FILE)).toBeNull();
    },
  );

  it('routes a line with no arguments with {} and its other fields as written', async () => {
    const files = await filesWith(
      `${line('a', { arguments: undefined, toolUseId: null, at: 7 })}\n`,
    );

    const { routed } = await replay(files);

    expect(routed).toEqual([
      { tool: 'a', arguments: {}, toolUseId: null, at: 7, replay: true },
    ]);
  });

  it('resolves to 0 and routes nothing when the session has no calls file', async () => {
    const result = await replay(createMemoryFiles());

    expect(result).toEqual({ count: 0, routed: [], logs: [] });
  });

  // Breaks on a read-then-delete of one path, which drops the late line.
  it('a line appended during the replay survives in a new calls file', async () => {
    const files = await filesWith(`${line('a')}\n${line('b')}\n`);
    const late = `${line('late')}\n`;
    let isFirst = true;

    await replay(files, async () => {
      if (isFirst) {
        isFirst = false;
        await files.append(CALLS_FILE, late);
      }
    });

    expect(await files.read(CALLS_FILE)).toBe(late);
    expect(await files.stat(CLAIMED_FILE)).toBeNull();
  });

  it('logs a route that rejects and still routes the next line', async () => {
    const files = await filesWith(`${line('a')}\n${line('b')}\n`);

    const result = await replay(files, async (call) => {
      if (call.tool === 'a') {
        throw new Error('no session');
      }
    });

    expect(result.routed.map((call) => call.tool)).toEqual(['a', 'b']);
    expect(result.count).toBe(2);
    expect(result.logs).toEqual([
      expect.stringContaining(`offline call a of ${ID} not replayed`),
    ]);
  });

  it('replaces a claimed file an earlier replay left, never reading it', async () => {
    const files = await filesWith(`${line('a')}\n`);
    await files.write(CLAIMED_FILE, `${line('stale')}\n`);

    const { routed } = await replay(files);

    expect(routed.map((call) => call.tool)).toEqual(['a']);
    expect(await files.stat(CLAIMED_FILE)).toBeNull();
  });

  it.each(['', '.', '..', 'a/b', 'a\\b'])(
    'rejects a host session id that is not one path segment, reading nothing: %j',
    async (hostSessionId) => {
      const files = createMemoryFiles();
      const outside = `${FOLDER}/../x.jsonl`;
      await files.write(outside, `${line('a')}\n`);

      await expect(
        replay(files, async () => undefined, hostSessionId),
      ).rejects.toThrow(`Not a host session id: ${hostSessionId}`);
      expect(await files.read(outside)).toBe(`${line('a')}\n`);
    },
  );
});
