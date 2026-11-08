import { describe, expect, it } from 'vitest';
import {
  cursorAfterDraw,
  type CursorMove,
  drawnRows,
  movedCursor,
  type OrderedRow,
  type SidebarGroup,
  sidebarSections,
} from './sidebar-order';

function drawnGroup(group: SidebarGroup<OrderedRow>): string {
  const ids = group.rows.map((row) => row.sessionId).join(' ');
  return `${group.project}${group.isFavorite ? '*' : ''}: ${ids}`;
}

describe('sidebarSections', () => {
  it.each<{
    case: string;
    rows: [sessionId: string, project: string][];
    favorites: string[];
    stamps: Record<string, number>;
    projectStamps?: Record<string, number>;
    expectedFavorites: string[];
    expectedRecent: string[];
    expectedDrawn: string[];
  }>([
    {
      case: 'splits favorites from recent and sorts both levels',
      rows: [
        ['a1', 'alpha'],
        ['b1', 'beta'],
        ['a2', 'alpha'],
        ['c1', 'gamma'],
      ],
      favorites: ['gamma'],
      stamps: { a1: 1, b1: 4, a2: 3, c1: 2 },
      projectStamps: { alpha: 3, beta: 4, gamma: 2 },
      expectedFavorites: ['gamma*: c1'],
      expectedRecent: ['beta: b1', 'alpha: a2 a1'],
      expectedDrawn: ['c1', 'b1', 'a2', 'a1'],
    },
    {
      case: 'favorites keep their order and one with no rows draws nothing',
      rows: [
        ['a1', 'alpha'],
        ['g1', 'gamma'],
        ['b1', 'beta'],
      ],
      favorites: ['beta', 'gone', 'alpha'],
      stamps: { a1: 9, g1: 2, b1: 1 },
      expectedFavorites: ['beta*: b1', 'alpha*: a1'],
      expectedRecent: ['gamma: g1'],
      expectedDrawn: ['b1', 'a1', 'g1'],
    },
    {
      case: 'unstamped rows keep the order of rows',
      rows: [
        ['z1', 'alpha'],
        ['m1', 'alpha'],
      ],
      favorites: [],
      stamps: {},
      expectedFavorites: [],
      expectedRecent: ['alpha: z1 m1'],
      expectedDrawn: ['z1', 'm1'],
    },
    {
      case: 'rows tied on a stamp keep the order of rows',
      rows: [
        ['z1', 'alpha'],
        ['m1', 'alpha'],
      ],
      favorites: [],
      stamps: { z1: 3, m1: 3 },
      expectedFavorites: [],
      expectedRecent: ['alpha: z1 m1'],
      expectedDrawn: ['z1', 'm1'],
    },
    {
      case: 'an unstamped row is older than a stamped one',
      rows: [
        ['u1', 'alpha'],
        ['s1', 'alpha'],
      ],
      favorites: [],
      stamps: { s1: 1 },
      expectedFavorites: [],
      expectedRecent: ['alpha: s1 u1'],
      expectedDrawn: ['s1', 'u1'],
    },
    {
      case: 'groups tied on a stamp keep the order of their first rows',
      rows: [
        ['x1', 'xray'],
        ['y1', 'yank'],
      ],
      favorites: [],
      stamps: { x1: 6, y1: 6 },
      projectStamps: { xray: 6, yank: 6 },
      expectedFavorites: [],
      expectedRecent: ['xray: x1', 'yank: y1'],
      expectedDrawn: ['x1', 'y1'],
    },
    {
      case: 'a group sorts by its project stamp, not its newest row',
      rows: [
        ['a1', 'alpha'],
        ['b1', 'beta'],
        ['a2', 'alpha'],
      ],
      favorites: [],
      stamps: { a1: 1, b1: 3, a2: 5 },
      projectStamps: { alpha: 1, beta: 3 },
      expectedFavorites: [],
      expectedRecent: ['beta: b1', 'alpha: a2 a1'],
      expectedDrawn: ['b1', 'a2', 'a1'],
    },
    {
      case: 'an unstamped group sorts after a stamped one',
      rows: [
        ['u1', 'unstamped'],
        ['s1', 'stamped'],
      ],
      favorites: [],
      stamps: { s1: 1 },
      projectStamps: { stamped: 1 },
      expectedFavorites: [],
      expectedRecent: ['stamped: s1', 'unstamped: u1'],
      expectedDrawn: ['s1', 'u1'],
    },
    {
      case: 'rows sort newest first inside a favorite too',
      rows: [
        ['f1', 'fav'],
        ['f2', 'fav'],
      ],
      favorites: ['fav'],
      stamps: { f1: 1, f2: 2 },
      expectedFavorites: ['fav*: f2 f1'],
      expectedRecent: [],
      expectedDrawn: ['f2', 'f1'],
    },
  ])(
    'sidebarSections_ordersSectionsGroupsAndRows: $case',
    ({
      rows,
      favorites,
      stamps,
      projectStamps = {},
      expectedFavorites,
      expectedRecent,
      expectedDrawn,
    }) => {
      const sections = sidebarSections(
        rows.map(([sessionId, project]) => ({ sessionId, project })),
        favorites,
        new Map(Object.entries(stamps)),
        new Map(Object.entries(projectStamps)),
      );
      expect(sections.favorites.map(drawnGroup)).toEqual(expectedFavorites);
      expect(sections.recent.map(drawnGroup)).toEqual(expectedRecent);
      expect(drawnRows(sections).map((row) => row.sessionId)).toEqual(
        expectedDrawn,
      );
    },
  );
});

