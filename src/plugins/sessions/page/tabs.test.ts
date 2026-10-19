import { describe, expect, it } from 'vitest';
import type { SessionsState } from '../contract';
import { mayClose, stepTab, tabText } from './tabs';

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
