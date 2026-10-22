import { describe, expect, it } from 'vitest';
import type { Keymap, PageBind } from '../../../contracts/keymap';
import { commandOfKeysIn } from './hidden-tree-keys';

function keymapOf(page: PageBind[]): Keymap {
  return {
    editor: { leader: ' ', remaps: [], binds: [] },
    page,
    app: [],
    intercept: [],
    global: [],
    groups: {},
  };
}

describe('commandOfKeysIn', () => {
  it('runs the command the tree key runs in the doc scope', () => {
    const keymap = keymapOf([
      { keys: ['j'], scope: 'p.tree', command: 'p.treeDown' },
      { keys: ['j'], scope: 'p.doc', command: 'p.scrollDown' },
    ]);

    expect(commandOfKeysIn(keymap, 'p.treeDown', 'p.tree', 'p.doc')).toBe(
      'p.scrollDown',
    );
  });

  it('follows a key rebound on the tree side', () => {
    const keymap = keymapOf([
      { keys: ['n'], scope: 'p.tree', command: 'p.treeDown' },
      { keys: ['j'], scope: 'p.doc', command: 'p.scrollDown' },
      { keys: ['n'], scope: 'p.doc', command: 'p.nextLink' },
    ]);

    expect(commandOfKeysIn(keymap, 'p.treeDown', 'p.tree', 'p.doc')).toBe(
      'p.nextLink',
    );
  });

  it('reads an any-scope bind as firing in the doc scope', () => {
    const keymap = keymapOf([
      { keys: ['j'], scope: 'p.tree', command: 'p.treeDown' },
      { keys: ['j'], scope: 'any', command: 'q.other' },
    ]);

    expect(commandOfKeysIn(keymap, 'p.treeDown', 'p.tree', 'p.doc')).toBe(
      'q.other',
    );
  });

  it('matches a sequence on all its keys', () => {
    const keymap = keymapOf([
      { keys: ['g', 'g'], scope: 'p.tree', command: 'p.treeTop' },
      { keys: ['g', 'x'], scope: 'p.doc', command: 'p.other' },
      { keys: ['g', 'g'], scope: 'p.doc', command: 'p.docTop' },
    ]);

    expect(commandOfKeysIn(keymap, 'p.treeTop', 'p.tree', 'p.doc')).toBe(
      'p.docTop',
    );
  });

  it('runs nothing when the key is unbound in the doc scope', () => {
    const keymap = keymapOf([
      { keys: ['l'], scope: 'p.tree', command: 'p.treeOpen' },
    ]);

    expect(commandOfKeysIn(keymap, 'p.treeOpen', 'p.tree', 'p.doc')).toBe(null);
  });

  it('runs nothing when the tree command has no key in its scope', () => {
    const keymap = keymapOf([
      { keys: ['j'], scope: 'p.other', command: 'p.treeDown' },
      { keys: ['j'], scope: 'p.doc', command: 'p.scrollDown' },
    ]);

    expect(commandOfKeysIn(keymap, 'p.treeDown', 'p.tree', 'p.doc')).toBe(null);
  });

  it('runs the one command when every tree key agrees', () => {
    const keymap = keymapOf([
      { keys: ['j'], scope: 'p.tree', command: 'p.treeDown' },
      { keys: ['ArrowDown'], scope: 'p.tree', command: 'p.treeDown' },
      { keys: ['j'], scope: 'p.doc', command: 'p.scrollDown' },
      { keys: ['ArrowDown'], scope: 'p.doc', command: 'p.scrollDown' },
    ]);

    expect(commandOfKeysIn(keymap, 'p.treeDown', 'p.tree', 'p.doc')).toBe(
      'p.scrollDown',
    );
  });

  it('runs nothing when the tree keys run different doc commands', () => {
    const keymap = keymapOf([
      { keys: ['j'], scope: 'p.tree', command: 'p.treeDown' },
      { keys: ['ArrowDown'], scope: 'p.tree', command: 'p.treeDown' },
      { keys: ['j'], scope: 'p.doc', command: 'p.scrollDown' },
    ]);

    expect(commandOfKeysIn(keymap, 'p.treeDown', 'p.tree', 'p.doc')).toBe(null);
  });
});
