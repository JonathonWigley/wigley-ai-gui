import type { Disposable } from '../../contracts/disposable';
import type { KeyedSlotWriter } from '../../contracts/state';

// Drops a write whose JSON equals the last one, so a store's every change costs one compare.
// `reset` forgets the last value. `hold` drops every write until its dispose,
// so a demo step's sample never overwrites the user's saved place.
export interface PlaceWrites<V> {
  write(value: V): void;
  reset(): void;
  hold(): Disposable;
}

export function placeWrites<V>(write: (value: V) => void): PlaceWrites<V> {
  let lastJson: string | null = null;
  let holds = 0;
  return {
    write(value) {
      if (holds > 0) {
        return;
      }
      const json = JSON.stringify(value);
      if (json === lastJson) {
        return;
      }
      lastJson = json;
      write(value);
    },
    reset() {
      lastJson = null;
    },
    hold() {
      holds += 1;
      let isReleased = false;
      return {
        dispose() {
          if (isReleased) {
            return;
          }
          isReleased = true;
          holds -= 1;
        },
      };
    },
  };
}

// Deletes every key `isLive` refuses: the row or form ended while no page ran.
// Restores belong to a restore window, which a page load or a live start
// opens; a part prunes once its window settles, so the rows chat's restore
// reopens are in the page mirror first.
export function pruneKeys<V>(
  writer: KeyedSlotWriter<V>,
  isLive: (key: string) => boolean,
): void {
  for (const key of writer.all().keys()) {
    if (!isLive(key)) {
      writer.delete(key);
    }
  }
}
