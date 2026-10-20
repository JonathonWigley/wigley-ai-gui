import type { EditorHost } from '../../../contracts/editor';
import type { Log } from '../../../contracts/log';
import type { PluginAreas, PushedScope } from '../../../contracts/plugin';
import { element } from '../../../shared/page/dom';
import {
  filterPicker,
  movePicker,
  openPicker,
  type PickerState,
  visibleIndexes,
} from './picker-state';
import { blurFocusedElement } from './chat-dialogs';

export interface PickerRequest<T> {
  // The dialog's heading and the name its log lines carry.
  title: string;
  items: readonly T[];
  // The line drawn and filtered on.
  label(item: T): string;
  // The item index highlighted on open; 0 when left out or out of range.
  selected?: number;
  // Runs once the picker has closed.
  picked(item: T): void;
}

// One list dialog in the overlay, holding one request at a time: `open`
// replaces the open request, if any. `pick` with nothing visible does
// nothing; `close` and the pushed scope's base changing close it unpicked.
// `focusFilter` types into the filter box, and `leaveFilter` leaves it with
// the filter kept.
export interface Picker {
  open<T>(request: PickerRequest<T>): void;
  isOpen(): boolean;
  down(): void;
  up(): void;
  pick(): void;
  close(): void;
  focusFilter(): void;
  leaveFilter(): void;
}

export interface PickerDeps {
  overlay: PluginAreas['overlay'];
  editor: EditorHost;
  // Pushes `chat.picker`.
  pushScope(): PushedScope;
  log: Log;
}

// The open request with its item type erased: the picker reads only labels
// and hands the picked index back.
interface OpenRequest {
  title: string;
  pickAt(index: number): void;
}

export function createPicker(deps: PickerDeps): Picker {
  const overlay = element('div', 'overlay');
  const dialog = element('div', 'dialog chat-picker');
  const title = element('h2', 'dialog-title');
  const filterBox = element('div', 'chat-picker-filter');
  const list = element('ol', 'chat-picker-list');
  dialog.append(title, filterBox, list);
  overlay.append(dialog);
  overlay.hidden = true;
  deps.overlay.contribute(overlay);

  let request: OpenRequest | null = null;
  let state: PickerState = openPicker([], 0);
  let pushed: PushedScope | null = null;

  const draw = () => {
    const items = visibleIndexes(state).map((index) => {
      const item = element('li', 'chat-picker-item', state.labels[index]);
      item.classList.toggle('is-cursor', index === state.cursor);
      item.addEventListener('mousedown', (event) => event.preventDefault());
      item.addEventListener('click', () => {
        state = { ...state, cursor: index };
        picker.pick();
      });
      return item;
    });
    list.replaceChildren(...items);
    list.querySelector('.is-cursor')?.scrollIntoView({ block: 'nearest' });
  };

  const filter = deps.editor.create(filterBox, '', {
    changed: (text) => {
      state = filterPicker(state, text);
      draw();
    },
    focused: () => undefined,
    blurred: () => undefined,
    modeChanged: () => undefined,
  });

  // Hides the dialog and pops its scope; returns the request it held.
  const hide = (): OpenRequest | null => {
    const held = request;
    if (held === null) {
      return null;
    }
    request = null;
    if (filterBox.contains(document.activeElement)) {
      filter.blur();
    }
    overlay.hidden = true;
    pushed?.pop();
    pushed = null;
    return held;
  };

  const picker: Picker = {
    open(next) {
      blurFocusedElement();
      filter.setText('');
      request = {
        title: next.title,
        pickAt: (index) => next.picked(next.items[index]),
      };
      state = openPicker(next.items.map(next.label), next.selected ?? 0);
      if (pushed === null) {
        const scope = deps.pushScope();
        scope.onBaseChanged(() => {
          if (pushed === scope) {
            picker.close();
          }
        });
        pushed = scope;
      }
      title.textContent = next.title;
      overlay.hidden = false;
      draw();
      deps.log('chat', `picker shown: ${next.title}`);
    },
    isOpen: () => request !== null,
    down() {
      state = movePicker(state, 1);
      draw();
    },
    up() {
      state = movePicker(state, -1);
      draw();
    },
    pick() {
      if (request === null || state.cursor < 0) {
        return;
      }
      const cursor = state.cursor;
      hide()?.pickAt(cursor);
    },
    close() {
      const closed = hide();
      if (closed !== null) {
        deps.log('chat', `picker closed: ${closed.title}`);
      }
    },
    focusFilter() {
      if (request !== null) {
        filter.focus({ insertAtEnd: true });
      }
    },
    leaveFilter() {
      filter.blur();
    },
  };
  return picker;
}
