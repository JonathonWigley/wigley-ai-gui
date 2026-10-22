import { describe, expect, it, vi } from 'vitest';
import type { DriveAction, DriveHost } from '../../../contracts/plugin';
import type { ToolResult } from '../../sessions/contract';
import type { ChatSessionState } from '../contract';
import { addDriveActions } from './start';

function fakeDriveHost() {
  const actions = new Map<string, DriveAction>();
  const host: DriveHost = {
    add(name, action) {
      actions.set(name, action);
      return { dispose: () => actions.delete(name) };
    },
  };
  const run = (name: string, args?: unknown) => {
    const action = actions.get(name);
    if (action === undefined) {
      throw new Error(`no drive action ${name}`);
    }
    return action.run(args);
  };
  return { host, actions, run };
}

// A chat holding one session, `held`, whose permission calls wait until the
// test replies to them.
function fakeChat() {
  const replies: ((result: ToolResult) => void)[] = [];
  return {
    replies,
    closed: vi.fn<(sessionId: string) => void>(),
    start: () => 'started',
    sessions: () => [
      { sessionId: 'held', projectDir: '/p' } as ChatSessionState,
    ],
    permissionToolSession: () => ({
      call: () =>
        new Promise<ToolResult>((resolve) => {
          replies.push(resolve);
        }),
      end: () => undefined,
    }),
  };
}

function chatDriveActions(
  chat: ReturnType<typeof fakeChat>,
  activate: (sessionId: string) => void = () => undefined,
) {
  const drive = fakeDriveHost();
  addDriveActions(drive.host, {
    services: {
      homeDir: '/home',
      randomUuid: () => 'use-1',
      log: () => undefined,
      files: { makeFolder: () => Promise.resolve() },
    },
    profileNames: () => ['default'],
    chat,
    sessions: { activate },
  });
  return drive;
}

const ALLOWED: ToolResult = { content: [{ type: 'text', text: 'allow' }] };

describe('chat drive actions', () => {
  it('start closes the session it started when activating its row throws', async () => {
    const chat = fakeChat();
    const drive = chatDriveActions(chat, () => {
      throw new Error('no row');
    });

    await expect(drive.run('start')).rejects.toThrow('no row');
    expect(chat.closed).toHaveBeenCalledWith('started');
  });

  it('permissionAnswer is pending until the user answers, then the reply', async () => {
    const chat = fakeChat();
    const drive = chatDriveActions(chat);
    expect(await drive.run('askPermission', { sessionId: 'held' })).toEqual({
      toolUseId: 'use-1',
    });

    expect(await drive.run('permissionAnswer', { toolUseId: 'use-1' })).toEqual(
      { pending: true },
    );
    chat.replies[0]?.(ALLOWED);
    await Promise.resolve();

    expect(await drive.run('permissionAnswer', { toolUseId: 'use-1' })).toEqual(
      ALLOWED,
    );
  });

  it('permissionAnswer rejects a toolUseId askPermission never returned', async () => {
    const drive = chatDriveActions(fakeChat());

    await expect(
      drive.run('permissionAnswer', { toolUseId: 'other' }),
    ).rejects.toThrow('no permission other from chat.askPermission');
    await expect(drive.run('permissionAnswer')).rejects.toThrow(
      'toolUseId must be a string',
    );
  });
});