describe('the list cursor', () => {
  it.each<{
    cursor: string | null;
    order: string[];
    move: CursorMove;
    expected: string | null;
  }>([
    { cursor: 'b', order: ['a', 'b', 'c'], move: 1, expected: 'c' },
    { cursor: 'c', order: ['a', 'b', 'c'], move: 1, expected: 'c' },
    { cursor: 'a', order: ['a', 'b', 'c'], move: -1, expected: 'a' },
    { cursor: 'b', order: ['a', 'b', 'c'], move: 'first', expected: 'a' },
    { cursor: 'a', order: ['a', 'b', 'c'], move: 'last', expected: 'c' },
    { cursor: null, order: ['a', 'b', 'c'], move: 1, expected: 'a' },
    { cursor: 'x', order: ['a', 'b', 'c'], move: -1, expected: 'a' },
    { cursor: 'a', order: [], move: 1, expected: null },
  ])(
    'movedCursor_StepsAndClampsInDrawnOrder: $cursor $move over $order',
    ({ cursor, order, move, expected }) => {
      expect(movedCursor(order, cursor, move)).toBe(expected);
    },
  );

  it.each<{
    cursor: string | null;
    before: string[];
    after: string[];
    expected: string | null;
  }>([
    {
      cursor: 'b',
      before: ['a', 'b', 'c'],
      after: ['c', 'b', 'a'],
      expected: 'b',
    },
    { cursor: 'b', before: ['a', 'b', 'c'], after: ['a', 'c'], expected: 'c' },
    { cursor: 'c', before: ['a', 'b', 'c'], after: ['a', 'b'], expected: 'b' },
    { cursor: 'a', before: ['a', 'b'], after: [], expected: null },
    { cursor: null, before: [], after: ['a', 'b'], expected: 'a' },
    { cursor: 'x', before: ['a', 'b'], after: ['b', 'a'], expected: 'b' },
  ])(
    'cursorAfterDraw_KeepsOrReplacesTheCursorRow: $cursor, $before to $after',
    ({ cursor, before, after, expected }) => {
      expect(cursorAfterDraw(before, after, cursor)).toBe(expected);
    },
  );
});
