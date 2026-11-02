import { describe, expect, it } from 'vitest';
import {
  createFakeAgentHarness,
  FAKE_SIGN_IN_CODE,
  FAKE_SIGN_IN_URL,
} from '../../../shared/fake-agent-harness';
import { createMemoryFiles } from '../../../shared/memory-files';
import type { ChatChannel, ChatProfile } from '../contract';
import { createAccounts } from './accounts';

type Message = {
  [K in keyof ChatChannel['messages']]: {
    message: K;
    data: ChatChannel['messages'][K];
  };
}[keyof ChatChannel['messages']];

const PROFILES: ChatProfile[] = [
  { name: 'work', configDir: '~/.claude' },
  { name: 'personal', configDir: '~/.claude-personal' },
];

// Lets the fake harness's queued sign-in events run.
async function flush() {
  for (let turn = 0; turn < 10; turn++) {
    await Promise.resolve();
  }
}

function setUp() {
  const harness = createFakeAgentHarness(
    { now: () => 1000 },
    createMemoryFiles(),
  );
  const messages: Message[] = [];
  const logged: string[] = [];
  let logIns = 0;
  const counted = {
    ...harness,
    logIn: (...args: Parameters<typeof harness.logIn>) => {
      logIns++;
      return harness.logIn(...args);
    },
  };
  const accounts = createAccounts({
    harness: () => counted,
    profiles: () => PROFILES,
    send: (message, data) => messages.push({ message, data } as Message),
    log: (source, message) => logged.push(`[${source}] ${message}`),
  });
  return { accounts, harness, messages, logged, logIns: () => logIns };
}

describe('createAccounts', () => {
  it('logIn_Link_SendsLogInLinkWithItsId', async () => {
    const test = setUp();

    test.accounts.logIn(7, 'work');
    await flush();

    expect(test.messages).toEqual([
      {
        message: 'logInLink',
        data: { id: 7, profile: 'work', url: FAKE_SIGN_IN_URL },
      },
    ]);
  });

  it('logIn_WhileRunning_Throws', async () => {
    const test = setUp();
    test.accounts.logIn(1, 'work');

    expect(() => test.accounts.logIn(2, 'personal')).toThrow(/work/);
    expect(test.logIns()).toBe(1);
  });

  it('logIn_Ended_SendsLogInEndedAndAllowsAnother', async () => {
    const test = setUp();
    await test.harness.logOut('~/.claude');
    test.accounts.logIn(1, 'work');
    await flush();

    test.accounts.sendCode(1, FAKE_SIGN_IN_CODE);
    await flush();

    expect(
      test.messages.filter((sent) => sent.message === 'logInEnded'),
    ).toEqual([
      {
        message: 'logInEnded',
        data: {
          id: 1,
          profile: 'work',
          status: { signedIn: true, account: 'fake@example.invalid' },
          error: null,
        },
      },
    ]);
    test.accounts.logIn(2, 'personal');
    expect(test.logIns()).toBe(2);
  });

  it('cancel_WhileRunning_AllowsAnotherAtOnceAndSendsNoEnd', async () => {
    const test = setUp();
    test.accounts.logIn(1, 'work');
    await flush();

    test.accounts.cancel(1);
    test.accounts.logIn(2, 'personal');
    await flush();

    expect(test.logIns()).toBe(2);
    expect(
      test.messages.filter((sent) => sent.message === 'logInEnded'),
    ).toEqual([]);
    expect(test.logged).toContainEqual(expect.stringContaining('work'));
  });

  it('cancelAndSendCode_OtherId_LoggedAndIgnored', async () => {
    const test = setUp();
    await test.harness.logOut('~/.claude');
    test.accounts.logIn(2, 'work');
    await flush();

    test.accounts.cancel(1);
    test.accounts.sendCode(1, FAKE_SIGN_IN_CODE);
    await flush();

    expect(() => test.accounts.logIn(3, 'personal')).toThrow(/work/);
    expect(test.messages.map((sent) => sent.message)).toEqual(['logInLink']);
  });

  it('cancelRunning_ReusedIdAfterward_OldEndReachesNoPage', async () => {
    const test = setUp();
    await test.harness.logOut('~/.claude');
    test.accounts.logIn(1, 'work');
    await flush();

    test.accounts.cancelRunning();
    test.accounts.logIn(1, 'personal');
    await flush();

    expect(test.messages).toEqual([
      {
        message: 'logInLink',
        data: { id: 1, profile: 'work', url: FAKE_SIGN_IN_URL },
      },
      {
        message: 'logInLink',
        data: { id: 1, profile: 'personal', url: FAKE_SIGN_IN_URL },
      },
    ]);
  });

  it('cancelRunning_NoneRunning_DoesNothing', () => {
    const test = setUp();

    test.accounts.cancelRunning();

    expect(test.logged).toEqual([]);
  });

  it('logIn_UnknownProfile_ThrowsNamingIt', () => {
    const test = setUp();

    expect(() => test.accounts.logIn(1, 'nobody')).toThrow('nobody');
    expect(test.logIns()).toBe(0);
  });

  it('sendCodeAndCancel_NoneRunning_IgnoredAndALaterSignInStarts', async () => {
    const test = setUp();

    test.accounts.sendCode(1, FAKE_SIGN_IN_CODE);
    test.accounts.cancel(1);
    await flush();

    expect(test.messages).toEqual([]);
    test.accounts.logIn(2, 'work');
    await flush();
    expect(test.logIns()).toBe(1);
    expect(test.messages.map((sent) => sent.message)).toEqual(['logInLink']);
  });

  it('statusAndLogOut_UseTheProfilesFolder', async () => {
    const test = setUp();

    await test.accounts.logOut('personal');

    expect(await test.accounts.status('personal')).toEqual({
      signedIn: false,
      account: null,
    });
    expect(await test.accounts.status('work')).toEqual({
      signedIn: true,
      account: 'fake@example.invalid',
    });
  });

  it('status_NoHarness_Rejects', async () => {
    const accounts = createAccounts({
      harness: () => {
        throw new Error('no agent harness "claude"');
      },
      profiles: () => PROFILES,
      send: () => undefined,
      log: () => undefined,
    });

    await expect(accounts.status('work')).rejects.toThrow('claude');
  });
});
