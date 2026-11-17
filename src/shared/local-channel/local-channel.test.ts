import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { osPlatform } from '../os-platform';
import { channelPath } from './channel-path';
import {
  type ChannelHandlers,
  connectToChannel,
  listenOnChannel,
} from './local-channel';

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

// macOS caps a socket path near 104 bytes, so the folder name stays short.
function tempChannel(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'lc-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return channelPath(
    osPlatform(process.platform),
    dir,
    'selftest',
    'wigley-ai-gui',
    '',
    dir,
  );
}

const channelIsPipe = tempChannel().startsWith('\\\\.\\pipe\\');

// A socket file with no listener, as a crashed run leaves: a server unlinks its
// file on close, so the file sits under another name while it closes.
async function leaveStaleSocket(channel: string) {
  mkdirSync(path.dirname(channel), { recursive: true });
  const server = createServer();
  server.listen(channel);
  await once(server, 'listening');
  const kept = `${channel}.kept`;
  renameSync(channel, kept);
  await new Promise((resolve) => server.close(resolve));
  renameSync(kept, channel);
}

function lockText(channel: string): string | null {
  const lock = `${channel}.lock`;
  return existsSync(lock) ? readFileSync(lock, 'utf8') : null;
}

function writeLock(channel: string, text: string) {
  mkdirSync(path.dirname(channel), { recursive: true });
  writeFileSync(`${channel}.lock`, text);
}

// A child that has exited and been reaped, so its pid no longer runs.
function deadPid(): number {
  return spawnSync(process.execPath, ['-e', '']).pid;
}

function listen(channel: string, handlers: Partial<ChannelHandlers> = {}) {
  const server = listenOnChannel(channel, {
    connected: () => {},
    failed: () => {},
    ...handlers,
  });
  cleanups.push(() => server.close());
  return server;
}

async function connectClient(channel: string): Promise<Socket> {
  const client = await connectToChannel(channel);
  cleanups.push(() => {
    client.destroy();
  });
  return client;
}

