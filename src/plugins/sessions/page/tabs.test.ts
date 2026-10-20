import { describe, expect, it } from 'vitest';
import type { SessionsState } from '../contract';
import {
  harnessText,
  isRoundToast,
  isSameVisibleTab,
  mayClose,
  roundToastText,
  rowChanges,
  rowStatus,
  SIDEBAR_START,
  showsEmptyText,
  showsNoSelectionText,
  sidebarAfterResize,
  sidebarLayout,
  stepSession,
  stepTab,
  toggledSidebar,
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
    })),
    selectedSessionId,
  };
}

describe('tabs', () => {
  it('stepSession wraps at both ends', () => {
    const rows = ['a', 'b', 'c'];

    expect(stepSession(stateOf(rows, 'a'), 1)).toBe('b');
    expect(stepSession(stateOf(rows, 'c'), 1)).toBe('a');
    expect(stepSession(stateOf(rows, 'a'), -1)).toBe('c');
  });

  it('stepSession picks an end when none is selected', () => {
    expect(stepSession(stateOf(['a', 'b'], null), 1)).toBe('a');
    expect(stepSession(stateOf(['a', 'b'], null), -1)).toBe('b');
  });

  it('stepSession finds nothing with no rows or one selected row', () => {
    expect(stepSession(stateOf([], null), 1)).toBeNull();
    expect(stepSession(stateOf(['a'], 'a'), 1)).toBeNull();
  });

  it('stepTab wraps, picks an end with none selected, and finds nothing under two tabs', () => {
    expect(stepTab(['form', 'docs'], 'form', 1)).toBe('docs');
    expect(stepTab(['form', 'docs'], 'docs', 1)).toBe('form');
    expect(stepTab(['form', 'docs'], null, -1)).toBe('docs');
    expect(stepTab(['form'], 'form', 1)).toBeNull();
  });

  it('rowStatus takes the last non-empty status in add order', () => {
    expect(rowStatus(['a 1/2', '', 'b'])).toBe('b');
    expect(rowStatus(['', ''])).toBeNull();
  });

  it('harnessText names each harness and nothing for none', () => {
    expect(harnessText('claude')).toBe('Claude');
    expect(harnessText('codex')).toBe('Codex');
    expect(harnessText(null)).toBe('');
  });

  it('roundToastText names the keys, or only the session with none bound', () => {
    expect(roundToastText('x', 'Space k s')).toBe(
      'Round from x — Space k s to answer',
    );
    expect(roundToastText('x', null)).toBe('Round from x');
  });

  it('rowChanges lists added rows in their order and removed ids', () => {
    const changes = rowChanges(
      stateOf(['a', 'b'], null).rows,
      stateOf(['b', 'c', 'd'], null).rows,
    );

    expect(changes.added.map((row) => row.sessionId)).toEqual(['c', 'd']);
    expect(changes.removed).toEqual(['a']);
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

  it('sidebarLayout draws beside or hidden while wide, over or hidden while narrow', () => {
    expect(sidebarLayout(SIDEBAR_START, false)).toBe('beside');
    expect(
      sidebarLayout({ isHiddenWide: true, isOverlayOpen: false }, false),
    ).toBe('hidden');
    expect(sidebarLayout(SIDEBAR_START, true)).toBe('hidden');
    expect(
      sidebarLayout({ isHiddenWide: false, isOverlayOpen: true }, true),
    ).toBe('over');
    expect(
      sidebarLayout({ isHiddenWide: true, isOverlayOpen: true }, true),
    ).toBe('over');
  });

  it('toggledSidebar flips the hidden flag while wide and the overlay while narrow', () => {
    expect(toggledSidebar(SIDEBAR_START, false)).toEqual({
      isHiddenWide: true,
      isOverlayOpen: false,
    });
    expect(toggledSidebar(SIDEBAR_START, true)).toEqual({
      isHiddenWide: false,
      isOverlayOpen: true,
    });
    expect(
      toggledSidebar({ isHiddenWide: true, isOverlayOpen: true }, true),
    ).toEqual({ isHiddenWide: true, isOverlayOpen: false });
  });

  it("sidebarAfterResize closes the overlay when the window widens and keeps the user's hidden choice", () => {
    expect(
      sidebarAfterResize({ isHiddenWide: true, isOverlayOpen: true }, false),
    ).toEqual({ isHiddenWide: true, isOverlayOpen: false });
    expect(
      sidebarAfterResize({ isHiddenWide: false, isOverlayOpen: true }, true),
    ).toEqual({ isHiddenWide: false, isOverlayOpen: true });
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
