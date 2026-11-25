import type {
  EditorChoices,
  RunHistoryEntry,
  RunOutcome,
  ScheduledTaskView,
  SchedulingState,
  TaskDraft,
} from '../contract';
import type {
  EmptyInput,
  FieldRowInput,
  HistoryRowInput,
  NoticeInput,
  TaskDetailInput,
  TaskRowInput,
} from '../layouts/layout';
import { scheduleText } from '../schedule';
import {
  fieldsOf,
  type ScheduleFields,
  type ScheduleKind,
  scheduleOf,
} from './schedule-fields';

export const NEW_TASK_LABEL = '+ New task';
// The `selectTask` argument naming the "+ New task" row; a task id is 8 hex characters.
export const NEW_TASK_ROW_ARG = 'new';
export const DISCARD_TITLE = 'Discard the changes?';
export const DISCARD_BODY = 'Discard the changes to this task?';
export const REMOVE_TITLE = 'Remove the task?';
export const UNSAVED_REASON = 'The task editor has unsaved changes.';
export const ENV_NOTE =
  "A run gets only the app's own environment variables and PATH. Put any other variable in the profile's settings env.";
export const DEFAULT_CHOICE = 'Default';

const NEW_TASK_TIME = '09:00';

// The pane holding the keys: the side bar's list, the details, or the editor in their place.
export type SchedulesFocus = 'list' | 'detail' | 'editor';

// The editor's rows as text: `profile` a profile name, `controls` each harness control's value by id, `''` for
// Default, `attended` `true` or `false`.
export interface EditorFields {
  name: string;
  project: string;
  profile: string;
  schedule: ScheduleFields;
  controls: Readonly<Record<string, string>>;
  attended: string;
  prompt: string;
}

// An open editor: `taskId` and `paused` the edited task's (null and false for a new task), `initial` the fields it
// opened with, `cursor` the field row the page keys act on, `problem` why the last save was refused, `opener` the
// pane focus goes back to when it closes.
export interface TaskEditor {
  kind: 'create' | 'edit';
  taskId: string | null;
  taskName: string;
  paused: boolean;
  choices: EditorChoices;
  fields: EditorFields;
  initial: EditorFields;
  cursor: number;
  problem: string | null;
  opener: 'list' | 'detail';
}

// The confirm the page asks: removing the task `taskId` names, or discarding the editor's changes.
export type SchedulesConfirm =
  | { kind: 'remove'; taskId: string; name: string }
  | { kind: 'discard' };

// `selectedId` is the selected task's id, null on the "+ New task" row; `isFirstSelection` holds until a row is
// selected by a key, a click or the first state holding tasks, which selects the first task. `historyCursor` indexes
// the selected task's history, newest first.
export interface SchedulesState {
  scheduling: SchedulingState;
  selectedId: string | null;
  isFirstSelection: boolean;
  focus: SchedulesFocus;
  historyCursor: number;
  editor: TaskEditor | null;
  confirm: SchedulesConfirm | null;
}

export type Move = 'down' | 'up' | 'top' | 'bottom';

export type SchedulesAction =
  | { type: 'stateChanged'; scheduling: SchedulingState }
  | { type: 'move'; to: Move }
  | { type: 'select'; id: string | null }
  | { type: 'focus'; focus: SchedulesFocus; isOpening?: boolean }
  | { type: 'historyMove'; to: Move }
  | { type: 'editorOpened'; editor: TaskEditor }
  | { type: 'fieldChanged'; field: string; value: string }
  | { type: 'fieldMove'; by: 1 | -1 }
  | { type: 'fieldCursor'; field: string }
  | { type: 'problem'; problem: string | null }
  | { type: 'saved'; id: string }
  | { type: 'cancel' }
  | { type: 'editorClosed' }
  | { type: 'confirmAsked'; confirm: SchedulesConfirm }
  | { type: 'confirmClosed' };

