import { describe, expect, it } from 'vitest';
import type {
  AnswerEntry,
  FindingAnswerEntry,
  FormBody,
  Notice,
  PresentedRound,
  Question,
  Round,
} from '../contract';
import {
  activeRound,
  answerStatus,
  apply,
  buildBody,
  focusedItem,
  initialState,
  progress,
  railItems,
  saveState,
  type FormsAction,
  type FormsState,
  type RoundState,
  unansweredItem,
} from './form-state';
import { finding } from './test-rounds';

function question(title: string, choiceCount = 3): Question {
  return {
    title,
    context: `${title} context`,
    question: `${title}?`,
    choices: Array.from(
      { length: choiceCount },
      (_, i) => `${title} choice ${i + 1}`,
    ),
    recommend: 1,
    rationale: `${title} rationale`,
  };
}

function notice(title: string): Notice {
  return { title, context: `${title} context`, badge: 'Applied' };
}

function presented(
  roundId: string,
  parts: Partial<Round> = {},
  draft: FormBody | null = null,
): PresentedRound {
  return {
    roundId,
    sessionId: `${roundId}-session`,
    label: `project · ${roundId}`,
    round: {
      heading: roundId,
      overview: '',
      questions: [question('Q1'), question('Q2')],
      notices: [],
      findings: [],
      ...parts,
    },
    draft,
  };
}

function entry(index: number, fields: Partial<AnswerEntry>): AnswerEntry {
  return {
    index,
    choice: 0,
    not_applicable: false,
    notes: '',
    dont_ask: false,
    dont_ask_reason: '',
    ...fields,
  };
}

function findingEntry(
  index: number,
  fields: Partial<FindingAnswerEntry>,
): FindingAnswerEntry {
  return { ...entry(index, fields), action: '', ...fields };
}

function draft(fields: Partial<FormBody>): FormBody {
  return {
    note: '',
    answers: [],
    finding_answers: [],
    notice_comments: [],
    ...fields,
  };
}

function run(state: FormsState, ...actions: FormsAction[]): FormsState {
  return actions.reduce(apply, state);
}

function active(state: FormsState): RoundState {
  const round = activeRound(state);
  if (round === null) {
    throw new Error('expected an active round');
  }
  return round;
}

// Rail positions: 0 = notice N1, 1 = question Q1, 2 = question Q2.
function mixedRound(body: FormBody | null = null): FormsState {
  return initialState(
    [presented('r1', { notices: [notice('N1')] }, body)],
    'r1-session',
  );
}

// Rail positions: 0 = notice N1, 1 = finding F1, 2 = question Q1, 3 = question Q2.
function findingRound(body: FormBody | null = null): FormsState {
  return initialState(
    [
      presented(
        'r1',
        { notices: [notice('N1')], findings: [finding('F1')] },
        body,
      ),
    ],
    'r1-session',
  );
}

// Focuses rail position 0, finding F1, whose only solution is choice 1.
function oneSolutionRound(): FormsState {
  const lone = finding('F1', {
    choices: [{ text: 'only', reason: 'only reason' }],
    recommend: 1,
  });
  return apply(
    initialState([presented('r1', { findings: [lone] })], 'r1-session'),
    { type: 'focusItem', item: 0 },
  );
}

// Focuses rail position 0, the round's first notice.
function onNotice(state: FormsState): FormsState {
  return apply(state, { type: 'focusItem', item: 0 });
}

const untouched = {
  choice: 0,
  notApplicable: false,
  notes: '',
  dontAsk: false,
  dontAskReason: '',
};

describe('initialState', () => {
  it('shows the idle view with no rounds', () => {
    const state = initialState([], 'r1-session');
    expect(state.view).toBe('idle');
    expect(activeRound(state)).toBeNull();
  });

  it("makes the active session's round active", () => {
    const state = initialState(
      [presented('r1'), presented('r2')],
      'r2-session',
    );
    expect(state.activeRoundId).toBe('r2');
    expect(state.view).toBe('forms');
    expect(state.rounds.map((round) => round.roundId)).toEqual(['r1', 'r2']);
  });

  it('shows no round with no active session', () => {
    const state = initialState([presented('r1')], null);
    expect(state.activeRoundId).toBeNull();
    expect(state.view).toBe('idle');
  });

  it('focuses the first finding or question, past the notices', () => {
    expect(focusedItem(active(mixedRound()))).toEqual({
      kind: 'question',
      index: 1,
    });
    expect(focusedItem(active(findingRound()))).toEqual({
      kind: 'finding',
      index: 1,
    });
  });

  it('focuses the first notice when the round has nothing to answer', () => {
    const state = initialState(
      [presented('r1', { notices: [notice('N1')], questions: [] })],
      'r1-session',
    );
    expect(focusedItem(active(state))).toEqual({ kind: 'notice', index: 1 });
  });
});

describe('railItems', () => {
  it('lists notices, then findings, then questions, each numbered from 1 in its kind', () => {
    const round: Round = {
      heading: 'h',
      overview: '',
      questions: [question('Q1')],
      notices: [notice('N1')],
      findings: [finding('F1'), finding('F2')],
    };
    expect(railItems(round)).toEqual([
      { kind: 'notice', index: 1 },
      { kind: 'finding', index: 1 },
      { kind: 'finding', index: 2 },
      { kind: 'question', index: 1 },
    ]);
  });
});

