import type { FileStat } from '../../../contracts/files';
import { errorText } from '../../../shared/error-text';
import type { ChatProject, StartTarget } from '../../chat/contract';
import {
  type AgentSession,
  errorResult,
  textResult,
  type ToolDefinition,
  type ToolResult,
  type ToolSession,
} from '../../sessions/contract';
import type {
  ScheduledTask,
  ScheduledTaskView,
  TaskDraft,
  TaskSchedule,
} from '../contract';
import { readSchedule, scheduleText } from '../schedule';

const RUN_NOTE =
  "A scheduled task starts a new chat session in its folder at each scheduled time, headless unless the task is attended, with the task's prompt as its first message, also while the Auri app is closed unless the task is attended. Each run is a full agent session running the user's whole agent setup: even a one-word prompt spends tens of thousands of tokens of the user's plan at every run, so schedule only work that needs a session of its own at those times.";

const SCHEDULE_NOTE =
  'Times are local. `schedule` takes one of six shapes: hourly at a minute, `{"kind": "hourly", "minute": 15}`; daily at a time, `{"kind": "daily", "time": "09:00"}`; Monday to Friday at a time, `{"kind": "weekdays", "time": "09:00"}`; weekly on a day (0 is Sunday … 6 Saturday) at a time, `{"kind": "weekly", "day": 1, "time": "09:00"}`; once at a date and time, `{"kind": "once", "at": "2026-11-20T14:30"}`; a five-field cron line, `{"kind": "cron", "line": "0 9 * * 1-5"}`.';

const TARGET_NOTE =
  "Name where the task runs with `folder` or `project`, not both. `folder` must be an absolute path to a folder that exists. `project` names one of the app's projects: a folder project runs in its folder, and a Unity pool project runs in the pool's lowest-numbered clone and claims no clone, so name the branch in the prompt when the work needs one.";

const CONTROLS_NOTE =
  "`controls` sets the run's session controls by control id, its permission mode among them; an unknown id is refused with the list of ids. The controls are capped at this session's own, so a run never gets more permission than this session has.";

// The JSON schema of a `TaskSchedule`.
const SCHEDULE_SCHEMA = {
  description: 'When the task runs, in local time: one of the six shapes.',
  oneOf: [
    scheduleShape('hourly', {
      minute: { type: 'integer', minimum: 0, maximum: 59 },
    }),
    scheduleShape('daily', { time: { type: 'string' } }),
    scheduleShape('weekdays', { time: { type: 'string' } }),
    scheduleShape('weekly', {
      day: { type: 'integer', minimum: 0, maximum: 6 },
      time: { type: 'string' },
    }),
    scheduleShape('once', { at: { type: 'string' } }),
    scheduleShape('cron', { line: { type: 'string' } }),
  ],
};

const FIELD_SCHEMAS = {
  name: { type: 'string', description: "The task's name in the list." },
  prompt: {
    type: 'string',
    description: "The first message of each run's new session.",
  },
  schedule: SCHEDULE_SCHEMA,
  folder: {
    type: 'string',
    description:
      'The absolute path of an existing folder to run in, in place of project.',
  },
  project: {
    type: 'string',
    description:
      "The name of one of the app's projects to run in, in place of folder.",
  },
  profile: {
    type: 'string',
    description:
      'The name of the chat profile each run starts under. A project with its own profile refuses any other.',
  },
  controls: {
    type: 'object',
    additionalProperties: { type: 'string' },
    description:
      "Session control id → value for each run, capped at this session's own.",
  },
  attended: {
    type: 'boolean',
    description:
      'true: each run starts with headless off, so a form waits for the user, and runs only while the Auri app is open; a time missed while it is closed runs when the app next opens. false (the default): each run is headless.',
  },
};

export const SCHEDULE_TASK_TOOL: ToolDefinition = {
  name: 'schedule_task',
  description: `Schedule a task in the Auri app: a prompt that runs on a schedule. The task is active at once and shows in the app's Schedules mode. ${RUN_NOTE} ${SCHEDULE_NOTE} ${TARGET_NOTE} With neither, it runs in this session's folder. \`profile\` defaults to the project's own profile when it has one, else to this session's. ${CONTROLS_NOTE} Returns the new task's id.`,
  inputSchema: {
    type: 'object',
    properties: FIELD_SCHEMAS,
    required: ['name', 'prompt', 'schedule'],
    additionalProperties: false,
  },
};

