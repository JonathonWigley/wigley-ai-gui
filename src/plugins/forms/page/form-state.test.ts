import { describe, expect, it } from 'vitest';
import { activeForm } from '../../../shared/page/session-forms';
import type {
  AnswerEntry,
  FindingAnswerEntry,
  FormBody,
  Notice,
  PageKind,
  PresentedRound,
  Question,
  RoundPlace,
} from '../contract';
import { saveState } from '../../../shared/page/autosave';
import {
  answerableItems,
  answerStatus,
  buildBody,
  createFormsState,
  focusedItem,
  progress,
  railItems,
  railPosition,
  roundPlace,
  type FormsAction,
  type FormsReducer,
  type FormsState,
  type RoundState,
  unansweredItem,
} from './form-state';
import { BUILT_IN_PAGE_KINDS } from './kinds/formats';
import { createPageKinds, pageKindTable } from './kinds/page-kinds';
import { poll, pollPageKind } from './kinds/plugin-page-kind.test-support';
import {
  apply,
  finding,
  findingAnswers,
  initialState,
  nit,
  noticeComments,
  questionAnswers,
  roundOf,
  type RoundParts,
} from './test-rounds';

function question(title: string, choiceCount = 3): Question {
  return {
    title,
    summary: `${title}?`,
    context: `${title} context`,
    choices: Array.from(
      { length: choiceCount },
      (_, i) => `${title} choice ${i + 1}`,
    ),
    recommend: 1,
    rationale: `${title} rationale`,
    layout: null,
  };
}

function notice(title: string): Notice {
  return {
    title,
    context: `${title} context`,
    badge: 'Applied',
    layout: null,
  };
}

function presented(
  roundId: string,
  parts: RoundParts = {},
  draft: FormBody | null = null,
): PresentedRound {
  return {
    roundId,
    sessionId: `${roundId}-session`,
    label: `project · ${roundId}`,
    round: {
      ...roundOf(roundId, {
        questions: [question('Q1'), question('Q2')],
        ...parts,
      }),
      heading: roundId,
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
  const round = activeForm(state);
  if (round === null) {
    throw new Error('expected an active round');
  }
  return round;
}

// Rail positions: 0 = question Q1, 1 = question Q2, 2 = the notices stop.
function mixedRound(body: FormBody | null = null): FormsState {
  return initialState(
    [presented('r1', { notices: [notice('N1')] }, body)],
    'r1-session',
  );
}

// Rail positions: 0 = finding F1, 1 = question Q1, 2 = question Q2, 3 = the
// notices stop.
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

// Focuses rail position 0, finding F1, whose two choices sit under fix_now
// and which recommends choice 2: entries 1 fix_now/1, 2 fix_now/2,
// 3 follow_up/0, 4 leave_it/0.
function twoFixRound(): FormsState {
  const twoFix = finding('F1', {
    choices: [
      { text: 'A', reason: 'A reason', action: 'fix_now' },
      { text: 'B', reason: 'B reason', action: 'fix_now' },
    ],
    recommend: 2,
  });
  return apply(
    initialState([presented('r1', { findings: [twoFix] })], 'r1-session'),
    { type: 'focusItem', item: 0 },
  );
}

// Focuses the round's notices stop.
function onNotices(state: FormsState): FormsState {
  const item = railPosition(active(state), { kind: 'notices' });
  return apply(state, { type: 'focusItem', item });
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
    expect(activeForm(state)).toBeNull();
  });

  it("makes the active session's round active", () => {
    const state = initialState(
      [presented('r1'), presented('r2')],
      'r2-session',
    );
    expect(state.activeFormId).toBe('r2');
    expect(state.view).toBe('forms');
    expect(state.forms.map((round) => round.formId)).toEqual(['r1', 'r2']);
  });

  it('shows no round with no active session', () => {
    const state = initialState([presented('r1')], null);
    expect(state.activeFormId).toBeNull();
    expect(state.view).toBe('idle');
  });

  it.each([
    {
      case: 'mixed round',
      state: () => mixedRound(),
      expected: { kind: 'question', index: 1 },
    },
    {
      case: 'finding round',
      state: () => findingRound(),
      expected: { kind: 'finding', index: 1 },
    },
    {
      case: 'notices only',
      state: () =>
        initialState(
          [presented('r1', { notices: [notice('N1')], questions: [] })],
          'r1-session',
        ),
      expected: { kind: 'notices' },
    },
    {
      case: 'no items',
      state: () =>
        initialState([presented('r1', { questions: [] })], 'r1-session'),
      expected: null,
    },
  ])('opens on the first rail stop: $case', ({ state, expected }) => {
    expect(focusedItem(active(state()))).toEqual(expected);
  });
});

