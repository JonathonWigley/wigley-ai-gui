import { describe, expect, it } from 'vitest';
import type { Keymap } from '../../../contracts/keymap';
import { barHints } from './key-bar';

const LABELS: Record<string, string> = {
  'a.next': 'next',
  'a.review': 'review',
  'a.close': 'close',
  'a.leave': 'leave the box',
  'a.save': 'save',
};

const label = (id: string) => LABELS[id] ?? id;

function keymap(overrides: Partial<Keymap> = {}): Keymap {
  return {
    editor: { leader: '<Space>', remaps: [], binds: [] },
    page: [],
    app: [],
    intercept: [],
    global: [],
    ...overrides,
  };
}

describe('barHints', () => {
  it('barHints_Page_LeavesOutLeaderKeys', () => {
    const map = keymap({
      page: [
        { keys: ['j'], scope: 's', command: 'a.next' },
        { keys: [' ', 'k'], scope: 's', command: 'a.review' },
      ],
    });

    expect(barHints(map, 's', false, label)).toEqual([
      { keys: 'j', label: 'next' },
    ]);
  });

  it('barHints_Page_LeavesOutSpaceKeysWhateverTheEditorLeader', () => {
    const map = keymap({
      editor: { leader: ',', remaps: [], binds: [] },
      page: [
        { keys: ['j'], scope: 's', command: 'a.next' },
        { keys: [' ', 'k'], scope: 's', command: 'a.review' },
        { keys: [',', 'x'], scope: 's', command: 'a.save' },
      ],
    });

    expect(barHints(map, 's', false, label)).toEqual([
      { keys: 'j', label: 'next' },
      { keys: ', x', label: 'save' },
    ]);
  });

  it('barHints_Page_IncludesAnyScope', () => {
    const map = keymap({
      page: [
        { keys: ['j'], scope: 's', command: 'a.next' },
        { keys: ['x'], scope: 'elsewhere', command: 'a.review' },
        { keys: ['Escape'], scope: 'any', command: 'a.close' },
      ],
    });

    expect(barHints(map, 's', false, label)).toEqual([
      { keys: 'j', label: 'next' },
      { keys: 'Esc', label: 'close' },
    ]);
  });

  it('barHints_InBox_LeavesOutLeaderKeys', () => {
    const map = keymap({
      editor: {
        leader: '<Space>',
        remaps: [],
        binds: [
          { keys: '<Esc>', command: 'a.leave' },
          { keys: '<Leader>x', command: 'a.save' },
        ],
      },
      page: [{ keys: ['j'], scope: 's', command: 'a.next' }],
    });

    expect(barHints(map, 's', true, label)).toEqual([
      { keys: '<Esc>', label: 'leave the box' },
    ]);
  });
});
