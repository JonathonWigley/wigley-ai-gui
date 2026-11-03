import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorHost } from '../../../contracts/editor';
import { NO_FENCES } from '../../../shared/page/markdown-mount.test-support';
import { installFakeDom } from '../../../shared/page/test-dom';
import {
  fakeDependency,
  startPagePart,
} from '../../../shared/plugin-part-harness.test-support';
import { createRegistrations } from '../../../shared/registrations';
import { type KeysPageExports, keysPageKey } from '../../keys/contract';
import {
  type SessionsPageExports,
  sessionsPageKey,
} from '../../sessions/contract';
import type { ChatPageExports, ChatSessionState } from '../contract';
import { chatPagePart } from './start';

const NO_LIVE = {
  registrations: 0,
  timers: 0,
  listeners: 0,
  observers: 0,
  frames: 0,
};

const SESSION: ChatSessionState = {
  sessionId: 's1',
  projectDir: '/p',
  profile: 'work',
  entries: [],
  controls: [],
  activity: 'idle',
  background: 0,
  commands: [],
  running: false,
  queued: [],
  repo: 'p',
  branch: null,
};

// Chat's page part on the part harness, over sessions and keys fakes that file
// each tab and anchor with `consumer.track`, as their views do. `invoke`
// answers the part's `channel.invoke`; `destroyEditor` is each tab's box's
// `destroy`.
function startChatPage(
  invoke: (method: string) => Promise<unknown>,
  destroyEditor: () => void = () => undefined,
) {
  return startPagePart(chatPagePart, {
    invoke,
    services: {
      editor: {
        create: () => ({ destroy: destroyEditor, focus() {} }),
      } as unknown as EditorHost,
      markdown: {
        block: (text: string) => text,
        inline: (text: string) => text,
        document: (text: string) => Promise.resolve(text),
        ...NO_FENCES,
      },
    },
    dependencies: [
      fakeDependency(
        sessionsPageKey,
        (consumer) =>
          ({
            addTab: () =>
              consumer.track({
                dispose() {},
                select() {},
                isVisible: () => false,
              }),
            activate() {},
            setActivity() {},
            selectedSessionId: () => null,
          }) as unknown as SessionsPageExports,
      ),
      fakeDependency(
        keysPageKey,
        (consumer) =>
          ({
            anchor: () => consumer.track({ dispose() {} }),
            keysFor: () => null,
          }) as unknown as KeysPageExports,
      ),
    ],
  });
}

// What the part hears when main holds no session.
const noSessions = (method: string) =>
  Promise.resolve(method === 'sessions' ? [] : undefined);

beforeEach(() => {
  installFakeDom(vi.stubGlobal);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('chat page part', () => {
  it.each(['fresh start', 'one tab held'])(
    'stop_LeavesNoLiveRegistration: %s',
    async (row) => {
      const harness = startChatPage(noSessions);
      if (row === 'one tab held') {
        harness.send('sessionStarted', SESSION);
        expect(harness.counts().observers).toBeGreaterThan(0);
      }

      await harness.stop();

      expect(harness.counts()).toEqual(NO_LIVE);
    },
  );

  it('stop_LeavesNoLiveRegistration: sessions reply after the stop', async () => {
    let replySessions = (_states: ChatSessionState[]) => {};
    const reply = new Promise<ChatSessionState[]>((resolve) => {
      replySessions = resolve;
    });
    const harness = startChatPage((method) =>
      method === 'sessions' ? reply : Promise.resolve(),
    );

    await harness.stop();
    replySessions([SESSION]);
    await reply;
    await Promise.resolve();

    expect(harness.counts()).toEqual(NO_LIVE);
  });

  it('stop_OneTabsDestroyThrows_TearsDownEveryTab', async () => {
    const destroyEditor = vi.fn<() => void>();
    destroyEditor.mockImplementationOnce(() => {
      throw new Error('box gone');
    });
    const harness = startChatPage(noSessions, destroyEditor);
    harness.send('sessionStarted', SESSION);
    harness.send('sessionStarted', { ...SESSION, sessionId: 's2' });

    await expect(harness.stop()).rejects.toThrow('box gone');

    expect(destroyEditor).toHaveBeenCalledTimes(2);
    expect(harness.counts()).toEqual(NO_LIVE);
  });

  it('sessionRemoved_HeldTab_DestroysItsBoxOnce', async () => {
    const destroyEditor = vi.fn<() => void>();
    const harness = startChatPage(noSessions, destroyEditor);
    harness.send('sessionStarted', SESSION);

    harness.emit('sessions.sessionRemoved', { sessionId: SESSION.sessionId });
    await harness.stop();

    expect(destroyEditor).toHaveBeenCalledOnce();
  });

  it('stopThenStart_StartsAgain', async () => {
    const harness = startChatPage(noSessions);

    await harness.restart();

    expect(harness.started().exports).toBeTypeOf('function');
  });

  it.each([
    {
      member: 'addSlashCommand',
      add: (view: ChatPageExports) =>
        view.addSlashCommand({ name: 'same', run: () => undefined } as never),
    },
    {
      member: 'addComposerPart',
      add: (view: ChatPageExports) =>
        view.addComposerPart({ id: 'same', build: () => ({}) }),
    },
    {
      member: 'addStatusPart',
      add: (view: ChatPageExports) =>
        view.addStatusPart({ id: 'same', build: () => ({}) }),
    },
  ])('exports_ConsumerDisposed_FreesTheName: $member', ({ add }) => {
    const harness = startChatPage(noSessions);
    const viewOf = (consumer: ReturnType<typeof createRegistrations>) =>
      harness.started().exports?.(consumer) as ChatPageExports;
    const first = createRegistrations();
    add(viewOf(first));

    first.dispose();

    expect(() => add(viewOf(createRegistrations()))).not.toThrow();
  });
});
