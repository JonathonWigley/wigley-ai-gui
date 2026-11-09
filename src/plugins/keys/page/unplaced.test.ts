import { describe, expect, it } from 'vitest';
import type { EditorBind, Keymap, PageBind } from '../../../contracts/keymap';
import { unplacedBinds, unplacedLine } from './unplaced';

function keymap(
  page: PageBind[],
  box: EditorBind[] = [],
  leader = '<Space>',
): Keymap {
  return {
    editor: { leader, remaps: [], binds: box },
    page,
    app: [],
    intercept: [],
    global: [],
    groups: {},
  };
}

const NONE = new Set<string>();

describe('unplacedBinds', () => {
  it('unplacedBinds_PageBindInScope_IsListed', () => {
    const map = keymap([{ keys: ['x'], scope: 'a.s', command: 'a.trash' }]);

    expect(unplacedBinds(map, 'a.s', NONE)).toEqual([
      { keys: 'x', command: 'a.trash' },
    ]);
  });

  it('unplacedBinds_AnyScope_IsListed', () => {
    const map = keymap([{ keys: ['<A-o>'], scope: 'any', command: 'a.next' }]);

    expect(unplacedBinds(map, 'a.s', NONE)).toEqual([
      { keys: '<A-o>', command: 'a.next' },
    ]);
  });

  it('unplacedBinds_OtherScope_LeftOut', () => {
    const map = keymap([{ keys: ['x'], scope: 'a.other', command: 'a.trash' }]);

    expect(unplacedBinds(map, 'a.s', NONE)).toEqual([]);
  });

  it('unplacedBinds_LeaderSequence_LeftOut', () => {
    const map = keymap(
      [{ keys: [' ', 'k', 's'], scope: 'a.s', command: 'a.sessions' }],
      [{ keys: '<Leader>x', scope: 'a.s', command: 'a.box' }],
    );
    const commaMap = keymap(
      [{ keys: [',', 'k'], scope: 'a.s', command: 'a.sessions' }],
      [],
      ',',
    );

    expect(unplacedBinds(map, 'a.s', NONE)).toEqual([]);
    expect(unplacedBinds(commaMap, 'a.s', NONE)).toEqual([]);
  });

  it('unplacedBinds_VimKeys_LeftOut', () => {
    const map = keymap(
      [
        { keys: ['j'], scope: 'a.s', command: 'a.down' },
        { keys: ['g', 'g'], scope: 'a.s', command: 'a.top' },
        { keys: ['Enter'], scope: 'a.s', command: 'a.open' },
        { keys: ['Escape'], scope: 'a.s', command: 'a.leave' },
        { keys: ['<C-S-j>'], scope: 'a.s', command: 'a.scroll' },
      ],
      [
        { keys: '<Esc>', scope: 'a.s', command: 'a.leave' },
        { keys: '<CR>', scope: 'a.s', command: 'a.open' },
      ],
    );

    expect(unplacedBinds(map, 'a.s', NONE)).toEqual([]);
  });

  it('unplacedBinds_PlacedCommand_LeftOut', () => {
    const map = keymap([{ keys: ['x'], scope: 'a.s', command: 'a.trash' }]);

    expect(unplacedBinds(map, 'a.s', new Set(['a.trash']))).toEqual([]);
  });

  it('unplacedBinds_BoxBind_IsListed', () => {
    const map = keymap(
      [],
      [{ keys: '<C-p>', scope: 'a.s', command: 'a.prevBox' }],
    );

    expect(unplacedBinds(map, 'a.s', NONE)).toEqual([
      { keys: '<C-p>', command: 'a.prevBox' },
    ]);
  });

  it('unplacedBinds_SamePairOnPageAndInBox_ListedOnce', () => {
    const map = keymap(
      [{ keys: ['<C-p>'], scope: 'a.s', command: 'a.prevBox' }],
      [{ keys: '<C-p>', scope: 'a.s', command: 'a.prevBox' }],
    );

    expect(unplacedBinds(map, 'a.s', NONE)).toEqual([
      { keys: '<C-p>', command: 'a.prevBox' },
    ]);
  });

  it('unplacedBinds_PageKeys_PrintInVimNotation', () => {
    const map = keymap([
      { keys: ['Backspace'], scope: 'a.s', command: 'a.cycle' },
    ]);

    expect(unplacedBinds(map, 'a.s', NONE)).toEqual([
      { keys: '<BS>', command: 'a.cycle' },
    ]);
  });

  it('unplacedBinds_ArgPlaced_OtherArgsStillListed', () => {
    const map = keymap([
      { keys: ['1'], scope: 'a.s', command: 'a.pick', arg: 1 },
      { keys: ['2'], scope: 'a.s', command: 'a.pick', arg: 2 },
    ]);

    expect(unplacedBinds(map, 'a.s', new Set(['a.pick 1']))).toEqual([
      { keys: '2', command: 'a.pick', arg: 2 },
    ]);
    expect(
      unplacedBinds(map, 'a.s', new Set(['a.pick'])).map((bind) => bind.keys),
    ).toEqual(['1', '2']);
  });

  it('unplacedLine_Arg_PrintsTheTarget', () => {
    expect(unplacedLine({ keys: '2', command: 'a.pick', arg: 2 }, 'a.s')).toBe(
      'unplaced 2 a.pick 2 in a.s',
    );
  });
});
