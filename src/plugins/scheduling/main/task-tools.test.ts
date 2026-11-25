import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FileStat } from '../../../contracts/files';
import type { ChatProject } from '../../chat/contract';
import type {
  RunHistoryEntry,
  ScheduledTask,
  ScheduledTaskView,
  TaskDraft,
} from '../contract';
import { startTaskTools } from './task-tools';

const CONTEXT = { toolUseId: null, signal: new AbortController().signal };
const FOLDER: FileStat = { isFolder: true, isLink: false };
const FILE: FileStat = { isFolder: false, isLink: false };

const AI_DEV: ChatProject = {
  kind: 'folder',
  name: 'AI Dev',
  folder: '/dev/ai',
  profile: null,
};
const NEW_GAMES: ChatProject = {
  kind: 'pool',
  name: 'New Games',
  pool: 'ng',
  profile: 'work',
};

const SESSION_CONTROLS = { mode: 'manual' };

// What the fake `capControls` returns: `controls` marked with the cap it saw.
function capped(controls: Record<string, string>): Record<string, string> {
  return { ...controls, cappedAt: JSON.stringify(SESSION_CONTROLS) };
}

const NIGHTLY: ScheduledTask = {
  id: 'a1b2c3d4',
  name: 'Nightly',
  target: { project: 'AI Dev' },
  profile: 'home',
  prompt: 'run the checks',
  schedule: { kind: 'daily', time: '02:00' },
  controls: { mode: 'auto' },
  paused: false,
  attended: false,
  updatedAt: 5,
};
const WEEKLY: ScheduledTask = {
  id: 'b2c3d4e5',
  name: 'Weekly',
  target: { projectDir: '/caller' },
  profile: 'home',
  prompt: 'tidy the backlog',
  schedule: { kind: 'weekly', day: 1, time: '09:00' },
  controls: { mode: 'acceptEdits' },
  paused: true,
  attended: false,
  updatedAt: 6,
};

function view(
  task: ScheduledTask,
  nextRun: number | null = null,
  history: RunHistoryEntry[] = [],
): ScheduledTaskView {
  return { task, nextRun, history };
}

function entry(
  taskId: string,
  outcome: RunHistoryEntry['outcome'],
): RunHistoryEntry {
  return {
    taskId,
    occurrence: 1,
    at: 1,
    outcome,
    reason: null,
    rowId: null,
    processId: null,
    viewed: true,
  };
}

function draftOf(task: ScheduledTask): TaskDraft {
  return {
    id: task.id,
    name: task.name,
    target: task.target,
    profile: task.profile,
    prompt: task.prompt,
    schedule: task.schedule,
    controls: task.controls,
    paused: task.paused,
    attended: task.attended,
  };
}

interface Setup {
  views?: ScheduledTaskView[];
  runRows?: string[];
  callerFolder?: string | null;
  // Chat's profile for the caller; 'home' when absent.
  callerProfile?: string | null;
  // Chat's default profile; 'first' when absent.
  defaultProfile?: string | null;
  // What `stat` answers, by path; FOLDER for any other path.
  stats?: Record<string, FileStat | null>;
  saveError?: string;
}

