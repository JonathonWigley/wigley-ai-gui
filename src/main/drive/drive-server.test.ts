import { afterEach, describe, expect, it, vi } from 'vitest';
import { type DriveServer, startDriveServer } from './drive-server';

const TOKEN = '0123456789abcdef0123456789abcdef';

let server: DriveServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

describe('startDriveServer', () => {
  it('post_NoToken_Answers401AndRunsNoCommand', async () => {
    const ran: string[] = [];
    server = await startDriveServer({
      token: TOKEN,
      run: async (command) => {
        ran.push(command);
        return {};
      },
      unqueued: [],
    });

    const response = await fetch(`http://127.0.0.1:${server.port}/`, {
      method: 'POST',
      body: JSON.stringify({ command: 'ready', args: {} }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: 'bad token' });
    expect(ran).toEqual([]);
  });

  it('post_UnqueuedCommandBehindAStuckOne_AnswersIt', async () => {
    let isReadyRunning = false;
    server = await startDriveServer({
      token: TOKEN,
      run: (command) => {
        if (command === 'ready') {
          isReadyRunning = true;
          return new Promise(() => {});
        }
        return Promise.resolve({});
      },
      unqueued: ['quit'],
    });
    const post = (command: string) =>
      fetch(`http://127.0.0.1:${server?.port}/`, {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ command }),
      });

    void post('ready').catch(() => {});
    await vi.waitFor(() => expect(isReadyRunning).toBe(true));
    const response = await post('quit');

    expect(await response.json()).toEqual({ ok: true, result: {} });
  });
});
