import { describe, expect, it } from 'vitest';
import { activeForm } from '../../../shared/page/session-forms';
import type { Finding, FormsScreen } from '../contract';
import type { FormsAction, FormsState } from './form-state';
import type { RoundState, TextTarget } from './round-model';
import { poll, pollPageKind } from './kinds/plugin-page-kind.test-support';
import {
  apply,
  decision,
  finding,
  formsWith,
  initialState,
  notice,
  presentedRound,
  question,
} from './test-rounds';
import {
  hasOtherUnanswered,
  pagerText,
  pickRailItem,
  progressText,
  railHeadText,
  railDotStatus,
  railEntryLabel,
  railEntryTitle,
  railPickAction,
  reviewRows,
  reviewRowsChanged,
  reviewSummaryText,
  roundSaveState,
  sessionTitle,
} from './view-model';
import { useBuiltInFindingOrigins } from '../finding-origins.test-support';

useBuiltInFindingOrigins();

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
  const round = activeForm(actions.reduce(apply, start));
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
  const round = activeForm(state);
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
  it("reads an answerable plugin kind's row from its kind", () => {
    const forms = formsWith([pollPageKind('poll')]);
    const start = forms.initialState(
      [
        presentedRound('r1', {
          questions: [],
          items: { poll: [poll('Lunch', { options: ['soup', 'salad'] })] },
          bodyKeys: { poll: 'poll_answers' },
        }),
      ],
      'r1-session',
    );
    const actions: FormsAction[] = [
      { type: 'focusItem', item: 0 },
      { type: 'choose', number: 1 },
    ];
    const state = actions.reduce(forms.apply, start);

    expect(reviewRows(activeOf(state))).toEqual([
      expect.objectContaining({
        kind: 'poll',
        label: 'P1',
        title: 'Lunch',
        status: 'answered',
        choice: 1,
        choiceText: 'soup',
        tookRecommendation: true,
        recommended: true,
        action: '',
      }),
    ]);
  });

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
        formId: 'r1',
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
          formId: 'r1',
          target: { field: 'notes', item: { kind: 'question', index: 1 } },
          value: 'my own',
        },
        { type: 'toggleDontAsk' },
        {
          type: 'setText',
          formId: 'r1',
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
        formId: 'r1',
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

  it('shows the notices stop and a stop of a kind with no answer as idle', () => {
    expect(railDotStatus('notices', true)).toBe('idle');
    expect(railDotStatus('none', true)).toBe('idle');
  });
});

describe('rail entries', () => {
  const presented = presentedRound('r1', {
    findings: [finding('Leak')],
    questions: [question('Alpha'), question('Beta')],
    notices: [notice('Heads up'), notice('Also')],
  });
  const round = apply(initialState([], presented.sessionId), {
    type: 'formShown',
    form: presented,
  }).forms[0];

  it.each([
    {
      case: 'finding 1',
      item: { kind: 'finding', index: 1 } as const,
      label: 'F1',
      title: 'Leak',
    },
    {
      case: 'question 2',
      item: { kind: 'question', index: 2 } as const,
      label: '2',
      title: 'Beta',
    },
    {
      case: 'the notices stop',
      item: { kind: 'notices' } as const,
      label: 'N',
      title: 'Notices · 2',
    },
  ])('railEntryLabel and railEntryTitle: $case', ({ item, label, title }) => {
    expect(railEntryLabel(round, item)).toBe(label);
    expect(railEntryTitle(round, item)).toBe(title);
  });
});

describe('pagerText', () => {
  // Rail positions: 0 = question Alpha, 1 = the notices stop.
  const state = initialState(
    [
      presentedRound('r1', {
        questions: [question('Alpha')],
        notices: [notice('Heads up')],
      }),
    ],
    'r1-session',
  );

  it.each([
    { case: 'question 1', focus: 0, text: '1 of 2' },
    { case: 'the notices stop', focus: 1, text: 'N of 2' },
  ])('pagerText reads $text on $case', ({ focus, text }) => {
    const focused = apply(state, { type: 'focusItem', item: focus });
    expect(pagerText(activeOf(focused))).toBe(text);
  });
});

describe('progressText, railHeadText and reviewSummaryText', () => {
  it.each([
    {
      counts: { answered: 2, notApplicable: 0, untouched: 1, total: 3 },
      progress: '2 of 3 answered',
      railHead: 'Items · 1 open',
      summary: '2 of 3 answered. 1 not answered; they are sent as untouched.',
    },
    {
      counts: { answered: 2, notApplicable: 1, untouched: 3, total: 6 },
      progress: '2 of 6 answered, 1 not applicable',
      railHead: 'Items · 3 open',
      summary:
        '2 of 6 answered, 1 not applicable. 3 not answered; they are sent as untouched.',
    },
    {
      counts: { answered: 4, notApplicable: 0, untouched: 0, total: 4 },
      progress: '4 of 4 answered',
      railHead: 'Items · 0 open',
      summary: '4 of 4 answered.',
    },
  ])(
    'reads $progress with $counts.untouched untouched',
    ({ counts, progress, railHead, summary }) => {
      expect(progressText(counts)).toBe(progress);
      expect(railHeadText(counts)).toBe(railHead);
      expect(reviewSummaryText(counts)).toBe(summary);
    },
  );
});

