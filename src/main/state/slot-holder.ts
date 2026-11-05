import type { Log } from '../../contracts/log';
import type { SlotChange, StateSnapshot } from '../../contracts/state';
import { createSlotStore, type SlotStore } from '../../shared/state/slot-store';

// Every slot's value, page-owned ones included, in main's memory for the app run.
// `seq` starts at 0 and goes up by 1 for each change main applies, and `push` sends
// only the changes of main writers: the page already holds its own, so it sees gaps
// in `seq`. `applyPageWrite` refuses a change to a slot a main writer holds, logging
// it under source `state`, and `seq` stays.
export interface SlotHolder {
  readonly store: SlotStore;
  snapshot(): StateSnapshot;
  applyPageWrite(change: SlotChange): void;
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
      if (store.isHeld(change.id)) {
        log('state', `${change.id} written by the page while main holds it`);
        return;
      }
      seq += 1;
      store.applyRemote(change);
    },
  };
}
