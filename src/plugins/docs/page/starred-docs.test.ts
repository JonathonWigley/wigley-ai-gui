import { describe, expect, it } from 'vitest';
import type { UiState } from '../../../contracts/ui-state';
import { posixPaths } from '../../../shared/paths/posix-paths';
import { provisionalEntry } from './docs-state';
import { createStarredDocs, type StarredDocs } from './starred-docs';

// A uiState over a map, recording each value `set` saves under `starred`.
function fakeUiState(saved: unknown): { state: UiState; sets: unknown[] } {
  const values = new Map<string, unknown>();
  if (saved !== undefined) {
    values.set('starred', saved);
  }
  const sets: unknown[] = [];
  const state: UiState = {
    get: (key) => values.get(key),
    set: (key, value) => {
      if (key === 'starred') {
        sets.push(value);
      }
      values.set(key, value);
    },
  };
  return { state, sets };
}

function starredOver(saved: unknown): {
  starred: StarredDocs;
  sets: unknown[];
  calls: () => number;
} {
  const { state, sets } = fakeUiState(saved);
  const starred = createStarredDocs(state, posixPaths);
  let count = 0;
  starred.onChanged(() => {
    count += 1;
  });
  return { starred, sets, calls: () => count };
}

describe('createStarredDocs', () => {
  it('createStarredDocs_NoValue_Empty', () => {
    const { starred } = starredOver(undefined);
    expect([...starred.ids()]).toEqual([]);
  });

  it('createStarredDocs_SavedIds_Read', () => {
    const { starred } = starredOver(['/r/b.md', '/r/a.md']);
    expect(starred.has('/r/a.md')).toBe(true);
    expect(starred.has('/r/b.md')).toBe(true);
  });

  it('createStarredDocs_OtherShape_Empty', () => {
    for (const saved of ['x', { a: 1 }, [1, '/r/a.md'], null]) {
      const { starred, sets } = starredOver(saved);
      expect([...starred.ids()]).toEqual([]);
      expect(sets).toEqual([]);
    }
  });
});

describe('toggle', () => {
  it('toggle_Absent_AddsAndSavesSorted', () => {
    const { starred, sets, calls } = starredOver(['/r/b.md']);
    starred.toggle('/r/a.md');
    expect(sets.at(-1)).toEqual(['/r/a.md', '/r/b.md']);
    expect(calls()).toBe(1);
  });

  it('toggle_Present_RemovesAndSavesEmpty', () => {
    const { starred, sets } = starredOver(['/r/a.md']);
    starred.toggle('/r/a.md');
    expect(starred.has('/r/a.md')).toBe(false);
    expect(sets.at(-1)).toEqual([]);
  });
});

describe('onChanged', () => {
  it('onChanged_Disposed_NotCalled', () => {
    const { state } = fakeUiState(undefined);
    const starred = createStarredDocs(state, posixPaths);
    let calls = 0;
    starred
      .onChanged(() => {
        calls += 1;
      })
      .dispose();
    starred.toggle('/r/a.md');
    expect(calls).toBe(0);
  });
});

describe('applyChange', () => {
  it('applyChange_RenamedFile_MovesIdAndRunsNoListener', () => {
    const { starred, sets, calls } = starredOver(['/r/a.md']);
    starred.applyChange({ type: 'renamed', from: '/r/a.md', to: '/r/b.md' });
    expect(sets.at(-1)).toEqual(['/r/b.md']);
    expect(calls()).toBe(0);
  });

  it('applyChange_RenamedFolder_MovesIdsInside', () => {
    const { starred, sets } = starredOver([
      '/r/skills/s/SKILL.md',
      '/r/skills/s/ref.md',
      '/r/other.md',
    ]);
    starred.applyChange({
      type: 'renamed',
      from: '/r/skills/s',
      to: '/r/skills/t',
    });
    expect(sets.at(-1)).toEqual([
      '/r/other.md',
      '/r/skills/t/SKILL.md',
      '/r/skills/t/ref.md',
    ]);
  });

  it('applyChange_RenameReachesNoId_NothingSaved', () => {
    const { starred, sets, calls } = starredOver(['/r/a.md']);
    starred.applyChange({ type: 'renamed', from: '/r/x.md', to: '/r/y.md' });
    expect(sets).toEqual([]);
    expect(calls()).toBe(0);
  });

  it('applyChange_Trashed_DropsIdsAtOrInside', () => {
    const { starred, sets } = starredOver([
      '/r/a.md',
      '/r/s/SKILL.md',
      '/f/followups.md#L3',
      '/r/keep.md',
    ]);
    starred.applyChange({
      type: 'trashed',
      paths: ['/r/a.md', '/r/s', '/f/followups.md'],
    });
    expect(sets.at(-1)).toEqual(['/r/keep.md']);
  });

  it('applyChange_Created_Nothing', () => {
    const { starred, sets, calls } = starredOver(['/r/a.md']);
    starred.applyChange({
      type: 'created',
      entry: provisionalEntry('/r/b.md', 'reference', [], posixPaths),
    });
    expect(sets).toEqual([]);
    expect(calls()).toBe(0);
  });
});