describe('listenOnChannel', () => {
  it.skipIf(channelIsPipe)(
    'listenOnChannel_StaleSocketFile_ListensAndAcceptsAConnection',
    async () => {
      const channel = tempChannel();
      await leaveStaleSocket(channel);
      const connected = vi.fn();

      const server = listen(channel, { connected });

      expect(await server.listening).toBe(true);
      await connectClient(channel);
      await vi.waitFor(() => expect(connected).toHaveBeenCalledOnce());
    },
  );

  it('listenOnChannel_LiveListener_FailsWithoutTakingTheChannel', async () => {
    const channel = tempChannel();
    const reachedFirst: string[] = [];
    const first = listen(channel, {
      connected: (socket) =>
        socket.on('data', (chunk) => reachedFirst.push(chunk.toString())),
    });
    await first.listening;
    const failed = vi.fn<(error: Error) => void>();

    const second = listen(channel, { failed });

    expect(await second.listening).toBe(false);
    expect(failed).toHaveBeenCalledOnce();
    expect(failed.mock.calls[0][0]).toMatchObject({ code: 'EADDRINUSE' });
    const client = await connectClient(channel);
    client.write('reached');
    await vi.waitFor(() => expect(reachedFirst).toEqual(['reached']));
  });

  it.skipIf(channelIsPipe).each([
    { label: 'no socket file', prepare: async (_channel: string) => {} },
    { label: 'a stale socket file', prepare: leaveStaleSocket },
    {
      label: 'a stale lock',
      prepare: async (channel: string) => writeLock(channel, `${deadPid()}`),
    },
  ])(
    'listenOnChannel_TwoInOneTick_OneListensAndTheOtherFailsInUse: $label',
    async ({ prepare }) => {
      const channel = tempChannel();
      await prepare(channel);
      const failed = [
        vi.fn<(error: Error) => void>(),
        vi.fn<(error: Error) => void>(),
      ];

      const servers = failed.map((onFailed) =>
        listen(channel, { failed: onFailed }),
      );
      const listening = await Promise.all(
        servers.map((server) => server.listening),
      );

      expect(listening.filter(Boolean)).toHaveLength(1);
      const loser = failed[listening.indexOf(false)];
      expect(loser).toHaveBeenCalledOnce();
      expect(loser.mock.calls[0][0]).toMatchObject({ code: 'EADDRINUSE' });
      expect(lockText(channel)).toBe(`${process.pid}`);
    },
  );

  it.skipIf(channelIsPipe)(
    'listenOnChannel_LiveListenerItsSocketFileRemoved_FailsInUseAndTheFirstStillServes',
    async () => {
      const channel = tempChannel();
      const reachedFirst: string[] = [];
      const first = listen(channel, {
        connected: (socket) =>
          socket.on('data', (chunk) => reachedFirst.push(chunk.toString())),
      });
      await first.listening;
      const kept = `${channel}.kept`;
      renameSync(channel, kept);
      const failed = vi.fn<(error: Error) => void>();

      const second = listen(channel, { failed });

      expect(await second.listening).toBe(false);
      expect(failed.mock.calls[0][0]).toMatchObject({ code: 'EADDRINUSE' });
      expect(existsSync(channel)).toBe(false);
      const client = await connectClient(kept);
      client.write('reached');
      await vi.waitFor(() => expect(reachedFirst).toEqual(['reached']));
    },
  );

  it.skipIf(channelIsPipe).each([
    { label: 'a pid that does not run', holder: deadPid, listens: true },
    { label: 'no pid', holder: () => '', listens: true },
    {
      label: 'another pid that runs',
      holder: () => process.ppid,
      listens: false,
    },
  ])(
    'listenOnChannel_LockFile_ListensOnlyWhenItsPidDoesNotRun: $label',
    async ({ holder, listens }) => {
      const channel = tempChannel();
      const held = `${holder()}`;
      writeLock(channel, held);

      const server = listen(channel);

      expect(await server.listening).toBe(listens);
      expect(lockText(channel)).toBe(listens ? `${process.pid}` : held);
    },
  );

  it.skipIf(channelIsPipe)(
    'listenOnChannel_ConnectDeniedOnASocketFile_CountsAsInUseAndKeepsTheFile',
    async () => {
      const channel = tempChannel();
      await leaveStaleSocket(channel);
      chmodSync(channel, 0o000);
      const failed = vi.fn<(error: Error) => void>();

      const server = listen(channel, { failed });

      expect(await server.listening).toBe(false);
      expect(failed.mock.calls[0][0]).toMatchObject({ code: 'EADDRINUSE' });
      expect(existsSync(channel)).toBe(true);
    },
  );

  it.skipIf(channelIsPipe)(
    'close_WhileCheckingASocketFile_NeverListens',
    async () => {
      const channel = tempChannel();
      await leaveStaleSocket(channel);
      const failed = vi.fn();

      const server = listen(channel, { failed });
      await server.close();

      expect(await server.listening).toBe(false);
      // The check settles a turn of the loop after its connect is refused.
      await new Promise((resolve) => setTimeout(resolve, 20));
      await expect(connectToChannel(channel)).rejects.toThrow();
      expect(failed).not.toHaveBeenCalled();
    },
  );

  it('close_OpenSocket_DestroysItAndResolves', async () => {
    const channel = tempChannel();
    const connected = vi.fn();
    const server = listen(channel, { connected });
    await server.listening;
    const client = await connectClient(channel);
    await vi.waitFor(() => expect(connected).toHaveBeenCalledOnce());
    const clientClosed = once(client, 'close');

    await server.close();

    await clientClosed;
  });

  it.skipIf(channelIsPipe).each([
    { label: 'its own lock goes', takenBy: null, left: null },
    { label: 'a lock another pid took stays', takenBy: '777', left: '777' },
  ])('close_Lock_DeletesOnlyItsOwn: $label', async ({ takenBy, left }) => {
    const channel = tempChannel();
    const server = listen(channel);
    await server.listening;
    if (takenBy !== null) {
      writeLock(channel, takenBy);
    }

    await server.close();

    expect(lockText(channel)).toBe(left);
  });
});

describe('connectToChannel', () => {
  it('connectToChannel_NoServer_Rejects', async () => {
    await expect(connectToChannel(tempChannel())).rejects.toSatisfy(
      (error: NodeJS.ErrnoException) =>
        error.code === 'ENOENT' || error.code === 'ECONNREFUSED',
    );
  });
});
