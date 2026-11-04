import type { UiState } from '../../../contracts/ui-state';
import { isStringArray } from '../../../shared/json';

const FAVORITES_KEY = 'favorites';

// The user's favorite projects in their own order, unshown ones (no open
// session) keeping their place. `shown` is the favorites that have rows, in
// order; a name in it that is no longer a favorite counts as absent.
export interface ProjectFavorites {
  list(): readonly string[];
  isFavorite(project: string): boolean;
  // Appends a non-favorite or removes a favorite; returns whether the project
  // is a favorite after.
  toggle(project: string): boolean;
  // Swaps the project with its neighbour in `shown` toward `by`; returns
  // whether it moved, false for a project not in `shown` or at its edge.
  move(project: string, by: 1 | -1, shown: readonly string[]): boolean;
  // Favorites the project before the `index`-th item of `shown` without it,
  // `index` clamped to that list. At the list's length it lands right after the
  // last item, or at the end of the saved array when the list is empty.
  place(project: string, index: number, shown: readonly string[]): void;
  remove(project: string): void;
}

// The array read once from `uiState`'s `favorites`, duplicates reading once in
// their first place; any value but an array of non-empty strings reads as no
// favorites and stays until the first change.
export function createProjectFavorites(uiState: UiState): ProjectFavorites {
  let favorites = readFavorites(uiState.get(FAVORITES_KEY));
  const save = (next: string[]) => {
    favorites = next;
    uiState.set(FAVORITES_KEY, next);
  };
  const isFavorite = (project: string) => favorites.includes(project);
  const without = (project: string) =>
    favorites.filter((item) => item !== project);
  return {
    list: () => favorites,
    isFavorite,
    toggle(project) {
      const wasFavorite = isFavorite(project);
      save(wasFavorite ? without(project) : [...favorites, project]);
      return !wasFavorite;
    },
    move(project, by, shown) {
      const shownFavorites = shown.filter(isFavorite);
      const position = shownFavorites.indexOf(project);
      const neighbour = shownFavorites[position + by];
      if (position === -1 || neighbour === undefined) {
        return false;
      }
      const next = [...favorites];
      next[favorites.indexOf(project)] = neighbour;
      next[favorites.indexOf(neighbour)] = project;
      save(next);
      return true;
    },
    place(project, index, shown) {
      const others = shown.filter(
        (item) => item !== project && isFavorite(item),
      );
      const next = without(project);
      next.splice(insertionIndex(next, others, index), 0, project);
      save(next);
    },
    remove(project) {
      if (isFavorite(project)) {
        save(without(project));
      }
    },
  };
}

// Where in `saved` the `index`-th place among `others` falls.
function insertionIndex(
  saved: readonly string[],
  others: readonly string[],
  index: number,
): number {
  if (others.length === 0) {
    return saved.length;
  }
  const clamped = Math.min(Math.max(index, 0), others.length);
  return clamped === others.length
    ? saved.indexOf(others[clamped - 1]) + 1
    : saved.indexOf(others[clamped]);
}

function readFavorites(saved: unknown): string[] {
  const isValid =
    isStringArray(saved) && saved.every((project) => project !== '');
  return isValid ? [...new Set(saved)] : [];
}
