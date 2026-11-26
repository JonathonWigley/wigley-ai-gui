import type { Files } from '../../../contracts/files';
import type { Paths } from '../../../contracts/paths';
import type { SelfTestGroup, SelfTestScript } from '../../../contracts/plugin';
import type { HostedExit, HostedRun } from '../../../contracts/session-host';
import type { ChatMainExports } from '../../chat/contract';
import type { ScheduledTask, TaskDraft } from '../contract';
import type { ScheduledRunRecord } from './run-records';

// The self-test's project folder, made under the self-test's home. Its name
// names the run rows' sessions in chat's page lines.
const SELFTEST_PROJECT_NAME = 'scheduling-selftest';
const TASK_NAME = 'Self-test task';
const PROMPT = 'scheduled self-test';
// Chat's default profile, so the editor offers it and `prepareLaunch` takes it.
const PROFILE = 'work';
const HOUR_MS = 60 * 60 * 1000;
const LEFT_ACTIVE =
  'the fixture task was left active, so the session host keeps a pending run';

// No step presses `r`: a Run now would queue a spawn on the self-test's real
// session host. Every group that resumes the task pauses it again, so the host
// keeps no pending entry.
const GROUPS: SelfTestGroup[] = [
  {
    name: 'schedules mode',
    why: 'Space k t shows Schedules mode with the paused task, its details and its three history rows.',
    steps: [
      {
        keys: [' ', 'k', 't'],
        expect: '[scheduling] mode shown: 1 tasks',
        screenshot: 'mode',
      },
      { keys: ['k'], expect: '[scheduling] task selected: new' },
      { keys: ['j'], expect: `[scheduling] task selected: ${TASK_NAME}` },
      {
        keys: ['Enter'],
        expect: `[scheduling] details focused: ${TASK_NAME}`,
        screenshot: 'details',
      },
    ],
  },
  {
    name: 'pause and resume',
    why: "p resumes and pauses the selected task through main's store, and the page shows it.",
    steps: [
      { keys: ['p'], expect: `[scheduling] resumed: ${TASK_NAME}` },
      {
        keys: ['p'],
        expect: `[scheduling] paused: ${TASK_NAME}`,
        screenshot: 'paused',
      },
    ],
  },
  {
    name: 'editor',
    why: "The editor opens with the task's values, saves through main, and refuses a new task with no name.",
    steps: [
      {
        keys: ['i'],
        expect: `[scheduling] editor opened: ${TASK_NAME}`,
        screenshot: 'editor',
      },
      {
        keys: ['<D-Enter>'],
        expect: `[scheduling] task saved: ${TASK_NAME}`,
        alsoExpect: [/^\[scheduling\] editor closed$/],
      },
      { keys: ['a'], expect: '[scheduling] editor opened: new' },
      {
        keys: ['<D-Enter>'],
        expect: '[scheduling] save refused: Name is empty.',
        screenshot: 'refused',
      },
      { keys: ['Escape'], expect: '[scheduling] editor closed' },
    ],
  },
  {
    name: 'open a run row',
    why: 'The finished history row opens its run row in Sessions mode, and viewing it clears the done mark.',
    steps: [
      {
        keys: ['G', 'Enter'],
        expect: `[chat] Chat tab shown in ${SELFTEST_PROJECT_NAME}`,
        alsoExpect: [
          /^\[scheduling\] run row opened: \S+$/,
          /^\[scheduling\] run row viewed: \S+$/,
        ],
        screenshot: 'run-row',
        why: "History lists the runs newest first, so G moves to the oldest, the finished run, whose row is linked; the details hold focus after the editor's Escape.",
      },
    ],
  },
];

export interface SchedulingSelfTestDeps {
  homeDir: string;
  files: Pick<Files, 'makeFolder' | 'realPath'>;
  paths: Paths;
  now: () => number;
  chat: Pick<ChatMainExports, 'prepareLaunch' | 'closeSessionsIn'>;
  store: {
    save(draft: TaskDraft): Promise<string>;
    tasks(): ScheduledTask[];
    remove(id: string): Promise<void>;
  };
  adoptRun(run: HostedRun): Promise<void>;
}

interface SchedulingSelfTestResult {
  isPaused(): boolean;
}

// One fixture run: prepared through chat, so its record carries a real adopt
// request, and handed to main's adoption step as the host would hand it.
interface FixtureRun {
  hoursAgo: number;
  skipped: boolean;
  exit: HostedExit | null;
}

// Adopted in this order, so history lists them newest first as failed,
// skipped, finished. The finished run's process is gone, so its adoption opens
// a resting row that main records finished and unviewed.
const FIXTURE_RUNS: FixtureRun[] = [
  {
    hoursAgo: 3,
    skipped: false,
    exit: { code: 0, signal: null, error: null },
  },
  { hoursAgo: 2, skipped: true, exit: null },
  {
    hoursAgo: 1,
    skipped: false,
    exit: { code: null, signal: null, error: 'spawn ENOENT' },
  },
];

// Each run closes the sessions an earlier run left in the project folder and
// removes the task it saved, since `open` runs on each page load, then saves
// one paused task and feeds three fixture runs of it through main's adoption
// step. `problems` fails the run when the task is not paused at its end.
export function schedulingSelfTestScript(
  deps: SchedulingSelfTestDeps,
): SelfTestScript {
  const { homeDir, files, paths, now, chat, store, adoptRun } = deps;
  let made: Promise<string> | null = null;

  async function makeProject(): Promise<string> {
    const projectDir = paths.join(
      await files.realPath(homeDir),
      SELFTEST_PROJECT_NAME,
    );
    await files.makeFolder(projectDir);
    return projectDir;
  }

  const fixtureTasks = (): ScheduledTask[] =>
    store.tasks().filter((task) => task.name === TASK_NAME);

  async function openFixture(
    projectDir: string,
  ): Promise<SchedulingSelfTestResult> {
    await chat.closeSessionsIn(projectDir);
    for (const task of fixtureTasks()) {
      await store.remove(task.id);
    }
    const taskId = await store.save({
      id: null,
      name: TASK_NAME,
      target: { projectDir },
      profile: PROFILE,
      prompt: PROMPT,
      schedule: { kind: 'daily', time: '09:00' },
      controls: {},
      paused: true,
      attended: false,
    });
    const startedAt = now();
    for (const fixture of FIXTURE_RUNS) {
      const launch = await chat.prepareLaunch(
        {
          projectDir,
          profile: PROFILE,
          message: { text: PROMPT, images: [] },
          headless: true,
        },
        {},
      );
      const at = startedAt - fixture.hoursAgo * HOUR_MS;
      const record: ScheduledRunRecord = {
        taskId,
        occurrence: at,
        adopt: launch.adopt,
      };
      await adoptRun({
        id: launch.spawn.id,
        record,
        startedAt: at,
        skipped: fixture.skipped,
        exit: fixture.exit,
      });
    }
    return {
      isPaused: () => fixtureTasks().every((task) => task.paused),
    };
  }

  return {
    pageBinds: [],
    settings: {},
    scrollsItself: [],
    open() {
      made ??= makeProject().catch((error: unknown) => {
        made = null;
        throw error;
      });
      return {
        shownLine: '[scheduling] run rows: 1',
        alsoShown: [/^\[scheduling\] run row done: \S+$/],
        result: made.then(openFixture),
      };
    },
    groups: GROUPS,
    problems: (result) =>
      (result as SchedulingSelfTestResult).isPaused() ? [] : [LEFT_ACTIVE],
  };
}
