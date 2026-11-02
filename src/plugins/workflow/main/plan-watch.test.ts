import { describe, expect, it } from 'vitest';
import type { Files } from '../../../contracts/files';
import { createMemoryFiles } from '../../../shared/memory-files';
import type { WorkflowSignal } from '../contract';
import { readPlanProgress } from '../plan-reader';
import { createPlanWatch } from './plan-watch';

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
  return { type: 'planChanged', progress: readPlanProgress(text) };
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
      { type: 'planGone' },
    ]);
  });

  it('follow_TheSameFolderAfterPlanGone_WatchesItAgain', async () => {
    const files = createMemoryFiles();
    await files.write(PLAN_FILE, PLAN);
    const { watch, signals } = startWatch(files);
    watch.follow('s1', PLAN_DIR);
    await settled();
    files.remove(PLAN_DIR);
    await settled();
    await files.write(PLAN_FILE, PLAN_TICKED);
    signals.length = 0;

    watch.follow('s1', PLAN_DIR);
    await settled();

    expect(signals).toEqual([changed(PLAN_TICKED)]);
  });

  it('follow_AMissingFolder_SignalsPlanGoneAndMakesNoFolder', async () => {
    const files = createMemoryFiles();
    const { watch, signals } = startWatch(files);

    watch.follow('s1', PLAN_DIR);
    await settled();

    expect(signals).toEqual([{ type: 'planGone' }]);
    expect(await files.stat(PLAN_DIR)).toBeNull();
  });

  it('read_SettlingAfterTheWatchMoved_SignalsNothing', async () => {
    const files = createMemoryFiles();
    await files.write(PLAN_FILE, PLAN);
    let resolveRead: (text: string) => void = () => undefined;
    const deferred: Pick<Files, 'read' | 'stat' | 'watch'> = {
      read: () =>
        new Promise<string>((resolve) => {
          resolveRead = resolve;
        }),
      stat: (path) => files.stat(path),
      watch: (folder, onChange, options) =>
        files.watch(folder, onChange, options),
    };
    const { watch, signals } = startWatch(deferred);
    watch.follow('s1', PLAN_DIR);
    await settled();

    watch.follow('s1', null);
    resolveRead(PLAN);
    await settled();

    expect(signals).toEqual([]);
  });
});
