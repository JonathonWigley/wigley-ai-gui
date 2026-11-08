import { describe, expect, it } from 'vitest';
import type { SessionsState, SessionTabView } from '../contract';
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
  tabsAfterRemove,
  tabsAfterSelect,
  type VisibleTab,
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
      project: 'project',
      harness: null,
      marked: false,
      projectDir: null,
      hostSessionId: null,
      titles: { user: null, agent: null, firstMessage: null },
      profileDir: null,
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
      expected: { tabIds: ['form'], selectedTabId: 'form' },
    },
    {
      tabs: { tabIds: ['form'], selectedTabId: 'form' },
      tabId: 'docs',
      orders: {},
      expected: {
        tabIds: ['form', 'docs'],
        selectedTabId: 'form',
      },
    },
    {
      tabs: { tabIds: ['chat', 'form'], selectedTabId: 'form' },
      tabId: 'docs',
      orders: { docs: 1, chat: 2 },
      expected: {
        tabIds: ['docs', 'chat', 'form'],
        selectedTabId: 'form',
      },
    },
    {
      tabs: { tabIds: ['docs', 'form'], selectedTabId: 'form' },
      tabId: 'chat',
      orders: { docs: 1, chat: 2 },
      expected: {
        tabIds: ['docs', 'chat', 'form'],
        selectedTabId: 'form',
      },
    },
    {
      tabs: { tabIds: ['chat', 'form'], selectedTabId: 'chat' },
      tabId: 'primer',
      orders: { chat: 2 },
      expected: {
        tabIds: ['chat', 'form', 'primer'],
        selectedTabId: 'chat',
      },
    },
    {
      tabs: { tabIds: ['chat'], selectedTabId: 'chat' },
      tabId: 'same',
      orders: { chat: 2, same: 2 },
      expected: {
        tabIds: ['chat', 'same'],
        selectedTabId: 'chat',
      },
    },
    {
      tabs: { tabIds: ['chat'], selectedTabId: 'chat' },
      tabId: 'zero',
      orders: { chat: 2, zero: 0 },
      expected: {
        tabIds: ['zero', 'chat'],
        selectedTabId: 'chat',
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
    };

    expect(() => tabsAfterAdd(tabs, 's', 'form', () => undefined)).toThrow(
      'Session s already has a tab "form"',
    );
  });

  it.each([
    {
      tabs: { tabIds: ['a', 'b', 'c'], selectedTabId: 'b' },
      tabId: 'b',
      expected: { tabIds: ['a', 'c'], selectedTabId: 'c' },
    },
    {
      tabs: { tabIds: ['a', 'b', 'c'], selectedTabId: 'c' },
      tabId: 'c',
      expected: { tabIds: ['a', 'b'], selectedTabId: 'b' },
    },
    {
      tabs: { tabIds: ['a'], selectedTabId: 'a' },
      tabId: 'a',
      expected: NO_TABS,
    },
    {
      tabs: { tabIds: ['a', 'b', 'c'], selectedTabId: 'c' },
      tabId: 'a',
      expected: { tabIds: ['b', 'c'], selectedTabId: 'c' },
    },
  ])(
    'tabsAfterRemove of $tabId from $tabs gives $expected',
    ({ tabs, tabId, expected }) => {
      expect(tabsAfterRemove(tabs, tabId)).toEqual(expected);
    },
  );

  it('tabsAfterSelect selects a present tab, and returns the same value for an absent or selected one', () => {
    const tabs: TabsState = {
      tabIds: ['a', 'b'],
      selectedTabId: 'a',
    };

    expect(tabsAfterSelect(tabs, 'b')).toEqual({
      tabIds: ['a', 'b'],
      selectedTabId: 'b',
    });
    expect(tabsAfterSelect(tabs, 'x')).toBe(tabs);
    expect(tabsAfterSelect(tabs, 'a')).toBe(tabs);
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

  it.each<{
    case: string;
    answers: (boolean | Promise<boolean>)[];
    closes: boolean;
    asked: number[];
  }>([
    { case: 'no tabs', answers: [], closes: true, asked: [] },
    {
      case: 'every tab agrees',
      answers: [true, true],
      closes: true,
      asked: [0, 1],
    },
    {
      case: 'a tab keeps it',
      answers: [true, false, true],
      closes: false,
      asked: [0, 1],
    },
    {
      case: 'a promise keeps it',
      answers: [Promise.resolve(false), true],
      closes: false,
      asked: [0],
    },
    {
      case: 'a promise agrees',
      answers: [Promise.resolve(true), true],
      closes: true,
      asked: [0, 1],
    },
  ])('mayClose_EachAnswer_StopsAtTheFirstNo ($case)', async (test) => {
    const asked: number[] = [];
    const views = test.answers.map((answer, index) => ({
      beforeClose: () => {
        asked.push(index);
        return answer;
      },
    }));

    expect(await mayClose(() => views)).toBe(test.closes);
    expect(asked).toEqual(test.asked);
  });

  it('mayClose_TabAddedWhileOneAsks_AsksItOnce', async () => {
    const asked: string[] = [];
    let answerConfirm: (ended: boolean) => void = () => undefined;
    const added = {
      beforeClose: () => {
        asked.push('form');
        return false;
      },
    };
    const confirm = {
      beforeClose: () => {
        asked.push('chat');
        return new Promise<boolean>((resolve) => {
          answerConfirm = resolve;
        });
      },
    };
    const views: Pick<SessionTabView, 'beforeClose'>[] = [confirm];

    const closing = mayClose(() => views);
    views.push(added);
    answerConfirm(true);

    expect(await closing).toBe(false);
    expect(asked).toEqual(['chat', 'form']);
  });

  it.each<{
    case: string;
    isModeShown: boolean;
    sessionId: string | null;
    tabId: string | null;
    popupId: string | null;
    expected: VisibleTab;
  }>([
    {
      case: 'the mode hidden, a popup open',
      isModeShown: false,
      sessionId: 'a',
      tabId: 'chat',
      popupId: 'forms',
      expected: null,
    },
    {
      case: 'no session',
      isModeShown: true,
      sessionId: null,
      tabId: null,
      popupId: null,
      expected: 'none',
    },
    {
      case: 'a session with no tab or open popup',
      isModeShown: true,
      sessionId: 'a',
      tabId: null,
      popupId: null,
      expected: 'none',
    },
    {
      case: 'a selected tab, its popups hidden',
      isModeShown: true,
      sessionId: 'a',
      tabId: 'chat',
      popupId: null,
      expected: { kind: 'tab', sessionId: 'a', tabId: 'chat' },
    },
    {
      case: 'an open popup over a selected tab wins',
      isModeShown: true,
      sessionId: 'a',
      tabId: 'chat',
      popupId: 'forms',
      expected: { kind: 'popup', sessionId: 'a', popupId: 'forms' },
    },
    {
      case: 'an open popup in a session with no tab',
      isModeShown: true,
      sessionId: 'a',
      tabId: null,
      popupId: 'forms',
      expected: { kind: 'popup', sessionId: 'a', popupId: 'forms' },
    },
  ])(
    'visibleTab_ModeSessionTabAndPopup_PicksTheSurface ($case)',
    ({ isModeShown, sessionId, tabId, popupId, expected }) => {
      expect(visibleTab(isModeShown, sessionId, tabId, popupId)).toEqual(
        expected,
      );
    },
  );

  it.each<{ case: string; a: VisibleTab; b: VisibleTab; isSame: boolean }>([
    { case: 'both null', a: null, b: null, isSame: true },
    { case: 'both none', a: 'none', b: 'none', isSame: true },
    { case: 'none and null', a: 'none', b: null, isSame: false },
    {
      case: 'one tab',
      a: { kind: 'tab', sessionId: 'a', tabId: 'form' },
      b: { kind: 'tab', sessionId: 'a', tabId: 'form' },
      isSame: true,
    },
    {
      case: 'one tab id in two sessions',
      a: { kind: 'tab', sessionId: 'a', tabId: 'form' },
      b: { kind: 'tab', sessionId: 'b', tabId: 'form' },
      isSame: false,
    },
    {
      case: 'one popup',
      a: { kind: 'popup', sessionId: 'a', popupId: 'forms' },
      b: { kind: 'popup', sessionId: 'a', popupId: 'forms' },
      isSame: true,
    },
    {
      case: 'a tab and a popup sharing an id',
      a: { kind: 'tab', sessionId: 'a', tabId: 'forms' },
      b: { kind: 'popup', sessionId: 'a', popupId: 'forms' },
      isSame: false,
    },
  ])('isSameVisibleTab compares by value ($case)', ({ a, b, isSame }) => {
    expect(isSameVisibleTab(a, b)).toBe(isSame);
  });
});
