import type { ChatEntry } from '../contracts/agent';
import type { Clock } from '../contracts/ambient';

type WithoutAt<E> = E extends unknown ? Omit<E, 'at'> : never;

// A chat entry as the decoder builds it, before it is stamped with its `at`.
export type EntryDraft = WithoutAt<ChatEntry>;

// Stamps each draft with the clock's time when its id first arrives; a later
// draft with that id gets the same `at` again.
export function createEntryStamp(
  clock: Clock,
): (draft: EntryDraft) => ChatEntry {
  const firstAt = new Map<string, number>();
  return (draft) => {
    const at = firstAt.get(draft.id) ?? clock.now();
    firstAt.set(draft.id, at);
    return { ...draft, at } as ChatEntry;
  };
}
