import { describe, expect, it } from 'vitest';
import type { Finding, PresentedRound } from '../contract';
import {
  activeRound,
  apply,
  type FormsAction,
  type FormsState,
  initialState,
  type RoundState,
} from './form-state';
import { decision, finding, presentedRound, question } from './test-rounds';
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

// Question Alpha and finding Delta (recommend 2, fix_now); the rail runs
// Delta, Alpha.
function mixedRoundAfter(...actions: FormsAction[]): RoundState {
  return roundWithFindingAfter(finding('Delta'), ...actions);
}

// Question Alpha and the given finding; the rail runs the finding, Alpha.
function roundWithFindingAfter(
  delta: Finding,
  ...actions: FormsAction[]
): RoundState {
  const start = initialState(
    [
      presentedRound('r1', {
        questions: [question('Alpha')],
        findings: [delta],
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
        target: { field: 'notes', item: { kind: 'question', index: 1 } },
        value: 'my own answer',
      }),
    );
    expect(alpha).toMatchObject({
      status: 'answered',
      choice: 0,
      choiceText: '',
      notes: 'my own answer',
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

  it("carries the notes and Don't-ask text", () => {
    const [alpha] = reviewRows(
      roundAfter(
        {
          type: 'setText',
          roundId: 'r1',
          target: { field: 'notes', item: { kind: 'question', index: 1 } },
          value: 'my own',
        },
        { type: 'toggleDontAsk' },
        {
          type: 'setText',
          roundId: 'r1',
          target: {
            field: 'dontAskReason',
            item: { kind: 'question', index: 1 },
          },
          value: 'settled',
        },
      ),
    );
    expect(alpha).toMatchObject({
      notes: 'my own',
      dontAsk: true,
      dontAskReason: 'settled',
    });
  });

  it('lists findings before questions', () => {
    const rows = reviewRows(mixedRoundAfter());
    expect(rows.map((row) => [row.kind, row.label])).toEqual([
      ['finding', 'F1'],
      ['question', '1'],
    ]);
    expect(rows.map((row) => row.row)).toEqual([0, 1]);
  });

  it('lists an answered finding with its choice text', () => {
    const [delta] = reviewRows(
      mixedRoundAfter(
        { type: 'chooseAction', action: 'fix_now' },
        { type: 'choose', choice: 2 },
      ),
    );
    expect(delta).toMatchObject({
      kind: 'finding',
      title: 'Delta',
      status: 'answered',
      choice: 2,
      choiceText: 'second',
      tookRecommendation: true,
    });
  });

  it('marks a finding choice other than the recommended one', () => {
    const [delta] = reviewRows(
      mixedRoundAfter(
        { type: 'chooseAction', action: 'fix_now' },
        { type: 'choose', choice: 1 },
      ),
    );
    expect(delta.tookRecommendation).toBe(false);
  });

  it('flags a fixed finding with no solution among several as missing one', () => {
    const [delta] = reviewRows(
      mixedRoundAfter({ type: 'chooseAction', action: 'fix_now' }),
    );
    expect(delta).toMatchObject({
      status: 'untouched',
      action: '',
      actionLabel: '',
      missing: 'solution',
    });
  });

  it('flags a finding with a solution and no action as missing an action', () => {
    const [delta] = reviewRows(mixedRoundAfter({ type: 'choose', choice: 2 }));
    expect(delta).toMatchObject({ status: 'untouched', missing: 'action' });
  });

  it('shows no pick and no missing hint for a not-applicable finding that kept a solution', () => {
    const [delta] = reviewRows(
      mixedRoundAfter(
        { type: 'choose', choice: 2 },
        { type: 'toggleNotApplicable' },
      ),
    );
    expect(delta).toMatchObject({
      status: 'not_applicable',
      action: '',
      actionLabel: '',
      choice: 0,
      missing: null,
    });
  });

  it('answers a fixed one-solution finding with no missing pick', () => {
    const start = initialState(
      [
        presentedRound('r1', {
          questions: [],
          findings: [
            finding('Solo', { choices: [{ text: 'only', reason: 'why' }] }),
          ],
        }),
      ],
      'r1-session',
    );
    const round = activeRound(
      apply(start, { type: 'chooseAction', action: 'fix_now' }),
    );
    if (round === null) {
      throw new Error('The test round is not active');
    }
    const [solo] = reviewRows(round);
    expect(solo).toMatchObject({
      status: 'answered',
      action: 'fix_now',
      actionLabel: 'Fix now',
      choice: 1,
      choiceText: 'only',
      tookActionRecommendation: true,
      missing: null,
    });
  });

  it('gives a fixed one-solution finding restored with no solution picked its one solution', () => {
    const solo = finding('Solo', {
      choices: [{ text: 'only', reason: 'why' }],
      recommend: 1,
      recommend_action: 'fix_now',
    });
    const restored: PresentedRound = {
      ...presentedRound('r1', { questions: [], findings: [solo] }),
      draft: {
        note: '',
        answers: [],
        finding_answers: [
          {
            index: 1,
            choice: 0,
            action: 'fix_now',
            not_applicable: false,
            notes: '',
            dont_ask: false,
            dont_ask_reason: '',
          },
        ],
        notice_comments: [],
      },
    };
    const round = activeRound(initialState([restored], 'r1-session'));
    if (round === null) {
      throw new Error('The test round is not active');
    }
    const [row] = reviewRows(round);
    expect(row).toMatchObject({
      status: 'answered',
      action: 'fix_now',
      choice: 1,
      choiceText: 'only',
      recommended: true,
    });
  });

  it("names a design finding's follow-up in the decision card's word", () => {
    const [foxtrot] = reviewRows(
      roundWithFindingAfter(
        decision('Foxtrot'),
        { type: 'choose', choice: 2 },
        { type: 'chooseAction', action: 'follow_up' },
      ),
    );
    expect(foxtrot).toMatchObject({
      action: 'follow_up',
      actionLabel: 'Plan it',
    });
  });

  it('drops the kept solution from a finding left alone', () => {
    const [delta] = reviewRows(
      mixedRoundAfter(
        { type: 'choose', choice: 2 },
        { type: 'chooseAction', action: 'leave_it' },
      ),
    );
    expect(delta).toMatchObject({
      status: 'answered',
      action: 'leave_it',
      actionLabel: 'Leave it',
      choice: 0,
      choiceText: '',
      tookRecommendation: false,
      tookActionRecommendation: false,
      missing: null,
    });
  });

  it('drops the solution from a finding answered by notes with no action, and flags the action', () => {
    const [delta] = reviewRows(
      mixedRoundAfter(
        {
          type: 'setText',
          roundId: 'r1',
          target: { field: 'notes', item: { kind: 'finding', index: 1 } },
          value: 'my own fix',
        },
        { type: 'choose', choice: 2 },
      ),
    );
    expect(delta).toMatchObject({
      status: 'answered',
      choice: 0,
      choiceText: '',
      actionLabel: '',
      tookRecommendation: false,
      missing: 'action',
    });
  });

  it('drops the action from a finding with notes, fix now and no solution among several, and flags the solution', () => {
    const [delta] = reviewRows(
      mixedRoundAfter(
        {
          type: 'setText',
          roundId: 'r1',
          target: { field: 'notes', item: { kind: 'finding', index: 1 } },
          value: 'my own fix',
        },
        { type: 'chooseAction', action: 'fix_now' },
      ),
    );
    expect(delta).toMatchObject({
      status: 'answered',
      action: '',
      actionLabel: '',
      choice: 0,
      tookActionRecommendation: false,
      recommended: false,
      missing: 'solution',
    });
  });

  it('gives a question row no action and no missing pick', () => {
    const [, alpha] = reviewRows(mixedRoundAfter());
    expect(alpha).toMatchObject({
      kind: 'question',
      action: '',
      actionLabel: '',
      tookActionRecommendation: false,
      missing: null,
    });
  });

  it('recommends a question that took its recommendation', () => {
    const [, alpha] = reviewRows(
      mixedRoundAfter(
        { type: 'focusItem', item: 1 },
        { type: 'choose', choice: 2 },
      ),
    );
    expect(alpha).toMatchObject({ kind: 'question', recommended: true });
  });

  it('recommends a fixed finding that took both recommendations', () => {
    const [delta] = reviewRows(
      mixedRoundAfter(
        { type: 'chooseAction', action: 'fix_now' },
        { type: 'choose', choice: 2 },
      ),
    );
    expect(delta.recommended).toBe(true);
  });

  it('does not recommend a finding with the recommended solution but another action', () => {
    const [delta] = reviewRows(
      mixedRoundAfter(
        { type: 'chooseAction', action: 'follow_up' },
        { type: 'choose', choice: 2 },
      ),
    );
    expect(delta).toMatchObject({ status: 'answered', recommended: false });
  });

  it('recommends a finding left alone as recommended', () => {
    const [delta] = reviewRows(
      roundWithFindingAfter(
        finding('Delta', { recommend_action: 'leave_it' }),
        {
          type: 'chooseAction',
          action: 'leave_it',
        },
      ),
    );
    expect(delta).toMatchObject({ status: 'answered', recommended: true });
  });

  it('does not recommend a finding answered by notes alone', () => {
    const [delta] = reviewRows(
      mixedRoundAfter(
        {
          type: 'setText',
          roundId: 'r1',
          target: { field: 'notes', item: { kind: 'finding', index: 1 } },
          value: 'my own fix',
        },
        { type: 'choose', choice: 2 },
      ),
    );
    expect(delta).toMatchObject({ status: 'answered', recommended: false });
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

  it('counts findings with questions', () => {
    const start = initialState(
      [presentedRound('r1', { findings: [finding('Delta')] })],
      'r1-session',
    );
    const round = activeRound(
      apply(apply(start, { type: 'chooseAction', action: 'fix_now' }), {
        type: 'choose',
        choice: 1,
      }),
    );
    if (round === null) {
      throw new Error('The test round is not active');
    }
    expect(sessionTitle(round)).toBe('r1 heading 1/3');
  });
});
