import type { EditorHost } from '../../contracts/editor';
import type { FuzzyMatcher } from '../../contracts/fuzzy';
import type { PluginLog } from '../../contracts/log';
import type { PushedScope } from '../../contracts/plugin';
import { element } from './dom';
import { floatingPanel, openFloatingPanel } from './ui/floating-panel';
import { inputFrame } from './ui/input-frame';
import { row, rowAction } from './ui/row';
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
  // The row's name when its label also holds a path: a filter's match on it
  // outranks any match on a label.
  name?(item: T): string;
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
  // Draws the row for `item` into `parent` (the picker's list) and returns
  // it, appended to `parent`, with the dispose of its draw; the picker draws
  // its built-in row when left out. The picker sets `is-cursor` on the
  // returned row, and a layout styles the cursor row through that class. It
  // appends `trailing` to the row when the row does not hold it, and makes the
  // row clickable as a `.ui-row` with `onClick` is. The picker owns a row
  // draw's lifetime: it runs the row's dispose, which may remove the row,
  // before it draws that row again (every row on a filter change or
  // `redraw()`, the old and new cursor rows on a cursor move) and when it
  // closes.
  drawRow?(parent: HTMLElement, item: T, input: DrawRowInput): DrawnPickerRow;
  // The section `item` sits under; null for none. The list draws a heading
  // above a row whose section is not null and differs from the previous row's;
  // it does not sort, so the caller keeps a section's items together. A heading
  // takes no cursor and no click, and hides while a filter is typed.
  section?(item: T): string | null;
  // Draws a heading into `parent`, the heading's `li`, and returns the draw;
  // the title is the `li`'s text when left out. The picker runs its dispose
  // before every row draws again (a filter change or `redraw()`, never a cursor
  // move) and when it closes.
  drawHeading?(parent: HTMLElement, title: string): DrawnPickerRow;
}

// What a request's `drawRow` draws one row with.
export interface DrawRowInput {
  label: string;
  trailing: HTMLElement | null;
}

// A row `drawRow` drew and the dispose of its draw: a layout host
// `DrawnPart`'s shape, with the drawn root as `element`.
export interface DrawnPickerRow {
  element: HTMLElement;
  dispose(): void;
}

// One floating list, holding one request at a time: `open` replaces the open
// request, if any, without hearing its cancel. Its scope is pushed while it
// shows, and the base scope changing under it, or a click on the layer
// outside the panel, cancels it. `choose` with nothing visible does nothing;
// `close` hides it without hearing a cancel. A filter shows the rows it keeps
// best match first, the cursor on the first.
// A request's `headerEnd` sits at the end of the title line while it is open,
// and its `cursorEnd` at the trailing end of the cursor row only, moved there
// on each draw.
// With a filter editor, `focusFilter` types into the filter box above the
// list and `leaveFilter` leaves it with the filter kept; without one both do
// nothing. A request's `drawRow` draws each row; the picker sets the row's
// title, `is-selected` and `is-cursor`, and the click that chooses its item.
// A cursor move draws only the row the cursor left and the row it reached.
// A request's `section` adds headings between the rows while no filter is
// typed; the cursor and `cursorIndex` count items only.
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
  // Draws the open request's rows again, as after a new layout; nothing when
  // closed.
  redraw(): void;
}

export interface ListPickerDeps {
  // Pushes the owning plugin's picker scope.
  pushScope(): PushedScope;
  // Takes the `picker shown: <title>` line.
  log: PluginLog;
  // Ranks the rows a filter keeps.
  matcher: FuzzyMatcher;
  // Adds the filter box above the list when given.
  filterEditor?: EditorHost;
}

// The open request with its item type erased: the list reads only labels and
// hands the chosen index back.
interface OpenRequest {
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

  const scrollToCursor = () =>
    list.querySelector('.is-cursor')?.scrollIntoView({ block: 'nearest' });

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

  // Moves the cursor by `step`, drawing only the rows it left and reached.
  const moveCursor = (step: 1 | -1) => {
    const left = state.cursor;
    state = movePicker(state, step, deps.matcher);
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
      head.replaceChildren(
        ...(next.headerEnd ? [title, next.headerEnd] : [title]),
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
      moveCursor(1);
    },
    up() {
      moveCursor(-1);
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
    redraw() {
      if (request !== null) {
        draw();
      }
    },
  };
  return picker;
}
