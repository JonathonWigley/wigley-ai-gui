import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandArg, CommandId } from '../../../contracts/commands';
import type {
  EditorEvents,
  EditorHost,
  FocusOptions,
  TextEditor,
  VimMode,
} from '../../../contracts/editor';
import type { CommandHandler } from '../../../contracts/plugin';
import { createEditorBoxes } from '../../../shared/page/editor-boxes';
import { fakeKitCommandsOf } from '../../../shared/page/layout-host/fake-kit-commands.test-support';
import { noLayoutState } from '../../../shared/page/layout-host/fake-layout-state.test-support';
import {
  USER_LAYOUT,
  withUser,
} from '../../../shared/page/layout-host/test-layouts';
import { NO_FENCES } from '../../../shared/page/markdown-mount.test-support';
import {
  asFake,
  type FakeElement,
  findAll,
  installFakeDom,
} from '../../../shared/page/test-dom';
import { NEEDS_YOU_ACTIVITY, type RowActivity } from '../../sessions/contract';
import type { AudioPickerBody } from '../contract';
import type { AudioPickerScopeName } from '../ids';
import defaultLayout from '../layouts/default/layout.js';
import type { AudioPickerLayout, CandidateRowInput } from '../layouts/layout';
import { audioPickerManifest } from '../manifest';
import { PICKER_BOX_IDENTITY, type PickerBox } from './layout/picker-kit';
import { pickerCommandHandlers } from './picker-commands';
import {
  apply,
  initialState,
  type OpenPicker,
  type PickerAction,
} from './picker-state';
import { createPickerStore } from './picker-store';
import { mountPickerPopups, pickerInputs } from './picker-view';
import { presentedPicker } from './test-pickers';

const INSERT: VimMode = { mode: 'insert', subMode: '' };

// One editor the fake host made: the text it mounted with, its events, the
// options of each focus it took, and whether it was destroyed.
interface CreatedEditor {
  editor: TextEditor;
  doc: string;
  events: EditorEvents;
  focuses: (FocusOptions | undefined)[];
  isDestroyed: boolean;
}

// An editor host recording every editor it makes in `created` and the editor
// focused last in `focused`; a focus at the text's end enters insert mode, as
// the real editor's does.
function fakeHost(
  created: CreatedEditor[],
  focused: { editor: TextEditor | null },
): EditorHost {
  return {
    create: (_parent, doc, events) => {
      let text = doc;
      const focuses: (FocusOptions | undefined)[] = [];
      const editor: TextEditor = {
        text: () => text,
        setText: (value) => {
          text = value;
        },
        insert: () => undefined,
        charBeforeCursor: () => '',
        focus: (options) => {
          focuses.push(options);
          if (options?.insertAtEnd === true) {
            events.modeChanged(INSERT);
          }
          focused.editor = editor;
          events.focused();
        },
        blur: () => events.blurred(),
        destroy: () => {
          made.isDestroyed = true;
        },
      };
      const made: CreatedEditor = {
        editor,
        doc,
        events,
        focuses,
        isDestroyed: false,
      };
      created.push(made);
      return editor;
    },
    createDocument: () => {
      throw new Error('not used by the audio picker');
    },
    contains: () => false,
    takesChordKey: () => false,
    typeInto: () => {},
    onPendingKeys: () => ({ dispose: () => {} }),
    cancelPendingKeys: () => {},
    setKeymap: () => {},
  };
}

// The parts that draw the picker's own rows; the cancel prompt's two parts
// draw apart from them.
type PartName = Exclude<keyof AudioPickerLayout, 'confirmBody' | 'dialogFrame'>;
type PartCounts = Record<PartName, number>;

type PickerCommand = keyof ReturnType<typeof pickerCommandHandlers>;

function noDraws(): PartCounts {
  return { head: 0, moment: 0, candidate: 0, none: 0, notes: 0 };
}

