import { describe, expect, it } from 'vitest';
import { useBuiltInFindingOrigins } from '../finding-origins.test-support';
import type { FormsAction, FormsState } from './form-state';
import {
  active,
  draft,
  entry,
  findingEntry,
  findingRound,
  mixedRound,
  notice,
  presented,
  question,
  run,
} from './form-state.test-support';
import { answerStatus, progress, unansweredItem } from './round-answers';
import { focusedItem, railPosition } from './round-model';
import {
  apply,
  finding,
  findingAnswers,
  initialState,
  noticeComments,
  questionAnswers,
} from './test-rounds';

useBuiltInFindingOrigins();

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
