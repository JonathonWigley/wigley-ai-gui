import { describe, expect, it } from 'vitest';
import type { EditorBind, EditorKeymap } from '../../contracts/keymap';
import { exBindName } from './ex-command-name';
import { bindGroups, vimrcLines } from './vim-binds';

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
      { keys: '<Space>x', binds: [one, two] },
    ]);
  });

  it('orders groups by first appearance and binds by keymap order', () => {
    const first = bind('gx', 'a.first');
    const second = bind('<Leader>y', 'a.second');
    const third = bind('gx', 'a.third');

    expect(bindGroups(keymap([first, second, third]))).toEqual([
      { keys: 'gx', binds: [first, third] },
      { keys: '<Space>y', binds: [second] },
    ]);
  });
});

describe('vimrcLines', () => {
  it('unmaps the leader, then maps each remap, then each group to its ex command', () => {
    const map = keymap([bind('gx', 'a.one'), bind('<Leader>y', 'a.two')]);

    expect(vimrcLines(map, bindGroups(map))).toEqual([
      'unmap <Space>',
      'inoremap jk <Esc>',
      'nnoremap <Space>w :w',
      `nnoremap gx :${exBindName(0)}<CR>`,
      `nnoremap <Space>y :${exBindName(1)}<CR>`,
    ]);
  });
});
