import { describe, expect, it } from 'vitest';
import {
  activeRound,
  apply,
  baseView,
  type FormsAction,
  type FormsState,
  initialState,
  type RoundState,
} from './form-state';
import { presentedRound, question } from './test-rounds';
import {
  modeLabel,
  progressText,
  reviewRows,
  saveLabel,
  sessionTitle,
} from './view-model';

// Questions Alpha (recommend 2), Beta (recommend 2), Gamma; no notices, so
// rail position = question position.
function roundAfter(...actions: FormsAction[]): RoundState {
  const start = initialState(
    [
      presentedRound('r1', {
        questions: [question('Alpha'), question('Beta'), question('Gamma')],
      }),
    ],
    'r1-session',
  );
  const round = activeRound(actions.reduce(apply, start));
  if (round === null) {
    throw new Error('The test round is not active');
  }
  return round;
}

function stateAfter(...actions: FormsAction[]): FormsState {
  return actions.reduce(
    apply,
    initialState([presentedRound('r1')], 'r1-session'),
  );
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

  it('lists a question answered only in writing as answered, with no choice', () => {
    const [alpha] = reviewRows(
      roundAfter({
        type: 'setText',
        roundId: 'r1',
        target: { field: 'what', question: 1 },
        value: 'my own answer',
      }),
    );
    expect(alpha).toMatchObject({
      status: 'answered',
      choice: 0,
      choiceText: '',
      what: 'my own answer',
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
    expect(modeLabel({ mode: 'insert', subMode: '' })).toBe('INSERT');
  });

  it('names a visual mode by its kind, as vim does', () => {
    expect(modeLabel({ mode: 'visual', subMode: '' })).toBe('VISUAL');
    expect(modeLabel({ mode: 'visual', subMode: 'linewise' })).toBe(
      'VISUAL LINE',
    );
    expect(modeLabel({ mode: 'visual', subMode: 'blockwise' })).toBe(
      'VISUAL BLOCK',
    );
  });
});

describe('saveLabel', () => {
  it('shows the failed save message while unsaved', () => {
    expect(saveLabel('unsaved', 'disk full')).toBe('Unsaved — disk full');
  });

  it('shows the plain state without a message', () => {
    expect(saveLabel('unsaved', null)).toBe('Unsaved');
    expect(saveLabel('saving', null)).toBe('Saving…');
    expect(saveLabel('saved', null)).toBe('Saved');
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

describe('sessionTitle', () => {
  // presentedRound('r1') has two questions and no notices.
  function titleAfter(...actions: FormsAction[]): string {
    const round = activeRound(stateAfter(...actions));
    if (round === null) {
      throw new Error('The test round is not active');
    }
    return sessionTitle(round);
  }

  it('sessionTitle counts answered and not-applicable questions', () => {
    const choose: FormsAction = { type: 'choose', choice: 1 };

    expect(titleAfter()).toBe('r1 heading 0/2');
    expect(titleAfter(choose)).toBe('r1 heading 1/2');
    expect(
      titleAfter(choose, { type: 'nextItem' }, { type: 'toggleNotApplicable' }),
    ).toBe('r1 heading 2/2');
  });
});
