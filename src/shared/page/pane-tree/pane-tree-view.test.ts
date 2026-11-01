import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Timers } from '../../../contracts/ambient';
import {
  asFake,
  type FocusFakeDocument,
  FocusFakeElement,
  findAll,
  installFocusFakeDom,
} from '../test-dom';
import type { PaneNode, PaneTree } from './pane-tree';
import { createPaneTreeView, type PaneTreeView } from './pane-tree-view';

type Listener = (event: unknown) => void;

// The fake DOM's element with what the pane tree view reads beyond it: a
// client rect the test sets, pointer capture as a set of pointer ids, and
// listeners `dispatch` runs with the event fields it is given.
class PaneFakeElement extends FocusFakeElement {
  rect = { left: 0, top: 0, width: 0, height: 0 };
  captured = new Set<number>();
  private handlers = new Map<string, Listener[]>();

  override getBoundingClientRect() {
    return this.rect;
  }

  setPointerCapture(id: number) {
    this.captured.add(id);
  }

  hasPointerCapture(id: number) {
    return this.captured.has(id);
  }

  override addEventListener(type: string, listener: Listener) {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), listener]);
  }

  override removeEventListener(type: string, listener: Listener) {
    this.handlers.set(
      type,
      (this.handlers.get(type) ?? []).filter((held) => held !== listener),
    );
  }

  dispatch(type: string, fields: Record<string, unknown> = {}) {
    const event = { type, target: this, preventDefault() {}, ...fields };
    for (const listener of this.handlers.get(type) ?? []) {
      listener(event);
    }
  }
}

// The window's listeners by event type, removed by reference.
function fakeWindow() {
  const listeners = new Map<string, Listener[]>();
  return {
    addEventListener: (type: string, listener: Listener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    removeEventListener: (type: string, listener: Listener) => {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((held) => held !== listener),
      );
    },
    fire(type: string, fields: Record<string, unknown>) {
      for (const listener of listeners.get(type) ?? []) {
        listener({ type, ...fields });
      }
    },
  };
}

const timers: Timers = { set: () => 1, clear: () => undefined };

function leaf(id: string): PaneNode {
  return { kind: 'leaf', id };
}

function row(ratio: number, first: PaneNode, second: PaneNode): PaneNode {
  return { kind: 'split', axis: 'row', ratio, first, second };
}

let doc: FocusFakeDocument;
let fakeWin: ReturnType<typeof fakeWindow>;
// Runs the callback of the last ResizeObserver built, as a resize of the box
// it observes does.
let resized: () => void;

