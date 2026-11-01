import { describe, expect, it } from 'vitest';
import type { PaneDirection } from '../../../contracts/panes';
import {
  closePane,
  focusToward,
  leafIds,
  nudgeFocused,
  type PaneNode,
  type PaneTree,
  paneToward,
  parsePaneTree,
  singlePane,
  splitFocused,
  swapToward,
} from './pane-tree';

function leaf(id: string): PaneNode {
  return { kind: 'leaf', id };
}

function row(ratio: number, first: PaneNode, second: PaneNode): PaneNode {
  return { kind: 'split', axis: 'row', ratio, first, second };
}

function column(ratio: number, first: PaneNode, second: PaneNode): PaneNode {
  return { kind: 'split', axis: 'column', ratio, first, second };
}

function tree(root: PaneNode, focusedId: string): PaneTree {
  return { root, focusedId };
}

// a top left, b bottom left, c top right, d bottom right.
const grid = row(
  0.5,
  column(0.5, leaf('a'), leaf('b')),
  column(0.5, leaf('c'), leaf('d')),
);

describe('leafIds', () => {
  it.each([
    { root: leaf('a'), expected: ['a'] },
    { root: grid, expected: ['a', 'b', 'c', 'd'] },
    {
      root: column(0.3, row(0.6, leaf('e'), leaf('b')), leaf('a')),
      expected: ['e', 'b', 'a'],
    },
  ])('lists $expected', ({ root, expected }) => {
    expect(leafIds(tree(root, expected[0]))).toEqual(expected);
  });
});

describe('splitFocused', () => {
  it.each([
    {
      name: 'one pane, side by side',
      from: singlePane('a'),
      axis: 'row' as const,
      expected: tree(row(0.5, leaf('a'), leaf('b')), 'b'),
    },
    {
      name: 'a nested pane, stacked',
      from: tree(row(0.3, leaf('a'), leaf('c')), 'c'),
      axis: 'column' as const,
      expected: tree(
        row(0.3, leaf('a'), column(0.5, leaf('c'), leaf('b'))),
        'b',
      ),
    },
  ])('splits $name', ({ from, axis, expected }) => {
    expect(splitFocused(from, axis, 'b')).toEqual(expected);
  });

  it('throws when the new id is already a pane', () => {
    expect(() =>
      splitFocused(tree(row(0.5, leaf('a'), leaf('b')), 'a'), 'row', 'b'),
    ).toThrow(/b/);
  });
});

describe('closePane', () => {
  const twoLeft = row(0.4, column(0.6, leaf('a'), leaf('b')), leaf('c'));
  const twoRight = row(0.4, leaf('a'), column(0.6, leaf('b'), leaf('c')));
  it.each([
    { name: 'the only pane', from: singlePane('a'), id: 'a', expected: null },
    {
      name: 'a focused second leaf beside a leaf',
      from: tree(row(0.5, leaf('a'), leaf('b')), 'b'),
      id: 'b',
      expected: tree(leaf('a'), 'a'),
    },
    {
      name: 'an unfocused first leaf beside a leaf',
      from: tree(row(0.5, leaf('a'), leaf('b')), 'b'),
      id: 'a',
      expected: tree(leaf('b'), 'b'),
    },
    {
      name: 'a focused first leaf beside a subtree',
      from: tree(twoRight, 'a'),
      id: 'a',
      expected: tree(column(0.6, leaf('b'), leaf('c')), 'b'),
    },
    {
      name: 'a focused second leaf beside a subtree',
      from: tree(twoLeft, 'c'),
      id: 'c',
      expected: tree(column(0.6, leaf('a'), leaf('b')), 'b'),
    },
    {
      name: 'an unfocused second leaf beside a subtree',
      from: tree(twoLeft, 'a'),
      id: 'c',
      expected: tree(column(0.6, leaf('a'), leaf('b')), 'a'),
    },
    {
      name: 'a focused nested first leaf',
      from: tree(twoRight, 'b'),
      id: 'b',
      expected: tree(row(0.4, leaf('a'), leaf('c')), 'c'),
    },
    {
      name: 'an unfocused nested second leaf',
      from: tree(twoRight, 'a'),
      id: 'c',
      expected: tree(row(0.4, leaf('a'), leaf('b')), 'a'),
    },
  ])('closes $name', ({ from, id, expected }) => {
    expect(closePane(from, id)).toEqual(expected);
  });
});

