import { describe, expect, it } from 'vitest';
import type { PushedScope, ToastTone } from '../../../contracts/plugin';
import type { ChatChannel } from '../contract';
import { createSignInFlow, type SignInFlowDeps } from './sign-in-flow';

type Messages = ChatChannel['messages'];

// Lets the flow's invokes settle.
async function flush() {
  for (let turn = 0; turn < 10; turn++) {
    await Promise.resolve();
  }
}

// `logIn` answers `logInAnswer` each call; every other invoke resolves but
// those named in `failing`, which reject. `stop` marks chat's page part
// stopped.
function setUp(
  logInAnswer: () => Promise<void> = () => Promise.resolve(),
  failing: readonly string[] = [],
) {
  let isStopped = false;
  const invoked: { method: string; args: unknown[] }[] = [];
  const listeners = new Map<string, (data: never) => void>();
  const toasts: { text: string; tone: ToastTone }[] = [];
  const logs: string[] = [];
  const copied: string[] = [];
  let shownProfile: string | null = null;
  let pushedScopes = 0;
  const channel: SignInFlowDeps['channel'] = {
    invoke: ((method: string, ...args: unknown[]) => {
      invoked.push({ method, args });
      if (method === 'logIn') {
        return logInAnswer();
      }
      return failing.includes(method)
        ? Promise.reject(new Error(`${method} refused`))
        : Promise.resolve();
    }) as SignInFlowDeps['channel']['invoke'],
    on: ((message: string, listener: (data: never) => void) => {
      listeners.set(message, listener);
      return { dispose: () => listeners.delete(message) };
    }) as SignInFlowDeps['channel']['on'],
  };
  const flow = createSignInFlow({
    view: {
      show: (profile) => {
        shownProfile = profile;
      },
      showLink: () => undefined,
      code: () => ' 1234 ',
      hide: () => {
        shownProfile = null;
      },
    },
    channel,
    pushScope: (): PushedScope => {
      pushedScopes += 1;
      return {
        pop: () => {
          pushedScopes -= 1;
        },
        dispose: () => undefined,
        onBaseChanged: () => ({ dispose: () => undefined }),
      };
    },
    writeClipboard: (text) => {
      copied.push(text);
      return Promise.resolve();
    },
    toast: (text, tone) => toasts.push({ text, tone }),
    log: (message) => logs.push(message),
    isStopped: () => isStopped,
  });
  const emit = <K extends keyof Messages & string>(
    message: K,
    data: Messages[K],
  ) => (listeners.get(message) as (data: Messages[K]) => void)(data);
  return {
    flow,
    invoked,
    toasts,
    logs,
    copied,
    emit,
    shownProfile: () => shownProfile,
    pushedScopes: () => pushedScopes,
    stop: () => {
      isStopped = true;
    },
  };
}

// Each value `finished` was called with, in order.
function finishedCalls() {
  const calls: boolean[] = [];
  return { calls, finished: (signedIn: boolean) => calls.push(signedIn) };
}