function harness(setup: Setup = {}) {
  const save = vi.fn<(draft: TaskDraft) => Promise<string>>((draft) =>
    setup.saveError === undefined
      ? Promise.resolve(draft.id ?? 'f0e1d2c3')
      : Promise.reject(new Error(setup.saveError)),
  );
  const remove = vi.fn<(id: string) => Promise<void>>(() => Promise.resolve());
  const capControls = vi.fn(
    (
      controls: Readonly<Record<string, string>>,
      cap: Readonly<Record<string, string>>,
    ) => ({ ...controls, cappedAt: JSON.stringify(cap) }),
  );
  const log = vi.fn<(line: string) => void>();
  const session = startTaskTools({
    views: () => setup.views ?? [view(NIGHTLY), view(WEEKLY)],
    save,
    remove,
    isRunRow: (sessionId) => (setup.runRows ?? []).includes(sessionId),
    profileOf: (sessionId) =>
      sessionId === 'caller' && setup.callerProfile !== null
        ? (setup.callerProfile ?? 'home')
        : null,
    defaultProfile: () =>
      setup.defaultProfile === undefined ? 'first' : setup.defaultProfile,
    profileNames: () => ['work', 'home', 'first'],
    projects: () => [AI_DEV, NEW_GAMES],
    controlIds: () => ['mode', 'model'],
    sessionControls: (sessionId) =>
      sessionId === 'caller' ? SESSION_CONTROLS : {},
    capControls,
    isAbsolute: (path) => path.startsWith('/'),
    stat: (path) => {
      const stats = setup.stats ?? {};
      return Promise.resolve(path in stats ? stats[path] : FOLDER);
    },
    log,
  })({
    id: 'caller',
    info: {
      sessionId: 'host-1',
      rowId: null,
      projectDir:
        setup.callerFolder === undefined ? '/caller' : setup.callerFolder,
      harness: 'claude',
    },
  });
  return { save, remove, capControls, log, session };
}

const SCHEDULE_ARGS = {
  name: 'Morning review',
  prompt: 'review the diff',
  schedule: { kind: 'daily', time: '09:00' },
};

let savedTimeZone: string | undefined;

beforeAll(() => {
  savedTimeZone = process.env.TZ;
  process.env.TZ = 'UTC';
});

afterAll(() => {
  if (savedTimeZone === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = savedTimeZone;
  }
});

