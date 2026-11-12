import { describe, expect, it } from 'vitest';
import { fakeFuzzyMatcher } from '../../../shared/fake-fuzzy-matcher.test-support';
import type { FollowupItem } from '../../../shared/followups/followup-file';
import type {
  BacklogChunk,
  BacklogHome,
  BacklogPlace,
  BacklogRead,
  BacklogStaleness,
} from '../contract';
import { rowKey } from '../row-key';
import {
  actedKeys,
  addEdit,
  allRows,
  type BacklogAction,
  type BacklogState,
  backlogReducer,
  cursorCommands,
  emptyReason,
  initialBacklogState,
  placeOf,
  stalenessNote,
  visibleRows,
} from './backlog-state';

function item(
  title: string,
  options: Partial<Omit<FollowupItem, 'title'>> = {},
): FollowupItem {
  return {
    title,
    oneLine: options.oneLine ?? `${title} gist`,
    tags: options.tags ?? [],
    body: options.body ?? '',
    line: options.line ?? 1,
    endLine: options.endLine ?? 1,
    done: options.done ?? false,
  };
}

function home(
  repo: string,
  items: FollowupItem[],
  root = `/home/${repo}/docs/features`,
): BacklogHome {
  return {
    repo,
    root,
    isCreateTarget: true,
    gitRoot: null,
    repoFolder: null,
    followupFiles: [{ path: `${root}/followups.md`, items }],
  };
}

function chunk(
  id: string,
  repo: string,
  titles: string[],
  sessionId: string | null = null,
): BacklogChunk {
  return {
    id,
    repo,
    name: titles[0] ?? id,
    titles,
    headless: false,
    sessionId,
  };
}

function staleness(
  level: BacklogStaleness['level'],
  options: Partial<BacklogStaleness> = {},
): BacklogStaleness {
  return {
    writtenAt: '2026-10-20T10:00:00+00:00',
    commitsSince: 0,
    lastCommit: null,
    namedPaths: [],
    gonePaths: [],
    level,
    ...options,
  };
}

function read(...homes: BacklogHome[]): BacklogRead {
  return { homes, message: null };
}

function run(state: BacklogState, ...actions: BacklogAction[]): BacklogState {
  return actions.reduce(
    (given, action) => backlogReducer(given, action, fakeFuzzyMatcher),
    state,
  );
}

function loaded(...homes: BacklogHome[]): BacklogState {
  return run(initialBacklogState(), { type: 'loaded', read: read(...homes) });
}

function titles(state: BacklogState): string[] {
  return visibleRows(state, fakeFuzzyMatcher).map((row) => row.item.title);
}

function selectedTitle(state: BacklogState): string | undefined {
  return visibleRows(state, fakeFuzzyMatcher).find(
    (row) => row.key === state.selectedKey,
  )?.item.title;
}

describe('allRows', () => {
  it('allRows_TwoReposDuplicateTitle_KeysByRepoFirstRowKept', () => {
    const state = loaded(
      home('alpha', [item('Same')], '/a1'),
      home('beta', [item('Same')], '/b'),
      home('alpha', [item('Same', { oneLine: 'the copy' })], '/a2'),
    );

    expect(
      allRows(state).map((row) => ({ key: row.key, path: row.path })),
    ).toEqual([
      { key: rowKey('alpha', 'Same'), path: '/a1/followups.md' },
      { key: rowKey('beta', 'Same'), path: '/b/followups.md' },
    ]);
  });

  it('allRows_ReposInterleaved_GroupsByRepo', () => {
    const state = loaded(
      home('alpha', [item('A1')], '/a1'),
      home('beta', [item('B')], '/b'),
      home('alpha', [item('A2')], '/a2'),
    );

    expect(allRows(state).map((row) => row.item.title)).toEqual([
      'A1',
      'A2',
      'B',
    ]);
  });
});

