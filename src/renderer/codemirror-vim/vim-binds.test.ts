import { describe, expect, it } from 'vitest';
import type { EditorBind, EditorKeymap } from '../../contracts/keymap';
import { exBindName } from './ex-command-name';
import { appliedMappings, bindGroups, vimrcLines } from './vim-binds';

function bind(keys: string, command: string): EditorBind {
  return { keys, scope: 'any', command };
}

function keymap(binds: EditorBind[]): EditorKeymap {
  return {
    leader: '<Space>',
    remaps: [
      { mode: 'insert', keys: 'jk', to: '<Esc>' },
      { mode: 'normal', keys: '<Leader>w', to: ':w' },
    ],
    binds,
  };
}

describe('bindGroups', () => {
  it('groups binds whose keys match once the leader is spelled out', () => {
    const one = bind('<Leader>x', 'a.one');
    const two = bind('<Space>x', 'a.two');

    expect(bindGroups(keymap([one, two]))).toEqual([
      { mode: 'normal', keys: '<Space>x', binds: [one, two] },
    ]);
  });

  it('orders groups by first appearance and binds by keymap order', () => {
    const first = bind('gx', 'a.first');
    const second = bind('<Leader>y', 'a.second');
    const third = bind('gx', 'a.third');

    expect(bindGroups(keymap([first, second, third]))).toEqual([
      { mode: 'normal', keys: 'gx', binds: [first, third] },
      { mode: 'normal', keys: '<Space>y', binds: [second] },
    ]);
  });

  it('keeps an insert bind apart from a normal bind on the same keys', () => {
    const normal = bind('<CR>', 'a.normal');
    const insert: EditorBind = { ...bind('<CR>', 'a.insert'), mode: 'insert' };

    expect(bindGroups(keymap([normal, insert]))).toEqual([
      { mode: 'normal', keys: '<CR>', binds: [normal] },
      { mode: 'insert', keys: '<CR>', binds: [insert] },
    ]);
  });
});

describe('vimrcLines', () => {
  it('unmaps the leader, then maps each remap, then each group to its ex command', () => {
    const map = keymap([bind('gx', 'a.one'), bind('<Leader>y', 'a.two')]);

    expect(vimrcLines(map, bindGroups(map), true)).toEqual([
      'unmap <Space>',
      'inoremap jk <Esc>',
      'nnoremap <Space>w :w',
      `nnoremap gx :${exBindName(0)}<CR>`,
      `nnoremap <Space>y :${exBindName(1)}<CR>`,
    ]);
  });

  it('maps no insert group, keeping each normal group on its own index', () => {
    const insert: EditorBind = { ...bind('<CR>', 'a.one'), mode: 'insert' };
    const map = keymap([insert, bind('gx', 'a.two')]);

    expect(vimrcLines(map, bindGroups(map), true)).toEqual([
      'unmap <Space>',
      'inoremap jk <Esc>',
      'nnoremap <Space>w :w',
      `nnoremap gx :${exBindName(1)}<CR>`,
    ]);
  });

  it('leaves out the leader unmap when told the leader is already unmapped', () => {
    const map = keymap([bind('gx', 'a.one')]);

    expect(vimrcLines(map, bindGroups(map), false)[0]).toBe(
      'inoremap jk <Esc>',
    );
  });
});

describe('appliedMappings', () => {
  it('appliedMappings lists remaps then groups', () => {
    const map: EditorKeymap = {
      leader: '<Space>',
      remaps: [{ mode: 'normal', keys: 'Y', to: 'y$' }],
      binds: [
        bind('<Leader>a', 'a.one'),
        { ...bind('<CR>', 'a.two'), mode: 'insert' },
      ],
    };

    expect(appliedMappings(map, bindGroups(map))).toEqual([
      { keys: 'Y', mode: 'normal' },
      { keys: '<Space>a', mode: 'normal' },
      { keys: '<CR>', mode: 'insert' },
    ]);
  });
});
