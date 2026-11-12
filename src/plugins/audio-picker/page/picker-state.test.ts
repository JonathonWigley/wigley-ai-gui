import { describe, expect, it } from 'vitest';
import { saveState } from '../../../shared/page/autosave';
import { activeForm, formById } from '../../../shared/page/session-forms';
import type { AudioPickerPlace, MomentAnswer } from '../contract';
import {
  apply,
  initialState,
  type OpenPicker,
  type PickerAction,
  type PickerCursor,
  type PickerState,
  pickerPlace,
} from './picker-state';
import { presentedPicker } from './test-pickers';

// Picker `p1`, active in view 'list', over the two-moment fixture: moment 1
// holds rows 0 and 1 and its None row 2; moment 2 rows 0 to 2 and its None
// row 3. `choices` are the drafted choices, each with no note.
function stateWith(choices: number[] | null = null): PickerState {
  const draft =
    choices === null
      ? null
      : { answers: choices.map((choice) => ({ choice, note: '' })) };
  return initialState([presentedPicker('p1', { draft })], 'p1-session');
}

function pickerOf(state: PickerState): OpenPicker {
  const picker = activeForm(state);
  if (picker === null) {
    throw new Error('No picker is active');
  }
  return picker;
}

function at(state: PickerState, cursor: PickerCursor): PickerState {
  return apply(state, {
    type: 'placeRestored',
    formId: 'p1',
    place: { ...cursor, view: 'list' },
  });
}

