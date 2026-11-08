import { describe, expect, it } from 'vitest';
import type {
  AcceleratorBind,
  InterceptBind,
  KeyBind,
  UserKeymap,
} from '../../../contracts/keymap';
import type { CommandInfo } from '../../../contracts/plugin';
import type { UserConfigSchema } from '../../../contracts/user-config';
import {
  type BindLine,
  coverTexts,
  keymapRows,
  replacedBy,
  type CommandRow,
} from './keymap-rows';

function command(id: string, runsIn: 'page' | 'main' = 'page'): CommandInfo {
  const [plugin] = id.split('.');
  return { id, plugin, label: `${id} label`, group: 'g', runsIn };
}

function schema(
  commands: CommandInfo[],
  defaultBinds: KeyBind[],
  app: AcceleratorBind[] = [],
  intercept: InterceptBind[] = [],
): UserConfigSchema {
  return {
    sections: [],
    commands: Object.fromEntries(commands.map((info) => [info.id, info])),
    scopes: [],
    defaultBindLayers: [defaultBinds],
    defaultAccelerators: { app, global: [], intercept },
    defaultLeader: '<Space>',
  };
}

function ids(rows: readonly CommandRow[]): string[] {
  return rows.map((each) => each.command.id);
}

function labels(rows: readonly CommandRow[]): string[] {
  return rows.map((each) => each.label);
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

    expect(row(groups, 'p.a').binds[0]).toMatchObject({
      page: { state: 'removed' },
      editor: null,
    });
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
      page: { state: 'replaced', by: userBind },
    });
    expect(row(groups, 'p.b').binds).toEqual([
      {
        bind: userBind,
        origin: 'user',
        page: { state: 'active' },
        editor: null,
      },
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
      { kind: 'app', bind: show, state: 'active', replacedBy: null },
    ]);
  });

  it('keymapRows_UserAcceleratorOnDefaultsKeys_MarksDefaultReplaced', () => {
    const show = { accelerator: 'CommandOrControl+,', command: 'p.a' };
    const given = schema([command('p.a', 'main')], [], [show]);

    const groups = keymapRows(given, {
      app: [{ accelerator: 'CmdOrCtrl+,', command: 'p.b' }],
    });

    expect(row(groups, 'p.a').accelerators).toEqual([
      { kind: 'app', bind: show, state: 'replaced', replacedBy: 'p.b' },
    ]);
  });

  it('keymapRows_UserInterceptOnDefaultsChord_MarksDefaultReplaced', () => {
    const tab = { key: 'Tab', control: true, command: 'p.a' };
    const given = schema([command('p.a', 'main')], [], [], [tab]);

    const groups = keymapRows(given, {
      intercept: [{ key: 'Tab', control: true, shift: false, command: 'p.b' }],
    });

    expect(row(groups, 'p.a').accelerators).toEqual([
      { kind: 'intercept', bind: tab, state: 'replaced', replacedBy: 'p.b' },
    ]);
  });

  it('keymapRows_UnbindAndUserAccelerator_MarksDefaultRemoved', () => {
    const show = { accelerator: 'CommandOrControl+,', command: 'p.a' };
    const given = schema([command('p.a', 'main')], [], [show]);

    const groups = keymapRows(given, {
      unbind: [{ app: 'CommandOrControl+,' }],
      app: [{ accelerator: 'CommandOrControl+,', command: 'p.b' }],
    });

    expect(row(groups, 'p.a').accelerators[0].state).toBe('removed');
  });
});