describe('railItems', () => {
  it.each([
    {
      case: 'the findings, then the questions, then the notices stop',
      notices: [notice('N1'), notice('N2')],
      expected: [
        { kind: 'finding', index: 1 },
        { kind: 'finding', index: 2 },
        { kind: 'question', index: 1 },
        { kind: 'notices' },
      ],
    },
    {
      case: 'no notices stop for a round without notices',
      notices: [],
      expected: [
        { kind: 'finding', index: 1 },
        { kind: 'finding', index: 2 },
        { kind: 'question', index: 1 },
      ],
    },
  ])('lists $case', ({ notices, expected }) => {
    const state = initialState(
      [
        presented('r1', {
          questions: [question('Q1')],
          notices,
          findings: [finding('F1'), finding('F2')],
        }),
      ],
      'r1-session',
    );
    expect(railItems(active(state))).toEqual(expected);
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
    expect(questionAnswers(round)[0]).toEqual(untouched);
    expect(questionAnswers(round)[1]).toEqual({
      choice: 3,
      notApplicable: false,
      notes: 'own answer',
      dontAsk: true,
      dontAskReason: 'settled',
    });
    expect(noticeComments(round)).toEqual(['look again']);
    expect(round.note).toBe('overall');
  });

  it.each([
    { case: 'no notices', notices: [], comments: [], open: [], line: 0 },
    {
      case: 'three notices, the second with a comment',
      notices: [notice('N1'), notice('N2'), notice('N3')],
      comments: [
        { index: 1, comment: '' },
        { index: 2, comment: 'see 2' },
        { index: 3, comment: '' },
      ],
      open: [false, true, false],
      line: 1,
    },
  ])(
    'opens each notice with a restored comment, the cursor on line 1: $case',
    ({ notices, comments, open, line }) => {
      const state = initialState(
        [presented('r1', { notices }, draft({ notice_comments: comments }))],
        'r1-session',
      );
      expect(active(state)).toMatchObject({
        openNotices: open,
        noticeLine: line,
      });
    },
  );

  it('keeps the choice of an answer marked not applicable', () => {
    const round = active(
      mixedRound(
        draft({ answers: [entry(1, { choice: 2, not_applicable: true })] }),
      ),
    );
    expect(questionAnswers(round)[0].choice).toBe(2);
    expect(questionAnswers(round)[0].notApplicable).toBe(true);
  });

  it('drops a choice beyond the question’s choices', () => {
    const round = active(
      mixedRound(draft({ answers: [entry(1, { choice: 4 })] })),
    );
    expect(questionAnswers(round)[0].choice).toBe(0);
  });

  it("restores a finding's answer from finding_answers", () => {
    const round = active(
      findingRound(
        draft({
          finding_answers: [
            findingEntry(1, { choice: 3, notes: 'seen', action: 'fix_now' }),
          ],
        }),
      ),
    );
    expect(findingAnswers(round)[0]).toMatchObject({
      choice: 3,
      notes: 'seen',
      action: 'fix_now',
    });
    expect(questionAnswers(round)).toEqual([untouched, untouched]);
  });

  it("drops a choice beyond the finding's choices", () => {
    // F1 has three choices, all under fix_now.
    const round = active(
      findingRound(
        draft({
          finding_answers: [findingEntry(1, { choice: 4, action: 'fix_now' })],
        }),
      ),
    );
    expect(findingAnswers(round)[0]).toMatchObject({ choice: 0, action: '' });
  });

  it('starts a finding with no draft entry with no pick', () => {
    const round = active(findingRound());
    expect(findingAnswers(round)[0]).toMatchObject({ choice: 0, action: '' });
    expect(answerStatus(round, { kind: 'finding', index: 1 })).toBe(
      'untouched',
    );
  });

  it('restores a saved pick that is an entry', () => {
    const round = active(
      findingRound(
        draft({
          finding_answers: [
            findingEntry(1, { choice: 0, action: 'follow_up' }),
          ],
        }),
      ),
    );
    expect(findingAnswers(round)[0]).toMatchObject({
      choice: 0,
      action: 'follow_up',
    });
  });

  it('restores a saved pick that is no entry as none, keeping its notes', () => {
    const round = active(
      findingRound(
        draft({
          finding_answers: [
            findingEntry(1, {
              choice: 1,
              action: 'leave_it',
              notes: 'kept',
              not_applicable: true,
              dont_ask: true,
            }),
          ],
        }),
      ),
    );
    expect(findingAnswers(round)[0]).toMatchObject({
      choice: 0,
      action: '',
      notes: 'kept',
      notApplicable: true,
      dontAsk: true,
    });
  });

  it("restores a finding's unknown action as none", () => {
    const saved = { ...findingEntry(1, { choice: 1 }), action: 'Fix now' };
    const round = active(
      findingRound(
        draft({ finding_answers: [saved as unknown as FindingAnswerEntry] }),
      ),
    );
    expect(findingAnswers(round)[0].action).toBe('');
  });

  it("restores an action the finding's origin does not offer as none", () => {
    const state = initialState(
      [
        presented(
          'r1',
          { findings: [nit('N1')] },
          draft({
            finding_answers: [
              findingEntry(1, { choice: 0, action: 'follow_up' }),
            ],
          }),
        ),
      ],
      'r1-session',
    );
    expect(findingAnswers(active(state))[0]).toMatchObject({
      action: '',
      choice: 0,
    });
  });

  it('ignores an entry whose index names no question', () => {
    const round = active(
      mixedRound(draft({ answers: [entry(5, { choice: 1 })] })),
    );
    expect(questionAnswers(round)).toEqual([untouched, untouched]);
  });

  it('starts saved', () => {
    expect(saveState(active(mixedRound()))).toBe('saved');
  });
});

describe('choose', () => {
  const onQ1 = apply(mixedRound(), { type: 'focusItem', item: 0 });

  it('picks the numbered choice on the focused question', () => {
    const state = apply(onQ1, { type: 'choose', number: 2 });
    expect(questionAnswers(active(state))[0].choice).toBe(2);
  });

  it('picks the numbered entry, setting choice and action', () => {
    const state = apply(twoFixRound(), { type: 'choose', number: 2 });
    expect(findingAnswers(active(state))[0]).toMatchObject({
      choice: 2,
      action: 'fix_now',
    });
    expect(active(state).revision).toBe(1);
  });

  it('picks a bare header as choice 0', () => {
    const state = apply(twoFixRound(), { type: 'choose', number: 4 });
    expect(findingAnswers(active(state))[0]).toMatchObject({
      choice: 0,
      action: 'leave_it',
    });
  });

  it('clears the pick when the same number is picked again', () => {
    const state = run(
      twoFixRound(),
      { type: 'choose', number: 3 },
      { type: 'choose', number: 3 },
    );
    expect(findingAnswers(active(state))[0]).toMatchObject({
      choice: 0,
      action: '',
    });
  });

  it('changes nothing past the last entry', () => {
    const state = twoFixRound();
    expect(apply(state, { type: 'choose', number: 5 })).toBe(state);
  });

  it('changes nothing while not applicable', () => {
    const state = apply(twoFixRound(), { type: 'toggleNotApplicable' });
    expect(apply(state, { type: 'choose', number: 1 })).toBe(state);
  });

  it('clears the choice when the same number is picked again on a question', () => {
    const state = run(
      onQ1,
      { type: 'choose', number: 2 },
      { type: 'choose', number: 2 },
    );
    expect(questionAnswers(active(state))[0].choice).toBe(0);
  });

  it('switches to another number', () => {
    const state = run(
      onQ1,
      { type: 'choose', number: 2 },
      { type: 'choose', number: 3 },
    );
    expect(questionAnswers(active(state))[0].choice).toBe(3);
  });

  it('does nothing on the notices stop', () => {
    const state = onNotices(mixedRound());
    expect(apply(state, { type: 'choose', number: 1 })).toBe(state);
  });

  it('does nothing on a question marked not applicable', () => {
    const state = apply(onQ1, { type: 'toggleNotApplicable' });
    expect(apply(state, { type: 'choose', number: 1 })).toBe(state);
  });

  it('does nothing for a number outside the choices', () => {
    expect(apply(onQ1, { type: 'choose', number: 0 })).toBe(onQ1);
    expect(apply(onQ1, { type: 'choose', number: 4 })).toBe(onQ1);
  });
});