describe('visibleRows', () => {
  it('visibleRows_DoneHidden_LeavesStruckItemOut', () => {
    const state = loaded(
      home('repo', [item('Open'), item('Shipped', { done: true })]),
    );

    expect(titles(state)).toEqual(['Open']);
  });

  it('visibleRows_DoneShown_ListsStruckItem', () => {
    const state = run(
      loaded(home('repo', [item('Open'), item('Shipped', { done: true })])),
      { type: 'toggleDone' },
    );

    expect(titles(state)).toEqual(['Open', 'Shipped']);
  });

  it('visibleRows_ReadyOnly_KeepsTaggedRows', () => {
    const state = run(
      loaded(
        home('repo', [
          item('Tagged', { tags: ['needs a feature plan', 'agent-ready'] }),
          item('Untagged'),
        ]),
        home('other', [item('Other tagged', { tags: ['agent-ready'] })]),
      ),
      { type: 'toggleReadyOnly' },
    );

    expect(titles(state)).toEqual(['Tagged', 'Other tagged']);
  });

  it('visibleRows_RepoFilter_KeepsThatRepo', () => {
    const state = run(
      loaded(
        home('alpha', [item('A1'), item('A2')]),
        home('beta', [item('B1')]),
      ),
      { type: 'setRepo', repo: 'beta' },
    );

    expect(titles(state)).toEqual(['B1']);
  });

  it('visibleRows_ChunkedHidden_DropsChunkedRows', () => {
    const state = run(
      loaded(
        home('alpha', [item('Kept'), item('Chunked')]),
        home('beta', [item('Chunked')]),
      ),
      { type: 'chunksChanged', chunks: [chunk('c1', 'alpha', ['Chunked'])] },
      { type: 'toggleChunkedHidden' },
    );

    expect(allRows(state).map((row) => row.chunk?.id ?? null)).toEqual([
      null,
      'c1',
      null,
    ]);
    expect(visibleRows(state, fakeFuzzyMatcher).map((row) => row.key)).toEqual([
      rowKey('alpha', 'Kept'),
      rowKey('beta', 'Chunked'),
    ]);
  });

  it('visibleRows_StaleFirst_OrdersByLevelStably', () => {
    const state = run(
      loaded(
        home('repo', [
          item('unread'),
          item('fresh'),
          item('unknown'),
          item('moved'),
          item('stale'),
        ]),
      ),
      {
        type: 'stalenessRead',
        entries: {
          [rowKey('repo', 'fresh')]: staleness('fresh'),
          [rowKey('repo', 'unknown')]: staleness('unknown'),
          [rowKey('repo', 'moved')]: staleness('moved'),
          [rowKey('repo', 'stale')]: staleness('stale'),
        },
      },
      { type: 'toggleStaleFirst' },
    );

    expect(titles(state)).toEqual([
      'stale',
      'moved',
      'unknown',
      'fresh',
      'unread',
    ]);
  });

  it('visibleRows_Filter_MatchesTitleOneLineAndTagsIgnoringCase', () => {
    const state = run(
      loaded(
        home('repo', [
          item('Alpha cleanup'),
          item('Beta', { oneLine: 'touches the ALPHA parser' }),
          item('Gamma', { tags: ['alphabet'] }),
          item('Delta'),
        ]),
      ),
      { type: 'setFilter', text: 'alpha' },
    );

    expect(titles(state)).toEqual(['Alpha cleanup', 'Beta', 'Gamma']);
  });

  it('visibleRows_FuzzyTitle_KeepsOrder', () => {
    const state = run(
      loaded(
        home('repo', [item('Delta'), item('claude-stream')]),
        home('other', [item('cli stream'), item('Other'), item('clusters')]),
      ),
      { type: 'setFilter', text: 'clstr' },
    );

    expect(titles(state)).toEqual(['claude-stream', 'cli stream', 'clusters']);
  });

  it.each([
    { filter: 'tpt', shown: [] },
    { filter: ' TRANSPARENT ', shown: ['Beta'] },
  ])('visibleRows_OneLineIsSubstringOnly "$filter"', ({ filter, shown }) => {
    const state = run(
      loaded(home('repo', [item('Beta', { oneLine: 'A transparent wait' })])),
      { type: 'setFilter', text: filter },
    );

    expect(titles(state)).toEqual(shown);
  });
});