describe('restoring a draft', () => {
  it('restores choices, text, dont ask, notice comments and the note', () => {
    const round = active(
      mixedRound(
        draft({
          note: 'overall',
          answers: [
            entry(2, {
              choice: 3,
              notes: 'own answer',
              dont_ask: true,
              dont_ask_reason: 'settled',
            }),
          ],
          notice_comments: [{ index: 1, comment: 'look again' }],
        }),
      ),
    );
    expect(round.answers[0]).toEqual(untouched);
    expect(round.answers[1]).toEqual({
      choice: 3,
      notApplicable: false,
      notes: 'own answer',
      dontAsk: true,
      dontAskReason: 'settled',
    });
    expect(round.noticeComments).toEqual(['look again']);
    expect(round.note).toBe('overall');
  });

  it('keeps the choice of an answer marked not applicable', () => {
    const round = active(
      mixedRound(
        draft({ answers: [entry(1, { choice: 2, not_applicable: true })] }),
      ),
    );
    expect(round.answers[0].choice).toBe(2);
    expect(round.answers[0].notApplicable).toBe(true);
  });

  it('drops a choice beyond the question’s choices', () => {
    const round = active(
      mixedRound(draft({ answers: [entry(1, { choice: 4 })] })),
    );
    expect(round.answers[0].choice).toBe(0);
  });

  it("restores a finding's answer from finding_answers", () => {
    const round = active(
      findingRound(
        draft({
          finding_answers: [
            findingEntry(1, { choice: 3, notes: 'seen', action: 'follow_up' }),
          ],
        }),
      ),
    );
    expect(round.findingAnswers[0]).toMatchObject({
      choice: 3,
      notes: 'seen',
      action: 'follow_up',
    });
    expect(round.answers).toEqual([untouched, untouched]);
  });

  it("drops a choice beyond the finding's choices", () => {
    const round = active(
      findingRound(
        draft({ finding_answers: [findingEntry(1, { choice: 4 })] }),
      ),
    );
    expect(round.findingAnswers[0].choice).toBe(0);
  });

  it.each([
    { action: 'fix_now', choice: 1 },
    { action: 'follow_up', choice: 1 },
    { action: 'leave_it', choice: 0 },
    { action: '', choice: 0 },
  ] as const)(
    "restores a one-solution finding's $action draft with choice $choice",
    ({ action, choice }) => {
      const lone = finding('F1', {
        choices: [{ text: 'only', reason: 'only reason' }],
        recommend: 1,
      });
      const state = initialState(
        [
          presented(
            'r1',
            { findings: [lone] },
            draft({
              finding_answers: [findingEntry(1, { choice: 0, action })],
            }),
          ),
        ],
        'r1-session',
      );
      expect(active(state).findingAnswers[0]).toMatchObject({ action, choice });
    },
  );

  it("restores a finding's unknown action as none", () => {
    const saved = { ...findingEntry(1, { choice: 1 }), action: 'Fix now' };
    const round = active(
      findingRound(
        draft({ finding_answers: [saved as unknown as FindingAnswerEntry] }),
      ),
    );
    expect(round.findingAnswers[0].action).toBe('');
  });

  it('ignores an entry whose index names no question', () => {
    const round = active(
      mixedRound(draft({ answers: [entry(5, { choice: 1 })] })),
    );
    expect(round.answers).toEqual([untouched, untouched]);
  });

  it('starts saved', () => {
    expect(saveState(active(mixedRound()))).toBe('saved');
  });
});

describe('choose', () => {
  const onQ1 = apply(mixedRound(), { type: 'focusItem', item: 1 });

  it('picks the numbered choice on the focused question', () => {
    const state = apply(onQ1, { type: 'choose', choice: 2 });
    expect(active(state).answers[0].choice).toBe(2);
  });

  it('picks the numbered choice on the focused finding', () => {
    const state = run(
      findingRound(),
      { type: 'focusItem', item: 1 },
      { type: 'choose', choice: 2 },
    );
    expect(active(state).findingAnswers[0].choice).toBe(2);
    expect(active(state).answers[0].choice).toBe(0);
    expect(active(state).revision).toBe(1);
  });

  it('clears the choice when the same number is picked again', () => {
    const state = run(
      onQ1,
      { type: 'choose', choice: 2 },
      { type: 'choose', choice: 2 },
    );
    expect(active(state).answers[0].choice).toBe(0);
  });

  it('switches to another number', () => {
    const state = run(
      onQ1,
      { type: 'choose', choice: 2 },
      { type: 'choose', choice: 3 },
    );
    expect(active(state).answers[0].choice).toBe(3);
  });

  it('does nothing on a notice', () => {
    const state = onNotice(mixedRound());
    expect(apply(state, { type: 'choose', choice: 1 })).toBe(state);
  });

  it('does nothing on a question marked not applicable', () => {
    const state = apply(onQ1, { type: 'toggleNotApplicable' });
    expect(apply(state, { type: 'choose', choice: 1 })).toBe(state);
  });

  it('does nothing for a number outside the choices', () => {
    expect(apply(onQ1, { type: 'choose', choice: 0 })).toBe(onQ1);
    expect(apply(onQ1, { type: 'choose', choice: 4 })).toBe(onQ1);
  });
});

