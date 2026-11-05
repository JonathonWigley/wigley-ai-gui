import type { Bridge } from '../../contracts/bridge';
import type { Log } from '../../contracts/log';
import type { SlotChange } from '../../contracts/state';
import { createSlotStore, type SlotStore } from '../../shared/state/slot-store';

// The page load's store: main's snapshot, every later push of a main writer, and
// each page write sent back to main, which does not echo it. It listens before it
// asks, since a push sent between the snapshot and the listener would be lost, and
// holds that listener for the page load. A push at or below the last `seq` taken is
// dropped; `seq` has gaps, since main does not push the page's own writes. Rejects
// when the snapshot does.
export async function createPageState(
  bridge: Pick<Bridge, 'stateSnapshot' | 'stateWrite' | 'onStateChange'>,
  log: Log,
): Promise<SlotStore> {
  const store = createSlotStore(log);
  const buffered: { seq: number; change: SlotChange }[] = [];
  let take = (seq: number, change: SlotChange) => {
    buffered.push({ seq, change });
  };
  bridge.onStateChange((seq, change) => take(seq, change));

  const snapshot = await bridge.stateSnapshot();
  store.load(snapshot.slots);
  let lastSeq = snapshot.seq;
  const applyNewer = (seq: number, change: SlotChange) => {
    if (seq > lastSeq) {
      lastSeq = seq;
      store.applyRemote(change);
    }
  };
  for (const { seq, change } of buffered) {
    applyNewer(seq, change);
  }
  take = applyNewer;
  store.onWrite((change) => bridge.stateWrite(change));
  return store;
}
