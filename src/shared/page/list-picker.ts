import type { EditorHost } from '../../contracts/editor';
import type { Log } from '../../contracts/log';
import type { PushedScope } from '../../contracts/plugin';
import { element } from './dom';
import { floatingPanel, openFloatingPanel } from './ui/floating-panel';
import { inputFrame } from './ui/input-frame';
import { row } from './ui/row';
import './list-picker.css';
import {
  filterPicker,
  movePicker,
  openPicker,
  type PickerState,
  visibleIndexes,
} from './list-picker-state';

export interface ListPickerRequest<T> {
  // The panel's heading, its accessible name and the name its log line
  // carries.
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
  // Drawn at the end of the title line while this request is open.
  headerEnd?: HTMLElement | null;
  // Drawn at the trailing end of the cursor row, on each draw.
  cursorEnd?(item: T): HTMLElement | null;
}

// One floating list, holding one request at a time: `open` replaces the open
// request, if any, without hearing its cancel. Its scope is pushed while it
// shows, and the base scope changing under it, or a click on the layer
// outside the panel, cancels it. `choose` with nothing visible does nothing;
// `close` hides it without hearing a cancel.
// A request's `headerEnd` sits at the end of the title line while it is open,
// and its `cursorEnd` at the trailing end of the cursor row only, moved there
// on each draw.
// With a filter editor, `focusFilter` types into the filter box above the
// list and `leaveFilter` leaves it with the filter kept; without one both do
// nothing.
export interface ListPicker {
  // The transparent layer holding the panel, filling the positioned box the
  // caller places it in.
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
  // Adds the filter box above the list when given.
  filterEditor?: EditorHost;
}

// The open request with its item type erased: the list reads only labels and
// hands the chosen index back.
interface OpenRequest {
  chooseAt(index: number): void;
  cancelled: (() => void) | null;
  cursorEndAt(index: number): HTMLElement | null;
}

export function createListPicker(deps: ListPickerDeps): ListPicker {
  const layer = element('div', 'ui-picker-layer');
  const panel = floatingPanel();
  panel.classList.add('ui-picker');
  panel.setAttribute('role', 'dialog');
  const head = element('div', 'ui-picker-head');
  const title = element('h2', 'ui-picker-title');
  const list = element('ol', 'ui-picker-list');
  layer.append(panel);
  layer.hidden = true;
  layer.addEventListener('mousedown', (event) => {
    if (event.target === layer) {
      event.preventDefault();
    }
  });
  layer.addEventListener('click', (event) => {
    if (event.target === layer) {
      picker.cancel();
    }
  });

  let request: OpenRequest | null = null;
  let state: PickerState = openPicker([], 0);
  let pushed: PushedScope | null = null;

  const draw = () => {
    const items = visibleIndexes(state).map((index) => {
      const label = state.labels[index];
      const atCursor = index === state.cursor;
      const item = row({
        density: 'list',
        label,
        trailing: atCursor ? (request?.cursorEndAt(index) ?? null) : null,
        tag: 'li',
        onClick: () => {
          state = { ...state, cursor: index };
          picker.choose();
        },
      });
      // The row ends in an ellipsis; the tooltip shows the whole label.
      item.title = label;
      item.classList.toggle('is-selected', atCursor);
      item.classList.toggle('is-cursor', atCursor);
      return item;
    });
    list.replaceChildren(...items);
    list.querySelector('.is-cursor')?.scrollIntoView({ block: 'nearest' });
  };

  const filterBox = inputFrame();
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
    panel.append(head, list);
  } else {
    panel.append(head, filterBox, list);
  }

  // Hides the layer and pops its scope; returns the request it held.
  const hide = (): OpenRequest | null => {
    const held = request;
    if (held === null) {
      return null;
    }
    request = null;
    if (filter !== null && filterBox.contains(document.activeElement)) {
      filter.blur();
    }
    layer.hidden = true;
    pushed?.pop();
    pushed = null;
    return held;
  };

  const picker: ListPicker = {
    element: layer,
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
        cursorEndAt: (index) => next.cursorEnd?.(next.items[index]) ?? null,
      };
      state = openPicker(next.items.map(next.label), next.selected ?? 0);
      title.textContent = next.title;
      head.replaceChildren(
        ...(next.headerEnd ? [title, next.headerEnd] : [title]),
      );
      panel.setAttribute('aria-label', next.title);
      openFloatingPanel(panel, layer);
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
