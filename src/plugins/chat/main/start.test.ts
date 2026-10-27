import { describe, expect, it, vi } from 'vitest';
import { fakeDriveHost } from '../../../shared/fake-drive-host';
import type { ToolResult } from '../../sessions/contract';
import type { ChatSessionState } from '../contract';
import { addDriveActions, chatMainPart } from './start';

// A chat holding one session, `held`, whose permission calls wait until the
// test replies to them, and `held` resting when `running` is false; `calls`
// holds each call's tool args.
function fakeChat(running = true) {
  const replies: ((result: ToolResult) => void)[] = [];
  const calls: unknown[] = [];
  return {
    replies,
    calls,
    closed: vi.fn<(sessionId: string) => void>(),
    start: () => 'started',
    sessions: () => [
      { sessionId: 'held', projectDir: '/p', running } as ChatSessionState,
    ],
    permissionToolSession: () => ({
      call: (_name: string, args: unknown) => {
        calls.push(args);
        return new Promise<ToolResult>((resolve) => {
          replies.push(resolve);
        });
      },
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

  it.each([
    { given: 'an explicit null input', input: null, sent: null },
    { given: 'no input', input: undefined, sent: { command: 'ls' } },
  ])('askPermission given $given sends $sent', async ({ input, sent }) => {
    const chat = fakeChat();
    const drive = chatDriveActions(chat);
    const args = input === undefined ? {} : { input };

    await drive.run('askPermission', { sessionId: 'held', ...args });

    expect(chat.calls[0]).toEqual({
      tool_name: 'Bash',
      input: sent,
      tool_use_id: 'use-1',
    });
  });

  it('askPermission rejects a resting session and raises no card', async () => {
    const chat = fakeChat(false);
    const drive = chatDriveActions(chat);

    await expect(
      drive.run('askPermission', { sessionId: 'held' }),
    ).rejects.toThrow('held');
    expect(chat.calls).toEqual([]);
  });

  it('permissionAnswer rejects a toolUseId askPermission never returned', async () => {
    const drive = chatDriveActions(fakeChat());

    await expect(
      drive.run('permissionAnswer', { toolUseId: 'other' }),
    ).rejects.toThrow('other');
    await expect(drive.run('permissionAnswer')).rejects.toThrow('toolUseId');
  });
});

// Chat's main part started on a harness whose sign-ins record their cancel,
// with one profile, `work`, and a data folder that cannot be read. `invoke`
// calls the page channel's handler for `name`.
function startChatPart() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const cancelLogIn = vi.fn<() => void>();
  const harness = {
    id: 'claude',
    logIn: () => ({ sendCode: () => undefined, cancel: cancelLogIn }),
  };
  const api = {
    channel: {
      handle: (name: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(name, handler),
      send: () => undefined,
    },
    events: { on: () => ({ dispose: () => undefined }) },
    settings: () => ({ profiles: [{ name: 'work', configDir: '/work' }] }),
    services: {
      log: () => undefined,
      agentHarnesses: [harness],
      selfTest: null,
    },
    dependency: () => ({ contributeTools: () => undefined }),
    data: { list: () => Promise.reject(new Error('no data folder')) },
    layouts: { register: () => ({ dispose: () => undefined }) },
    drive: null,
  } as unknown as Parameters<typeof chatMainPart.start>[0];
  const part = chatMainPart.start(api);
  const invoke = (name: string, ...args: unknown[]) => {
    const handler = handlers.get(name);
    if (handler === undefined) {
      throw new Error(`chat handles no ${name}`);
    }
    return handler(...args);
  };
  return { part, invoke, cancelLogIn };
}

describe('chat main part', () => {
  it('loaded_SignInRunning_CancelsIt', () => {
    const chat = startChatPart();
    chat.invoke('logIn', 1, 'work');

    chat.invoke('loaded');

    expect(chat.cancelLogIn).toHaveBeenCalledOnce();
  });

  it('sessions_SignInRunning_LeavesItRunning', () => {
    const chat = startChatPart();
    chat.invoke('logIn', 1, 'work');

    chat.invoke('sessions');

    expect(chat.cancelLogIn).not.toHaveBeenCalled();
  });

  it('dispose_SignInRunning_CancelsIt', async () => {
    const chat = startChatPart();
    chat.invoke('logIn', 1, 'work');

    await chat.part.dispose?.();

    expect(chat.cancelLogIn).toHaveBeenCalledOnce();
  });
});