describe('apply', () => {
  it.each<[string, PickerCursor, number[] | null, PickerAction, PickerCursor]>([
    [
      'nextRow within a moment',
      { moment: 0, row: 0 },
      null,
      { type: 'nextRow' },
      { moment: 0, row: 1 },
    ],
    [
      'nextRow into the next moment',
      { moment: 0, row: 2 },
      null,
      { type: 'nextRow' },
      { moment: 1, row: 0 },
    ],
    [
      'nextRow on the last None row',
      { moment: 1, row: 3 },
      null,
      { type: 'nextRow' },
      { moment: 1, row: 3 },
    ],
    [
      'prevRow into the previous None row',
      { moment: 1, row: 0 },
      null,
      { type: 'prevRow' },
      { moment: 0, row: 2 },
    ],
    [
      'prevRow on the first row',
      { moment: 0, row: 0 },
      null,
      { type: 'prevRow' },
      { moment: 0, row: 0 },
    ],
    [
      'firstRow',
      { moment: 1, row: 2 },
      null,
      { type: 'firstRow' },
      { moment: 0, row: 0 },
    ],
    [
      'lastRow',
      { moment: 0, row: 1 },
      null,
      { type: 'lastRow' },
      { moment: 1, row: 3 },
    ],
    [
      'nextMoment onto the chosen row',
      { moment: 0, row: 0 },
      [2, 3],
      { type: 'nextMoment' },
      { moment: 1, row: 2 },
    ],
    [
      'prevMoment onto a None choice',
      { moment: 1, row: 1 },
      [0, 1],
      { type: 'prevMoment' },
      { moment: 0, row: 2 },
    ],
    [
      'nextMoment on the last moment',
      { moment: 1, row: 1 },
      null,
      { type: 'nextMoment' },
      { moment: 1, row: 1 },
    ],
    [
      'showMoment of another moment',
      { moment: 0, row: 0 },
      [2, 3],
      { type: 'showMoment', formId: 'p1', moment: 1 },
      { moment: 1, row: 2 },
    ],
    [
      'showMoment of its own moment',
      { moment: 0, row: 0 },
      null,
      { type: 'showMoment', formId: 'p1', moment: 0 },
      { moment: 0, row: 0 },
    ],
    [
      'selectRow onto a None row',
      { moment: 0, row: 0 },
      null,
      { type: 'selectRow', formId: 'p1', moment: 1, row: 3 },
      { moment: 1, row: 3 },
    ],
    [
      'selectRow past the None row',
      { moment: 0, row: 0 },
      null,
      { type: 'selectRow', formId: 'p1', moment: 0, row: 3 },
      { moment: 0, row: 0 },
    ],
  ])(
    'apply_CursorAction_MovesTheCursor: %s',
    (_name, start, choices, action, expected) => {
      const state = apply(at(stateWith(choices), start), action);

      expect(pickerOf(state).cursor).toEqual(expected);
    },
  );

  it.each<[string, PickerAction, MomentAnswer[] | 'same', number]>([
    [
      'choose a new candidate',
      { type: 'choose', formId: 'p1', moment: 0, row: 0 },
      [
        { choice: 1, note: '' },
        { choice: 1, note: '' },
      ],
      1,
    ],
    [
      'choose the chosen candidate',
      { type: 'choose', formId: 'p1', moment: 0, row: 1 },
      'same',
      0,
    ],
    [
      'choose the None row',
      { type: 'choose', formId: 'p1', moment: 0, row: 2 },
      [
        { choice: 0, note: '' },
        { choice: 1, note: '' },
      ],
      1,
    ],
    [
      'choose a row past None',
      { type: 'choose', formId: 'p1', moment: 0, row: 3 },
      'same',
      0,
    ],
    [
      'setNote new text',
      { type: 'setNote', formId: 'p1', moment: 1, value: 'quiet' },
      [
        { choice: 2, note: '' },
        { choice: 1, note: 'quiet' },
      ],
      1,
    ],
    [
      'setNote the same text',
      { type: 'setNote', formId: 'p1', moment: 0, value: '' },
      'same',
      0,
    ],
    [
      'candidateLoaded',
      {
        type: 'candidateLoaded',
        formId: 'p1',
        moment: 0,
        candidate: 1,
        peaks: [0.5],
        durationSeconds: 1.5,
      },
      [
        { choice: 2, note: '' },
        { choice: 1, note: '' },
      ],
      0,
    ],
  ])(
    'apply_AnswerEdit_ChangesTheAnswerAndRevision: %s',
    (_name, action, answers, revisionDelta) => {
      const state = stateWith();
      const before = pickerOf(state);

      const next = apply(state, action);

      expect(next === state).toBe(answers === 'same');
      const after = pickerOf(next);
      expect(after.answers).toEqual(
        answers === 'same' ? before.answers : answers,
      );
      expect(after.revision - before.revision).toBe(revisionDelta);
    },
  );

  it.each<[string, PickerAction, boolean]>([
    ['nextRow', { type: 'nextRow' }, false],
    ['choose', { type: 'choose', formId: 'p1', moment: 0, row: 0 }, false],
    ['openCancelPrompt', { type: 'openCancelPrompt' }, false],
    [
      'playStarted',
      { type: 'playStarted', formId: 'p1', moment: 1, candidate: 0 },
      false,
    ],
    ['setNote', { type: 'setNote', formId: 'p1', moment: 0, value: 'x' }, true],
    [
      'candidateLoaded',
      {
        type: 'candidateLoaded',
        formId: 'p1',
        moment: 0,
        candidate: 0,
        peaks: [0.2],
        durationSeconds: 2,
      },
      true,
    ],
    [
      'candidateFailed',
      {
        type: 'candidateFailed',
        formId: 'p1',
        moment: 0,
        candidate: 0,
        error: 'file 1: bad',
      },
      true,
    ],
    ['playStopped', { type: 'playStopped', formId: 'p1' }, true],
  ])(
    'apply_WhileSending_AppliesOnlyNotesLoadsAndStops: %s',
    (_name, action, applies) => {
      const playing = apply(stateWith(), {
        type: 'playStarted',
        formId: 'p1',
        moment: 0,
        candidate: 1,
      });
      const sending = apply(playing, {
        type: 'sendStarted',
        formId: 'p1',
        kind: 'submitted',
      });

      expect(apply(sending, action) !== sending).toBe(applies);
    },
  );

  it('apply_CancelPrompt_OpensFromTheListAndReturnsToIt', () => {
    const asked = apply(stateWith(), { type: 'openCancelPrompt' });
    const kept = apply(asked, { type: 'dismissConfirm' });
    const idle = initialState([presentedPicker('p1')], 'other-session');

    expect(asked.view).toBe('confirm');
    expect(kept.view).toBe('list');
    expect(apply(idle, { type: 'openCancelPrompt' })).toBe(idle);
  });

  it.each<[string, AudioPickerPlace, PickerCursor | null, string]>([
    [
      'a None row',
      { moment: 1, row: 3, view: 'list' },
      { moment: 1, row: 3 },
      'list',
    ],
    [
      'under the prompt',
      { moment: 1, row: 0, view: 'confirm' },
      { moment: 1, row: 0 },
      'confirm',
    ],
    ['no such moment', { moment: 2, row: 0, view: 'list' }, null, 'list'],
    ['past the None row', { moment: 0, row: 3, view: 'list' }, null, 'list'],
  ])(
    'apply_PlaceRestored_RestoresAPlaceThatFits: %s',
    (_name, place, cursor, view) => {
      const state = stateWith();

      const next = apply(state, { type: 'placeRestored', formId: 'p1', place });

      if (cursor === null) {
        expect(next).toBe(state);
        return;
      }
      expect(pickerOf(next).cursor).toEqual(cursor);
      expect(next.view).toBe(view);
    },
  );
});

