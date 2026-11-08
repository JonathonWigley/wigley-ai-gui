import { describe, expect, it } from 'vitest';
import type { Files } from '../../../contracts/files';
import { createMemoryFiles } from '../../../shared/memory-files';
import type { WorkflowSignal } from '../../workflow/contract';
import { readPlanProgress } from '../../../shared/plan-progress';
import { heavySignal } from '../contract';
import { createPlanWatch, type PlanWatch } from './plan-watch';

const PLAN_DIR = '/r/docs/features/x/plan-a';
const PLAN_FILE = `${PLAN_DIR}/plan.md`;
const PLAN = '# Plan A — plan\n\n## Tasks\n\n- [x] one\n- [ ] two\n';
const PLAN_TICKED = '# Plan A — plan\n\n## Tasks\n\n- [x] one\n- [x] two\n';

const settled = () => new Promise((settle) => setImmediate(settle));

// A plan watch over `files`, recording every signal it gives.
function startWatch(files: Pick<Files, 'read' | 'stat' | 'watch'>) {
  const signals: WorkflowSignal[] = [];
  const watch = createPlanWatch({
    files,
    log: () => undefined,
    signal: (_sessionId, signal) => signals.push(signal),
  });
  return { watch, signals };
}

function changed(text: string): WorkflowSignal {
  return heavySignal({
    type: 'planChanged',
    progress: readPlanProgress(text, new Map()),
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

    expect(signals).toEqual([
      changed(PLAN),
      changed(PLAN_TICKED),
      heavySignal({ type: 'planGone' }),
    ]);
  });

  it.each([
    {
      closedBy: 'planGone',
      watchFailsOnce: false,
      close: async (files: ReturnType<typeof createMemoryFiles>) => {
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
        read: (path) => files.read(path),
        stat: (path) => files.stat(path),
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

    expect(signals).toEqual([heavySignal({ type: 'planGone' })]);
    expect(await files.stat(PLAN_DIR)).toBeNull();
  });

  it.each([
    {
      name: 'the watch moved',
      act: (watch: PlanWatch, resolveReads: ((text: string) => void)[]) => {
        watch.follow('s1', null);
        resolveReads[0](PLAN);
      },
      signals: [],
    },
    {
      name: 'a newer read started',
      act: (watch: PlanWatch, resolveReads: ((text: string) => void)[]) => {
        watch.check('s1');
        resolveReads[1](PLAN_TICKED);
        resolveReads[0](PLAN);
      },
      signals: [changed(PLAN_TICKED)],
    },
  ])('read_SettlingLate_IsDropped ($name)', async ({ act, signals }) => {
    const files = createMemoryFiles();
    await files.write(PLAN_FILE, PLAN);
    const resolveReads: ((text: string) => void)[] = [];
    const deferred: Pick<Files, 'read' | 'stat' | 'watch'> = {
      read: () =>
        new Promise<string>((resolve) => {
          resolveReads.push(resolve);
        }),
      stat: (path) => files.stat(path),
      watch: (folder, onChange, options) =>
        files.watch(folder, onChange, options),
    };
    const subject = startWatch(deferred);
    subject.watch.follow('s1', PLAN_DIR);
    await settled();

    act(subject.watch, resolveReads);
    await settled();

    expect(subject.signals).toEqual(signals);
  });
});
