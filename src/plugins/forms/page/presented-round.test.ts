import { describe, expect, it } from 'vitest';
import type { FormBody } from '../contract';
import { presentedRoundOf } from './presented-round';
import { presentedRound } from './test-rounds';

describe('presentedRoundOf', () => {
  it('maps a presented form to its round, formId to roundId', () => {
    const { round } = presentedRound('r1');
    const draft: FormBody = {
      note: 'half done',
      answers: [],
      finding_answers: [],
      notice_comments: [],
    };

    const mapped = presentedRoundOf({
      formId: 'r1',
      sessionId: 'app-1',
      label: 'project · r1 heading',
      form: round,
      draft,
    });

    expect(mapped).toEqual({
      roundId: 'r1',
      sessionId: 'app-1',
      label: 'project · r1 heading',
      round,
      draft,
    });
  });
});
