import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LoginStartStatus } from '../../../contracts/login-start';
import type {
  EditorChoices,
  RunHistoryEntry,
  RunOutcome,
  ScheduledTask,
  ScheduledTaskView,
  SchedulingState,
} from '../contract';
import {
  DISCARD_BODY,
  confirmBody,
  draftOf,
  emptyReason,
  emptySchedulingState,
  historyRowInput,
  initialSchedulesState,
  newTaskEditor,
  notices,
  type SchedulesAction,
  type SchedulesState,
  schedulesReducer,
  type TaskEditor,
  taskEditor,
  taskRowInput,
} from './schedules-state';

// Local times read in New York, so `Next <when>` is the same on every machine.
let savedTimeZone: string | undefined;
beforeAll(() => {
  savedTimeZone = process.env.TZ;
  process.env.TZ = 'America/New_York';
});
afterAll(() => {
  if (savedTimeZone === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = savedTimeZone;
  }
});

const CHOICES: EditorChoices = {
  profiles: ['main', 'personal'],
  projects: ['games'],
  controls: [
    {
      id: 'model',
      label: 'Model',
      choices: [
        { value: 'opus', label: 'Opus' },
        { value: 'sonnet', label: 'Sonnet' },
      ],
      value: '',
    },
  ],
};

function task(changes: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: 'aaaa1111',
    name: 'Nightly',
    target: { projectDir: '~/dev/app' },
    profile: 'main',
    prompt: 'Run the checks.',
    schedule: { kind: 'daily', time: '09:00' },
    controls: {},
    paused: false,
    updatedAt: 0,
    ...changes,
  };
}

function view(
  changes: Partial<ScheduledTask> = {},
  rest: Partial<Omit<ScheduledTaskView, 'task'>> = {},
): ScheduledTaskView {
  return { task: task(changes), nextRun: null, history: [], ...rest };
}

function scheduling(changes: Partial<SchedulingState> = {}): SchedulingState {
  return { ...emptySchedulingState(), ...changes };
}

function reduce(
  actions: readonly SchedulesAction[],
  from: SchedulesState = initialSchedulesState(),
): SchedulesState {
  return actions.reduce(schedulesReducer, from);
}

// A new task's editor with every row filled so `draftOf` takes it.
function validEditor(): TaskEditor {
  return reduce([
    { type: 'editorOpened', editor: newTaskEditor(CHOICES, 'list') },
    { type: 'fieldChanged', field: 'name', value: ' Nightly ' },
    { type: 'fieldChanged', field: 'project', value: '~/dev/app' },
    { type: 'fieldChanged', field: 'prompt', value: 'Run the checks.' },
  ]).editor!;
}

function edited(field: string, value: string): TaskEditor {
  const state = reduce([{ type: 'fieldChanged', field, value }], {
    ...initialSchedulesState(),
    editor: validEditor(),
  });
  return state.editor!;
}

describe('draftOf', () => {
  it.each<{ name: string; editor: () => TaskEditor; expected: unknown }>([
    {
      name: 'name empty',
      editor: () => edited('name', '  '),
      expected: 'Name is empty.',
    },
    {
      name: 'project empty',
      editor: () => edited('project', ''),
      expected: 'Project is empty.',
    },
    {
      name: 'project neither',
      editor: () => edited('project', 'dev/app'),
      expected: 'dev/app is not a folder path or a pool project.',
    },
    {
      name: 'profile not offered',
      editor: () => edited('profile', 'gone'),
      expected: 'Choose a profile.',
    },
    {
      name: 'schedule refused',
      editor: () => edited('time', '9am'),
      expected: expect.stringContaining('time'),
    },
    {
      name: 'prompt empty',
      editor: () => edited('prompt', ''),
      expected: 'Prompt is empty.',
    },
    {
      name: 'name and project empty: the first wins',
      editor: () =>
        reduce([{ type: 'fieldChanged', field: 'project', value: '' }], {
          ...initialSchedulesState(),
          editor: edited('name', ''),
        }).editor!,
      expected: 'Name is empty.',
    },
  ])('draftOf_RowRefused_GivesItsReason: $name', ({ editor, expected }) => {
    expect(draftOf(editor())).toEqual(expected);
  });

  it.each<{ name: string; editor: () => TaskEditor; expected: object }>([
    {
      name: 'folder',
      editor: validEditor,
      expected: { target: { projectDir: '~/dev/app' }, name: 'Nightly' },
    },
    {
      name: 'pool project',
      editor: () => edited('project', 'games'),
      expected: { target: { project: 'games' } },
    },
    {
      name: 'control at Default',
      editor: validEditor,
      expected: { controls: {} },
    },
    {
      name: 'control picked',
      editor: () => edited('control:model', 'sonnet'),
      expected: { controls: { model: 'sonnet' } },
    },
    {
      name: 'new task',
      editor: validEditor,
      expected: {
        id: null,
        paused: false,
        profile: 'main',
        prompt: 'Run the checks.',
        schedule: { kind: 'daily', time: '09:00' },
      },
    },
  ])('draftOf_ValidRows_GivesTheDraft: $name', ({ editor, expected }) => {
    expect(draftOf(editor())).toMatchObject(expected);
  });

  it('draftOf_EditedTask_KeepsItsIdAndPaused', () => {
    const editor = taskEditor(
      view({ id: 'bbbb2222', paused: true }),
      CHOICES,
      'detail',
    );

    expect(draftOf(editor)).toMatchObject({ id: 'bbbb2222', paused: true });
  });
});

