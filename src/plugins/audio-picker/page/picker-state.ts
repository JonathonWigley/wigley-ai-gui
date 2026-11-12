import {
  activeForm,
  createSessionFormsReducer,
  emptySessionForms,
  type SessionForm,
  type SessionFormsAction,
  type SessionFormsState,
  updateForm,
} from '../../../shared/page/session-forms';
import type {
  AudioMoment,
  AudioPickerBody,
  AudioPickerForm,
  AudioPickerPlace,
  MomentAnswer,
  PresentedAudioPicker,
} from '../contract';
import type { AudioPickerScopeName } from '../ids';

// The cursor row, 0-based: `row` equal to the moment's candidate count is its
// None of these row.
export type PickerCursor = { moment: number; row: number };

// One candidate's read and decode: `peaks` and `durationSeconds` are its first
// file's, set once every file decoded; `error` names the file that failed.
export type CandidateLoad = {
  load: 'loading' | 'ready' | 'error';
  peaks: number[] | null;
  durationSeconds: number | null;
  error: string | null;
};

// `formId` is the picker's id. `loads[moment][candidate]` is 0-based; `playing`
// is the candidate whose sound plays now, null when none does.
export interface OpenPicker extends SessionForm {
  // As the agent sent it.
  picker: AudioPickerForm;
  // One per moment, as the user chose.
  answers: MomentAnswer[];
  cursor: PickerCursor;
  loads: CandidateLoad[][];
  playing: { moment: number; candidate: number } | null;
}

// The open pickers and the view; the active picker is the picker of the
// session the sessions plugin focuses, or null when that session has none.
export type PickerState = SessionFormsState<OpenPicker, 'list'>;

// The picker page's own actions beside the session form lifecycle's. The
// cursor actions with no `formId` act on the active picker; `moment`, `row`
// and `candidate` are 0-based.
type PickerOwnAction =
  | { type: 'nextRow' }
  | { type: 'prevRow' }
  | { type: 'firstRow' }
  | { type: 'lastRow' }
  | { type: 'nextMoment' }
  | { type: 'prevMoment' }
  | { type: 'selectRow'; formId: string; moment: number; row: number }
  | { type: 'choose'; formId: string; moment: number; row: number }
  // A notes box of the moment took focus.
  | { type: 'showMoment'; formId: string; moment: number }
  | { type: 'setNote'; formId: string; moment: number; value: string }
  | {
      type: 'candidateLoaded';
      formId: string;
      moment: number;
      candidate: number;
      peaks: number[];
      durationSeconds: number;
    }
  | {
      type: 'candidateFailed';
      formId: string;
      moment: number;
      candidate: number;
      error: string;
    }
  | { type: 'playStarted'; formId: string; moment: number; candidate: number }
  | { type: 'playStopped'; formId: string }
  | { type: 'openCancelPrompt' }
  // Puts picker `formId` back where the last page left it; the view applies
  // only while the picker is active.
  | { type: 'placeRestored'; formId: string; place: AudioPickerPlace };

export type PickerAction =
  | SessionFormsAction<PresentedAudioPicker>
  | PickerOwnAction;

// The actions that apply only in view 'list', and only to the active picker.
const LIST_VIEW_ACTIONS: ReadonlySet<PickerOwnAction['type']> = new Set([
  'nextRow',
  'prevRow',
  'firstRow',
  'lastRow',
  'nextMoment',
  'prevMoment',
  'selectRow',
  'choose',
  'showMoment',
  'openCancelPrompt',
]);

const LOADING: CandidateLoad = {
  load: 'loading',
  peaks: null,
  durationSeconds: null,
  error: null,
};

export function initialState(
  pickers: PresentedAudioPicker[],
  activeSessionId: string | null,
): PickerState {
  return pickers.reduce(
    (state, picker) => apply(state, { type: 'formShown', form: picker }),
    emptySessionForms<OpenPicker, 'list'>(activeSessionId),
  );
}

// Returns `state` itself when the action changes nothing. The cursor actions,
// `choose` and `openCancelPrompt` apply only in view 'list', to the active
// picker. While the active picker is sending, only the lifecycle's sending
// actions, notes, loads and a play's stop apply. Only `choose` and `setNote`
// raise a picker's revision.
export const apply = createSessionFormsReducer<
  OpenPicker,
  'list',
  PresentedAudioPicker,
  PickerOwnAction
>({
  formView: 'list',
  restore: restorePicker,
  sendingActions: new Set([
    'setNote',
    'candidateLoaded',
    'candidateFailed',
    'playStopped',
  ]),
  applyOwn,
});

