import type {
  AgentFormClosed,
  AgentFormEnd,
  AgentFormEndKind,
} from '../../../contracts/agent-forms';
import type {
  ContentScroll,
  FocusOptions,
  ScrollStep,
} from '../../../contracts/editor';
import type { PluginLog } from '../../../contracts/log';
import type {
  PageCommandContext,
  PageStart,
  ToastTone,
} from '../../../contracts/plugin';
import { scrollText } from '../../../shared/content-scroll';
import { errorText } from '../../../shared/error-text';
import { type EditorBoxes, stepBox } from '../../../shared/page/editor-boxes';
import {
  closeFormFromMain,
  finishActiveForm,
  mayCloseSessionForm,
  type SessionFormWords,
} from '../../../shared/page/session-forms';
import type { AudioPickerBody } from '../contract';
import type { audioPickerManifest } from '../manifest';
import { PICKER_BOX_IDENTITY, type PickerBox } from './layout/picker-kit';
import type { PickerAudio } from './picker-audio';
import {
  buildBody,
  choiceOfRow,
  isRowOf,
  listedPicker,
  noneRow,
  type OpenPicker,
  type PickerAction,
  type PickerCursor,
  type PickerState,
} from './picker-state';
import type { PickerStore } from './picker-store';

export interface PickerCommandDeps {
  store: PickerStore;
  boxes: Pick<
    EditorBoxes<PickerBox>,
    'focus' | 'leave' | 'active' | 'activeMode' | 'boxOf'
  >;
  audio: Pick<PickerAudio, 'toggle'>;
  // Hands the finished picker to main; rejects with the reason when main
  // keeps it open.
  finish(formId: string, end: AgentFormEnd<AudioPickerBody>): Promise<void>;
  // Scrolls the active picker's list by `step`, down for 1 and up for -1;
  // null when no picker is shown.
  scrollPicker(step: ScrollStep, direction: 1 | -1): ContentScroll | null;
  // Asks main to open the layout preview; rejects with the reason it failed.
  openPreview(): Promise<unknown>;
  toast(text: string, tone: ToastTone): void;
  log: PluginLog;
  // Whether the page part stopped.
  isStopped(): boolean;
}

// A handler's body, run once the box it fired in has its moment shown; `box`
// is that box, undefined from the page.
type Run = (box: PickerBox | undefined) => void;

// How the picker page's log and toasts name a picker.
const PICKER_WORDS: SessionFormWords = {
  noun: 'audio picker',
  sent: 'Choices sent',
};

const APPEND: FocusOptions = { insertAtEnd: true };

