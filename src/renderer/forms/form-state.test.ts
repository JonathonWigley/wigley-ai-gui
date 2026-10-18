import { describe, expect, it } from 'vitest';
import type {
  AnswerEntry,
  FormBody,
  Notice,
  PresentedRound,
  Question,
  Round,
} from '../../contracts/forms';
import {
  activeRound,
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
} from './form-state';

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
    label: `project · ${roundId}`,
    round: {
      heading: roundId,
      overview: '',
      questions: [question('Q1'), question('Q2')],
      notices: [],
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
    what: '',
    why: '',
    dont_ask: false,
    dont_ask_reason: '',
    ...fields,
  };
}

function draft(fields: Partial<FormBody>): FormBody {
  return { note: '', answers: [], notice_comments: [], ...fields };
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
  return initialState([presented('r1', { notices: [notice('N1')] }, body)]);
}

const untouched = {
  choice: 0,
  notApplicable: false,
  what: '',
  why: '',
  dontAsk: false,
  dontAskReason: '',
};

describe('initialState', () => {
  it('shows the idle view with no rounds', () => {
    const state = initialState([]);
    expect(state.view).toBe('idle');
    expect(activeRound(state)).toBeNull();
  });

  it('makes the first round active in the forms view, keeping the order', () => {
    const state = initialState([presented('r1'), presented('r2')]);
    expect(state.activeRoundId).toBe('r1');
    expect(state.view).toBe('forms');
    expect(state.rounds.map((round) => round.roundId)).toEqual(['r1', 'r2']);
  });

  it('focuses the first rail item', () => {
    expect(focusedItem(active(mixedRound()))).toEqual({
      kind: 'notice',
      index: 1,
    });
  });
});

