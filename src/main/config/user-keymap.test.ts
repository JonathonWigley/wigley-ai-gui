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
};

function parse(keymap: unknown) {
  return parseUserKeymap(JSON.stringify(keymap), NAMES);
}

describe('parseUserKeymap', () => {
  it('rejects an unbind naming a scope no plugin declares', () => {
    expect(() =>
      parse({ unbind: [{ page: ['x'], scope: 'test.nowhere' }] }),
    ).toThrow('"unbind[0].scope" names no scope "test.nowhere".');
  });

  it('rejects an editor unbind naming a scope no plugin declares', () => {
    expect(() =>
      parse({ unbind: [{ editor: 'x', scope: 'nowhere' }] }),
    ).toThrow('"unbind[0].scope" names no scope "nowhere".');
  });

  it('keeps an unbind in a declared scope, the any scope included', () => {
    const unbind = [
      { page: ['x'], scope: 'test.list' },
      { editor: 'x', scope: 'any' },
    ];

    expect(parse({ unbind }).unbind).toEqual(unbind);
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

    expect(() => parse({ editor: { binds } })).toThrow(
      '"editor.binds[0].keys" is "<C-a>"; an insert bind takes <CR>.',
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

    expect(parse({ editor: { binds } }).editor?.binds).toEqual(binds);
  });

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