// Every audio picker command's handler, by short id. A command fired in a box
// first shows that box's moment, so it acts where the user is typing.
export function pickerCommandHandlers(
  deps: PickerCommandDeps,
): PageStart<typeof audioPickerManifest>['commands'] {
  const { store, boxes, log } = deps;
  const handler =
    (run: Run) =>
    (context: PageCommandContext<unknown>): void => {
      const box = boxIn(deps, context);
      if (box !== undefined) {
        store.dispatch({
          type: 'showMoment',
          formId: box.formId,
          moment: box.moment,
        });
      }
      run(box);
    };

  return {
    nextRow: handler(() => moveCursor(deps, { type: 'nextRow' })),
    prevRow: handler(() => moveCursor(deps, { type: 'prevRow' })),
    firstRow: handler(() => moveCursor(deps, { type: 'firstRow' })),
    lastRow: handler(() => moveCursor(deps, { type: 'lastRow' })),
    nextMoment: handler((box) => moveMoment(deps, box, { type: 'nextMoment' })),
    prevMoment: handler((box) => moveMoment(deps, box, { type: 'prevMoment' })),
    chooseRow: handler(() => {
      const picker = listedPicker(store.get());
      if (picker !== null) {
        chooseAt(deps, picker, picker.cursor);
      }
    }),
    choose: (context) =>
      handler(() => chooseNumbered(deps, context.arg))(context),
    // A click names its row, so these act with no box's moment shown first.
    selectRow: ({ arg }) => {
      const picker = selectAt(deps, arg);
      if (picker !== null) {
        chooseAt(deps, picker, arg);
      }
    },
    togglePlay: handler(() => togglePlay(deps)),
    playRow: ({ arg }) => {
      const picker = selectAt(deps, { moment: arg.moment, row: arg.candidate });
      if (picker !== null) {
        deps.audio.toggle(picker.formId, arg.moment, arg.candidate);
      }
    },
    editNote: handler(() => {
      const picker = listedPicker(store.get());
      if (picker !== null) {
        boxes.focus(momentBox(picker, picker.cursor.moment), APPEND);
      }
    }),
    nextBox: handler((box) => stepFocus(deps, box, 1)),
    prevBox: handler((box) => stepFocus(deps, box, -1)),
    leaveBox: handler(() => {
      boxes.leave();
      log('left the box');
    }),
    lineDown: handler(() => scrollPicker(deps, 'line', 1)),
    lineUp: handler(() => scrollPicker(deps, 'line', -1)),
    submit: handler(() => finishActivePicker(deps, 'list', 'submitted')),
    askCancel: handler(() => {
      const before = store.get().view;
      store.dispatch({ type: 'openCancelPrompt' });
      if (before !== 'confirm' && store.get().view === 'confirm') {
        log('cancel prompt opened');
      }
    }),
    confirmCancel: handler(() =>
      finishActivePicker(deps, 'confirm', 'cancelled'),
    ),
    dismissConfirm: handler(() => store.dispatch({ type: 'dismissConfirm' })),
    // Acts in any view, with or without an open picker.
    openPreview: () => openPreview(deps),
  };
}

function openPreview(deps: PickerCommandDeps) {
  deps.openPreview().catch((error: unknown) => {
    deps.log(`layout preview failed: ${errorText(error)}`);
    deps.toast(`Layout preview failed: ${errorText(error)}`, 'error');
  });
}

// The picker box the command's editor edits. A key with no editor in its
// context acts on the focused box: a page key never fires while a box has
// focus, and a chord bind fires inside one without naming the editor.
function boxIn(
  deps: PickerCommandDeps,
  context: PageCommandContext<unknown>,
): PickerBox | undefined {
  return context.editor === undefined
    ? (deps.boxes.active() ?? undefined)
    : deps.boxes.boxOf(context.editor);
}

function momentBox(picker: OpenPicker, moment: number): PickerBox {
  return { formId: picker.formId, moment };
}

function cursorOf(state: PickerState): PickerCursor | null {
  return listedPicker(state)?.cursor ?? null;
}

// Dispatches the move, then logs the cursor when it moved.
function moveCursor(deps: PickerCommandDeps, action: PickerAction) {
  const before = cursorOf(deps.store.get());
  deps.store.dispatch(action);
  logCursorMove(deps, before);
}

function logCursorMove(deps: PickerCommandDeps, before: PickerCursor | null) {
  const after = cursorOf(deps.store.get());
  if (after !== null && after !== before) {
    deps.log(`cursor moment ${after.moment + 1} row ${after.row + 1}`);
  }
}

// A moment move fired from a box focuses the new moment's box in the mode the
// box was in, so typing goes on in the moment the user moved to: insert mode
// at the text's end, else the new box keeps its own mode.
function moveMoment(
  deps: PickerCommandDeps,
  box: PickerBox | undefined,
  action: PickerAction,
) {
  const wasInserting = deps.boxes.activeMode()?.mode === 'insert';
  moveCursor(deps, action);
  const picker = listedPicker(deps.store.get());
  const isOtherMoment =
    box !== undefined && picker !== null && picker.cursor.moment !== box.moment;
  if (isOtherMoment) {
    deps.boxes.focus(
      momentBox(picker, picker.cursor.moment),
      wasInserting ? APPEND : undefined,
    );
  }
}

