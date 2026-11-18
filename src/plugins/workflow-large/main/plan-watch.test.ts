import { describe, expect, it } from 'vitest';
import type { FileStat, FileWatch } from '../../../contracts/files';
import {
  createMemoryFiles,
  type MemoryFiles,
} from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import type { WorkflowSignal } from '../../workflow/contract';
import { readPlanProgress } from '../../../shared/plan-progress';
import { largeSignal } from '../contract';
import {
  createPlanWatch,
  type FollowedPlan,
  MAX_WATCH_REOPENS,
  type PlanWatch,
} from './plan-watch';

type WatchDeps = Parameters<typeof createPlanWatch>[0];

const PLAN_DIR = '/r/docs/features/x/plan-a';
const PLAN_FILE = `${PLAN_DIR}/plan.md`;
const PLAN = '# Plan A — plan\n\n## Tasks\n\n- [x] one\n- [ ] two\n';
const PLAN_TICKED = '# Plan A — plan\n\n## Tasks\n\n- [x] one\n- [x] two\n';
// The plan folder's copy in the worktrees `/w` and `/w2` of the clone `/r`.
const W_PLAN_DIR = '/w/docs/features/x/plan-a';
const W2_PLAN_DIR = '/w2/docs/features/x/plan-a';
const GIT_FOLDER = '/r/.git';
const WORKTREES_FOLDER = `${GIT_FOLDER}/worktrees`;
const PLAN_GONE = largeSignal({ type: 'planGone' });

// A three-task plan with its first `ticks` tasks ticked.
function planTicked(ticks: number): string {
  const boxes = ['one', 'two', 'three'].map(
    (task, index) => `- [${index < ticks ? 'x' : ' '}] ${task}\n`,
  );
  return `# Plan A — plan\n\n## Tasks\n\n${boxes.join('')}`;
}

const PLAN_NONE = planTicked(0);
const PLAN_ONE = planTicked(1);
const PLAN_TWO = planTicked(2);
const PLAN_ALL = planTicked(3);

const settled = () => new Promise((settle) => setImmediate(settle));

// The plan a flow holding `planDir` follows.
function followed(
  planDir: string | null,
  planReported = false,
  unreportedPlanDir: string | null = null,
): FollowedPlan {
  return { planDir, planReported, unreportedPlanDir };
}

// Git that finds every folder outside a clone, so each plan has one copy.
const NO_CLONE: WatchDeps['git'] = {
  topLevel: async () => null,
  worktrees: async () => [],
  commonDir: async () => GIT_FOLDER,
};

// Git of the clone `/r`, whose git folder is `/r/.git`: `checkouts` are its
// main tree and worktrees, read at each list, so a test adds one by pushing.
// A folder's top is its own checkout, `/r` or a `/w` one.
function cloneGit(checkouts: string[]): WatchDeps['git'] {
  return {
    topLevel: async (folder) => /^\/(r|w\d*)(?=\/|$)/.exec(folder)?.[0] ?? null,
    worktrees: async () =>
      checkouts.map((path, index) => ({
        path,
        branch: null,
        isMain: index === 0,
      })),
    commonDir: async () => GIT_FOLDER,
  };
}

// Memory files whose writes `writeAt` stamps with the time it is given.
function clockedFiles() {
  let now = 0;
  const files = createMemoryFiles({ now: () => now });
  const writeAt = async (at: number, path: string, text: string) => {
    now = at;
    await files.write(path, text);
  };
  return { files, writeAt };
}

// A plan watch over `files` and `git`, recording every signal it gives and
// every line it logs.
function startWatch(files: WatchDeps['files'], git = NO_CLONE) {
  const signals: WorkflowSignal[] = [];
  const logs: string[] = [];
  const watch = createPlanWatch({
    git,
    files,
    paths: posixPaths,
    log: (line) => logs.push(line),
    signal: (_sessionId, signal) => signals.push(signal),
  });
  return { watch, signals, logs };
}

