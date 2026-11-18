import { describe, expect, it } from 'vitest';
import { activeForm } from '../../../shared/page/session-forms';
import type { RoundPlace } from '../contract';
import { saveState } from '../../../shared/page/autosave';
import { roundPlace, type FormsAction, type FormsState } from './form-state';
import {
  active,
  draft,
  entry,
  findingRound,
  mixedRound,
  notice,
  presented,
  question,
  run,
} from './form-state.test-support';
import { focusedItem, type RoundState } from './round-model';
import { apply, finding, initialState, questionAnswers } from './test-rounds';
import { useBuiltInFindingOrigins } from '../finding-origins.test-support';

useBuiltInFindingOrigins();

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
