import { describe, expect, it } from 'vitest';
import {
  drawnRows,
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
      expectedFavorites: [],
      expectedRecent: ['xray: x1', 'yank: y1'],
      expectedDrawn: ['x1', 'y1'],
    },
    {
      case: 'a group sorts by its newest row, not its first',
      rows: [
        ['a1', 'alpha'],
        ['b1', 'beta'],
        ['a2', 'alpha'],
      ],
      favorites: [],
      stamps: { a1: 1, b1: 3, a2: 5 },
      expectedFavorites: [],
      expectedRecent: ['alpha: a2 a1', 'beta: b1'],
      expectedDrawn: ['a2', 'a1', 'b1'],
    },
    {
      case: 'an unstamped group sorts after a stamped one',
      rows: [
        ['u1', 'unstamped'],
        ['s1', 'stamped'],
      ],
      favorites: [],
      stamps: { s1: 1 },
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
      expectedFavorites,
      expectedRecent,
      expectedDrawn,
    }) => {
      const sections = sidebarSections(
        rows.map(([sessionId, project]) => ({ sessionId, project })),
        favorites,
        new Map(Object.entries(stamps)),
      );
      expect(sections.favorites.map(drawnGroup)).toEqual(expectedFavorites);
      expect(sections.recent.map(drawnGroup)).toEqual(expectedRecent);
      expect(drawnRows(sections).map((row) => row.sessionId)).toEqual(
        expectedDrawn,
      );
    },
  );
});
