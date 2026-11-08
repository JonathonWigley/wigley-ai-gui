import { describe, expect, it } from 'vitest';
import type { SlotChange, SlotKey } from '../../contracts/state';
import { createSlotHolder } from './slot-holder';

const mainSlot: SlotKey<number, 'main', 'p'> = {
  id: 'p.v',
  process: 'main',
  kind: 'value',
};
const pageChange: SlotChange = { id: 'p.page', kind: 'value', value: 'x' };

function holderWithPushes() {
  const pushes: [number, SlotChange][] = [];
  const logs: [string, string][] = [];
  const holder = createSlotHolder(
    (source, message) => logs.push([source, message]),
    (seq, change) => pushes.push([seq, change]),
  );
  return { holder, pushes, logs };
}

describe('createSlotHolder', () => {
  it('mainWrite_PushesNextSeq', () => {
    const { holder, pushes } = holderWithPushes();
    const writer = holder.store.publish(mainSlot);

    writer.set(1);
    writer.set(2);

    expect(pushes).toEqual([
      [1, { id: 'p.v', kind: 'value', value: 1 }],
      [2, { id: 'p.v', kind: 'value', value: 2 }],
    ]);
  });

  it('pageWrite_MovesSeqAndDoesNotPush', () => {
    const { holder, pushes } = holderWithPushes();

    holder.applyPageWrite(pageChange);

    expect(holder.snapshot().seq).toBe(1);
    expect(pushes).toEqual([]);
  });

  it('pageWrite_SlotMainHolds_LoggedAndIgnored', () => {
    const { holder, logs } = holderWithPushes();
    const writer = holder.store.publish(mainSlot);
    writer.set(1);

    holder.applyPageWrite({ id: 'p.v', kind: 'value', value: 9 });

    expect(writer.get()).toBe(1);
    expect(holder.snapshot().seq).toBe(1);
    expect(logs).toEqual([
      ['state', 'p.v written by the page while main holds it'],
    ]);
  });

  it('applyPageWrite_Cleared_IsIgnoredAndLogged', () => {
    const { holder, logs } = holderWithPushes();
    holder.applyPageWrite(pageChange);

    holder.applyPageWrite({ id: 'p.page', kind: 'cleared' });

    expect(holder.snapshot()).toEqual({
      seq: 1,
      slots: { 'p.page': { kind: 'value', value: 'x' } },
    });
    expect(logs).toEqual([
      ['state', 'ignored a cleared change from the page: p.page'],
    ]);
  });

  it('clearOwner_PushesEachClearedSlotWithNextSeq', () => {
    const { holder, pushes } = holderWithPushes();
    const writer = holder.store.publish(mainSlot);
    writer.set(1);
    writer.dispose();
    holder.applyPageWrite(pageChange);
    holder.store.publish({ id: 'q.v', process: 'main', kind: 'value' }).set(7);
    pushes.length = 0;

    holder.clearOwner('p');

    expect(pushes).toEqual([
      [4, { id: 'p.v', kind: 'cleared' }],
      [5, { id: 'p.page', kind: 'cleared' }],
    ]);
    expect(holder.snapshot().seq).toBe(5);
    expect(holder.snapshot().slots['q.v']).toEqual({ kind: 'value', value: 7 });
  });

  it('snapshot_AfterBothKinds_HoldsLastSeqAndValues', () => {
    const { holder } = holderWithPushes();
    holder.store.publish(mainSlot).set(1);
    holder.applyPageWrite(pageChange);

    expect(holder.snapshot()).toEqual({
      seq: 2,
      slots: {
        'p.v': { kind: 'value', value: 1 },
        'p.page': { kind: 'value', value: 'x' },
      },
    });
  });
});