describe('backlogReducer', () => {
  it('backlogReducer_Reload_KeepsSelectionByTitle', () => {
    const before = run(loaded(home('repo', [item('One'), item('Two')])), {
      type: 'move',
      to: 'down',
    });

    const after = run(before, {
      type: 'loaded',
      read: read(home('repo', [item('New'), item('One'), item('Two')])),
    });

    expect(selectedTitle(after)).toBe('Two');
  });

  it('backlogReducer_SelectedItemDeleted_ClampsSelection', () => {
    const before = run(
      loaded(home('repo', [item('One'), item('Two'), item('Three')])),
      { type: 'move', to: 'bottom' },
    );

    const after = run(before, {
      type: 'loaded',
      read: read(home('repo', [item('One'), item('Two')])),
    });

    expect(selectedTitle(after)).toBe('Two');
  });

  it('loaded_GoneMarkedKey_Pruned', () => {
    const marked = run(
      loaded(home('repo', [item('One'), item('Two')])),
      { type: 'toggleMark' },
      { type: 'move', to: 'down' },
      { type: 'toggleMark' },
    );

    const after = run(marked, {
      type: 'loaded',
      read: read(home('repo', [item('Two')])),
    });

    expect(marked.marked).toEqual([
      rowKey('repo', 'One'),
      rowKey('repo', 'Two'),
    ]);
    expect(after.marked).toEqual([rowKey('repo', 'Two')]);
  });

  it('stalenessRead_Merge_ReplacesEachKeyKeepsSelection', () => {
    const one = rowKey('repo', 'One');
    const two = rowKey('repo', 'Two');
    const before = run(
      loaded(home('repo', [item('One'), item('Two')])),
      { type: 'move', to: 'down' },
      {
        type: 'stalenessRead',
        entries: { [one]: staleness('fresh'), [two]: staleness('fresh') },
      },
    );

    const after = run(before, {
      type: 'stalenessRead',
      entries: { [two]: staleness('stale') },
    });

    expect(after.staleness).toEqual({
      [one]: staleness('fresh'),
      [two]: staleness('stale'),
    });
    expect(selectedTitle(after)).toBe('Two');
  });

  it.each<{ action: BacklogAction; selected: string }>([
    { action: { type: 'toggleChunkedHidden' }, selected: 'D' },
    { action: { type: 'setRepo', repo: 'alpha' }, selected: 'B' },
    { action: { type: 'toggleReadyOnly' }, selected: 'D' },
  ])('reselect_After_$action.type', ({ action, selected }) => {
    const ready = { tags: ['agent-ready'] };
    const before = run(
      loaded(
        home('alpha', [item('A', ready), item('B', ready)]),
        home('beta', [item('C'), item('D', ready)]),
      ),
      { type: 'chunksChanged', chunks: [chunk('c1', 'beta', ['C'])] },
      { type: 'select', key: rowKey('beta', 'C') },
    );

    const after = run(before, action);

    expect(selectedTitle(after)).toBe(selected);
  });

  it('reselect_NoRowLeftWhileReview_FocusesTable', () => {
    const reviewing = run(loaded(home('repo', [item('One')])), {
      type: 'focus',
      focus: 'review',
    });

    const after = run(reviewing, { type: 'setFilter', text: 'zzz' });

    expect(reviewing.focus).toBe('review');
    expect(after.selectedKey).toBeNull();
    expect(after.focus).toBe('table');
  });

  it('focus_ReviewWithNoRow_Unchanged', () => {
    const empty = loaded(home('repo', []));

    expect(run(empty, { type: 'focus', focus: 'review' })).toBe(empty);
  });

  it.each(['review', 'strip'] as const)(
    'moveAndToggleMark_OutsideTable_DoNothing %s',
    (focus) => {
      const focused = run(loaded(home('repo', [item('One'), item('Two')])), {
        type: 'focus',
        focus,
      });

      const after = run(
        focused,
        { type: 'move', to: 'down' },
        { type: 'toggleMark' },
      );

      expect(after).toBe(focused);
    },
  );

  it('chunksChanged_StripCursorGone_MovesToSameIndex', () => {
    const before = run(
      loaded(home('repo', [item('A'), item('B'), item('C')])),
      {
        type: 'chunksChanged',
        chunks: [
          chunk('c1', 'repo', ['A']),
          chunk('c2', 'repo', ['B']),
          chunk('c3', 'repo', ['C']),
        ],
      },
      { type: 'stripSelect', chunkId: 'c2' },
    );

    const after = run(before, {
      type: 'chunksChanged',
      chunks: [chunk('c1', 'repo', ['A']), chunk('c3', 'repo', ['C'])],
    });

    expect(after.stripCursor).toBe('c3');
  });

  it('stripMove_PastEnds_Clamps', () => {
    const start = run(
      loaded(home('repo', [item('A'), item('B')])),
      {
        type: 'chunksChanged',
        chunks: [chunk('c1', 'repo', ['A']), chunk('c2', 'repo', ['B'])],
      },
      { type: 'stripSelect', chunkId: 'c1' },
    );
    const cursors: (string | null)[] = [];
    let state = run(start, { type: 'stripMove', by: -1 });
    cursors.push(state.stripCursor);
    for (let step = 0; step < 3; step++) {
      state = run(state, { type: 'stripMove', by: 1 });
      cursors.push(state.stripCursor);
    }

    expect(cursors).toEqual(['c1', 'c2', null, null]);
  });
});

