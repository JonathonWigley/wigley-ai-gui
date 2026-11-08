import type { Log } from '../../contracts/log';
import type { SlotChange, StateSnapshot } from '../../contracts/state';
import { createSlotStore, type SlotStore } from '../../shared/state/slot-store';

// Every slot's value, page-owned ones included, in main's memory for the app run.
// `seq` starts at 0 and goes up by 1 for each change main applies, and `push` sends
// main writers' changes and every `cleared` change: the page already holds its own
// writes, so it sees gaps in `seq`. `applyPageWrite` refuses a change to a slot a
// main writer holds, and a `cleared` change, logging it under source `state`, and
// `seq` stays. `clearOwner` follows `SlotStore.clearOwner`, numbering and pushing
// one `cleared` change per slot it empties, page-owned slots included.
export interface SlotHolder {
  readonly store: SlotStore;
  snapshot(): StateSnapshot;
  applyPageWrite(change: SlotChange): void;
  clearOwner(pluginId: string): void;
}

export function createSlotHolder(
  log: Log,
  push: (seq: number, change: SlotChange) => void,
): SlotHolder {
  const store = createSlotStore(log);
  let seq = 0;
  store.onWrite((change) => {
    seq += 1;
    push(seq, change);
  });
  return {
    store,
    snapshot: () => ({ seq, slots: store.snapshot() }),
    applyPageWrite(change) {
      if (change.kind === 'cleared') {
        log('state', `ignored a cleared change from the page: ${change.id}`);
        return;
      }
      if (store.isHeld(change.id)) {
        log('state', `${change.id} written by the page while main holds it`);
        return;
      }
      seq += 1;
      store.applyRemote(change);
    },
    clearOwner: (pluginId) => store.clearOwner(pluginId),
  };
}
