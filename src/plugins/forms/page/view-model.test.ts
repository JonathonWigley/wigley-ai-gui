import { describe, expect, it } from 'vitest';
import type { Finding } from '../contract';
import {
  activeRound,
  apply,
  type FormsAction,
  type FormsState,
  initialState,
  type RoundState,
  type TextTarget,
} from './form-state';
import { decision, finding, presentedRound, question } from './test-rounds';
import {
  pickRailItem,
  progressText,
  railDotStatus,
  railPickAction,
  reviewRows,
  reviewRowsChanged,
  reviewSummaryText,
  roundSaveLabel,
  roundSaveState,
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
  return activeOf(actions.reduce(apply, stateWithFinding(delta)));
}

// Question Alpha and the given finding, before any action.
function stateWithFinding(delta: Finding): FormsState {
  return initialState(
    [
      presentedRound('r1', {
        questions: [question('Alpha')],
        findings: [delta],
      }),
    ],
    'r1-session',
  );
}

function activeOf(state: FormsState): RoundState {
  const round = activeRound(state);
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
    const [alpha] = reviewRows(roundAfter({ type: 'choose', number: 2 }));
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
    const [alpha] = reviewRows(roundAfter({ type: 'choose', number: 3 }));
    expect(alpha.tookRecommendation).toBe(false);
  });

  it('shows no choice for a not-applicable question that kept one', () => {
    const rows = reviewRows(
      roundAfter(
        { type: 'focusItem', item: 1 },
        { type: 'choose', number: 1 },
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
    const [delta] = reviewRows(mixedRoundAfter({ type: 'choose', number: 2 }));
    expect(delta).toMatchObject({
      kind: 'finding',
      title: 'Delta',
      status: 'answered',
      entry: 2,
      choice: 2,
      choiceText: 'second',
      tookRecommendation: true,
    });
  });

  it('marks a finding choice other than the recommended one', () => {
    const [delta] = reviewRows(mixedRoundAfter({ type: 'choose', number: 1 }));
    expect(delta).toMatchObject({
      tookRecommendation: false,
      recommended: false,
    });
  });

  it('lists an untouched finding with no pick', () => {
    const [delta] = reviewRows(mixedRoundAfter());
    expect(delta).toMatchObject({
      status: 'untouched',
      entry: 0,
      action: '',
      actionLabel: '',
      choice: 0,
    });
  });

  it('shows no pick for a not-applicable finding that kept one', () => {
    const [delta] = reviewRows(
      mixedRoundAfter(
        { type: 'choose', number: 2 },
        { type: 'toggleNotApplicable' },
      ),
    );
    expect(delta).toMatchObject({
      status: 'not_applicable',
      entry: 0,
      action: '',
      actionLabel: '',
      choice: 0,
    });
  });

  it("lists a finding's header pick with its action word and no choice", () => {
    // Entries: 1 fix_now/1, 2 fix_now/2, 3 follow_up/0, 4 leave_it/0.
    const twoFix = finding('Delta', {
      choices: [
        { text: 'A', reason: 'A reason', action: 'fix_now' },
        { text: 'B', reason: 'B reason', action: 'fix_now' },
      ],
    });
    const [delta] = reviewRows(
      roundWithFindingAfter(twoFix, { type: 'choose', number: 4 }),
    );
    expect(delta).toMatchObject({
      status: 'answered',
      entry: 4,
      action: 'leave_it',
      actionLabel: 'Leave it',
      choice: 0,
      choiceText: '',
    });
  });

  it("lists a finding's choice pick with its entry number", () => {
    // Entries: 1 fix_now/2, 2 follow_up/1, 3 leave_it/0.
    const grouped = finding('Delta', {
      choices: [
        { text: 'A', reason: 'A reason', action: 'follow_up' },
        { text: 'B', reason: 'B reason', action: 'fix_now' },
      ],
    });
    const [delta] = reviewRows(
      roundWithFindingAfter(grouped, { type: 'choose', number: 1 }),
    );
    expect(delta).toMatchObject({
      entry: 1,
      action: 'fix_now',
      choice: 2,
      choiceText: 'B',
    });
  });

  it("names a design finding's follow-up in the decision card's word", () => {
    // Foxtrot's two choices sit under fix_now, so entry 3 is follow_up's header.
    const [foxtrot] = reviewRows(
      roundWithFindingAfter(decision('Foxtrot'), { type: 'choose', number: 3 }),
    );
    expect(foxtrot).toMatchObject({
      action: 'follow_up',
      actionLabel: 'Plan it',
    });
  });

  it('answers a finding by notes alone, with no pick', () => {
    const [delta] = reviewRows(
      mixedRoundAfter({
        type: 'setText',
        roundId: 'r1',
        target: { field: 'notes', item: { kind: 'finding', index: 1 } },
        value: 'my own fix',
      }),
    );
    expect(delta).toMatchObject({
      status: 'answered',
      entry: 0,
      action: '',
      actionLabel: '',
      choice: 0,
      tookActionRecommendation: false,
      recommended: false,
    });
  });

  it('gives a question row no action', () => {
    const [, alpha] = reviewRows(mixedRoundAfter());
    expect(alpha).toMatchObject({
      kind: 'question',
      action: '',
      actionLabel: '',
      tookActionRecommendation: false,
    });
  });

  it('recommends a question that took its recommendation', () => {
    const [, alpha] = reviewRows(
      mixedRoundAfter(
        { type: 'focusItem', item: 1 },
        { type: 'choose', number: 2 },
      ),
    );
    expect(alpha).toMatchObject({ kind: 'question', recommended: true });
  });

  it('recommends a finding whose pick is the recommended pick', () => {
    const [delta] = reviewRows(mixedRoundAfter({ type: 'choose', number: 2 }));
    expect(delta.recommended).toBe(true);
  });

  it("recommends a finding that took a null recommend's header", () => {
    // Delta's three choices sit under fix_now, so entry 5 is leave_it's header.
    const [delta] = reviewRows(
      roundWithFindingAfter(
        finding('Delta', { recommend: null, recommend_action: 'leave_it' }),
        { type: 'choose', number: 5 },
      ),
    );
    expect(delta).toMatchObject({
      status: 'answered',
      entry: 5,
      choice: 0,
      tookRecommendation: false,
      tookActionRecommendation: true,
      recommended: true,
    });
  });

  it('marks the row under the review cursor', () => {
    const rows = reviewRows(
      roundAfter({ type: 'openReview' }, { type: 'reviewNext' }),
    );
    expect(rows.map((row) => row.isCursor)).toEqual([false, true, false]);
  });
});

