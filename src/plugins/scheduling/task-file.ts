import type { StartTarget } from '../chat/contract';
import { isJsonObject, type JsonObject } from '../../shared/json';
import {
  TASK_FILE_NAME,
  type ScheduledTask,
  type TaskFile,
  type TaskSchedule,
} from './contract';
import { readSchedule } from './schedule';

// The `ScheduledTask` keys, in the order the file writes them.
const TASK_KEYS = [
  'id',
  'name',
  'target',
  'profile',
  'prompt',
  'schedule',
  'controls',
  'paused',
  'updatedAt',
];
const TARGET_KEYS = ['projectDir', 'project'];
const TASK_ID = /^[0-9a-f]{8}$/;

// The tasks `text` holds, or the parse error naming the first bad task and
// field.
export function readTaskFile(text: string): TaskFile | string {
  const parsed = parseJson(text);
  if (typeof parsed === 'string') {
    return parsed;
  }
  const { value } = parsed;
  if (!isJsonObject(value) || Object.keys(value).join() !== 'tasks') {
    return `${TASK_FILE_NAME} must be an object with one key, tasks`;
  }
  const items = value.tasks;
  if (!Array.isArray(items)) {
    return `tasks must be an array, got ${shown(items)}`;
  }
  const tasks: ScheduledTask[] = [];
  const seenIds = new Map<string, number>();
  for (let index = 0; index < items.length; index++) {
    const task = readTask(items[index], index + 1, seenIds);
    if (typeof task === 'string') {
      return task;
    }
    seenIds.set(task.id, index + 1);
    tasks.push(task);
  }
  return { tasks };
}

// The file's text: two-space JSON with a trailing newline.
export function taskFileText(file: TaskFile): string {
  const tasks = file.tasks.map(
    (task): ScheduledTask => ({
      id: task.id,
      name: task.name,
      target: task.target,
      profile: task.profile,
      prompt: task.prompt,
      schedule: orderedSchedule(task.schedule),
      controls: task.controls,
      paused: task.paused,
      updatedAt: task.updatedAt,
    }),
  );
  return `${JSON.stringify({ tasks }, null, 2)}\n`;
}

// The JSON value `text` holds, or why it holds none.
function parseJson(text: string): { value: unknown } | string {
  try {
    return { value: JSON.parse(text) };
  } catch (error) {
    return `${TASK_FILE_NAME} is not JSON: ${(error as Error).message}`;
  }
}

// Task `position` (from 1) read, or the error naming it and its first bad
// field. `seenIds` maps each earlier task's id to its position.
function readTask(
  value: unknown,
  position: number,
  seenIds: ReadonlyMap<string, number>,
): ScheduledTask | string {
  if (!isJsonObject(value)) {
    return `task ${position} must be an object, got ${shown(value)}`;
  }
  const hasValidId = typeof value.id === 'string' && TASK_ID.test(value.id);
  const label = hasValidId
    ? `task ${position} (${value.id as string})`
    : `task ${position}`;
  const field = readTaskFields(value, seenIds);
  return typeof field === 'string' ? `${label}: ${field}` : field;
}

// `value`'s fields read as a task, or the reason naming its first bad field.
function readTaskFields(
  value: JsonObject,
  seenIds: ReadonlyMap<string, number>,
): ScheduledTask | string {
  const unknownKey = Object.keys(value).find(
    (key) => !TASK_KEYS.includes(key),
  );
  if (unknownKey !== undefined) {
    return `unknown key ${shown(unknownKey)}; a task holds ${TASK_KEYS.join(', ')}`;
  }
  const missingKey = TASK_KEYS.find((key) => !(key in value));
  if (missingKey !== undefined) {
    return `${missingKey} is missing`;
  }
  const { id, name, profile, prompt, controls, paused, updatedAt } = value;
  if (typeof id !== 'string' || !TASK_ID.test(id)) {
    return `id must be 8 lowercase hex characters, got ${shown(id)}`;
  }
  if (seenIds.has(id)) {
    return `id ${id} is already task ${seenIds.get(id)}'s`;
  }
  const blankField = (
    [
      ['name', name],
      ['profile', profile],
      ['prompt', prompt],
    ] as const
  ).find(([, text]) => !isFilledString(text));
  if (blankField !== undefined) {
    return `${blankField[0]} must be a non-blank string, got ${shown(blankField[1])}`;
  }
  const target = readTarget(value.target);
  if (typeof target === 'string') {
    return target;
  }
  const schedule = readSchedule(value.schedule);
  if (typeof schedule === 'string') {
    return schedule;
  }
  if (!isJsonObject(controls)) {
    return `controls must be an object, got ${shown(controls)}`;
  }
  const badControl = Object.keys(controls).find(
    (key) => typeof controls[key] !== 'string',
  );
  if (badControl !== undefined) {
    return `controls.${badControl} must be a string, got ${shown(controls[badControl])}`;
  }
  if (typeof paused !== 'boolean') {
    return `paused must be true or false, got ${shown(paused)}`;
  }
  const isUpdatedAtValid =
    typeof updatedAt === 'number' &&
    Number.isInteger(updatedAt) &&
    updatedAt >= 0;
  if (!isUpdatedAtValid) {
    return `updatedAt must be a whole number 0 or more, got ${shown(updatedAt)}`;
  }
  return {
    id,
    name: name as string,
    target,
    profile: profile as string,
    prompt: prompt as string,
    schedule,
    controls: { ...(controls as Record<string, string>) },
    paused,
    updatedAt: updatedAt as number,
  };
}

function readTarget(value: unknown): StartTarget | string {
  const keys = isJsonObject(value) ? Object.keys(value) : [];
  const key = keys.length === 1 ? keys[0] : '';
  if (!isJsonObject(value) || !TARGET_KEYS.includes(key)) {
    return `target must be an object with exactly one key, projectDir or project, got ${shown(value)}`;
  }
  const text = value[key];
  if (!isFilledString(text)) {
    return `target.${key} must be a non-blank string, got ${shown(text)}`;
  }
  return key === 'projectDir' ? { projectDir: text } : { project: text };
}

// `schedule` with `kind` first, then its fields as the caller gave them.
function orderedSchedule(schedule: TaskSchedule): TaskSchedule {
  return { kind: schedule.kind, ...schedule };
}

function isFilledString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

// A parsed JSON value as the file writes it.
function shown(value: unknown): string {
  return JSON.stringify(value);
}