describe('paneToward', () => {
  it.each<{
    name: string;
    root: PaneNode;
    id: string;
    direction: PaneDirection;
    expected: string | null;
  }>([
    {
      name: 'grid, right',
      root: grid,
      id: 'a',
      direction: 'right',
      expected: 'c',
    },
    {
      name: 'grid, down',
      root: grid,
      id: 'a',
      direction: 'down',
      expected: 'b',
    },
    {
      name: 'grid, left',
      root: grid,
      id: 'd',
      direction: 'left',
      expected: 'b',
    },
    { name: 'grid, up', root: grid, id: 'd', direction: 'up', expected: 'c' },
    {
      name: 'tie across, topmost',
      root: row(0.5, leaf('a'), column(0.5, leaf('b'), leaf('c'))),
      id: 'a',
      direction: 'right',
      expected: 'b',
    },
    {
      name: 'tie down the page, leftmost',
      root: column(0.5, row(0.5, leaf('a'), leaf('b')), leaf('c')),
      id: 'c',
      direction: 'up',
      expected: 'a',
    },
    {
      name: 'largest overlap',
      root: row(0.5, leaf('a'), column(0.3, leaf('b'), leaf('c'))),
      id: 'a',
      direction: 'right',
      expected: 'c',
    },
    {
      name: 'a lower pane beside one tall pane',
      root: row(0.6, column(0.4, leaf('a'), leaf('b')), leaf('c')),
      id: 'b',
      direction: 'right',
      expected: 'c',
    },
    {
      name: 'left edge',
      root: grid,
      id: 'a',
      direction: 'left',
      expected: null,
    },
    { name: 'top edge', root: grid, id: 'c', direction: 'up', expected: null },
    {
      name: 'right edge',
      root: grid,
      id: 'd',
      direction: 'right',
      expected: null,
    },
    {
      name: 'bottom edge',
      root: grid,
      id: 'b',
      direction: 'down',
      expected: null,
    },
    {
      name: 'one pane',
      root: leaf('a'),
      id: 'a',
      direction: 'right',
      expected: null,
    },
  ])('finds $name', ({ root, id, direction, expected }) => {
    expect(paneToward(tree(root, id), id, direction)).toBe(expected);
  });
});

describe('focusToward', () => {
  it.each<{ direction: PaneDirection; expected: PaneTree | null }>([
    { direction: 'right', expected: tree(grid, 'c') },
    { direction: 'down', expected: tree(grid, 'b') },
    { direction: 'left', expected: null },
  ])('moves $direction', ({ direction, expected }) => {
    expect(focusToward(tree(grid, 'a'), direction)).toEqual(expected);
  });
});

describe('swapToward', () => {
  it.each<{ direction: PaneDirection; expected: PaneTree | null }>([
    {
      direction: 'right',
      expected: tree(
        row(
          0.5,
          column(0.5, leaf('c'), leaf('b')),
          column(0.5, leaf('a'), leaf('d')),
        ),
        'a',
      ),
    },
    {
      direction: 'down',
      expected: tree(
        row(
          0.5,
          column(0.5, leaf('b'), leaf('a')),
          column(0.5, leaf('c'), leaf('d')),
        ),
        'a',
      ),
    },
    { direction: 'up', expected: null },
  ])('swaps $direction', ({ direction, expected }) => {
    expect(swapToward(tree(grid, 'a'), direction)).toEqual(expected);
  });
});