function applyOwn(state: PickerState, action: PickerOwnAction): PickerState {
  const active = state.activeFormId;
  const isOutOfView =
    LIST_VIEW_ACTIONS.has(action.type) &&
    (state.view !== 'list' || ('formId' in action && action.formId !== active));
  if (isOutOfView) {
    return state;
  }
  switch (action.type) {
    case 'nextRow':
      return updateForm(state, active, (picker) => moveRow(picker, 1));
    case 'prevRow':
      return updateForm(state, active, (picker) => moveRow(picker, -1));
    case 'firstRow':
      return updateForm(state, active, (picker) =>
        withCursor(picker, { moment: 0, row: 0 }),
      );
    case 'lastRow':
      return updateForm(state, active, (picker) => {
        const last = picker.picker.moments.length - 1;
        return withCursor(picker, { moment: last, row: noneRow(picker, last) });
      });
    case 'nextMoment':
      return updateForm(state, active, (picker) => moveMoment(picker, 1));
    case 'prevMoment':
      return updateForm(state, active, (picker) => moveMoment(picker, -1));
    case 'showMoment':
      return updateForm(state, active, (picker) =>
        showMoment(picker, action.moment),
      );
    case 'selectRow':
      return updateForm(state, active, (picker) =>
        isRowOf(picker, action.moment, action.row)
          ? withCursor(picker, { moment: action.moment, row: action.row })
          : picker,
      );
    case 'choose':
      return updateForm(state, active, (picker) =>
        choose(picker, action.moment, action.row),
      );
    case 'setNote':
      return updateForm(state, action.formId, (picker) =>
        setNote(picker, action.moment, action.value),
      );
    case 'candidateLoaded':
      return updateForm(state, action.formId, (picker) =>
        withLoad(picker, action.moment, action.candidate, {
          load: 'ready',
          peaks: action.peaks,
          durationSeconds: action.durationSeconds,
          error: null,
        }),
      );
    case 'candidateFailed':
      return updateForm(state, action.formId, (picker) =>
        withLoad(picker, action.moment, action.candidate, {
          load: 'error',
          peaks: null,
          durationSeconds: null,
          error: action.error,
        }),
      );
    case 'playStarted':
      return updateForm(state, action.formId, (picker) => ({
        ...picker,
        playing: { moment: action.moment, candidate: action.candidate },
      }));
    case 'playStopped':
      return updateForm(state, action.formId, (picker) =>
        picker.playing === null ? picker : { ...picker, playing: null },
      );
    case 'openCancelPrompt':
      return active === null
        ? state
        : { ...state, view: 'confirm', confirmReturnView: 'list' };
    case 'placeRestored':
      return restorePlace(state, action.formId, action.place);
  }
}

export function buildBody(picker: OpenPicker): AudioPickerBody {
  return { answers: picker.answers };
}

// The picker's place: its cursor, and `confirm` while it is the active picker
// under the cancel prompt, else `list`, the view activating its session opens.
export function pickerPlace(
  state: PickerState,
  picker: OpenPicker,
): AudioPickerPlace {
  const isUnderPrompt =
    state.view === 'confirm' && picker.formId === state.activeFormId;
  return { ...picker.cursor, view: isUnderPrompt ? 'confirm' : 'list' };
}

// The scope the picker popup's keys fire in for this state.
export function scopeOf(state: PickerState): AudioPickerScopeName {
  return state.view === 'confirm' || state.view === 'idle'
    ? state.view
    : 'list';
}

// The session row's status for the picker popup: the picker's heading.
export function statusOf(picker: OpenPicker): string {
  return picker.picker.heading;
}

// The 0-based row of the moment's choice: its candidate's, or the None of
// these row for choice 0.
function chosenRow(picker: OpenPicker, moment: number): number {
  return rowOfChoice(
    picker.picker.moments[moment],
    picker.answers[moment].choice,
  );
}

// The moment's None of these row: its candidate count.
export function noneRow(picker: OpenPicker, moment: number): number {
  return picker.picker.moments[moment].candidates.length;
}

function rowOfChoice(moment: AudioMoment, choice: number): number {
  return choice === 0 ? moment.candidates.length : choice - 1;
}

// The choice the moment's 0-based `row` stands for: its candidate's 1-based
// number, or 0 for the None of these row.
export function choiceOfRow(
  picker: OpenPicker,
  moment: number,
  row: number,
): number {
  return row === noneRow(picker, moment) ? 0 : row + 1;
}

// Whether `row` is one of the moment's rows, its None of these row included.
export function isRowOf(
  picker: OpenPicker,
  moment: number,
  row: number,
): boolean {
  const isMoment = moment >= 0 && moment < picker.picker.moments.length;
  return isMoment && row >= 0 && row <= noneRow(picker, moment);
}

// Each moment opens on the draft's answer when its choice is one of the
// moment's rows, else on the agent's recommendation with no note.
function restorePicker(presented: PresentedAudioPicker): OpenPicker {
  const { formId, sessionId, label, form, draft } = presented;
  const answers = form.moments.map((moment, i) =>
    restoredAnswer(moment, draft?.answers[i]),
  );
  return {
    formId,
    sessionId,
    label,
    picker: form,
    answers,
    cursor: { moment: 0, row: rowOfChoice(form.moments[0], answers[0].choice) },
    loads: form.moments.map((moment) => moment.candidates.map(() => LOADING)),
    playing: null,
    revision: 0,
    savingRevision: null,
    savedRevision: 0,
    saveError: null,
    sending: null,
  };
}