describe('acted keys and chunks', () => {
  const homes = [home('repo', [item('A'), item('B'), item('C')])];

  it.each<{ name: string; actions: BacklogAction[]; keys: string[] }>([
    {
      name: 'marks in allRows order',
      actions: [
        { type: 'move', to: 'bottom' },
        { type: 'toggleMark' },
        { type: 'move', to: 'top' },
        { type: 'toggleMark' },
        { type: 'move', to: 'down' },
      ],
      keys: [rowKey('repo', 'A'), rowKey('repo', 'C')],
    },
    {
      name: 'no mark: the cursor in the table',
      actions: [{ type: 'move', to: 'down' }],
      keys: [rowKey('repo', 'B')],
    },
    {
      name: 'no mark: nothing in the strip',
      actions: [{ type: 'focus', focus: 'strip' }],
      keys: [],
    },
  ])('actedKeys_MarksElseCursor: $name', ({ actions, keys }) => {
    const state = run(loaded(...homes), ...actions);

    expect(actedKeys(state, fakeFuzzyMatcher)).toEqual(keys);
  });

  it.each([
    { cursor: 'c1', chunkId: 'c1' },
    { cursor: null, chunkId: null },
  ])('addEdit_StripCursor_ChunkIdOrNull $cursor', ({ cursor, chunkId }) => {
    const state = run(
      loaded(...homes),
      { type: 'chunksChanged', chunks: [chunk('c1', 'repo', ['C'])] },
      { type: 'stripSelect', chunkId: cursor },
    );

    expect(addEdit(state, fakeFuzzyMatcher)).toEqual({
      type: 'add',
      keys: [rowKey('repo', 'A')],
      chunkId,
    });
  });

  it.each([
    {
      name: 'no chunk',
      chunk: null,
      commands: ['mark', 'addToChunk', 'toggleCommits', 'openInDocs'],
    },
    {
      name: 'unstarted',
      chunk: chunk('c1', 'repo', ['A']),
      commands: [
        'mark',
        'addToChunk',
        'removeFromChunk',
        'startChunk',
        'toggleHeadless',
        'renameChunk',
        'toggleCommits',
        'openInDocs',
      ],
    },
    {
      name: 'started',
      chunk: chunk('c1', 'repo', ['A'], 's1'),
      commands: ['activate', 'toggleCommits', 'openInDocs'],
    },
  ])('cursorCommands_ByChunkState $name', ({ chunk, commands }) => {
    const row = {
      key: rowKey('repo', 'A'),
      repo: 'repo',
      path: '/followups.md',
      item: item('A'),
      chunk,
    };

    expect(cursorCommands(row)).toEqual(commands);
  });
});

describe('emptyReason', () => {
  it.each([
    {
      state: 'a row showing',
      given: loaded(home('repo', [item('One')])),
      reason: null,
    },
    {
      state: 'a filter matching nothing',
      given: run(loaded(home('repo', [item('One')])), {
        type: 'setFilter',
        text: 'zzz',
      }),
      reason: 'filter',
    },
    {
      state: 'every follow-up done and hidden',
      given: loaded(home('repo', [item('Shipped', { done: true })])),
      reason: 'allDone',
    },
    {
      state: "the filtered repo's follow-ups all done",
      given: run(
        loaded(
          home('repo', [item('Shipped', { done: true })]),
          home('other', [item('Open')]),
        ),
        { type: 'setRepo', repo: 'repo' },
      ),
      reason: 'allDone',
    },
    {
      state: 'ready only with none tagged',
      given: run(loaded(home('repo', [item('One')])), {
        type: 'toggleReadyOnly',
      }),
      reason: 'readyNone',
    },
    {
      state: 'every row chunked and chunked hidden',
      given: run(
        loaded(home('repo', [item('One')])),
        { type: 'chunksChanged', chunks: [chunk('c1', 'repo', ['One'])] },
        { type: 'toggleChunkedHidden' },
      ),
      reason: 'allChunked',
    },
    {
      state: 'no follow-ups',
      given: loaded(home('repo', [])),
      reason: 'nothing',
    },
    {
      state: 'a filter of only spaces',
      given: run(loaded(home('repo', [])), { type: 'setFilter', text: '   ' }),
      reason: 'nothing',
    },
  ])('is $reason with $state', ({ given, reason }) => {
    expect(emptyReason(given, fakeFuzzyMatcher)).toBe(reason);
  });
});

