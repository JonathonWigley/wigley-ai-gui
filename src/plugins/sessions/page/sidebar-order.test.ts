import { describe, expect, it } from 'vitest';
import {
  type ClaimedSection,
  drawnRows,
  type OrderedRow,
  type RowClaim,
  type SidebarGroup,
  sidebarSections,
} from './sidebar-order';

function drawnGroup(group: SidebarGroup<OrderedRow>): string {
  const ids = group.rows.map((row) => row.sessionId).join(' ');
  return `${group.project}${group.isFavorite ? '*' : ''}: ${ids}`;
}

function drawnSection(
  claimed: ClaimedSection<OrderedRow, RowClaim<OrderedRow>>,
): string {
  const ids = claimed.rows.map((row) => row.sessionId).join(' ');
  return `${claimed.section.id}: ${ids}`;
}

describe('sidebarSections', () => {
  it.each<{
    case: string;
    rows: [sessionId: string, project: string][];
    favorites: string[];
    stamps: Record<string, number>;
    projectStamps?: Record<string, number>;
    sections?: [id: string, order: number, claimed: string[]][];
    expectedFavorites: string[];
    expectedRecent: string[];
    expectedPlugins?: string[];
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
    {
      case: 'a claimed row leaves its group and draws after recent',
      rows: [
        ['a1', 'alpha'],
        ['a2', 'alpha'],
        ['b1', 'beta'],
      ],
      favorites: [],
      stamps: { a1: 1, a2: 2, b1: 3 },
      projectStamps: { alpha: 2, beta: 3 },
      sections: [['retro', 0, ['a2']]],
      expectedFavorites: [],
      expectedRecent: ['beta: b1', 'alpha: a1'],
      expectedPlugins: ['retro: a2'],
      expectedDrawn: ['b1', 'a1', 'a2'],
    },
    {
      case: 'plugin sections sort by order, a tie by registration',
      rows: [
        ['x1', 'alpha'],
        ['y1', 'alpha'],
        ['z1', 'alpha'],
      ],
      favorites: [],
      stamps: {},
      sections: [
        ['late', 5, ['x1']],
        ['first', 1, ['y1']],
        ['tied', 5, ['z1']],
      ],
      expectedFavorites: [],
      expectedRecent: [],
      expectedPlugins: ['first: y1', 'late: x1', 'tied: z1'],
      expectedDrawn: ['y1', 'x1', 'z1'],
    },
    {
      case: 'a section that claims no row is left out',
      rows: [['a1', 'alpha']],
      favorites: [],
      stamps: {},
      sections: [['empty', 0, []]],
      expectedFavorites: [],
      expectedRecent: ['alpha: a1'],
      expectedPlugins: [],
      expectedDrawn: ['a1'],
    },
    {
      case: 'a row two sections claim goes to the lower order',
      rows: [['a1', 'alpha']],
      favorites: [],
      stamps: {},
      sections: [
        ['high', 9, ['a1']],
        ['low', 2, ['a1']],
      ],
      expectedFavorites: [],
      expectedRecent: [],
      expectedPlugins: ['low: a1'],
      expectedDrawn: ['a1'],
    },
    {
      case: 'a row two sections at one order claim goes to the first registered',
      rows: [['a1', 'alpha']],
      favorites: [],
      stamps: {},
      sections: [
        ['first', 3, ['a1']],
        ['second', 3, ['a1']],
      ],
      expectedFavorites: [],
      expectedRecent: [],
      expectedPlugins: ['first: a1'],
      expectedDrawn: ['a1'],
    },
    {
      case: 'rows in a plugin section run newest first',
      rows: [
        ['a1', 'alpha'],
        ['a2', 'alpha'],
      ],
      favorites: [],
      stamps: { a1: 1, a2: 2 },
      sections: [['retro', 0, ['a1', 'a2']]],
      expectedFavorites: [],
      expectedRecent: [],
      expectedPlugins: ['retro: a2 a1'],
      expectedDrawn: ['a2', 'a1'],
    },
    {
      case: "a favorite's claimed row leaves Favorites",
      rows: [
        ['f1', 'fav'],
        ['f2', 'fav'],
      ],
      favorites: ['fav'],
      stamps: {},
      sections: [['retro', 0, ['f1']]],
      expectedFavorites: ['fav*: f2'],
      expectedRecent: [],
      expectedPlugins: ['retro: f1'],
      expectedDrawn: ['f2', 'f1'],
    },
  ])(
    'sidebarSections_ordersSectionsGroupsAndRows: $case',
    ({
      rows,
      favorites,
      stamps,
      projectStamps = {},
      sections: claims = [],
      expectedFavorites,
      expectedRecent,
      expectedPlugins = [],
      expectedDrawn,
    }) => {
      const sections = sidebarSections(
        rows.map(([sessionId, project]) => ({ sessionId, project })),
        favorites,
        new Map(Object.entries(stamps)),
        new Map(Object.entries(projectStamps)),
        claims.map(([id, order, ids]): RowClaim<OrderedRow> => ({
          id,
          order,
          claims: (row) => ids.includes(row.sessionId),
        })),
      );
      expect(sections.favorites.map(drawnGroup)).toEqual(expectedFavorites);
      expect(sections.recent.map(drawnGroup)).toEqual(expectedRecent);
      expect(sections.plugins.map(drawnSection)).toEqual(expectedPlugins);
      expect(drawnRows(sections).map((row) => row.sessionId)).toEqual(
        expectedDrawn,
      );
    },
  );
});
