import { describe, expect, it } from 'vitest';
import { type KeymapNames, parseUserKeymap } from './user-keymap';

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
  },
  scopes: [
    { id: 'any', title: 'Everywhere', plugin: 'core' },
    { id: 'test.list', title: 'List', plugin: 'test' },
  ],
  defaultLeader: '<Space>',
};

function parse(keymap: unknown) {
  return parseUserKeymap(JSON.stringify(keymap), NAMES);
}

describe('parseUserKeymap', () => {
  it('rejects an unbind naming a scope no plugin declares', () => {
    expect(() =>
      parse({ unbind: [{ keys: 'x', scope: 'test.nowhere' }] }),
    ).toThrow('"unbind[0].scope" names no scope "test.nowhere".');
  });

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

    expect(() => parse({ binds })).toThrow(
      '"binds[0].keys" is "<C-a>"; an insert bind takes <CR>.',
    );
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

  it('parseUserKeymap_OldPageSection_NamesTheNewSection', () => {
    expect(() =>
      parse({ page: [{ keys: ['x'], scope: 'any', command: 'test.pick' }] }),
    ).toThrow(
      '"page" is an old keymap section: write its binds under "binds" in vim notation.',
    );
  });

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

    expect(() => parse({ unbind })).toThrow(
      '"unbind[0]": x has a mode, so it fires in a box only; it takes no where "page".',
    );
  });

  it('parseUserKeymap_OldEditorSection_NamesTheNewSection', () => {
    expect(() =>
      parse({ editor: [{ keys: ['x'], scope: 'any', command: 'test.pick' }] }),
    ).toThrow(
      '"editor" is an old keymap section: write its binds under "binds" in vim notation.',
    );
  });

  it('parseUserKeymap_OldSectionAfterUnknownSection_NamesTheOldSection', () => {
    expect(() => parse({ foo: 1, page: [] })).toThrow(
      '"page" is an old keymap section: write its binds under "binds" in vim notation.',
    );
  });

  it('parseUserKeymap_OldPageUnbind_NamesTheKeysField', () => {
    const unbind = [{ page: ['j'], scope: 'test.list' }];

    expect(() => parse({ unbind })).toThrow(
      '"unbind[0]" is an old unbind: name its keys in vim notation under "keys".',
    );
  });

  it('parseUserKeymap_OldEditorUnbind_NamesTheKeysField', () => {
    const unbind = [
      { keys: 'x', scope: 'any' },
      { editor: 'x', scope: 'any' },
    ];

    expect(() => parse({ unbind })).toThrow(
      '"unbind[1]" is an old unbind: name its keys in vim notation under "keys".',
    );
  });

  it('parseUserKeymap_UnknownWhere_Throws', () => {
    const binds = [
      { keys: 'x', scope: 'any', command: 'test.pick', where: 'nowhere' },
    ];

    expect(() => parse({ binds })).toThrow(
      '"binds[0].where" must be one of page, box, both, not "nowhere".',
    );
  });

  it('parseUserKeymap_GroupKeyWithoutLeader_Throws', () => {
    expect(() => parse({ groups: { k: 'windows' } })).toThrow(
      '"groups.k" must start with <Leader>.',
    );
  });

  it('parseUserKeymap_UnknownToken_NamesEntryPath', () => {
    const binds = [{ keys: '<F5>', scope: 'any', command: 'test.pick' }];

    expect(() => parse({ binds })).toThrow(
      '"binds[0]": <F5> is not a key the page can bind.',
    );
  });

  it('parseUserKeymap_ChordLeader_Throws', () => {
    expect(() => parse({ leader: '<A-o>' })).toThrow(
      '"leader" must be one key, such as "<Space>" or ",".',
    );
  });

  it.each(['<', '<lt>'])(
    'parseUserKeymap_LessThanLeader_Throws (%s)',
    (written) => {
      expect(() => parse({ leader: written })).toThrow(
        '"leader" must be one key, such as "<Space>" or ",".',
      );
    },
  );

  it('parseUserKeymap_TwoKeyLeader_Throws', () => {
    expect(() => parse({ leader: 'ab' })).toThrow(
      '"leader" must be one key, such as "<Space>" or ",".',
    );
  });

  it('keeps a leader of one key and groups under the leader', () => {
    const keymap = { leader: ',', groups: { '<Leader>k': 'panes' } };

    expect(parse(keymap)).toEqual(keymap);
  });

  it('parseUserKeymap_LowercaseNamedLeader_SpellsItAsVimReportsIt', () => {
    expect(parse({ leader: '<space>' }).leader).toBe('<Space>');
  });

  it.each([
    ['<Bslash>', '\\'],
    ['\\', '\\'],
    ['<Bar>', '|'],
    ['|', '|'],
  ])(
    'parseUserKeymap_LeaderTypingOneCharacter_StoresTheCharacter (%s)',
    (written, stored) => {
      expect(parse({ leader: written }).leader).toBe(stored);
    },
  );

  it('rejects two app binds on one chord spelled two ways', () => {
    const app = [
      { accelerator: 'Cmd+Shift+K', command: 'test.open' },
      { accelerator: 'shift+command+k', command: 'test.open' },
    ];

    expect(() => parse({ app })).toThrow(
      '"app[1]" binds shift+command+k, the same chord as "app[0]" (Cmd+Shift+K).',
    );
  });

  it('keeps global binds on CommandOrControl and Command apart', () => {
    const global = [
      { accelerator: 'CommandOrControl+K', command: 'test.open' },
      { accelerator: 'Command+K', command: 'test.open' },
    ];

    expect(parse({ global }).global).toEqual(global);
  });
});