function restoredAnswer(
  moment: AudioMoment,
  drafted: MomentAnswer | undefined,
): MomentAnswer {
  const choice = drafted?.choice;
  const isHeld =
    Number.isInteger(choice) &&
    choice !== undefined &&
    choice >= 0 &&
    choice <= moment.candidates.length;
  return isHeld && drafted !== undefined
    ? drafted
    : { choice: moment.recommend, note: '' };
}

function withCursor(picker: OpenPicker, cursor: PickerCursor): OpenPicker {
  const isSame =
    cursor.moment === picker.cursor.moment && cursor.row === picker.cursor.row;
  return isSame ? picker : { ...picker, cursor };
}

// Steps one row through every moment's rows in order: past a moment's None
// row onto the next moment's first row, and back; stuck at both ends.
function moveRow(picker: OpenPicker, step: 1 | -1): OpenPicker {
  const { moment, row } = picker.cursor;
  const lastMoment = picker.picker.moments.length - 1;
  if (step === 1) {
    if (row < noneRow(picker, moment)) {
      return withCursor(picker, { moment, row: row + 1 });
    }
    return moment < lastMoment
      ? withCursor(picker, { moment: moment + 1, row: 0 })
      : picker;
  }
  if (row > 0) {
    return withCursor(picker, { moment, row: row - 1 });
  }
  return moment > 0
    ? withCursor(picker, {
        moment: moment - 1,
        row: noneRow(picker, moment - 1),
      })
    : picker;
}

// Moves one moment, clamped, onto that moment's chosen row.
function moveMoment(picker: OpenPicker, step: 1 | -1): OpenPicker {
  const last = picker.picker.moments.length - 1;
  const moment = Math.min(Math.max(picker.cursor.moment + step, 0), last);
  return showMoment(picker, moment);
}

// Moves the cursor onto the moment's chosen row when it sits in another
// moment.
function showMoment(picker: OpenPicker, moment: number): OpenPicker {
  const isOtherMoment =
    moment !== picker.cursor.moment &&
    moment >= 0 &&
    moment < picker.picker.moments.length;
  return isOtherMoment
    ? withCursor(picker, { moment, row: chosenRow(picker, moment) })
    : picker;
}

// A body edit: the next revision.
function withAnswer(
  picker: OpenPicker,
  moment: number,
  answer: MomentAnswer,
): OpenPicker {
  return {
    ...picker,
    answers: picker.answers.map((current, i) =>
      i === moment ? answer : current,
    ),
    revision: picker.revision + 1,
  };
}

// Chooses the moment's `row`: its candidate, or None of these on the None row.
function choose(picker: OpenPicker, moment: number, row: number): OpenPicker {
  if (!isRowOf(picker, moment, row)) {
    return picker;
  }
  const answer = picker.answers[moment];
  const choice = choiceOfRow(picker, moment, row);
  return answer.choice === choice
    ? picker
    : withAnswer(picker, moment, { ...answer, choice });
}

function setNote(
  picker: OpenPicker,
  moment: number,
  value: string,
): OpenPicker {
  const answer = picker.answers[moment];
  if (answer === undefined || answer.note === value) {
    return picker;
  }
  return withAnswer(picker, moment, { ...answer, note: value });
}

function withLoad(
  picker: OpenPicker,
  moment: number,
  candidate: number,
  load: CandidateLoad,
): OpenPicker {
  if (picker.loads[moment]?.[candidate] === undefined) {
    return picker;
  }
  return {
    ...picker,
    loads: picker.loads.map((loads, i) =>
      i === moment
        ? loads.map((current, c) => (c === candidate ? load : current))
        : loads,
    ),
  };
}

// A saved place whose row the picker no longer holds is ignored; `confirm`
// opens the cancel prompt over the list while the picker is active.
function restorePlace(
  state: PickerState,
  formId: string,
  place: AudioPickerPlace,
): PickerState {
  const placed = updateForm(state, formId, (picker) =>
    isRowOf(picker, place.moment, place.row)
      ? withCursor(picker, { moment: place.moment, row: place.row })
      : picker,
  );
  const picker = placed.forms.find((form) => form.formId === formId);
  const isPlaceHeld =
    picker !== undefined && isRowOf(picker, place.moment, place.row);
  const opensPrompt =
    isPlaceHeld &&
    place.view === 'confirm' &&
    formId === placed.activeFormId &&
    placed.view === 'list';
  return opensPrompt
    ? { ...placed, view: 'confirm', confirmReturnView: 'list' }
    : placed;
}

// The active picker in view 'list', null in every other view or with none.
export function listedPicker(state: PickerState): OpenPicker | null {
  return state.view === 'list' ? activeForm(state) : null;
}
