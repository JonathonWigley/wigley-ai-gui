import { describe, expect, it } from 'vitest';
import type { AppSlashCommand } from '../contract';
import { addAccountCommands } from './account-commands';
import { completionWords, createSlashCommands } from './slash-commands';

function command(name: string): AppSlashCommand {
  return { name, description: `the ${name} command`, run: () => undefined };
}

describe('slash commands', () => {
  it('match_RegisteredWithArgs_TrimsArgs', () => {
    const commands = createSlashCommands();
    const status = command('status');
    commands.add(status);

    expect(commands.match('/status  now ')).toEqual({
      command: status,
      args: 'now',
    });
  });

  it('match_RegisteredAlone_ArgsEmpty', () => {
    const commands = createSlashCommands();
    const login = command('login');
    commands.add(login);

    expect(commands.match('  /login  ')).toEqual({ command: login, args: '' });
  });

  it('match_Unregistered_Null', () => {
    const commands = createSlashCommands();
    commands.add(command('login'));

    expect(commands.match('/model opus')).toBeNull();
  });

  it('match_TextBeforeSlash_Null', () => {
    const commands = createSlashCommands();
    commands.add(command('login'));

    expect(commands.match('hi /login')).toBeNull();
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

describe('account commands', () => {
  it('status_EndedSession_Toasts', async () => {
    const commands = createSlashCommands();
    const invoked: unknown[][] = [];
    const toasts: string[] = [];
    addAccountCommands({
      commands,
      signIn: { open: () => undefined },
      channel: {
        invoke: (...args: unknown[]) => {
          invoked.push(args);
          return Promise.resolve({ signedIn: false, account: null });
        },
      } as unknown as Parameters<typeof addAccountCommands>[0]['channel'],
      toast: (text) => toasts.push(text),
    });
    const status = commands.match('/status');

    await status?.command.run({
      sessionId: 'row-1',
      profile: 'work',
      args: status.args,
      ended: true,
    });

    expect(toasts).toEqual(['work: not signed in']);
    expect(invoked).toEqual([['accountStatus', 'work']]);
  });
});