// The default layout's every part, each draw counted in `counts`.
function countingLayout(counts: PartCounts): AudioPickerLayout {
  return {
    head: (parent, input, kit) => {
      counts.head += 1;
      return defaultLayout.head(parent, input, kit);
    },
    moment: (parent, input, kit) => {
      counts.moment += 1;
      return defaultLayout.moment(parent, input, kit);
    },
    candidate: (parent, input, kit) => {
      counts.candidate += 1;
      return defaultLayout.candidate(parent, input, kit);
    },
    none: (parent, input, kit) => {
      counts.none += 1;
      return defaultLayout.none(parent, input, kit);
    },
    notes: (parent, input, kit) => {
      counts.notes += 1;
      return defaultLayout.notes(parent, input, kit);
    },
  };
}

// Picker p1 of the two-moment fixture, from `draft` when given, open in its
// session's popup; the fake `addPopup` runs the popup's `shown` inside the call
// and reports it visible. `activeSessionId` is the session sessions focuses,
// p1's unless given. The boxes and commands are wired as the page wires them.
// `surface` holds every setScope, resize target and focus target call in
// order, `added` each popup added, `disposed` each popup's session as it goes,
// `activities` every row activity set, `ran` every command a click ran, and
// `created` every editor the boxes made.
function pickerPopupSetup(
  parts: { draft?: AudioPickerBody | null; activeSessionId?: string } = {},
) {
  const presented = presentedPicker('p1', { draft: parts.draft ?? null });
  const store = createPickerStore(
    initialState([presented], parts.activeSessionId ?? presented.sessionId),
  );
  const logs: string[] = [];
  const log = (message: string) => logs.push(message);
  const created: CreatedEditor[] = [];
  const focused: { editor: TextEditor | null } = { editor: null };
  const boxes = createEditorBoxes(
    fakeHost(created, focused),
    {
      changed: (box, value) =>
        store.dispatch({
          type: 'setNote',
          formId: box.formId,
          moment: box.moment,
          value,
        }),
      activated: (box) =>
        store.dispatch({
          type: 'showMoment',
          formId: box.formId,
          moment: box.moment,
        }),
    },
    log,
    PICKER_BOX_IDENTITY,
  );
  const surface: [string, unknown][] = [];
  const added: {
    sessionId: string;
    id: string;
    title: string;
    icon: string;
  }[] = [];
  const popups = new Map<string, FakeElement>();
  const disposed: string[] = [];
  const activities: [string, string, RowActivity | null][] = [];
  const overlay: FakeElement[] = [];
  const ran: [CommandId, CommandArg | undefined][] = [];
  const runCommand = (id: CommandId, arg: CommandArg | undefined) => {
    ran.push([id, arg]);
    const short = id.slice('audio-picker.'.length) as PickerCommand;
    void (handlers[short] as CommandHandler)({ arg });
  };
  const view = mountPickerPopups({
    areas: {
      overlay: {
        contribute: (node) => {
          overlay.push(asFake(node));
          return { dispose: () => undefined };
        },
      },
    },
    sessions: {
      addPopup: (sessionId, popup) => {
        added.push({
          sessionId,
          id: popup.id,
          title: popup.title,
          icon: popup.icon,
        });
        popups.set(sessionId, asFake(popup.element));
        popup.shown();
        return {
          setStatus: () => undefined,
          open: () => undefined,
          hide: () => undefined,
          isVisible: () => true,
          dispose: () => disposed.push(sessionId),
        };
      },
      setActivity: (sessionId, sourceId, activity) =>
        activities.push([sessionId, sourceId, activity]),
      addRowPart: () => ({ dispose: () => undefined }),
    },
    closesAtOnce: () => false,
    beforeClose: () => true,
    setScope: (scope) => surface.push(['scope', scope]),
    setResizeTarget: (target) => surface.push(['resize', target]),
    setFocusTarget: (target) => surface.push(['focus', target]),
    pushConfirmScope: () => ({
      pop: () => undefined,
      dispose: () => undefined,
      onBaseChanged: () => ({ dispose: () => undefined }),
    }),
    store,
    boxes,
    markdown: {
      block: (text) => text,
      inline: (text) => text,
      document: async (text) => text,
      ...NO_FENCES,
    },
    keys: {
      anchor: () => ({ dispose: () => undefined }),
      keysFor: () => null,
    },
    run: (command) => runCommand(command, undefined),
    commands: fakeKitCommandsOf(audioPickerManifest, runCommand),
    platform: 'macos',
    state: noLayoutState,
    log,
    savedPlaces: new Map(),
  });
  const handlers = pickerCommandHandlers({
    store,
    boxes,
    audio: { toggle: () => undefined },
    finish: () => Promise.resolve(),
    scrollPicker: () => null,
    openPreview: () => Promise.resolve(),
    toast: () => undefined,
    log,
  });
  const popup = popups.get(presented.sessionId);
  if (popup === undefined) {
    throw new Error('the picker mounted no popup for p1');
  }
  return {
    view,
    store,
    boxes,
    handlers,
    popup,
    // The areas' overlay contributions, the cancel prompt's scrim first.
    overlay,
    surface,
    added,
    disposed,
    activities,
    ran,
    created,
    // The editor focused last, with what it mounted with.
    focusedEntry: (): CreatedEditor => {
      const entry = created.find((made) => made.editor === focused.editor);
      if (entry === undefined) {
        throw new Error('no editor has had focus');
      }
      return entry;
    },
  };
}