describe('replacedBy', () => {
  it('replacedBy_EnterSpellingOfDefaultsCR_NamesDefaultsCommand', () => {
    const given = schema(
      [command('p.a')],
      [{ keys: 'g<CR>', scope: 'p.s', command: 'p.a' }],
    );

    expect(ids(replacedBy(given, null, 'g<Enter>', 'p.s', 'p.z'))).toEqual([
      'p.a',
    ]);
  });

  it('replacedBy_RemovedDefault_NamesNone', () => {
    const given = schema(
      [command('p.a')],
      [{ keys: 'x', scope: 'p.s', command: 'p.a' }],
    );
    const layer = { unbind: [{ keys: 'x', scope: 'p.s' }] };

    expect(replacedBy(given, layer, 'x', 'p.s', 'p.z')).toEqual([]);
  });

  it('replacedBy_KeysThePageCannotBind_NamesNone', () => {
    const given = schema(
      [command('p.a')],
      [{ keys: 'x', scope: 'p.s', command: 'p.a' }],
    );

    expect(replacedBy(given, null, '<Nope>', 'p.s', 'p.z')).toEqual([]);
  });

  it('replacedBy_DefaultHalfAndUserBindOnOtherHalf_NamesBoth', () => {
    const given = schema(
      [command('p.a'), command('p.b')],
      [{ keys: '<Leader>x', scope: 'p.s', command: 'p.a' }],
    );
    const layer = {
      binds: [
        {
          keys: '<Leader>x',
          scope: 'p.s',
          command: 'p.b',
          where: 'page' as const,
        },
      ],
    };

    expect(ids(replacedBy(given, layer, '<Leader>x', 'p.s', 'p.z'))).toEqual([
      'p.a',
      'p.b',
    ]);
  });

  it('replacedBy_KeysTheCommandsOwnDefaultHolds_LeavesTheCommandOut', () => {
    const given = schema(
      [command('p.a'), command('p.b')],
      [{ keys: '<Leader>x', scope: 'p.s', command: 'p.a' }],
    );
    const layer = {
      binds: [
        {
          keys: '<Leader>x',
          scope: 'p.s',
          command: 'p.b',
          where: 'page' as const,
        },
      ],
    };

    expect(ids(replacedBy(given, layer, '<Leader>x', 'p.s', 'p.a'))).toEqual([
      'p.b',
    ]);
  });

  it('replacedBy_PluginDefaultOverCoreDefault_NamesPluginCommand', () => {
    const given = {
      ...schema([command('core.a'), command('p.b')], []),
      defaultBindLayers: [
        [{ keys: 'x', scope: 'p.s', command: 'core.a' }],
        [{ keys: 'x', scope: 'p.s', command: 'p.b' }],
      ],
    };

    expect(ids(replacedBy(given, null, 'x', 'p.s', 'p.z'))).toEqual(['p.b']);
  });
});

describe('keymapRows default layers', () => {
  it('keymapRows_PluginDefaultOverCoreDefault_DropsCoreLine', () => {
    const given = {
      ...schema([command('core.a'), command('p.b')], []),
      defaultBindLayers: [
        [{ keys: 'x', scope: 'p.s', command: 'core.a' }],
        [{ keys: 'x', scope: 'p.s', command: 'p.b' }],
      ],
    };

    const groups = keymapRows(given, null);

    expect(row(groups, 'core.a').binds).toEqual([]);
    expect(row(groups, 'p.b').binds).toHaveLength(1);
  });
});

describe('coverTexts', () => {
  const bind = { keys: '<Leader>x', scope: 's', command: 'a' };
  const label = (id: string) => `${id} label`;
  const removed = { state: 'removed', by: { keys: 'x', scope: 's' } } as const;
  const replaced = {
    state: 'replaced',
    by: { keys: 'x', scope: 's', command: 'b' },
  } as const;
  const active = { state: 'active' } as const;
  const line = (
    page: BindLine['page'],
    editor: BindLine['editor'],
  ): BindLine => ({ bind, origin: 'default', page, editor });

  it.each([
    { page: active, editor: active, expected: [] },
    { page: removed, editor: null, expected: [expect.any(String)] },
    {
      page: replaced,
      editor: replaced,
      expected: [expect.stringContaining('b label')],
    },
    {
      page: removed,
      editor: replaced,
      expected: [expect.any(String), expect.stringContaining('b label')],
    },
    {
      page: removed,
      editor: active,
      expected: [expect.any(String)],
    },
    {
      page: active,
      editor: replaced,
      expected: [expect.stringContaining('b label')],
    },
  ])(
    'coverTexts with page $page.state and editor $editor.state gives $expected.length texts',
    ({ page, editor, expected }) => {
      expect(coverTexts(line(page, editor), label)).toEqual(expected);
    },
  );
});

