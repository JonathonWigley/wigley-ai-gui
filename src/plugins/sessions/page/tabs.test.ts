import { describe, expect, it } from 'vitest';
import type { SessionsState } from '../contract';
import { sessionRow } from '../contract.test-support';
import {
  hasOtherSession,
  hasOtherTab,
  isMarkToast,
  isSameVisibleTab,
  closesAtOnce,
  mayClose,
  NO_TABS,
  markToastText,
  rowChanges,
  takeOversAfterRelease,
  showsEmptyText,
  showsNoSelectionText,
  stepSession,
  stepTab,
  type TabsState,
  tabsAfterAdd,
  tabsAfterRelease,
  tabsAfterRemove,
  tabsAfterRestoredAdd,
  tabsAfterSelect,
  tabsAfterTakeOver,
  visibleTab,
} from './tabs';

function stateOf(
  sessionIds: string[],
  selectedSessionId: string | null,
): SessionsState {
  return {
    rows: sessionIds.map((sessionId) =>
      sessionRow(sessionId, { label: sessionId, harness: null }),
    ),
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

  it.each<{
    tabs: TabsState;
    tabId: string;
    orders: Record<string, number>;
    expected: TabsState;
  }>([
    {
      tabs: NO_TABS,
      tabId: 'form',
      orders: {},
      expected: { tabIds: ['form'], selectedTabId: 'form', selections: 0 },
    },
    {
      tabs: { tabIds: ['form'], selectedTabId: 'form', selections: 2 },
      tabId: 'docs',
      orders: {},
      expected: {
        tabIds: ['form', 'docs'],
        selectedTabId: 'form',
        selections: 2,
      },
    },
    {
      tabs: { tabIds: ['chat', 'form'], selectedTabId: 'form', selections: 2 },
      tabId: 'docs',
      orders: { docs: 1, chat: 2 },
      expected: {
        tabIds: ['docs', 'chat', 'form'],
        selectedTabId: 'form',
        selections: 2,
      },
    },
    {
      tabs: { tabIds: ['docs', 'form'], selectedTabId: 'form', selections: 0 },
      tabId: 'chat',
      orders: { docs: 1, chat: 2 },
      expected: {
        tabIds: ['docs', 'chat', 'form'],
        selectedTabId: 'form',
        selections: 0,
      },
    },
    {
      tabs: { tabIds: ['chat', 'form'], selectedTabId: 'chat', selections: 0 },
      tabId: 'primer',
      orders: { chat: 2 },
      expected: {
        tabIds: ['chat', 'form', 'primer'],
        selectedTabId: 'chat',
        selections: 0,
      },
    },
    {
      tabs: { tabIds: ['chat'], selectedTabId: 'chat', selections: 0 },
      tabId: 'same',
      orders: { chat: 2, same: 2 },
      expected: {
        tabIds: ['chat', 'same'],
        selectedTabId: 'chat',
        selections: 0,
      },
    },
    {
      tabs: { tabIds: ['chat'], selectedTabId: 'chat', selections: 0 },
      tabId: 'zero',
      orders: { chat: 2, zero: 0 },
      expected: {
        tabIds: ['zero', 'chat'],
        selectedTabId: 'chat',
        selections: 0,
      },
    },
  ])(
    'tabsAfterAdd of $tabId to $tabs.tabIds with $orders gives $expected',
    ({ tabs, tabId, orders, expected }) => {
      expect(tabsAfterAdd(tabs, 's', tabId, (id) => orders[id])).toEqual(
        expected,
      );
    },
  );

  it('tabsAfterAdd throws on a duplicate id', () => {
    const tabs: TabsState = {
      tabIds: ['form'],
      selectedTabId: 'form',
      selections: 0,
    };

    expect(() => tabsAfterAdd(tabs, 's', 'form', () => undefined)).toThrow(
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

  it.each<{
    case: string;
    tabId: string;
    selections: number;
    selected: string;
  }>([
    {
      case: 'the saved tab with no pick since',
      tabId: 'form',
      selections: 3,
      selected: 'form',
    },
    {
      case: 'the saved tab after a pick',
      tabId: 'form',
      selections: 4,
      selected: 'chat',
    },
    {
      case: 'another tab',
      tabId: 'docs',
      selections: 3,
      selected: 'chat',
    },
  ])(
    'restored_add_selects_the_saved_tab_only_with_no_pick_since ($case)',
    ({ tabId, selections, selected }) => {
      const added: TabsState = {
        tabIds: ['chat', tabId],
        selectedTabId: 'chat',
        selections,
      };

      const restored = tabsAfterRestoredAdd(added, tabId, {
        selectedTabId: 'form',
        selections: 3,
        takeOvers: [],
      });

      expect(restored).toEqual({ ...added, selectedTabId: selected });
    },
  );

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
    const added = tabsAfterAdd(taken.tabs, 's', 'docs', () => undefined);

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
    const [docsAfterForm] = takeOversAfterRelease(
      [form.takeOver, docs.takeOver],
      form.takeOver,
    );
    expect(formFirst).toBe(docs.tabs);
    expect(formFirst.selectedTabId).toBe('docs');
    expect(tabsAfterRelease(formFirst, docsAfterForm).selectedTabId).toBe(
      'chat',
    );
  });

  it('takeOversAfterRelease drops the released one and hands its tab to those that remembered it', () => {
    const takeOver = (tabId: string, previousTabId: string | null) => ({
      tabId,
      previousTabId,
      selections: 3,
    });

    expect(
      takeOversAfterRelease(
        [
          takeOver('form', 'chat'),
          takeOver('docs', 'form'),
          takeOver('x', 'y'),
        ],
        takeOver('form', 'chat'),
      ),
    ).toEqual([takeOver('docs', 'chat'), takeOver('x', 'y')]);
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

  it('markToastText adds the keys and the action, or is the text alone with none bound', () => {
    const mark = { text: 'Turn finished in x', action: 'read it' };

    expect(markToastText(mark, 'Space k s')).toBe(
      'Turn finished in x — Space k s to read it',
    );
    expect(markToastText(mark, null)).toBe('Turn finished in x');
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

  it('isMarkToast only when main selects from none while the mode is hidden', () => {
    expect(isMarkToast(null, 'a', false)).toBe(true);
    expect(isMarkToast(null, 'a', true)).toBe(false);
    expect(isMarkToast('b', 'a', false)).toBe(false);
    expect(isMarkToast(undefined, 'a', false)).toBe(false);
    expect(isMarkToast(null, null, false)).toBe(false);
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

  it('first refusing tab asks and later tabs are not asked', () => {
    const calls: [number, boolean][] = [];
    const guards = (answers: boolean[]) =>
      answers.map((answer, i) => ({
        beforeClose: (atOnce: boolean) => {
          calls.push([i, atOnce]);
          return answer;
        },
      }));

    expect(mayClose(guards([true, false, true]), true)).toBe(false);
    expect(calls).toEqual([
      [0, true],
      [1, true],
    ]);
    expect(mayClose([], false)).toBe(true);
    expect(mayClose(guards([true, true]), false)).toBe(true);
  });

  it.each([
    { says: [undefined, false], atOnce: false },
    { says: [], atOnce: false },
    { says: [false, true], atOnce: true },
  ])('closesAtOnce when any tab says so: $says', ({ says, atOnce }) => {
    const views = says.map((said) =>
      said === undefined ? {} : { closesAtOnce: () => said },
    );

    expect(closesAtOnce(views)).toBe(atOnce);
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
