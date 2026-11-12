import { describe, expect, it } from 'vitest';
import type {
  AgentFormEnd,
  AgentFormEndKind,
} from '../../../contracts/agent-forms';
import type { FocusOptions, TextEditor } from '../../../contracts/editor';
import type {
  CommandHandler,
  PageCommandContext,
  ToastTone,
} from '../../../contracts/plugin';
import { activeForm } from '../../../shared/page/session-forms';
import type { AudioPickerBody } from '../contract';
import type { PickerBox } from './layout/picker-kit';
import {
  closePickerFromMain,
  type PickerCommandDeps,
  pickerCommandHandlers,
} from './picker-commands';
import { initialState, type PickerCursor } from './picker-state';
import { createPickerStore } from './picker-store';
import { presentedPicker } from './test-pickers';

type PickerCommand = keyof ReturnType<typeof pickerCommandHandlers>;

// The editor of each box a test fires a command in.
const boxEditors = new Map<TextEditor, PickerBox>();

function editorOf(box: PickerBox): TextEditor {
  const editor = {
    text: () => '',
    setText: () => undefined,
    insert: () => undefined,
    charBeforeCursor: () => '',
    focus: () => undefined,
    blur: () => undefined,
    destroy: () => undefined,
  } as TextEditor;
  boxEditors.set(editor, box);
  return editor;
}

function box(moment: number): PickerBox {
  return { formId: 'p1', moment };
}

// Picker `p1` of the two-moment fixture, active in view 'list' with the
// cursor at `cursor` (moment 1's chosen row, `{0,1}`, unless given): moment 1
// rows `Soft chime`, `Bright chime`, None; moment 2 rows `Low thud`,
// `Mid thud`, `High thud`, None.
function setup(cursor?: PickerCursor) {
  const store = createPickerStore(
    initialState([presentedPicker('p1')], 'p1-session'),
  );
  if (cursor !== undefined) {
    store.dispatch({
      type: 'placeRestored',
      formId: 'p1',
      place: { ...cursor, view: 'list' },
    });
  }
  const focused: { box: PickerBox; options: FocusOptions | undefined }[] = [];
  let active: PickerBox | null = null;
  let leaves = 0;
  const toggles: [string, number, number][] = [];
  const finished: { formId: string; end: AgentFormEnd<AudioPickerBody> }[] = [];
  const logs: string[] = [];
  const toasts: [string, ToastTone][] = [];
  const deps: PickerCommandDeps = {
    store,
    boxes: {
      focus: (target, options) => {
        focused.push({ box: target, options });
        active = target;
      },
      leave: () => {
        leaves += 1;
        active = null;
      },
      active: () => active,
      boxOf: (editor) => boxEditors.get(editor),
    },
    audio: {
      toggle: (formId, moment, candidate) =>
        toggles.push([formId, moment, candidate]),
    },
    finish: (formId, end) => {
      finished.push({ formId, end });
      return Promise.resolve();
    },
    scrollPicker: () => ({ moved: true, atEnd: false }),
    openPreview: () => Promise.resolve(),
    toast: (text, tone) => toasts.push([text, tone]),
    log: (message) => logs.push(message),
  };
  const handlers = pickerCommandHandlers(deps);
  const run = (
    command: PickerCommand,
    context: Partial<PageCommandContext<any>> = {},
  ) => (handlers[command] as CommandHandler)({ arg: undefined, ...context });
  const picker = () => {
    const shown = activeForm(store.get());
    if (shown === null) {
      throw new Error('No picker is active');
    }
    return shown;
  };
  return {
    store,
    run,
    focused,
    toggles,
    finished,
    logs,
    leaves: () => leaves,
    choices: () => picker().answers.map((answer) => answer.choice),
    cursor: () => picker().cursor,
  };
}