describe('clearChoice', () => {
  const chosen = run(
    mixedRound(),
    { type: 'focusItem', item: 1 },
    { type: 'choose', choice: 2 },
  );

  it('clears the focused question’s choice', () => {
    const state = apply(chosen, { type: 'clearChoice' });
    expect(active(state).answers[0].choice).toBe(0);
  });

  it('keeps the choice of a question marked not applicable', () => {
    const state = apply(chosen, { type: 'toggleNotApplicable' });
    expect(apply(state, { type: 'clearChoice' })).toBe(state);
  });

  it("clears a finding's solution and keeps its action", () => {
    const state = run(
      findingRound(),
      { type: 'focusItem', item: 1 },
      { type: 'choose', choice: 2 },
      { type: 'chooseAction', action: 'fix_now' },
      { type: 'clearChoice' },
    );
    expect(active(state).findingAnswers[0]).toMatchObject({
      choice: 0,
      action: 'fix_now',
    });
  });

  it("keeps a one-solution finding's solution while it is fixed now", () => {
    const fixed = apply(oneSolutionRound(), {
      type: 'chooseAction',
      action: 'fix_now',
    });
    expect(apply(fixed, { type: 'clearChoice' })).toBe(fixed);
    expect(active(fixed).findingAnswers[0].choice).toBe(1);
  });

  it("keeps a one-solution finding's solution while it is followed up, when its number is picked again", () => {
    const followed = apply(oneSolutionRound(), {
      type: 'chooseAction',
      action: 'follow_up',
    });
    expect(apply(followed, { type: 'choose', choice: 1 })).toBe(followed);
  });

  it("clears a one-solution finding's solution while it is left", () => {
    const state = run(
      oneSolutionRound(),
      { type: 'choose', choice: 1 },
      { type: 'chooseAction', action: 'leave_it' },
      { type: 'clearChoice' },
    );
    expect(active(state).findingAnswers[0]).toMatchObject({
      choice: 0,
      action: 'leave_it',
    });
  });

  it("clears a one-solution finding's solution with no action", () => {
    const state = run(
      oneSolutionRound(),
      { type: 'choose', choice: 1 },
      { type: 'clearChoice' },
    );
    expect(active(state).findingAnswers[0].choice).toBe(0);
  });
});

describe('chooseAction', () => {
  // Rail position 1 is finding F1, with three solutions.
  const onF1 = apply(findingRound(), { type: 'focusItem', item: 1 });

  it('sets the action on the focused finding, as an answer edit', () => {
    const state = apply(onF1, { type: 'chooseAction', action: 'follow_up' });
    expect(active(state).findingAnswers[0]).toMatchObject({
      action: 'follow_up',
      choice: 0,
    });
    expect(active(state).revision).toBe(1);
  });

  it('clears the action when the same one is picked again', () => {
    const state = run(
      onF1,
      { type: 'chooseAction', action: 'follow_up' },
      { type: 'chooseAction', action: 'follow_up' },
    );
    expect(active(state).findingAnswers[0].action).toBe('');
  });

  it('picks the one solution on fix_now, and keeps it when cleared', () => {
    const set = apply(oneSolutionRound(), {
      type: 'chooseAction',
      action: 'fix_now',
    });
    expect(active(set).findingAnswers[0]).toMatchObject({
      action: 'fix_now',
      choice: 1,
    });

    const cleared = apply(set, { type: 'chooseAction', action: 'fix_now' });
    expect(active(cleared).findingAnswers[0]).toMatchObject({
      action: '',
      choice: 1,
    });
  });

  it('keeps the solution on leave_it', () => {
    const state = run(
      onF1,
      { type: 'choose', choice: 2 },
      { type: 'chooseAction', action: 'leave_it' },
    );
    expect(active(state).findingAnswers[0]).toMatchObject({
      action: 'leave_it',
      choice: 2,
    });
  });

  it('lets choose change the kept solution while the action is leave_it', () => {
    const state = run(
      onF1,
      { type: 'chooseAction', action: 'leave_it' },
      { type: 'choose', choice: 3 },
    );
    expect(active(state).findingAnswers[0]).toMatchObject({
      action: 'leave_it',
      choice: 3,
    });
  });

  it('does nothing on a question', () => {
    const state = apply(findingRound(), { type: 'focusItem', item: 2 });
    expect(apply(state, { type: 'chooseAction', action: 'fix_now' })).toBe(
      state,
    );
  });

  it('does nothing while the finding is not applicable', () => {
    const state = apply(onF1, { type: 'toggleNotApplicable' });
    expect(apply(state, { type: 'chooseAction', action: 'fix_now' })).toBe(
      state,
    );
  });
});

