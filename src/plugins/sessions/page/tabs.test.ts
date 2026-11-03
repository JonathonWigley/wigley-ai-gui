import { describe, expect, it } from 'vitest';
import type { SessionsState } from '../contract';
import {
  hasOtherSession,
  hasOtherTab,
  isRoundToast,
  isSameVisibleTab,
  mayClose,
  NO_TABS,
  roundToastText,
  rowChanges,
  rowStatus,
  showsEmptyText,
  showsNoSelectionText,
  stepSession,
  stepTab,
  type TabsState,
  tabsAfterAdd,
  tabsAfterRelease,
  tabsAfterRemove,
  tabsAfterSelect,
  tabsAfterTakeOver,
  visibleTab,
} from './tabs';

function stateOf(
  sessionIds: string[],
  selectedSessionId: string | null,
): SessionsState {
  return {
    rows: sessionIds.map((sessionId) => ({
      sessionId,
      label: sessionId,
      harness: null,
      marked: false,
      projectDir: null,
      hostSessionId: null,
      titles: { user: null, agent: null, firstMessage: null },
    })),
    selectedSessionId,
  };
}

describe('tabs', () => {
  it.each([
    { rows: ['a', 'b', 'c'], selected: 'a', step: 1, skip: [], expected: 'b' },
    { rows: ['a', 'b', 'c'], selected: 'c', step: 1, skip: [], expected: 'a' },
    { rows: ['a', 'b', 'c'], selected: 'a', step: -1, skip: [], expected: 'c' },
    { rows: ['a', 'b'], selected: null, step: 1, skip: [], expected: 'a' },
    { rows: ['a', 'b'], selected: null, step: -1, skip: [], expected: 'b' },
    { rows: [], selected: null, step: 1, skip: [], expected: null },
    { rows: ['a'], selected: 'a', step: 1, skip: [], expected: null },
    {
      rows: ['s1', 's2', 's3'],
      selected: 's1',
      step: 1,
      skip: ['s2'],
      expected: 's3',
    },
    {
      rows: ['s1', 's2'],
      selected: 's1',
      step: 1,
      skip: ['s2'],
      expected: null,
    },
    {
      rows: ['s1', 's2', 's3'],
      selected: 's2',
      step: 1,
      skip: ['s2'],
      expected: 's3',
    },
  ] as const)(
    'stepSession over $rows from $selected by $step skipping $skip gives $expected',
    ({ rows, selected, step, skip, expected }) => {
      expect(
        stepSession(stateOf([...rows], selected), step, new Set(skip)),
      ).toBe(expected);
    },
  );

  it('stepTab wraps, picks an end with none selected, and finds nothing under two tabs', () => {
    expect(stepTab(['form', 'docs'], 'form', 1)).toBe('docs');
    expect(stepTab(['form', 'docs'], 'docs', 1)).toBe('form');
    expect(stepTab(['form', 'docs'], null, -1)).toBe('docs');
    expect(stepTab(['form'], 'form', 1)).toBeNull();
  });

  it.each([
    { rows: ['s1', 's2'], skip: [], expected: true },
    { rows: ['s1', 's2'], skip: ['s2'], expected: false },
  ])(
    'hasOtherSession over $rows from s1 skipping $skip is $expected',
    ({ rows, skip, expected }) => {
      expect(hasOtherSession(stateOf(rows, 's1'), new Set(skip))).toBe(
        expected,
      );
    },
  );

  it('hasOtherTab is false under two tabs and true from two', () => {
    expect(hasOtherTab([], null)).toBe(false);
    expect(hasOtherTab(['t1'], 't1')).toBe(false);
    expect(hasOtherTab(['t1', 't2'], 't1')).toBe(true);
  });

  it.each([
    {
      tabs: NO_TABS,
      tabId: 'form',
      expected: { tabIds: ['form'], selectedTabId: 'form', selections: 0 },
    },
    {
      tabs: { tabIds: ['form'], selectedTabId: 'form', selections: 2 },
      tabId: 'docs',
      expected: {
        tabIds: ['form', 'docs'],
        selectedTabId: 'form',
        selections: 2,
      },
    },
  ])(
    'tabsAfterAdd of $tabId to $tabs.tabIds gives $expected',
    ({ tabs, tabId, expected }) => {
      expect(tabsAfterAdd(tabs, 's', tabId)).toEqual(expected);
    },
  );

  it('tabsAfterAdd throws on a duplicate id', () => {
    const tabs: TabsState = {
      tabIds: ['form'],
      selectedTabId: 'form',
      selections: 0,
    };

    expect(() => tabsAfterAdd(tabs, 's', 'form')).toThrow(
      'Session s already has a tab "form"',
    );
  });

  it.each([
    {
      tabs: { tabIds: ['a', 'b', 'c'], selectedTabId: 'b', selections: 2 },
      tabId: 'b',
      expected: { tabIds: ['a', 'c'], selectedTabId: 'c', selections: 2 },
    },
    {
      tabs: { tabIds: ['a', 'b', 'c'], selectedTabId: 'c', selections: 1 },
      tabId: 'c',
      expected: { tabIds: ['a', 'b'], selectedTabId: 'b', selections: 1 },
    },
    {
      tabs: { tabIds: ['a'], selectedTabId: 'a', selections: 0 },
      tabId: 'a',
      expected: NO_TABS,
    },
    {
      tabs: { tabIds: ['a', 'b', 'c'], selectedTabId: 'c', selections: 3 },
      tabId: 'a',
      expected: { tabIds: ['b', 'c'], selectedTabId: 'c', selections: 3 },
    },
  ])(
    'tabsAfterRemove of $tabId from $tabs gives $expected',
    ({ tabs, tabId, expected }) => {
      expect(tabsAfterRemove(tabs, tabId)).toEqual(expected);
    },
  );

  it('tabsAfterSelect selects a present tab, counting it, and returns the same value for an absent one', () => {
    const tabs: TabsState = {
      tabIds: ['a', 'b'],
      selectedTabId: 'a',
      selections: 2,
    };

    expect(tabsAfterSelect(tabs, 'b')).toEqual({
      tabIds: ['a', 'b'],
      selectedTabId: 'b',
      selections: 3,
    });
    expect(tabsAfterSelect(tabs, 'x')).toBe(tabs);
  });

  it('tabsAfterTakeOver selects the tab and remembers the one selected before', () => {
    const tabs: TabsState = {
      tabIds: ['chat', 'form'],
      selectedTabId: 'chat',
      selections: 2,
    };

    const taken = tabsAfterTakeOver(tabs, 'form');

    expect(taken.tabs).toEqual({
      tabIds: ['chat', 'form'],
      selectedTabId: 'form',
      selections: 2,
    });
    expect(taken.takeOver).toEqual({
      tabId: 'form',
      previousTabId: 'chat',
      selections: 2,
    });
  });

  it('tabsAfterRelease gives the session back while the taking tab is selected', () => {
    const tabs: TabsState = {
      tabIds: ['chat', 'form'],
      selectedTabId: 'chat',
      selections: 2,
    };
    const taken = tabsAfterTakeOver(tabs, 'form');

    expect(tabsAfterRelease(taken.tabs, taken.takeOver)).toEqual({
      tabIds: ['chat', 'form'],
      selectedTabId: 'chat',
      selections: 2,
    });
  });

  it('tabsAfterRelease gives the session back after a tab was added since the take over', () => {
    const tabs: TabsState = {
      tabIds: ['chat', 'form'],
      selectedTabId: 'chat',
      selections: 2,
    };
    const taken = tabsAfterTakeOver(tabs, 'form');
    const added = tabsAfterAdd(taken.tabs, 's', 'docs');

    expect(tabsAfterRelease(added, taken.takeOver)).toEqual({
      tabIds: ['chat', 'form', 'docs'],
      selectedTabId: 'chat',
      selections: 2,
    });
  });

  it('tabsAfterRelease keeps a selection the user moved since', () => {
    const tabs: TabsState = {
      tabIds: ['chat', 'form', 'docs'],
      selectedTabId: 'docs',
      selections: 0,
    };

    expect(
      tabsAfterRelease(tabs, {
        tabId: 'form',
        previousTabId: 'chat',
        selections: 0,
      }),
    ).toBe(tabs);
  });

  it('tabsAfterRelease keeps the taking tab when the user left it and came back', () => {
    const tabs: TabsState = {
      tabIds: ['chat', 'form'],
      selectedTabId: 'chat',
      selections: 0,
    };
    const taken = tabsAfterTakeOver(tabs, 'form');
    const movedBack = tabsAfterSelect(
      tabsAfterSelect(taken.tabs, 'chat'),
      'form',
    );

    expect(tabsAfterRelease(movedBack, taken.takeOver)).toBe(movedBack);
  });

  it('tabsAfterRelease keeps the selection when the remembered tab is gone', () => {
    const tabs: TabsState = {
      tabIds: ['form'],
      selectedTabId: 'form',
      selections: 0,
    };

    expect(
      tabsAfterRelease(tabs, {
        tabId: 'form',
        previousTabId: 'chat',
        selections: 0,
      }),
    ).toBe(tabs);
  });

  it('tabsAfterRelease changes nothing once the taking tab was removed', () => {
    const tabs: TabsState = {
      tabIds: ['chat', 'form', 'docs'],
      selectedTabId: 'chat',
      selections: 0,
    };
    const taken = tabsAfterTakeOver(tabs, 'form');
    const removed = tabsAfterRemove(taken.tabs, 'form');

    const released = tabsAfterRelease(removed, taken.takeOver);

    expect(released).toBe(removed);
    expect(released.selectedTabId).toBe('docs');
  });

  it('tabsAfterTakeOver with none selected remembers none, and its release keeps the selection', () => {
    const taken = tabsAfterTakeOver(
      { tabIds: ['form'], selectedTabId: null, selections: 0 },
      'form',
    );
    const selected: TabsState = {
      tabIds: ['form'],
      selectedTabId: 'form',
      selections: 0,
    };

    expect(taken.takeOver.previousTabId).toBeNull();
    expect(tabsAfterRelease(selected, taken.takeOver)).toBe(selected);
  });

  it('tabsAfterTakeOver of the selected tab remembers itself, and its release changes nothing', () => {
    const tabs: TabsState = {
      tabIds: ['chat', 'form'],
      selectedTabId: 'form',
      selections: 0,
    };

    const taken = tabsAfterTakeOver(tabs, 'form');

    expect(taken.tabs).toBe(tabs);
    expect(taken.takeOver.previousTabId).toBe('form');
    expect(tabsAfterRelease(taken.tabs, taken.takeOver)).toBe(tabs);
  });

  it('stacked take overs each give back what they took', () => {
    const tabs: TabsState = {
      tabIds: ['chat', 'form', 'docs'],
      selectedTabId: 'chat',
      selections: 0,
    };
    const form = tabsAfterTakeOver(tabs, 'form');
    const docs = tabsAfterTakeOver(form.tabs, 'docs');

    const docsFirst = tabsAfterRelease(docs.tabs, docs.takeOver);
    expect(docsFirst.selectedTabId).toBe('form');
    expect(tabsAfterRelease(docsFirst, form.takeOver).selectedTabId).toBe(
      'chat',
    );

    const formFirst = tabsAfterRelease(docs.tabs, form.takeOver);
    expect(formFirst).toBe(docs.tabs);
    expect(formFirst.selectedTabId).toBe('docs');
    expect(tabsAfterRelease(formFirst, docs.takeOver).selectedTabId).toBe(
      'form',
    );
  });

  it('stacked take overs give back nothing once the user moved between them', () => {
    const tabs: TabsState = {
      tabIds: ['chat', 'form', 'docs'],
      selectedTabId: 'chat',
      selections: 0,
    };
    const form = tabsAfterTakeOver(tabs, 'form');
    const docs = tabsAfterTakeOver(form.tabs, 'docs');
    const movedBack = tabsAfterSelect(
      tabsAfterSelect(docs.tabs, 'chat'),
      'docs',
    );

    const docsReleased = tabsAfterRelease(movedBack, docs.takeOver);
    expect(docsReleased).toBe(movedBack);
    expect(tabsAfterRelease(docsReleased, form.takeOver)).toBe(movedBack);
  });

  it('rowStatus takes the last non-empty status in add order', () => {
    expect(rowStatus(['a 1/2', '', 'b'])).toBe('b');
    expect(rowStatus(['', ''])).toBeNull();
  });

  it('roundToastText names the keys, or only the session with none bound', () => {
    expect(roundToastText('x', 'Space k s')).toMatch(/x.*Space k s/);
    expect(roundToastText('x', null)).toContain('x');
  });

  it('rowChanges lists added rows in their order and removed ids', () => {
    const before = stateOf(['a', 'b', 'e', 'f'], null).rows;
    const after = stateOf(['f', 'b', 'c', 'e', 'd'], null).rows.map((row) =>
      row.sessionId === 'b' || row.sessionId === 'f'
        ? { ...row, hostSessionId: `${row.sessionId}-new` }
        : row,
    );

    const changes = rowChanges(before, after);

    expect(changes.added.map((row) => row.sessionId)).toEqual(['c', 'd']);
    expect(changes.removed).toEqual(['a']);
    expect(changes.changed.map((row) => row.sessionId)).toEqual(['f', 'b']);
  });

  it('isRoundToast only when main selects from none while the mode is hidden', () => {
    expect(isRoundToast(null, 'a', false)).toBe(true);
    expect(isRoundToast(null, 'a', true)).toBe(false);
    expect(isRoundToast('b', 'a', false)).toBe(false);
    expect(isRoundToast(undefined, 'a', false)).toBe(false);
    expect(isRoundToast(null, null, false)).toBe(false);
  });

  it('showsEmptyText and showsNoSelectionText', () => {
    expect(showsEmptyText(null)).toBe(false);
    expect(showsNoSelectionText(null)).toBe(false);
    expect(showsEmptyText(stateOf([], null))).toBe(true);
    expect(showsNoSelectionText(stateOf([], null))).toBe(false);
    expect(showsEmptyText(stateOf(['a'], null))).toBe(false);
    expect(showsNoSelectionText(stateOf(['a'], null))).toBe(true);
    expect(showsEmptyText(stateOf(['a'], 'a'))).toBe(false);
    expect(showsNoSelectionText(stateOf(['a'], 'a'))).toBe(false);
  });

  it('mayClose stops at the first guard that keeps the session', () => {
    const calls: number[] = [];
    const guards = (answers: boolean[]) =>
      answers.map((answer, i) => ({
        beforeClose: () => {
          calls.push(i);
          return answer;
        },
      }));

    expect(mayClose(guards([true, false, true]))).toBe(false);
    expect(calls).toEqual([0, 1]);
    expect(mayClose([])).toBe(true);
    expect(mayClose(guards([true, true]))).toBe(true);
  });

  it('visibleTab is null while the mode is hidden, none with no tab, else the selected tab', () => {
    expect(visibleTab(false, 'a', 'form')).toBeNull();
    expect(visibleTab(true, null, null)).toBe('none');
    expect(visibleTab(true, 'a', null)).toBe('none');
    expect(visibleTab(true, 'a', 'form')).toEqual({
      sessionId: 'a',
      tabId: 'form',
    });
  });

  it('isSameVisibleTab compares by value', () => {
    expect(isSameVisibleTab(null, null)).toBe(true);
    expect(isSameVisibleTab('none', 'none')).toBe(true);
    expect(
      isSameVisibleTab(
        { sessionId: 'a', tabId: 'form' },
        { sessionId: 'a', tabId: 'form' },
      ),
    ).toBe(true);
    expect(
      isSameVisibleTab(
        { sessionId: 'a', tabId: 'form' },
        { sessionId: 'b', tabId: 'form' },
      ),
    ).toBe(false);
    expect(isSameVisibleTab('none', null)).toBe(false);
  });
});