describe('a command with an argument', () => {
  const pick: CommandInfo = { ...command('p.pick'), arg: 'number' };
  const argsOf = (groups: ReturnType<typeof keymapRows>) =>
    groups
      .flatMap((group) => group.rows)
      .filter((each) => each.command.id === 'p.pick')
      .map((each) => each.arg);

  const place: CommandInfo = {
    ...command('p.place'),
    arg: { pool: 'string', clone: 'number' },
  };
  it.each<{
    row: string;
    commands: CommandInfo[];
    defaults: KeyBind[];
    layer: UserKeymap | null;
    rows: { arg: unknown; label: string; keys: string[] }[];
  }>([
    {
      row: 'two bound args',
      commands: [pick],
      defaults: [
        { keys: '1', scope: 'p.s', command: 'p.pick', arg: 1 },
        { keys: '2', scope: 'p.s', command: 'p.pick', arg: 2 },
        { keys: 'x', scope: 'p.s', command: 'p.pick', arg: 1 },
      ],
      layer: null,
      rows: [
        { arg: 1, label: 'p.pick label: 1', keys: ['1', 'x'] },
        { arg: 2, label: 'p.pick label: 2', keys: ['2'] },
      ],
    },
    { row: 'unbound', commands: [pick], defaults: [], layer: null, rows: [] },
    {
      row: 'a record arg in both field orders',
      commands: [place],
      defaults: [
        {
          keys: 'a',
          scope: 'p.s',
          command: 'p.place',
          arg: { pool: 'q', clone: 3 },
        },
      ],
      layer: {
        binds: [
          {
            keys: 'b',
            scope: 'p.s',
            command: 'p.place',
            arg: { clone: 3, pool: 'q' },
          },
        ],
      },
      rows: [
        {
          arg: { pool: 'q', clone: 3 },
          label: 'p.place label: clone 3, pool q',
          keys: ['a', 'b'],
        },
      ],
    },
    {
      row: 'a default the user unbound',
      commands: [pick],
      defaults: [{ keys: '4', scope: 'p.s', command: 'p.pick', arg: 4 }],
      layer: { unbind: [{ keys: '4', scope: 'p.s' }] },
      rows: [{ arg: 4, label: 'p.pick label: 4', keys: ['4'] }],
    },
  ])(
    'keymapRows_ArgCommand_OneRowPerBoundArgAndNoneWhenUnbound: $row',
    ({ commands, defaults, layer, rows }) => {
      const groups = keymapRows(schema(commands, defaults), layer);

      expect(
        groups
          .flatMap((group) => group.rows)
          .map((each) => ({
            arg: each.arg,
            label: each.label,
            keys: each.binds.map((line) => line.bind.keys),
          })),
      ).toEqual(rows);
    },
  );

  it('keymapRows_ArgCommand_UserLineGivesARow', () => {
    const groups = keymapRows(schema([pick], []), {
      binds: [{ keys: '7', scope: 'p.s', command: 'p.pick', arg: 7 }],
    });

    expect(argsOf(groups)).toEqual([7]);
  });

  it('keymapRows_ArgCommand_AcceleratorGivesARow', () => {
    const mainPick: CommandInfo = { ...pick, runsIn: 'main' };
    const groups = keymapRows(
      schema(
        [mainPick],
        [],
        [{ accelerator: 'Alt+K', command: 'p.pick', arg: 4 }],
      ),
      null,
    );

    expect(argsOf(groups)).toEqual([4]);
  });

  it('replacedBy_ArgCommand_NamesEachArgRow', () => {
    const defaults = [
      {
        keys: '<Leader>x',
        scope: 'p.s',
        command: 'p.pick',
        arg: 1,
        where: 'page' as const,
      },
      {
        keys: '<Leader>x',
        scope: 'p.s',
        command: 'p.pick',
        arg: 2,
        where: 'box' as const,
      },
    ];

    expect(
      labels(
        replacedBy(schema([pick], defaults), null, '<Leader>x', 'p.s', 'p.z'),
      ),
    ).toEqual(['p.pick label: 1', 'p.pick label: 2']);
  });

  it('replacedBy_SameCommandOtherArg_ReportsTheDisplacedRow', () => {
    const defaults = [
      { keys: '2', scope: 'p.s', command: 'p.pick', arg: 2 },
      { keys: '3', scope: 'p.s', command: 'p.pick', arg: 3 },
    ];
    const withPick = schema([pick], defaults);

    expect(labels(replacedBy(withPick, null, '3', 'p.s', 'p.pick', 2))).toEqual(
      ['p.pick label: 3'],
    );
    expect(replacedBy(withPick, null, '3', 'p.s', 'p.pick', 3)).toEqual([]);
  });
});
