import { describe, expect, it } from 'vitest';
import type { AcceleratorBind, KeyBind } from '../../../contracts/keymap';
import type { CommandInfo } from '../../../contracts/plugin';
import type { UserConfigSchema } from '../../../contracts/user-config';
import { keymapRows, sameBind, type CommandRow } from './keymap-rows';

function command(id: string, runsIn: 'page' | 'main' = 'page'): CommandInfo {
  const [plugin] = id.split('.');
  return { id, plugin, label: `${id} label`, group: 'g', runsIn };
}

function schema(
  commands: CommandInfo[],
  defaultBinds: KeyBind[],
  app: AcceleratorBind[] = [],
): UserConfigSchema {
  return {
    sections: [],
    commands: Object.fromEntries(commands.map((info) => [info.id, info])),
    scopes: [],
    defaultBinds,
    defaultAccelerators: { app, global: [], intercept: [] },
    defaultLeader: '<Space>',
  };
}

function row(groups: ReturnType<typeof keymapRows>, id: string): CommandRow {
  const found = groups
    .flatMap((group) => group.rows)
    .find((candidate) => candidate.command.id === id);
  if (!found) {
    throw new Error(`no row for ${id}`);
  }
  return found;
}

describe('keymapRows', () => {
  it('keymapRows_UnbindMarksDefaultUnbound', () => {
    const given = schema(
      [command('p.a')],
      [{ keys: 'x', scope: 'p.s', command: 'p.a' }],
    );

    const groups = keymapRows(given, { unbind: [{ keys: 'x', scope: 'p.s' }] });

    expect(row(groups, 'p.a').binds[0].state).toBe('unbound');
  });

  it('keymapRows_UserBindReplacesOtherCommandsDefault', () => {
    const given = schema(
      [command('p.a'), command('p.b')],
      [{ keys: 'x', scope: 'p.s', command: 'p.a' }],
    );
    const userBind = { keys: 'x', scope: 'p.s', command: 'p.b' };

    const groups = keymapRows(given, { binds: [userBind] });

    expect(row(groups, 'p.a').binds[0]).toMatchObject({
      origin: 'default',
      state: 'replaced',
      replacedBy: 'p.b',
    });
    expect(row(groups, 'p.b').binds).toEqual([
      { bind: userBind, origin: 'user', state: 'active', replacedBy: null },
    ]);
  });

  it('keymapRows_EveryCommandHasARow', () => {
    const given = schema([command('p.a')], []);

    const groups = keymapRows(given, null);

    expect(row(groups, 'p.a').binds).toEqual([]);
  });

  it('keymapRows_MainCommandListsAccelerators', () => {
    const show = {
      accelerator: 'CommandOrControl+,',
      command: 'settings.show',
    };
    const given = schema([command('settings.show', 'main')], [], [show]);

    const groups = keymapRows(given, null);

    expect(row(groups, 'settings.show').accelerators).toEqual([
      { kind: 'app', bind: show, state: 'active' },
    ]);
  });
});

describe('sameBind', () => {
  it('sameBind_LeaderSpelledOut_Matches', () => {
    const fallback = { keys: '<Leader>?', scope: 'any', command: 'help' };
    const user = { keys: '<Space>?', scope: 'any', command: 'help' };

    expect(sameBind(user, fallback, '<Space>')).toBe(true);
  });
});
