import './drag-reorder.css';

// The only data a drag carries: with no `text/plain`, a drop on a text box
// inserts nothing.
const REORDER_TYPE = 'application/x-wigley-reorder';

// A finished drop: the dragged item's key, the zone it landed on, and where it
// lands among that zone's items other than the dragged one; 0 in an unordered
// zone.
export interface ReorderDrop {
  key: string;
  zone: string;
  index: number;
}

// `started` runs inside `dragstart`, where a layout change can cancel the drag
// in Chromium, so a view defers one. `dropped` may call `clear` to redraw.
// `ended` runs once per drag, after `dropped`. A drag `clear` ended has no
// registrations left by then; after a drop or `dragend` they stand, so `ended`
// calls `clear` before it registers again.
export interface DragReorderEvents {
  dropped(drop: ReorderDrop): void;
  started(): void;
  ended(): void;
}

// A view registers what it drew and hears what a drop means; the order is the
// view's to change. Each item lies inside its zone's element and items are
// registered in drawn order, top to bottom; zones do not nest. `clear` undoes
// every registration and ends a running drag, so a view calls it before it
// redraws; `dispose` does the same when the view drops the primitive.
export interface DragReorder {
  zone(
    element: HTMLElement,
    zoneId: string,
    options: { ordered: boolean },
  ): void;
  item(
    element: HTMLElement,
    source: HTMLElement,
    key: string,
    zoneId: string,
  ): void;
  isDragging(): boolean;
  clear(): void;
  dispose(): void;
}

interface Zone {
  element: HTMLElement;
  id: string;
  isOrdered: boolean;
}

interface Item {
  element: HTMLElement;
  key: string;
  zoneId: string;
}

// The one drop mark on screen, so marks live in one zone at a time.
interface DropMark {
  element: HTMLElement;
  state: 'is-drop-before' | 'is-drop-after' | 'is-drop-target';
}

// Where a pointer at `pointerY` lands, counted without the dragged item:
// `midpoints` are every item's in order, `draggedIndex` the dragged item's
// position among them, null when it comes from another zone.
export function dropIndex(
  midpoints: readonly number[],
  pointerY: number,
  draggedIndex: number | null,
): number {
  let index = 0;
  for (let position = 0; position < midpoints.length; position++) {
    if (position !== draggedIndex && pointerY >= midpoints[position]) {
      index++;
    }
  }
  return index;
}

function midpointOf(element: HTMLElement): number {
  const { top, height } = element.getBoundingClientRect();
  return top + height / 2;
}

function dropIndexIn(
  zone: Zone,
  zoneItems: readonly Item[],
  dragged: Item,
  pointerY: number,
): number {
  if (!zone.isOrdered) {
    return 0;
  }
  const draggedIndex = zoneItems.indexOf(dragged);
  return dropIndex(
    zoneItems.map((item) => midpointOf(item.element)),
    pointerY,
    draggedIndex === -1 ? null : draggedIndex,
  );
}

// An ordered zone with no other item has nothing to mark a line on, so the
// zone takes the mark an unordered one does.
function dropMarkIn(
  zone: Zone,
  zoneItems: readonly Item[],
  dragged: Item,
  pointerY: number,
): DropMark {
  const others = zoneItems.filter((item) => item !== dragged);
  const last = others.at(-1);
  if (!zone.isOrdered || last === undefined) {
    return { element: zone.element, state: 'is-drop-target' };
  }
  const index = dropIndexIn(zone, zoneItems, dragged, pointerY);
  return index < others.length
    ? { element: others[index].element, state: 'is-drop-before' }
    : { element: last.element, state: 'is-drop-after' };
}