describe('initialState', () => {
  it.each<[string, MomentAnswer[] | null, MomentAnswer[], PickerCursor]>([
    [
      'no draft',
      null,
      [
        { choice: 2, note: '' },
        { choice: 1, note: '' },
      ],
      { moment: 0, row: 1 },
    ],
    [
      'a valid draft',
      [
        { choice: 0, note: 'x' },
        { choice: 3, note: 'y' },
      ],
      [
        { choice: 0, note: 'x' },
        { choice: 3, note: 'y' },
      ],
      { moment: 0, row: 2 },
    ],
    [
      'a choice past None',
      [
        { choice: 0, note: 'x' },
        { choice: 4, note: 'z' },
      ],
      [
        { choice: 0, note: 'x' },
        { choice: 1, note: '' },
      ],
      { moment: 0, row: 2 },
    ],
    [
      'a one-answer draft',
      [{ choice: 1, note: 'x' }],
      [
        { choice: 1, note: 'x' },
        { choice: 1, note: '' },
      ],
      { moment: 0, row: 0 },
    ],
  ])(
    'initialState_Draft_OpensOnValidAnswersElseTheRecommendation: %s',
    (_name, drafted, answers, cursor) => {
      const draft = drafted === null ? null : { answers: drafted };

      const picker = pickerOf(
        initialState([presentedPicker('p1', { draft })], 'p1-session'),
      );

      expect(picker.answers).toEqual(answers);
      expect(picker.cursor).toEqual(cursor);
      expect(picker.loads.flat().map((load) => load.load)).toEqual([
        'loading',
        'loading',
        'loading',
        'loading',
        'loading',
      ]);
      expect(saveState(picker)).toBe('saved');
    },
  );
});

describe('pickerPlace', () => {
  it.each<[string, boolean, string, AudioPickerPlace['view']]>([
    ['the active picker in the list', false, 'p1', 'list'],
    ['the active picker under the prompt', true, 'p1', 'confirm'],
    ['another picker under the prompt', true, 'p2', 'list'],
  ])(
    'pickerPlace_ActivePickerUnderThePrompt_ReportsConfirm: %s',
    (_name, isAsked, formId, view) => {
      const shown = initialState(
        [presentedPicker('p1'), presentedPicker('p2')],
        'p1-session',
      );
      const state = isAsked
        ? apply(shown, { type: 'openCancelPrompt' })
        : shown;
      const picker = formById(state, formId) as OpenPicker;

      expect(pickerPlace(state, picker)).toEqual({ ...picker.cursor, view });
    },
  );
});
