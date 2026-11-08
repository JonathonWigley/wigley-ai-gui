import type { EditorHost } from '../../contracts/editor';
import type { FuzzyMatcher } from '../../contracts/fuzzy';
import type {
  DrawnPickerRow,
  DrawRowInput,
  ListPicker,
} from '../../contracts/list-picker';
import type { PluginLog } from '../../contracts/log';
import type { PushedScope } from '../../contracts/plugin';
import type { ListPickerCommand } from '../list-picker-commands';
import { element } from './dom';
import { floatingPanel, openFloatingPanel } from './ui/floating-panel';
import { inputFrame } from './ui/input-frame';
import { row, rowAction } from './ui/row';
import './list-picker.css';
import {
  filterPicker,
  movePicker,
  movePickerToEdge,
  openPicker,
  type PickerState,
  visibleIndexes,
} from './list-picker-state';

export interface ListPickerDeps {
  // Pushes the owning plugin's picker scope.
  pushScope(): PushedScope;
  // Takes the `picker shown: <title>` line.
  log: PluginLog;
  // Ranks the rows a filter keeps.
  matcher: FuzzyMatcher;
  // Adds the filter box above the list when given.
  filterEditor?: EditorHost;
  // The `/ filter` key drawn at the title line's end, ahead of the request's
  // `headerEnd`; asked on each `open` of a list with a filter editor.
  filterHint?(): HTMLElement | null;
}

// Each list picker command run on its method, for a plugin's command handlers.
export function listPickerCommands(
  picker: Pick<
    ListPicker,
    | 'down'
    | 'up'
    | 'top'
    | 'bottom'
    | 'choose'
    | 'cancel'
    | 'focusFilter'
    | 'leaveFilter'
  >,
): Record<ListPickerCommand, () => void> {
  return {
    pickerDown: () => picker.down(),
    pickerUp: () => picker.up(),
    pickerTop: () => picker.top(),
    pickerBottom: () => picker.bottom(),
    pickerChoose: () => picker.choose(),
    pickerCancel: () => picker.cancel(),
    pickerFilter: () => picker.focusFilter(),
    pickerList: () => picker.leaveFilter(),
  };
}

// The open request with its item type erased: the list reads only labels and
// hands the chosen index back.
interface OpenRequest {
  title: string;
  chooseAt(index: number): void;
  cancelled: (() => void) | null;
  cursorEndAt(index: number): HTMLElement | null;
  // The request's own row for the item at `index`, appended to `parent`;
  // null when the request draws none.
  drawRowAt(
    parent: HTMLElement,
    index: number,
    input: DrawRowInput,
  ): DrawnPickerRow | null;
  sectionAt(index: number): string | null;
  // The request's own heading drawn into `parent`; null when it draws none.
  drawHeadingIn(parent: HTMLElement, title: string): DrawnPickerRow | null;
}

