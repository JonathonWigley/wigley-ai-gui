import { describe, expect, it } from 'vitest';
import {
  createMemoryFiles,
  type MemoryFiles,
} from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import type { WorkflowSignal } from '../../workflow/contract';
import { readPlanProgress } from '../../../shared/plan-progress';
import { heavySignal } from '../contract';
import { createPlanWatch, type PlanWatch } from './plan-watch';

type WatchDeps = Parameters<typeof createPlanWatch>[0];

const PLAN_DIR = '/r/docs/features/x/plan-a';
const PLAN_FILE = `${PLAN_DIR}/plan.md`;
const PLAN = '# Plan A — plan\n\n## Tasks\n\n- [x] one\n- [ ] two\n';
const PLAN_TICKED = '# Plan A — plan\n\n## Tasks\n\n- [x] one\n- [x] two\n';
// The plan folder's copy in the worktrees `/w` and `/w2` of the clone `/r`.
const W_PLAN_DIR = '/w/docs/features/x/plan-a';
const W2_PLAN_DIR = '/w2/docs/features/x/plan-a';
const GIT_FOLDER = '/r/.git';
const PLAN_GONE = heavySignal({ type: 'planGone' });

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

// Git that finds every folder outside a clone, so each plan has one copy.
const NO_CLONE: WatchDeps['git'] = {
  topLevel: async () => null,
  worktrees: async () => [],
  commonDir: async () => GIT_FOLDER,
};

// Git of the clone `/r`, whose git folder is `/r/.git`: `checkouts` are its
// main tree and worktrees, read at each list, so a test adds one by pushing.
function cloneGit(checkouts: string[]): WatchDeps['git'] {
  return {
    topLevel: async (folder) =>
      /^\/(r|w\d*)(\/|$)/.test(folder) ? '/r' : null,
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

// A plan watch over `files` and `git`, recording every signal it gives.
function startWatch(files: WatchDeps['files'], git = NO_CLONE) {
  const signals: WorkflowSignal[] = [];
  const watch = createPlanWatch({
    git,
    files,
    paths: posixPaths,
    log: () => undefined,
    signal: (_sessionId, signal) => signals.push(signal),
  });
  return { watch, signals };
}

function changed(
  text: string,
  taskTexts: ReadonlyMap<string, string> = new Map(),
): WorkflowSignal {
  return heavySignal({
    type: 'planChanged',
    progress: readPlanProgress(text, taskTexts),
  });
}

describe('createPlanWatch', () => {
  it('follow_SignalsEachPlanChange_AndPlanGoneOnceWhenDeleted', async () => {
    const files = createMemoryFiles();
    await files.write(PLAN_FILE, PLAN);
    const { watch, signals } = startWatch(files);

    watch.follow('s1', PLAN_DIR);
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
      watch.follow('s1', PLAN_DIR);
      await settled();
      await close(files);
      await files.write(PLAN_FILE, PLAN_TICKED);
      signals.length = 0;

      watch.follow('s1', PLAN_DIR);
      await settled();

      expect(signals).toEqual([changed(PLAN_TICKED)]);
    },
  );

  it('follow_AMissingFolder_SignalsPlanGoneAndMakesNoFolder', async () => {
    const files = createMemoryFiles();
    const { watch, signals } = startWatch(files);

    watch.follow('s1', PLAN_DIR);
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
        watch.follow('s1', null);
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
    subject.watch.follow('s1', PLAN_DIR);
    await settled();

    await act(subject.watch, resolveReads);
    await settled();

    expect(subject.signals).toEqual(signals);
  });

  it('follow_PlanInTwoCheckouts_SignalsTheNewestCopy', async () => {
    const { files, writeAt } = clockedFiles();
    await writeAt(10, PLAN_FILE, PLAN_NONE);
    await writeAt(20, `${W_PLAN_DIR}/plan.md`, PLAN_ONE);
    const { watch, signals } = startWatch(files, cloneGit(['/r', '/w']));

    watch.follow('s1', PLAN_DIR);
    await settled();
    await writeAt(30, `${W_PLAN_DIR}/plan.md`, PLAN_TWO);
    await settled();
    await writeAt(40, PLAN_FILE, PLAN_ALL);
    await settled();

    expect(signals).toEqual([
      changed(PLAN_ONE),
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

    watch.follow('s1', PLAN_DIR);
    await settled();
    await files.write(`${PLAN_DIR}/01-a.md`, task);
    await settled();

    expect(signals).toEqual([
      changed(plan),
      changed(plan, new Map([['01-a.md', task]])),
    ]);
    expect(signals).toContainEqual(
      heavySignal({
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
      signals: [changed(PLAN_ONE), changed(PLAN_ONE), changed(PLAN_ALL)],
    },
    {
      by: 'check',
      listed: ['/r'],
      added: '/w',
      step: async (watch: PlanWatch) => watch.check('s1'),
      signals: [changed(PLAN_ONE), changed(PLAN_ONE), changed(PLAN_ALL)],
    },
    {
      by: 'another change in git folder',
      listed: ['/r'],
      added: '/w',
      step: (_watch: PlanWatch, files: MemoryFiles) =>
        files.write(`${GIT_FOLDER}/index`, 'index'),
      signals: [changed(PLAN_ONE)],
    },
    {
      by: 'a second worktree in the worktrees folder',
      listed: ['/r', '/w'],
      added: '/w2',
      step: (_watch: PlanWatch, files: MemoryFiles) =>
        files.write(`${GIT_FOLDER}/worktrees/w2/gitdir`, '/w2/.git'),
      signals: [changed(PLAN_ONE), changed(PLAN_ONE), changed(PLAN_ALL)],
    },
  ])(
    'listAgain_WorktreeAdded_WatchesTheNewCopy ($by)',
    async ({ listed, added, step, signals: expected }) => {
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
      const { watch, signals } = startWatch(files, cloneGit(checkouts));
      watch.follow('s1', PLAN_DIR);
      await settled();

      checkouts.push(added);
      await step(watch, files);
      await settled();
      await writeAt(30, `${added}/docs/features/x/plan-a/plan.md`, PLAN_ALL);
      await settled();

      expect(signals).toEqual(expected);
    },
  );

  it('follow_OneCopyDeleted_PlanGoneOnlyWhenNoneLeft', async () => {
    const { files, writeAt } = clockedFiles();
    await writeAt(20, PLAN_FILE, PLAN_ONE);
    await writeAt(10, `${W_PLAN_DIR}/plan.md`, PLAN_TWO);
    const { watch, signals } = startWatch(files, cloneGit(['/r', '/w']));
    watch.follow('s1', PLAN_DIR);
    await settled();

    files.remove(PLAN_DIR);
    await settled();
    files.remove(W_PLAN_DIR);
    await settled();
    watch.check('s1');
    await settled();

    expect(signals).toEqual([changed(PLAN_ONE), changed(PLAN_TWO), PLAN_GONE]);
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
    watch.follow('s1', PLAN_DIR);
    await settled();
    await files.write(PLAN_FILE, PLAN_TICKED);
    await settled();

    watch.follow('s1', PLAN_DIR);
    await settled();

    expect(signals).toEqual([changed(PLAN_TICKED)]);
  });
});