describe('railItems', () => {
  it('lists notices first, then questions, each numbered from 1 in its kind', () => {
    const round: Round = {
      heading: 'h',
      overview: '',
      questions: [question('Q1')],
      notices: [notice('N1'), notice('N2')],
    };
    expect(railItems(round)).toEqual([
      { kind: 'notice', index: 1 },
      { kind: 'notice', index: 2 },
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
              what: 'own answer',
              why: 'because',
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
      what: 'own answer',
      why: 'because',
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
    const state = mixedRound();
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

  it('does nothing on a notice', () => {
    const state = mixedRound();
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
        target: { field: 'dontAskReason', question: 2 },
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
    const state = mixedRound();
    expect(apply(state, { type: 'toggleDontAsk' })).toBe(state);
  });
});

describe('setText', () => {
  function edit(target: Extract<FormsAction, { type: 'setText' }>['target']) {
    return active(
      apply(mixedRound(), {
        type: 'setText',
        roundId: 'r1',
        target,
        value: 'typed',
      }),
    );
  }

  it('writes each text field to the item it names', () => {
    expect(edit({ field: 'what', question: 2 }).answers[1].what).toBe('typed');
    expect(edit({ field: 'why', question: 2 }).answers[1].why).toBe('typed');
    expect(
      edit({ field: 'dontAskReason', question: 1 }).answers[0].dontAskReason,
    ).toBe('typed');
    expect(edit({ field: 'comment', notice: 1 }).noticeComments).toEqual([
      'typed',
    ]);
    expect(edit({ field: 'note' }).note).toBe('typed');
  });

  it('writes to an item that is not focused', () => {
    expect(focusedItem(edit({ field: 'what', question: 2 }))).toEqual({
      kind: 'notice',
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
    const state = mixedRound();
    const next = apply(state, {
      type: 'setText',
      roundId: 'r1',
      target: { field: 'what', question: 3 },
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
    const start = mixedRound();
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

describe('round switching', () => {
  const three = initialState([
    presented('r1'),
    presented('r2'),
    presented('r3'),
  ]);

  it('wraps around the open rounds in both directions', () => {
    expect(apply(three, { type: 'prevRound' }).activeRoundId).toBe('r3');
    const onLast = run(three, { type: 'nextRound' }, { type: 'nextRound' });
    expect(onLast.activeRoundId).toBe('r3');
    expect(apply(onLast, { type: 'nextRound' }).activeRoundId).toBe('r1');
  });

  it('does nothing with one round open', () => {
    const state = initialState([presented('r1')]);
    expect(apply(state, { type: 'nextRound' })).toBe(state);
  });

  it('keeps each round’s answers apart', () => {
    const state = run(
      three,
      { type: 'focusItem', item: 0 },
      { type: 'choose', choice: 2 },
      { type: 'nextRound' },
    );
    expect(active(state).answers[0].choice).toBe(0);
    expect(active(apply(state, { type: 'prevRound' })).answers[0].choice).toBe(
      2,
    );
  });

  it('keeps the review view when switching from the review', () => {
    const state = run(three, { type: 'openReview' }, { type: 'nextRound' });
    expect(state.view).toBe('review');
    expect(state.activeRoundId).toBe('r2');
  });

  it('does nothing while help is open', () => {
    const state = apply(three, { type: 'toggleHelp' });
    expect(apply(state, { type: 'nextRound' })).toBe(state);
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

  it('moves the cursor over the questions and stops at both ends', () => {
    const opened = apply(mixedRound(), { type: 'openReview' });
    expect(apply(opened, { type: 'reviewPrev' })).toBe(opened);
    const last = run(opened, { type: 'reviewNext' }, { type: 'reviewNext' });
    expect(active(last).reviewRow).toBe(1);
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

  it('ignores a row outside the questions', () => {
    const opened = apply(mixedRound(), { type: 'openReview' });
    expect(apply(opened, { type: 'reviewJump', row: 2 })).toBe(opened);
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
    const state = initialState([]);
    expect(apply(state, { type: 'openReview' })).toBe(state);
  });
});

describe('cancel', () => {
  const two = initialState([presented('r1'), presented('r2')]);

  it('asks from the review, and dismissing returns to the review', () => {
    const asked = run(two, { type: 'openReview' }, { type: 'askCancel' });
    expect(asked.view).toBe('confirm');
    expect(apply(asked, { type: 'dismissConfirm' }).view).toBe('review');
  });

  it('is not asked outside the review', () => {
    expect(apply(two, { type: 'askCancel' })).toBe(two);
  });

  it('confirming closes the active round and shows the next one', () => {
    const state = run(
      two,
      { type: 'openReview' },
      { type: 'askCancel' },
      { type: 'confirmCancel' },
    );
    expect(state.rounds.map((round) => round.roundId)).toEqual(['r2']);
    expect(state.activeRoundId).toBe('r2');
    expect(state.view).toBe('forms');
  });

  it('confirming outside the confirmation does nothing', () => {
    const state = apply(two, { type: 'openReview' });
    expect(apply(state, { type: 'confirmCancel' })).toBe(state);
  });

  it('help over the confirmation returns to the confirmation', () => {
    const state = run(
      two,
      { type: 'openReview' },
      { type: 'askCancel' },
      { type: 'toggleHelp' },
      { type: 'closeHelp' },
    );
    expect(state.view).toBe('confirm');
    expect(apply(state, { type: 'dismissConfirm' }).view).toBe('review');
  });
});

describe('help', () => {
  it('returns to the view help was opened over', () => {
    const review = apply(mixedRound(), { type: 'openReview' });
    const help = apply(review, { type: 'toggleHelp' });
    expect(help.view).toBe('help');
    expect(apply(help, { type: 'toggleHelp' }).view).toBe('review');
    expect(apply(help, { type: 'closeHelp' }).view).toBe('review');
  });

  it('closeHelp does nothing outside help', () => {
    const state = mixedRound();
    expect(apply(state, { type: 'closeHelp' })).toBe(state);
  });

  it('opens from the idle view', () => {
    const state = apply(initialState([]), { type: 'toggleHelp' });
    expect(state.view).toBe('help');
    expect(apply(state, { type: 'closeHelp' }).view).toBe('idle');
  });
});

describe('roundShown', () => {
  it('appends a new round without taking over the active one', () => {
    const state = apply(initialState([presented('r1')]), {
      type: 'roundShown',
      round: presented('r2'),
    });
    expect(state.rounds.map((round) => round.roundId)).toEqual(['r1', 'r2']);
    expect(state.activeRoundId).toBe('r1');
  });

  it('makes a round shown in the idle view active', () => {
    const state = apply(initialState([]), {
      type: 'roundShown',
      round: presented('r1'),
    });
    expect(state.activeRoundId).toBe('r1');
    expect(state.view).toBe('forms');
  });

  it('keeps the live state of a round already open', () => {
    const chosen = run(initialState([presented('r1')]), {
      type: 'choose',
      choice: 2,
    });
    const state = apply(chosen, {
      type: 'roundShown',
      round: presented('r1', {}, draft({ answers: [entry(1, { choice: 3 })] })),
    });
    expect(state).toBe(chosen);
  });

  it('a round shown under help over the idle view makes help return to it', () => {
    const state = run(
      initialState([]),
      { type: 'toggleHelp' },
      { type: 'roundShown', round: presented('r1') },
    );
    expect(state.view).toBe('help');
    expect(state.activeRoundId).toBe('r1');
    expect(apply(state, { type: 'closeHelp' }).view).toBe('forms');
  });
});

describe('roundClosed', () => {
  const three = initialState([
    presented('r1'),
    presented('r2'),
    presented('r3'),
  ]);

  it('closing the active round shows the round after it', () => {
    const state = run(
      three,
      { type: 'nextRound' },
      { type: 'roundClosed', roundId: 'r2' },
    );
    expect(state.activeRoundId).toBe('r3');
    expect(state.view).toBe('forms');
  });

  it('closing the active last round wraps to the first', () => {
    const state = run(
      three,
      { type: 'prevRound' },
      { type: 'roundClosed', roundId: 'r3' },
    );
    expect(state.activeRoundId).toBe('r1');
  });

  it('closing the active round from the review shows the next round’s form', () => {
    const state = run(
      three,
      { type: 'openReview' },
      { type: 'roundClosed', roundId: 'r1' },
    );
    expect(state.activeRoundId).toBe('r2');
    expect(state.view).toBe('forms');
  });

  it('closing the only round shows the idle view', () => {
    const state = apply(initialState([presented('r1')]), {
      type: 'roundClosed',
      roundId: 'r1',
    });
    expect(state.rounds).toEqual([]);
    expect(activeRound(state)).toBeNull();
    expect(state.view).toBe('idle');
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

  it('closing the active round under help keeps help open over the next round', () => {
    const state = run(
      three,
      { type: 'toggleHelp' },
      { type: 'roundClosed', roundId: 'r1' },
    );
    expect(state.view).toBe('help');
    expect(state.activeRoundId).toBe('r2');
    expect(apply(state, { type: 'closeHelp' }).view).toBe('forms');
  });

  it('closing a round that is not open does nothing', () => {
    expect(apply(three, { type: 'roundClosed', roundId: 'gone' })).toBe(three);
  });
});

describe('focusRound', () => {
  const two = initialState([presented('r1'), presented('r2')]);

  it('shows the named round in the forms view, closing help', () => {
    const state = run(
      two,
      { type: 'toggleHelp' },
      { type: 'focusRound', roundId: 'r2' },
    );
    expect(state.activeRoundId).toBe('r2');
    expect(state.view).toBe('forms');
  });

  it('ignores a round that is not open', () => {
    expect(apply(two, { type: 'focusRound', roundId: 'gone' })).toBe(two);
  });
});

describe('folds', () => {
  it('toggleFold folds and unfolds the focused item only', () => {
    const folded = run(
      mixedRound(),
      { type: 'focusItem', item: 1 },
      { type: 'toggleFold' },
    );
    expect(active(folded).folded).toEqual([false, true, false]);
    expect(active(apply(folded, { type: 'toggleFold' })).folded).toEqual([
      false,
      false,
      false,
    ]);
  });

  it('foldAll and unfoldAll cover every item of the active round only', () => {
    const two = initialState([
      presented('r1', { notices: [notice('N1')] }),
      presented('r2'),
    ]);
    const folded = apply(two, { type: 'foldAll' });
    expect(active(folded).folded).toEqual([true, true, true]);
    expect(folded.rounds[1].folded).toEqual([false, false]);
    expect(active(apply(folded, { type: 'unfoldAll' })).folded).toEqual([
      false,
      false,
      false,
    ]);
  });
});

describe('progress', () => {
  it('counts answered, not applicable and untouched questions', () => {
    const state = initialState([
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
            entry(3, { what: 'text but no pick' }),
          ],
        }),
      ),
    ]);
    expect(progress(active(state))).toEqual({
      answered: 1,
      notApplicable: 1,
      untouched: 2,
      total: 4,
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
      { type: 'saveFinished', roundId: 'r1', revision, ok: false },
    );
    expect(saveState(active(state))).toBe('unsaved');
  });

  it('navigation, folds and views are not edits', () => {
    const state = run(
      mixedRound(),
      { type: 'nextItem' },
      { type: 'toggleFold' },
      { type: 'openReview' },
      { type: 'toggleHelp' },
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
      notice_comments: [{ index: 1, comment: 'check this' }],
    });
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
      mixedRound(),
      { type: 'focusItem', item: 1 },
      { type: 'choose', choice: 2 },
      { type: 'toggleNotApplicable' },
      { type: 'toggleDontAsk' },
      {
        type: 'setText',
        roundId: 'r1',
        target: { field: 'why', question: 2 },
        value: 'reason',
      },
    );
    const body = buildBody(active(state));
    const restored = initialState([
      presented('r1', { notices: [notice('N1')] }, body),
    ]);
    expect(buildBody(active(restored))).toEqual(body);
  });
});

describe('apply', () => {
  it('leaves the state it was given unchanged', () => {
    const state = apply(mixedRound(), { type: 'focusItem', item: 1 });
    const before = structuredClone(state);
    apply(state, { type: 'choose', choice: 1 });
    apply(state, { type: 'toggleFold' });
    apply(state, { type: 'roundClosed', roundId: 'r1' });
    expect(state).toEqual(before);
  });
});
