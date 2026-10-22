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
    groups: {},
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

    expect(barHints(map, 's', false, label, 'macos')).toEqual([
      { keys: 'j', label: 'next' },
    ]);
  });

  it('barHints_UserLeader_LeavesOutLeaderSequences', () => {
    const map = keymap({
      editor: { leader: ',', remaps: [], binds: [] },
      page: [
        { keys: [',', 'k', 's'], scope: 's', command: 'a.save' },
        { keys: ['j'], scope: 's', command: 'a.next' },
      ],
    });

    expect(barHints(map, 's', false, label, 'macos')).toEqual([
      { keys: 'j', label: 'next' },
    ]);
  });

  it('barHints_Page_IncludesAnyScope', () => {
    const map = keymap({
      page: [
        { keys: ['j'], scope: 's', command: 'a.next' },
        { keys: ['x'], scope: 'elsewhere', command: 'a.review' },
        { keys: ['Escape'], scope: 'any', command: 'a.close' },
        { keys: ['<A-o>'], scope: 'any', command: 'a.leave' },
      ],
    });

    expect(barHints(map, 's', false, label, 'macos')).toEqual([
      { keys: 'j', label: 'next' },
      { keys: 'Esc', label: 'close' },
      { keys: '⌥O', label: 'leave the box' },
    ]);
  });

  it('barHints_InBox_LeavesOutLeaderKeys', () => {
    const map = keymap({
      editor: {
        leader: '<Space>',
        remaps: [],
        binds: [
          { keys: '<Esc>', scope: 's', command: 'a.leave' },
          { keys: '<Leader>x', scope: 's', command: 'a.save' },
        ],
      },
      page: [{ keys: ['j'], scope: 's', command: 'a.next' }],
    });

    expect(barHints(map, 's', true, label, 'macos')).toEqual([
      { keys: 'Esc', label: 'leave the box' },
    ]);
  });

  it('lists in a box only the editor binds firing in the scope', () => {
    const map = keymap({
      editor: {
        leader: '<Space>',
        remaps: [],
        binds: [
          { keys: '<Esc>', scope: 'a.view', command: 'a.leave' },
          { keys: 'x', scope: 'b.other', command: 'b.x' },
          { keys: 'q', scope: 'any', command: 'c.q' },
        ],
      },
    });

    expect(barHints(map, 'a.view', true, label, 'macos')).toEqual([
      { keys: 'Esc', label: 'leave the box' },
      { keys: 'q', label: 'c.q' },
    ]);
  });
});
