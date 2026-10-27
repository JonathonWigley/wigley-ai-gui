import { describe, expect, it } from 'vitest';
import type { AppSlashCommand } from '../contract';
import { addAccountCommands } from './account-commands';
import { completionWords, createSlashCommands } from './slash-commands';

function command(name: string): AppSlashCommand {
  return { name, description: `the ${name} command`, run: () => undefined };
}

describe('slash commands', () => {
  it.each([
    { text: '/status  now ', expected: { name: 'status', args: 'now' } },
    { text: '  /login  ', expected: { name: 'login', args: '' } },
    { text: '/model opus', expected: null },
    { text: 'hi /login', expected: null },
  ])('match "$text" → $expected', ({ text, expected }) => {
    const commands = createSlashCommands();
    commands.add(command('status'));
    commands.add(command('login'));

    const matched = commands.match(text);

    expect(
      matched === null
        ? null
        : { name: matched.command.name, args: matched.args },
    ).toEqual(expected);
  });

  it('add_Twice_Throws', () => {
    const commands = createSlashCommands();
    commands.add(command('login'));

    expect(() => commands.add(command('login'))).toThrow(
      'App slash command /login is already registered',
    );
  });

  it('dispose_RemovesCommand', () => {
    const commands = createSlashCommands();
    const added = commands.add(command('login'));
    commands.add(command('status'));

    added.dispose();

    expect(commands.match('/login')).toBeNull();
    expect(commands.names()).toEqual(['status']);
  });

  it('completionWords_AppFirstNoRepeats', () => {
    expect(completionWords(['login', 'status'], ['status', 'model'])).toEqual([
      'login',
      'status',
      'model',
    ]);
  });
});

// The account commands over a channel whose every invoke resolves with
// `answer`; `invoked` records each call to chat main, `signIns` each profile
// the sign-in dialog opened for and `toasts` each toast. `run` runs the typed
// command in session row-1 on profile work.
function accountCommands(answer: unknown = undefined) {
  const commands = createSlashCommands();
  const invoked: unknown[][] = [];
  const signIns: string[] = [];
  const toasts: string[] = [];
  addAccountCommands({
    commands,
    signIn: { open: (profile) => signIns.push(profile) },
    channel: {
      invoke: (...args: unknown[]) => {
        invoked.push(args);
        return Promise.resolve(answer);
      },
    } as unknown as Parameters<typeof addAccountCommands>[0]['channel'],
    toast: (text) => toasts.push(text),
  });
  const run = async (typed: string, ended: boolean) => {
    const matched = commands.match(typed);
    await matched?.command.run({
      sessionId: 'row-1',
      profile: 'work',
      args: matched.args,
      ended,
    });
  };
  return { run, invoked, signIns, toasts };
}

describe('account commands', () => {
  it('status_EndedSession_Toasts', async () => {
    const account = accountCommands({ signedIn: false, account: null });

    await account.run('/status', true);

    expect(account.toasts).toEqual([expect.stringContaining('work')]);
    expect(account.invoked).toEqual([['accountStatus', 'work']]);
  });

  it('status_LiveSignedIn_NoticesTheAccount', async () => {
    const account = accountCommands({ signedIn: true, account: 'me@x.dev' });

    await account.run('/status', false);

    expect(account.invoked).toEqual([
      ['accountStatus', 'work'],
      ['notice', 'row-1', 'work: signed in as me@x.dev', 'info'],
    ]);
    expect(account.toasts).toEqual([]);
  });

  it('status_LiveSignedInNoAccountName_NoticesAnUnnamedAccount', async () => {
    const account = accountCommands({ signedIn: true, account: null });

    await account.run('/status', false);

    expect(account.invoked).toEqual([
      ['accountStatus', 'work'],
      ['notice', 'row-1', 'work: signed in as an unnamed account', 'info'],
    ]);
  });

  it('logout_LiveSession_LogsOutThenNotices', async () => {
    const account = accountCommands();

    await account.run('/logout', false);

    expect(account.invoked).toEqual([
      ['logOut', 'work'],
      ['notice', 'row-1', 'Signed out of work', 'info'],
    ]);
  });

  it('login_OpensSignInForTheSessionProfile', async () => {
    const account = accountCommands();

    await account.run('/login', false);

    expect(account.signIns).toEqual(['work']);
    expect(account.invoked).toEqual([]);
  });
});