// `files` whose open watches `openFolders` lists, one entry per watch;
// `fail` ends each open watch on a folder as a failing watcher does, disposing
// it and then calling its `onError`. While `holdStats` is on, a stat of git's
// `worktrees` folder is taken at once and settles when `releaseStats` runs.
function trackedFiles(files: MemoryFiles) {
  const open: { folder: string; dispose(): void; onError?(): void }[] = [];
  let heldStats: (() => void)[] | null = null;
  const tracked: WatchDeps['files'] = {
    ...files,
    watch: (folder, onChange, options) => {
      const inner = files.watch(folder, onChange, options);
      const watch: FileWatch = {
        dispose: () => {
          inner.dispose();
          const index = open.indexOf(entry);
          if (index !== -1) {
            open.splice(index, 1);
          }
        },
      };
      const entry = {
        folder,
        dispose: watch.dispose,
        onError: () => options?.onError?.(new Error('watcher failed')),
      };
      open.push(entry);
      return watch;
    },
    stat: async (path) => {
      const stat = await files.stat(path);
      if (heldStats === null || path !== WORKTREES_FOLDER) {
        return stat;
      }
      const held = heldStats;
      return new Promise<FileStat | null>((settle) => {
        held.push(() => settle(stat));
      });
    },
  };
  return {
    files: tracked,
    openFolders: () => open.map((watch) => watch.folder).sort(),
    fail: (folder: string) => {
      for (const watch of open.filter((each) => each.folder === folder)) {
        watch.dispose();
        watch.onError?.();
      }
    },
    holdStats: () => {
      heldStats = [];
    },
    // Settles the held stats newest first, and stops holding.
    releaseStats: async () => {
      const held = heldStats ?? [];
      heldStats = null;
      for (const settle of held.reverse()) {
        settle();
        await settled();
      }
    },
  };
}

// Fails the watch on `folder` `times` times, letting each reopen settle.
async function failTimes(
  subject: ReturnType<typeof trackedFiles>,
  folder: string,
  times: number,
) {
  for (let time = 0; time < times; time++) {
    subject.fail(folder);
    await settled();
  }
}

function changed(
  text: string,
  taskTexts: ReadonlyMap<string, string> = new Map(),
): WorkflowSignal {
  return largeSignal({
    type: 'planChanged',
    progress: readPlanProgress(text, taskTexts),
  });
}

