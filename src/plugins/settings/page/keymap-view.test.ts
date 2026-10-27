import { describe, expect, it } from 'vitest';
import type {
  AcceleratorBind,
  KeyBind,
  UserKeymap,
} from '../../../contracts/keymap';
import type { CommandInfo } from '../../../contracts/plugin';
import type { UserConfigSchema } from '../../../contracts/user-config';
import { keymapRows } from './keymap-rows';
import { keyRowInput } from './keymap-view';
import type { RowContext } from './settings-view';

function command(id: string, runsIn: 'page' | 'main' = 'page'): CommandInfo {
  const [plugin] = id.split('.');
  return { id, plugin, label: `${id} label`, group: 'g', runsIn };
}

function schema(defaultBinds: KeyBind[], app: AcceleratorBind[]) {
  return {
    sections: [],
    commands: {
      'p.a': command('p.a'),
      'p.b': command('p.b'),
      'p.c': command('p.c'),
      'p.d': command('p.d'),
      'p.e': command('p.e'),
      'p.menu': command('p.menu', 'main'),
    },
    scopes: [{ id: 'p.s', title: 'In p', plugin: 'p' }],
    defaultBindLayers: [defaultBinds],
    defaultAccelerators: { app, global: [], intercept: [] },
    defaultLeader: '<Space>',
  } satisfies UserConfigSchema;
}

// A row context over the schema and keymap layer; the input reads nothing
// else.
function context(given: UserConfigSchema, layer: UserKeymap): RowContext {
  const unread = () => {
    throw new Error('not read by keyRowInput');
  };
  return {
    schema: given,
    platform: 'macos',
    read: unread,
    settingsLayer: unread,
    keymapLayer: () => layer,
    openBox: unread,
    closeBox: unread,
    boxProblem: unread,
    openPicker: unread,
    commitSettings: unread,
    commitKeymap: unread,
    toast: unread,
  };
}

describe('keyRowInput', () => {
  const given = schema(
    [
      { keys: 'x', scope: 'any', command: 'p.a' },
      { keys: 'y', scope: 'p.s', command: 'p.b' },
    ],
    [{ accelerator: 'CommandOrControl+,', command: 'p.menu' }],
  );
  const layer: UserKeymap = {
    binds: [
      { keys: 'y', scope: 'p.s', command: 'p.d' },
      { keys: 'z', scope: 'p.s', command: 'p.c', where: 'box' },
    ],
    unbind: [{ app: 'CommandOrControl+,' }],
  };
  const ctx = context(given, layer);
  const rows = keymapRows(given, layer).flatMap((group) => group.rows);
  const lines = (id: string) =>
    keyRowInput(
      ctx,
      rows.find((row) => row.command.id === id)!,
    ).lines.map(({ kind, tags, isStruck }) => ({ kind, tags, isStruck }));

  it.each([
    {
      case: 'a default bind in scope any',
      id: 'p.a',
      expected: [{ kind: 'bind', tags: ['Everywhere'], isStruck: false }],
    },
    {
      case: "a user bind's where and Set",
      id: 'p.c',
      expected: [
        { kind: 'bind', tags: ['In p', 'box', 'Set'], isStruck: false },
      ],
    },
    {
      case: 'a default bind a user bind displaced',
      id: 'p.b',
      expected: [
        {
          kind: 'bind',
          tags: ['In p', 'Replaced by p.d label'],
          isStruck: true,
        },
      ],
    },
    {
      case: 'an unbound default app accelerator',
      id: 'p.menu',
      expected: [
        { kind: 'accelerator', tags: ['App menu', 'Removed'], isStruck: true },
      ],
    },
    { case: 'a command with no binds', id: 'p.e', expected: [] },
  ])('lists the lines of $case', ({ id, expected }) => {
    expect(lines(id)).toEqual(expected);
  });
});
