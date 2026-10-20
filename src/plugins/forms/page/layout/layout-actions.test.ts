import { describe, expect, it } from 'vitest';
import { layoutActions } from './card-kit';

describe('layoutActions', () => {
  it('layoutActions_Choose_FocusesThenChooses', () => {
    expect(layoutActions({ type: 'choose', choice: 2 }, 4)).toEqual([
      { type: 'focusItem', item: 4 },
      { type: 'choose', choice: 2 },
    ]);
  });

  it('layoutActions_Accept_FocusesThenAcceptsRecommendation', () => {
    expect(layoutActions({ type: 'accept' }, 1)).toEqual([
      { type: 'focusItem', item: 1 },
      { type: 'acceptRecommendation' },
    ]);
  });

  it('layoutActions_Focus_FocusesOnly', () => {
    expect(layoutActions({ type: 'focus' }, 3)).toEqual([
      { type: 'focusItem', item: 3 },
    ]);
  });

  it('layoutActions_ToggleDontAsk_FocusesOnly', () => {
    expect(layoutActions({ type: 'toggleDontAsk' }, 0)).toEqual([
      { type: 'focusItem', item: 0 },
    ]);
  });
});
