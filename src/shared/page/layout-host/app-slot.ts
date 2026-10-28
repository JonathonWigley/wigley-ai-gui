import type { RollbackDeps } from './draw-part';

// One app-owned element (a box, a slot, a row of actions) a kit member places
// into the part drawing, for one drawing attempt.
export interface AppSlot {
  // Appends the element to `parent` and returns it; throws
  // `<name> placed twice` on a second call, so the attempt falls back.
  place(parent: HTMLElement): HTMLElement;
  // Places the element in `root`, at its end or, with `at: 'start'`, its
  // start, when no `place` call placed it.
  placeIfLeftOut(root: HTMLElement, at?: 'start' | 'end'): void;
}

// The slot for `element` in one drawing attempt. Placing it records, through
// `rollback`, a destroy that detaches it, so a failed attempt or the draw's
// dispose leaves it free for the next draw.
export function appSlot(
  element: HTMLElement,
  name: string,
  rollback: Pick<RollbackDeps, 'recordBox'>,
): AppSlot {
  let isPlaced = false;
  const place = (into: () => void) => {
    if (isPlaced) {
      throw new Error(`${name} placed twice`);
    }
    isPlaced = true;
    into();
    rollback.recordBox(() => element.remove());
    return element;
  };
  return {
    place: (parent) => place(() => parent.append(element)),
    placeIfLeftOut(root, at = 'end') {
      if (isPlaced) {
        return;
      }
      place(() =>
        at === 'start' ? root.prepend(element) : root.append(element),
      );
    },
  };
}
