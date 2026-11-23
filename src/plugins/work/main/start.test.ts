import { describe, expect, it, vi } from 'vitest';
import {
  deferred,
  type MainPartHarness,
  startMainPart,
} from '../../../shared/plugin-part-harness.test-support';
import { type WorkState, workStateSlot } from '../contract';
import { jiraCard, workItem } from '../contract.test-support';
import { workManifest } from '../manifest';
import { workMainPart } from './start';
import { EMPTY_WORK_FILE, WORK_FILE, type WorkStore } from './store';

// The store each start of the part made, newest last, so a test can update it as 09's handlers will.
const stores = vi.hoisted(() => [] as WorkStore[]);

vi.mock('./store', async (importOriginal) => {
  const original = await importOriginal<typeof import('./store')>();
  return {
    ...original,
    createWorkStore: (...args: Parameters<typeof original.createWorkStore>) => {
      const store = original.createWorkStore(...args);
      stores.push(store);
      return store;
    },
  };
});

type WorkHarness = MainPartHarness<typeof workManifest>;

const WORK_PATH = `/data/work/${WORK_FILE}`;

const settled = () => new Promise((settle) => setImmediate(settle));

// The part started, then restarted over `work.json` holding `text`, once its first start loaded.
async function startOver(text: string) {
  const harness = startMainPart(workMainPart);
  await settled();
  await harness.files.write(WORK_PATH, text);
  await harness.restart();
  await settled();
  return harness;
}

function slotOf(harness: WorkHarness): WorkState | undefined {
  return harness.state.read(workStateSlot, 'test').get();
}

const lastStore = () => stores[stores.length - 1] as WorkStore;

describe('workMainPart', () => {
  it('start_emptySlot', async () => {
    const harness = startMainPart(workMainPart);

    expect(slotOf(harness)).toBeUndefined();
    await settled();

    expect(slotOf(harness)).toEqual({
      items: [],
      cards: [],
      suggestions: [],
      columns: ['Backlog', 'Todo', 'In Progress', 'In QA', 'Done', 'Other'],
      job: { running: null, last: null },
      problem: null,
    });
    await harness.stop();
  });

  it('start_problemPassesThrough', async () => {
    const harness = await startOver('not json');

    await lastStore().update((file) => ({ ...file, items: [workItem('a')] }));

    const state = slotOf(harness);
    expect(state?.problem).toBe(
      'work.json could not be read, so nothing is saved this run: work.json is not a work file',
    );
    expect(state?.items.map((item) => item.id)).toEqual(['a']);
    expect(await harness.files.read(WORK_PATH)).toBe('not json');
    await harness.stop();
  });

  it('start_settingsChangeRepublishes', async () => {
    const card = jiraCard('WS-1', 'In Review');
    const file = { ...EMPTY_WORK_FILE, cards: [card] };
    const harness = await startOver(JSON.stringify(file));
    expect(slotOf(harness)?.cards[0]?.column).toBe('In QA');

    harness.pushSettings({
      ...workManifest.settings,
      columns: [{ name: 'Done', jiraStatuses: ['In Review'] }],
    });

    expect(slotOf(harness)?.cards[0]?.column).toBe('Done');
    await harness.stop();
  });

  it('start_disposeAwaitsSettled', async () => {
    const harness = startMainPart(workMainPart);
    await settled();
    const write = deferred<void>();
    const realWrite = harness.files.write;
    const gatedWrite = async (path: string, text: string) => {
      await write.promise;
      await realWrite(path, text);
    };
    vi.spyOn(harness.files, 'write').mockImplementation(gatedWrite);
    void lastStore().update((file) => ({ ...file, lastSweepAt: 'now' }));
    let isStopped = false;

    const stopping = harness.stop().then(() => {
      isStopped = true;
    });
    await settled();
    expect(isStopped).toBe(false);
    write.resolve();
    await stopping;

    expect(isStopped).toBe(true);
  });
});