// Moves the active picker's cursor to the row, logging the move; the picker,
// or null with none listed.
function selectAt(
  deps: PickerCommandDeps,
  at: { moment: number; row: number },
): OpenPicker | null {
  const picker = listedPicker(deps.store.get());
  if (picker === null) {
    return null;
  }
  const before = picker.cursor;
  deps.store.dispatch({ type: 'selectRow', formId: picker.formId, ...at });
  logCursorMove(deps, before);
  return listedPicker(deps.store.get());
}

// Chooses row `n` (1-based) of the cursor's moment.
function chooseNumbered(deps: PickerCommandDeps, n: number) {
  const picker = listedPicker(deps.store.get());
  if (picker === null) {
    return;
  }
  const { moment } = picker.cursor;
  if (!isRowOf(picker, moment, n - 1)) {
    deps.log(`no row ${n} in moment ${moment + 1}`);
    return;
  }
  chooseAt(deps, picker, { moment, row: n - 1 });
}

// Chooses the row and logs the choice whenever the choose lands, the choice
// changed or not, so a repeated key still shows in the log.
function chooseAt(
  deps: PickerCommandDeps,
  picker: OpenPicker,
  at: { moment: number; row: number },
) {
  const { moment, row } = at;
  if (picker.sending !== null || !isRowOf(picker, moment, row)) {
    return;
  }
  deps.store.dispatch({ type: 'choose', formId: picker.formId, moment, row });
  const choice = choiceOfRow(picker, moment, row);
  const chosen =
    choice === 0
      ? 'None of these'
      : picker.picker.moments[moment].candidates[choice - 1].name;
  deps.log(`chose ${chosen} on moment ${moment + 1}`);
}

function togglePlay(deps: PickerCommandDeps) {
  const picker = listedPicker(deps.store.get());
  if (picker === null) {
    return;
  }
  const { moment, row } = picker.cursor;
  if (row === noneRow(picker, moment)) {
    deps.log('nothing to play on None of these');
    return;
  }
  deps.audio.toggle(picker.formId, moment, row);
}

// From the page, the cursor moment's box; from a box, the box `step` moments
// away, clamped.
function stepFocus(
  deps: PickerCommandDeps,
  box: PickerBox | undefined,
  step: 1 | -1,
) {
  const picker = listedPicker(deps.store.get());
  if (picker === null) {
    return;
  }
  const shown = picker.picker.moments.map((_, moment) =>
    momentBox(picker, moment),
  );
  const next =
    box === undefined
      ? momentBox(picker, picker.cursor.moment)
      : stepBox(shown, PICKER_BOX_IDENTITY.keyOf, box, step);
  if (next !== null) {
    deps.boxes.focus(next);
  }
}

// Leaves focus where it is, so a box keeps focus and its vim mode.
function scrollPicker(
  deps: PickerCommandDeps,
  step: ScrollStep,
  direction: 1 | -1,
) {
  const scroll = deps.scrollPicker(step, direction);
  deps.log(
    scroll === null
      ? 'no audio picker to scroll'
      : scrollText('the audio picker', step, direction, scroll),
  );
}

// Whether the session's popup lets it close, as mayCloseSessionForm decides.
export function mayClosePicker(
  deps: Pick<PickerCommandDeps, 'store' | 'toast' | 'log'>,
  sessionId: string,
): boolean {
  return mayCloseSessionForm({ ...deps, words: PICKER_WORDS }, sessionId);
}

// Hands main the active picker's finish, as finishActiveForm sends it.
function finishActivePicker(
  deps: PickerCommandDeps,
  from: 'list' | 'confirm',
  kind: AgentFormEndKind,
) {
  finishActiveForm(
    { ...deps, bodyOf: buildBody, words: PICKER_WORDS },
    from,
    kind,
  );
}

// Closes a picker main closed, as closeFormFromMain closes it.
export function closePickerFromMain(
  deps: Pick<PickerCommandDeps, 'store' | 'toast' | 'log'>,
  closed: AgentFormClosed,
): void {
  closeFormFromMain({ ...deps, words: PICKER_WORDS }, closed);
}
