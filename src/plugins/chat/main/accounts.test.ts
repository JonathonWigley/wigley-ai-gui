import { describe, expect, it } from 'vitest';
import {
  createFakeAgentHarness,
  FAKE_SIGN_IN_CODE,
  FAKE_SIGN_IN_URL,
} from '../../../shared/fake-agent-harness';
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
  const harness = createFakeAgentHarness();
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
  it('logIn_Link_SendsLogInLink', async () => {
    const test = setUp();

    test.accounts.logIn('work');
    await flush();

    expect(test.messages).toEqual([
      {
        message: 'logInLink',
        data: { profile: 'work', url: FAKE_SIGN_IN_URL },
      },
    ]);
  });

  it('logIn_WhileRunning_Throws', async () => {
    const test = setUp();
    test.accounts.logIn('work');

    expect(() => test.accounts.logIn('personal')).toThrow(
      'A sign-in is already running for work',
    );
    expect(test.logIns()).toBe(1);
  });

  it('logIn_Ended_SendsLogInEndedAndAllowsAnother', async () => {
    const test = setUp();
    await test.harness.logOut('~/.claude');
    test.accounts.logIn('work');
    await flush();

    test.accounts.sendCode(FAKE_SIGN_IN_CODE);
    await flush();

    expect(
      test.messages.filter((sent) => sent.message === 'logInEnded'),
    ).toEqual([
      {
        message: 'logInEnded',
        data: {
          profile: 'work',
          status: { signedIn: true, account: 'fake@example.invalid' },
          error: null,
        },
      },
    ]);
    test.accounts.logIn('personal');
    expect(test.logIns()).toBe(2);
  });

  it('logIn_UnknownProfile_ThrowsNamingIt', () => {
    const test = setUp();

    expect(() => test.accounts.logIn('nobody')).toThrow(
      'chat has no profile "nobody"',
    );
    expect(test.logIns()).toBe(0);
  });

  it('sendCodeAndCancel_NoneRunning_LoggedAndIgnored', () => {
    const test = setUp();

    test.accounts.sendCode(FAKE_SIGN_IN_CODE);
    test.accounts.cancel();

    expect(test.logged).toEqual([
      '[chat] sign-in code with no sign-in running ignored',
      '[chat] sign-in cancel with no sign-in running ignored',
    ]);
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

    await expect(accounts.status('work')).rejects.toThrow(
      'no agent harness "claude"',
    );
  });
});
