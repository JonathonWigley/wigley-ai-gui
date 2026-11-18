import { describe, expect, it } from 'vitest';
import type { AgentHarnessInfo } from '../../../contracts/agent';
import type { KeyedSlotReader } from '../../../contracts/state';
import { harnessInfo } from '../../../shared/agent-harness-registry.test-support';
import type { AppSlashCommand } from '../contract';
import { addClearCommands } from './clear-commands';
import { createSlashCommands } from './slash-commands';

// A `core.agentHarnesses` reader over a map; `set` and `remove` call its
// listeners.
function harnessSlot() {
  const entries = new Map<string, AgentHarnessInfo>();
  const listeners = new Set<
    (key: string, value: AgentHarnessInfo | undefined) => void
  >();
  const reader: KeyedSlotReader<AgentHarnessInfo> = {
    get: (key) => entries.get(key),
    all: () => entries,
    on(listener) {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
  };
  const set = (id: string, clearAliases: readonly string[]) => {
    const info = harnessInfo({ clearAliases });
    entries.set(id, info);
    for (const listener of listeners) {
      listener(id, info);
    }
  };
  const remove = (id: string) => {
    entries.delete(id);
    for (const listener of listeners) {
      listener(id, undefined);
    }
  };
  return { reader, set, remove };
}

// The clear commands over a slot holding `harnesses` (each a harness's clear
// aliases) and a registry that may hold `before` first.
function clearCommands(
  harnesses: (readonly string[])[],
  before: AppSlashCommand[] = [],
) {
  const commands = createSlashCommands();
  for (const command of before) {
    commands.add(command);
  }
  const slot = harnessSlot();
  harnesses.forEach((aliases, at) => slot.set(`harness-${at}`, aliases));
  const invoked: unknown[][] = [];
  const logged: string[] = [];
  const handle = addClearCommands({
    commands,
    channel: {
      invoke: (...args: unknown[]) => {
        invoked.push(args);
        return Promise.resolve(undefined);
      },
    } as unknown as Parameters<typeof addClearCommands>[0]['channel'],
    harnesses: slot.reader,
    log: (message) => logged.push(message),
  });
  const names = () => commands.list().map((command) => command.name);
  return { commands, slot, invoked, logged, handle, names };
}

function command(name: string): AppSlashCommand {
  return { name, description: `the ${name} command`, run: () => undefined };
}

describe('clear commands', () => {
  it.each([
    { harnesses: [], expected: ['clear'] },
    { harnesses: [['reset', 'new']], expected: ['clear', 'reset', 'new'] },
    {
      harnesses: [
        ['reset', 'new'],
        ['new', 'restart'],
      ],
      expected: ['clear', 'reset', 'new', 'restart'],
    },
    { harnesses: [['clear', 'reset']], expected: ['clear', 'reset'] },
  ])(
    'addClearCommands_Harnesses_RegistersClearThenEachDistinctAlias: $harnesses',
    ({ harnesses, expected }) => {
      expect(clearCommands(harnesses).names()).toEqual(expected);
    },
  );

  it('addClearCommands_AliasRun_InvokesClearForTheSession', async () => {
    const clear = clearCommands([['reset']]);

    await clear.commands
      .match('/reset')
      ?.command.run({ sessionId: 'row-1', profile: 'work', args: '' });

    expect(clear.invoked).toEqual([['clear', 'row-1']]);
  });

  it('addClearCommands_SlotChanges_ReregistersTheAliases', () => {
    const clear = clearCommands([['reset']]);

    clear.slot.set('harness-0', ['new']);

    expect(clear.names()).toEqual(['clear', 'new']);
    expect(clear.commands.match('/reset')).toBeNull();
  });

  it('addClearCommands_AliasHeldByAnotherCommand_SkipsAndLogs', () => {
    const login = command('login');

    const clear = clearCommands([['login', 'reset']], [login]);

    expect(clear.names()).toEqual(['login', 'clear', 'reset']);
    expect(clear.commands.match('/login')?.command).toBe(login);
    expect(clear.logged).toEqual([
      'clear alias /login skipped: /login is already registered',
    ]);
  });

  it('addClearCommands_AliasThenPluginCommand_AliasYieldsAndLogs', () => {
    const clear = clearCommands([['reset']]);
    const reset = command('reset');

    clear.commands.add(reset);

    expect(clear.names()).toEqual(['clear', 'reset']);
    expect(clear.commands.match('/reset')?.command).toBe(reset);
    expect(clear.logged).toEqual([
      'clear alias /reset dropped: /reset is registered by another command',
    ]);
    clear.handle.dispose();
    expect(clear.commands.list()).toEqual([reset]);
  });

  it('addClearCommands_Dispose_RemovesEveryName', () => {
    const clear = clearCommands([['reset']]);

    clear.handle.dispose();

    expect(clear.commands.list()).toEqual([]);
  });
});
