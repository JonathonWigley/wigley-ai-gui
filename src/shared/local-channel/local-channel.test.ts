import { once } from 'node:events';
import { mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
    process.platform,
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
});

describe('connectToChannel', () => {
  it('connectToChannel_NoServer_Rejects', async () => {
    await expect(connectToChannel(tempChannel())).rejects.toSatisfy(
      (error: NodeJS.ErrnoException) =>
        error.code === 'ENOENT' || error.code === 'ECONNREFUSED',
    );
  });
});