// One row of the side bar's list: the "+ New task" row, then one per task in file order.
export type ListRow =
  | { kind: 'new' }
  | { kind: 'task'; view: ScheduledTaskView };

// One editor row as the layout draws it, with the picker's choices on a choice row (null on a box row).
export interface EditorRow extends FieldRowInput {
  choices: readonly { label: string; value: string }[] | null;
}

const SCHEDULE_KINDS: readonly { value: ScheduleKind; label: string }[] = [
  { value: 'hourly', label: 'Hourly' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'once', label: 'Once' },
  { value: 'cron', label: 'Cron' },
];

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

const CONTROL_FIELD = 'control:';

const ATTENDED_CHOICES: readonly { label: string; value: string }[] = [
  { label: 'No', value: 'false' },
  { label: 'Yes', value: 'true' },
];

export function emptySchedulingState(): SchedulingState {
  return {
    tasks: [],
    fileError: null,
    fires: true,
    loginStart: null,
    runRows: [],
    unviewedRows: [],
  };
}

export function initialSchedulesState(): SchedulesState {
  return {
    scheduling: emptySchedulingState(),
    selectedId: null,
    isFirstSelection: true,
    focus: 'list',
    historyCursor: 0,
    editor: null,
    confirm: null,
  };
}

export function schedulesReducer(
  state: SchedulesState,
  action: SchedulesAction,
): SchedulesState {
  switch (action.type) {
    case 'stateChanged':
      return withScheduling(state, action.scheduling);
    case 'move':
      return selected(state, rowIdAt(state, moveIndex(state, action.to)));
    case 'select':
      return selected(state, action.id);
    case 'focus':
      return {
        ...state,
        focus: action.focus,
        // The history cursor starts at the newest run only when the details open from the list; any other focus
        // move into them keeps it.
        historyCursor:
          action.focus === 'detail' && action.isOpening === true
            ? 0
            : state.historyCursor,
      };
    case 'historyMove':
      return { ...state, historyCursor: historyIndex(state, action.to) };
    case 'editorOpened':
      return { ...state, editor: action.editor, focus: 'editor' };
    case 'fieldChanged':
      return withEditor(state, (editor) =>
        withRowsCursor({
          ...editor,
          fields: fieldsWith(editor.fields, action.field, action.value),
        }),
      );
    case 'fieldMove':
      return withEditor(state, (editor) =>
        withRowsCursor({ ...editor, cursor: editor.cursor + action.by }),
      );
    case 'fieldCursor':
      return withEditor(state, (editor) => {
        const index = editorRows(editor).findIndex(
          (row) => row.field === action.field,
        );
        return index < 0 ? editor : { ...editor, cursor: index };
      });
    case 'problem':
      return withEditor(state, (editor) => ({
        ...editor,
        problem: action.problem,
      }));
    case 'saved':
      return {
        ...closedEditor(state),
        selectedId: action.id,
        isFirstSelection: false,
      };
    case 'cancel':
      if (state.editor === null) {
        return state;
      }
      return isEditorChanged(state.editor)
        ? { ...state, confirm: { kind: 'discard' } }
        : closedEditor(state);
    case 'editorClosed':
      return closedEditor(state);
    case 'confirmAsked':
      return { ...state, confirm: action.confirm };
    case 'confirmClosed':
      return { ...state, confirm: null };
  }
}

// ── The list ──────────────────────────────────────────────────────────────

export function listRows(scheduling: SchedulingState): ListRow[] {
  return [
    { kind: 'new' },
    ...scheduling.tasks.map((view) => ({ kind: 'task' as const, view })),
  ];
}

export function taskRowInput(
  view: ScheduledTaskView,
  fires: boolean,
): TaskRowInput {
  return {
    name: view.task.name,
    scheduleText: scheduleText(view.task.schedule),
    next: nextRunText(view, fires),
    paused: view.task.paused,
  };
}