describe('answerStatus', () => {
  const f1 = { kind: 'finding', index: 1 } as const;
  const onF1 = apply(findingRound(), { type: 'focusItem', item: 1 });

  it('leaves a finding untouched with an action and no solution', () => {
    const state = apply(onF1, { type: 'chooseAction', action: 'fix_now' });
    expect(answerStatus(active(state), f1)).toBe('untouched');
  });

  it('answers a finding with its action and solution', () => {
    const state = run(
      onF1,
      { type: 'chooseAction', action: 'fix_now' },
      { type: 'choose', choice: 2 },
    );
    expect(answerStatus(active(state), f1)).toBe('answered');
  });

  it('answers a finding with notes alone', () => {
    const state = apply(onF1, {
      type: 'setText',
      roundId: 'r1',
      target: { field: 'notes', item: f1 },
      value: 'my own fix',
    });
    expect(answerStatus(active(state), f1)).toBe('answered');
  });
});

describe('toggleNotApplicable', () => {
  it('marks the focused question and keeps its choice for toggling back', () => {
    const marked = run(
      mixedRound(),
      { type: 'focusItem', item: 1 },
      { type: 'choose', choice: 2 },
      { type: 'toggleNotApplicable' },
    );
    expect(active(marked).answers[0]).toMatchObject({
      choice: 2,
      notApplicable: true,
    });
    expect(progress(active(marked)).notApplicable).toBe(1);

    const unmarked = apply(marked, { type: 'toggleNotApplicable' });
    expect(progress(active(unmarked)).answered).toBe(1);
  });

  it('marks the focused finding and keeps its choice', () => {
    const state = run(
      findingRound(),
      { type: 'focusItem', item: 1 },
      { type: 'choose', choice: 2 },
      { type: 'toggleNotApplicable' },
    );
    expect(active(state).findingAnswers[0]).toMatchObject({
      choice: 2,
      notApplicable: true,
    });
  });

  it('does nothing on a notice', () => {
    const state = onNotice(mixedRound());
    expect(apply(state, { type: 'toggleNotApplicable' })).toBe(state);
  });
});

describe('toggleDontAsk', () => {
  it('flips dont ask and keeps the reason text', () => {
    const state = run(
      mixedRound(),
      { type: 'focusItem', item: 2 },
      { type: 'toggleDontAsk' },
      {
        type: 'setText',
        roundId: 'r1',
        target: {
          field: 'dontAskReason',
          item: { kind: 'question', index: 2 },
        },
        value: 'settled',
      },
      { type: 'toggleDontAsk' },
    );
    expect(active(state).answers[1]).toMatchObject({
      dontAsk: false,
      dontAskReason: 'settled',
    });
    expect(
      active(apply(state, { type: 'toggleDontAsk' })).answers[1].dontAsk,
    ).toBe(true);
  });

  it('stays live on a question marked not applicable', () => {
    const state = run(
      mixedRound(),
      { type: 'focusItem', item: 1 },
      { type: 'toggleNotApplicable' },
      { type: 'toggleDontAsk' },
    );
    expect(active(state).answers[0].dontAsk).toBe(true);
  });

  it('does nothing on a notice', () => {
    const state = onNotice(mixedRound());
    expect(apply(state, { type: 'toggleDontAsk' })).toBe(state);
  });
});

describe('setText', () => {
  function edit(target: Extract<FormsAction, { type: 'setText' }>['target']) {
    return active(
      apply(findingRound(), {
        type: 'setText',
        roundId: 'r1',
        target,
        value: 'typed',
      }),
    );
  }

  it('writes each text field to the item it names', () => {
    expect(
      edit({ field: 'notes', item: { kind: 'question', index: 2 } }).answers[1]
        .notes,
    ).toBe('typed');
    expect(
      edit({ field: 'notes', item: { kind: 'finding', index: 1 } })
        .findingAnswers[0].notes,
    ).toBe('typed');
    expect(
      edit({ field: 'dontAskReason', item: { kind: 'question', index: 1 } })
        .answers[0].dontAskReason,
    ).toBe('typed');
    expect(edit({ field: 'comment', notice: 1 }).noticeComments).toEqual([
      'typed',
    ]);
    expect(edit({ field: 'note' }).note).toBe('typed');
  });

  it('writes to an item that is not focused', () => {
    expect(
      focusedItem(
        edit({ field: 'notes', item: { kind: 'question', index: 2 } }),
      ),
    ).toEqual({
      kind: 'finding',
      index: 1,
    });
  });

  it('ignores an edit for a round that is not open', () => {
    const state = mixedRound();
    const next = apply(state, {
      type: 'setText',
      roundId: 'other',
      target: { field: 'note' },
      value: 'typed',
    });
    expect(next).toBe(state);
  });

  it('ignores an edit naming an item the round does not have', () => {
    const state = findingRound();
    const next = apply(state, {
      type: 'setText',
      roundId: 'r1',
      target: { field: 'notes', item: { kind: 'finding', index: 3 } },
      value: 'typed',
    });
    expect(next).toBe(state);
  });

  it('ignores an edit that changes nothing', () => {
    const noted = apply(mixedRound(), {
      type: 'setText',
      roundId: 'r1',
      target: { field: 'note' },
      value: 'same',
    });
    const again = apply(noted, {
      type: 'setText',
      roundId: 'r1',
      target: { field: 'note' },
      value: 'same',
    });
    expect(again).toBe(noted);
  });
});