describe('hasOtherUnanswered', () => {
  it('hasOtherUnanswered is false with every item responded, false with only the focused item untouched, and true with another item untouched', () => {
    const everyResponded = roundAfter(
      { type: 'choose', number: 1 },
      { type: 'focusItem', item: 1 },
      { type: 'choose', number: 1 },
      { type: 'focusItem', item: 2 },
      { type: 'choose', number: 1 },
    );
    const onlyFocusedUntouched = roundAfter(
      { type: 'focusItem', item: 1 },
      { type: 'choose', number: 1 },
      { type: 'focusItem', item: 2 },
      { type: 'choose', number: 1 },
      { type: 'focusItem', item: 0 },
    );
    const anotherUntouched = roundAfter({ type: 'choose', number: 1 });

    expect(hasOtherUnanswered(everyResponded)).toBe(false);
    expect(hasOtherUnanswered(onlyFocusedUntouched)).toBe(false);
    expect(hasOtherUnanswered(anotherUntouched)).toBe(true);
  });
});

describe('roundSaveState', () => {
  const edit: FormsAction = {
    type: 'setText',
    formId: 'r1',
    target: { field: 'note' },
    value: 'x',
  };

  it.each([
    {
      case: 'sending, an edit unsaved',
      actions: [
        { type: 'openReview' },
        { type: 'sendStarted', formId: 'r1', kind: 'submitted' },
        edit,
      ] satisfies FormsAction[],
      state: null,
    },
    {
      case: 'not sending, an edit unsaved',
      actions: [edit],
      state: 'unsaved',
    },
  ])('reads $state while $case', ({ actions, state }) => {
    const round = roundAfter(...actions);

    expect(roundSaveState(round)).toBe(state);
  });
});

describe('reviewRowsChanged', () => {
  // Questions Alpha and Beta, in the review.
  const reviewing = stateAfter({ type: 'openReview' });
  const round = activeOf(reviewing);
  const edit = (state: FormsState, target: TextTarget, value: string) =>
    apply(state, { type: 'setText', formId: 'r1', target, value });

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
      { type: 'saveStarted', formId: 'r1', revision: 1 },
      { type: 'saveFinished', formId: 'r1', revision: 1, error: null },
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
  it.each([
    {
      view: 'forms',
      position: 2,
      reviewRow: 1,
      expected: { type: 'focusItem', item: 2 },
    },
    {
      view: 'review',
      position: 2,
      reviewRow: 1,
      expected: { type: 'reviewJump', row: 1 },
    },
    {
      view: 'review',
      position: 3,
      reviewRow: undefined,
      expected: { type: 'reviewJumpItem', item: 3 },
    },
    { view: 'confirm', position: 3, reviewRow: undefined, expected: null },
    { view: 'confirm', position: 2, reviewRow: 1, expected: null },
    { view: 'idle', position: 3, reviewRow: undefined, expected: null },
  ] satisfies {
    view: FormsScreen;
    position: number;
    reviewRow: number | undefined;
    expected: FormsAction | null;
  }[])(
    'in the $view view, picking $position with review row $reviewRow',
    ({ view, position, reviewRow, expected }) => {
      expect(railPickAction(view, position, reviewRow)).toEqual(expected);
    },
  );
});

describe('sessionTitle', () => {
  // presentedRound('r1') has two questions and no notices.
  function titleAfter(...actions: FormsAction[]): string {
    const round = activeForm(stateAfter(...actions));
    if (round === null) {
      throw new Error('The test round is not active');
    }
    return sessionTitle(round);
  }

  it('sessionTitle counts answered and not-applicable questions', () => {
    const choose: FormsAction = { type: 'choose', number: 1 };

    expect(titleAfter()).toMatch(/\b0\/2$/);
    expect(titleAfter(choose)).toMatch(/\b1\/2$/);
    expect(
      titleAfter(choose, { type: 'nextItem' }, { type: 'toggleNotApplicable' }),
    ).toMatch(/\b2\/2$/);
  });

  it('counts findings with questions', () => {
    const start = initialState(
      [presentedRound('r1', { findings: [finding('Delta')] })],
      'r1-session',
    );
    const round = activeForm(apply(start, { type: 'choose', number: 1 }));
    if (round === null) {
      throw new Error('The test round is not active');
    }
    expect(sessionTitle(round)).toMatch(/\b1\/3$/);
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
      log: (line: string) => logs.push(line),
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
    expect(logs).toEqual([expect.stringContaining('question 2')]);
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
        formId: 'r1',
        kind: 'submitted',
      }),
    );

    pickRailItem(deps, 'forms', { kind: 'question', index: 2 }, 1, 1);

    expect(logs).toEqual([]);
  });

  it('logs a click on the notices stop as a jump to notices', () => {
    const { deps, logs } = picker(
      initialState(
        [
          presentedRound('r1', {
            questions: [question('Alpha')],
            notices: [notice('Heads up')],
          }),
        ],
        'r1-session',
      ),
    );

    pickRailItem(deps, 'forms', { kind: 'notices' }, 1, undefined);

    expect(logs).toEqual(['jumped to notices']);
  });

  it('logs nothing and dispatches nothing under the cancel prompt', () => {
    const { deps, dispatched, logs } = picker();

    pickRailItem(deps, 'confirm', { kind: 'finding', index: 1 }, 0, 0);

    expect(dispatched).toEqual([]);
    expect(logs).toEqual([]);
  });
});