// `Paused` while paused; else, where the app fires, `Next <when>` or `No next run`; `''` where it never fires.
export function nextRunText(view: ScheduledTaskView, fires: boolean): string {
  if (view.task.paused) {
    return 'Paused';
  }
  if (!fires) {
    return '';
  }
  return view.nextRun === null
    ? 'No next run'
    : `Next ${localTime(view.nextRun)}`;
}

// Epoch ms as local `YYYY-MM-DD HH:MM`.
export function localTime(ms: number): string {
  const date = new Date(ms);
  const two = (value: number) => String(value).padStart(2, '0');
  return `${String(date.getFullYear())}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

export function selectedView(state: SchedulesState): ScheduledTaskView | null {
  return (
    state.scheduling.tasks.find((view) => view.task.id === state.selectedId) ??
    null
  );
}

// What the details pane draws in place of the details and history: no task at all, or the "+ New task" row selected;
// null while a task is selected.
export function emptyReason(
  state: SchedulesState,
): EmptyInput['reason'] | null {
  if (state.scheduling.tasks.length === 0) {
    return 'noTasks';
  }
  return selectedView(state) === null ? 'newTask' : null;
}

// ── The details ───────────────────────────────────────────────────────────

// The notices over the details, in order.
export function notices(scheduling: SchedulingState): NoticeInput[] {
  const lines: NoticeInput[] = [];
  if (!scheduling.fires) {
    lines.push({
      kind: 'dev',
      text: 'This dev app shows and edits tasks but never runs them. The installed app runs them.',
      tone: 'neutral',
    });
  }
  if (scheduling.fileError !== null) {
    lines.push({
      kind: 'fileError',
      text: `scheduled-tasks.json has an error, so the list shows the last good tasks: ${scheduling.fileError}`,
      tone: 'error',
    });
  }
  const login = loginNotice(scheduling);
  if (login !== null) {
    lines.push(login);
  }
  return lines;
}

function loginNotice(scheduling: SchedulingState): NoticeInput | null {
  const status = scheduling.loginStart;
  if (status === null) {
    return null;
  }
  switch (status.state) {
    case 'needsApproval':
      return {
        kind: 'loginStart',
        text:
          status.detail === null
            ? 'Tasks run after a restart once you allow Auri in Login Items.'
            : `Tasks run after a restart once you allow Auri in Login Items: ${status.detail}`,
        tone: 'warning',
      };
    case 'off':
      return status.detail === null
        ? null
        : {
            kind: 'loginStart',
            text: `Login start failed: ${status.detail}`,
            tone: 'error',
          };
    case 'unsupported':
      return {
        kind: 'loginStart',
        text: 'Tasks do not run after a restart until the app opens.',
        tone: 'neutral',
      };
    case 'on':
      return null;
  }
}

// The selected task's details. `tilde` shows a full path with the home folder as `~`; `choices` labels the controls
// once loaded, else each control row is labelled with its id.
export function taskDetailInput(
  view: ScheduledTaskView,
  fires: boolean,
  choices: EditorChoices | null,
  tilde: (path: string) => string,
): TaskDetailInput {
  const { task } = view;
  const controls = Object.entries(task.controls).map(([id, value]) => {
    const control = choices?.controls.find((known) => known.id === id);
    const choice = control?.choices.find((known) => known.value === value);
    return { label: control?.label ?? id, value: choice?.label ?? value };
  });
  return {
    name: task.name,
    project:
      'projectDir' in task.target
        ? tilde(task.target.projectDir)
        : task.target.project,
    profile: task.profile,
    scheduleText: scheduleText(task.schedule),
    next: nextRunText(view, fires),
    controls,
    prompt: task.prompt,
    paused: task.paused,
    attended: task.attended,
  };
}

const OUTCOME_TEXTS: Record<RunOutcome, (entry: RunHistoryEntry) => string> = {
  running: () => 'Running',
  finished: () => 'Finished',
  skipped: () => 'Skipped, previous run still going',
  failed: (entry) => `Failed to start: ${entry.reason ?? ''}`,
};

// A history entry's row: linked while its run row is open.
export function historyRowInput(
  entry: RunHistoryEntry,
  runRows: readonly string[],
): HistoryRowInput {
  return {
    when: localTime(entry.occurrence),
    outcome: entry.outcome,
    text: OUTCOME_TEXTS[entry.outcome](entry),
    linked: entry.rowId !== null && runRows.includes(entry.rowId),
  };
}

// The run row the history cursor's entry links to, or null.
export function cursorRunRow(state: SchedulesState): string | null {
  const entry = selectedView(state)?.history[state.historyCursor];
  if (entry === undefined) {
    return null;
  }
  return historyRowInput(entry, state.scheduling.runRows).linked
    ? entry.rowId
    : null;
}

export function confirmBody(confirm: SchedulesConfirm): string {
  return confirm.kind === 'remove' ? `Remove ${confirm.name}?` : DISCARD_BODY;
}

// ── The editor ────────────────────────────────────────────────────────────

// A new task's editor: empty name, project and prompt, the first profile, `Daily` at 09:00, every control Default,
// not attended.
export function newTaskEditor(
  choices: EditorChoices,
  opener: TaskEditor['opener'],
): TaskEditor {
  const fields: EditorFields = {
    name: '',
    project: '',
    profile: choices.profiles[0] ?? '',
    schedule: fieldsOf({ kind: 'daily', time: NEW_TASK_TIME }),
    controls: Object.fromEntries(
      choices.controls.map((control) => [control.id, '']),
    ),
    attended: 'false',
    prompt: '',
  };
  return {
    kind: 'create',
    taskId: null,
    taskName: '',
    paused: false,
    choices,
    fields,
    initial: fields,
    cursor: 0,
    problem: null,
    opener,
  };
}

// An edited task's editor, holding its own values; a control the harness does not offer is left out.
export function taskEditor(
  view: ScheduledTaskView,
  choices: EditorChoices,
  opener: TaskEditor['opener'],
): TaskEditor {
  const { task } = view;
  const fields: EditorFields = {
    name: task.name,
    project:
      'projectDir' in task.target
        ? task.target.projectDir
        : task.target.project,
    profile: task.profile,
    schedule: fieldsOf(task.schedule),
    controls: Object.fromEntries(
      choices.controls.map((control) => [
        control.id,
        task.controls[control.id] ?? '',
      ]),
    ),
    attended: String(task.attended),
    prompt: task.prompt,
  };
  return {
    kind: 'edit',
    taskId: task.id,
    taskName: task.name,
    paused: task.paused,
    choices,
    fields,
    initial: fields,
    cursor: 0,
    problem: null,
    opener,
  };
}

export function isEditorChanged(editor: TaskEditor): boolean {
  return JSON.stringify(editor.fields) !== JSON.stringify(editor.initial);
}

export function editorHeading(editor: TaskEditor): string {
  return editor.kind === 'create' ? 'New task' : `Edit ${editor.taskName}`;
}

// The editor's rows in order: Name, Project, Profile, Schedule, the schedule kind's rows, one per harness control,
// Attended, Prompt.
export function editorRows(editor: TaskEditor): EditorRow[] {
  const { fields, choices } = editor;
  const schedule = fields.schedule;
  const kindLabel =
    SCHEDULE_KINDS.find((kind) => kind.value === schedule.kind)?.label ?? '';
  return [
    boxRow('name', 'Name', fields.name, null),
    boxRow('project', 'Project', fields.project, projectHint(choices)),
    choiceRow(
      'profile',
      'Profile',
      fields.profile,
      choices.profiles.map((profile) => ({ label: profile, value: profile })),
    ),
    {
      ...choiceRow('schedule', 'Schedule', schedule.kind, SCHEDULE_KINDS),
      value: kindLabel,
    },
    ...scheduleRows(schedule),
    ...choices.controls.map((control) => {
      const value = fields.controls[control.id] ?? '';
      const options = [
        { label: DEFAULT_CHOICE, value: '' },
        ...control.choices,
      ];
      const shown = options.find((option) => option.value === value);
      return {
        ...choiceRow(CONTROL_FIELD + control.id, control.label, value, options),
        value: shown?.label ?? value,
      };
    }),
    {
      ...choiceRow('attended', 'Attended', fields.attended, ATTENDED_CHOICES),
      value: fields.attended === 'true' ? 'Yes' : 'No',
    },
    { ...boxRow('prompt', 'Prompt', fields.prompt, null), kind: 'multiline' },
  ];
}

function scheduleRows(schedule: ScheduleFields): EditorRow[] {
  const timeRow = boxRow('time', 'Time', schedule.time, 'HH:MM, 24 h');
  switch (schedule.kind) {
    case 'hourly':
      return [boxRow('minute', 'Minute', schedule.minute, '0 to 59')];
    case 'daily':
    case 'weekdays':
      return [timeRow];
    case 'weekly':
      return [
        {
          ...choiceRow(
            'day',
            'Day',
            String(schedule.day),
            DAY_NAMES.map((name, day) => ({ label: name, value: String(day) })),
          ),
          value: DAY_NAMES[schedule.day] ?? '',
        },
        timeRow,
      ];
    case 'once':
      return [boxRow('at', 'Date and time', schedule.at, 'YYYY-MM-DD HH:MM')];
    case 'cron':
      return [
        boxRow(
          'line',
          'Cron line',
          schedule.line,
          'Five fields: minute hour day month weekday',
        ),
      ];
  }
}

function projectHint(choices: EditorChoices): string {
  return choices.projects.length === 0
    ? 'A folder path.'
    : `A folder path, or a pool project: ${choices.projects.join(', ')}`;
}

function boxRow(
  field: string,
  label: string,
  value: string,
  hint: string | null,
): EditorRow {
  return { field, label, value, hint, kind: 'box', choices: null };
}

function choiceRow(
  field: string,
  label: string,
  value: string,
  choices: readonly { label: string; value: string }[],
): EditorRow {
  return { field, label, value, hint: null, kind: 'choice', choices };
}

// The fields with `field` set to `value`: a box's text, or a choice's value (`day` its number as text, a control
// `control:<id>`).
function fieldsWith(
  fields: EditorFields,
  field: string,
  value: string,
): EditorFields {
  if (field.startsWith(CONTROL_FIELD)) {
    const id = field.slice(CONTROL_FIELD.length);
    return { ...fields, controls: { ...fields.controls, [id]: value } };
  }
  switch (field) {
    case 'name':
    case 'project':
    case 'profile':
    case 'attended':
    case 'prompt':
      return { ...fields, [field]: value };
    case 'schedule':
      return {
        ...fields,
        schedule: { ...fields.schedule, kind: value as ScheduleKind },
      };
    case 'day':
      return {
        ...fields,
        schedule: { ...fields.schedule, day: Number(value) },
      };
    case 'minute':
    case 'time':
    case 'at':
    case 'line':
      return { ...fields, schedule: { ...fields.schedule, [field]: value } };
    default:
      throw new Error(`no editor field ${field}`);
  }
}

// The editor's rows as a `TaskDraft`, or the first reason they do not make one.
export function draftOf(editor: TaskEditor): TaskDraft | string {
  const { fields, choices } = editor;
  const name = fields.name.trim();
  const project = fields.project.trim();
  const profile = fields.profile.trim();
  const prompt = fields.prompt.trim();
  if (name === '') {
    return 'Name is empty.';
  }
  if (project === '') {
    return 'Project is empty.';
  }
  const isFolder = project.startsWith('/') || project.startsWith('~');
  if (!isFolder && !choices.projects.includes(project)) {
    return `${project} is not a folder path or a pool project.`;
  }
  if (!choices.profiles.includes(profile)) {
    return 'Choose a profile.';
  }
  const schedule = scheduleOf(fields.schedule);
  if (typeof schedule === 'string') {
    return schedule;
  }
  if (prompt === '') {
    return 'Prompt is empty.';
  }
  return {
    id: editor.taskId,
    name,
    target: isFolder ? { projectDir: project } : { project },
    profile,
    prompt,
    schedule,
    controls: Object.fromEntries(
      Object.entries(fields.controls).filter(([, value]) => value !== ''),
    ),
    paused: editor.paused,
    attended: fields.attended === 'true',
  };
}

// ── Reducer helpers ───────────────────────────────────────────────────────

function selected(state: SchedulesState, id: string | null): SchedulesState {
  return {
    ...state,
    selectedId: id,
    isFirstSelection: false,
    historyCursor: id === state.selectedId ? state.historyCursor : 0,
  };
}

function rowIdOf(row: ListRow): string | null {
  return row.kind === 'new' ? null : row.view.task.id;
}

function rowIdAt(state: SchedulesState, index: number): string | null {
  const row = listRows(state.scheduling)[index];
  return row === undefined ? null : rowIdOf(row);
}

function selectedIndex(state: SchedulesState): number {
  return Math.max(
    listRows(state.scheduling).findIndex(
      (row) => rowIdOf(row) === state.selectedId,
    ),
    0,
  );
}

function moveIndex(state: SchedulesState, to: Move): number {
  const last = listRows(state.scheduling).length - 1;
  return stepIndex(selectedIndex(state), last, to);
}

function historyIndex(state: SchedulesState, to: Move): number {
  const last = (selectedView(state)?.history.length ?? 0) - 1;
  return Math.max(stepIndex(state.historyCursor, last, to), 0);
}

function stepIndex(index: number, last: number, to: Move): number {
  switch (to) {
    case 'down':
      return Math.min(index + 1, last);
    case 'up':
      return Math.max(index - 1, 0);
    case 'top':
      return 0;
    case 'bottom':
      return last;
  }
}

// A new state keeps the selection by task id; a selected task that left selects the row at its index, else the
// "+ New task" row; the first state holding tasks selects the first task.
function withScheduling(
  state: SchedulesState,
  scheduling: SchedulingState,
): SchedulesState {
  const rows = listRows(scheduling);
  const ids = rows.map(rowIdOf);
  let { selectedId, isFirstSelection } = state;
  const isFirstTaskShown =
    isFirstSelection && selectedId === null && rows.length > 1;
  if (isFirstTaskShown) {
    selectedId = ids[1];
    isFirstSelection = false;
  } else if (!ids.includes(selectedId)) {
    selectedId = ids[selectedIndex(state)] ?? null;
  }
  const next = { ...state, scheduling, selectedId, isFirstSelection };
  const lastEntry = (selectedView(next)?.history.length ?? 0) - 1;
  return {
    ...next,
    historyCursor:
      selectedId === state.selectedId
        ? Math.max(Math.min(state.historyCursor, lastEntry), 0)
        : 0,
  };
}

function withEditor(
  state: SchedulesState,
  change: (editor: TaskEditor) => TaskEditor,
): SchedulesState {
  return state.editor === null
    ? state
    : { ...state, editor: change(state.editor) };
}

function withRowsCursor(editor: TaskEditor): TaskEditor {
  const last = editorRows(editor).length - 1;
  return { ...editor, cursor: Math.max(Math.min(editor.cursor, last), 0) };
}

function closedEditor(state: SchedulesState): SchedulesState {
  return {
    ...state,
    editor: null,
    confirm: null,
    focus: state.editor?.opener ?? state.focus,
  };
}