describe('task tools', () => {
  it.each([
    { tool: 'schedule_task', args: SCHEDULE_ARGS },
    { tool: 'list_scheduled_tasks', args: {} },
    { tool: 'update_scheduled_task', args: { id: NIGHTLY.id, name: 'X' } },
    { tool: 'remove_scheduled_task', args: { id: NIGHTLY.id } },
  ])('call_FromRunRow_RefusesEveryTool: $tool', async ({ tool, args }) => {
    const { save, remove, session } = harness({ runRows: ['caller'] });

    const result = await session.call(tool, args, CONTEXT);

    expect(result).toEqual({
      content: [
        {
          type: 'text',
          text: 'A scheduled run cannot manage scheduled tasks.',
        },
      ],
      isError: true,
    });
    expect(save).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it.each<{ name: string; args: object; setup?: Setup; draft: TaskDraft }>([
    {
      name: 'default folder and profile from the session',
      args: SCHEDULE_ARGS,
      draft: {
        id: null,
        name: 'Morning review',
        target: { projectDir: '/caller' },
        profile: 'home',
        prompt: 'review the diff',
        schedule: { kind: 'daily', time: '09:00' },
        controls: capped({}),
        paused: false,
        attended: false,
      },
    },
    {
      name: 'a caller chat did not start takes the default profile',
      args: SCHEDULE_ARGS,
      setup: { callerProfile: null },
      draft: {
        id: null,
        name: 'Morning review',
        target: { projectDir: '/caller' },
        profile: 'first',
        prompt: 'review the diff',
        schedule: { kind: 'daily', time: '09:00' },
        controls: capped({}),
        paused: false,
        attended: false,
      },
    },
    {
      name: 'folder given',
      args: { ...SCHEDULE_ARGS, folder: '/other' },
      setup: { callerFolder: null },
      draft: {
        id: null,
        name: 'Morning review',
        target: { projectDir: '/other' },
        profile: 'home',
        prompt: 'review the diff',
        schedule: { kind: 'daily', time: '09:00' },
        controls: capped({}),
        paused: false,
        attended: false,
      },
    },
    {
      name: 'project given',
      args: { ...SCHEDULE_ARGS, project: 'AI Dev' },
      draft: {
        id: null,
        name: 'Morning review',
        target: { project: 'AI Dev' },
        profile: 'home',
        prompt: 'review the diff',
        schedule: { kind: 'daily', time: '09:00' },
        controls: capped({}),
        paused: false,
        attended: false,
      },
    },
    {
      name: 'a project with its own profile and no profile',
      args: { ...SCHEDULE_ARGS, project: 'New Games' },
      draft: {
        id: null,
        name: 'Morning review',
        target: { project: 'New Games' },
        profile: 'work',
        prompt: 'review the diff',
        schedule: { kind: 'daily', time: '09:00' },
        controls: capped({}),
        paused: false,
        attended: false,
      },
    },
    {
      name: 'profile given',
      args: { ...SCHEDULE_ARGS, profile: 'work' },
      draft: {
        id: null,
        name: 'Morning review',
        target: { projectDir: '/caller' },
        profile: 'work',
        prompt: 'review the diff',
        schedule: { kind: 'daily', time: '09:00' },
        controls: capped({}),
        paused: false,
        attended: false,
      },
    },
    {
      name: 'controls given are capped at the session’s',
      args: { ...SCHEDULE_ARGS, controls: { mode: 'auto', model: 'opus' } },
      draft: {
        id: null,
        name: 'Morning review',
        target: { projectDir: '/caller' },
        profile: 'home',
        prompt: 'review the diff',
        schedule: { kind: 'daily', time: '09:00' },
        controls: capped({ mode: 'auto', model: 'opus' }),
        paused: false,
        attended: false,
      },
    },
  ])(
    'scheduleTask_Args_SavesTheDraft: $name',
    async ({ args, setup, draft }) => {
      const { save, session } = harness(setup);

      const result = await session.call('schedule_task', args, CONTEXT);

      expect(result.isError ?? false).toBe(false);
      expect(result.content[0]?.text).toBe(
        'Scheduled task f0e1d2c3: Morning review, Daily at 09:00.',
      );
      expect(save).toHaveBeenCalledExactlyOnceWith(draft);
    },
  );

  it.each<{ name: string; args: object; setup?: Setup; error: string }>([
    {
      name: 'blank name',
      args: { ...SCHEDULE_ARGS, name: '  ' },
      error: 'name',
    },
    {
      name: 'blank prompt',
      args: { ...SCHEDULE_ARGS, prompt: '' },
      error: 'prompt',
    },
    {
      name: 'a bad schedule',
      args: { ...SCHEDULE_ARGS, schedule: { kind: 'daily', time: '9am' } },
      error: 'schedule.',
    },
    {
      name: 'folder and project together',
      args: { ...SCHEDULE_ARGS, folder: '/other', project: 'AI Dev' },
      error: 'folder',
    },
    {
      name: 'a relative folder',
      args: { ...SCHEDULE_ARGS, folder: 'other' },
      error: 'folder',
    },
    {
      name: 'a folder stat finds nothing at',
      args: { ...SCHEDULE_ARGS, folder: '/gone' },
      setup: { stats: { '/gone': null } },
      error: 'folder',
    },
    {
      name: 'a folder that is a file',
      args: { ...SCHEDULE_ARGS, folder: '/notes.md' },
      setup: { stats: { '/notes.md': FILE } },
      error: 'folder',
    },
    {
      name: 'an unknown project',
      args: { ...SCHEDULE_ARGS, project: 'Elsewhere' },
      error: 'project',
    },
    {
      name: 'an unknown profile',
      args: { ...SCHEDULE_ARGS, profile: 'nobody' },
      error: 'profile',
    },
    {
      name: 'another profile than the project’s own',
      args: { ...SCHEDULE_ARGS, project: 'New Games', profile: 'home' },
      error: 'Project New Games runs under its own profile work.',
    },
    {
      name: 'an unknown control id',
      args: { ...SCHEDULE_ARGS, controls: { effort: 'high' } },
      error: 'Unknown control "effort". Controls: mode, model.',
    },
    {
      name: 'no folder anywhere',
      args: SCHEDULE_ARGS,
      setup: { callerFolder: null },
      error: 'Name folder or project: this session has no folder.',
    },
    {
      name: 'no profile anywhere',
      args: SCHEDULE_ARGS,
      setup: { callerProfile: null, defaultProfile: null },
      error: 'The app has no profile to run the task under.',
    },
  ])(
    'scheduleTask_BadArgs_AnswersAToolError: $name',
    async ({ args, setup, error }) => {
      const { save, session } = harness(setup);

      const result = await session.call('schedule_task', args, CONTEXT);

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain(error);
      expect(save).not.toHaveBeenCalled();
    },
  );

  it('scheduleTask_StoreRejects_AnswersItsReason', async () => {
    const { log, session } = harness({ saveError: 'tasks file is broken' });

    const result = await session.call('schedule_task', SCHEDULE_ARGS, CONTEXT);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('tasks file is broken');
    expect(log).toHaveBeenCalledExactlyOnceWith(
      'schedule_task failed: tasks file is broken',
    );
  });

  it('listScheduledTasks_Views_ListsEachTask', async () => {
    const once: ScheduledTask = {
      ...NIGHTLY,
      id: 'c3d4e5f6',
      name: 'Release notes',
      schedule: { kind: 'once', at: '2026-11-01T08:00' },
    };
    const { session } = harness({
      views: [
        view(WEEKLY, null, [entry(WEEKLY.id, 'finished')]),
        view(NIGHTLY, Date.UTC(2026, 10, 20, 14, 30), [
          entry(NIGHTLY.id, 'skipped'),
          entry(NIGHTLY.id, 'failed'),
        ]),
        view(once, null, [entry(once.id, 'failed')]),
      ],
    });

    const result = await session.call('list_scheduled_tasks', {}, CONTEXT);

    expect(result.content[0]?.text).toBe(
      [
        'b2c3d4e5  Weekly  Mondays at 09:00  next paused  last finished',
        'a1b2c3d4  Nightly  Daily at 02:00  next 2026-11-20T14:30  last skipped',
        'c3d4e5f6  Release notes  Once on 2026-11-01 at 08:00  next none  last failed',
      ].join('\n'),
    );
    expect(result.structuredContent).toEqual({
      tasks: [
        {
          id: 'b2c3d4e5',
          name: 'Weekly',
          schedule: 'Mondays at 09:00',
          nextRun: 'paused',
          lastOutcome: 'finished',
          paused: true,
          attended: false,
        },
        {
          id: 'a1b2c3d4',
          name: 'Nightly',
          schedule: 'Daily at 02:00',
          nextRun: '2026-11-20T14:30',
          lastOutcome: 'skipped',
          paused: false,
          attended: false,
        },
        {
          id: 'c3d4e5f6',
          name: 'Release notes',
          schedule: 'Once on 2026-11-01 at 08:00',
          nextRun: 'none',
          lastOutcome: 'failed',
          paused: false,
          attended: false,
        },
      ],
    });
  });

  it.each<{ case: string; attended: unknown; saved: boolean | null }>([
    { case: 'absent', attended: undefined, saved: false },
    { case: 'true', attended: true, saved: true },
    { case: 'not a boolean', attended: 1, saved: null },
  ])('scheduleTask_Attended: $case', async ({ attended, saved }) => {
    const { save, session } = harness();

    const result = await session.call(
      'schedule_task',
      { ...SCHEDULE_ARGS, attended },
      CONTEXT,
    );

    if (saved === null) {
      expect(result).toMatchObject({
        isError: true,
        content: [{ text: 'attended must be true or false.' }],
      });
      expect(save).not.toHaveBeenCalled();
    } else {
      expect(save.mock.calls[0]?.[0].attended).toBe(saved);
    }
  });

  it('listScheduledTasks_AttendedTask_EndsItsLineAndSetsTheField', async () => {
    const { session } = harness({
      views: [view({ ...NIGHTLY, attended: true }), view(WEEKLY)],
    });

    const result = await session.call('list_scheduled_tasks', {}, CONTEXT);

    expect(result.content[0]?.text).toBe(
      [
        'a1b2c3d4  Nightly  Daily at 02:00  next none  last none  attended',
        'b2c3d4e5  Weekly  Mondays at 09:00  next paused  last none',
      ].join('\n'),
    );
    expect(result.structuredContent).toMatchObject({
      tasks: [{ attended: true }, { attended: false }],
    });
  });

  it('listScheduledTasks_NoViews_SaysSo', async () => {
    const { session } = harness({ views: [] });

    const result = await session.call('list_scheduled_tasks', {}, CONTEXT);

    expect(result.content[0]?.text).toBe('No scheduled tasks.');
  });

  it.each<{
    name: string;
    args: object;
    draft?: TaskDraft;
    capped?: boolean;
    text: string;
    error?: boolean;
  }>([
    {
      name: 'name only keeps the rest and caps the kept controls',
      args: { id: NIGHTLY.id, name: 'Nightly checks' },
      draft: {
        ...draftOf(NIGHTLY),
        name: 'Nightly checks',
        controls: capped({ mode: 'auto' }),
      },
      text: 'Updated Nightly checks: Daily at 02:00, active.',
    },
    {
      name: 'schedule only',
      args: { id: NIGHTLY.id, schedule: { kind: 'hourly', minute: 15 } },
      draft: {
        ...draftOf(NIGHTLY),
        schedule: { kind: 'hourly', minute: 15 },
        controls: capped({ mode: 'auto' }),
      },
      text: 'Updated Nightly: Hourly at :15, active.',
    },
    {
      name: 'prompt only caps a user’s auto task at the session’s mode',
      args: { id: NIGHTLY.id, prompt: 'delete the build folder' },
      draft: {
        ...draftOf(NIGHTLY),
        prompt: 'delete the build folder',
        controls: capped({ mode: 'auto' }),
      },
      text: 'Updated Nightly: Daily at 02:00, active.',
    },
    {
      name: 'folder replaces a project target',
      args: { id: NIGHTLY.id, folder: '/other' },
      draft: {
        ...draftOf(NIGHTLY),
        target: { projectDir: '/other' },
        controls: capped({ mode: 'auto' }),
      },
      text: 'Updated Nightly: Daily at 02:00, active.',
    },
    {
      name: 'a project with its own profile takes that profile',
      args: { id: NIGHTLY.id, project: 'New Games' },
      draft: {
        ...draftOf(NIGHTLY),
        target: { project: 'New Games' },
        profile: 'work',
        controls: capped({ mode: 'auto' }),
      },
      text: 'Updated Nightly: Daily at 02:00, active.',
    },
    {
      name: 'controls are replaced and capped',
      args: { id: NIGHTLY.id, controls: { mode: 'plan' } },
      draft: { ...draftOf(NIGHTLY), controls: capped({ mode: 'plan' }) },
      text: 'Updated Nightly: Daily at 02:00, active.',
    },
    {
      name: 'a pause alone leaves the controls uncapped',
      args: { id: NIGHTLY.id, paused: true },
      draft: { ...draftOf(NIGHTLY), paused: true },
      capped: false,
      text: 'Updated Nightly: Daily at 02:00, paused.',
    },
    {
      name: 'a resume caps the kept controls',
      args: { id: WEEKLY.id, paused: false },
      draft: {
        ...draftOf(WEEKLY),
        paused: false,
        controls: capped({ mode: 'acceptEdits' }),
      },
      text: 'Updated Weekly: Mondays at 09:00, active.',
    },
    {
      name: 'no field',
      args: { id: NIGHTLY.id },
      text: 'Name at least one field to change.',
      error: true,
    },
    {
      name: 'an unknown id',
      args: { id: 'ffffffff', name: 'X' },
      text: 'No scheduled task ffffffff.',
      error: true,
    },
  ])('updateScheduledTask_Args_ReplacesOnlyGivenFields: $name', async (row) => {
    const { save, capControls, session } = harness();

    const result = await session.call(
      'update_scheduled_task',
      row.args,
      CONTEXT,
    );

    expect(result.content[0]?.text).toBe(row.text);
    expect(result.isError ?? false).toBe(row.error ?? false);
    if (row.draft === undefined) {
      expect(save).not.toHaveBeenCalled();
    } else {
      expect(save).toHaveBeenCalledExactlyOnceWith(row.draft);
    }
    if (row.capped === false) {
      expect(capControls).not.toHaveBeenCalled();
    }
  });

  it.each<{ name: string; args: object; setup?: Setup; error: string }>([
    {
      name: 'a bad schedule',
      args: {
        id: NIGHTLY.id,
        schedule: { kind: 'weekly', day: 9, time: '09:00' },
      },
      error: 'schedule.',
    },
    {
      name: 'folder and project together',
      args: { id: NIGHTLY.id, folder: '/other', project: 'AI Dev' },
      error: 'folder',
    },
    {
      name: 'a relative folder',
      args: { id: NIGHTLY.id, folder: 'other' },
      error: 'folder',
    },
    {
      name: 'a folder that is a file',
      args: { id: NIGHTLY.id, folder: '/notes.md' },
      setup: { stats: { '/notes.md': FILE } },
      error: 'folder',
    },
    {
      name: 'an unknown project',
      args: { id: NIGHTLY.id, project: 'Elsewhere' },
      error: 'project',
    },
    {
      name: 'an unknown profile',
      args: { id: NIGHTLY.id, profile: 'nobody' },
      error: 'profile',
    },
    {
      name: 'another profile than the project’s own',
      args: { id: NIGHTLY.id, project: 'New Games', profile: 'home' },
      error: 'Project New Games runs under its own profile work.',
    },
    {
      name: 'an unknown control id',
      args: { id: NIGHTLY.id, controls: { effort: 'high' } },
      error: 'Unknown control "effort". Controls: mode, model.',
    },
    {
      name: 'a blank name',
      args: { id: NIGHTLY.id, name: ' ' },
      error: 'name',
    },
  ])(
    'updateScheduledTask_BadArgs_AnswersAToolError: $name',
    async ({ args, setup, error }) => {
      const { save, session } = harness(setup);

      const result = await session.call('update_scheduled_task', args, CONTEXT);

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain(error);
      expect(save).not.toHaveBeenCalled();
    },
  );

  it.each<{ case: string; attended: unknown; saved: boolean | null }>([
    { case: 'true', attended: true, saved: true },
    { case: 'false', attended: false, saved: false },
    { case: 'not a boolean', attended: 'yes', saved: null },
  ])(
    'updateScheduledTask_Attended_ReplacesOnlyIt: $case',
    async ({ attended, saved }) => {
      const { save, session } = harness({
        views: [view({ ...NIGHTLY, attended: !saved })],
      });

      const result = await session.call(
        'update_scheduled_task',
        { id: NIGHTLY.id, attended },
        CONTEXT,
      );

      if (saved === null) {
        expect(result.content[0]?.text).toBe(
          'attended must be true or false.',
        );
        expect(save).not.toHaveBeenCalled();
      } else {
        expect(save).toHaveBeenCalledExactlyOnceWith({
          ...draftOf(NIGHTLY),
          controls: capped({ mode: 'auto' }),
          attended: saved,
        });
      }
    },
  );

  it('updateScheduledTask_StoreRejects_AnswersItsReason', async () => {
    const { log, session } = harness({ saveError: 'write failed' });

    const result = await session.call(
      'update_scheduled_task',
      { id: NIGHTLY.id, name: 'X' },
      CONTEXT,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('write failed');
    expect(log).toHaveBeenCalledExactlyOnceWith(
      'update_scheduled_task failed: write failed',
    );
  });

  it.each([
    {
      id: NIGHTLY.id,
      text: 'Removed Nightly.',
      removed: [NIGHTLY.id],
      error: false,
    },
    {
      id: 'ffffffff',
      text: 'No scheduled task ffffffff.',
      removed: [],
      error: true,
    },
  ])('removeScheduledTask_Id_RemovesOrRefuses: $id', async (row) => {
    const { remove, session } = harness();

    const result = await session.call(
      'remove_scheduled_task',
      { id: row.id },
      CONTEXT,
    );

    expect(result.content[0]?.text).toBe(row.text);
    expect(result.isError ?? false).toBe(row.error);
    expect(remove.mock.calls.map(([id]) => id)).toEqual(row.removed);
  });
});
