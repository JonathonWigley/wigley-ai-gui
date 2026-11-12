import type { DecodedAudio } from './audio-output';

// Decoded sounds by key, least recently used evicted first, holding at most
// `maxBytes` of `byteSize` in all.
export type DecodedCache = {
  // Makes the entry the most recently used.
  get(key: string): DecodedAudio | undefined;
  // Stores the entry as the most recently used, replacing one of the same
  // key, then evicts until `bytes <= maxBytes`. An entry larger than
  // `maxBytes` is not stored and evicts nothing.
  set(key: string, audio: DecodedAudio): void;
  delete(key: string): void;
  // The sum of the stored entries' `byteSize`.
  readonly bytes: number;
};

export function createDecodedCache(maxBytes: number): DecodedCache {
  // A Map iterates in insertion order, so its first key is the least recently
  // used.
  const entries = new Map<string, DecodedAudio>();
  let bytes = 0;

  function remove(key: string): void {
    const entry = entries.get(key);
    if (entry === undefined) {
      return;
    }
    entries.delete(key);
    bytes -= entry.byteSize;
  }

  return {
    get(key) {
      const entry = entries.get(key);
      if (entry !== undefined) {
        entries.delete(key);
        entries.set(key, entry);
      }
      return entry;
    },
    set(key, audio) {
      if (audio.byteSize > maxBytes) {
        return;
      }
      remove(key);
      entries.set(key, audio);
      bytes += audio.byteSize;
      for (const oldest of entries.keys()) {
        if (bytes <= maxBytes) {
          break;
        }
        remove(oldest);
      }
    },
    delete: remove,
    get bytes() {
      return bytes;
    },
  };
}