describe('railDotStatus', () => {
  it('shows an answered item as success', () => {
    expect(railDotStatus('answered', false)).toBe('success');
  });

  it('flags an untouched item only while the review flags it', () => {
    expect(railDotStatus('untouched', true)).toBe('warning');
    expect(railDotStatus('untouched', false)).toBe('idle');
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

describe('reviewSummaryText', () => {
  it('reviewSummaryText_WithUntouched_AddsTheSentence', () => {
    expect(
      reviewSummaryText({
        answered: 1,
        notApplicable: 0,
        untouched: 2,
        total: 3,
      }),
    ).toBe('1 of 3 answered. 2 not answered; they are sent as untouched.');
  });

  it('reviewSummaryText_NoneUntouched_EndsAtTheCount', () => {
    expect(
      reviewSummaryText({
        answered: 3,
        notApplicable: 0,
        untouched: 0,
        total: 3,
      }),
    ).toBe('3 of 3 answered.');
  });
});

describe('roundSaveLabel', () => {
  it('reads Sending… while the round is sending', () => {
    const round = roundAfter(
      { type: 'openReview' },
      { type: 'sendStarted', roundId: 'r1', kind: 'submitted' },
    );
    expect(roundSaveLabel(round)).toBe('Sending…');
  });

  it('reads the save state while the round is not sending', () => {
    expect(roundSaveLabel(roundAfter())).toBe('Saved');
  });
});

describe('roundSaveState', () => {
  it('is null while the round is sending, an edit unsaved', () => {
    const round = roundAfter(
      { type: 'openReview' },
      { type: 'sendStarted', roundId: 'r1', kind: 'submitted' },
      { type: 'setText', roundId: 'r1', target: { field: 'note' }, value: 'x' },
    );
    expect(roundSaveState(round)).toBeNull();
  });

  it('is the save state while the round is not sending', () => {
    const round = roundAfter({
      type: 'setText',
      roundId: 'r1',
      target: { field: 'note' },
      value: 'x',
    });
    expect(roundSaveState(round)).toBe('unsaved');
  });
});

describe('reviewRowsChanged', () => {
  // Questions Alpha and Beta, in the review.
  const reviewing = stateAfter({ type: 'openReview' });
  const round = activeOf(reviewing);
  const edit = (state: FormsState, target: TextTarget, value: string) =>
    apply(state, { type: 'setText', roundId: 'r1', target, value });

  it('is true with nothing drawn', () => {
    expect(reviewRowsChanged(null, round)).toBe(true);
  });

  it('is false after a Round note edit', () => {
    const noted = activeOf(edit(reviewing, { field: 'note' }, 'checked'));
    expect(reviewRowsChanged(round, noted)).toBe(false);
  });

  it('is false after a draft save starts and finishes', () => {
    const noted = edit(reviewing, { field: 'note' }, 'checked');
    const saved = [
      { type: 'saveStarted', roundId: 'r1', revision: 1 },
      { type: 'saveFinished', roundId: 'r1', revision: 1, ok: true },
    ] satisfies FormsAction[];
    const afterSave = activeOf(saved.reduce(apply, noted));
    expect(reviewRowsChanged(activeOf(noted), afterSave)).toBe(false);
  });

  it('is true after the review cursor moves', () => {
    const moved = activeOf(apply(reviewing, { type: 'reviewNext' }));
    expect(reviewRowsChanged(round, moved)).toBe(true);
  });

  it("is true after a question's notes change", () => {
    const target: TextTarget = {
      field: 'notes',
      item: { kind: 'question', index: 1 },
    };
    const noted = activeOf(edit(reviewing, target, 'why'));
    expect(reviewRowsChanged(round, noted)).toBe(true);
  });

  it("is true after a finding's answer changes", () => {
    const withFinding = apply(stateWithFinding(finding('Delta')), {
      type: 'openReview',
    });
    const target: TextTarget = {
      field: 'notes',
      item: { kind: 'finding', index: 1 },
    };
    const noted = activeOf(edit(withFinding, target, 'why'));
    expect(reviewRowsChanged(activeOf(withFinding), noted)).toBe(true);
  });
});

describe('railPickAction', () => {
  it('focuses the clicked item in the forms view', () => {
    expect(railPickAction('forms', 2, 1)).toEqual({
      type: 'focusItem',
      item: 2,
    });
  });

  it("jumps to a finding's or question's row in the review", () => {
    expect(railPickAction('review', 2, 1)).toEqual({
      type: 'reviewJump',
      row: 1,
    });
  });

  it("leaves the review for a notice's card", () => {
    expect(railPickAction('review', 0, undefined)).toEqual({
      type: 'reviewJumpItem',
      item: 0,
    });
  });

  it('does nothing under the cancel prompt or with no round', () => {
    expect(railPickAction('confirm', 0, undefined)).toBeNull();
    expect(railPickAction('confirm', 2, 1)).toBeNull();
    expect(railPickAction('idle', 0, undefined)).toBeNull();
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
    const choose: FormsAction = { type: 'choose', number: 1 };

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
    const round = activeRound(apply(start, { type: 'choose', number: 1 }));
    if (round === null) {
      throw new Error('The test round is not active');
    }
    expect(sessionTitle(round)).toBe('r1 heading 1/3');
  });
});

describe('pickRailItem', () => {
  // Rail position = question position in the three-question round.
  function picker(state: FormsState = threeQuestionState()) {
    let current = state;
    const dispatched: FormsAction[] = [];
    const logs: string[] = [];
    const deps = {
      dispatch(action: FormsAction) {
        dispatched.push(action);
        current = apply(current, action);
      },
      getState: () => current,
      log: (source: string, line: string) => logs.push(`[${source}] ${line}`),
    };
    return { deps, dispatched, logs };
  }

  function threeQuestionState(...actions: FormsAction[]): FormsState {
    return actions.reduce(
      apply,
      initialState(
        [
          presentedRound('r1', {
            questions: [question('Alpha'), question('Beta'), question('Gamma')],
          }),
        ],
        'r1-session',
      ),
    );
  }

  it('focuses the clicked item and logs the jump as a key jump does', () => {
    const { deps, dispatched, logs } = picker();

    pickRailItem(deps, 'forms', { kind: 'question', index: 2 }, 1, 1);

    expect(dispatched).toEqual([{ type: 'focusItem', item: 1 }]);
    expect(logs).toEqual(['[forms] jumped to question 2']);
  });

  it('logs no jump on a click on the item that has focus', () => {
    const { deps, logs } = picker(
      threeQuestionState({ type: 'focusItem', item: 1 }),
    );

    pickRailItem(deps, 'forms', { kind: 'question', index: 2 }, 1, 1);

    expect(logs).toEqual([]);
  });

  it('logs no jump on a click while the round sends', () => {
    const { deps, logs } = picker(
      threeQuestionState({
        type: 'sendStarted',
        roundId: 'r1',
        kind: 'submitted',
      }),
    );

    pickRailItem(deps, 'forms', { kind: 'question', index: 2 }, 1, 1);

    expect(logs).toEqual([]);
  });

  it('logs nothing and dispatches nothing under the cancel prompt', () => {
    const { deps, dispatched, logs } = picker();

    pickRailItem(deps, 'confirm', { kind: 'finding', index: 1 }, 0, 0);

    expect(dispatched).toEqual([]);
    expect(logs).toEqual([]);
  });
});