type Setup = ReturnType<typeof pickerPopupSetup>;

const MOMENT_1_BOX: PickerBox = { formId: 'p1', moment: 0 };

function footerButtons(popup: FakeElement): FakeElement[] {
  const [footer] = findAll(popup, 'audio-picker-footer');
  return footer.children;
}

function isDisabled(button: FakeElement): boolean {
  return (button as unknown as { disabled: boolean }).disabled;
}

// Candidate row `row` of `moment` in the two-moment fixture, loading, off the
// cursor, neither chosen, recommended nor playing, unless `overrides` says.
function candidateRow(
  moment: number,
  row: number,
  name: string,
  overrides: Partial<CandidateRowInput> = {},
): CandidateRowInput {
  return {
    moment,
    row,
    number: row + 1,
    name,
    library: `${name} library`,
    play: 'one-shot',
    fileCount: 1,
    pitch: null,
    loudnessLufs: null,
    durationSeconds: null,
    load: 'loading',
    error: null,
    isPlaying: false,
    isCursor: false,
    isChosen: false,
    isRecommended: false,
    ...overrides,
  };
}

describe('pickerInputs', () => {
  it('pickerInputs_Picker_BuildsEveryPartsInput', () => {
    const draft = {
      answers: [
        { choice: 0, note: '' },
        { choice: 1, note: '' },
      ],
    };
    const actions: PickerAction[] = [
      {
        type: 'placeRestored',
        formId: 'p1',
        place: { moment: 1, row: 1, view: 'list' },
      },
      {
        type: 'candidateLoaded',
        formId: 'p1',
        moment: 1,
        candidate: 0,
        peaks: [0.5],
        durationSeconds: 1.5,
      },
      { type: 'playStarted', formId: 'p1', moment: 1, candidate: 0 },
    ];
    const state = actions.reduce(
      apply,
      initialState([presentedPicker('p1', { draft })], 'p1-session'),
    );

    const inputs = pickerInputs(state.forms[0] as OpenPicker);

    expect(inputs).toEqual({
      head: {
        heading: 'Pick the menu sounds',
        overview: 'Two moments of the menu.',
        moments: 2,
        onRecommendation: 1,
        noneOfThese: 1,
        saveLabel: 'Saved',
      },
      moments: [
        {
          moment: {
            moment: 0,
            number: 1,
            title: 'Button press',
            reason: 'Button press reason',
            isCursor: false,
          },
          candidates: [
            candidateRow(0, 0, 'Soft chime'),
            candidateRow(0, 1, 'Bright chime', { isRecommended: true }),
          ],
          none: {
            moment: 0,
            row: 2,
            number: 3,
            isCursor: false,
            isChosen: true,
          },
          notes: { moment: 0, number: 1, isNone: true },
        },
        {
          moment: {
            moment: 1,
            number: 2,
            title: 'Panel close',
            reason: 'Panel close reason',
            isCursor: true,
          },
          candidates: [
            candidateRow(1, 0, 'Low thud', {
              durationSeconds: 1.5,
              load: 'ready',
              isPlaying: true,
              isChosen: true,
              isRecommended: true,
            }),
            candidateRow(1, 1, 'Mid thud', { isCursor: true }),
            candidateRow(1, 2, 'High thud'),
          ],
          none: {
            moment: 1,
            row: 3,
            number: 4,
            isCursor: false,
            isChosen: false,
          },
          notes: { moment: 1, number: 2, isNone: false },
        },
      ],
    });
  });
});

