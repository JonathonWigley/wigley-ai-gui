import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { channelPath } from './channel-path';
import { jsonLine, readFirstLine, readLines } from './line-framing';
import { connectToChannel, listenOnChannel } from './local-channel';

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

const E_ACUTE = Buffer.from('é');

describe('readLines', () => {
  it.each([
    {
      name: 'one chunk with two lines',
      chunks: ['one\ntwo\n'],
      options: undefined,
      expected: ['one', 'two'],
    },
    {
      name: 'a line split across two chunks',
      chunks: ['{"a":1}\n{"b"', ':2}\n'],
      options: undefined,
      expected: ['{"a":1}', '{"b":2}'],
    },
    {
      name: 'a character split between its two bytes',
      chunks: [
        E_ACUTE.subarray(0, 1),
        Buffer.concat([E_ACUTE.subarray(1), Buffer.from('\n')]),
      ],
      options: undefined,
      expected: ['é'],
    },
    {
      name: 'a trailing partial line at end',
      chunks: ['a\nb'],
      options: undefined,
      expected: ['a'],
    },
    {
      name: 'a trailing partial line at end, flushed',
      chunks: ['a\nb'],
      options: { flushPartialAtEnd: true },
      expected: ['a', 'b'],
    },
    {
      name: 'no partial line at end, flushed',
      chunks: ['a\n'],
      options: { flushPartialAtEnd: true },
      expected: ['a'],
    },
  ])(
    'readLines_ChunkCases_DeliversWholeLines: $name',
    async ({ chunks, options, expected }) => {
      const stream = new PassThrough();
      const lines: string[] = [];
      readLines(stream, (line) => lines.push(line), options);

      for (const chunk of chunks) {
        stream.write(chunk);
      }
      stream.end();
      await once(stream, 'end');

      expect(lines).toEqual(expected);
    },
  );
});

describe('readFirstLine', () => {
  it('readFirstLine_BytesAfterTheNewline_StayOnTheStream', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'lf-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const channel = channelPath(
      process.platform,
      dir,
      'selftest',
      'wigley-ai-gui',
      '',
      dir,
    );
    const firstLine = new Promise<{ socket: Socket; line: string }>(
      (resolve) => {
        const server = listenOnChannel(channel, {
          connected: (socket) =>
            readFirstLine(socket, (line) => resolve({ socket, line })),
          failed: () => {},
        });
        cleanups.push(() => server.close());
      },
    );
    const client = await connectToChannel(channel);
    cleanups.push(() => {
      client.destroy();
    });
    client.write('first\nrest');

    const { socket, line } = await firstLine;

    expect(line).toBe('first');
    expect(socket.isPaused()).toBe(true);
    let rest = '';
    socket.on('data', (chunk) => {
      rest += chunk.toString();
    });
    socket.resume();
    await vi.waitFor(() => expect(rest).toBe('rest'));
  });
});

describe('jsonLine', () => {
  it('jsonLine_Object_IsOneLineWithNewline', () => {
    expect(jsonLine({ a: 1 })).toBe('{"a":1}\n');
  });
});
