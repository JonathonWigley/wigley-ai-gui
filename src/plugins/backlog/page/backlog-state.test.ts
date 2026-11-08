import { describe, expect, it } from 'vitest';
import { fakeFuzzyMatcher } from '../../../shared/fake-fuzzy-matcher.test-support';
import type { FollowupItem } from '../../../shared/followups/followup-file';
import type {
  BacklogFeature,
  BacklogHome,
  BacklogPlan,
  BacklogRead,
} from '../contract';
import {
  actedFollowup,
  type BacklogAction,
  type BacklogState,
  backlogReducer,
  draftOf,
  editorEdit,
  emptyReason,
  initialBacklogState,
  rowTitle,
  visibleRows,
  withTagToggled,
} from './backlog-state';

const ROOT = '/home/repo/docs/features';

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

function plan(title: string, taskTitles: string[]): BacklogPlan {
  const folder = `${ROOT}/feature/plan-${title}`;
  return {
    path: `${folder}/plan.md`,
    copyPath: `${folder}/plan.md`,
    feature: 'feature',
    title,
    checked: 0,
    total: taskTitles.length,
    target: null,
    written: null,
    tasks: taskTitles.map((task) => ({
      path: `${folder}/${task}.md`,
      copyPath: `${folder}/${task}.md`,
      title: task,
      status: null,
    })),
  };
}

