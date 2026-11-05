import { describe, expect, it, vi } from 'vitest';
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

  it('mainWrite_QuitGatedPush_KeepsValueAndMovesSeq', () => {
    let hasQuitStarted = false;
    const page = { send: vi.fn() };
    const livePage = () => page;
    const holder = createSlotHolder(
      () => undefined,
      (seq, change) => {
        const target = hasQuitStarted ? null : livePage();
        target?.send(seq, change);
      },
    );
    const writer = holder.store.publish(mainSlot);
    writer.set(1);
    const seqBeforeQuit = holder.snapshot().seq;
    page.send.mockClear();

    hasQuitStarted = true;
    writer.set(2);

    expect(page.send).not.toHaveBeenCalled();
    expect(holder.store.read(mainSlot, 'test').get()).toBe(2);
    expect(holder.snapshot().seq).toBeGreaterThan(seqBeforeQuit);
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
