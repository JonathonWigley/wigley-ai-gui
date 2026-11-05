// `path` is a file's path, or a list page's `wiki:` place.
export interface DocPlace {
  path: string;
  line: number | null;
}

// A list of places and a position; the entry at the position is the place
// shown now.
export interface DocHistory {
  // A place equal to the current one changes nothing, so forward entries stay.
  // Any other place removes the forward entries and becomes current.
  push(place: DocPlace): void;
  // Moves one entry back and returns it; null, with no move, at the first.
  back(): DocPlace | null;
  // Moves one entry forward and returns it; null, with no move, at the last.
  forward(): DocPlace | null;
  canBack(): boolean;
  canForward(): boolean;
}

export const DOC_HISTORY_LIMIT = 100;

export function createDocHistory(): DocHistory {
  const places: DocPlace[] = [];
  let position = -1;
  const canBack = () => position > 0;
  const canForward = () => position < places.length - 1;
  return {
    push(place) {
      const current = places.at(position);
      const isCurrent =
        current?.path === place.path && current.line === place.line;
      if (isCurrent) {
        return;
      }
      places.splice(position + 1);
      places.push(place);
      if (places.length > DOC_HISTORY_LIMIT) {
        places.shift();
      }
      position = places.length - 1;
    },
    back() {
      if (!canBack()) {
        return null;
      }
      position--;
      return places[position];
    },
    forward() {
      if (!canForward()) {
        return null;
      }
      position++;
      return places[position];
    },
    canBack,
    canForward,
  };
}