describe('item navigation', () => {
  it('moves one rail item at a time and stops at both ends', () => {
    const start = onNotice(mixedRound());
    expect(apply(start, { type: 'prevItem' })).toBe(start);

    const end = run(
      start,
      { type: 'nextItem' },
      { type: 'nextItem' },
      { type: 'nextItem' },
    );
    expect(focusedItem(active(end))).toEqual({ kind: 'question', index: 2 });

    const back = apply(end, { type: 'prevItem' });
    expect(focusedItem(active(back))).toEqual({ kind: 'question', index: 1 });
  });

  it('focusItem ignores a position outside the rail', () => {
    const state = mixedRound();
    expect(apply(state, { type: 'focusItem', item: 3 })).toBe(state);
    expect(apply(state, { type: 'focusItem', item: -1 })).toBe(state);
  });
});

describe('sessionActivated', () => {
  const two = initialState([presented('r1'), presented('r2')], 'r1-session');

  it("shows the session's round in the form", () => {
    const state = apply(two, {
      type: 'sessionActivated',
      sessionId: 'r2-session',
    });
    expect(state.activeRoundId).toBe('r2');
    expect(state.view).toBe('forms');
  });

  it('shows the idle view for a session with no round', () => {
    const state = apply(two, { type: 'sessionActivated', sessionId: 'other' });
    expect(state.activeRoundId).toBeNull();
    expect(state.view).toBe('idle');
  });

  it('dismisses a pending cancel prompt', () => {
    const state = run(
      two,
      { type: 'askClose', sessionId: 'r1-session' },
      { type: 'sessionActivated', sessionId: 'r2-session' },
    );
    expect(state.view).toBe('forms');
    expect(state.activeRoundId).toBe('r2');
    expect(state.confirmClosesTab).toBe(false);
  });

  it('changes nothing for the session already active', () => {
    expect(
      apply(two, { type: 'sessionActivated', sessionId: 'r1-session' }),
    ).toBe(two);
  });

  it("keeps each round's answers apart", () => {
    const state = run(
      two,
      { type: 'focusItem', item: 0 },
      { type: 'choose', choice: 2 },
      { type: 'sessionActivated', sessionId: 'r2-session' },
    );
    expect(active(state).answers[0].choice).toBe(0);
    const back = apply(state, {
      type: 'sessionActivated',
      sessionId: 'r1-session',
    });
    expect(active(back).answers[0].choice).toBe(2);
  });
});

describe('askClose', () => {
  const two = initialState([presented('r1'), presented('r2')], 'r1-session');
  const askClose: FormsAction = { type: 'askClose', sessionId: 'r1-session' };

  it('opens the prompt from the form and keeping returns to the form', () => {
    const asked = apply(two, askClose);
    expect(asked.view).toBe('confirm');
    expect(asked.confirmClosesTab).toBe(true);
    const kept = apply(asked, { type: 'dismissConfirm' });
    expect(kept.view).toBe('forms');
    expect(kept.confirmClosesTab).toBe(false);
  });

  it('returns to the review when asked from the review', () => {
    const asked = run(two, { type: 'openReview' }, askClose);
    expect(asked.view).toBe('confirm');
    expect(apply(asked, { type: 'dismissConfirm' }).view).toBe('review');
  });

  it('does nothing for another session', () => {
    expect(apply(two, { type: 'askClose', sessionId: 'r2-session' })).toBe(two);
  });

  it('does nothing while the prompt is open', () => {
    const asked = apply(two, askClose);
    expect(apply(asked, askClose)).toBe(asked);
  });
});

describe('review', () => {
  it('opens from the forms view with the cursor on the first row', () => {
    const state = run(
      mixedRound(),
      { type: 'openReview' },
      { type: 'reviewNext' },
      { type: 'closeReview' },
      { type: 'openReview' },
    );
    expect(state.view).toBe('review');
    expect(active(state).reviewRow).toBe(0);
  });

  it('moves the cursor over findings then questions and stops at both ends', () => {
    const opened = apply(findingRound(), { type: 'openReview' });
    expect(apply(opened, { type: 'reviewPrev' })).toBe(opened);
    const last = run(
      opened,
      { type: 'reviewNext' },
      { type: 'reviewNext' },
      { type: 'reviewNext' },
    );
    expect(active(last).reviewRow).toBe(2);
  });

  it('jumps from a finding row to the finding in the forms view', () => {
    const opened = apply(
      initialState(
        [
          presented('r1', {
            notices: [notice('N1')],
            findings: [finding('F1')],
            questions: [question('Q1')],
          }),
        ],
        'r1-session',
      ),
      { type: 'openReview' },
    );
    const onFinding = apply(opened, { type: 'reviewJump', row: 0 });
    expect(onFinding.view).toBe('forms');
    expect(active(onFinding).focus).toBe(1);
    expect(active(apply(opened, { type: 'reviewJump', row: 1 })).focus).toBe(2);
  });

  it('jumps to the cursor’s question in the forms view', () => {
    const state = run(
      mixedRound(),
      { type: 'openReview' },
      { type: 'reviewNext' },
      { type: 'reviewJump' },
    );
    expect(state.view).toBe('forms');
    expect(focusedItem(active(state))).toEqual({ kind: 'question', index: 2 });
  });

  it('jumps to a clicked row', () => {
    const state = run(
      mixedRound(),
      { type: 'openReview' },
      { type: 'reviewJump', row: 0 },
    );
    expect(state.view).toBe('forms');
    expect(focusedItem(active(state))).toEqual({ kind: 'question', index: 1 });
  });

  it('ignores a row outside the findings and questions', () => {
    const opened = apply(findingRound(), { type: 'openReview' });
    expect(apply(opened, { type: 'reviewJump', row: 3 })).toBe(opened);
  });

  it('closes back to the forms view', () => {
    const state = run(
      mixedRound(),
      { type: 'openReview' },
      { type: 'closeReview' },
    );
    expect(state.view).toBe('forms');
  });

  it('does not open from the idle view', () => {
    const state = initialState([], null);
    expect(apply(state, { type: 'openReview' })).toBe(state);
  });
});

