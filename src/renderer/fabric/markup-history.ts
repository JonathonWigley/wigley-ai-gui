// The most snapshots a history keeps, the current one included.
export const MARKUP_HISTORY_LIMIT = 100;

// Undo and redo over markup snapshots. `push` of the current snapshot adds no
// step; any other push clears the redo steps. `undo` and `redo` return the
// snapshot they make current, or null when there is none to move to.
export interface MarkupHistory {
  push(snapshot: string): void;
  undo(): string | null;
  redo(): string | null;
  current(): string;
}

export function createMarkupHistory(initial: string): MarkupHistory {
  const snapshots = [initial];
  let at = 0;
  return {
    push(snapshot) {
      if (snapshot === snapshots[at]) {
        return;
      }
      snapshots.splice(at + 1, snapshots.length, snapshot);
      if (snapshots.length > MARKUP_HISTORY_LIMIT) {
        snapshots.shift();
      }
      at = snapshots.length - 1;
    },
    undo() {
      if (at === 0) {
        return null;
      }
      at -= 1;
      return snapshots[at];
    },
    redo() {
      if (at === snapshots.length - 1) {
        return null;
      }
      at += 1;
      return snapshots[at];
    },
    current: () => snapshots[at],
  };
}