describe('clearChoice', () => {
  const chosen = run(
    mixedRound(),
    { type: 'focusItem', item: 0 },
    { type: 'choose', number: 2 },
  );

  it('clears the focused question’s choice', () => {
    const state = apply(chosen, { type: 'clearChoice' });
    expect(questionAnswers(active(state))[0].choice).toBe(0);
  });

  it('keeps the choice of a question marked not applicable', () => {
    const state = apply(chosen, { type: 'toggleNotApplicable' });
    expect(apply(state, { type: 'clearChoice' })).toBe(state);
  });

  it("clears a finding's whole pick", () => {
    const state = run(
      twoFixRound(),
      { type: 'choose', number: 2 },
      { type: 'clearChoice' },
    );
    expect(findingAnswers(active(state))[0]).toMatchObject({
      choice: 0,
      action: '',
    });
  });

  it('does nothing on a finding with no pick', () => {
    const state = twoFixRound();
    expect(apply(state, { type: 'clearChoice' })).toBe(state);
  });
});

describe('acceptRecommendation', () => {
  it("picks the focused question's recommended choice", () => {
    const state = initialState(
      [presented('r1', { questions: [{ ...question('Q1'), recommend: 2 }] })],
      'r1-session',
    );
    const accepted = apply(state, { type: 'acceptRecommendation' });
    expect(questionAnswers(active(accepted))[0].choice).toBe(2);
  });

  it('sets the recommended choice and action as one pick', () => {
    // F1 recommends choice 2 with fix_now.
    const accepted = apply(twoFixRound(), { type: 'acceptRecommendation' });
    expect(findingAnswers(active(accepted))[0]).toMatchObject({
      action: 'fix_now',
      choice: 2,
    });
    expect(active(accepted).revision).toBe(1);
  });

  it("sets the recommended action's header when recommend is null", () => {
    const state = initialState(
      [
        presented('r1', {
          findings: [
            finding('F1', { recommend: null, recommend_action: 'leave_it' }),
          ],
        }),
      ],
      'r1-session',
    );
    const accepted = apply(state, { type: 'acceptRecommendation' });
    expect(findingAnswers(active(accepted))[0]).toMatchObject({
      choice: 0,
      action: 'leave_it',
    });
  });

  it('does nothing when the answer already holds the recommended pick', () => {
    const accepted = apply(twoFixRound(), { type: 'acceptRecommendation' });
    expect(apply(accepted, { type: 'acceptRecommendation' })).toBe(accepted);
  });

  it('does nothing while not applicable', () => {
    const state = apply(mixedRound(), { type: 'toggleNotApplicable' });
    expect(apply(state, { type: 'acceptRecommendation' })).toBe(state);
  });
});

describe('answerStatus', () => {
  const f1 = { kind: 'finding', index: 1 } as const;
  const onF1 = apply(findingRound(), { type: 'focusItem', item: 0 });

  it('a finding with no pick and no notes is untouched', () => {
    expect(answerStatus(active(onF1), f1)).toBe('untouched');
  });

  it('answers a finding with its action and solution', () => {
    const state = apply(onF1, { type: 'choose', number: 2 });
    expect(answerStatus(active(state), f1)).toBe('answered');
  });

  it('answers a finding with a header pick', () => {
    // Entry 4 is follow_up's header: F1's three choices sit under fix_now.
    const state = apply(onF1, { type: 'choose', number: 4 });
    expect(findingAnswers(active(state))[0]).toMatchObject({
      choice: 0,
      action: 'follow_up',
    });
    expect(answerStatus(active(state), f1)).toBe('answered');
  });

  it('counts a finding with notes alone as responded', () => {
    const state = apply(onF1, {
      type: 'setText',
      formId: 'r1',
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
      { type: 'focusItem', item: 0 },
      { type: 'choose', number: 2 },
      { type: 'toggleNotApplicable' },
    );
    expect(questionAnswers(active(marked))[0]).toMatchObject({
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
      { type: 'focusItem', item: 0 },
      { type: 'choose', number: 2 },
      { type: 'toggleNotApplicable' },
    );
    expect(findingAnswers(active(state))[0]).toMatchObject({
      choice: 2,
      notApplicable: true,
    });
  });

  it('does nothing on the notices stop', () => {
    const state = onNotices(mixedRound());
    expect(apply(state, { type: 'toggleNotApplicable' })).toBe(state);
  });
});

describe('toggleDontAsk', () => {
  it('flips dont ask and keeps the reason text', () => {
    const state = run(
      mixedRound(),
      { type: 'focusItem', item: 1 },
      { type: 'toggleDontAsk' },
      {
        type: 'setText',
        formId: 'r1',
        target: {
          field: 'dontAskReason',
          item: { kind: 'question', index: 2 },
        },
        value: 'settled',
      },
      { type: 'toggleDontAsk' },
    );
    expect(questionAnswers(active(state))[1]).toMatchObject({
      dontAsk: false,
      dontAskReason: 'settled',
    });
    expect(
      questionAnswers(active(apply(state, { type: 'toggleDontAsk' })))[1]
        .dontAsk,
    ).toBe(true);
  });

  it('stays live on a question marked not applicable', () => {
    const state = run(
      mixedRound(),
      { type: 'focusItem', item: 0 },
      { type: 'toggleNotApplicable' },
      { type: 'toggleDontAsk' },
    );
    expect(questionAnswers(active(state))[0].dontAsk).toBe(true);
  });

  it('does nothing on the notices stop', () => {
    const state = onNotices(mixedRound());
    expect(apply(state, { type: 'toggleDontAsk' })).toBe(state);
  });
});

describe('setText', () => {
  function edit(target: Extract<FormsAction, { type: 'setText' }>['target']) {
    return active(
      apply(findingRound(), {
        type: 'setText',
        formId: 'r1',
        target,
        value: 'typed',
      }),
    );
  }

  it('writes each text field to the item it names', () => {
    expect(
      questionAnswers(
        edit({ field: 'notes', item: { kind: 'question', index: 2 } }),
      )[1].notes,
    ).toBe('typed');
    expect(
      findingAnswers(
        edit({ field: 'notes', item: { kind: 'finding', index: 1 } }),
      )[0].notes,
    ).toBe('typed');
    expect(
      questionAnswers(
        edit({ field: 'dontAskReason', item: { kind: 'question', index: 1 } }),
      )[0].dontAskReason,
    ).toBe('typed');
    expect(
      noticeComments(
        edit({ field: 'comment', item: { kind: 'notice', index: 1 } }),
      ),
    ).toEqual(['typed']);
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
      formId: 'other',
      target: { field: 'note' },
      value: 'typed',
    });
    expect(next).toBe(state);
  });

  it('ignores an edit naming an item the round does not have', () => {
    const state = findingRound();
    const next = apply(state, {
      type: 'setText',
      formId: 'r1',
      target: { field: 'notes', item: { kind: 'finding', index: 3 } },
      value: 'typed',
    });
    expect(next).toBe(state);
  });

  it('ignores an edit that changes nothing', () => {
    const noted = apply(mixedRound(), {
      type: 'setText',
      formId: 'r1',
      target: { field: 'note' },
      value: 'same',
    });
    const again = apply(noted, {
      type: 'setText',
      formId: 'r1',
      target: { field: 'note' },
      value: 'same',
    });
    expect(again).toBe(noted);
  });
});