describe('nudgeFocused', () => {
  const limits = () => ({ step: 0.1, least: 0.2 });
  const nested = row(0.5, leaf('a'), row(0.5, leaf('b'), leaf('c')));
  it.each<{
    name: string;
    from: PaneTree;
    presses: PaneDirection[];
    expected: PaneNode;
    owned: boolean[];
  }>([
    {
      name: 'right from first grows its split',
      from: tree(row(0.5, leaf('a'), leaf('b')), 'a'),
      presses: ['right'],
      expected: row(0.6, leaf('a'), leaf('b')),
      owned: [true],
    },
    {
      name: 'left from second shrinks its left divider',
      from: tree(row(0.5, leaf('a'), leaf('b')), 'b'),
      presses: ['left'],
      expected: row(0.4, leaf('a'), leaf('b')),
      owned: [true],
    },
    {
      name: 'up with only row splits',
      from: tree(row(0.5, leaf('a'), leaf('b')), 'a'),
      presses: ['up'],
      expected: row(0.5, leaf('a'), leaf('b')),
      owned: [false],
    },
    {
      name: 'left from a nested first moves its right divider',
      from: tree(nested, 'b'),
      presses: ['left'],
      expected: row(0.5, leaf('a'), row(0.4, leaf('b'), leaf('c'))),
      owned: [true],
    },
    {
      name: 'right from a second in two splits moves the nearest',
      from: tree(nested, 'c'),
      presses: ['right'],
      expected: row(0.5, leaf('a'), row(0.6, leaf('b'), leaf('c'))),
      owned: [true],
    },
    {
      name: 'down past a row split to the column above it',
      from: tree(column(0.5, row(0.3, leaf('a'), leaf('b')), leaf('c')), 'b'),
      presses: ['down'],
      expected: column(0.6, row(0.3, leaf('a'), leaf('b')), leaf('c')),
      owned: [true],
    },
    {
      name: 'two presses from one step under the limit',
      from: tree(row(0.75, leaf('a'), leaf('b')), 'a'),
      presses: ['right', 'right'],
      expected: row(0.8, leaf('a'), leaf('b')),
      owned: [true, true],
    },
    {
      name: 'two presses from one step over the lower limit',
      from: tree(column(0.25, leaf('a'), leaf('b')), 'b'),
      presses: ['up', 'up'],
      expected: column(0.2, leaf('a'), leaf('b')),
      owned: [true, true],
    },
  ])('nudges $name', ({ from, presses, expected, owned }) => {
    let current = from;
    const ownedPresses: boolean[] = [];
    for (const direction of presses) {
      const result = nudgeFocused(current, direction, limits);
      current = result.tree;
      ownedPresses.push(result.owned);
    }
    expect(current).toEqual(tree(expected, from.focusedId));
    expect(ownedPresses).toEqual(owned);
  });
});

describe('parsePaneTree', () => {
  it('round-trips a stored tree', () => {
    const stored = tree(
      row(
        0.3,
        leaf('a'),
        column(0.7, leaf('b'), row(0.45, leaf('c'), leaf('d'))),
      ),
      'c',
    );
    expect(parsePaneTree(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
  });

  it.each([
    { name: 'not an object', value: 'a' },
    { name: 'no root', value: { focusedId: 'a' } },
    { name: 'a ratio of 0', value: tree(row(0, leaf('a'), leaf('b')), 'a') },
    { name: 'a ratio of 1', value: tree(row(1, leaf('a'), leaf('b')), 'a') },
    {
      name: 'a ratio over 1',
      value: tree(row(1.4, leaf('a'), leaf('b')), 'a'),
    },
    {
      name: 'a ratio that is not a number',
      value: {
        focusedId: 'a',
        root: { ...row(0.5, leaf('a'), leaf('b')), ratio: '0.5' },
      },
    },
    {
      name: 'an unknown axis',
      value: {
        focusedId: 'a',
        root: { ...row(0.5, leaf('a'), leaf('b')), axis: 'diagonal' },
      },
    },
    {
      name: 'an unknown kind',
      value: { focusedId: 'a', root: { kind: 'tab', id: 'a' } },
    },
    {
      name: 'a missing child',
      value: {
        focusedId: 'a',
        root: { kind: 'split', axis: 'row', ratio: 0.5, first: leaf('a') },
      },
    },
    {
      name: 'a repeated id',
      value: tree(row(0.5, leaf('a'), column(0.5, leaf('b'), leaf('a'))), 'a'),
    },
    { name: 'an empty id', value: tree(row(0.5, leaf('a'), leaf('')), 'a') },
    {
      name: 'a focused id that is no pane',
      value: tree(row(0.5, leaf('a'), leaf('b')), 'e'),
    },
  ])('refuses $name', ({ value }) => {
    expect(parsePaneTree(value)).toBeNull();
  });
});