export const LIST_SCHEDULED_TASKS_TOOL: ToolDefinition = {
  name: 'list_scheduled_tasks',
  description: `List the Auri app's scheduled tasks, one line each: the task's id, name, schedule, next run (local \`YYYY-MM-DDTHH:MM\`, \`paused\`, or \`none\` when no run comes) and the outcome of its last run, then \`attended\` on an attended task's line. ${RUN_NOTE}`,
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
};

export const UPDATE_SCHEDULED_TASK_TOOL: ToolDefinition = {
  name: 'update_scheduled_task',
  description: `Change a scheduled task in the Auri app, by the id \`list_scheduled_tasks\` gives. Each field given replaces the task's; the rest stay. \`folder\` or \`project\` replaces where it runs; \`paused\` pauses or resumes it. ${RUN_NOTE} ${SCHEDULE_NOTE} ${TARGET_NOTE} ${CONTROLS_NOTE} The cap applies to the controls the task keeps too, on every change but a pause alone.`,
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: "The task's id." },
      ...FIELD_SCHEMAS,
      paused: {
        type: 'boolean',
        description: 'true pauses the task; false resumes it.',
      },
    },
    required: ['id'],
    additionalProperties: false,
  },
};

export const REMOVE_SCHEDULED_TASK_TOOL: ToolDefinition = {
  name: 'remove_scheduled_task',
  description:
    'Remove a scheduled task from the Auri app, by the id `list_scheduled_tasks` gives, so no further run of it starts.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: "The task's id." },
    },
    required: ['id'],
    additionalProperties: false,
  },
};

export const TASK_TOOLS: ToolDefinition[] = [
  SCHEDULE_TASK_TOOL,
  LIST_SCHEDULED_TASKS_TOOL,
  UPDATE_SCHEDULED_TASK_TOOL,
  REMOVE_SCHEDULED_TASK_TOOL,
];

export interface TaskToolsDeps {
  views(): readonly ScheduledTaskView[]; // built from the stores at call time, list order
  save(draft: TaskDraft): Promise<string>; // TaskStore.save
  remove(id: string): Promise<void>; // TaskStore.remove
  isRunRow(sessionId: string): boolean; // SchedulingState.runRows holds it
  profileOf(sessionId: string): string | null; // chat.profileOf
  defaultProfile(sessionId: string | null): string | null; // chat.defaultProfile
  profileNames(): string[];
  projects(): readonly ChatProject[]; // chat.projects(), read at each call
  controlIds(): string[]; // the chat harness's startControls() ids
  sessionControls(sessionId: string): Readonly<Record<string, string>>; // the calling row's picks
  capControls(
    controls: Readonly<Record<string, string>>,
    cap: Readonly<Record<string, string>>,
  ): Record<string, string>; // the chat harness's capControls
  isAbsolute(path: string): boolean;
  stat(path: string): Promise<FileStat | null>;
  log(line: string): void;
}

const RUN_ROW_REFUSAL = 'A scheduled run cannot manage scheduled tasks.';

interface TaskArgs {
  id?: unknown;
  name?: unknown;
  prompt?: unknown;
  schedule?: unknown;
  folder?: unknown;
  project?: unknown;
  profile?: unknown;
  controls?: unknown;
  paused?: unknown;
  attended?: unknown;
}

// The fields `update_scheduled_task` changes, `id` aside.
const UPDATE_FIELDS = [
  'name',
  'prompt',
  'schedule',
  'folder',
  'project',
  'profile',
  'controls',
  'paused',
  'attended',
] as const satisfies readonly (keyof TaskArgs)[];

// A value an argument settled on, or the problem that stops the call.
type Choice<T> = { value: T } | { problem: string };

type ToolCall = (
  deps: TaskToolsDeps,
  session: AgentSession,
  args: TaskArgs,
) => Promise<ToolResult>;