describe('item navigation', () => {
  it('moves one rail item at a time and stops at both ends', () => {
    const start = mixedRound();
    expect(apply(start, { type: 'prevItem' })).toBe(start);

    const end = run(
      start,
      { type: 'nextItem' },
      { type: 'nextItem' },
      { type: 'nextItem' },
    );
    expect(focusedItem(active(end))).toEqual({ kind: 'notices' });

    const back = apply(end, { type: 'prevItem' });
    expect(focusedItem(active(back))).toEqual({ kind: 'question', index: 2 });
  });

  it('firstItem and lastItem focus the rail ends', () => {
    const middle = apply(mixedRound(), { type: 'nextItem' });

    const last = apply(middle, { type: 'lastItem' });
    const first = apply(last, { type: 'firstItem' });

    expect({
      last: focusedItem(active(last)),
      first: focusedItem(active(first)),
      firstAgain: apply(first, { type: 'firstItem' }) === first,
    }).toEqual({
      last: { kind: 'notices' },
      first: { kind: 'question', index: 1 },
      firstAgain: true,
    });
  });

  it('focusItem ignores a position outside the rail', () => {
    const state = mixedRound();
    expect(apply(state, { type: 'focusItem', item: 3 })).toBe(state);
    expect(apply(state, { type: 'focusItem', item: -1 })).toBe(state);
  });
});

describe('notice lines', () => {
  // Rail positions: 0 = question Q1, 1 = the notices stop.
  const threeNotices = (...actions: FormsAction[]) =>
    run(
      initialState(
        [
          presented('r1', {
            questions: [question('Q1')],
            notices: [notice('N1'), notice('N2'), notice('N3')],
          }),
        ],
        'r1-session',
      ),
      ...actions,
    );
  const onStop: FormsAction = { type: 'focusItem', item: 1 };
  const down: FormsAction = { type: 'moveNoticeLine', delta: 1 };

  it.each<{
    action: string;
    case: string;
    before: FormsAction[];
    act: FormsAction;
    expected: Partial<RoundState> | 'unchanged';
  }>([
    {
      action: 'toggleNotice 2',
      case: 'opens a closed line',
      before: [],
      act: { type: 'toggleNotice', notice: 2 },
      expected: { openNotices: [false, true, false] },
    },
    {
      action: 'toggleNotice 2',
      case: 'closes an open line',
      before: [{ type: 'toggleNotice', notice: 2 }],
      act: { type: 'toggleNotice', notice: 2 },
      expected: { openNotices: [false, false, false] },
    },
    {
      action: 'toggleNotice 0',
      case: 'changes nothing',
      before: [],
      act: { type: 'toggleNotice', notice: 0 },
      expected: 'unchanged',
    },
    {
      action: 'toggleNotice 4',
      case: 'changes nothing',
      before: [],
      act: { type: 'toggleNotice', notice: 4 },
      expected: 'unchanged',
    },
    {
      action: 'moveNoticeLine 1',
      case: 'moves from line 1 to line 2',
      before: [onStop],
      act: down,
      expected: { noticeLine: 2 },
    },
    {
      action: 'moveNoticeLine -1',
      case: 'changes nothing on line 1',
      before: [onStop],
      act: { type: 'moveNoticeLine', delta: -1 },
      expected: 'unchanged',
    },
    {
      action: 'moveNoticeLine 1',
      case: 'changes nothing on line 3',
      before: [onStop, down, down],
      act: down,
      expected: 'unchanged',
    },
    {
      action: 'moveNoticeLine 1',
      case: 'changes nothing with the question focused',
      before: [],
      act: down,
      expected: 'unchanged',
    },
    {
      action: 'focusNotice 3',
      case: 'focuses the stop with the cursor on line 3',
      before: [{ type: 'toggleNotice', notice: 2 }],
      act: { type: 'focusNotice', notice: 3 },
      expected: {
        focus: 1,
        noticeLine: 3,
        openNotices: [false, true, false],
      },
    },
    {
      action: 'focusNotice 4',
      case: 'changes nothing',
      before: [],
      act: { type: 'focusNotice', notice: 4 },
      expected: 'unchanged',
    },
    {
      action: 'toggleNotice 1',
      case: 'changes nothing in the review view',
      before: [{ type: 'openReview' }],
      act: { type: 'toggleNotice', notice: 1 },
      expected: 'unchanged',
    },
  ])('$action $case', ({ before, act, expected }) => {
    const state = threeNotices(...before);
    const next = apply(state, act);
    if (expected === 'unchanged') {
      expect(next).toBe(state);
    } else {
      expect(active(next)).toMatchObject(expected);
    }
  });
});

