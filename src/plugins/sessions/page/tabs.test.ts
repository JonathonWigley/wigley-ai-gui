import { describe, expect, it } from 'vitest';
import type { SessionsState } from '../contract';
import {
  keepsPane,
  mayClose,
  showsEmptyText,
  showsIdleText,
  stepTab,
  tabText,
  tabTitle,
} from './tabs';

function stateOf(
  sessionIds: string[],
  activeSessionId: string | null,
): SessionsState {
  return {
    tabs: sessionIds.map((sessionId) => ({
      sessionId,
      label: sessionId,
      marked: false,
    })),
    activeSessionId,
  };
}

describe('tabs', () => {
  it('stepTab wraps at both ends', () => {
    const tabs = ['a', 'b', 'c'];

    expect(stepTab(stateOf(tabs, 'a'), 1)).toBe('b');
    expect(stepTab(stateOf(tabs, 'c'), 1)).toBe('a');
    expect(stepTab(stateOf(tabs, 'a'), -1)).toBe('c');
  });

  it('stepTab finds nothing with one tab or no active tab', () => {
    expect(stepTab(stateOf(['a'], 'a'), 1)).toBeNull();
    expect(stepTab(stateOf(['a', 'b'], null), 1)).toBeNull();
  });

  it("tabText adds the fill's title after the label", () => {
    expect(tabText('proj', null)).toBe('proj');
    expect(tabText('proj', '')).toBe('proj');
    expect(tabText('proj', 'Heading 1/2')).toBe('proj · Heading 1/2');
  });

  it('tabTitle is the last non-empty fill title, else null', () => {
    expect(tabTitle([])).toBeNull();
    expect(tabTitle(['', ''])).toBeNull();
    expect(tabTitle(['first', 'second'])).toBe('second');
    expect(tabTitle(['first', ''])).toBe('first');
  });

  it('keepsPane keeps a pane for a fill that arrives before its tab', () => {
    expect(keepsPane(false, 1)).toBe(true);
  });

  it('keepsPane keeps a pane with a tab and no fill', () => {
    expect(keepsPane(true, 0)).toBe(true);
  });

  it('keepsPane drops a pane once its last fill leaves with no tab', () => {
    expect(keepsPane(false, 0)).toBe(false);
  });

  it('showsIdleText only while nothing fills the pane', () => {
    expect(showsIdleText(0)).toBe(true);
    expect(showsIdleText(1)).toBe(false);
  });

  it('showsEmptyText waits for the first state', () => {
    expect(showsEmptyText(null)).toBe(false);
  });

  it('showsEmptyText only when the state holds no tab', () => {
    expect(showsEmptyText(stateOf([], null))).toBe(true);
    expect(showsEmptyText(stateOf(['a'], 'a'))).toBe(false);
  });

  it('mayClose stops at the first guard that keeps the tab', () => {
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
});
