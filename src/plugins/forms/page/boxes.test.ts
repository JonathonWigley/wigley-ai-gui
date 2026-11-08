import { describe, expect, it } from 'vitest';
import { stepBox } from '../../../shared/page/editor-boxes';
import {
  type BoxRef,
  boxKey,
  focusActionFor,
  isBoxShown,
  roundViewBoxes,
  shownBox,
  shownBoxes,
} from './boxes';
import {
  apply,
  type FormsAction,
  type FormsState,
  initialState,
} from './form-state';
import { finding, notice, presentedRound, question } from './test-rounds';

// A finding, questions Alpha and Beta, then the notices stop: rail positions
// 0 to 3.
function stateAfter(...actions: FormsAction[]): FormsState {
  const start = initialState(
    [
      presentedRound('r1', {
        notices: [notice('Heads up')],
        findings: [finding('Leak')],
        questions: [question('Alpha'), question('Beta')],
      }),
    ],
    'r1-session',
  );
  return actions.reduce(apply, start);
}

// Three notices and one question: rail positions 0 = the question, 1 = the
// notices stop.
function threeNoticesAfter(...actions: FormsAction[]): FormsState {
  const start = initialState(
    [
      presentedRound('r1', {
        notices: [notice('One'), notice('Two'), notice('Three')],
        questions: [question('Alpha')],
      }),
    ],
    'r1-session',
  );
  return actions.reduce(apply, start);
}

const onNotices: FormsAction = { type: 'focusItem', item: 3 };
const onAlpha: FormsAction = { type: 'focusItem', item: 1 };
const openLine = (notice: number): FormsAction => ({
  type: 'toggleNotice',
  notice,
});

const note: BoxRef = { roundId: 'r1', target: { field: 'note' } };
const commentOn = (notice: number): BoxRef => ({
  roundId: 'r1',
  target: { field: 'comment', notice },
});
const comment = commentOn(1);
const notes1: BoxRef = {
  roundId: 'r1',
  target: { field: 'notes', item: { kind: 'question', index: 1 } },
};
const reason1: BoxRef = {
  roundId: 'r1',
  target: { field: 'dontAskReason', item: { kind: 'question', index: 1 } },
};
const findingNotes: BoxRef = {
  roundId: 'r1',
  target: { field: 'notes', item: { kind: 'finding', index: 1 } },
};

describe('shownBoxes', () => {
  it.each([
    { case: 'no box with no line open', actions: [], boxes: [] },
    {
      case: 'the comment boxes of lines 1 and 3, open',
      actions: [openLine(3), openLine(1)],
      boxes: [commentOn(1), commentOn(3)],
    },
  ])('on the notices stop shows $case', ({ actions, boxes }) => {
    const state = threeNoticesAfter({ type: 'focusItem', item: 1 }, ...actions);
    expect(shownBoxes(state)).toEqual(boxes);
  });

  it("shows a question's notes box and no note", () => {
    expect(shownBoxes(stateAfter(onAlpha))).toEqual([notes1]);
  });

  it("adds the reason box while Don't ask is on", () => {
    const state = stateAfter(onAlpha, { type: 'toggleDontAsk' });
    expect(shownBoxes(state)).toEqual([notes1, reason1]);
  });

  it("shows a finding's notes box", () => {
    expect(shownBoxes(stateAfter({ type: 'focusItem', item: 0 }))).toEqual([
      findingNotes,
    ]);
  });

  it('shows only the note in the review', () => {
    expect(shownBoxes(stateAfter({ type: 'openReview' }))).toEqual([note]);
  });

  it('shows no box with no round open', () => {
    expect(shownBoxes(initialState([], null))).toEqual([]);
  });
});

