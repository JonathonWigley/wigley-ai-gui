import { describe, expect, it } from 'vitest';
import type {
  AcceleratorBind,
  InterceptBind,
  KeyBind,
} from '../../../contracts/keymap';
import type { CommandInfo } from '../../../contracts/plugin';
import type { UserConfigSchema } from '../../../contracts/user-config';
import {
  andList,
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

function ids(commands: readonly CommandInfo[]): string[] {
  return commands.map((info) => info.id);
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

    expect(ids(replacedBy(given, null, 'g<Enter>', 'p.s'))).toEqual(['p.a']);
  });

  it('replacedBy_RemovedDefault_NamesNone', () => {
    const given = schema(
      [command('p.a')],
      [{ keys: 'x', scope: 'p.s', command: 'p.a' }],
    );
    const layer = { unbind: [{ keys: 'x', scope: 'p.s' }] };

    expect(replacedBy(given, layer, 'x', 'p.s')).toEqual([]);
  });

  it('replacedBy_KeysThePageCannotBind_NamesNone', () => {
    const given = schema(
      [command('p.a')],
      [{ keys: 'x', scope: 'p.s', command: 'p.a' }],
    );

    expect(replacedBy(given, null, '<Nope>', 'p.s')).toEqual([]);
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

    expect(ids(replacedBy(given, layer, '<Leader>x', 'p.s'))).toEqual([
      'p.a',
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

    expect(ids(replacedBy(given, null, 'x', 'p.s'))).toEqual(['p.b']);
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

  it('coverTexts_EveryHalfActive_IsEmpty', () => {
    expect(coverTexts(line(active, active), label)).toEqual([]);
  });

  it('coverTexts_OnlyHalfRemoved_IsRemoved', () => {
    expect(coverTexts(line(removed, null), label)).toEqual(['Removed']);
  });

  it('coverTexts_BothHalvesReplacedBySameCommand_NamesItOnce', () => {
    expect(coverTexts(line(replaced, replaced), label)).toEqual([
      'Replaced by b label',
    ]);
  });

  it('coverTexts_OneHalfRemovedOtherReplaced_NamesBoth', () => {
    expect(coverTexts(line(removed, replaced), label)).toEqual([
      'Removed',
      'Replaced by b label',
    ]);
  });

  it('coverTexts_PageRemovedEditorActive_IsPartlyRemoved', () => {
    expect(coverTexts(line(removed, active), label)).toEqual([
      'Partly removed — still fires in the editor',
    ]);
  });

  it('coverTexts_PageActiveEditorReplaced_IsPartlyReplaced', () => {
    expect(coverTexts(line(active, replaced), label)).toEqual([
      'Partly replaced by b label — still fires on the page',
    ]);
  });
});

describe('andList', () => {
  it('andList_JoinsLabelsAsProse', () => {
    expect(andList(['A'])).toBe('A');
    expect(andList(['A', 'B'])).toBe('A and B');
    expect(andList(['A', 'B', 'C'])).toBe('A, B and C');
  });
});