describe('pickerCommandHandlers', () => {
  it.each<
    [
      string,
      PickerCursor | undefined,
      PickerCommand,
      Partial<PageCommandContext<any>>,
      number[],
      PickerCursor,
      string[],
    ]
  >([
    [
      'chooseRow on the first row',
      { moment: 0, row: 0 },
      'chooseRow',
      {},
      [1, 1],
      { moment: 0, row: 0 },
      ['chose Soft chime on moment 1'],
    ],
    [
      'choose 3, the None row',
      undefined,
      'choose',
      { arg: 3 },
      [0, 1],
      { moment: 0, row: 1 },
      ['chose None of these on moment 1'],
    ],
    [
      'choose 5, past the None row',
      undefined,
      'choose',
      { arg: 5 },
      [2, 1],
      { moment: 0, row: 1 },
      ['no row 5 in moment 1'],
    ],
    [
      'selectRow, a click',
      undefined,
      'selectRow',
      { arg: { moment: 1, row: 2 } },
      [2, 3],
      { moment: 1, row: 2 },
      ['cursor moment 2 row 3', 'chose High thud on moment 2'],
    ],
    [
      "choose 2 from moment 2's box",
      undefined,
      'choose',
      { arg: 2, editor: editorOf(box(1)) },
      [2, 2],
      { moment: 1, row: 0 },
      ['chose Mid thud on moment 2'],
    ],
    [
      'chooseRow on the chosen row',
      undefined,
      'chooseRow',
      {},
      [2, 1],
      { moment: 0, row: 1 },
      ['chose Bright chime on moment 1'],
    ],
  ])(
    'pickerCommandHandlers_Choose_ChoosesTheRowAndLogs: %s',
    (_name, start, command, context, choices, cursor, logs) => {
      const h = setup(start);

      h.run(command, context);

      expect(h.choices()).toEqual(choices);
      expect(h.cursor()).toEqual(cursor);
      expect(h.logs).toEqual(logs);
    },
  );

  it.each<[string, PickerCursor | undefined, PickerCommand, string[]]>([
    ['nextRow', undefined, 'nextRow', ['cursor moment 1 row 3']],
    ['lastRow', undefined, 'lastRow', ['cursor moment 2 row 4']],
    ['prevRow on the first row', { moment: 0, row: 0 }, 'prevRow', []],
  ])(
    'pickerCommandHandlers_Move_LogsTheCursorWhenItMoves: %s',
    (_name, start, command, logs) => {
      const h = setup(start);

      h.run(command);

      expect(h.logs).toEqual(logs);
    },
  );

  it.each<
    [
      string,
      PickerCursor | undefined,
      PickerCommand,
      Partial<PageCommandContext<any>>,
      [string, number, number][],
      PickerCursor,
      string[],
    ]
  >([
    [
      'togglePlay on a candidate row',
      undefined,
      'togglePlay',
      {},
      [['p1', 0, 1]],
      { moment: 0, row: 1 },
      [],
    ],
    [
      'togglePlay on the None row',
      { moment: 0, row: 2 },
      'togglePlay',
      {},
      [],
      { moment: 0, row: 2 },
      ['nothing to play on None of these'],
    ],
    [
      'playRow, a play button',
      undefined,
      'playRow',
      { arg: { moment: 1, candidate: 0 } },
      [['p1', 1, 0]],
      { moment: 1, row: 0 },
      ['cursor moment 2 row 1'],
    ],
  ])(
    'pickerCommandHandlers_Play_TogglesTheRowsCandidate: %s',
    (_name, start, command, context, toggles, cursor, logs) => {
      const h = setup(start);

      h.run(command, context);

      expect(h.toggles).toEqual(toggles);
      expect(h.cursor()).toEqual(cursor);
      expect(h.logs).toEqual(logs);
    },
  );

  it.each<
    [
      string,
      PickerCursor | undefined,
      PickerCommand,
      PickerBox | null,
      { box: PickerBox; options: FocusOptions | undefined }[],
      PickerCursor,
      number,
      string[],
    ]
  >([
    [
      'editNote in moment 2',
      { moment: 1, row: 1 },
      'editNote',
      null,
      [{ box: box(1), options: { insertAtEnd: true } }],
      { moment: 1, row: 1 },
      0,
      [],
    ],
    [
      'nextBox from the page',
      { moment: 1, row: 1 },
      'nextBox',
      null,
      [{ box: box(1), options: undefined }],
      { moment: 1, row: 1 },
      0,
      [],
    ],
    [
      "nextBox from moment 1's box",
      undefined,
      'nextBox',
      box(0),
      [{ box: box(1), options: undefined }],
      { moment: 0, row: 1 },
      0,
      [],
    ],
    [
      "prevBox from moment 1's box",
      undefined,
      'prevBox',
      box(0),
      [{ box: box(0), options: undefined }],
      { moment: 0, row: 1 },
      0,
      [],
    ],
    [
      "nextMoment from moment 1's box",
      undefined,
      'nextMoment',
      box(0),
      [{ box: box(1), options: { insertAtEnd: true } }],
      { moment: 1, row: 0 },
      0,
      ['cursor moment 2 row 1'],
    ],
    [
      'leaveBox',
      undefined,
      'leaveBox',
      box(0),
      [],
      { moment: 0, row: 1 },
      1,
      ['left the box'],
    ],
  ])(
    'pickerCommandHandlers_Box_FocusesTheMomentsBox: %s',
    (_name, start, command, inBox, focused, cursor, leaves, logs) => {
      const h = setup(start);

      h.run(command, inBox === null ? {} : { editor: editorOf(inBox) });

      expect(h.focused).toEqual(focused);
      expect(h.cursor()).toEqual(cursor);
      expect(h.leaves()).toBe(leaves);
      expect(h.logs).toEqual(logs);
    },
  );

  it.each<[string, PickerCommand[], AgentFormEndKind | null, string, string[]]>(
    [
      ['submit from the list', ['submit'], 'submitted', 'list', []],
      [
        'cancel, then confirm',
        ['askCancel', 'confirmCancel'],
        'cancelled',
        'confirm',
        ['cancel prompt opened'],
      ],
      [
        'submit under the prompt',
        ['askCancel', 'submit'],
        null,
        'confirm',
        ['cancel prompt opened'],
      ],
      [
        'cancel, then keep',
        ['askCancel', 'dismissConfirm'],
        null,
        'list',
        ['cancel prompt opened'],
      ],
    ],
  )(
    'pickerCommandHandlers_Finish_SendsOrCancelsTheActivePicker: %s',
    (_name, commands, kind, view, logs) => {
      const h = setup();

      for (const command of commands) {
        h.run(command);
      }

      const answers = [
        { choice: 2, note: '' },
        { choice: 1, note: '' },
      ];
      expect(h.finished).toEqual(
        kind === null
          ? []
          : [{ formId: 'p1', end: { kind, body: { answers } } }],
      );
      expect(h.store.get().view).toBe(view);
      expect(h.logs).toEqual(logs);
    },
  );
});

describe('closePickerFromMain', () => {
  it.each<[string, AgentFormEndKind, boolean, string[]]>([
    ["a submit's close", 'submitted', true, ['submitted']],
    ["a cancel's close", 'cancelled', true, ['cancelled']],
    ['a close main made on its own', 'submitted', false, []],
  ])(
    'closePickerFromMain_ClosedByFinish_LogsTheOutcome: %s',
    (_name, kind, byFinish, logs) => {
      const store = createPickerStore(
        initialState([presentedPicker('p1')], 'p1-session'),
      );
      store.dispatch({ type: 'sendStarted', formId: 'p1', kind });
      const logged: string[] = [];

      closePickerFromMain(
        { store, toast: () => undefined, log: (line) => logged.push(line) },
        { formId: 'p1', byFinish },
      );

      expect(logged).toEqual(logs);
      expect(store.get().forms).toEqual([]);
    },
  );
});
