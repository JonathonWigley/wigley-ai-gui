import { describe, expect, it } from 'vitest';
import type { AgentCommand } from '../../../contracts/agent';
import type { AppSlashCommand } from '../contract';
import { addAccountCommands } from './account-commands';
import { completionCommands, createSlashCommands } from './slash-commands';

function command(name: string): AppSlashCommand {
  return { name, description: `the ${name} command`, run: () => undefined };
}

function agentCommand(name: string, aliases: string[] = []): AgentCommand {
  return {
    name,
    description: `the agent's ${name}`,
    argumentHint: `<${name} args>`,
    aliases,
  };
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
    commands.add(command('clear'));

    added.dispose();

    expect(commands.match('/login')).toBeNull();
    expect(commands.list().map(({ name }) => name)).toEqual([
      'status',
      'clear',
    ]);
  });

  it('completionCommands_AppFirstNoRepeats', () => {
    expect(
      completionCommands(
        [command('status')],
        [agentCommand('status', ['s']), agentCommand('wigley:feature', ['f'])],
      ),
    ).toEqual([
      {
        name: 'status',
        description: 'the status command',
        argumentHint: '',
        aliases: [],
        source: 'app',
      },
      {
        name: 'wigley:feature',
        description: "the agent's wigley:feature",
        argumentHint: '<wigley:feature args>',
        aliases: ['f'],
        source: 'agent',
      },
    ]);
  });

  it.each([{ name: 'x' }, { name: 'wigley:status' }])(
    'completionCommands_AliasEqualToAppName_Dropped: $name',
    ({ name }) => {
      const [, kept] = completionCommands(
        [command('status')],
        [agentCommand(name, ['status', 'y'])],
      );

      expect(kept.name).toBe(name);
      expect(kept.aliases).toEqual(['y']);
    },
  );
});

// The account commands over a channel whose every invoke resolves with
// `answer`; `invoked` records each call to chat main, `signIns` each profile
// the sign-in dialog opened for. `run` runs the typed command in session row-1
// on profile work.
function accountCommands(answer: unknown = undefined) {
  const commands = createSlashCommands();
  const invoked: unknown[][] = [];
  const signIns: string[] = [];
  addAccountCommands({
    commands,
    signIn: { open: (profile) => signIns.push(profile) },
    channel: {
      invoke: (...args: unknown[]) => {
        invoked.push(args);
        return Promise.resolve(answer);
      },
    } as unknown as Parameters<typeof addAccountCommands>[0]['channel'],
  });
  const run = async (typed: string) => {
    const matched = commands.match(typed);
    await matched?.command.run({
      sessionId: 'row-1',
      profile: 'work',
      args: matched.args,
    });
  };
  return { run, invoked, signIns };
}

describe('account commands', () => {
  it('status_SignedIn_NoticesTheAccount', async () => {
    const account = accountCommands({ signedIn: true, account: 'me@x.dev' });

    await account.run('/status');

    expect(account.invoked).toEqual([
      ['accountStatus', 'work'],
      ['notice', 'row-1', 'work: signed in as me@x.dev', 'info'],
    ]);
  });

  it('status_SignedInNoAccountName_NoticesAnUnnamedAccount', async () => {
    const account = accountCommands({ signedIn: true, account: null });

    await account.run('/status');

    expect(account.invoked).toEqual([
      ['accountStatus', 'work'],
      ['notice', 'row-1', 'work: signed in as an unnamed account', 'info'],
    ]);
  });

  it('logout_LogsOutThenNotices', async () => {
    const account = accountCommands();

    await account.run('/logout');

    expect(account.invoked).toEqual([
      ['logOut', 'work'],
      ['notice', 'row-1', 'Signed out of work', 'info'],
    ]);
  });

  it('login_OpensSignInForTheSessionProfile', async () => {
    const account = accountCommands();

    await account.run('/login');

    expect(account.signIns).toEqual(['work']);
    expect(account.invoked).toEqual([]);
  });
});
