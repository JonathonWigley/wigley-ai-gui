import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asHtml, FakeElement, installFakeDom } from '../test-dom';
import { createDragReorder, dropIndex, type ReorderDrop } from './drag-reorder';

const STATES = [
  'is-dragging',
  'is-drop-before',
  'is-drop-after',
  'is-drop-target',
];

interface FakeTransfer {
  types: string[];
  effectAllowed: string;
  dropEffect: string;
  setData(type: string, value: string): void;
  getData(type: string): string;
}

function fakeTransfer(types: string[] = []): FakeTransfer {
  const data = new Map<string, string>();
  return {
    types,
    effectAllowed: '',
    dropEffect: '',
    setData(type, value) {
      types.push(type);
      data.set(type, value);
    },
    getData: (type) => data.get(type) ?? '',
  };
}

// An element whose rect has its vertical midpoint at `midpoint`.
function itemAt(midpoint: number): FakeElement {
  const node = new FakeElement('div');
  node.getBoundingClientRect = () => ({
    left: 0,
    top: midpoint - 10,
    width: 0,
    height: 20,
  });
  return node;
}

// The ordered zone `list` holding a, b and c at midpoints 10, 30 and 50, the
// unordered zone `bin` holding x, and the ordered zone `empty`, each drawn
// apart.
function fixture(transfer: FakeTransfer = fakeTransfer()) {
  const list = new FakeElement('div');
  const bin = new FakeElement('div');
  const empty = new FakeElement('div');
  const a = itemAt(10);
  const b = itemAt(30);
  const c = itemAt(50);
  const x = itemAt(70);
  list.append(a, b, c);
  bin.append(x);
  const named = { list, bin, empty, a, b, c, x };
  const drops: ReorderDrop[] = [];
  const counts = { started: 0, ended: 0, prevented: 0 };
  const reorder = createDragReorder({
    dropped: (drop) => drops.push(drop),
    started: () => counts.started++,
    ended: () => counts.ended++,
  });
  reorder.zone(asHtml(list), 'list', { ordered: true });
  reorder.zone(asHtml(bin), 'bin', { ordered: false });
  reorder.zone(asHtml(empty), 'empty', { ordered: true });
  for (const [key, node] of [
    ['a', a],
    ['b', b],
    ['c', c],
  ] as const) {
    reorder.item(asHtml(node), asHtml(node), key, 'list');
  }
  reorder.item(asHtml(x), asHtml(x), 'x', 'bin');

  const fire = (
    node: FakeElement,
    type: string,
    fields: Record<string, unknown> = {},
  ) => {
    const event = node.fire(type, { dataTransfer: transfer, ...fields });
    counts.prevented += event.defaultPrevented ? 1 : 0;
  };
  return {
    ...named,
    reorder,
    drops,
    counts,
    transfer,
    fire,
    start: (node: FakeElement) => fire(node, 'dragstart'),
    over: (zone: FakeElement, clientY: number) =>
      fire(zone, 'dragover', { clientY }),
    drop: (zone: FakeElement, clientY: number) =>
      fire(zone, 'drop', { clientY }),
    // Every state class on screen, as `<name> <state>`.
    marks: () =>
      Object.entries(named).flatMap(([name, node]) =>
        STATES.filter((state) => node.classList.contains(state)).map(
          (state) => `${name} ${state}`,
        ),
      ),
  };
}

type Fixture = ReturnType<typeof fixture>;

const OWN_TRAFFIC = {
  types: ['application/x-wigley-reorder'],
  effectAllowed: 'move',
  dropEffect: 'move',
};