describe('cancel', () => {
  const two = initialState([presented('r1'), presented('r2')], 'r1-session');

  it('asks from the review, and dismissing returns to the review', () => {
    const asked = run(two, { type: 'openReview' }, { type: 'askCancel' });
    expect(asked.view).toBe('confirm');
    expect(asked.confirmClosesTab).toBe(false);
    expect(apply(asked, { type: 'dismissConfirm' }).view).toBe('review');
  });

  it('is not asked outside the review', () => {
    expect(apply(two, { type: 'askCancel' })).toBe(two);
  });

  it('confirming closes the active round and shows the idle view', () => {
    const state = run(
      two,
      { type: 'openReview' },
      { type: 'askCancel' },
      { type: 'confirmCancel' },
    );
    expect(state.rounds.map((round) => round.roundId)).toEqual(['r2']);
    expect(state.activeRoundId).toBeNull();
    expect(state.view).toBe('idle');
  });

  it('confirming outside the confirmation does nothing', () => {
    const state = apply(two, { type: 'openReview' });
    expect(apply(state, { type: 'confirmCancel' })).toBe(state);
  });
});

describe('roundShown', () => {
  it('appends a new round without taking over the active one', () => {
    const state = apply(initialState([presented('r1')], 'r1-session'), {
      type: 'roundShown',
      round: presented('r2'),
    });
    expect(state.rounds.map((round) => round.roundId)).toEqual(['r1', 'r2']);
    expect(state.activeRoundId).toBe('r1');
  });

  it('makes a round for the active session active', () => {
    const state = apply(initialState([], 's1'), {
      type: 'roundShown',
      round: { ...presented('r1'), sessionId: 's1' },
    });
    expect(state.activeRoundId).toBe('r1');
    expect(state.view).toBe('forms');
  });

  it('keeps a round for another session in the background', () => {
    const state = apply(initialState([], 's1'), {
      type: 'roundShown',
      round: { ...presented('r1'), sessionId: 's2' },
    });
    expect(state.activeRoundId).toBeNull();
    expect(state.view).toBe('idle');
    expect(state.rounds).toHaveLength(1);
  });

  it('keeps the live state of a round already open', () => {
    const chosen = run(initialState([presented('r1')], 'r1-session'), {
      type: 'choose',
      choice: 2,
    });
    const state = apply(chosen, {
      type: 'roundShown',
      round: presented('r1', {}, draft({ answers: [entry(1, { choice: 3 })] })),
    });
    expect(state).toBe(chosen);
  });
});

describe('roundClosed', () => {
  const three = initialState(
    [presented('r1'), presented('r2'), presented('r3')],
    'r1-session',
  );

  it('closing the active round shows the idle view', () => {
    const state = apply(three, { type: 'roundClosed', roundId: 'r1' });
    expect(state.rounds.map((round) => round.roundId)).toEqual(['r2', 'r3']);
    expect(activeRound(state)).toBeNull();
    expect(state.view).toBe('idle');
    expect(state.activeSessionId).toBe('r1-session');
  });

  it('closing another round keeps the active round and the view', () => {
    const state = run(
      three,
      { type: 'openReview' },
      { type: 'roundClosed', roundId: 'r2' },
    );
    expect(state.activeRoundId).toBe('r1');
    expect(state.view).toBe('review');
    expect(state.rounds.map((round) => round.roundId)).toEqual(['r1', 'r3']);
  });

  it('closing a round that is not open does nothing', () => {
    expect(apply(three, { type: 'roundClosed', roundId: 'gone' })).toBe(three);
  });
});

