import { describe, expect, it } from 'vitest';
import type { FormBody, PageKind } from '../contract';
import { useBuiltInFindingOrigins } from '../finding-origins.test-support';
import {
  createFormsState,
  type FormsAction,
  type FormsReducer,
  type FormsState,
} from './form-state';
import {
  active,
  draft,
  notice,
  POLL_PARTS,
  presented,
  question,
} from './form-state.test-support';
import { BUILT_IN_PAGE_KINDS } from './kinds/formats';
import { pageKindTable } from './kinds/page-kinds';
import { pollPageKind } from './kinds/plugin-page-kind.test-support';
import { progress } from './round-answers';
import { buildBody } from './round-draft';
import { answerableItems, railItems } from './round-model';
import { finding, initialState, type RoundParts } from './test-rounds';

useBuiltInFindingOrigins();

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