// HTML5 drag to reorder over drop zones. It acts only on a drag it started, so
// a file drag passing over a zone gets no mark, no `preventDefault` and no
// `dropEffect` from it.
export function createDragReorder(events: DragReorderEvents): DragReorder {
  let items: Item[] = [];
  let undos: (() => void)[] = [];
  let dragged: Item | null = null;
  let mark: DropMark | null = null;

  const itemsOf = (zone: Zone) =>
    items.filter((item) => item.zoneId === zone.id);

  // The item this primitive's running drag holds, null for any other drag. The
  // type also turns away a file drag after a drag whose `dragend` never came.
  const ownDragged = (event: DragEvent): Item | null =>
    event.dataTransfer?.types.includes(REORDER_TYPE) ? dragged : null;

  const showMark = (next: DropMark | null) => {
    const isSame =
      mark?.element === next?.element && mark?.state === next?.state;
    if (isSame) {
      return;
    }
    mark?.element.classList.remove(mark.state);
    next?.element.classList.add(next.state);
    mark = next;
  };

  const endDrag = () => {
    if (dragged === null) {
      return;
    }
    dragged.element.classList.remove('is-dragging');
    dragged = null;
    showMark(null);
    events.ended();
  };

  const startDrag = (item: Item, source: HTMLElement, event: DragEvent) => {
    // A text selection or a link inside the source starts its own drag.
    if (event.target !== source) {
      return;
    }
    endDrag();
    const transfer = event.dataTransfer!;
    transfer.setData(REORDER_TYPE, item.key);
    transfer.effectAllowed = 'move';
    item.element.classList.add('is-dragging');
    dragged = item;
    events.started();
  };

  const hover = (zone: Zone, event: DragEvent) => {
    const item = ownDragged(event);
    if (item === null) {
      return;
    }
    event.preventDefault();
    event.dataTransfer!.dropEffect = 'move';
    showMark(dropMarkIn(zone, itemsOf(zone), item, event.clientY));
  };

  const leave = (zone: Zone, event: DragEvent) => {
    if (ownDragged(event) === null) {
      return;
    }
    const staysInZone = zone.element.contains(
      event.relatedTarget as Node | null,
    );
    const zoneHoldsMark = mark !== null && zone.element.contains(mark.element);
    if (!staysInZone && zoneHoldsMark) {
      showMark(null);
    }
  };

  const drop = (zone: Zone, event: DragEvent) => {
    const item = ownDragged(event);
    if (item === null) {
      return;
    }
    event.preventDefault();
    events.dropped({
      key: item.key,
      zone: zone.id,
      index: dropIndexIn(zone, itemsOf(zone), item, event.clientY),
    });
    endDrag();
  };

  const listen = (
    element: HTMLElement,
    type:
      | 'dragstart'
      | 'dragend'
      | 'dragleave'
      | 'drop'
      | 'dragenter'
      | 'dragover',
    listener: (event: DragEvent) => void,
  ) => {
    element.addEventListener(type, listener);
    undos.push(() => element.removeEventListener(type, listener));
  };

  const clear = () => {
    for (const undo of undos) {
      undo();
    }
    undos = [];
    items = [];
    endDrag();
  };

  return {
    zone(element, zoneId, options) {
      const zone: Zone = { element, id: zoneId, isOrdered: options.ordered };
      element.classList.add('ui-drag-reorder-zone');
      undos.push(() => element.classList.remove('ui-drag-reorder-zone'));
      listen(element, 'dragenter', (event) => hover(zone, event));
      listen(element, 'dragover', (event) => hover(zone, event));
      listen(element, 'dragleave', (event) => leave(zone, event));
      listen(element, 'drop', (event) => drop(zone, event));
    },
    item(element, source, key, zoneId) {
      const item: Item = { element, key, zoneId };
      items.push(item);
      element.classList.add('ui-drag-reorder-item');
      source.draggable = true;
      undos.push(() => {
        element.classList.remove('ui-drag-reorder-item');
        source.draggable = false;
      });
      listen(source, 'dragstart', (event) => startDrag(item, source, event));
      listen(source, 'dragend', endDrag);
    },
    isDragging: () => dragged !== null,
    clear,
    dispose: clear,
  };
}