describe('createPlanWatch', () => {
  it('follow_SignalsEachPlanChange_AndPlanGoneOnceWhenDeleted', async () => {
    const files = createMemoryFiles();
    await files.write(PLAN_FILE, PLAN);
    const { watch, signals } = startWatch(files);

    watch.follow('s1', followed(PLAN_DIR));
    await settled();
    await files.write(PLAN_FILE, PLAN_TICKED);
    await settled();
    files.remove(PLAN_DIR);
    await settled();
    watch.check('s1');
    await files.write(PLAN_FILE, PLAN);
    await settled();
    watch.check('s1');
    await settled();

    expect(signals).toEqual([changed(PLAN), changed(PLAN_TICKED), PLAN_GONE]);
  });

  it.each([
    {
      closedBy: 'planGone',
      watchFailsOnce: false,
      close: async (files: MemoryFiles) => {
        files.remove(PLAN_DIR);
        await settled();
      },
    },
    {
      closedBy: 'a watch that failed to open',
      watchFailsOnce: true,
      close: async () => undefined,
    },
  ])(
    'follow_TheSameFolderAfterTheWatchClosed_WatchesItAgain ($closedBy)',
    async ({ watchFailsOnce, close }) => {
      const files = createMemoryFiles();
      await files.write(PLAN_FILE, PLAN);
      let watchFails = watchFailsOnce;
      const { watch, signals } = startWatch({
        ...files,
        watch: (folder, onChange, options) => {
          if (watchFails) {
            watchFails = false;
            throw new Error('watch refused');
          }
          return files.watch(folder, onChange, options);
        },
      });
      watch.follow('s1', followed(PLAN_DIR));
      await settled();
      await close(files);
      await files.write(PLAN_FILE, PLAN_TICKED);
      signals.length = 0;

      watch.follow('s1', followed(PLAN_DIR));
      await settled();

      expect(signals).toEqual([changed(PLAN_TICKED)]);
    },
  );

  it('follow_AMissingFolder_SignalsPlanGoneAndMakesNoFolder', async () => {
    const files = createMemoryFiles();
    const { watch, signals } = startWatch(files);

    watch.follow('s1', followed(PLAN_DIR));
    await settled();

    expect(signals).toEqual([PLAN_GONE]);
    expect(await files.stat(PLAN_DIR)).toBeNull();
  });

  it.each([
    {
      name: 'the watch moved',
      act: async (
        watch: PlanWatch,
        resolveReads: ((text: string) => void)[],
      ) => {
        watch.follow('s1', followed(null));
        resolveReads[0](PLAN);
      },
      signals: [],
    },
    {
      name: 'a newer read started',
      act: async (
        watch: PlanWatch,
        resolveReads: ((text: string) => void)[],
      ) => {
        watch.check('s1');
        await settled();
        resolveReads[1](PLAN_TICKED);
        resolveReads[0](PLAN);
      },
      signals: [changed(PLAN_TICKED)],
    },
  ])('read_SettlingLate_IsDropped ($name)', async ({ act, signals }) => {
    const files = createMemoryFiles();
    await files.write(PLAN_FILE, PLAN);
    const resolveReads: ((text: string) => void)[] = [];
    const subject = startWatch({
      ...files,
      read: () =>
        new Promise<string>((resolve) => {
          resolveReads.push(resolve);
        }),
    });
    subject.watch.follow('s1', followed(PLAN_DIR));
    await settled();

    await act(subject.watch, resolveReads);
    await settled();

    expect(subject.signals).toEqual(signals);
  });

  it('follow_PlanInTwoCheckouts_SignalsTheMovedCopy', async () => {
    const { files, writeAt } = clockedFiles();
    await writeAt(10, PLAN_FILE, PLAN_NONE);
    await writeAt(20, `${W_PLAN_DIR}/plan.md`, PLAN_ONE);
    const { watch, signals } = startWatch(files, cloneGit(['/r', '/w']));

    watch.follow('s1', followed(PLAN_DIR));
    await settled();
    await writeAt(30, `${W_PLAN_DIR}/plan.md`, PLAN_TWO);
    await settled();
    // A checkout rewrites the main copy's time and not its progress.
    await writeAt(40, PLAN_FILE, PLAN_NONE);
    await settled();
    await writeAt(50, PLAN_FILE, PLAN_ALL);
    await settled();

    expect(signals).toEqual([
      changed(PLAN_ONE),
      changed(PLAN_TWO),
      changed(PLAN_TWO),
      changed(PLAN_ALL),
    ]);
  });

  it('follow_TaskDocumentStatusChanges_SignalsItsStatus', async () => {
    const plan = '# Plan A — plan\n\n## Tasks\n\n- [ ] [Task A](01-a.md)\n';
    const task = '# 01 — Task A\n\nStatus: in progress\n';
    const files = createMemoryFiles();
    await files.write(PLAN_FILE, plan);
    const { watch, signals } = startWatch(files);

    watch.follow('s1', followed(PLAN_DIR));
    await settled();
    await files.write(`${PLAN_DIR}/01-a.md`, task);
    await settled();

    expect(signals).toEqual([
      changed(plan),
      changed(plan, new Map([['01-a.md', task]])),
    ]);
    expect(signals).toContainEqual(
      largeSignal({
        type: 'planChanged',
        progress: expect.objectContaining({
          tasks: [expect.objectContaining({ status: 'in progress' })],
        }),
      }),
    );
  });

  it.each([
    {
      by: 'a change to git worktrees folder',
      listed: ['/r'],
      added: '/w',
      step: (_watch: PlanWatch, files: MemoryFiles) =>
        files.write(`${GIT_FOLDER}/worktrees/w/gitdir`, '/w/.git'),
      deafGitFolder: false,
      signals: [changed(PLAN_ONE), changed(PLAN_TWO), changed(PLAN_ALL)],
    },
    {
      by: 'check',
      listed: ['/r'],
      added: '/w',
      step: async (watch: PlanWatch) => watch.check('s1'),
      deafGitFolder: false,
      signals: [changed(PLAN_ONE), changed(PLAN_TWO), changed(PLAN_ALL)],
    },
    {
      by: 'another change in git folder',
      listed: ['/r'],
      added: '/w',
      step: (_watch: PlanWatch, files: MemoryFiles) =>
        files.write(`${GIT_FOLDER}/index`, 'index'),
      deafGitFolder: false,
      signals: [changed(PLAN_ONE)],
    },
    {
      by: 'a second worktree in the worktrees folder',
      listed: ['/r', '/w'],
      added: '/w2',
      step: (_watch: PlanWatch, files: MemoryFiles) =>
        files.write(`${GIT_FOLDER}/worktrees/w2/gitdir`, '/w2/.git'),
      // The git folder watch hears the nested write as `worktrees`, as Node's
      // may not, so only the `worktrees` watch can bring the new copy in.
      deafGitFolder: true,
      signals: [changed(PLAN_TWO), changed(PLAN_TWO), changed(PLAN_ALL)],
    },
  ])(
    'listAgain_WorktreeAdded_WatchesTheNewCopy ($by)',
    async ({ listed, added, step, deafGitFolder, signals: expected }) => {
      const { files, writeAt } = clockedFiles();
      await files.write(`${GIT_FOLDER}/HEAD`, 'ref: refs/heads/main');
      if (listed.includes('/w')) {
        await files.write(`${GIT_FOLDER}/worktrees/w/gitdir`, '/w/.git');
      }
      await writeAt(10, PLAN_FILE, PLAN_ONE);
      for (const planDir of [W_PLAN_DIR, W2_PLAN_DIR]) {
        await writeAt(5, `${planDir}/plan.md`, PLAN_TWO);
      }
      const checkouts = [...listed];
      const watchedFiles: WatchDeps['files'] = deafGitFolder
        ? {
            ...files,
            watch: (folder, onChange, options) =>
              files.watch(
                folder,
                (path) => {
                  if (folder !== GIT_FOLDER || path !== 'worktrees') {
                    onChange(path);
                  }
                },
                options,
              ),
          }
        : files;
      const { watch, signals } = startWatch(watchedFiles, cloneGit(checkouts));
      watch.follow('s1', followed(PLAN_DIR));
      await settled();

      checkouts.push(added);
      await step(watch, files);
      await settled();
      await writeAt(30, `${added}/docs/features/x/plan-a/plan.md`, PLAN_ALL);
      await settled();

      expect(signals).toEqual(expected);
    },
  );

  // Breaks if a missed burst on a copy folder does not read again, one on
  // git's folder does not list again, or a list reopens a copy watch it keeps,
  // which on macOS sets off another missed burst.
  it.each([
    {
      on: 'a copy folder',
      folder: PLAN_DIR,
      act: async (
        _checkouts: string[],
        writeAt: ReturnType<typeof clockedFiles>['writeAt'],
      ) => writeAt(30, PLAN_FILE, PLAN_ALL),
      opened: [PLAN_DIR, GIT_FOLDER],
      signals: [changed(PLAN_ONE), changed(PLAN_ALL)],
    },
    {
      on: 'git folder',
      folder: GIT_FOLDER,
      act: async (
        checkouts: string[],
        _writeAt: ReturnType<typeof clockedFiles>['writeAt'],
      ) => {
        checkouts.push('/w');
      },
      opened: [PLAN_DIR, GIT_FOLDER, W_PLAN_DIR],
      signals: [changed(PLAN_ONE), changed(PLAN_TWO)],
    },
    {
      on: 'worktrees folder',
      folder: WORKTREES_FOLDER,
      // The folder exists before the follow, so its watch is open.
      seeded: `${WORKTREES_FOLDER}/old/gitdir`,
      act: async (
        checkouts: string[],
        _writeAt: ReturnType<typeof clockedFiles>['writeAt'],
      ) => {
        checkouts.push('/w');
      },
      opened: [PLAN_DIR, GIT_FOLDER, WORKTREES_FOLDER, W_PLAN_DIR],
      signals: [changed(PLAN_ONE), changed(PLAN_TWO)],
    },
  ])(
    'onMissed_WriteTheWatchDidNotReport_ReadsAgain ($on)',
    async ({
      folder,
      seeded,
      act,
      opened: expectedOpened,
      signals: expected,
    }) => {
      const { files, writeAt } = clockedFiles();
      await files.write(`${GIT_FOLDER}/HEAD`, 'ref: refs/heads/main');
      if (seeded !== undefined) {
        await files.write(seeded, '/old/.git');
      }
      await writeAt(10, PLAN_FILE, PLAN_ONE);
      await writeAt(20, `${W_PLAN_DIR}/plan.md`, PLAN_TWO);
      const opened: string[] = [];
      const missedOn = new Map<string, () => void>();
      const deafFiles: WatchDeps['files'] = {
        ...files,
        watch: (watched, _onChange, options) => {
          opened.push(watched);
          missedOn.set(watched, () => options?.onMissed?.());
          return { dispose: () => undefined };
        },
      };
      const checkouts = ['/r'];
      const { watch, signals } = startWatch(deafFiles, cloneGit(checkouts));
      watch.follow('s1', followed(PLAN_DIR));
      await settled();

      await act(checkouts, writeAt);
      missedOn.get(folder)?.();
      await settled();

      expect(signals).toEqual(expected);
      expect(opened.sort()).toEqual([...expectedOpened].sort());
    },
  );

  // `failed` is the folder whose watcher error the log names, null for none.
  it.each([
    {
      name: 'the worktrees folder removed',
      act: async (
        _subject: ReturnType<typeof trackedFiles>,
        files: MemoryFiles,
      ) => {
        files.remove(WORKTREES_FOLDER);
      },
      open: [GIT_FOLDER, PLAN_DIR, W_PLAN_DIR],
      failed: null,
    },
    {
      name: 'two worktrees syncs settling out of order',
      act: async (
        subject: ReturnType<typeof trackedFiles>,
        files: MemoryFiles,
      ) => {
        subject.holdStats();
        await files.write(`${WORKTREES_FOLDER}/w/locked`, 'locked');
        await settled();
        files.remove(WORKTREES_FOLDER);
        await settled();
        await subject.releaseStats();
      },
      open: [GIT_FOLDER, PLAN_DIR, W_PLAN_DIR],
      failed: null,
    },
    {
      name: 'the git folder watch failed',
      act: async (subject: ReturnType<typeof trackedFiles>) =>
        subject.fail(GIT_FOLDER),
      open: [GIT_FOLDER, WORKTREES_FOLDER, PLAN_DIR, W_PLAN_DIR],
      failed: GIT_FOLDER,
    },
    {
      name: 'the worktrees watch failed',
      act: async (subject: ReturnType<typeof trackedFiles>) =>
        subject.fail(WORKTREES_FOLDER),
      open: [GIT_FOLDER, WORKTREES_FOLDER, PLAN_DIR, W_PLAN_DIR],
      failed: WORKTREES_FOLDER,
    },
    {
      name: 'a copy watch failed',
      act: async (subject: ReturnType<typeof trackedFiles>) =>
        subject.fail(W_PLAN_DIR),
      open: [GIT_FOLDER, WORKTREES_FOLDER, PLAN_DIR, W_PLAN_DIR],
      failed: W_PLAN_DIR,
    },
    {
      name: 'a copy watch failed up to the reopen bound',
      act: (subject: ReturnType<typeof trackedFiles>) =>
        failTimes(subject, W_PLAN_DIR, MAX_WATCH_REOPENS),
      open: [GIT_FOLDER, WORKTREES_FOLDER, PLAN_DIR, W_PLAN_DIR],
      failed: W_PLAN_DIR,
    },
    {
      name: 'a copy watch failed past the reopen bound',
      act: (subject: ReturnType<typeof trackedFiles>) =>
        failTimes(subject, W_PLAN_DIR, MAX_WATCH_REOPENS + 1),
      open: [GIT_FOLDER, WORKTREES_FOLDER, PLAN_DIR],
      failed: W_PLAN_DIR,
    },
    {
      name: 'a copy watch failed past the reopen bound, then a check',
      act: async (
        subject: ReturnType<typeof trackedFiles>,
        _files: MemoryFiles,
        watch: PlanWatch,
      ) => {
        await failTimes(subject, W_PLAN_DIR, MAX_WATCH_REOPENS + 1);
        watch.check('s1');
      },
      open: [GIT_FOLDER, WORKTREES_FOLDER, PLAN_DIR, W_PLAN_DIR],
      failed: W_PLAN_DIR,
    },
    {
      name: 'a copy watch failed past the bound, a change heard between',
      act: async (
        subject: ReturnType<typeof trackedFiles>,
        files: MemoryFiles,
      ) => {
        await failTimes(subject, W_PLAN_DIR, MAX_WATCH_REOPENS);
        await files.write(`${W_PLAN_DIR}/plan.md`, PLAN_TICKED);
        await settled();
        await failTimes(subject, W_PLAN_DIR, 1);
      },
      open: [GIT_FOLDER, WORKTREES_FOLDER, PLAN_DIR, W_PLAN_DIR],
      failed: W_PLAN_DIR,
    },
  ])(
    'follow_WatchedFolderChangesOrFails_KeepsOneWatchOnEachFolder ($name)',
    async ({ act, open, failed }) => {
      const files = createMemoryFiles();
      await files.write(`${GIT_FOLDER}/HEAD`, 'ref: refs/heads/main');
      await files.write(`${WORKTREES_FOLDER}/w/gitdir`, '/w/.git');
      await files.write(PLAN_FILE, PLAN);
      await files.write(`${W_PLAN_DIR}/plan.md`, PLAN);
      const subject = trackedFiles(files);
      const { watch, logs } = startWatch(subject.files, cloneGit(['/r', '/w']));
      watch.follow('s1', followed(PLAN_DIR));
      await settled();

      await act(subject, files, watch);
      await settled();

      const errorLogs = logs.filter((line) => line.includes('watcher failed'));
      expect(subject.openFolders()).toEqual([...open].sort());
      expect(errorLogs.every((line) => line.includes(String(failed)))).toBe(
        true,
      );
      expect(errorLogs.length > 0).toBe(failed !== null);
    },
  );

  it('follow_OneCopyDeleted_PlanGoneOnlyWhenNoneLeft', async () => {
    const { files, writeAt } = clockedFiles();
    await writeAt(20, PLAN_FILE, PLAN_ONE);
    await writeAt(10, `${W_PLAN_DIR}/plan.md`, PLAN_TWO);
    const { watch, signals } = startWatch(files, cloneGit(['/r', '/w']));
    watch.follow('s1', followed(PLAN_DIR));
    await settled();

    files.remove(PLAN_DIR);
    await settled();
    files.remove(W_PLAN_DIR);
    await settled();
    watch.check('s1');
    await settled();

    expect(signals).toEqual([changed(PLAN_TWO), changed(PLAN_TWO), PLAN_GONE]);
  });

  it.each([
    {
      name: 'beside a newer, different main-tree copy',
      removed: null,
      signals: [changed(PLAN_ONE)],
    },
    {
      name: 'its plan.md deleted',
      removed: `${W_PLAN_DIR}/plan.md`,
      signals: [changed(PLAN_ONE), changed(PLAN_TWO)],
    },
    {
      name: 'its worktree removed',
      removed: '/w',
      signals: [changed(PLAN_ONE), changed(PLAN_TWO)],
    },
  ])(
    'follow_Reported_ReadsThatCopyAlone ($name)',
    async ({ removed, signals: expected }) => {
      const { files, writeAt } = clockedFiles();
      await writeAt(10, `${W_PLAN_DIR}/plan.md`, PLAN_ONE);
      await writeAt(10, `${W_PLAN_DIR}/01-a.md`, '# 01 — A\n');
      await writeAt(20, PLAN_FILE, PLAN_TWO);
      const { watch, signals } = startWatch(files, cloneGit(['/r', '/w']));
      watch.follow('s1', followed(W_PLAN_DIR, true));
      await settled();

      if (removed !== null) {
        files.remove(removed);
        await settled();
      }

      expect(signals).toEqual(expected);
    },
  );

  it.each([
    {
      name: 'held before the report',
      unreportedPlanDir: PLAN_DIR,
      signals: [changed(PLAN_TWO), changed(PLAN_ALL)],
    },
    { name: 'none', unreportedPlanDir: null, signals: [PLAN_GONE] },
  ])(
    'follow_ReportedWorktreeRemoved_ListsFromTheUnreportedFolder ($name)',
    async ({ unreportedPlanDir, signals: expected }) => {
      const files = createMemoryFiles();
      await files.write(PLAN_FILE, PLAN_TWO);
      const { watch, signals } = startWatch(files, cloneGit(['/r']));

      watch.follow('s1', followed(W_PLAN_DIR, true, unreportedPlanDir));
      await settled();
      await files.write(PLAN_FILE, PLAN_ALL);
      await settled();

      expect(signals).toEqual(expected);
    },
  );

  it('follow_ReportedFlagChanges_ReadsAgainWithoutReopening', async () => {
    const { files, writeAt } = clockedFiles();
    await writeAt(10, PLAN_FILE, PLAN_ONE);
    await writeAt(20, `${W_PLAN_DIR}/plan.md`, PLAN_TWO);
    let watchesOpened = 0;
    const { watch, signals } = startWatch(
      {
        ...files,
        watch: (folder, onChange, options) => {
          watchesOpened++;
          return files.watch(folder, onChange, options);
        },
      },
      cloneGit(['/r', '/w']),
    );
    watch.follow('s1', followed(PLAN_DIR));
    await settled();
    const openedBefore = watchesOpened;

    watch.follow('s1', followed(PLAN_DIR, true));
    await settled();

    expect(signals).toEqual([changed(PLAN_TWO), changed(PLAN_ONE)]);
    expect(watchesOpened).toBe(openedBefore);
  });

  it('follow_OpenFails_DisposesWhatItOpened', async () => {
    const files = createMemoryFiles();
    await files.write(PLAN_FILE, PLAN);
    let commonDirFails = true;
    const git: WatchDeps['git'] = {
      ...cloneGit(['/r']),
      commonDir: async () => {
        if (commonDirFails) {
          commonDirFails = false;
          throw new Error('git refused');
        }
        return GIT_FOLDER;
      },
    };
    const { watch, signals } = startWatch(files, git);
    watch.follow('s1', followed(PLAN_DIR));
    await settled();
    await files.write(PLAN_FILE, PLAN_TICKED);
    await settled();

    watch.follow('s1', followed(PLAN_DIR));
    await settled();

    expect(signals).toEqual([changed(PLAN_TICKED)]);
  });
});

describe('createPlanWatch worktree list failures', () => {
  it('logs a failing worktree list once per clone across follows and checks', async () => {
    const files = createMemoryFiles();
    await files.write('/r/docs/features/f/plan-a/plan.md', PLAN);
    const git: WatchDeps['git'] = {
      ...cloneGit(['/r']),
      worktrees: async () => {
        throw new Error('git worktree exited 128');
      },
    };
    const { watch, logs } = startWatch(files, git);

    watch.follow('s1', followed('/r/docs/features/f/plan-a'));
    await settled();
    watch.check('s1');
    await settled();

    expect(
      logs.filter((line) => line.startsWith('git worktree list failed')),
    ).toEqual([
      "git worktree list failed in /r: git worktree exited 128; reading the plan's own copy only",
    ]);
  });
});