describe('roundViewBoxes', () => {
  // Rounds r1 and r2, each with questions Alpha and Beta at rail positions 0
  // and 1 and the notices stop at 2, and r1's session focused.
  function twoRoundsAfter(...actions: FormsAction[]): FormsState {
    const start = initialState(
      ['r1', 'r2'].map((roundId) =>
        presentedRound(roundId, {
          questions: [question('Alpha'), question('Beta')],
          notices: [notice('Heads up')],
        }),
      ),
      'r1-session',
    );
    return actions.reduce(apply, start);
  }
  const focus = (sessionId: string): FormsAction => ({
    type: 'sessionActivated',
    sessionId,
  });
  const onBeta: FormsAction = { type: 'focusItem', item: 1 };
  const notesOn = (roundId: string, index: number): BoxRef => ({
    roundId,
    target: { field: 'notes', item: { kind: 'question', index } },
  });

  it.each<{
    name: string;
    actions: FormsAction[];
    roundId: string;
    boxes: BoxRef[];
  }>([
    {
      name: 'the focused round in the review',
      actions: [{ type: 'openReview' }],
      roundId: 'r1',
      boxes: [{ roundId: 'r1', target: { field: 'note' } }],
    },
    {
      name: 'a round whose pane lost focus to a Chat pane',
      actions: [onBeta, focus('chat-session')],
      roundId: 'r1',
      boxes: [notesOn('r1', 2)],
    },
    {
      name: 'a round behind the focused round in the review',
      actions: [
        focus('r2-session'),
        onBeta,
        focus('r1-session'),
        { type: 'openReview' },
      ],
      roundId: 'r2',
      boxes: [notesOn('r2', 2)],
    },
    {
      name: 'the open line of the focused notices stop',
      actions: [openLine(1), { type: 'focusItem', item: 2 }],
      roundId: 'r1',
      boxes: [comment],
    },
    {
      name: 'no box for the focused round under the cancel prompt',
      actions: [onBeta, { type: 'openReview' }, { type: 'askCancel' }],
      roundId: 'r1',
      boxes: [],
    },
  ])('draws $name', ({ actions, roundId, boxes }) => {
    expect(roundViewBoxes(twoRoundsAfter(...actions), roundId)).toEqual(boxes);
  });
});

describe('isBoxShown', () => {
  it('tells a shown box from a hidden one', () => {
    const state = stateAfter(onAlpha);
    expect(isBoxShown(state, notes1)).toBe(true);
    expect(isBoxShown(state, comment)).toBe(false);
  });
});

describe('stepBox', () => {
  const dontAskOn = stateAfter(onAlpha, { type: 'toggleDontAsk' });

  it('steps to the next and previous shown box', () => {
    expect(stepBox(shownBoxes(dontAskOn), boxKey, notes1, 1)).toEqual(reason1);
    expect(stepBox(shownBoxes(dontAskOn), boxKey, reason1, -1)).toEqual(notes1);
  });

  it('clamps at both ends', () => {
    expect(stepBox(shownBoxes(dontAskOn), boxKey, reason1, 1)).toEqual(reason1);
    expect(stepBox(shownBoxes(dontAskOn), boxKey, notes1, -1)).toEqual(notes1);
  });

  it('starts from the first box without a box, or from a hidden one', () => {
    expect(stepBox(shownBoxes(dontAskOn), boxKey, null, 1)).toEqual(notes1);
    expect(stepBox(shownBoxes(dontAskOn), boxKey, comment, 1)).toEqual(notes1);
  });

  it('finds nothing when no box is shown', () => {
    expect(
      stepBox(shownBoxes(initialState([], null)), boxKey, null, 1),
    ).toBeNull();
  });
});

describe('shownBox', () => {
  it('finds the first shown box editing one of the fields', () => {
    const dontAskOn = stateAfter(onAlpha, { type: 'toggleDontAsk' });
    expect(
      shownBox(stateAfter(onNotices, openLine(1)), ['notes', 'comment']),
    ).toEqual(comment);
    expect(shownBox(dontAskOn, ['dontAskReason'])).toEqual(reason1);
    expect(shownBox(stateAfter(), ['note'])).toBeNull();
  });
});

describe('focusActionFor', () => {
  it("focuses the box's item: a notes box's rail position, a comment box's line", () => {
    const notes2: BoxRef = {
      roundId: 'r1',
      target: { field: 'notes', item: { kind: 'question', index: 2 } },
    };
    expect(focusActionFor(stateAfter(), notes2)).toEqual({
      type: 'focusItem',
      item: 2,
    });
    expect(focusActionFor(stateAfter(), findingNotes)).toEqual({
      type: 'focusItem',
      item: 0,
    });
    expect(focusActionFor(stateAfter(), comment)).toEqual({
      type: 'focusNotice',
      notice: 1,
    });
  });

  it('does nothing for the note or a box of another round', () => {
    const elsewhere: BoxRef = { ...notes1, roundId: 'r2' };
    expect(focusActionFor(stateAfter(), note)).toBeNull();
    expect(focusActionFor(stateAfter(), elsewhere)).toBeNull();
  });
});

describe('boxKey', () => {
  it('keys boxes by round, field, kind and item', () => {
    expect(boxKey(notes1)).toBe(boxKey({ ...notes1 }));
    expect(boxKey(notes1)).not.toBe(boxKey(findingNotes));
    expect(boxKey(notes1)).not.toBe(boxKey(reason1));
    expect(boxKey(notes1)).not.toBe(
      boxKey({ roundId: 'r2', target: notes1.target }),
    );
  });
});