beforeEach(() => {
  doc = installFocusFakeDom(vi.stubGlobal, PaneFakeElement);
  fakeWin = fakeWindow();
  vi.stubGlobal('window', fakeWin);
  resized = () => undefined;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resized = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  // A 4px handle.
  vi.stubGlobal('getComputedStyle', () => ({
    getPropertyValue: () => ' 4px',
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// A connected view showing `tree`, with every tree and focus change recorded.
function viewOf(tree: PaneTree) {
  const changed: PaneTree[] = [];
  const focused: string[] = [];
  const view = createPaneTreeView({
    initialId: tree.focusedId,
    anchor: () => ({ dispose: () => undefined }),
    timers,
    changed: (next) => changed.push(next),
    focused: (id) => focused.push(id),
  });
  view.restore(tree);
  asFake(view.element).isPageRoot = true;
  return { view, changed, focused };
}

function asPane(node: HTMLElement): PaneFakeElement {
  return node as unknown as PaneFakeElement;
}

// The outermost split box and its handle, the box `width` wide at the client's
// left edge with a 4px handle.
function outerSplit(view: PaneTreeView, width: number) {
  const root = asFake(view.element);
  const box = findAll(root, 'pane-tree-split')[0] as PaneFakeElement;
  const handle = findAll(root, 'pane-tree-handle')[0] as PaneFakeElement;
  box.rect = { left: 0, top: 0, width, height: 600 };
  handle.rect = { left: 0, top: 0, width: 4, height: 600 };
  return { box, handle };
}

function outerRatio(view: PaneTreeView): number {
  const { root } = view.tree();
  if (root.kind !== 'split') {
    throw new Error('The tree has no split');
  }
  return root.ratio;
}

describe('createPaneTreeView split', () => {
  it.each([
    { axis: 'row', width: 564, height: 0, splits: true },
    { axis: 'row', width: 563, height: 0, splits: false },
    { axis: 'column', width: 0, height: 324, splits: true },
    { axis: 'column', width: 0, height: 323, splits: false },
  ] as const)(
    'refuses a split whose halves beside the handle fall under the least size: $axis $width x $height',
    ({ axis, width, height, splits }) => {
      const { view, changed } = viewOf({ root: leaf('a'), focusedId: 'a' });
      asPane(view.slot('a')).rect = { left: 0, top: 0, width, height };

      const took = view.split(axis, 'b');

      expect(took).toBe(splits);
      expect(view.tree().focusedId).toBe(splits ? 'b' : 'a');
      expect(changed.length).toBe(splits ? 1 : 0);
    },
  );
});

describe('createPaneTreeView draw', () => {
  it.each([
    {
      name: 'a swap',
      act: (view: PaneTreeView) => view.swap('right'),
    },
    {
      name: 'a close of a sibling',
      act: (view: PaneTreeView) => view.close('b'),
    },
  ])('keeps focus on an element in a slot the draw moved: $name', ({ act }) => {
    const { view } = viewOf({
      root: row(0.4, leaf('a'), row(0.5, leaf('b'), leaf('c'))),
      focusedId: 'a',
    });
    const input = document.createElement('input');
    view.slot('c').append(input);
    input.focus();

    act(view);

    expect(doc.activeElement).toBe(input);
  });
});

describe('createPaneTreeView divider limits', () => {
  // A 1504px box leaves a 1500px span; the nested side keeps two 280px panes
  // and a handle, 564px, so the outer divider stops at 936px.
  it.each([
    {
      name: 'a drag',
      act: (view: PaneTreeView) => {
        const { handle } = outerSplit(view, 1504);
        handle.dispatch('pointerdown', {
          button: 0,
          pointerId: 1,
          clientX: 600,
        });
        handle.dispatch('pointermove', { pointerId: 1, clientX: 1400 });
      },
    },
    {
      name: 'a nudge',
      act: (view: PaneTreeView) => {
        outerSplit(view, 1504);
        for (let press = 0; press < 20; press++) {
          view.outer.resize.nudge('right');
        }
      },
    },
  ])(
    'stops the divider where a side keeps the least size of each pane across it: $name',
    ({ act }) => {
      const { view } = viewOf({
        root: row(0.4, leaf('a'), row(0.5, leaf('b'), leaf('c'))),
        focusedId: 'a',
      });

      act(view);

      expect(outerRatio(view)).toBeCloseTo(936 / 1500, 9);
    },
  );
});

describe('createPaneTreeView resize of the tree box', () => {
  // With a 4px handle a 1504px box leaves a 1500px span: the nested side
  // keeps two 280px panes and a handle, 564px, so the outer split draws at
  // most 936 / 1500, and the nested split, 560px across, draws at 0.5. A
  // 3004px box has room for the stored ratios.
  it('draws each split clamped to the least sizes, keeping the stored tree, and draws the stored ratios once the box grows back', () => {
    const stored = row(0.7, leaf('a'), row(0.4, leaf('b'), leaf('c')));
    const { view, changed } = viewOf({ root: stored, focusedId: 'a' });
    const grows = () =>
      ['a', 'b'].map((id) => Number(view.slot(id).style.flexGrow));
    const resizeTo = (width: number) => {
      asPane(view.element).rect = { left: 0, top: 0, width, height: 600 };
      resized();
    };

    resizeTo(1504);
    const shrunk = grows();
    resizeTo(3004);

    expect(shrunk[0]).toBeCloseTo(936 / 1500, 9);
    expect(shrunk[1]).toBeCloseTo(0.5, 9);
    expect(grows()).toEqual([0.7, 0.4]);
    expect(view.tree().root).toEqual(stored);
    expect(changed).toEqual([]);
  });
});

describe('createPaneTreeView drag', () => {
  it('reports the dragged tree once, at the drag end', () => {
    const { view, changed } = viewOf({
      root: row(0.4, leaf('a'), leaf('b')),
      focusedId: 'a',
    });
    const { handle } = outerSplit(view, 1504);
    handle.dispatch('pointerdown', { button: 0, pointerId: 1, clientX: 600 });
    handle.dispatch('pointermove', { pointerId: 1, clientX: 750 });
    handle.dispatch('pointermove', { pointerId: 1, clientX: 900 });
    expect(changed).toEqual([]);

    fakeWin.fire('pointerup', { pointerId: 1 });

    expect(changed).toEqual([view.tree()]);
    expect(outerRatio(view)).toBeCloseTo(0.6, 9);
  });
});

describe('createPaneTreeView focused', () => {
  it.each([
    {
      name: 'focus on the focused pane',
      act: (view: PaneTreeView) => view.focus('a'),
      expected: [],
    },
    {
      name: 'focus on another pane',
      act: (view: PaneTreeView) => view.focus('c'),
      expected: ['c'],
    },
    {
      name: 'a focus move',
      act: (view: PaneTreeView) => view.outer.focus.move('right'),
      expected: ['b'],
    },
    {
      name: 'a press on another pane',
      act: (view: PaneTreeView) =>
        asPane(view.element).dispatch('pointerdown', {
          target: view.slot('b'),
        }),
      expected: ['b'],
    },
    {
      name: 'a swap',
      act: (view: PaneTreeView) => view.swap('right'),
      expected: [],
    },
    {
      name: 'a close of another pane',
      act: (view: PaneTreeView) => view.close('c'),
      expected: [],
    },
    {
      name: 'a close of the focused pane',
      act: (view: PaneTreeView) => view.close('a'),
      expected: ['b'],
    },
    {
      name: 'a nudge',
      act: (view: PaneTreeView) => {
        outerSplit(view, 1504);
        view.outer.resize.nudge('right');
      },
      expected: [],
    },
  ])('reports focus only when it moves: $name', ({ act, expected }) => {
    const { view, focused } = viewOf({
      root: row(0.4, leaf('a'), row(0.5, leaf('b'), leaf('c'))),
      focusedId: 'a',
    });

    act(view);

    expect(focused).toEqual(expected);
  });
});
