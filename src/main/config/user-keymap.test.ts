import { describe, expect, it } from 'vitest';
import {
  heldBackUserBinds,
  type KeymapNames,
  parseUserKeymap,
} from './user-keymap';

const NAMES: KeymapNames = {
  commands: {
    'test.pick': {
      id: 'test.pick',
      plugin: 'test',
      label: 'Pick',
      group: 'Test',
      runsIn: 'page',
    },
    'test.open': {
      id: 'test.open',
      plugin: 'test',
      label: 'Open',
      group: 'Test',
      runsIn: 'main',
    },
    'test.nth': {
      id: 'test.nth',
      plugin: 'test',
      label: 'Nth',
      group: 'Test',
      runsIn: 'page',
      arg: 'number',
    },
  },
  scopes: [
    { id: 'any', title: 'Everywhere', plugin: 'core' },
    { id: 'test.list', title: 'List', plugin: 'test' },
  ],
  plugins: ['test'],
  defaultLeader: '<Space>',
};

function parse(keymap: unknown) {
  return parseUserKeymap(JSON.stringify(keymap), NAMES);
}

describe('parseUserKeymap', () => {
  it.each([
    {
      case: "unbind in a loaded plugin's undeclared scope",
      keymap: { unbind: [{ keys: 'x', scope: 'test.nowhere' }] },
      text: '"unbind[0].scope" names no scope "test.nowhere".',
    },
    {
      case: 'unbind in an undotted scope',
      keymap: { unbind: [{ keys: 'x', scope: 'ayn' }] },
      text: '"unbind[0].scope" names no scope "ayn".',
    },
    {
      case: 'bind in an undotted scope',
      keymap: { binds: [{ keys: 'x', scope: 'ayn', command: 'test.pick' }] },
      text: '"binds[0].scope" names no scope "ayn".',
    },
  ])(
    'parseUserKeymap_ScopeOfNoAbsentPlugin_Throws: $case',
    ({ keymap, text }) => {
      expect(() => parse(keymap)).toThrow(text);
    },
  );

  it('keeps an unbind in a declared scope, the any scope included', () => {
    const unbind = [
      { keys: 'x', scope: 'test.list' },
      { keys: '<Leader>x', scope: 'any', where: 'box' },
    ];

    expect(parse({ unbind }).unbind).toEqual(unbind);
  });

  it('keeps a bind with its where and mode', () => {
    const binds = [
      { keys: '<Leader>p', scope: 'test.list', command: 'test.pick' },
      { keys: '<Esc>', scope: 'any', command: 'test.pick', where: 'box' },
      { keys: 'gg', scope: 'any', command: 'test.pick', mode: 'normal' },
    ];

    expect(parse({ binds }).binds).toEqual(binds);
  });

  it('rejects an insert bind on a key the editor cannot type unbound', () => {
    const binds = [
      {
        keys: '<C-a>',
        scope: 'test.list',
        command: 'test.pick',
        mode: 'insert',
      },
    ];

    expect(() => parse({ binds })).toThrow(/binds\[0\]\.keys.*<C-a>/);
  });

  it('keeps an insert bind on <CR>', () => {
    const binds = [
      {
        keys: '<CR>',
        scope: 'test.list',
        command: 'test.pick',
        mode: 'insert',
      },
    ];

    expect(parse({ binds }).binds).toEqual(binds);
  });

  it.each(['page', 'editor'])(
    'parseUserKeymap_OldSection_NamesItAsOld (%s)',
    (section) => {
      expect(() =>
        parse({
          [section]: [{ keys: ['x'], scope: 'any', command: 'test.pick' }],
        }),
      ).toThrow(`"${section}"`);
    },
  );

  it('parseUserKeymap_ModeWithWherePage_Throws', () => {
    const binds = [
      {
        keys: 'x',
        scope: 'any',
        command: 'test.pick',
        mode: 'normal',
        where: 'page',
      },
    ];

    expect(() => parse({ binds })).toThrow(/^"binds\[0\]": .*where "page"/);
  });

  it('parseUserKeymap_UnbindModeWithWherePage_Throws', () => {
    const unbind = [{ keys: 'x', scope: 'any', mode: 'normal', where: 'page' }];

    expect(() => parse({ unbind })).toThrow(/unbind\[0\].*where "page"/);
  });

  it('parseUserKeymap_OldSectionAfterUnknownSection_NamesTheOldSection', () => {
    expect(() => parse({ foo: 1, page: [] })).toThrow('"page"');
  });

  it.each([
    { unbind: [{ page: ['j'], scope: 'test.list' }], path: 'unbind[0]' },
    {
      unbind: [
        { keys: 'x', scope: 'any' },
        { editor: 'x', scope: 'any' },
      ],
      path: 'unbind[1]',
    },
  ])('parseUserKeymap_OldUnbind_NamesItsPath ($path)', ({ unbind, path }) => {
    expect(() => parse({ unbind })).toThrow(`"${path}"`);
  });

  it('parseUserKeymap_UnknownWhere_Throws', () => {
    const binds = [
      { keys: 'x', scope: 'any', command: 'test.pick', where: 'nowhere' },
    ];

    expect(() => parse({ binds })).toThrow(/binds\[0\]\.where.*nowhere/);
  });

  it('parseUserKeymap_GroupKeyWithoutLeader_Throws', () => {
    expect(() => parse({ groups: { k: 'windows' } })).toThrow('"groups.k"');
  });

  it('parseUserKeymap_UnknownToken_NamesEntryPath', () => {
    const binds = [{ keys: '<F13>', scope: 'any', command: 'test.pick' }];

    expect(() => parse({ binds })).toThrow(/binds\[0\].*<F13>/);
  });

  it.each(['<A-o>', '<', '<lt>', 'ab', '<Tab>', '<tab>'])(
    'parseUserKeymap_LeaderNotOneKey_Throws (%s)',
    (written) => {
      expect(() => parse({ leader: written })).toThrow('"leader"');
    },
  );

  it('keeps a leader of one key and groups under the leader', () => {
    const keymap = { leader: ',', groups: { '<Leader>k': 'panes' } };

    expect(parse(keymap)).toEqual(keymap);
  });

  it.each([
    ['<space>', '<Space>'],
    ['<Bslash>', '\\'],
    ['\\', '\\'],
    ['<Bar>', '|'],
    ['|', '|'],
  ])(
    'parseUserKeymap_Leader_StoredAsVimSpellsIt (%s → %s)',
    (written, stored) => {
      expect(parse({ leader: written }).leader).toBe(stored);
    },
  );

  it('rejects two app binds on one chord spelled two ways', () => {
    const app = [
      { accelerator: 'Cmd+Shift+K', command: 'test.open' },
      { accelerator: 'shift+command+k', command: 'test.open' },
    ];

    expect(() => parse({ app })).toThrow(/app\[1\].*app\[0\]/);
  });

  it('keeps global binds on CommandOrControl and Command apart', () => {
    const global = [
      { accelerator: 'CommandOrControl+K', command: 'test.open' },
      { accelerator: 'Command+K', command: 'test.open' },
    ];

    expect(parse({ global }).global).toEqual(global);
  });

  it.each([
    {
      case: 'page bind',
      keymap: {
        binds: [{ keys: 'x', scope: 'any', command: 'test.nth', arg: 'a' }],
      },
      text: '"binds[0].arg": command "test.nth" needs a number.',
    },
    {
      case: 'no-arg command',
      keymap: {
        binds: [{ keys: 'x', scope: 'any', command: 'test.pick', arg: 1 }],
      },
      text: '"binds[0].arg": command "test.pick" takes no argument.',
    },
    {
      case: 'app bind',
      keymap: { app: [{ accelerator: 'Alt+K', command: 'test.open', arg: 1 }] },
      text: '"app[0].arg": command "test.open" takes no argument.',
    },
  ])('parseUserKeymap_KnownCommandBadArg_Throws: $case', ({ keymap, text }) => {
    expect(() => parse(keymap)).toThrow(text);
  });

  it('parseUserKeymap_ArgOnUnbind_Throws', () => {
    expect(() =>
      parse({ unbind: [{ keys: 'x', scope: 'any', arg: 1 }] }),
    ).toThrow(/arg/);
  });

  it('parseUserKeymap_FittingArg_KeepsIt', () => {
    const binds = [{ keys: 'x', scope: 'any', command: 'test.nth', arg: 2 }];

    expect(parse({ binds }).binds).toEqual(binds);
  });

  it('parseUserKeymap_UnknownCommand_KeepsTheBind', () => {
    const binds = [
      { keys: 'x', scope: 'any', command: 'later.go', arg: 1 },
      { keys: 'y', scope: 'gone.main', command: 'gone.run' },
    ];
    const app = [{ accelerator: 'Alt+K', command: 'later.main' }];
    const unbind = [{ keys: 'z', scope: 'gone.main' }];

    const parsed = parse({ binds, app, unbind });

    expect(parsed.binds).toEqual(binds);
    expect(parsed.app).toEqual(app);
    expect(parsed.unbind).toEqual(unbind);
  });

  it('heldBackUserBinds_UnknownWrongProcessBadArgUndotted_DropsWithPathInText', () => {
    const info = (id: string, runsIn: 'page' | 'main', arg?: 'number') => ({
      id,
      plugin: 'later',
      label: id,
      group: 'g',
      runsIn,
      runtime: true as const,
      ...(arg && { arg }),
    });
    const fixed = NAMES.commands;
    const names: KeymapNames = {
      ...NAMES,
      commands: {
        ...fixed,
        'later.good': info('later.good', 'page'),
        'later.main': info('later.main', 'main'),
        'later.nth': info('later.nth', 'page', 'number'),
      },
    };
    const keep = { keys: 'a', scope: 'any', command: 'test.pick' };
    const good = { keys: 'b', scope: 'any', command: 'later.good' };
    const gone = { keys: 'c', scope: 'any', command: 'later.gone' };
    const wrong = { keys: 'd', scope: 'any', command: 'later.main' };
    const badArg = { keys: 'e', scope: 'any', command: 'later.nth' };
    const goneApp = { accelerator: 'Alt+K', command: 'later.gone' };
    const absentPlugin = { keys: 'f', scope: 'any', command: 'gone.run' };
    const absentScope = { keys: 'g', scope: 'gone.main', command: 'test.pick' };
    const absentUnbind = { keys: 'h', scope: 'gone.main' };
    const undotted = { keys: 'i', scope: 'any', command: 'save' };

    const { kept, retained, problems, ignored } = heldBackUserBinds(
      {
        binds: [
          keep,
          good,
          gone,
          wrong,
          badArg,
          absentPlugin,
          absentScope,
          undotted,
        ],
        app: [goneApp],
        unbind: [absentUnbind],
      },
      names,
      fixed,
    );

    expect(kept).toEqual({ binds: [keep, good], app: [], unbind: [] });
    expect(retained).toEqual({
      binds: [keep, good, absentPlugin, absentScope],
      app: [],
      unbind: [absentUnbind],
    });
    expect(ignored).toEqual([
      'keymap.json binds[5] names plugin "gone", which is not loaded; kept and ignored',
      'keymap.json binds[6] names plugin "gone", which is not loaded; kept and ignored',
      'keymap.json unbind[0] names plugin "gone", which is not loaded; kept and ignored',
    ]);
    expect(problems).toEqual([
      '"binds[2].command" names no command "later.gone".',
      expect.stringMatching(/^"binds\[3\]\.command" names "later\.main"/),
      '"binds[4].arg": command "later.nth" needs a number.',
      '"binds[7].command" names no command "save".',
      '"app[0].command" names no command "later.gone".',
    ]);
  });
});