beforeEach(() => {
  installFakeDom(vi.stubGlobal);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('dropIndex', () => {
  it.each([
    { draggedIndex: null, pointerY: 5, index: 0 },
    { draggedIndex: null, pointerY: 20, index: 1 },
    { draggedIndex: null, pointerY: 30, index: 2 },
    { draggedIndex: null, pointerY: 40, index: 2 },
    { draggedIndex: null, pointerY: 60, index: 3 },
    { draggedIndex: 0, pointerY: 5, index: 0 },
    { draggedIndex: 0, pointerY: 20, index: 0 },
    { draggedIndex: 0, pointerY: 40, index: 1 },
    { draggedIndex: 0, pointerY: 60, index: 2 },
  ])(
    'dropIndex_countsWithoutTheDraggedItem: dragged $draggedIndex at $pointerY → $index',
    ({ draggedIndex, pointerY, index }) => {
      expect(dropIndex([10, 30, 50], pointerY, draggedIndex)).toBe(index);
    },
  );
});

describe('createDragReorder', () => {
  it.each<{
    name: string;
    transfer?: () => FakeTransfer;
    steps(fx: Fixture): void;
    marks: string[];
    drops: ReorderDrop[];
    started: number;
    ended: number;
    isDragging: boolean;
    isPrevented: boolean;
    traffic: { types: string[]; effectAllowed: string; dropEffect: string };
  }>([
    {
      name: 'a file passing over and dropped on a zone is left alone',
      transfer: () => fakeTransfer(['Files']),
      steps(fx) {
        fx.fire(fx.list, 'dragenter', { clientY: 20 });
        fx.over(fx.list, 20);
        fx.over(fx.bin, 20);
        fx.drop(fx.bin, 20);
      },
      marks: [],
      drops: [],
      started: 0,
      ended: 0,
      isDragging: false,
      isPrevented: false,
      traffic: { types: ['Files'], effectAllowed: '', dropEffect: '' },
    },
    {
      name: 'a file passing over after a drag whose dragend never came gets no mark',
      transfer: () => fakeTransfer(['Files']),
      steps(fx) {
        fx.fire(fx.a, 'dragstart', { dataTransfer: fakeTransfer() });
        fx.over(fx.list, 20);
      },
      marks: ['a is-dragging'],
      drops: [],
      started: 1,
      ended: 0,
      isDragging: true,
      isPrevented: false,
      traffic: { types: ['Files'], effectAllowed: '', dropEffect: '' },
    },
    {
      name: 'a selection dragged inside a source is not a reorder',
      steps(fx) {
        fx.fire(fx.a, 'dragstart', { target: new FakeElement('span') });
      },
      marks: [],
      drops: [],
      started: 0,
      ended: 0,
      isDragging: false,
      isPrevented: false,
      traffic: { types: [], effectAllowed: '', dropEffect: '' },
    },
    {
      name: 'a drag over the list marks where it lands, not the dragged item',
      steps(fx) {
        fx.start(fx.a);
        fx.fire(fx.list, 'dragenter', { clientY: 40 });
      },
      marks: ['a is-dragging', 'c is-drop-before'],
      drops: [],
      started: 1,
      ended: 0,
      isDragging: true,
      isPrevented: true,
      traffic: OWN_TRAFFIC,
    },
    {
      name: 'a drag past the last other item marks that item after',
      steps(fx) {
        fx.start(fx.c);
        fx.over(fx.list, 60);
      },
      marks: ['b is-drop-after', 'c is-dragging'],
      drops: [],
      started: 1,
      ended: 0,
      isDragging: true,
      isPrevented: true,
      traffic: OWN_TRAFFIC,
    },
    {
      name: 'a drag over an ordered zone with no other item marks the zone',
      steps(fx) {
        fx.start(fx.a);
        fx.over(fx.empty, 5);
      },
      marks: ['empty is-drop-target', 'a is-dragging'],
      drops: [],
      started: 1,
      ended: 0,
      isDragging: true,
      isPrevented: true,
      traffic: OWN_TRAFFIC,
    },
    {
      name: 'marks move to the zone under the pointer, whichever leave comes after',
      steps(fx) {
        fx.start(fx.a);
        fx.over(fx.list, 5);
        fx.over(fx.bin, 5);
        fx.fire(fx.list, 'dragleave', { relatedTarget: fx.bin });
      },
      marks: ['bin is-drop-target', 'a is-dragging'],
      drops: [],
      started: 1,
      ended: 0,
      isDragging: true,
      isPrevented: true,
      traffic: OWN_TRAFFIC,
    },
    {
      name: 'moving between children of a zone keeps its mark',
      steps(fx) {
        fx.start(fx.a);
        fx.over(fx.list, 5);
        fx.fire(fx.list, 'dragleave', { relatedTarget: fx.c });
      },
      marks: ['b is-drop-before', 'a is-dragging'],
      drops: [],
      started: 1,
      ended: 0,
      isDragging: true,
      isPrevented: true,
      traffic: OWN_TRAFFIC,
    },
    {
      name: 'leaving every zone clears the mark',
      steps(fx) {
        fx.start(fx.a);
        fx.over(fx.list, 5);
        fx.fire(fx.list, 'dragleave', { relatedTarget: null });
      },
      marks: ['a is-dragging'],
      drops: [],
      started: 1,
      ended: 0,
      isDragging: true,
      isPrevented: true,
      traffic: OWN_TRAFFIC,
    },
    {
      name: 'a drop at index 1 reports it, clears every mark and ends once, its dragend included',
      steps(fx) {
        fx.start(fx.a);
        fx.over(fx.list, 40);
        fx.drop(fx.list, 40);
        fx.fire(fx.a, 'dragend');
      },
      marks: [],
      drops: [{ key: 'a', zone: 'list', index: 1 }],
      started: 1,
      ended: 1,
      isDragging: false,
      isPrevented: true,
      traffic: OWN_TRAFFIC,
    },
    {
      name: 'a drop from another zone counts every item; the pointer at drop decides',
      steps(fx) {
        fx.start(fx.x);
        fx.over(fx.list, 5);
        fx.drop(fx.list, 60);
      },
      marks: [],
      drops: [{ key: 'x', zone: 'list', index: 3 }],
      started: 1,
      ended: 1,
      isDragging: false,
      isPrevented: true,
      traffic: OWN_TRAFFIC,
    },
    {
      name: 'a drop on an unordered zone reports index 0',
      steps(fx) {
        fx.start(fx.b);
        fx.over(fx.bin, 60);
        fx.drop(fx.bin, 60);
      },
      marks: [],
      drops: [{ key: 'b', zone: 'bin', index: 0 }],
      started: 1,
      ended: 1,
      isDragging: false,
      isPrevented: true,
      traffic: OWN_TRAFFIC,
    },
    {
      name: 'dragend off every zone ends the drag with no drop',
      steps(fx) {
        fx.start(fx.a);
        fx.over(fx.list, 40);
        fx.fire(fx.a, 'dragend');
      },
      marks: [],
      drops: [],
      started: 1,
      ended: 1,
      isDragging: false,
      isPrevented: true,
      traffic: OWN_TRAFFIC,
    },
    {
      name: 'clear ends the drag, and a drop on a zone drawn again reports nothing',
      steps(fx) {
        fx.start(fx.a);
        fx.over(fx.list, 40);
        fx.reorder.clear();
        fx.reorder.zone(asHtml(fx.list), 'list', { ordered: true });
        fx.drop(fx.list, 40);
      },
      marks: [],
      drops: [],
      started: 1,
      ended: 1,
      isDragging: false,
      isPrevented: true,
      traffic: OWN_TRAFFIC,
    },
    {
      name: 'clear removes the listeners, so an old source starts nothing',
      steps(fx) {
        fx.start(fx.a);
        fx.reorder.clear();
        expect(asHtml(fx.a).draggable).toBe(false);
        fx.start(fx.a);
      },
      marks: [],
      drops: [],
      started: 1,
      ended: 1,
      isDragging: false,
      isPrevented: false,
      traffic: {
        types: ['application/x-wigley-reorder'],
        effectAllowed: 'move',
        dropEffect: '',
      },
    },
    {
      name: 'dispose ends the drag as clear does',
      steps(fx) {
        fx.start(fx.a);
        fx.over(fx.list, 40);
        fx.reorder.dispose();
        fx.drop(fx.list, 40);
      },
      marks: [],
      drops: [],
      started: 1,
      ended: 1,
      isDragging: false,
      isPrevented: true,
      traffic: OWN_TRAFFIC,
    },
  ])('dragReorder_actsOnOwnDragsOnly: $name', (row) => {
    const fx = fixture(row.transfer?.());
    expect(asHtml(fx.a).draggable).toBe(true);

    row.steps(fx);

    expect(fx.marks().sort()).toEqual([...row.marks].sort());
    expect(fx.drops).toEqual(row.drops);
    expect(fx.counts.started).toBe(row.started);
    expect(fx.counts.ended).toBe(row.ended);
    expect(fx.reorder.isDragging()).toBe(row.isDragging);
    expect(fx.counts.prevented > 0).toBe(row.isPrevented);
    expect({
      types: fx.transfer.types,
      effectAllowed: fx.transfer.effectAllowed,
      dropEffect: fx.transfer.dropEffect,
    }).toEqual(row.traffic);
  });
});
