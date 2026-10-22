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
});