describe('createSignInFlow', () => {
  it('ended_SignedInWithError_FinishesFalseAndToastsTheError', () => {
    const run = setUp();
    const first = finishedCalls();
    run.flow.open('work', first.finished);

    run.emit('logInEnded', {
      id: 1,
      profile: 'work',
      status: { signedIn: true, account: 'me@example.invalid' },
      error: 'Wrong code',
    });

    expect(first.calls).toEqual([false]);
    expect(run.toasts).toEqual([
      { text: expect.stringContaining('Wrong code'), tone: 'error' },
    ]);
  });

  it('ended_SignedInNoError_FinishesTrueAndToastsTheAccount', () => {
    const run = setUp();
    const first = finishedCalls();
    run.flow.open('work', first.finished);

    run.emit('logInEnded', {
      id: 1,
      profile: 'work',
      status: { signedIn: true, account: 'me@example.invalid' },
      error: null,
    });

    expect(first.calls).toEqual([true]);
    expect(run.toasts).toEqual([
      {
        text: expect.stringContaining('me@example.invalid'),
        tone: 'success',
      },
    ]);
    expect(run.shownProfile()).toBeNull();
    expect(run.pushedScopes()).toBe(0);
  });

  it('ended_CancelledSignInsId_LeavesTheNewerDialogOpen', () => {
    const run = setUp();
    run.flow.open('work');
    run.flow.cancel();
    const second = finishedCalls();
    run.flow.open('work', second.finished);

    run.emit('logInEnded', {
      id: 1,
      profile: 'work',
      status: null,
      error: 'Sign-in cancelled',
    });

    expect(second.calls).toEqual([]);
    expect(run.shownProfile()).toBe('work');
    expect(run.toasts).toEqual([]);
  });

  it('link_OtherId_IsNotShown', () => {
    const run = setUp();
    run.flow.open('work');

    run.emit('logInLink', { id: 2, profile: 'work', url: 'https://x' });
    run.flow.copyLink();

    expect(run.copied).toEqual([]);
  });

  it('open_WhileOpen_FinishesTheFirstFalseOnceAndCancelsItsSignIn', () => {
    const run = setUp();
    const first = finishedCalls();
    const second = finishedCalls();
    run.flow.open('work', first.finished);

    run.flow.open('personal', second.finished);
    run.emit('logInEnded', {
      id: 1,
      profile: 'work',
      status: { signedIn: true, account: null },
      error: null,
    });

    expect(first.calls).toEqual([false]);
    expect(second.calls).toEqual([]);
    expect(run.invoked).toEqual([
      { method: 'logIn', args: [1, 'work'] },
      { method: 'cancelLogIn', args: [1] },
      { method: 'logIn', args: [2, 'personal'] },
    ]);
    expect(run.shownProfile()).toBe('personal');
    expect(run.pushedScopes()).toBe(1);
  });

  it('logInRejects_AfterCancel_FinishesOnce', async () => {
    const run = setUp(() => Promise.reject(new Error('busy')));
    const first = finishedCalls();
    run.flow.open('work', first.finished);

    run.flow.cancel();
    await flush();

    expect(first.calls).toEqual([false]);
  });

  it('submitCodeAndCopyLink_NameTheOpenSignIn', async () => {
    const run = setUp();
    run.flow.open('work');
    run.emit('logInLink', { id: 1, profile: 'work', url: 'https://x' });

    run.flow.submitCode();
    run.flow.copyLink();
    await flush();

    expect(run.invoked).toContainEqual({
      method: 'logInCode',
      args: [1, '1234'],
    });
    expect(run.copied).toEqual(['https://x']);
  });

  it.each([
    {
      reply: 'a rejected logIn',
      failing: [],
      logInFails: true,
      act: () => undefined,
    },
    {
      reply: 'a rejected logInCode',
      failing: ['logInCode'],
      logInFails: false,
      act: (run: ReturnType<typeof setUp>) => run.flow.submitCode(),
    },
    {
      reply: 'a rejected cancelLogIn',
      failing: ['cancelLogIn'],
      logInFails: false,
      act: (run: ReturnType<typeof setUp>) => run.flow.cancel(),
    },
    {
      reply: 'a copied link',
      failing: [],
      logInFails: false,
      act: (run: ReturnType<typeof setUp>) => {
        run.emit('logInLink', { id: 1, profile: 'work', url: 'https://x' });
        run.flow.copyLink();
      },
    },
  ])(
    'logs and toasts nothing for $reply landing after chat stopped',
    async ({ failing, logInFails, act }) => {
      const run = setUp(
        logInFails
          ? () => Promise.reject(new Error('busy'))
          : () => Promise.resolve(),
        failing,
      );
      run.flow.open('work');
      act(run);
      const logged = run.logs.length;

      run.stop();
      await flush();

      expect(run.logs.slice(logged)).toEqual([]);
      expect(run.toasts).toEqual([]);
    },
  );
});
