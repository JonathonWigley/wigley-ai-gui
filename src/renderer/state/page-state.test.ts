import { describe, expect, it } from 'vitest';
import type { Bridge } from '../../contracts/bridge';
import type { SlotChange, SlotKey, StateSnapshot } from '../../contracts/state';
import { deferred } from '../../shared/plugin-part-harness.test-support';
import { createPageState } from './page-state';

const slot: SlotKey<number, 'main', 'p'> = {
  id: 'p.v',
  process: 'main',
  kind: 'value',
};
const pageSlot: SlotKey<string, 'page', 'p'> = {
  id: 'p.page',
  process: 'page',
  kind: 'value',
};

function change(value: number): SlotChange {
  return { id: 'p.v', kind: 'value', value };
}

function snapshotAt(seq: number, value?: number): StateSnapshot {
  return {
    seq,
    slots: value === undefined ? {} : { 'p.v': { kind: 'value', value } },
  };
}

function fakeBridge(snapshot: Promise<StateSnapshot>) {
  const calls: string[] = [];
  const written: SlotChange[] = [];
  let listener: (seq: number, change: SlotChange) => void = () => {};
  const bridge: Pick<Bridge, 'stateSnapshot' | 'stateWrite' | 'onStateChange'> =
    {
      stateSnapshot() {
        calls.push('snapshot');
        return snapshot;
      },
      stateWrite(written_) {
        written.push(written_);
      },
      onStateChange(added) {
        calls.push('listen');
        listener = added;
        return { dispose() {} };
      },
    };
  return {
    bridge,
    calls,
    written,
    push: (seq: number, pushed: SlotChange) => listener(seq, pushed),
  };
}

describe('createPageState', () => {
  it('createPageState_ListensBeforeAsking', async () => {
    const { bridge, calls } = fakeBridge(Promise.resolve(snapshotAt(0)));

    await createPageState(bridge, () => {});

    expect(calls).toEqual(['listen', 'snapshot']);
  });

  it('rejects when the snapshot does', async () => {
    const { bridge } = fakeBridge(Promise.reject(new Error('no snapshot')));

    await expect(createPageState(bridge, () => {})).rejects.toThrow(
      'no snapshot',
    );
  });

  it('pushes_BeforeSnapshot_DropsSeenAppliesRestInOrder', async () => {
    const snapshot = deferred<StateSnapshot>();
    const { bridge, push } = fakeBridge(snapshot.promise);
    const pending = createPageState(bridge, () => {});
    push(4, change(40));
    push(5, change(50));
    push(6, change(60));
    push(7, change(70));

    snapshot.resolve(snapshotAt(5, 50));
    const store = await pending;

    const heard: unknown[] = [];
    store.read(slot, 'q').on((value) => heard.push(value));
    expect(store.read(slot, 'q').get()).toBe(70);
    push(7, change(99));
    push(8, change(80));
    expect(heard).toEqual([80]);
  });

  it('push_WithSeqGap_Applies', async () => {
    const { bridge, push } = fakeBridge(Promise.resolve(snapshotAt(2)));
    const store = await createPageState(bridge, () => {});

    push(9, change(1));

    expect(store.read(slot, 'q').get()).toBe(1);
  });

  it('write_AppliesLocallyThenSendsOnce', async () => {
    const { bridge, written } = fakeBridge(Promise.resolve(snapshotAt(0)));
    const store = await createPageState(bridge, () => {});
    const heard: string[] = [];
    store.read(pageSlot, 'q').on(() => heard.push(`heard ${written.length}`));

    store.publish(pageSlot).set('a');

    expect(store.read(pageSlot, 'q').get()).toBe('a');
    expect(written).toEqual([{ id: 'p.page', kind: 'value', value: 'a' }]);
    // `onWrite` runs before the listeners in both processes.
    expect(heard).toEqual(['heard 1']);
  });

  it('secondLoad_SameKey_PublishesAndReadsLastValue', async () => {
    const { bridge: firstBridge } = fakeBridge(Promise.resolve(snapshotAt(0)));
    (await createPageState(firstBridge, () => {})).publish(pageSlot).set('old');
    const { bridge } = fakeBridge(
      Promise.resolve({
        seq: 1,
        slots: { 'p.page': { kind: 'value', value: 'old' } },
      }),
    );

    const store = await createPageState(bridge, () => {});

    expect(store.publish(pageSlot).get()).toBe('old');
  });
});
