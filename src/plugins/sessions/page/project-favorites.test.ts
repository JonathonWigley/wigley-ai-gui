import { describe, expect, it } from 'vitest';
import type { UiState } from '../../../contracts/ui-state';
import {
  createProjectFavorites,
  type ProjectFavorites,
} from './project-favorites';

function uiStateHolding(favorites: string[]): UiState {
  const values = new Map<string, unknown>([['favorites', favorites]]);
  return {
    get: (key) => values.get(key),
    set: (key, value) => values.set(key, value),
  };
}

describe('createProjectFavorites', () => {
  it.each<{
    case: string;
    saved: string[];
    act: (favorites: ProjectFavorites) => boolean | void;
    returns?: boolean;
    after: string[];
  }>([
    {
      case: 'toggle appends a non-favorite',
      saved: ['a'],
      act: (favorites) => favorites.toggle('b'),
      returns: true,
      after: ['a', 'b'],
    },
    {
      case: 'toggle removes a favorite',
      saved: ['a', 'b'],
      act: (favorites) => favorites.toggle('a'),
      returns: false,
      after: ['b'],
    },
    {
      case: 'move swaps past an unshown favorite, which stays',
      saved: ['a', 'hidden', 'b'],
      act: (favorites) => favorites.move('b', -1, ['a', 'b']),
      returns: true,
      after: ['b', 'hidden', 'a'],
    },
    {
      case: 'move down',
      saved: ['a', 'b'],
      act: (favorites) => favorites.move('a', 1, ['a', 'b']),
      returns: true,
      after: ['b', 'a'],
    },
    {
      case: 'move up at the top edge',
      saved: ['a', 'b'],
      act: (favorites) => favorites.move('a', -1, ['a', 'b']),
      returns: false,
      after: ['a', 'b'],
    },
    {
      case: 'move down at the bottom edge',
      saved: ['a', 'b'],
      act: (favorites) => favorites.move('b', 1, ['a', 'b']),
      returns: false,
      after: ['a', 'b'],
    },
    {
      case: 'move of a non-favorite',
      saved: ['a', 'b'],
      act: (favorites) => favorites.move('c', 1, ['a', 'b']),
      returns: false,
      after: ['a', 'b'],
    },
    {
      case: 'move of a favorite not in shown',
      saved: ['a', 'hidden', 'b'],
      act: (favorites) => favorites.move('hidden', 1, ['a', 'b']),
      returns: false,
      after: ['a', 'hidden', 'b'],
    },
    {
      case: 'move skips a shown name that is no longer a favorite',
      saved: ['a', 'b'],
      act: (favorites) => favorites.move('a', 1, ['a', 'gone', 'b']),
      returns: true,
      after: ['b', 'a'],
    },
    {
      case: 'place favorites a new project mid list',
      saved: ['a', 'b'],
      act: (favorites) => favorites.place('c', 1, ['a', 'b']),
      after: ['a', 'c', 'b'],
    },
    {
      case: 'place moves a favorite to the end of shown',
      saved: ['a', 'b'],
      act: (favorites) => favorites.place('a', 1, ['a', 'b']),
      after: ['b', 'a'],
    },
    {
      case: 'place of a favorite on its own place',
      saved: ['a', 'b'],
      act: (favorites) => favorites.place('a', 0, ['a', 'b']),
      after: ['a', 'b'],
    },
    {
      case: 'place with nothing shown goes to the end of the saved array',
      saved: ['hidden'],
      act: (favorites) => favorites.place('c', 0, []),
      after: ['hidden', 'c'],
    },
    {
      case: 'place before a shown item lands right before it',
      saved: ['a', 'hidden', 'b'],
      act: (favorites) => favorites.place('c', 1, ['a', 'b']),
      after: ['a', 'hidden', 'c', 'b'],
    },
    {
      case: 'place past shown lands right after the last, before an unshown',
      saved: ['a', 'b', 'hidden'],
      act: (favorites) => favorites.place('c', 2, ['a', 'b']),
      after: ['a', 'b', 'c', 'hidden'],
    },
    {
      case: 'place clamps an index below the list',
      saved: ['a', 'b'],
      act: (favorites) => favorites.place('c', -3, ['a', 'b']),
      after: ['c', 'a', 'b'],
    },
    {
      case: 'place clamps an index above the list',
      saved: ['a', 'b', 'hidden'],
      act: (favorites) => favorites.place('c', 7, ['a', 'b']),
      after: ['a', 'b', 'c', 'hidden'],
    },
    {
      case: 'place counts no shown name that is no longer a favorite',
      saved: ['a'],
      act: (favorites) => favorites.place('c', 0, ['gone', 'a']),
      after: ['c', 'a'],
    },
    {
      case: 'remove unfavorites',
      saved: ['a', 'b'],
      act: (favorites) => favorites.remove('a'),
      after: ['b'],
    },
    {
      case: 'remove of a non-favorite',
      saved: ['a', 'b'],
      act: (favorites) => favorites.remove('c'),
      after: ['a', 'b'],
    },
  ])(
    'favorites_toggleMoveAndPlace: $case',
    ({ saved, act, returns, after }) => {
      const state = uiStateHolding(saved);
      const favorites = createProjectFavorites(state);
      expect(act(favorites)).toBe(returns);
      expect(favorites.list()).toEqual(after);
      expect(createProjectFavorites(state).list()).toEqual(after);
      expect(after.every(favorites.isFavorite)).toBe(true);
      expect(favorites.isFavorite('never')).toBe(false);
    },
  );
});
