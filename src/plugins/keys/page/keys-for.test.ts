import { describe, expect, it } from 'vitest';
import type { Keymap, PageBind } from '../../../contracts/keymap';
import { keysFor } from './keys-for';

function keymap(page: PageBind[]): Keymap {
  return {
    editor: { leader: '<Space>', remaps: [], binds: [] },
    page,
    app: [],
    intercept: [],
    global: [],
  };
}

describe('keysFor', () => {
  it('keysFor_BoundInScope_ReturnsItsKeysFormatted', () => {
    const map = keymap([
      { keys: [' ', 'Escape'], scope: 'a.s', command: 'a.close' },
    ]);

    expect(keysFor(map, 'a.close', 'a.s')).toBe('Space Esc');
  });

  it('keysFor_BoundTwice_ReturnsTheFirstBind', () => {
    const map = keymap([
      { keys: ['x'], scope: 'a.s', command: 'a.next' },
      { keys: ['j'], scope: 'a.s', command: 'a.next' },
    ]);

    expect(keysFor(map, 'a.next', 'a.s')).toBe('x');
  });

  it('keysFor_BoundInAnotherScope_SkipsThatBind', () => {
    const map = keymap([
      { keys: ['x'], scope: 'a.other', command: 'a.next' },
      { keys: ['j'], scope: 'a.s', command: 'a.next' },
    ]);

    expect(keysFor(map, 'a.next', 'a.s')).toBe('j');
  });

  it('keysFor_BoundInAnyScope_MatchesEveryScope', () => {
    const map = keymap([{ keys: ['?'], scope: 'any', command: 'a.help' }]);

    expect(keysFor(map, 'a.help', 'a.s')).toBe('?');
  });

  it('keysFor_NoScope_MatchesABindInAnyScope', () => {
    const map = keymap([
      { keys: ['c'], scope: 'a.other', command: 'a.change' },
    ]);

    expect(keysFor(map, 'a.change', undefined)).toBe('c');
  });

  it('keysFor_Unbound_ReturnsNull', () => {
    const map = keymap([{ keys: ['j'], scope: 'a.s', command: 'a.next' }]);

    expect(keysFor(map, 'a.prev', 'a.s')).toBeNull();
    expect(keysFor(map, 'a.next', 'a.other')).toBeNull();
  });
});
