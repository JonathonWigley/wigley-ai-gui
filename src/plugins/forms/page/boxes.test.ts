import { describe, expect, it } from 'vitest';
import {
  type BoxRef,
  boxDescription,
  boxKey,
  focusActionFor,
  isBoxShown,
  shownBox,
  shownBoxes,
  stepBox,
} from './boxes';
import {
  apply,
  type FormsAction,
  type FormsState,
  initialState,
} from './form-state';
import { notice, presentedRound, question } from './test-rounds';

// One notice, then questions Alpha and Beta: rail positions 0, 1, 2.
function stateAfter(...actions: FormsAction[]): FormsState {
  const start = initialState(
    [
      presentedRound('r1', {
        notices: [notice('Heads up')],
        questions: [question('Alpha'), question('Beta')],
      }),
    ],
    'r1-session',
  );
  return actions.reduce(apply, start);
}

const note: BoxRef = { roundId: 'r1', target: { field: 'note' } };
const comment: BoxRef = {
  roundId: 'r1',
  target: { field: 'comment', notice: 1 },
};
const what1: BoxRef = { roundId: 'r1', target: { field: 'what', question: 1 } };
const why1: BoxRef = { roundId: 'r1', target: { field: 'why', question: 1 } };
const reason1: BoxRef = {
  roundId: 'r1',
  target: { field: 'dontAskReason', question: 1 },
};

describe('shownBoxes', () => {
  it('shows the focused notice comment, then the round note', () => {
    expect(shownBoxes(stateAfter())).toEqual([comment, note]);
  });

  it("shows a question's answer and why boxes, then the note", () => {
    expect(shownBoxes(stateAfter({ type: 'focusItem', item: 1 }))).toEqual([
      what1,
      why1,
      note,
    ]);
  });

  it("adds the reason box while Don't ask is on", () => {
    const state = stateAfter(
      { type: 'focusItem', item: 1 },
      { type: 'toggleDontAsk' },
    );
    expect(shownBoxes(state)).toEqual([what1, why1, reason1, note]);
  });

  it('shows only the note in the review', () => {
    expect(shownBoxes(stateAfter({ type: 'openReview' }))).toEqual([note]);
  });

  it('shows no box under help, or with no round open', () => {
    expect(shownBoxes(stateAfter({ type: 'toggleHelp' }))).toEqual([]);
    expect(shownBoxes(initialState([], null))).toEqual([]);
  });
});

describe('isBoxShown', () => {
  it('tells a shown box from a hidden one', () => {
    const state = stateAfter({ type: 'focusItem', item: 1 });
    expect(isBoxShown(state, why1)).toBe(true);
    expect(isBoxShown(state, comment)).toBe(false);
  });
});

describe('stepBox', () => {
  const onAlpha = stateAfter({ type: 'focusItem', item: 1 });

  it('steps to the next and previous shown box', () => {
    expect(stepBox(onAlpha, what1, 1)).toEqual(why1);
    expect(stepBox(onAlpha, note, -1)).toEqual(why1);
  });

  it('clamps at both ends', () => {
    expect(stepBox(onAlpha, note, 1)).toEqual(note);
    expect(stepBox(onAlpha, what1, -1)).toEqual(what1);
  });

  it('starts from the first box without a box, or from a hidden one', () => {
    expect(stepBox(onAlpha, null, 1)).toEqual(what1);
    expect(stepBox(onAlpha, comment, 1)).toEqual(what1);
  });

  it('finds nothing when no box is shown', () => {
    expect(stepBox(initialState([], null), null, 1)).toBeNull();
  });
});

describe('shownBox', () => {
  it('finds the first shown box editing one of the fields', () => {
    expect(shownBox(stateAfter(), ['what', 'comment'])).toEqual(comment);
    expect(shownBox(stateAfter(), ['why'])).toBeNull();
  });
});

describe('focusActionFor', () => {
  it("focuses the rail position of the box's item", () => {
    const why2: BoxRef = {
      roundId: 'r1',
      target: { field: 'why', question: 2 },
    };
    expect(focusActionFor(stateAfter(), why2)).toEqual({
      type: 'focusItem',
      item: 2,
    });
    expect(focusActionFor(stateAfter(), comment)).toEqual({
      type: 'focusItem',
      item: 0,
    });
  });

  it('does nothing for the note or a box of another round', () => {
    const elsewhere: BoxRef = {
      roundId: 'r2',
      target: { field: 'what', question: 1 },
    };
    expect(focusActionFor(stateAfter(), note)).toBeNull();
    expect(focusActionFor(stateAfter(), elsewhere)).toBeNull();
  });
});

describe('boxKey and boxDescription', () => {
  it('keys boxes by round, field and item', () => {
    expect(boxKey(what1)).toBe(boxKey({ ...what1 }));
    expect(boxKey(what1)).not.toBe(boxKey(why1));
    expect(boxKey(what1)).not.toBe(
      boxKey({ roundId: 'r2', target: what1.target }),
    );
  });

  it('names the box the way the log reads', () => {
    expect(boxDescription(why1)).toBe('why on question 1');
    expect(boxDescription(comment)).toBe('comment on notice 1');
    expect(boxDescription(note)).toBe('note on the round');
  });
});