describe('unansweredItem', () => {
  // Rail positions: 0 = Alpha, 1 = Beta, 2 = Gamma.
  const threeQuestions = (...actions: FormsAction[]) =>
    active(
      run(
        initialState(
          [
            presented('r1', {
              questions: [
                question('Alpha'),
                question('Beta'),
                question('Gamma'),
              ],
            }),
          ],
          'r1-session',
        ),
        ...actions,
      ),
    );
  const betaChosen: FormsAction[] = [
    { type: 'focusItem', item: 1 },
    { type: 'choose', choice: 1 },
  ];

  it('finds the nearest untouched question each way', () => {
    const round = threeQuestions(...betaChosen);
    expect(unansweredItem(round, 1)).toEqual({
      kind: 'question',
      index: 3,
    });
    expect(unansweredItem(round, -1)).toEqual({
      kind: 'question',
      index: 1,
    });
  });

  it('wraps past the last question', () => {
    const round = threeQuestions(...betaChosen, {
      type: 'focusItem',
      item: 2,
    });
    expect(unansweredItem(round, 1)).toEqual({
      kind: 'question',
      index: 1,
    });
  });

  it('checks the focused question last', () => {
    const round = threeQuestions(
      ...betaChosen,
      { type: 'focusItem', item: 2 },
      { type: 'choose', choice: 1 },
      { type: 'focusItem', item: 0 },
    );
    expect(unansweredItem(round, 1)).toEqual({
      kind: 'question',
      index: 1,
    });
  });

  it('runs from the first or last question with a notice focused', () => {
    const round = active(
      onNotice(
        initialState(
          [
            presented('r1', {
              notices: [notice('N1')],
              questions: [
                question('Alpha'),
                question('Beta'),
                question('Gamma'),
              ],
            }),
          ],
          'r1-session',
        ),
      ),
    );
    expect(unansweredItem(round, 1)).toEqual({
      kind: 'question',
      index: 1,
    });
    expect(unansweredItem(round, -1)).toEqual({
      kind: 'question',
      index: 3,
    });
  });

  it('counts notes text alone as an answer', () => {
    const round = threeQuestions(
      ...[1, 2, 3].map((index): FormsAction => ({
        type: 'setText',
        roundId: 'r1',
        target: { field: 'notes', item: { kind: 'question', index } },
        value: 'because',
      })),
    );
    expect(unansweredItem(round, 1)).toBeNull();
  });

  it('searches findings before questions', () => {
    const round = active(
      onNotice(
        initialState(
          [
            presented('r1', {
              notices: [notice('N1')],
              findings: [finding('F1')],
              questions: [question('Q1')],
            }),
          ],
          'r1-session',
        ),
      ),
    );
    expect(unansweredItem(round, 1)).toEqual({ kind: 'finding', index: 1 });
    expect(unansweredItem(round, -1)).toEqual({ kind: 'question', index: 1 });
  });

  it('finds none when every question is not applicable', () => {
    const round = threeQuestions(
      ...[0, 1, 2].flatMap((item): FormsAction[] => [
        { type: 'focusItem', item },
        { type: 'toggleNotApplicable' },
      ]),
    );
    expect(unansweredItem(round, 1)).toBeNull();
    expect(unansweredItem(round, -1)).toBeNull();
  });
});

describe('item actions outside the forms view', () => {
  // A question is focused, so choose and toggleNotApplicable would change an
  // answer if they applied.
  const inReview = run(
    mixedRound(),
    { type: 'focusItem', item: 1 },
    { type: 'openReview' },
  );

  it('leave the review state as it is', () => {
    expect(apply(inReview, { type: 'choose', choice: 1 })).toBe(inReview);
    expect(apply(inReview, { type: 'toggleNotApplicable' })).toBe(inReview);
    expect(apply(inReview, { type: 'nextItem' })).toBe(inReview);
  });

  it('still update the round note text in the review', () => {
    const edited = apply(inReview, {
      type: 'setText',
      roundId: 'r1',
      target: { field: 'note' },
      value: 'typed',
    });
    expect(edited.view).toBe('review');
    expect(active(edited).note).toBe('typed');
  });
});

describe('progress', () => {
  it('counts answered, not applicable and untouched questions', () => {
    const state = initialState(
      [
        presented(
          'r1',
          {
            questions: [
              question('Q1'),
              question('Q2'),
              question('Q3'),
              question('Q4'),
            ],
          },
          draft({
            answers: [
              entry(1, { choice: 1 }),
              entry(2, { choice: 2, not_applicable: true }),
              entry(3, { notes: 'text but no pick' }),
              entry(4, { notes: '  ' }),
            ],
          }),
        ),
      ],
      'r1-session',
    );
    expect(progress(active(state))).toEqual({
      answered: 2,
      notApplicable: 1,
      untouched: 1,
      total: 4,
    });
  });

  it('counts notes text alone as an answer', () => {
    const state = apply(mixedRound(), {
      type: 'setText',
      roundId: 'r1',
      target: { field: 'notes', item: { kind: 'question', index: 2 } },
      value: 'because',
    });
    expect(progress(active(state)).answered).toBe(1);
  });

  it('counts findings with questions', () => {
    const state = findingRound(
      draft({
        finding_answers: [findingEntry(1, { choice: 1, action: 'fix_now' })],
        answers: [entry(1, { not_applicable: true })],
      }),
    );
    expect(progress(active(state))).toEqual({
      answered: 1,
      notApplicable: 1,
      untouched: 1,
      total: 3,
    });
  });
});