const NO_DISPOSE = () => undefined;

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

  // Each drawn row by its item index, with the dispose of its draw.
  const drawnRows = new Map<number, DrawnPickerRow>();
  const drawnHeadings: DrawnPickerRow[] = [];
  const disposeRows = () => {
    const draws = [...drawnRows.values(), ...drawnHeadings];
    drawnRows.clear();
    drawnHeadings.length = 0;
    for (const drawn of draws) {
      drawn.dispose();
    }
  };

  // Draws the row of the item at `index`, appended to the list.
  const drawRowAt = (index: number): DrawnPickerRow => {
    const label = state.labels[index];
    const atCursor = index === state.cursor;
    const trailing = atCursor ? (request?.cursorEndAt(index) ?? null) : null;
    const choose = () => {
      state = { ...state, cursor: index };
      picker.choose();
    };
    let drawn = request?.drawRowAt(list, index, { label, trailing }) ?? null;
    if (drawn === null) {
      const builtIn = row({
        density: 'list',
        label,
        trailing,
        tag: 'li',
        onClick: choose,
      });
      list.append(builtIn);
      drawn = { element: builtIn, dispose: NO_DISPOSE };
    } else {
      if (trailing !== null && !drawn.element.contains(trailing)) {
        drawn.element.append(trailing);
      }
      rowAction(drawn.element, choose);
    }
    const item = drawn.element;
    // The row ends in an ellipsis; the tooltip shows the whole label.
    item.title = label;
    item.classList.toggle('is-selected', atCursor);
    item.classList.toggle('is-cursor', atCursor);
    return drawn;
  };

  // Draws a heading titled `title`, appended to the list.
  const drawHeading = (title: string): DrawnPickerRow => {
    const heading = element('li', 'ui-picker-heading');
    heading.addEventListener('mousedown', (event) => event.preventDefault());
    list.append(heading);
    const drawn = request?.drawHeadingIn(heading, title) ?? null;
    if (drawn !== null) {
      return drawn;
    }
    heading.textContent = title;
    return { element: heading, dispose: NO_DISPOSE };
  };

  // A section's first row brings its heading into view above it; the cursor
  // row scrolls last so it ends in view.
  const scrollToCursor = () => {
    const cursorRow = list.querySelector('.is-cursor');
    const above = cursorRow?.previousElementSibling;
    if (above?.classList.contains('ui-picker-heading')) {
      above.scrollIntoView({ block: 'nearest' });
    }
    cursorRow?.scrollIntoView({ block: 'nearest' });
  };

  const draw = () => {
    disposeRows();
    list.replaceChildren();
    const showsHeadings = state.filter.trim() === '';
    let previousSection: string | null = null;
    for (const index of visibleIndexes(state, deps.matcher)) {
      if (showsHeadings) {
        const section = request?.sectionAt(index) ?? null;
        if (section !== null && section !== previousSection) {
          drawnHeadings.push(drawHeading(section));
        }
        previousSection = section;
      }
      drawnRows.set(index, drawRowAt(index));
    }
    scrollToCursor();
  };

  // Draws the drawn row at `index` again in its place, whether or not its
  // dispose removed it.
  const redrawRow = (index: number) => {
    const last = drawnRows.get(index);
    if (last === undefined) {
      return;
    }
    const after = last.element.nextElementSibling;
    last.dispose();
    last.element.remove();
    const next = drawRowAt(index);
    list.insertBefore(next.element, after);
    drawnRows.set(index, next);
  };

  // Moves the cursor by `move`, drawing only the rows it left and reached.
  const moveCursor = (move: (from: PickerState) => PickerState) => {
    if (request === null) {
      return;
    }
    const left = state.cursor;
    state = move(state);
    if (state.cursor === left) {
      return;
    }
    redrawRow(left);
    redrawRow(state.cursor);
    scrollToCursor();
  };

  const filterBox = inputFrame();
  const filter =
    deps.filterEditor?.create(filterBox, '', {
      changed: (text) => {
        state = filterPicker(state, text, deps.matcher);
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
    disposeRows();
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
        title: next.title,
        chooseAt: (index) => next.chosen(next.items[index]),
        cancelled: next.cancelled ?? null,
        cursorEndAt: (index) => next.cursorEnd?.(next.items[index]) ?? null,
        drawRowAt: (parent, index, input) =>
          next.drawRow?.(parent, next.items[index], input) ?? null,
        sectionAt: (index) => next.section?.(next.items[index]) ?? null,
        drawHeadingIn: (parent, title) =>
          next.drawHeading?.(parent, title) ?? null,
      };
      state = openPicker(
        next.items.map(next.label),
        next.selected ?? 0,
        next.name && next.items.map(next.name),
      );
      title.textContent = next.title;
      const filterHint = filter === null ? null : deps.filterHint?.();
      head.replaceChildren(
        ...[title, filterHint, next.headerEnd].filter(
          (part): part is HTMLElement => part != null,
        ),
      );
      panel.setAttribute('aria-label', next.title);
      openFloatingPanel(panel, layer);
      draw();
      deps.log(`picker shown: ${next.title}`);
    },
    isOpen: () => request !== null,
    cursorIndex: () =>
      request === null || state.cursor < 0 ? null : state.cursor,
    down() {
      moveCursor((from) => movePicker(from, 1, deps.matcher));
    },
    up() {
      moveCursor((from) => movePicker(from, -1, deps.matcher));
    },
    top() {
      moveCursor((from) => movePickerToEdge(from, 'first', deps.matcher));
    },
    bottom() {
      moveCursor((from) => movePickerToEdge(from, 'last', deps.matcher));
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
      if (request !== null && filter !== null) {
        filter.focus({ insertAtEnd: true });
        deps.log(`picker filter: ${request.title}`);
      }
    },
    leaveFilter() {
      if (filter === null) {
        return;
      }
      const boxHeldFocus = filterBox.contains(document.activeElement);
      filter.blur();
      if (request !== null && boxHeldFocus) {
        deps.log(`picker list: ${request.title}`);
      }
    },
    redraw() {
      if (request !== null) {
        draw();
      }
    },
  };
  return picker;
}
