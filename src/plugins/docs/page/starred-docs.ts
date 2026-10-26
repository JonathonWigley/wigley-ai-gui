// The user's starred docs, by entry id, kept in the docs plugin's `uiState`
// under `starred` and shared by every docs view on the page. An in-app rename
// carries a star to the new path; an in-app trash drops the stars of what it
// removed; a starred doc that leaves the index another way keeps its star.

import type { Disposable } from '../../../contracts/disposable';
import type { Paths } from '../../../contracts/paths';
import type { UiState } from '../../../contracts/ui-state';
import { isStringArray } from '../../../shared/json';
import {
  type DocChangeRecord,
  isEntryIdInside,
  movedEntryId,
} from './docs-state';

const STARRED_KEY = 'starred';

// The star set. `ids()` is the live set, read and never changed by callers.
// `toggle` and a change that alters the set save the whole set, sorted, then
// run each `onChanged` listener synchronously in subscribe order; a change
// that alters nothing saves nothing and runs none.
export interface StarredDocs {
  ids(): ReadonlySet<string>;
  has(entryId: string): boolean;
  toggle(entryId: string): void;
  // A rename moves each id at or inside `from`; a trash drops each id at or
  // inside any trashed path; a create does nothing.
  applyChange(change: DocChangeRecord): void;
  onChanged(listener: () => void): Disposable;
}

// The star set read once from `uiState`'s `starred` array of ids; any other
// saved value reads as no stars and stays until the first change.
export function createStarredDocs(uiState: UiState, paths: Paths): StarredDocs {
  const saved = uiState.get(STARRED_KEY);
  const ids = new Set<string>(isStringArray(saved) ? saved : []);
  const listeners = new Set<() => void>();
  const saveAndNotify = () => {
    uiState.set(STARRED_KEY, [...ids].sort());
    for (const listener of listeners) {
      listener();
    }
  };
  return {
    ids: () => ids,
    has: (entryId) => ids.has(entryId),
    toggle(entryId) {
      if (!ids.delete(entryId)) {
        ids.add(entryId);
      }
      saveAndNotify();
    },
    applyChange(change) {
      const next = changedIds(ids, change, paths);
      if (next === null) {
        return;
      }
      ids.clear();
      for (const id of next) {
        ids.add(id);
      }
      saveAndNotify();
    },
    onChanged(listener) {
      // A wrapper per subscribe, so each handle removes only its own.
      const held = () => listener();
      listeners.add(held);
      return { dispose: () => listeners.delete(held) };
    },
  };
}

// The ids once `change` applies, or null when the set stays the same.
function changedIds(
  ids: ReadonlySet<string>,
  change: DocChangeRecord,
  paths: Paths,
): ReadonlySet<string> | null {
  const next = new Set(nextIds(ids, change, paths));
  const isSame = next.size === ids.size && [...next].every((id) => ids.has(id));
  return isSame ? null : next;
}

function nextIds(
  ids: ReadonlySet<string>,
  change: DocChangeRecord,
  paths: Paths,
): string[] {
  switch (change.type) {
    case 'created':
      return [...ids];
    case 'renamed':
      return [...ids].map(
        (id) => movedEntryId(id, change.from, change.to, paths) ?? id,
      );
    case 'trashed':
      return [...ids].filter(
        (id) => !change.paths.some((path) => isEntryIdInside(id, path, paths)),
      );
  }
}
