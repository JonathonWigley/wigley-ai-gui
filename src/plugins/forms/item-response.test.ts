import { describe, expect, it } from 'vitest';
import { isAnswered, isResponded, type ItemResponse } from './item-response';

function response(overrides: Partial<ItemResponse>): ItemResponse {
  return {
    notApplicable: false,
    pickIsComplete: false,
    notes: '',
    ...overrides,
  };
}

describe('isAnswered and isResponded', () => {
  it('a complete pick both answers and responds', () => {
    const picked = response({ pickIsComplete: true });
    expect([isAnswered(picked), isResponded(picked)]).toEqual([true, true]);
  });

  it('notes alone respond without answering', () => {
    const noted = response({ notes: 'my own fix' });
    expect([isAnswered(noted), isResponded(noted)]).toEqual([false, true]);
  });

  it('no pick and no notes neither answer nor respond', () => {
    const blank = response({});
    expect([isAnswered(blank), isResponded(blank)]).toEqual([false, false]);
  });

  it('whitespace notes do not respond', () => {
    expect(isResponded(response({ notes: ' \n' }))).toBe(false);
  });

  it('a not-applicable item neither answers nor responds, pick and notes kept', () => {
    const marked = response({
      notApplicable: true,
      pickIsComplete: true,
      notes: 'why',
    });
    expect([isAnswered(marked), isResponded(marked)]).toEqual([false, false]);
  });
});
