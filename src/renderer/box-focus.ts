import type { Disposable } from '../contracts/disposable';
import type { EditorHost } from '../contracts/editor';
import type { HintWhere } from '../contracts/keymap';
import { createListeners } from '../shared/listeners';

// Whether focus is in a text box. `where` reads the active element now.
// `onChanged` hears each move between the page and a box, until its `dispose`: a
// move from box to box, and a window blur, tell nothing.
export interface BoxFocus {
  where(): HintWhere;
  onChanged(listener: (where: HintWhere) => void): Disposable;
}

export function createBoxFocus(
  document: Document,
  editors: Pick<EditorHost, 'contains'>,
): BoxFocus {
  const listeners = createListeners<HintWhere>();
  let lastTold: HintWhere = 'page';
  const whereOf = (target: EventTarget | null): HintWhere =>
    target !== null && editors.contains(target as Element) ? 'box' : 'page';
  const tellIfChanged = (next: HintWhere) => {
    if (next !== lastTold) {
      lastTold = next;
      listeners.tell(next);
    }
  };
  document.addEventListener('focusin', (event) =>
    tellIfChanged(whereOf(event.target)),
  );
  // The active element is not final during `focusout`, so the event says where
  // focus goes.
  document.addEventListener('focusout', (event) => {
    const isWindowBlur = event.relatedTarget === null && !document.hasFocus();
    if (!isWindowBlur) {
      tellIfChanged(whereOf(event.relatedTarget));
    }
  });
  return {
    // Live: `focus()` in an unfocused window moves the active element and fires
    // no event.
    where: () => whereOf(document.activeElement),
    onChanged: (listener) => listeners.add(listener),
  };
}
