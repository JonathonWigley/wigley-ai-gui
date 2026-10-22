import { afterEach, describe, expect, it } from 'vitest';
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
    });

    const response = await fetch(`http://127.0.0.1:${server.port}/`, {
      method: 'POST',
      body: JSON.stringify({ command: 'ready', args: {} }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: 'bad token' });
    expect(ran).toEqual([]);
  });
});
