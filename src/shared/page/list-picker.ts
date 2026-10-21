import type { EditorHost } from '../../contracts/editor';
import type { Log } from '../../contracts/log';
import type { PushedScope } from '../../contracts/plugin';
import { element } from './dom';
import {
  filterPicker,
  movePicker,
  openPicker,
  type PickerState,
  visibleIndexes,
} from './list-picker-state';

export interface ListPickerRequest<T> {
  // The dialog's heading and the name its log line carries.
  title: string;
  items: readonly T[];
  // The line drawn and filtered on.
  label(item: T): string;
  // The item index highlighted on open; 0 when left out or out of range.
  selected?: number;
  // Runs once the list has closed on a choice.
  chosen(item: T): void;
  // Runs once the list has closed on `cancel`, or on the pushed scope's base
  // changing under it.
  cancelled?(): void;
}

// One modal list, holding one request at a time: `open` replaces the open
// request, if any, without hearing its cancel. Its scope is pushed while it
// shows, and the base scope changing under it cancels it. `choose` with
// nothing visible does nothing; `close` hides it without hearing a cancel.
// With a filter editor, `focusFilter` types into the filter box above the
// list and `leaveFilter` leaves it with the filter kept; without one both do
// nothing.
export interface ListPicker {
  // The overlay holding the dialog, for the caller to place.
  element: HTMLElement;
  open<T>(request: ListPickerRequest<T>): void;
  isOpen(): boolean;
  // The open request's item index under the cursor; null when closed or
  // nothing is visible.
  cursorIndex(): number | null;
  down(): void;
  up(): void;
  choose(): void;
  cancel(): void;
  close(): void;
  focusFilter(): void;
  leaveFilter(): void;
}

export interface ListPickerDeps {
  // Pushes the owning plugin's picker scope.
  pushScope(): PushedScope;
  log: Log;
  // The `[source]` of the `picker shown: <title>` line.
  logSource: string;
  overlayClass: string;
  // The plugin's own class on the dialog, beside `dialog list-picker`.
  dialogClass: string;
  // Adds the filter box above the list when given.
  filterEditor?: EditorHost;
}

// The open request with its item type erased: the list reads only labels and
// hands the chosen index back.
interface OpenRequest {
  chooseAt(index: number): void;
  cancelled: (() => void) | null;
}

export function createListPicker(deps: ListPickerDeps): ListPicker {
  const overlay = element('div', deps.overlayClass);
  const dialog = element('div', `dialog list-picker ${deps.dialogClass}`);
  const title = element('h2', 'dialog-title');
  const list = element('ol', 'list-picker-list');
  overlay.append(dialog);
  overlay.hidden = true;

  let request: OpenRequest | null = null;
  let state: PickerState = openPicker([], 0);
  let pushed: PushedScope | null = null;

  const draw = () => {
    const items = visibleIndexes(state).map((index) => {
      const item = element('li', 'list-picker-item', state.labels[index]);
      item.classList.toggle('is-cursor', index === state.cursor);
      item.addEventListener('mousedown', (event) => event.preventDefault());
      item.addEventListener('click', () => {
        state = { ...state, cursor: index };
        picker.choose();
      });
      return item;
    });
    list.replaceChildren(...items);
    list.querySelector('.is-cursor')?.scrollIntoView({ block: 'nearest' });
  };

  const filterBox = element('div', 'list-picker-filter');
  const filter =
    deps.filterEditor?.create(filterBox, '', {
      changed: (text) => {
        state = filterPicker(state, text);
        draw();
      },
      focused: () => undefined,
      blurred: () => undefined,
      modeChanged: () => undefined,
    }) ?? null;
  if (filter === null) {
    dialog.append(title, list);
  } else {
    dialog.append(title, filterBox, list);
  }

  // Hides the dialog and pops its scope; returns the request it held.
  const hide = (): OpenRequest | null => {
    const held = request;
    if (held === null) {
      return null;
    }
    request = null;
    if (filter !== null && filterBox.contains(document.activeElement)) {
      filter.blur();
    }
    overlay.hidden = true;
    pushed?.pop();
    pushed = null;
    return held;
  };

  const picker: ListPicker = {
    element: overlay,
    open(next) {
      if (pushed === null) {
        const scope = deps.pushScope();
        scope.onBaseChanged(() => {
          if (pushed === scope) {
            picker.cancel();
          }
        });
        pushed = scope;
      }
      filter?.setText('');
      request = {
        chooseAt: (index) => next.chosen(next.items[index]),
        cancelled: next.cancelled ?? null,
      };
      state = openPicker(next.items.map(next.label), next.selected ?? 0);
      title.textContent = next.title;
      overlay.hidden = false;
      draw();
      deps.log(deps.logSource, `picker shown: ${next.title}`);
    },
    isOpen: () => request !== null,
    cursorIndex: () =>
      request === null || state.cursor < 0 ? null : state.cursor,
    down() {
      state = movePicker(state, 1);
      draw();
    },
    up() {
      state = movePicker(state, -1);
      draw();
    },
    choose() {
      if (request === null || state.cursor < 0) {
        return;
      }
      const cursor = state.cursor;
      hide()?.chooseAt(cursor);
    },
    cancel() {
      hide()?.cancelled?.();
    },
    close() {
      hide();
    },
    focusFilter() {
      if (request !== null) {
        filter?.focus({ insertAtEnd: true });
      }
    },
    leaveFilter() {
      filter?.blur();
    },
  };
  return picker;
}