describe('saveState', () => {
  const edited = run(
    mixedRound(),
    { type: 'focusItem', item: 1 },
    { type: 'choose', choice: 1 },
  );
  const revision = active(edited).revision;

  it('an answer edit makes the round unsaved', () => {
    expect(saveState(active(edited))).toBe('unsaved');
  });

  it('shows saving while the latest revision is in flight, then saved', () => {
    const saving = apply(edited, {
      type: 'saveStarted',
      roundId: 'r1',
      revision,
    });
    expect(saveState(active(saving))).toBe('saving');
    const saved = apply(saving, {
      type: 'saveFinished',
      roundId: 'r1',
      revision,
      ok: true,
    });
    expect(saveState(active(saved))).toBe('saved');
  });

  it('an edit while a save is in flight stays unsaved after that save', () => {
    const state = run(
      edited,
      { type: 'saveStarted', roundId: 'r1', revision },
      { type: 'choose', choice: 2 },
      { type: 'saveFinished', roundId: 'r1', revision, ok: true },
    );
    expect(saveState(active(state))).toBe('unsaved');
  });

  it('a failed save leaves the round unsaved', () => {
    const state = run(
      edited,
      { type: 'saveStarted', roundId: 'r1', revision },
      {
        type: 'saveFinished',
        roundId: 'r1',
        revision,
        ok: false,
        error: 'disk full',
      },
    );
    expect(saveState(active(state))).toBe('unsaved');
    expect(active(state).saveError).toBe('disk full');
  });

  it('clears a failed save message when the next save starts', () => {
    const failed = run(
      edited,
      { type: 'saveStarted', roundId: 'r1', revision },
      {
        type: 'saveFinished',
        roundId: 'r1',
        revision,
        ok: false,
        error: 'disk full',
      },
    );
    const retried = apply(failed, {
      type: 'saveStarted',
      roundId: 'r1',
      revision,
    });
    expect(active(retried).saveError).toBeNull();
  });

  it('a save start that changes nothing leaves state as it is', () => {
    const saving = apply(edited, {
      type: 'saveStarted',
      roundId: 'r1',
      revision,
    });
    expect(
      apply(saving, { type: 'saveStarted', roundId: 'r1', revision }),
    ).toBe(saving);
  });

  it('a save finish that changes nothing leaves state as it is', () => {
    const saved = run(
      edited,
      { type: 'saveStarted', roundId: 'r1', revision },
      { type: 'saveFinished', roundId: 'r1', revision, ok: true },
    );
    expect(
      apply(saved, { type: 'saveFinished', roundId: 'r1', revision, ok: true }),
    ).toBe(saved);
  });

  it('navigation and views are not edits', () => {
    const state = run(
      mixedRound(),
      { type: 'nextItem' },
      { type: 'openReview' },
    );
    expect(saveState(active(state))).toBe('saved');
  });
});

describe('buildBody', () => {
  it('writes every question and notice with its 1-based index', () => {
    const state = run(
      mixedRound(),
      { type: 'focusItem', item: 2 },
      { type: 'choose', choice: 3 },
      {
        type: 'setText',
        roundId: 'r1',
        target: { field: 'comment', notice: 1 },
        value: 'check this',
      },
      {
        type: 'setText',
        roundId: 'r1',
        target: { field: 'note' },
        value: 'the note',
      },
    );
    expect(buildBody(active(state))).toEqual({
      note: 'the note',
      answers: [entry(1, {}), entry(2, { choice: 3 })],
      finding_answers: [],
      notice_comments: [{ index: 1, comment: 'check this' }],
    });
  });

  it('writes finding answers in finding_answers with their 1-based index', () => {
    const state = run(
      initialState(
        [presented('r1', { findings: [finding('F1'), finding('F2')] })],
        'r1-session',
      ),
      { type: 'focusItem', item: 1 },
      { type: 'choose', choice: 1 },
    );
    expect(buildBody(active(state)).finding_answers).toEqual([
      findingEntry(1, {}),
      findingEntry(2, { choice: 1 }),
    ]);
  });

  it('sends a not-applicable answer with the choice it kept', () => {
    const state = run(
      mixedRound(),
      { type: 'focusItem', item: 1 },
      { type: 'choose', choice: 2 },
      { type: 'toggleNotApplicable' },
    );
    expect(buildBody(active(state)).answers[0]).toEqual(
      entry(1, { choice: 2, not_applicable: true }),
    );
  });

  it('a body restored as a draft rebuilds the same body', () => {
    const state = run(
      findingRound(),
      { type: 'focusItem', item: 1 },
      { type: 'chooseAction', action: 'follow_up' },
      { type: 'focusItem', item: 2 },
      { type: 'choose', choice: 2 },
      { type: 'toggleNotApplicable' },
      { type: 'toggleDontAsk' },
      {
        type: 'setText',
        roundId: 'r1',
        target: { field: 'notes', item: { kind: 'question', index: 2 } },
        value: 'reason',
      },
      {
        type: 'setText',
        roundId: 'r1',
        target: { field: 'notes', item: { kind: 'finding', index: 1 } },
        value: 'seen',
      },
    );
    const body = buildBody(active(state));
    expect(body.finding_answers[0].action).toBe('follow_up');
    const restored = findingRound(body);
    expect(buildBody(active(restored))).toEqual(body);
  });
});

describe('apply', () => {
  it('leaves the state it was given unchanged', () => {
    const state = apply(mixedRound(), { type: 'focusItem', item: 1 });
    const before = structuredClone(state);
    apply(state, { type: 'choose', choice: 1 });
    apply(state, { type: 'nextItem' });
    apply(state, { type: 'roundClosed', roundId: 'r1' });
    expect(state).toEqual(before);
  });
});
