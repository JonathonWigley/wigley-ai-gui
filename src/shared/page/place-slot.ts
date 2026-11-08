import type { KeyedSlotWriter } from '../../contracts/state';

// Drops a write whose JSON equals the last one, so a store's every change costs one compare.
// `reset` forgets the last value.
export interface PlaceWrites<V> {
  write(value: V): void;
  reset(): void;
}

export function placeWrites<V>(write: (value: V) => void): PlaceWrites<V> {
  let lastJson: string | null = null;
  return {
    write(value) {
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
  };
}

// Deletes every key `isLive` refuses: the row or form ended while no page ran.
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