describe('newTaskEditor', () => {
  it('newTaskEditor_Choices_StartsFromThePinnedValues', () => {
    const editor = newTaskEditor(CHOICES, 'list');

    expect(editor.fields).toEqual({
      name: '',
      project: '',
      profile: 'main',
      schedule: {
        kind: 'daily',
        minute: '',
        time: '09:00',
        day: 0,
        at: '',
        line: '',
      },
      controls: { model: '' },
      prompt: '',
    });
  });
});

describe('the editor across a state change', () => {
  it('stateChanged_EditorOpen_KeepsTheChangedDraft', () => {
    const before = reduce([
      { type: 'editorOpened', editor: newTaskEditor(CHOICES, 'list') },
      { type: 'fieldChanged', field: 'name', value: 'Draft' },
    ]);

    const after = reduce(
      [{ type: 'stateChanged', scheduling: scheduling({ tasks: [view()] }) }],
      before,
    );

    expect(after.editor).toEqual(before.editor);
  });
});

describe('cancel', () => {
  it.each<{
    name: string;
    changes: SchedulesAction[];
    editor: boolean;
    confirm: string | null;
  }>([
    {
      name: 'changed draft asks the confirm',
      changes: [{ type: 'fieldChanged', field: 'name', value: 'x' }],
      editor: true,
      confirm: DISCARD_BODY,
    },
    {
      name: 'unchanged draft closes',
      changes: [],
      editor: false,
      confirm: null,
    },
  ])('cancel_Draft_ClosesOrAsks: $name', ({ changes, editor, confirm }) => {
    const state = reduce([
      { type: 'editorOpened', editor: newTaskEditor(CHOICES, 'list') },
      ...changes,
      { type: 'cancel' },
    ]);

    expect(state.editor !== null).toBe(editor);
    expect(state.confirm === null ? null : confirmBody(state.confirm)).toBe(
      confirm,
    );
  });
});

describe('list rows', () => {
  // 2026-11-20 14:30 in New York.
  const NEXT = Date.UTC(2026, 10, 20, 19, 30);

  it.each<{
    name: string;
    row: ScheduledTaskView;
    fires: boolean;
    next: string;
  }>([
    {
      name: 'paused',
      row: view({ paused: true }, { nextRun: NEXT }),
      fires: true,
      next: 'Paused',
    },
    {
      name: 'next run',
      row: view({}, { nextRun: NEXT }),
      fires: true,
      next: 'Next 2026-11-20 14:30',
    },
    {
      name: 'no next run',
      row: view({}, { nextRun: null }),
      fires: true,
      next: 'No next run',
    },
    {
      name: 'never fires',
      row: view({}, { nextRun: NEXT }),
      fires: false,
      next: '',
    },
  ])('taskRowInput_Task_ShowsItsNext: $name', ({ row, fires, next }) => {
    expect(taskRowInput(row, fires)).toEqual({
      name: 'Nightly',
      scheduleText: 'Daily at 09:00',
      next,
      paused: row.task.paused,
    });
  });
});

describe('history rows', () => {
  const entry = (
    outcome: RunOutcome,
    changes: Partial<RunHistoryEntry> = {},
  ): RunHistoryEntry => ({
    taskId: 'aaaa1111',
    occurrence: Date.UTC(2026, 10, 20, 19, 30),
    at: Date.UTC(2026, 10, 20, 19, 30),
    outcome,
    reason: null,
    rowId: null,
    processId: null,
    viewed: false,
    ...changes,
  });

  it.each<{ outcome: RunOutcome; reason: string | null; text: string }>([
    { outcome: 'running', reason: null, text: 'Running' },
    { outcome: 'finished', reason: null, text: 'Finished' },
    {
      outcome: 'skipped',
      reason: null,
      text: 'Skipped, previous run still going',
    },
    {
      outcome: 'failed',
      reason: 'no such profile',
      text: 'Failed to start: no such profile',
    },
  ])(
    'historyRowInput_Outcome_GivesItsText: $outcome',
    ({ outcome, reason, text }) => {
      expect(historyRowInput(entry(outcome, { reason }), [])).toMatchObject({
        when: '2026-11-20 14:30',
        text,
      });
    },
  );

  it.each<{ name: string; rowId: string | null; linked: boolean }>([
    { name: 'row open', rowId: 's1', linked: true },
    { name: 'row closed', rowId: 's2', linked: false },
    { name: 'no row', rowId: null, linked: false },
  ])('historyRowInput_RunRow_LinksWhileOpen: $name', ({ rowId, linked }) => {
    expect(historyRowInput(entry('finished', { rowId }), ['s1']).linked).toBe(
      linked,
    );
  });
});