describe('sessionActivated', () => {
  const two = initialState([presented('r1'), presented('r2')], 'r1-session');

  it("shows the session's round in the form", () => {
    const state = apply(two, {
      type: 'sessionActivated',
      sessionId: 'r2-session',
    });
    expect(state.activeFormId).toBe('r2');
    expect(state.view).toBe('forms');
  });

  it('shows the idle view for a session with no round', () => {
    const state = apply(two, { type: 'sessionActivated', sessionId: 'other' });
    expect(state.activeFormId).toBeNull();
    expect(state.view).toBe('idle');
  });

  it('dismisses a pending cancel prompt', () => {
    const state = run(
      two,
      { type: 'openReview' },
      { type: 'askCancel' },
      { type: 'sessionActivated', sessionId: 'r2-session' },
    );
    expect(state.view).toBe('forms');
    expect(state.activeFormId).toBe('r2');
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
      { type: 'choose', number: 2 },
      { type: 'sessionActivated', sessionId: 'r2-session' },
    );
    expect(questionAnswers(active(state))[0].choice).toBe(0);
    const back = apply(state, {
      type: 'sessionActivated',
      sessionId: 'r1-session',
    });
    expect(questionAnswers(active(back))[0].choice).toBe(2);
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

  it('reviewBottom and reviewTop put the cursor on the last and first rows', () => {
    const opened = apply(findingRound(), { type: 'openReview' });

    const bottom = apply(opened, { type: 'reviewBottom' });
    const top = apply(bottom, { type: 'reviewTop' });

    expect([active(bottom).reviewRow, active(top).reviewRow]).toEqual([2, 0]);
  });

  it('reviewTop and reviewBottom change nothing outside the review', () => {
    const forms = apply(findingRound(), { type: 'nextItem' });

    expect(apply(forms, { type: 'reviewBottom' })).toBe(forms);
    expect(apply(forms, { type: 'reviewTop' })).toBe(forms);
  });

  // Rail positions: 0 finding F1, 1 question Q1, 2 the notices stop.
  function noticeFindingQuestion(): FormsState {
    return initialState(
      [
        presented('r1', {
          notices: [notice('N1')],
          findings: [finding('F1')],
          questions: [question('Q1')],
        }),
      ],
      'r1-session',
    );
  }

  it('jumps from a finding row to the finding in the forms view', () => {
    const opened = apply(noticeFindingQuestion(), { type: 'openReview' });
    const onFinding = apply(opened, { type: 'reviewJump', row: 0 });
    expect(onFinding.view).toBe('forms');
    expect(active(onFinding).focus).toBe(0);
    expect(active(apply(opened, { type: 'reviewJump', row: 1 })).focus).toBe(1);
  });

  it('jumps from the notices stop in the rail to the notices page, keeping the review cursor', () => {
    const state = run(
      noticeFindingQuestion(),
      { type: 'openReview' },
      { type: 'reviewNext' },
      { type: 'reviewJumpItem', item: 2 },
    );
    expect(state.view).toBe('forms');
    expect(focusedItem(active(state))).toEqual({ kind: 'notices' });
    expect(active(state).reviewRow).toBe(1);
  });

  it('ignores a rail jump outside the review', () => {
    const state = noticeFindingQuestion();
    expect(apply(state, { type: 'reviewJumpItem', item: 2 })).toBe(state);
  });

  it('ignores a rail jump to a position outside the rail', () => {
    const opened = apply(noticeFindingQuestion(), { type: 'openReview' });
    expect(apply(opened, { type: 'reviewJumpItem', item: 3 })).toBe(opened);
    expect(apply(opened, { type: 'reviewJumpItem', item: -1 })).toBe(opened);
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
    expect(apply(asked, { type: 'dismissConfirm' }).view).toBe('review');
  });

  it('is not asked outside the review', () => {
    expect(apply(two, { type: 'askCancel' })).toBe(two);
  });
});

describe('sending', () => {
  const two = initialState([presented('r1'), presented('r2')], 'r1-session');
  const submitting: FormsAction = {
    type: 'sendStarted',
    formId: 'r1',
    kind: 'submitted',
  };
  const cancelling: FormsAction = {
    type: 'sendStarted',
    formId: 'r1',
    kind: 'cancelled',
  };
  const sendingReview = run(two, { type: 'openReview' }, submitting);

  it('marks the active round sending with its kind', () => {
    expect(active(sendingReview).sending).toEqual({ kind: 'submitted' });
  });

  it("ignores the round's keys while it is sending", () => {
    const keys: FormsAction[] = [
      { type: 'reviewNext' },
      { type: 'closeReview' },
      { type: 'askCancel' },
      { type: 'reviewJump' },
    ];
    for (const key of keys) {
      expect(apply(sendingReview, key)).toBe(sendingReview);
    }
    const sendingCancel = run(
      two,
      { type: 'openReview' },
      { type: 'askCancel' },
      cancelling,
    );
    expect(apply(sendingCancel, { type: 'dismissConfirm' })).toBe(
      sendingCancel,
    );
  });

  it('still takes text edits while sending', () => {
    const state = apply(sendingReview, {
      type: 'setText',
      formId: 'r1',
      target: { field: 'note' },
      value: 'typed',
    });
    expect(active(state).note).toBe('typed');
  });

  it('still takes saves while sending', () => {
    const edited = apply(sendingReview, {
      type: 'setText',
      formId: 'r1',
      target: { field: 'note' },
      value: 'typed',
    });
    const revision = active(edited).revision;
    const state = run(
      edited,
      { type: 'saveStarted', formId: 'r1', revision },
      { type: 'saveFinished', formId: 'r1', revision, error: null },
    );
    expect(saveState(active(state))).toBe('saved');
  });

  it("takes another session's keys while a round in the background sends", () => {
    const state = run(
      sendingReview,
      { type: 'sessionActivated', sessionId: 'r2-session' },
      { type: 'focusItem', item: 0 },
      { type: 'choose', number: 2 },
      { type: 'openReview' },
    );
    expect(state.activeFormId).toBe('r2');
    expect(state.view).toBe('review');
    expect(questionAnswers(active(state))[0].choice).toBe(2);
  });

  it('ignores the keys again once the sending round is shown again', () => {
    const back = run(
      sendingReview,
      { type: 'sessionActivated', sessionId: 'r2-session' },
      { type: 'sessionActivated', sessionId: 'r1-session' },
    );
    const keys: FormsAction[] = [
      { type: 'focusItem', item: 0 },
      { type: 'choose', number: 2 },
      { type: 'openReview' },
    ];
    for (const key of keys) {
      expect(apply(back, key)).toBe(back);
    }
  });

  it('takes text edits and a failed send for a round in the background', () => {
    const state = run(
      sendingReview,
      { type: 'sessionActivated', sessionId: 'r2-session' },
      {
        type: 'setText',
        formId: 'r1',
        target: { field: 'note' },
        value: 'typed',
      },
      { type: 'sendFailed', formId: 'r1' },
    );
    const background = state.forms.find((round) => round.formId === 'r1');
    expect(background?.note).toBe('typed');
    expect(background?.sending).toBeNull();
  });

  it('a failed send clears the mark and keeps the view and answers', () => {
    const state = run(
      two,
      { type: 'choose', number: 2 },
      { type: 'openReview' },
      submitting,
      { type: 'sendFailed', formId: 'r1' },
    );
    expect(active(state).sending).toBeNull();
    expect(state.view).toBe('review');
    expect(questionAnswers(active(state))[0].choice).toBe(2);
  });

  it('a sending round closes on formClosed', () => {
    const state = apply(sendingReview, { type: 'formClosed', formId: 'r1' });
    expect(state.forms.map((round) => round.formId)).toEqual(['r2']);
    expect(state.view).toBe('idle');
  });
});

describe('formShown', () => {
  it('appends a new round without taking over the active one', () => {
    const state = apply(initialState([presented('r1')], 'r1-session'), {
      type: 'formShown',
      form: presented('r2'),
    });
    expect(state.forms.map((round) => round.formId)).toEqual(['r1', 'r2']);
    expect(state.activeFormId).toBe('r1');
  });

  it('makes a round for the active session active', () => {
    const state = apply(initialState([], 's1'), {
      type: 'formShown',
      form: { ...presented('r1'), sessionId: 's1' },
    });
    expect(state.activeFormId).toBe('r1');
    expect(state.view).toBe('forms');
  });

  it('keeps a round for another session in the background', () => {
    const state = apply(initialState([], 's1'), {
      type: 'formShown',
      form: { ...presented('r1'), sessionId: 's2' },
    });
    expect(state.activeFormId).toBeNull();
    expect(state.view).toBe('idle');
    expect(state.forms).toHaveLength(1);
  });

  it('keeps the live state of a round already open', () => {
    const chosen = run(initialState([presented('r1')], 'r1-session'), {
      type: 'choose',
      number: 2,
    });
    const state = apply(chosen, {
      type: 'formShown',
      form: presented('r1', {}, draft({ answers: [entry(1, { choice: 3 })] })),
    });
    expect(state).toBe(chosen);
  });
});

describe('formClosed', () => {
  const three = initialState(
    [presented('r1'), presented('r2'), presented('r3')],
    'r1-session',
  );

  it('closing the active round shows the idle view', () => {
    const state = apply(three, { type: 'formClosed', formId: 'r1' });
    expect(state.forms.map((round) => round.formId)).toEqual(['r2', 'r3']);
    expect(activeForm(state)).toBeNull();
    expect(state.view).toBe('idle');
    expect(state.activeSessionId).toBe('r1-session');
  });

  it('closing another round keeps the active round and the view', () => {
    const state = run(
      three,
      { type: 'openReview' },
      { type: 'formClosed', formId: 'r2' },
    );
    expect(state.activeFormId).toBe('r1');
    expect(state.view).toBe('review');
    expect(state.forms.map((round) => round.formId)).toEqual(['r1', 'r3']);
  });

  it('closing a round that is not open does nothing', () => {
    expect(apply(three, { type: 'formClosed', formId: 'gone' })).toBe(three);
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
    { type: 'choose', number: 1 },
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
      { type: 'choose', number: 1 },
      { type: 'focusItem', item: 0 },
    );
    expect(unansweredItem(round, 1)).toEqual({
      kind: 'question',
      index: 1,
    });
  });

  it('runs from the first or last question with the notices stop focused', () => {
    const round = active(
      onNotices(
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
        formId: 'r1',
        target: { field: 'notes', item: { kind: 'question', index } },
        value: 'because',
      })),
    );
    expect(unansweredItem(round, 1)).toBeNull();
  });

  it('searches findings before questions', () => {
    const round = active(
      onNotices(
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
    { type: 'focusItem', item: 0 },
    { type: 'openReview' },
  );

  it('leave the review state as it is', () => {
    expect(apply(inReview, { type: 'choose', number: 1 })).toBe(inReview);
    expect(apply(inReview, { type: 'toggleNotApplicable' })).toBe(inReview);
    expect(apply(inReview, { type: 'nextItem' })).toBe(inReview);
    expect(apply(inReview, { type: 'lastItem' })).toBe(inReview);
  });

  it('still update the round note text in the review', () => {
    const edited = apply(inReview, {
      type: 'setText',
      formId: 'r1',
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
      formId: 'r1',
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
    { type: 'focusItem', item: 0 },
    { type: 'choose', number: 1 },
  );
  const revision = active(edited).revision;

  it('an answer edit makes the round unsaved', () => {
    expect(saveState(active(edited))).toBe('unsaved');
  });

  it('a save start that changes nothing leaves state as it is', () => {
    const saving = apply(edited, {
      type: 'saveStarted',
      formId: 'r1',
      revision,
    });
    expect(apply(saving, { type: 'saveStarted', formId: 'r1', revision })).toBe(
      saving,
    );
  });

  it('a save finish that changes nothing leaves state as it is', () => {
    const saved = run(
      edited,
      { type: 'saveStarted', formId: 'r1', revision },
      { type: 'saveFinished', formId: 'r1', revision, error: null },
    );
    expect(
      apply(saved, {
        type: 'saveFinished',
        formId: 'r1',
        revision,
        error: null,
      }),
    ).toBe(saved);
  });

  it('navigation and views are not edits', () => {
    const state = run(
      initialState(
        [presented('r1', { notices: [notice('N1'), notice('N2')] })],
        'r1-session',
      ),
      { type: 'nextItem' },
      { type: 'focusNotice', notice: 1 },
      { type: 'toggleNotice', notice: 1 },
      { type: 'moveNoticeLine', delta: 1 },
      { type: 'openReview' },
    );
    expect(saveState(active(state))).toBe('saved');
  });
});

describe('buildBody', () => {
  it('writes every question and notice with its 1-based index', () => {
    const state = run(
      mixedRound(),
      { type: 'focusItem', item: 1 },
      { type: 'choose', number: 3 },
      {
        type: 'setText',
        formId: 'r1',
        target: { field: 'comment', item: { kind: 'notice', index: 1 } },
        value: 'check this',
      },
      {
        type: 'setText',
        formId: 'r1',
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
      { type: 'choose', number: 1 },
    );
    expect(buildBody(active(state)).finding_answers).toEqual([
      findingEntry(1, {}),
      findingEntry(2, { choice: 1, action: 'fix_now' }),
    ]);
  });

  it('sends a not-applicable answer with the choice it kept', () => {
    const state = run(
      mixedRound(),
      { type: 'focusItem', item: 0 },
      { type: 'choose', number: 2 },
      { type: 'toggleNotApplicable' },
    );
    expect(buildBody(active(state)).answers[0]).toEqual(
      entry(1, { choice: 2, not_applicable: true }),
    );
  });

  it('a body restored as a draft rebuilds the same body', () => {
    const state = run(
      findingRound(),
      { type: 'focusItem', item: 0 },
      // Entry 4 is follow_up's header: F1's three choices sit under fix_now.
      { type: 'choose', number: 4 },
      { type: 'focusItem', item: 1 },
      { type: 'choose', number: 2 },
      { type: 'toggleNotApplicable' },
      { type: 'toggleDontAsk' },
      {
        type: 'setText',
        formId: 'r1',
        target: { field: 'notes', item: { kind: 'question', index: 2 } },
        value: 'reason',
      },
      {
        type: 'setText',
        formId: 'r1',
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
    // A round's kinds table holds functions, which structuredClone refuses.
    const cloneable = (of: FormsState) => ({
      ...of,
      forms: of.forms.map((round) => ({ ...round, kinds: null })),
    });
    const state = apply(mixedRound(), { type: 'focusItem', item: 0 });
    const kinds = state.forms[0].kinds;
    const before = structuredClone(cloneable(state));
    apply(state, { type: 'choose', number: 1 });
    apply(state, { type: 'nextItem' });
    apply(state, { type: 'formClosed', formId: 'r1' });
    expect(cloneable(state)).toEqual(before);
    expect(state.forms[0].kinds).toBe(kinds);
  });
});

describe('placeRestored', () => {
  const REVIEW_ROW_TWO: RoundPlace = {
    focus: 1,
    reviewRow: 1,
    noticeLine: 0,
    view: 'review',
    confirmReturnView: 'review',
  };

  it.each([
    { case: 'the active round', formId: 'r1', view: 'review' },
    { case: 'a background round', formId: 'r2', view: 'forms' },
  ])(
    'restores focus and review row, and the view only on $case',
    ({ formId, view }) => {
      const state = initialState(
        [presented('r1'), presented('r2')],
        'r1-session',
      );

      const restored = apply(state, {
        type: 'placeRestored',
        formId,
        place: REVIEW_ROW_TWO,
      });

      const round = restored.forms.find((form) => form.formId === formId)!;
      expect({ focus: round.focus, reviewRow: round.reviewRow }).toEqual({
        focus: 1,
        reviewRow: 1,
      });
      expect(restored.view).toBe(view);
    },
  );

  it.each([
    { case: 'a line inside the notices', notices: 3, saved: 2, line: 2 },
    { case: 'a line past the last notice', notices: 2, saved: 5, line: 2 },
    { case: 'line 0 on a round with notices', notices: 2, saved: 0, line: 1 },
    {
      case: 'a line on a round without notices',
      notices: 0,
      saved: 2,
      line: 0,
    },
  ])(
    'restores the notice line held to the notices: $case',
    ({ notices, saved, line }) => {
      const state = initialState(
        [
          presented('r1', {
            notices: Array.from({ length: notices }, (_, i) =>
              notice(`N${i + 1}`),
            ),
          }),
        ],
        'r1-session',
      );

      const restored = apply(state, {
        type: 'placeRestored',
        formId: 'r1',
        place: { ...REVIEW_ROW_TWO, noticeLine: saved },
      });

      expect(active(restored).noticeLine).toBe(line);
    },
  );

  it("writes the forms view in a background round's place", () => {
    const state = apply(
      initialState([presented('r1'), presented('r2')], 'r1-session'),
      { type: 'openReview' },
    );
    const background = state.forms[1];

    expect(roundPlace(state, background)).toEqual({
      focus: background.focus,
      reviewRow: background.reviewRow,
      noticeLine: background.noticeLine,
      view: 'forms',
      confirmReturnView: 'review',
    });
  });
});

// A round over the built-in kinds and `extra`, registered after them, with
// `polls` under the poll kind's id `poll`.
function kindsState(
  extra: PageKind[],
  parts: RoundParts = {},
  body: FormBody | null = null,
): { state: FormsState; apply: FormsReducer } {
  const forms = createFormsState(() =>
    pageKindTable([...BUILT_IN_PAGE_KINDS, ...extra]),
  );
  return {
    state: forms.initialState([presented('r1', parts, body)], 'r1-session'),
    apply: forms.apply,
  };
}

const POLL_PARTS: RoundParts = {
  findings: [finding('F1')],
  questions: [question('Q1')],
  items: { poll: [poll('P1')] },
  bodyKeys: { poll: 'poll_answers' },
};

describe('saved shapes', () => {
  const body: FormBody = {
    note: 'overall',
    answers: [
      {
        index: 1,
        choice: 2,
        not_applicable: false,
        notes: 'q notes',
        dont_ask: true,
        dont_ask_reason: 'settled',
      },
    ],
    finding_answers: [
      {
        index: 1,
        choice: 1,
        not_applicable: false,
        notes: 'f notes',
        dont_ask: false,
        dont_ask_reason: '',
        action: 'fix_now',
      },
    ],
    notice_comments: [{ index: 1, comment: 'look again' }],
  };

  it('restores a draft in the saved shapes of before kinds registered', () => {
    const round = active(
      initialState(
        [
          presented(
            'r1',
            {
              questions: [question('Q1')],
              findings: [finding('F1')],
              notices: [notice('N1')],
            },
            body,
          ),
        ],
        'r1-session',
      ),
    );

    expect(questionAnswers(round)).toEqual([
      {
        choice: 2,
        notApplicable: false,
        notes: 'q notes',
        dontAsk: true,
        dontAskReason: 'settled',
      },
    ]);
    expect(findingAnswers(round)[0]).toMatchObject({
      choice: 1,
      action: 'fix_now',
      notes: 'f notes',
    });
    expect(noticeComments(round)).toEqual(['look again']);
    expect(round.note).toBe('overall');
  });

  it('buildBody returns those entries unchanged, in key order', () => {
    const round = active(
      initialState(
        [
          presented(
            'r1',
            {
              questions: [question('Q1')],
              findings: [finding('F1')],
              notices: [notice('N1')],
            },
            body,
          ),
        ],
        'r1-session',
      ),
    );

    const built = buildBody(round);

    expect(built).toEqual(body);
    expect(Object.keys(built)).toEqual([
      'note',
      'answers',
      'finding_answers',
      'notice_comments',
    ]);
    expect(Object.keys(built.answers[0])).toEqual([
      'index',
      'choice',
      'not_applicable',
      'notes',
      'dont_ask',
      'dont_ask_reason',
    ]);
    expect(Object.keys(built.finding_answers[0])).toEqual([
      'index',
      'choice',
      'not_applicable',
      'notes',
      'dont_ask',
      'dont_ask_reason',
      'action',
    ]);
  });
});

describe('plugin kinds on the rail', () => {
  it('puts a kind at rail order 15 between the findings and the questions', () => {
    const { state } = kindsState([pollPageKind('poll')], POLL_PARTS);
    const round = active(state);

    expect(railItems(round)).toEqual([
      { kind: 'finding', index: 1 },
      { kind: 'poll', index: 1 },
      { kind: 'question', index: 1 },
    ]);
    expect(answerableItems(round)).toEqual(railItems(round));
    expect(progress(round).total).toBe(3);
  });

  it('gives a kind that takes no answer stops and no review row or count', () => {
    const { state } = kindsState(
      [pollPageKind('poll', { answerable: false })],
      POLL_PARTS,
    );
    const round = active(state);

    expect(railItems(round)).toContainEqual({ kind: 'poll', index: 1 });
    expect(answerableItems(round)).toEqual([
      { kind: 'finding', index: 1 },
      { kind: 'question', index: 1 },
    ]);
    expect(progress(round).total).toBe(2);
  });

  it('gives a kind with no registration no stop, and writes its entries back', () => {
    const entries = [{ index: 1, choice: 2 }];
    const { state } = kindsState([], POLL_PARTS, {
      ...draft({}),
      poll_answers: entries,
    });
    const round = active(state);

    expect(railItems(round)).not.toContainEqual({ kind: 'poll', index: 1 });
    expect(buildBody(round).poll_answers).toEqual(entries);
  });

  it.each([
    { type: 'choose', number: 1 },
    { type: 'clearChoice' },
    { type: 'acceptRecommendation' },
    { type: 'toggleNotApplicable' },
    { type: 'toggleDontAsk' },
  ] as FormsAction[])(
    'changes nothing on a kind that takes no answer: $type',
    (action) => {
      const kinds = kindsState(
        [pollPageKind('poll', { answerable: false })],
        POLL_PARTS,
      );
      const state = kinds.apply(kinds.state, { type: 'focusItem', item: 1 });

      expect(kinds.apply(state, action)).toBe(state);
    },
  );

  it.each([
    {
      case: 'choose',
      actions: [{ type: 'choose', number: 2 }],
      answer: { choice: 2, notApplicable: false },
    },
    {
      case: 'clearChoice',
      actions: [{ type: 'choose', number: 2 }, { type: 'clearChoice' }],
      answer: { choice: 0 },
    },
    {
      case: 'acceptRecommendation',
      actions: [{ type: 'acceptRecommendation' }],
      answer: { choice: 1 },
    },
    {
      case: 'toggleNotApplicable',
      actions: [{ type: 'toggleNotApplicable' }],
      answer: { notApplicable: true },
    },
  ] as { case: string; actions: FormsAction[]; answer: object }[])(
    'answers an answerable plugin kind: $case',
    ({ actions, answer }) => {
      const kinds = kindsState([pollPageKind('poll')], POLL_PARTS);
      const state = [
        { type: 'focusItem', item: 1 } as FormsAction,
        ...actions,
      ].reduce(kinds.apply, kinds.state);

      expect(active(state).itemAnswers.poll[0]).toMatchObject(answer);
    },
  );
});

describe('kindsChanged', () => {
  // A round of one finding, one poll and two questions, with the poll
  // answered and the second question focused.
  function answeredRound() {
    const kinds = createPageKinds();
    for (const kind of BUILT_IN_PAGE_KINDS) {
      kinds.register(kind);
    }
    const pollRegistration = kinds.register(pollPageKind('poll'));
    const forms = createFormsState(() => kinds.table());
    let state = forms.initialState(
      [
        presented('r1', {
          ...POLL_PARTS,
          questions: [question('Q1'), question('Q2')],
        }),
      ],
      'r1-session',
    );
    state = runWith(
      forms.apply,
      state,
      { type: 'focusItem', item: 1 },
      { type: 'choose', number: 2 },
      { type: 'focusItem', item: 3 },
    );
    const changed = (current: FormsState) =>
      forms.apply(current, { type: 'kindsChanged', kinds: kinds.table() });
    return { kinds, pollRegistration, state, changed };
  }

  it('drops a kind that left from the rail and keeps its entries in the body', () => {
    const { pollRegistration, state, changed } = answeredRound();
    const before = active(state);

    pollRegistration.dispose();
    const after = active(changed(state));

    expect(railItems(after)).not.toContainEqual({ kind: 'poll', index: 1 });
    expect(buildBody(after).poll_answers).toEqual(
      buildBody(before).poll_answers,
    );
    expect(after.revision).toBe(before.revision);
  });

  it('restores the answers of a kind that returns', () => {
    const { kinds, pollRegistration, state, changed } = answeredRound();

    pollRegistration.dispose();
    const left = changed(state);
    kinds.register(pollPageKind('poll'));
    const back = active(changed(left));

    expect(back.itemAnswers.poll[0]).toMatchObject({ choice: 2 });
    expect(back.revision).toBe(active(state).revision);
  });

  it('encodes with the old kind and decodes with the new under the same id', () => {
    const { kinds, pollRegistration, state, changed } = answeredRound();
    const replacement = pollPageKind('poll');

    pollRegistration.dispose();
    kinds.register(replacement);
    const after = active(changed(state));

    expect(after.kinds.get('poll')).toBe(replacement);
    expect(after.itemAnswers.poll[0]).toMatchObject({ choice: 2 });
  });

  it('keeps focus on the same item when kinds arrive ahead of it', () => {
    const { kinds, state, changed } = answeredRound();
    expect(focusedItem(active(state))).toEqual({ kind: 'question', index: 2 });

    kinds.register(pollPageKind('vote', { railOrder: 15 }));
    kinds.register(pollPageKind('early', { railOrder: 5 }));
    const withItems = {
      ...state,
      forms: state.forms.map((round) => ({
        ...round,
        round: {
          ...round.round,
          items: {
            ...round.round.items,
            vote: [poll('V1')],
            early: [poll('E1')],
          },
        },
      })),
    };
    const after = active(changed(withItems));

    expect(focusedItem(after)).toEqual({ kind: 'question', index: 2 });
    expect(after.focus).toBe(5);
  });

  it('clamps focus to the last stop when the focused item left', () => {
    const { pollRegistration, state, changed } = answeredRound();
    const onPoll = apply(state, { type: 'focusItem', item: 1 });

    pollRegistration.dispose();
    const after = active(changed(onPoll));

    expect(after.focus).toBe(1);
    expect(focusedItem(after)).toEqual({ kind: 'question', index: 1 });
  });
});

function runWith(
  reducer: FormsReducer,
  state: FormsState,
  ...actions: FormsAction[]
): FormsState {
  return actions.reduce(reducer, state);
}