describe('stalenessNote', () => {
  it.each([
    { name: 'no entry', given: undefined, note: 'Staleness not read yet.' },
    {
      name: 'unknown',
      given: staleness('unknown', { writtenAt: null }),
      note: 'Unknown: not in git history.',
    },
    {
      name: 'fresh with no paths',
      given: staleness('fresh'),
      note: 'Fresh: written 2026-10-20 · names no paths',
    },
    {
      name: 'fresh with two paths and no commits',
      given: staleness('fresh', { namedPaths: ['src/a.ts', 'src/b.ts'] }),
      note: 'Fresh: written 2026-10-20 · 0 commits since on 2 named paths',
    },
    {
      name: 'moved with one commit on one path',
      given: staleness('moved', {
        commitsSince: 1,
        namedPaths: ['src/a.ts'],
        lastCommit: {
          sha: 'abcdef1234',
          subject: 'Fix the strip',
          at: '2026-10-21T10:00:00+00:00',
          paths: ['src/a.ts'],
        },
      }),
      note: 'Moved: written 2026-10-20 · 1 commit since on 1 named path · last: Fix the strip',
    },
    {
      name: 'stale with two gone paths',
      given: staleness('stale', {
        commitsSince: 3,
        namedPaths: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
        gonePaths: ['src/a.ts', 'src/b.ts'],
      }),
      note: 'Stale: written 2026-10-20 · 3 commits since on 3 named paths · gone: src/a.ts, src/b.ts',
    },
    {
      name: 'stale not yet in git history',
      given: staleness('stale', {
        writtenAt: null,
        namedPaths: ['src/gone.ts'],
        gonePaths: ['src/gone.ts'],
      }),
      note: 'Stale: not in git history yet · gone: src/gone.ts',
    },
  ])('stalenessNote_ByLevel $name', ({ given, note }) => {
    expect(stalenessNote(given)).toBe(note);
  });
});

describe('placeRestored', () => {
  const homes = read(
    home('alpha', [item('First')]),
    home('beta', [item('Alpha'), item('Beta')]),
  );
  const beta = rowKey('beta', 'Beta');
  const saved = (place: Partial<BacklogPlace>): BacklogPlace => ({
    selectedKey: beta,
    repo: 'beta',
    filter: '',
    marked: [beta],
    isReadyOnly: false,
    isChunkedHidden: false,
    isStaleFirst: true,
    isDoneShown: true,
    isAssistantShown: false,
    ...place,
  });

  it.each([
    {
      name: 'a held repo and row',
      place: saved({}),
      expected: saved({}),
      selected: 'Beta',
    },
    {
      name: 'a gone repo filters nothing',
      place: saved({ repo: 'gone', selectedKey: null }),
      expected: saved({ repo: null, selectedKey: rowKey('alpha', 'First') }),
      selected: 'First',
    },
    {
      name: 'a gone mark is pruned',
      place: saved({ marked: [rowKey('beta', 'Gone'), beta] }),
      expected: saved({ marked: [beta] }),
      selected: 'Beta',
    },
    {
      name: 'a gone row selects the first',
      place: saved({ selectedKey: rowKey('beta', 'Gone') }),
      expected: saved({ selectedKey: rowKey('beta', 'Alpha') }),
      selected: 'Alpha',
    },
  ])('placeRestored: $name', ({ place, expected, selected }) => {
    const state = run(
      initialBacklogState(),
      { type: 'loaded', read: homes },
      { type: 'focus', focus: 'strip' },
      { type: 'placeRestored', place },
    );

    expect(placeOf(state, false)).toEqual(expected);
    expect(selectedTitle(state)).toBe(selected);
    expect(state.focus).toBe('table');
  });
});