describe('notices', () => {
  const login = (
    state: LoginStartStatus['state'],
    detail: string | null,
  ): LoginStartStatus => ({ state, detail });

  it.each<{
    name: string;
    state: Partial<SchedulingState>;
    expected: string[];
  }>([
    { name: 'none', state: {}, expected: [] },
    {
      name: 'dev and file error, in order',
      state: { fires: false, fileError: 'line 3: bad JSON' },
      expected: [
        'neutral: This dev app shows and edits tasks but never runs them. The installed app runs them.',
        'error: scheduled-tasks.json has an error, so the list shows the last good tasks: line 3: bad JSON',
      ],
    },
    {
      name: 'needs approval',
      state: { loginStart: login('needsApproval', 'open System Settings') },
      expected: [
        'warning: Tasks run after a restart once you allow Auri in Login Items: open System Settings',
      ],
    },
    {
      name: 'needs approval, no detail',
      state: { loginStart: login('needsApproval', null) },
      expected: [
        'warning: Tasks run after a restart once you allow Auri in Login Items.',
      ],
    },
    {
      name: 'off with a detail',
      state: { loginStart: login('off', 'launchctl failed') },
      expected: ['error: Login start failed: launchctl failed'],
    },
    {
      name: 'off, no detail',
      state: { loginStart: login('off', null) },
      expected: [],
    },
    {
      name: 'unsupported',
      state: { loginStart: login('unsupported', null) },
      expected: [
        'neutral: Tasks do not run after a restart until the app opens.',
      ],
    },
    { name: 'on', state: { loginStart: login('on', null) }, expected: [] },
  ])('notices_State_GivesTheLines: $name', ({ state, expected }) => {
    expect(
      notices(scheduling(state)).map((line) => `${line.tone}: ${line.text}`),
    ).toEqual(expected);
  });
});

describe('selection', () => {
  const A = view({ id: 'aaaa1111', name: 'A' });
  const B = view({ id: 'bbbb2222', name: 'B' });
  const C = view({ id: 'cccc3333', name: 'C' });

  const shown = (tasks: ScheduledTaskView[], from?: SchedulesState) =>
    reduce([{ type: 'stateChanged', scheduling: scheduling({ tasks }) }], from);

  it('stateChanged_FirstTasks_SelectsTheFirstTask', () => {
    expect(shown([A, B]).selectedId).toBe('aaaa1111');
  });

  it.each<{
    name: string;
    before: string | null;
    tasks: ScheduledTaskView[];
    after: string | null;
  }>([
    { name: 'kept', before: 'bbbb2222', tasks: [A, B, C], after: 'bbbb2222' },
    {
      name: 'dropped: the row at its index',
      before: 'bbbb2222',
      tasks: [A, C],
      after: 'cccc3333',
    },
    {
      name: 'dropped last: the "+ New task" row',
      before: 'aaaa1111',
      tasks: [],
      after: null,
    },
  ])(
    'stateChanged_Selected_KeepsOrMoves: $name',
    ({ before, tasks, after }) => {
      const selected = reduce(
        [{ type: 'select', id: before }],
        shown([A, B, C]),
      );

      expect(shown(tasks, selected).selectedId).toBe(after);
    },
  );

  it.each<{ name: string; isOpening: boolean; cursor: number }>([
    { name: 'opened from the list: back to the newest run', isOpening: true, cursor: 0 },
    { name: 'any other focus move: keeps the cursor', isOpening: false, cursor: 1 },
  ])('focus_DetailWithHistoryCursor: $name', ({ isOpening, cursor }) => {
    const runs = view(
      {},
      {
        history: [
          { taskId: 'aaaa1111', occurrence: 2, at: 2, outcome: 'finished', reason: null, rowId: null, processId: null, viewed: true },
          { taskId: 'aaaa1111', occurrence: 1, at: 1, outcome: 'finished', reason: null, rowId: null, processId: null, viewed: true },
        ],
      },
    );
    const state = reduce(
      [
        { type: 'focus', focus: 'detail', isOpening: true },
        { type: 'historyMove', to: 'down' },
        { type: 'focus', focus: 'list' },
        { type: 'focus', focus: 'detail', isOpening },
      ],
      shown([runs]),
    );

    expect(state.historyCursor).toBe(cursor);
  });

  it('emptyReason_NewTaskRowWithTasks_IsNewTask', () => {
    const state = reduce([{ type: 'select', id: null }], shown([A, B]));

    expect(emptyReason(state)).toBe('newTask');
  });
});