function home(
  root: string,
  items: FollowupItem[],
  plans: BacklogPlan[] = [],
): BacklogHome {
  return {
    repo: 'repo',
    root,
    isCreateTarget: true,
    gitRoot: null,
    uncommitted: false,
    followupFiles: [{ path: `${root}/followups.md`, items }],
    plans,
    features: [],
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

// The state after loading `homes` and opening the first.
function opened(...homes: BacklogHome[]): BacklogState {
  return run(
    initialBacklogState(),
    { type: 'loaded', read: read(...homes) },
    { type: 'openHome', root: homes[0].root },
  );
}

function titles(state: BacklogState): string[] {
  return visibleRows(state, fakeFuzzyMatcher).map(rowTitle);
}

function selectedTitle(state: BacklogState): string | undefined {
  const row = visibleRows(state, fakeFuzzyMatcher).find(
    (each) => each.key === state.selectedKey,
  );
  return row === undefined ? undefined : rowTitle(row);
}

describe('visibleRows', () => {
  it('visibleRows_DoneHidden_LeavesStruckItemOut', () => {
    const state = opened(
      home(ROOT, [item('Open'), item('Shipped', { done: true })]),
    );

    expect(titles(state)).toEqual(['Open']);
  });

  it('visibleRows_DoneShown_ListsStruckItem', () => {
    const state = run(
      opened(home(ROOT, [item('Open'), item('Shipped', { done: true })])),
      { type: 'toggleDone' },
    );

    expect(titles(state)).toEqual(['Open', 'Shipped']);
  });

  it('visibleRows_AgentReadyOnly_KeepsTaggedFollowupsAndHidesPlans', () => {
    const state = run(
      opened(
        home(
          ROOT,
          [
            item('Tagged', { tags: ['needs a feature plan', 'agent-ready'] }),
            item('Untagged'),
          ],
          [plan('The plan', ['01-task'])],
        ),
      ),
      { type: 'toggleAgentReadyOnly' },
    );

    expect(titles(state)).toEqual(['Tagged']);
  });

  it('visibleRows_Filter_MatchesTitleOneLineAndTagsIgnoringCase', () => {
    const state = run(
      opened(
        home(ROOT, [
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
    const feature = {
      slug: 'clusters',
      path: `${ROOT}/clusters`,
      tasks: [],
    } as unknown as BacklogFeature;
    const state = run(
      opened({
        ...home(
          ROOT,
          [item('Delta'), item('claude-stream')],
          [plan('cli stream', []), plan('Other', [])],
        ),
        features: [feature],
      }),
      { type: 'setFilter', text: 'clstr' },
    );

    expect(titles(state)).toEqual(['claude-stream', 'cli stream', 'clusters']);
  });

  it.each([
    { filter: 'tpt', shown: [] },
    { filter: ' TRANSPARENT ', shown: ['Beta'] },
  ])('visibleRows_OneLineIsSubstringOnly "$filter"', ({ filter, shown }) => {
    const state = run(
      opened(home(ROOT, [item('Beta', { oneLine: 'A transparent wait' })])),
      { type: 'setFilter', text: filter },
    );

    expect(titles(state)).toEqual(shown);
  });
});

describe('backlogReducer', () => {
  it('backlogReducer_Reload_KeepsSelectionByTitle', () => {
    const before = run(opened(home(ROOT, [item('One'), item('Two')])), {
      type: 'move',
      to: 'down',
    });

    const after = run(before, {
      type: 'loaded',
      read: read(home(ROOT, [item('New'), item('One'), item('Two')])),
    });

    expect(selectedTitle(after)).toBe('Two');
  });

  it('backlogReducer_SelectedItemDeleted_ClampsSelection', () => {
    const before = run(
      opened(home(ROOT, [item('One'), item('Two'), item('Three')])),
      { type: 'move', to: 'bottom' },
    );

    const after = run(before, {
      type: 'loaded',
      read: read(home(ROOT, [item('One'), item('Two')])),
    });

    expect(selectedTitle(after)).toBe('Two');
  });

  it('backlogReducer_SelectFollowupBeforeItsLoad_SelectsItWhenTheLoadLands', () => {
    const before = run(opened(home(ROOT, [item('One')])), {
      type: 'selectFollowup',
      title: 'Created',
    });

    const after = run(before, {
      type: 'loaded',
      read: read(home(ROOT, [item('One'), item('Created')])),
    });

    expect(selectedTitle(before)).toBe('One');
    expect(selectedTitle(after)).toBe('Created');
    expect(after.pendingSelect).toBeNull();
  });

  it('backlogReducer_LoadWithoutPendingFollowup_ClearsIt', () => {
    const after = run(
      opened(home(ROOT, [item('One')])),
      { type: 'selectFollowup', title: 'Created' },
      { type: 'loaded', read: read(home(ROOT, [item('One')])) },
      {
        type: 'loaded',
        read: read(home(ROOT, [item('One'), item('Created')])),
      },
    );

    expect(selectedTitle(after)).toBe('One');
  });

  it.each<BacklogAction>([
    { type: 'setFilter', text: 'on' },
    { type: 'toggleDone' },
    { type: 'toggleAgentReadyOnly' },
  ])(
    'backlogReducer_PendingFollowupThenFilterOrToggle_ClearsPendingFollowup %#',
    (change) => {
      const pending = run(
        opened(home(ROOT, [item('One'), item('Saved')])),
        { type: 'setFilter', text: 'one' },
        { type: 'selectFollowup', title: 'Saved' },
      );

      const after = run(pending, change);

      expect(pending.pendingSelect).toBe('Saved');
      expect(after.pendingSelect).toBeNull();
    },
  );

  it('backlogReducer_MoveEditorBaseline_BaselineMovesDraftKept', () => {
    const onDisk = {
      title: 'One',
      oneLine: 'moved on',
      tags: [],
      body: 'Agent body.',
    };

    const after = run(
      opened(home(ROOT, [item('One')])),
      { type: 'openEdit' },
      { type: 'draftChanged', field: 'body', text: 'typed' },
      {
        type: 'moveEditorBaseline',
        path: `${ROOT}/followups.md`,
        title: 'One',
        baseline: onDisk,
      },
    );
    const { editor } = after;
    if (editor === null) {
      throw new Error('no editor open');
    }

    expect(editorEdit(editor)).toMatchObject({
      type: 'edit',
      title: 'One',
      draft: { body: 'typed' },
      baseline: onDisk,
    });
  });

  it('backlogReducer_MoveEditorBaselineOnCreate_Unchanged', () => {
    const creating = run(opened(home(ROOT, [])), { type: 'openCreate' });

    const after = run(creating, {
      type: 'moveEditorBaseline',
      path: null,
      title: 'X',
      baseline: { title: 'X', oneLine: '', tags: [], body: '' },
    });

    expect(after).toBe(creating);
  });

  it.each([
    { path: `${ROOT}/other.md`, title: 'One' },
    { path: `${ROOT}/followups.md`, title: 'Two' },
  ])(
    'backlogReducer_MoveEditorBaselineForAnotherItem_Unchanged %#',
    ({ path, title }) => {
      const editing = run(opened(home(ROOT, [item('One'), item('Two')])), {
        type: 'openEdit',
      });

      const after = run(editing, {
        type: 'moveEditorBaseline',
        path,
        title,
        baseline: { title, oneLine: 'moved on', tags: [], body: '' },
      });

      expect(after).toBe(editing);
    },
  );

  it('backlogReducer_ReloadWithEditorOpen_KeepsEditorAndDraft', () => {
    const editing = run(
      opened(home(ROOT, [item('One')])),
      { type: 'openEdit' },
      { type: 'draftChanged', field: 'body', text: 'typed' },
    );

    const after = run(editing, {
      type: 'loaded',
      read: read(home(ROOT, [item('One'), item('Two')])),
    });

    expect(after.editor).toEqual(editing.editor);
    expect(after.editor?.draft.body).toBe('typed');
  });

  it('backlogReducer_OpenHomeGone_ClosesItAndFocusesHomes', () => {
    const other = '/home/other/docs/features';

    const after = run(opened(home(ROOT, [item('One')])), {
      type: 'loaded',
      read: read(home(other, [item('Two')])),
    });

    expect(after).toMatchObject({
      openRoot: null,
      selectedKey: null,
      focus: 'homes',
    });
  });

  it('backlogReducer_OpenHomeGoneWithEditorOpen_KeepsEditorAndFocus', () => {
    const other = '/home/other/docs/features';
    const editing = run(opened(home(ROOT, [item('One')])), {
      type: 'openEdit',
    });

    const after = run(editing, {
      type: 'loaded',
      read: read(home(other, [item('Two')])),
    });

    expect(after).toMatchObject({
      openRoot: null,
      selectedKey: null,
      focus: 'detail',
    });
    expect(after.editor).toEqual(editing.editor);
  });

  it('backlogReducer_FollowupKeysWithFocusOnHomes_ActOnNothing', () => {
    const onHomes = run(opened(home(ROOT, [item('One')])), { type: 'back' });

    const afterEdit = run(onHomes, { type: 'openEdit' });
    const afterDelete = run(onHomes, { type: 'askDelete' });

    expect(selectedTitle(onHomes)).toBe('One');
    expect(actedFollowup(onHomes, fakeFuzzyMatcher)).toBeNull();
    expect(afterEdit.editor).toBeNull();
    expect(afterDelete.confirm).toBeNull();
  });

  it('backlogReducer_FollowupKeysWithFocusOnItems_ActOnSelectedFollowup', () => {
    const state = opened(home(ROOT, [item('One')]));

    expect(actedFollowup(state, fakeFuzzyMatcher)?.item.title).toBe('One');
    expect(run(state, { type: 'openEdit' }).editor?.baseline?.title).toBe(
      'One',
    );
  });

  it('editorEdit_EditOpenedThenTyped_EditOfOpenedItemWithItAsBaseline', () => {
    const one = item('One', { tags: ['agent-ready'], body: 'Old body.' });
    const editing = run(
      opened(home(ROOT, [one])),
      { type: 'openEdit' },
      { type: 'draftChanged', field: 'title', text: 'Renamed' },
    );
    const { editor } = editing;
    if (editor === null) {
      throw new Error('no editor open');
    }

    expect(editorEdit(editor)).toEqual({
      type: 'edit',
      title: 'One',
      draft: {
        title: 'Renamed',
        oneLine: 'One gist',
        tags: ['agent-ready'],
        body: 'Old body.',
      },
      baseline: {
        title: 'One',
        oneLine: 'One gist',
        tags: ['agent-ready'],
        body: 'Old body.',
      },
    });
  });

  it('editorEdit_Create_NoBaseline', () => {
    const creating = run(opened(home(ROOT, [])), { type: 'openCreate' });
    const { editor } = creating;
    if (editor === null) {
      throw new Error('no editor open');
    }

    expect(editorEdit(editor)).toEqual({
      type: 'create',
      draft: { title: '', oneLine: '', tags: [], body: '' },
    });
  });

  it('backlogReducer_OpenHomeThenBack_MovesFocusBetweenHomesAndItems', () => {
    const other = '/home/other/docs/features';
    const loaded = run(initialBacklogState(), {
      type: 'loaded',
      read: read(home(ROOT, [item('One')]), home(other, [item('Two')])),
    });

    const inItems = run(loaded, { type: 'move', to: 'down' }, { type: 'open' });
    const backInHomes = run(inItems, { type: 'back' });

    expect(inItems).toMatchObject({ focus: 'items', openRoot: other });
    expect(selectedTitle(inItems)).toBe('Two');
    expect(backInHomes).toMatchObject({
      focus: 'homes',
      openRoot: other,
      homeCursor: 1,
    });
  });

  it('backlogReducer_ToggleOnPlan_ExpandsTaskRowsUnderItThenCollapses', () => {
    const state = run(
      opened(
        home(ROOT, [item('One')], [plan('The plan', ['01-first', '02-next'])]),
      ),
      { type: 'move', to: 'down' },
    );

    const expanded = run(state, { type: 'toggle' });
    const collapsed = run(expanded, { type: 'toggle' });

    expect(titles(state)).toEqual(['One', 'The plan']);
    expect(titles(expanded)).toEqual([
      'One',
      'The plan',
      '01-first',
      '02-next',
    ]);
    expect(titles(collapsed)).toEqual(['One', 'The plan']);
  });

  it('backlogReducer_MoveThroughExpandedPlan_SelectsTaskRows', () => {
    const state = run(
      opened(home(ROOT, [], [plan('The plan', ['01-first', '02-next'])])),
      { type: 'toggle' },
      { type: 'move', to: 'down' },
      { type: 'move', to: 'down' },
    );

    expect(selectedTitle(state)).toBe('02-next');
  });
});

describe('emptyReason', () => {
  it.each([
    {
      state: 'a row showing',
      given: opened(home(ROOT, [item('One')])),
      reason: null,
    },
    {
      state: 'agent-ready only with none tagged',
      given: run(opened(home(ROOT, [item('One')])), {
        type: 'toggleAgentReadyOnly',
      }),
      reason: 'agentReadyNone',
    },
    {
      state: 'every follow-up done and hidden',
      given: opened(home(ROOT, [item('Shipped', { done: true })])),
      reason: 'allDone',
    },
    {
      state: 'every follow-up done with agent-ready only',
      given: run(
        opened(
          home(ROOT, [item('Shipped', { done: true, tags: ['agent-ready'] })]),
        ),
        { type: 'toggleAgentReadyOnly' },
      ),
      reason: 'allDone',
    },
    {
      state: 'a filter matching nothing',
      given: run(opened(home(ROOT, [item('One')])), {
        type: 'setFilter',
        text: 'zzz',
      }),
      reason: 'filter',
    },
    {
      state: 'no follow-ups or plans',
      given: opened(home(ROOT, [])),
      reason: 'nothing',
    },
    {
      state: 'a filter of only spaces',
      given: run(opened(home(ROOT, [])), { type: 'setFilter', text: '   ' }),
      reason: 'nothing',
    },
    { state: 'no home open', given: initialBacklogState(), reason: 'noHome' },
  ])('is $reason with $state', ({ given, reason }) => {
    expect(emptyReason(given, fakeFuzzyMatcher)).toBe(reason);
  });
});

describe('draftOf', () => {
  it('draftOf_LineBreaksInOneLineFields_JoinWithASpace', () => {
    const draft = draftOf({
      title: 'Split\n title',
      oneLine: 'the gist',
      tags: 'agent-ready,\n needs a feature plan, ',
      body: 'First line.\n\nSecond paragraph.\n',
    });

    expect(draft).toEqual({
      title: 'Split title',
      oneLine: 'the gist',
      tags: ['agent-ready', 'needs a feature plan'],
      body: 'First line.\n\nSecond paragraph.',
    });
  });
});

describe('withTagToggled', () => {
  it('withTagToggled_Present_RemovesItKeepingOrder', () => {
    expect(withTagToggled(['a', 'agent-ready', 'b'], 'agent-ready')).toEqual([
      'a',
      'b',
    ]);
  });

  it('withTagToggled_Absent_AppendsIt', () => {
    expect(withTagToggled(['a'], 'agent-ready')).toEqual(['a', 'agent-ready']);
  });
});
