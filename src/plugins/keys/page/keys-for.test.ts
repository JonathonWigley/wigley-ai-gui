import { describe, expect, it } from 'vitest';
import type { EditorBind, Keymap, PageBind } from '../../../contracts/keymap';
import { keysFor } from './keys-for';

function keymap(page: PageBind[], box: EditorBind[] = []): Keymap {
  return {
    editor: { leader: '<Space>', remaps: [], binds: box },
    page,
    app: [],
    intercept: [],
    global: [],
    groups: {},
  };
}

describe('keysFor', () => {
  it('keysFor_BoundInScope_ReturnsItsKeysFormatted', () => {
    const map = keymap([
      { keys: [' ', 'Escape'], scope: 'a.s', command: 'a.close' },
    ]);

    expect(keysFor(map, 'a.close', 'a.s', 'macos')).toBe('Space ⎋');
  });

  it('keysFor_Chord_PrintsForThePlatform', () => {
    const map = keymap([{ keys: ['<C-h>'], scope: 'a.s', command: 'a.prev' }]);

    expect(keysFor(map, 'a.prev', 'a.s', 'macos')).toBe('⌃H');
    expect(keysFor(map, 'a.prev', 'a.s', 'windows')).toBe('Ctrl+H');
  });

  it('keysFor_BoundTwice_ReturnsTheFirstBind', () => {
    const map = keymap([
      { keys: ['x'], scope: 'a.s', command: 'a.next' },
      { keys: ['j'], scope: 'a.s', command: 'a.next' },
    ]);

    expect(keysFor(map, 'a.next', 'a.s', 'macos')).toBe('x');
  });

  it('keysFor_BoundInAnotherScope_SkipsThatBind', () => {
    const map = keymap([
      { keys: ['x'], scope: 'a.other', command: 'a.next' },
      { keys: ['j'], scope: 'a.s', command: 'a.next' },
    ]);

    expect(keysFor(map, 'a.next', 'a.s', 'macos')).toBe('j');
  });

  it('keysFor_BoundInAnyScope_MatchesEveryScope', () => {
    const map = keymap([{ keys: ['?'], scope: 'any', command: 'a.help' }]);

    expect(keysFor(map, 'a.help', 'a.s', 'macos')).toBe('?');
  });

  it('keysFor_NoScope_MatchesABindInAnyScope', () => {
    const map = keymap([
      { keys: ['c'], scope: 'a.other', command: 'a.change' },
    ]);

    expect(keysFor(map, 'a.change', undefined, 'macos')).toBe('c');
  });

  it('keysFor_Box_ReturnsTheBoxBindWithItsLeaderSpelled', () => {
    const map = keymap(
      [{ keys: ['y'], scope: 'a.other', command: 'a.copy' }],
      [
        { keys: '<Leader>cy', scope: 'a.other', command: 'a.copy' },
        { keys: '<Leader>cz', scope: 'a.s', command: 'a.copy' },
      ],
    );

    expect(keysFor(map, 'a.copy', 'a.s', 'macos', 'box')).toBe('Space c z');
  });

  it('keysFor_BoundOnlyInABox_PageReadsNull', () => {
    const map = keymap(
      [],
      [{ keys: '<Leader>cy', scope: 'a.s', command: 'a.copy' }],
    );

    expect(keysFor(map, 'a.copy', 'a.s', 'macos')).toBeNull();
  });

  it('keysFor_Unbound_ReturnsNull', () => {
    const map = keymap([{ keys: ['j'], scope: 'a.s', command: 'a.next' }]);

    expect(keysFor(map, 'a.prev', 'a.s', 'macos')).toBeNull();
    expect(keysFor(map, 'a.next', 'a.other', 'macos')).toBeNull();
  });
});
