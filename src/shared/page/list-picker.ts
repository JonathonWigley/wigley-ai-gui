import {
  type CommandArg,
  type CommandId,
  PICKER_CANCEL,
  PICKER_CHOOSE_ROW,
} from '../../contracts/commands';
import type { EditorHost } from '../../contracts/editor';
import type { FuzzyMatcher } from '../../contracts/fuzzy';
import type {
  DrawnPickerRow,
  DrawRowInput,
  ListPicker,
} from '../../contracts/list-picker';
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

// `owner` is the owning plugin's id, and `run` runs a command: a row's click
// runs `picker.chooseRow` and a click outside the panel `picker.cancel`, each
// naming `owner`.
export interface ListPickerDeps {
  owner: string;
  run(command: CommandId, arg: CommandArg): void;
  // Pushes the owning plugin's picker scope.
  pushScope(): PushedScope;
  // Takes the `picker shown: <title>` and `picker row <index> is not shown`
  // lines.
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
      deps.run(PICKER_CANCEL.id, deps.owner);
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
    const choose = () =>
      deps.run(PICKER_CHOOSE_ROW.id, { owner: deps.owner, index });
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
    chooseAt(index) {
      if (!visibleIndexes(state, deps.matcher).includes(index)) {
        deps.log(`picker row ${index} is not shown`);
        return;
      }
      state = { ...state, cursor: index };
      picker.choose();
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
