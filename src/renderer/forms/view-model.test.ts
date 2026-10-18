import { describe, expect, it } from 'vitest';
import {
  activeRound,
  apply,
  type FormsAction,
  type FormsState,
  initialState,
  type RoundState,
} from './form-state';
import { presentedRound, question } from './test-rounds';
import { baseView, modeLabel, progressText, reviewRows } from './view-model';

// Questions Alpha (recommend 2), Beta (recommend 2), Gamma; no notices, so
// rail position = question position.
function roundAfter(...actions: FormsAction[]): RoundState {
  const start = initialState([
    presentedRound('r1', {
      questions: [question('Alpha'), question('Beta'), question('Gamma')],
    }),
  ]);
  const round = activeRound(actions.reduce(apply, start));
  if (round === null) {
    throw new Error('The test round is not active');
  }
  return round;
}

function stateAfter(...actions: FormsAction[]): FormsState {
  return actions.reduce(apply, initialState([presentedRound('r1')]));
}

describe('reviewRows', () => {
  it('lists an answered question with its choice text', () => {
    const [alpha] = reviewRows(roundAfter({ type: 'choose', choice: 2 }));
    expect(alpha).toMatchObject({
      row: 0,
      number: 1,
      title: 'Alpha',
      status: 'answered',
      choice: 2,
      choiceText: 'second',
      tookRecommendation: true,
    });
  });

  it('marks a choice other than the recommended one', () => {
    const [alpha] = reviewRows(roundAfter({ type: 'choose', choice: 3 }));
    expect(alpha.tookRecommendation).toBe(false);
  });

  it('shows no choice for a not-applicable question that kept one', () => {
    const rows = reviewRows(
      roundAfter(
        { type: 'focusItem', item: 1 },
        { type: 'choose', choice: 1 },
        { type: 'toggleNotApplicable' },
      ),
    );
    expect(rows[1]).toMatchObject({
      status: 'not_applicable',
      choice: 0,
      choiceText: '',
    });
  });

  it('lists an untouched question as untouched', () => {
    expect(reviewRows(roundAfter())[2]).toMatchObject({
      status: 'untouched',
      choice: 0,
    });
  });

  it("carries the answer, why and Don't-ask text", () => {
    const [alpha] = reviewRows(
      roundAfter(
        {
          type: 'setText',
          roundId: 'r1',
          target: { field: 'what', question: 1 },
          value: 'my own',
        },
        {
          type: 'setText',
          roundId: 'r1',
          target: { field: 'why', question: 1 },
          value: 'because',
        },
        { type: 'toggleDontAsk' },
      ),
    );
    expect(alpha).toMatchObject({
      what: 'my own',
      why: 'because',
      dontAsk: true,
    });
  });

  it('marks the row under the review cursor', () => {
    const rows = reviewRows(
      roundAfter({ type: 'openReview' }, { type: 'reviewNext' }),
    );
    expect(rows.map((row) => row.isCursor)).toEqual([false, true, false]);
  });
});

describe('progressText', () => {
  it('counts answered questions', () => {
    expect(
      progressText({ answered: 2, notApplicable: 0, untouched: 1, total: 3 }),
    ).toBe('2 of 3 answered');
  });

  it('adds not-applicable questions when there are any', () => {
    expect(
      progressText({ answered: 1, notApplicable: 1, untouched: 1, total: 3 }),
    ).toBe('1 of 3 answered, 1 not applicable');
  });
});

describe('modeLabel', () => {
  it('reads PAGE outside every box', () => {
    expect(modeLabel(null)).toBe('PAGE');
  });

  it("reads the box's vim mode in capitals", () => {
    expect(modeLabel('insert')).toBe('INSERT');
  });
});

describe('baseView', () => {
  it('is the view help returns to while help is open', () => {
    expect(
      baseView(stateAfter({ type: 'openReview' }, { type: 'toggleHelp' })),
    ).toBe('review');
  });

  it('is the view itself otherwise', () => {
    expect(baseView(stateAfter())).toBe('forms');
  });
});