function scheduleShape(kind: TaskSchedule['kind'], fields: object) {
  return {
    type: 'object',
    properties: { kind: { const: kind }, ...fields },
    required: ['kind', ...Object.keys(fields)],
    additionalProperties: false,
  };
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isAbsent(value: unknown): value is undefined | null {
  return value === undefined || value === null;
}

function readText(field: string, value: unknown): Choice<string> {
  return isNonBlankString(value)
    ? { value }
    : { problem: `${field} must be a non-empty string.` };
}

// The given `attended`, null when absent.
function readAttended(value: unknown): Choice<boolean | null> {
  if (isAbsent(value)) {
    return { value: null };
  }
  return typeof value === 'boolean'
    ? { value }
    : { problem: 'attended must be true or false.' };
}

function readScheduleArg(value: unknown): Choice<TaskSchedule> {
  const schedule = readSchedule(value);
  return typeof schedule === 'string'
    ? { problem: schedule }
    : { value: schedule };
}

function readId(
  deps: TaskToolsDeps,
  value: unknown,
): Choice<ScheduledTaskView> {
  if (!isNonBlankString(value)) {
    return { problem: 'id must be a non-empty string.' };
  }
  const view = deps.views().find((each) => each.task.id === value);
  return view === undefined
    ? { problem: `No scheduled task ${value}.` }
    : { value: view };
}

async function readFolder(
  deps: TaskToolsDeps,
  folder: unknown,
): Promise<Choice<string>> {
  if (!isNonBlankString(folder)) {
    return { problem: 'folder must be a non-empty string.' };
  }
  if (!deps.isAbsolute(folder)) {
    return { problem: `folder must be an absolute path: ${folder}` };
  }
  let found: FileStat | null;
  try {
    found = await deps.stat(folder);
  } catch (error) {
    deps.log(`folder ${folder} not read: ${errorText(error)}`);
    return { problem: `folder ${folder} not read: ${errorText(error)}` };
  }
  if (found === null || !found.isFolder) {
    return { problem: `No folder at ${folder}.` };
  }
  return { value: folder };
}

// The target the args name, null when they name neither folder nor project.
async function readTarget(
  deps: TaskToolsDeps,
  args: TaskArgs,
): Promise<Choice<StartTarget | null>> {
  const isFolderNamed = !isAbsent(args.folder);
  const isProjectNamed = !isAbsent(args.project);
  if (isFolderNamed && isProjectNamed) {
    return { problem: 'Name folder or project, not both.' };
  }
  if (isProjectNamed) {
    const project = args.project;
    if (!isNonBlankString(project)) {
      return { problem: 'project must be a non-empty string.' };
    }
    const names = deps.projects().map((each) => each.name);
    if (!names.includes(project)) {
      const known = names.length === 0 ? 'none' : names.join(', ');
      return { problem: `Unknown project "${project}". Projects: ${known}.` };
    }
    return { value: { project } };
  }
  if (isFolderNamed) {
    const folder = await readFolder(deps, args.folder);
    return 'problem' in folder
      ? folder
      : { value: { projectDir: folder.value } };
  }
  return { value: null };
}

// The named profile, null when absent.
function readProfile(
  deps: TaskToolsDeps,
  value: unknown,
): Choice<string | null> {
  if (isAbsent(value)) {
    return { value: null };
  }
  if (!isNonBlankString(value)) {
    return { problem: 'profile must be a non-empty string.' };
  }
  const names = deps.profileNames();
  if (!names.includes(value)) {
    const known = names.length === 0 ? 'none' : names.join(', ');
    return { problem: `Unknown profile "${value}". Profiles: ${known}.` };
  }
  return { value };
}

// The named controls, null when absent. An unknown id saves and then fails
// every run, so it is refused here with chat's launch text.
function readControls(
  deps: TaskToolsDeps,
  value: unknown,
): Choice<Record<string, string> | null> {
  if (isAbsent(value)) {
    return { value: null };
  }
  const isRecord =
    typeof value === 'object' && value !== null && !Array.isArray(value);
  const entries = isRecord ? Object.entries(value) : [];
  if (!isRecord || entries.some(([, each]) => typeof each !== 'string')) {
    return {
      problem: 'controls must be an object of control ids to string values.',
    };
  }
  const ids = deps.controlIds();
  const unknown = entries.find(([id]) => !ids.includes(id));
  if (unknown !== undefined) {
    return {
      problem: `Unknown control "${unknown[0]}". Controls: ${ids.join(', ')}.`,
    };
  }
  return { value: Object.fromEntries(entries) as Record<string, string> };
}

// Chat's launch refuses another profile than a project's own, so a task that
// names one would save and then fail at every run. Mirrors `start_session`'s
// default: the project's own profile, else `fallback`.
function chooseProfile(
  deps: TaskToolsDeps,
  target: StartTarget,
  named: string | null,
  fallback: string | null,
): Choice<string> {
  const project = 'project' in target ? target.project : null;
  const own =
    deps.projects().find((each) => each.name === project)?.profile ?? null;
  if (named !== null) {
    return own !== null && named !== own
      ? { problem: `Project ${project} runs under its own profile ${own}.` }
      : { value: named };
  }
  const profile = own ?? fallback;
  return profile === null
    ? { problem: 'The app has no profile to run the task under.' }
    : { value: profile };
}

// Saves `draft`, answering the store's rejection as a tool error.
async function saveDraft(
  deps: TaskToolsDeps,
  tool: string,
  draft: TaskDraft,
  answer: (id: string) => string,
): Promise<ToolResult> {
  let id: string;
  try {
    id = await deps.save(draft);
  } catch (error) {
    deps.log(`${tool} failed: ${errorText(error)}`);
    return errorResult(errorText(error));
  }
  return textResult(answer(id));
}

async function scheduleTask(
  deps: TaskToolsDeps,
  session: AgentSession,
  args: TaskArgs,
): Promise<ToolResult> {
  const name = readText('name', args.name);
  if ('problem' in name) {
    return errorResult(name.problem);
  }
  const prompt = readText('prompt', args.prompt);
  if ('problem' in prompt) {
    return errorResult(prompt.problem);
  }
  const schedule = readScheduleArg(args.schedule);
  if ('problem' in schedule) {
    return errorResult(schedule.problem);
  }
  const named = await readTarget(deps, args);
  if ('problem' in named) {
    return errorResult(named.problem);
  }
  const sessionFolder = session.info.projectDir;
  const target =
    named.value ??
    (sessionFolder === null ? null : { projectDir: sessionFolder });
  if (target === null) {
    return errorResult('Name folder or project: this session has no folder.');
  }
  const namedProfile = readProfile(deps, args.profile);
  if ('problem' in namedProfile) {
    return errorResult(namedProfile.problem);
  }
  const profile = chooseProfile(
    deps,
    target,
    namedProfile.value,
    deps.profileOf(session.id) ?? deps.defaultProfile(session.id),
  );
  if ('problem' in profile) {
    return errorResult(profile.problem);
  }
  const controls = readControls(deps, args.controls);
  if ('problem' in controls) {
    return errorResult(controls.problem);
  }
  const attended = readAttended(args.attended);
  if ('problem' in attended) {
    return errorResult(attended.problem);
  }
  const draft: TaskDraft = {
    id: null,
    name: name.value,
    target,
    profile: profile.value,
    prompt: prompt.value,
    schedule: schedule.value,
    controls: deps.capControls(
      controls.value ?? {},
      deps.sessionControls(session.id),
    ),
    paused: false,
    attended: attended.value ?? false,
  };
  return saveDraft(
    deps,
    SCHEDULE_TASK_TOOL.name,
    draft,
    (id) =>
      `Scheduled task ${id}: ${draft.name}, ${scheduleText(draft.schedule)}.`,
  );
}

// `at` as local `YYYY-MM-DDTHH:MM`.
function localMinuteText(at: number): string {
  const date = new Date(at);
  const two = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}T${two(date.getHours())}:${two(date.getMinutes())}`;
}

function nextRunText(view: ScheduledTaskView): string {
  if (view.task.paused) {
    return 'paused';
  }
  return view.nextRun === null ? 'none' : localMinuteText(view.nextRun);
}

function listScheduledTasks(deps: TaskToolsDeps): Promise<ToolResult> {
  const tasks = deps.views().map((view) => ({
    id: view.task.id,
    name: view.task.name,
    schedule: scheduleText(view.task.schedule),
    nextRun: nextRunText(view),
    lastOutcome: view.history[0]?.outcome ?? null,
    paused: view.task.paused,
    attended: view.task.attended,
  }));
  const text =
    tasks.length === 0
      ? 'No scheduled tasks.'
      : tasks
          .map(
            (each) =>
              `${each.id}  ${each.name}  ${each.schedule}  next ${each.nextRun}  last ${each.lastOutcome ?? 'none'}${each.attended ? '  attended' : ''}`,
          )
          .join('\n');
  return Promise.resolve({
    ...textResult(text),
    structuredContent: { tasks },
  });
}

// The task's target and profile after an update: a given field replaces the
// task's, and a new target with no profile named takes the target's own
// profile when it has one. Only a change to either is checked.
async function updatedPlacement(
  deps: TaskToolsDeps,
  task: ScheduledTask,
  args: TaskArgs,
): Promise<Choice<{ target: StartTarget; profile: string }>> {
  const named = await readTarget(deps, args);
  if ('problem' in named) {
    return named;
  }
  const namedProfile = readProfile(deps, args.profile);
  if ('problem' in namedProfile) {
    return namedProfile;
  }
  if (named.value === null && namedProfile.value === null) {
    return { value: { target: task.target, profile: task.profile } };
  }
  const target = named.value ?? task.target;
  const profile = chooseProfile(deps, target, namedProfile.value, task.profile);
  return 'problem' in profile
    ? profile
    : { value: { target, profile: profile.value } };
}

async function updateScheduledTask(
  deps: TaskToolsDeps,
  session: AgentSession,
  args: TaskArgs,
): Promise<ToolResult> {
  const found = readId(deps, args.id);
  if ('problem' in found) {
    return errorResult(found.problem);
  }
  const { task } = found.value;
  const given = UPDATE_FIELDS.filter((field) => !isAbsent(args[field]));
  if (given.length === 0) {
    return errorResult('Name at least one field to change.');
  }
  const name = isAbsent(args.name)
    ? { value: task.name }
    : readText('name', args.name);
  if ('problem' in name) {
    return errorResult(name.problem);
  }
  const prompt = isAbsent(args.prompt)
    ? { value: task.prompt }
    : readText('prompt', args.prompt);
  if ('problem' in prompt) {
    return errorResult(prompt.problem);
  }
  const schedule = isAbsent(args.schedule)
    ? { value: task.schedule }
    : readScheduleArg(args.schedule);
  if ('problem' in schedule) {
    return errorResult(schedule.problem);
  }
  const placement = await updatedPlacement(deps, task, args);
  if ('problem' in placement) {
    return errorResult(placement.problem);
  }
  const controls = readControls(deps, args.controls);
  if ('problem' in controls) {
    return errorResult(controls.problem);
  }
  if (!isAbsent(args.paused) && typeof args.paused !== 'boolean') {
    return errorResult('paused must be true or false.');
  }
  const paused = typeof args.paused === 'boolean' ? args.paused : task.paused;
  const attended = readAttended(args.attended);
  if ('problem' in attended) {
    return errorResult(attended.problem);
  }
  // A pause grants nothing, so it alone leaves the controls uncapped.
  const isPauseOnly = given.length === 1 && args.paused === true;
  const kept = controls.value ?? task.controls;
  const draft: TaskDraft = {
    id: task.id,
    name: name.value,
    target: placement.value.target,
    profile: placement.value.profile,
    prompt: prompt.value,
    schedule: schedule.value,
    controls: isPauseOnly
      ? kept
      : deps.capControls(kept, deps.sessionControls(session.id)),
    paused,
    attended: attended.value ?? task.attended,
  };
  return saveDraft(
    deps,
    UPDATE_SCHEDULED_TASK_TOOL.name,
    draft,
    () =>
      `Updated ${draft.name}: ${scheduleText(draft.schedule)}, ${paused ? 'paused' : 'active'}.`,
  );
}

async function removeScheduledTask(
  deps: TaskToolsDeps,
  _session: AgentSession,
  args: TaskArgs,
): Promise<ToolResult> {
  const found = readId(deps, args.id);
  if ('problem' in found) {
    return errorResult(found.problem);
  }
  const { task } = found.value;
  try {
    await deps.remove(task.id);
  } catch (error) {
    deps.log(`${REMOVE_SCHEDULED_TASK_TOOL.name} failed: ${errorText(error)}`);
    return errorResult(errorText(error));
  }
  return textResult(`Removed ${task.name}.`);
}

const TOOL_CALLS: Readonly<Record<string, ToolCall>> = {
  [SCHEDULE_TASK_TOOL.name]: scheduleTask,
  [LIST_SCHEDULED_TASKS_TOOL.name]: (deps) => listScheduledTasks(deps),
  [UPDATE_SCHEDULED_TASK_TOOL.name]: updateScheduledTask,
  [REMOVE_SCHEDULED_TASK_TOOL.name]: removeScheduledTask,
};

// The `start` the scheduling main part hands sessions' `contributeTools` with
// TASK_TOOLS: each session's calls default to that session's folder and
// profile, and cap a task's controls at that session's. A scheduled run's row
// is refused every tool, so a run cannot reschedule itself.
export function startTaskTools(
  deps: TaskToolsDeps,
): (session: AgentSession) => ToolSession {
  return (session) => ({
    call(name, args) {
      const toolCall = TOOL_CALLS[name];
      if (toolCall === undefined) {
        return Promise.reject(new Error(`no scheduling tool "${name}"`));
      }
      if (deps.isRunRow(session.id)) {
        return Promise.resolve(errorResult(RUN_ROW_REFUSAL));
      }
      return toolCall(deps, session, (args ?? {}) as TaskArgs);
    },
    end: () => undefined,
  });
}
