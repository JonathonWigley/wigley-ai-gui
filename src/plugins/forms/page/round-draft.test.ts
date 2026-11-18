import { describe, expect, it } from 'vitest';
import { saveState } from '../../../shared/page/autosave';
import type { FindingAnswerEntry, FormBody } from '../contract';
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
  entry,
  findingEntry,
  findingRound,
  mixedRound,
  notice,
  POLL_PARTS,
  presented,
  question,
  run,
} from './form-state.test-support';
import { BUILT_IN_PAGE_KINDS } from './kinds/formats';
import { createPageKinds } from './kinds/page-kinds';
import { poll, pollPageKind } from './kinds/plugin-page-kind.test-support';
import { answerStatus } from './round-answers';
import { buildBody } from './round-draft';
import { answerableItems, focusedItem, railItems } from './round-model';
import {
  apply,
  finding,
  findingAnswers,
  formsWith,
  initialState,
  nit,
  NO_LOG,
  noticeComments,
  questionAnswers,
} from './test-rounds';

useBuiltInFindingOrigins();

const untouched = {
  choice: 0,
  notApplicable: false,
  notes: '',
  dontAsk: false,
  dontAskReason: '',
};

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

  it("logs a plugin kind's decode of the wrong count and starts its draft empty", () => {
    const base = pollPageKind('poll');
    const short = {
      ...base,
      restore: {
        ...base.restore,
        decode: (
          polls: Parameters<typeof base.restore.decode>[0],
          entries: readonly unknown[],
        ) => (entries.length > 0 ? [] : base.restore.decode(polls, entries)),
      },
    };
    const lines: string[] = [];
    const forms = formsWith([short], (line) => lines.push(line));

    const round = active(
      forms.initialState(
        [
          presented('r1', POLL_PARTS, {
            ...draft({}),
            poll_answers: [entry(1, { choice: 2 })],
          }),
        ],
        'r1-session',
      ),
    );

    expect(round.itemAnswers.poll).toEqual([untouched]);
    expect(lines).toEqual([
      'round r1: page kind poll decoded 0 answers where its items need 1; its draft starts empty',
    ]);
  });

  it('starts saved', () => {
    expect(saveState(active(mixedRound()))).toBe('saved');
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
      } as FindingAnswerEntry,
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

describe('kindsChanged', () => {
  // A round of one finding, one poll and two questions, with the poll
  // answered and the second question focused.
  function answeredRound() {
    const kinds = createPageKinds();
    for (const kind of BUILT_IN_PAGE_KINDS) {
      kinds.register(kind);
    }
    const pollRegistration = kinds.register(pollPageKind('poll'));
    const forms = createFormsState(() => kinds.table(), NO_LOG);
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

  it.each([
    {
      case: 'stays on its item when a kind arrives ahead of it',
      row: 3,
      arrives: true,
      leaves: false,
      kept: 4,
      item: { kind: 'question', index: 2 },
    },
    {
      case: 'clamps to its old row, held to the last, when its item left',
      row: 1,
      arrives: false,
      leaves: true,
      kept: 1,
      item: { kind: 'question', index: 1 },
    },
  ])(
    'keeps or clamps the review row: $case',
    ({ row, arrives, leaves, kept, item }) => {
      const { kinds, pollRegistration, state, changed } = answeredRound();
      let current: FormsState = {
        ...state,
        forms: state.forms.map((round) => ({ ...round, reviewRow: row })),
      };
      if (arrives) {
        kinds.register(pollPageKind('early', { railOrder: 5 }));
        current = {
          ...current,
          forms: current.forms.map((round) => ({
            ...round,
            round: {
              ...round.round,
              items: { ...round.round.items, early: [poll('E1')] },
            },
          })),
        };
      }
      if (leaves) {
        pollRegistration.dispose();
      }
      const after = active(changed(current));

      expect(after.reviewRow).toBe(kept);
      expect(answerableItems(after)[after.reviewRow]).toEqual(item);
    },
  );
});

function runWith(
  reducer: FormsReducer,
  state: FormsState,
  ...actions: FormsAction[]
): FormsState {
  return actions.reduce(reducer, state);
}
