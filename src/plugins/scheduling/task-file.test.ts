import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ScheduledTask, TaskFile } from './contract';
import { readTaskFile, taskFileText } from './task-file';

let savedZone: string | undefined;

beforeAll(() => {
  savedZone = process.env.TZ;
  process.env.TZ = 'America/New_York';
});

afterAll(() => {
  if (savedZone === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = savedZone;
  }
});

const FOLDER_TASK: ScheduledTask = {
  id: '3f9a01bc',
  name: 'Morning triage',
  target: { projectDir: '~/dev/a' },
  profile: 'work',
  prompt: 'Triage the follow-ups.',
  schedule: { kind: 'weekly', day: 1, time: '09:00' },
  controls: { mode: 'plan', effort: 'medium' },
  paused: false,
  attended: false,
  updatedAt: 1794297600000,
};

const PROJECT_TASK: ScheduledTask = {
  id: '0c7e2d95',
  name: 'Nightly check',
  target: { project: 'games' },
  profile: 'personal',
  prompt: 'Run the checks.',
  schedule: { kind: 'cron', line: '30 2 * * 1-5' },
  controls: {},
  paused: true,
  attended: true,
  updatedAt: 0,
};

// The file text of one task: `FOLDER_TASK` with `change` laid over it.
function oneTaskText(change: Record<string, unknown>): string {
  return JSON.stringify({ tasks: [{ ...FOLDER_TASK, ...change }] });
}

describe('taskFileText', () => {
  it('taskFileText_ThenReadTaskFile_ReturnsTheSameFile', () => {
    const file: TaskFile = { tasks: [FOLDER_TASK, PROJECT_TASK] };

    const text = taskFileText(file);

    expect(text.endsWith('}\n')).toBe(true);
    expect(readTaskFile(text)).toEqual(file);
    const keys = Object.keys((JSON.parse(text) as TaskFile).tasks[0]);
    expect(keys[keys.indexOf('paused') + 1]).toBe('attended');
  });
});

describe('readTaskFile', () => {
  it.each<{ case: string; text: string; names: string[] }>([
    { case: 'not JSON', text: '{"tasks": [', names: ['not JSON'] },
    { case: 'tasks not an array', text: '{"tasks": {}}', names: ['tasks'] },
    {
      case: 'id not hex',
      text: oneTaskText({ id: 'ABC' }),
      names: ['task 1', 'id'],
    },
    {
      case: 'repeated id',
      text: JSON.stringify({
        tasks: [FOLDER_TASK, { ...PROJECT_TASK, id: FOLDER_TASK.id }],
      }),
      names: ['task 2', 'id'],
    },
    {
      case: 'target with both keys',
      text: oneTaskText({ target: { projectDir: '~/a', project: 'games' } }),
      names: ['target'],
    },
    {
      case: 'blank prompt',
      text: oneTaskText({ prompt: '  ' }),
      names: ['prompt'],
    },
    {
      case: 'bad schedule time',
      text: oneTaskText({ schedule: { kind: 'daily', time: '9:00' } }),
      names: [`task 1 (${FOLDER_TASK.id})`, 'schedule.time'],
    },
    {
      case: 'control not a string',
      text: oneTaskText({ controls: { mode: 5 } }),
      names: ['controls'],
    },
    {
      case: 'unknown key',
      text: oneTaskText({ pasued: true }),
      names: ['pasued'],
    },
    {
      case: 'negative updatedAt',
      text: oneTaskText({ updatedAt: -1 }),
      names: ['updatedAt'],
    },
  ])('readTaskFile_BadFile_NamesTheTaskAndField: $case', ({ text, names }) => {
    const read = readTaskFile(text);

    expect(typeof read).toBe('string');
    for (const name of names) {
      expect(read).toContain(name);
    }
  });

  it.each<{ case: string; attended?: unknown; read: boolean | string }>([
    { case: 'no key', read: false },
    { case: 'true', attended: true, read: true },
    {
      case: 'not a boolean',
      attended: 'yes',
      read: `task 1 (${FOLDER_TASK.id}): attended must be true or false, got "yes"`,
    },
  ])('readTaskFile_Attended: $case', ({ attended, read }) => {
    const { attended: _attended, ...task } = FOLDER_TASK;
    const written = attended === undefined ? task : { ...task, attended };

    const file = readTaskFile(JSON.stringify({ tasks: [written] }));

    expect(typeof file === 'string' ? file : file.tasks[0].attended).toEqual(
      read,
    );
  });
});