describe('mountPickerPopups', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('mountPickerPopups_PickerShownAndClosed_AddsAndRemovesThePopupAndActivity', () => {
    const h = pickerPopupSetup();

    h.store.dispatch({ type: 'formClosed', formId: 'p1' });

    expect(h.added).toEqual([
      {
        sessionId: 'p1-session',
        id: 'audio-picker',
        title: 'Audio picker',
        icon: 'unmute',
      },
    ]);
    expect(h.disposed).toEqual(['p1-session']);
    expect(h.activities).toEqual([
      ['p1-session', 'audio-picker', NEEDS_YOU_ACTIVITY],
      ['p1-session', 'audio-picker', null],
    ]);
  });

  it.each<[string, PickerAction[], PartCounts]>([
    [
      'nextRow from the first row',
      [{ type: 'firstRow' }],
      { head: 0, moment: 0, candidate: 2, none: 0, notes: 0 },
    ],
    [
      "nextRow onto moment 1's None row",
      [],
      { head: 0, moment: 0, candidate: 1, none: 1, notes: 0 },
    ],
  ])(
    'mountPickerPopups_CursorMove_RedrawsOnlyTheTwoRows: %s',
    (_name, before, counts) => {
      const h = pickerPopupSetup();
      const drawn = noDraws();
      h.view.setLayouts(
        withUser<AudioPickerLayout>(defaultLayout, countingLayout(drawn)),
      );
      for (const action of before) {
        h.store.dispatch(action);
      }
      Object.assign(drawn, noDraws());

      h.store.dispatch({ type: 'nextRow' });

      expect(drawn).toEqual(counts);
    },
  );

  it('setLayouts_ChangedLayout_RedrawsTheCancelConfirmBodyAndFrame', () => {
    const h = pickerPopupSetup();
    const [prompt] = h.overlay;

    h.view.setLayouts(
      withUser<AudioPickerLayout>(defaultLayout, {
        dialogFrame: (parent, input, kit) =>
          defaultLayout.dialogFrame(parent, input, kit),
        confirmBody: (parent, input, kit) =>
          defaultLayout.confirmBody(parent, input, kit),
      }),
    );

    const [panel] = findAll(prompt, 'ui-dialog');
    const [body] = findAll(prompt, 'ui-dialog-body');
    expect({
      panel: panel.dataset.layout,
      bodyRoot: body.children[0].dataset.layout,
      buttons: findAll(panel, 'ui-button').length,
      panels: findAll(prompt, 'ui-dialog').length,
    }).toEqual({
      panel: USER_LAYOUT,
      bodyRoot: USER_LAYOUT,
      buttons: 2,
      panels: 1,
    });
  });

  it('mountPickerPopups_NotesRedraw_KeepsTheFocusedBox', () => {
    const h = pickerPopupSetup();
    h.boxes.focus(MOMENT_1_BOX);
    const typing = h.focusedEntry();
    typing.events.modeChanged(INSERT);
    typing.editor.setText('quiet');
    typing.events.changed('quiet');
    const editorsBefore = h.created.length;

    void (h.handlers.choose as CommandHandler)({
      arg: 3,
      editor: typing.editor,
    });

    const refocused = h.focusedEntry();
    expect(h.created).toHaveLength(editorsBefore);
    expect(refocused.editor).toBe(typing.editor);
    expect(refocused.focuses.at(-1)).toEqual({ insert: true });
    expect(h.boxes.active()).toEqual(MOMENT_1_BOX);
    expect(h.boxes.activeMode()).toEqual(INSERT);
    expect(refocused.editor.text()).toBe('quiet');
  });

  it('mountPickerPopups_CandidateOnlyRedraw_LeavesTheNotesBoxesPlaced', () => {
    const h = pickerPopupSetup();
    const frames = findAll(h.popup, 'audio-picker-notes-box');
    const parents = frames.map((frame) => frame.parentNode);
    const editorsBefore = h.created.length;

    h.view.setLayouts(
      withUser<AudioPickerLayout>(defaultLayout, {
        candidate: (parent, input, kit) =>
          defaultLayout.candidate(parent, input, kit),
      }),
    );

    expect(h.created).toHaveLength(editorsBefore);
    expect(h.created.filter((made) => made.isDestroyed)).toEqual([]);
    expect(frames).toHaveLength(2);
    for (const [index, frame] of frames.entries()) {
      expect(frame.parentNode).toBe(parents[index]);
    }
  });

  it.each<[string, AudioPickerBody | null, (h: Setup) => unknown, unknown]>([
    [
      "a draft's note on moment 1",
      {
        answers: [
          { choice: 2, note: 'x' },
          { choice: 1, note: '' },
        ],
      },
      (h) => h.created.map((made) => made.doc),
      ['x', ''],
    ],
    [
      'a send started',
      null,
      (h) => {
        h.store.dispatch({
          type: 'sendStarted',
          formId: 'p1',
          kind: 'submitted',
        });
        return footerButtons(h.popup).map(isDisabled);
      },
      [true, true],
    ],
    [
      'a focused box whose picker closes',
      null,
      (h) => {
        const leave = vi.spyOn(h.boxes, 'leave');
        h.boxes.focus(MOMENT_1_BOX);
        h.store.dispatch({ type: 'formClosed', formId: 'p1' });
        return leave.mock.calls.length;
      },
      1,
    ],
    [
      'a focused box under the cancel prompt',
      null,
      (h) => {
        const leave = vi.spyOn(h.boxes, 'leave');
        h.boxes.focus(MOMENT_1_BOX);
        h.store.dispatch({ type: 'openCancelPrompt' });
        return leave.mock.calls.length;
      },
      1,
    ],
  ])(
    'mountPickerPopups_Lifecycle_FollowsThePicker: %s',
    (_name, draft, act, expected) => {
      const h = pickerPopupSetup({ draft });

      const observed = act(h);

      expect(observed).toEqual(expected);
    },
  );

  it('mountPickerPopups_Rows_CarryCursorChosenAndClick', () => {
    const h = pickerPopupSetup();
    // Moment 1: rows 0 to 2; moment 2: rows 3 to 6, its None row last.
    const rows = findAll(h.popup, 'audio-picker-row');
    const indexes = (className: string) =>
      findAll(h.popup, className).map((node) => rows.indexOf(node));
    const cursorRows = indexes('is-cursor');
    const chosenRows = indexes('is-selected');

    rows[5].click();

    expect(rows).toHaveLength(7);
    expect(cursorRows).toEqual([1]);
    expect(chosenRows).toEqual([1, 3]);
    expect(h.ran).toEqual([['audio-picker.selectRow', { moment: 1, row: 2 }]]);
  });

  it.each<[string, string, PickerAction[], AudioPickerScopeName]>([
    ['a picker in the list', 'p1-session', [], 'list'],
    [
      'under the cancel prompt',
      'p1-session',
      [{ type: 'openCancelPrompt' }],
      'confirm',
    ],
    ['no active picker', 'other-session', [], 'idle'],
  ])(
    'mountPickerPopups_Shown_SetsTheScopeOfTheView: %s',
    (_name, activeSessionId, actions, scope) => {
      const h = pickerPopupSetup({ activeSessionId });

      for (const action of actions) {
        h.store.dispatch(action);
      }

      expect(h.surface.slice(-3)).toEqual([
        ['scope', scope],
        ['resize', null],
        ['focus', null],
      ]);
    },
  );
});
