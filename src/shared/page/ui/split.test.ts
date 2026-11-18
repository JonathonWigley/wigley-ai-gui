import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Timers } from '../../../contracts/ambient';
import type { UiState } from '../../../contracts/ui-state';
import { uiStateOver } from '../../fake-ui-state.test-support';
import type { AnchorNamer } from './key-anchors';
import { createSplit, createSplitDivider } from './split';
import { SPLIT_NUDGE_STEP } from './split-width';

type Listener = (event: Event) => void;

// The DOM surface the split uses. Pointer capture is a set of pointer ids the
// test adds to through setPointerCapture and removes from by hand; `rect` is
// what getBoundingClientRect reports, `clientRects` what getClientRects does
// and `properties` each style property set.
interface FakeElement {
  className: string;
  classes: Set<string>;
  properties: Map<string, string>;
  captured: Set<number>;
  children: FakeElement[];
  rect: Rect;
  clientRects: unknown[];
  fire(type: string, fields?: Record<string, unknown>): Record<string, unknown>;
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

// A rect `size` wide from `start` on a row, or `size` tall from `start` on a
// column.
function rectOn(axis: 'row' | 'column', size: number, start = 0): Rect {
  return axis === 'row'
    ? { left: start, top: 0, width: size, height: 0 }
    : { left: 0, top: start, width: 0, height: size };
}

function fakeElement(): FakeElement {
  const classes = new Set<string>();
  const properties = new Map<string, string>();
  const captured = new Set<number>();
  const children: FakeElement[] = [];
  const listeners = new Map<string, Listener[]>();
  const node: FakeElement & Record<string, unknown> = {
    className: '',
    classes,
    properties,
    captured,
    children,
    rect: rectOn('row', 0),
    clientRects: [{}],
    classList: {
      add: (name: string) => classes.add(name),
      remove: (name: string) => classes.delete(name),
      contains: (name: string) => classes.has(name),
      toggle: (name: string, force: boolean) =>
        force ? classes.add(name) : classes.delete(name),
    },
    style: {
      setProperty: (name: string, value: string) => properties.set(name, value),
    },
    append: (...nodes: FakeElement[]) => children.push(...nodes),
    getBoundingClientRect: () => node.rect,
    getClientRects: () => node.clientRects,
    setPointerCapture: (id: number) => captured.add(id),
    hasPointerCapture: (id: number) => captured.has(id),
    addEventListener: (type: string, listener: Listener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    removeEventListener: (type: string, listener: Listener) => {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((held) => held !== listener),
      );
    },
    fire(type, fields = {}) {
      const event = { type, preventDefault: () => undefined, ...fields };
      for (const listener of listeners.get(type) ?? []) {
        listener(event as unknown as Event);
      }
      return event;
    },
  };
  return node;
}

const limits = { initial: 240, min: 160, endMin: 200 };
let created: FakeElement[];

// Every armed run with its delay, by handle; a clear removes it and is
// recorded.
function fakeTimers() {
  let nextHandle = 1;
  const armed = new Map<number, { run: () => void; ms: number }>();
  const cleared: number[] = [];
  const timers: Timers = {
    set: (run, ms) => {
      armed.set(nextHandle, { run, ms });
      return nextHandle++;
    },
    clear: (handle) => {
      cleared.push(handle);
      armed.delete(handle);
    },
  };
  const fireAll = () => {
    const runs = [...armed.values()];
    armed.clear();
    for (const { run } of runs) {
      run();
    }
  };
  return { timers, armed, cleared, fireAll };
}

// Each anchor named, with its command and options, and whether it was
// disposed.
function fakeAnchor() {
  const named: {
    element: FakeElement;
    command: string;
    options: unknown;
    isDisposed: boolean;
  }[] = [];
  const anchor: AnchorNamer<never> = (node, command, options) => {
    const entry = {
      element: node as unknown as FakeElement,
      command,
      options,
      isDisposed: false,
    };
    named.push(entry);
    return {
      dispose: () => {
        entry.isDisposed = true;
      },
    };
  };
  return { anchor, named };
}

// The split's root reports an 800px rect along its axis, wide on a row and
// tall on a column, at the client's top-left corner; the handle is the element
// createSplit last gave the `ui-split-handle` class. `uiState` is a store over
// `saved` unless given.
function splitWithHandle(
  saved: Map<string, unknown>,
  options: {
    axis?: 'row' | 'column';
    sizedPane?: 'start' | 'end';
    uiState?: UiState;
  } = {},
) {
  const timers = fakeTimers();
  const anchor = fakeAnchor();
  const split = createSplit({
    ...limits,
    ...options,
    uiState: options.uiState ?? uiStateOver(saved),
    stateKey: 'side',
    anchor: anchor.anchor,
    timers: timers.timers,
  });
  asFakeElement(split.element).rect = rectOn(options.axis ?? 'row', 800);
  const handle = created.findLast(
    (node) => node.className === 'ui-split-handle',
  )!;
  return { split, handle, timers, anchor };
}

// The pointer at `at` along `axis`, clientX on a row and clientY on a column,
// and at 50 across it.
function pointerAt(at: number, axis: 'row' | 'column') {
  return axis === 'row'
    ? { clientX: at, clientY: 50 }
    : { clientX: 50, clientY: at };
}

// Presses at `at`; each split test presses on the sized pane's edge.
function press(
  handle: FakeElement,
  pointerId: number,
  at: number,
  axis: 'row' | 'column' = 'row',
) {
  handle.fire('pointerdown', { button: 0, pointerId, ...pointerAt(at, axis) });
}

function move(
  handle: FakeElement,
  pointerId: number,
  at: number,
  axis: 'row' | 'column' = 'row',
) {
  handle.fire('pointermove', { pointerId, ...pointerAt(at, axis) });
}

function loseCapture(handle: FakeElement, pointerId: number) {
  handle.captured.delete(pointerId);
  handle.fire('lostpointercapture', { pointerId });
}

// The window surface the split uses: listeners by event type, removed by
// reference.
interface FakeWindow {
  listeners: Map<string, Listener[]>;
  fire(type: string, fields?: Record<string, unknown>): void;
}

function fakeWindow(): FakeWindow & Record<string, unknown> {
  const listeners = new Map<string, Listener[]>();
  return {
    listeners,
    addEventListener: (type: string, listener: Listener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    removeEventListener: (type: string, listener: Listener) => {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((held) => held !== listener),
      );
    },
    fire(type, fields = {}) {
      const event = { type, ...fields };
      for (const listener of listeners.get(type) ?? []) {
        listener(event as unknown as Event);
      }
    },
  };
}

let fakeWin: FakeWindow;
// The callback the last ResizeObserver was built with, and whether it was
// disconnected.
let resized: (entries: { contentRect: { width: number } }[]) => void;
let isObserverDisconnected: boolean;

beforeEach(() => {
  created = [];
  fakeWin = fakeWindow();
  resized = () => undefined;
  isObserverDisconnected = false;
  vi.stubGlobal('window', fakeWin);
  vi.stubGlobal('document', {
    createElement: () => {
      const node = fakeElement();
      created.push(node);
      return node;
    },
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: typeof resized) {
        resized = callback;
      }
      observe() {}
      disconnect() {
        isObserverDisconnected = true;
      }
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createSplit drag', () => {
  // The root spans 800px from 100 along its axis and the handle 4px, leaving a
  // 796px span; an end pane drawn 240 has its divider at 656.
  it.each([
    { axis: 'row', sizedPane: 'start', pressAt: 340, moveTo: 400 },
    { axis: 'column', sizedPane: 'start', pressAt: 340, moveTo: 400 },
    { axis: 'row', sizedPane: 'end', pressAt: 656, moveTo: 596 },
    { axis: 'column', sizedPane: 'end', pressAt: 656, moveTo: 596 },
  ] as const)(
    'drags along its axis and saves the dragged width when capture is lost: $axis $sizedPane',
    ({ axis, sizedPane, pressAt, moveTo }) => {
      const saved = new Map<string, unknown>();
      const { split, handle } = splitWithHandle(saved, { axis, sizedPane });
      asFakeElement(split.element).rect = rectOn(axis, 800, 100);
      handle.rect = rectOn(axis, 4);
      press(handle, 1, pressAt, axis);
      expect(handle.classes.has('is-active')).toBe(true);
      move(handle, 1, moveTo, axis);
      loseCapture(handle, 1);
      expect(split.width()).toBe(300);
      expect(saved.get('side')).toBe(300);
      expect(handle.classes.has('is-active')).toBe(false);
    },
  );

  it('keeps the first drag when a second pointer loses capture', () => {
    const saved = new Map<string, unknown>();
    const { split, handle } = splitWithHandle(saved);
    press(handle, 1, 240);
    press(handle, 2, 240);
    handle.fire('lostpointercapture', { pointerId: 2 });
    expect(handle.classes.has('is-active')).toBe(true);
    move(handle, 1, 320);
    expect(split.width()).toBe(320);
    expect(saved.has('side')).toBe(false);
  });

  it('drags again after capture was lost without reaching the handle', () => {
    const saved = new Map<string, unknown>();
    const { split, handle } = splitWithHandle(saved);
    press(handle, 1, 240);
    move(handle, 1, 300);
    handle.captured.delete(1);
    press(handle, 5, 300);
    expect(saved.get('side')).toBe(300);
    expect(handle.classes.has('is-active')).toBe(true);
    move(handle, 5, 200);
    loseCapture(handle, 5);
    expect(split.width()).toBe(200);
    expect(saved.get('side')).toBe(200);
    expect(handle.classes.has('is-active')).toBe(false);
  });

  it('saves the dragged width when the pointer is released off the handle', () => {
    const saved = new Map<string, unknown>();
    const { handle } = splitWithHandle(saved);
    press(handle, 1, 240);
    move(handle, 1, 300);
    fakeWin.fire('pointerup', { pointerId: 1 });
    expect(saved.get('side')).toBe(300);
    expect(handle.classes.has('is-active')).toBe(false);
  });

  it('saves the dragged width when the pointer is cancelled', () => {
    const saved = new Map<string, unknown>();
    const { handle } = splitWithHandle(saved);
    press(handle, 1, 240);
    move(handle, 1, 300);
    fakeWin.fire('pointercancel', { pointerId: 1 });
    expect(saved.get('side')).toBe(300);
  });

  it('keeps the drag when another pointer is released', () => {
    const saved = new Map<string, unknown>();
    const { split, handle } = splitWithHandle(saved);
    press(handle, 1, 240);
    move(handle, 1, 300);
    fakeWin.fire('pointerup', { pointerId: 2 });
    expect(handle.classes.has('is-active')).toBe(true);
    expect(saved.has('side')).toBe(false);
    move(handle, 1, 320);
    expect(split.width()).toBe(320);
  });

  it('stops listening on the window once the drag ends', () => {
    const saved = new Map<string, unknown>();
    const { handle } = splitWithHandle(saved);
    press(handle, 1, 240);
    loseCapture(handle, 1);
    expect(fakeWin.listeners.get('pointerup') ?? []).toEqual([]);
    expect(fakeWin.listeners.get('pointercancel') ?? []).toEqual([]);
  });
});

describe('createSplit reloadWidth', () => {
  it('takes the width another split stored', () => {
    const saved = new Map<string, unknown>();
    const { split } = splitWithHandle(saved);
    saved.set('side', 350);
    split.reloadWidth();
    expect(split.width()).toBe(350);
  });

  it('keeps the width of a drag in progress', () => {
    const saved = new Map<string, unknown>();
    const { split, handle } = splitWithHandle(saved);
    press(handle, 1, 240);
    move(handle, 1, 300);
    saved.set('side', 350);
    split.reloadWidth();
    expect(split.width()).toBe(300);
  });
});

describe('createSplit follows its key', () => {
  it('a split takes the width another split over its key stores', () => {
    const saved = new Map<string, unknown>();
    const uiState = uiStateOver(saved);
    const first = splitWithHandle(saved, { uiState });
    const second = splitWithHandle(saved, { uiState });
    first.handle.rect = rectOn('row', 4);

    first.split.nudge('right');

    expect(second.split.width()).toBe(limits.initial + SPLIT_NUDGE_STEP);
  });

  it('a drag in progress keeps its width when another split stores one', () => {
    const saved = new Map<string, unknown>();
    const uiState = uiStateOver(saved);
    splitWithHandle(saved, { uiState });
    const { split, handle } = splitWithHandle(saved, { uiState });
    press(handle, 1, 240);
    move(handle, 1, 300);

    uiState.set('side', 350);

    expect(split.width()).toBe(300);
  });

  it('a disposed split no longer follows its key', () => {
    const saved = new Map<string, unknown>();
    const uiState = uiStateOver(saved);
    const { split } = splitWithHandle(saved, { uiState });

    split.dispose();
    uiState.set('side', 350);

    expect(split.width()).toBe(240);
  });

  it('a split disposed from inside another listener of its key keeps its width', () => {
    const saved = new Map<string, unknown>();
    const uiState = uiStateOver(saved);
    splitWithHandle(saved, { uiState });
    let second: ReturnType<typeof splitWithHandle> | undefined;
    uiState.on('side', () => second?.split.dispose());
    second = splitWithHandle(saved, { uiState });

    uiState.set('side', 350);

    expect(second.split.width()).toBe(240);
  });
});

describe('createSplit endMin', () => {
  it.each([
    { axis: 'row', width: 359, isStacked: true },
    { axis: 'row', width: 360, isStacked: false },
    { axis: 'column', width: 359, isStacked: false },
  ] as const)(
    'stacks a row split while narrower than min plus endMin, a column split never: $axis $width',
    ({ axis, width, isStacked }) => {
      const { split } = splitWithHandle(new Map(), { axis });
      const root = asFakeElement(split.element);

      resized([{ contentRect: { width } }]);

      expect(root.classes.has('is-stacked')).toBe(isStacked);
    },
  );
});

describe('createSplit drawing', () => {
  it.each([
    {
      axis: 'row',
      sizedPane: 'start',
      classes: [],
      variable: '--ui-split-start',
    },
    {
      axis: 'row',
      sizedPane: 'end',
      classes: ['is-end-sized'],
      variable: '--ui-split-end',
    },
    {
      axis: 'column',
      sizedPane: 'start',
      classes: ['is-column'],
      variable: '--ui-split-start',
    },
    {
      axis: 'column',
      sizedPane: 'end',
      classes: ['is-column', 'is-end-sized'],
      variable: '--ui-split-end',
    },
  ] as const)(
    'marks the root and draws the sized pane in its variable: $axis $sizedPane',
    ({ axis, sizedPane, classes, variable }) => {
      const saved = new Map<string, unknown>([['side', 300]]);
      const { split } = splitWithHandle(saved, { axis, sizedPane });
      const root = asFakeElement(split.element);

      expect([...root.classes].sort()).toEqual(classes);
      expect(Object.fromEntries(root.properties)).toEqual({
        '--ui-split-end-min': '200px',
        [variable]: '300',
      });
    },
  );
});

describe('createSplit nudge', () => {
  it.each([
    { axis: 'row', stored: 240, direction: 'right', width: 264, written: 264 },
    { axis: 'row', stored: 240, direction: 'left', width: 216, written: 216 },
    {
      axis: 'row',
      stored: 160,
      direction: 'left',
      width: 160,
      written: undefined,
    },
    { axis: 'row', stored: 700, direction: 'left', width: 572, written: 572 },
    {
      axis: 'row',
      stored: 700,
      direction: 'right',
      width: 700,
      written: undefined,
    },
    {
      axis: 'column',
      stored: 240,
      direction: 'down',
      width: 264,
      written: 264,
    },
    { axis: 'column', stored: 240, direction: 'up', width: 216, written: 216 },
    {
      axis: 'column',
      sizedPane: 'end',
      stored: 200,
      direction: 'up',
      width: 224,
      written: 224,
    },
  ] as const)(
    'nudges one step from the drawn width, stores only a changed width and takes the press, at a limit too: $axis $stored $direction',
    ({ axis, stored, direction, width, written, ...sized }) => {
      const saved = new Map<string, unknown>([['side', stored]]);
      const { split, handle, timers } = splitWithHandle(saved, {
        axis,
        ...sized,
      });
      // A 4px handle leaves a 796px span, the sized pane drawn at most 596.
      handle.rect = rectOn(axis, 4);
      saved.delete('side');

      const took = split.nudge(direction);

      expect(took).toBe(true);
      expect(split.width()).toBe(width);
      expect(saved.get('side')).toBe(written);
      expect(handle.classes.has('is-nudged')).toBe(true);
      expect([...timers.armed.values()].map(({ ms }) => ms)).toEqual([1000]);
    },
  );

  it.each([
    { axis: 'row', direction: 'up' },
    { axis: 'row', direction: 'down' },
    { axis: 'column', direction: 'left' },
    { axis: 'column', direction: 'right' },
  ] as const)(
    'turns down a press off its axis and keeps its width: $axis $direction',
    ({ axis, direction }) => {
      const saved = new Map<string, unknown>([['side', 240]]);
      const { split, handle } = splitWithHandle(saved, { axis });
      handle.rect = rectOn(axis, 4);

      const took = split.nudge(direction);

      expect(took).toBe(false);
      expect(split.width()).toBe(240);
      expect(saved.get('side')).toBe(240);
      expect(handle.classes.has('is-nudged')).toBe(false);
    },
  );

  it('does nothing while a drag is running', () => {
    const saved = new Map<string, unknown>();
    const { split, handle } = splitWithHandle(saved);
    press(handle, 1, 240);
    move(handle, 1, 300);

    split.nudge('right');

    expect(split.width()).toBe(300);
    expect(saved.has('side')).toBe(false);
    expect(handle.classes.has('is-nudged')).toBe(false);
  });

  it('passes the press on, moving nothing, while the handle has no layout box', () => {
    const saved = new Map<string, unknown>();
    const { split, handle } = splitWithHandle(saved);
    handle.clientRects = [];

    const took = split.nudge('right');

    expect(took).toBe(false);
    expect(split.width()).toBe(240);
    expect(saved.has('side')).toBe(false);
    expect(handle.classes.has('is-nudged')).toBe(false);
  });

  it('shows the prompt for 1000ms after a nudge', () => {
    const { split, handle, timers } = splitWithHandle(new Map());

    split.nudge('right');
    expect(handle.classes.has('is-nudged')).toBe(true);
    const [first] = [...timers.armed.keys()];
    expect(timers.armed.get(first)?.ms).toBe(1000);

    split.nudge('right');
    expect(timers.cleared).toEqual([first]);
    expect([...timers.armed.values()].map(({ ms }) => ms)).toEqual([1000]);

    timers.fireAll();
    expect(handle.classes.has('is-nudged')).toBe(false);
  });
});

describe('createSplit prompt', () => {
  it.each([
    {
      axis: 'row',
      commands: ['panes.resizePaneLeft', 'panes.resizePaneRight'],
    },
    {
      axis: 'column',
      commands: ['panes.resizePaneUp', 'panes.resizePaneDown'],
    },
  ] as const)(
    'anchors the resize prompt in the handle: $axis',
    ({ axis, commands }) => {
      const { handle, anchor } = splitWithHandle(new Map(), { axis });
      const prompt = handle.children.find((child) =>
        child.className.split(' ').includes('ui-split-prompt'),
      );

      expect(
        anchor.named.map(({ command, options }) => ({ command, options })),
      ).toEqual(commands.map((command) => ({ command, options: undefined })));
      for (const { element } of anchor.named) {
        expect(prompt?.children).toContain(element);
      }
    },
  );
});

describe('createSplit setEndHidden', () => {
  it('marks the root while the end pane is hidden', () => {
    const { split } = splitWithHandle(new Map());
    const root = asFakeElement(split.element);

    split.setEndHidden(true);
    expect(root.classes.has('is-end-hidden')).toBe(true);
    split.setEndHidden(false);
    expect(root.classes.has('is-end-hidden')).toBe(false);
  });
});

describe('createSplit dispose', () => {
  it('dispose stops the split', () => {
    const saved = new Map<string, unknown>();
    const { split, handle, timers, anchor } = splitWithHandle(saved);
    split.nudge('right');
    const [lingering] = [...timers.armed.keys()];
    press(handle, 1, 264);
    move(handle, 1, 300);

    split.dispose();

    expect(fakeWin.listeners.get('pointerup') ?? []).toEqual([]);
    expect(fakeWin.listeners.get('pointercancel') ?? []).toEqual([]);
    expect(isObserverDisconnected).toBe(true);
    expect(anchor.named.map(({ isDisposed }) => isDisposed)).toEqual([
      true,
      true,
    ]);
    expect(timers.cleared).toContain(lingering);
    expect(timers.armed.size).toBe(0);
    move(handle, 1, 400);
    split.nudge('right');
    expect(split.width()).toBe(300);
  });
});

describe('createSplitDivider', () => {
  // The start pane's left edge at 100 with an 800px span draws the sized pane
  // at most 600; an end pane's divider sits at 900 less its width.
  it.each([
    {
      sizedPane: 'start',
      stored: 240,
      pressAt: 340,
      moves: [400, 900],
      shown: [300, 600],
    },
    {
      sizedPane: 'start',
      stored: 240,
      pressAt: 342,
      moves: [342, 402],
      shown: [240, 300],
    },
    {
      sizedPane: 'start',
      stored: 700,
      pressAt: 702,
      moves: [652],
      shown: [550],
    },
    {
      sizedPane: 'end',
      stored: 240,
      pressAt: 660,
      moves: [600, 0],
      shown: [300, 600],
    },
    {
      sizedPane: 'end',
      stored: 240,
      pressAt: 658,
      moves: [658, 598],
      shown: [240, 300],
    },
    { sizedPane: 'end', stored: 700, pressAt: 298, moves: [348], shown: [550] },
  ] as const)(
    'drags a handle it did not build, keeping the grab offset: $sizedPane $stored at $pressAt',
    ({ sizedPane, stored, pressAt, moves, shown: expected }) => {
      const handle = fakeElement();
      const shown: number[] = [];
      createSplitDivider({
        ...limits,
        uiState: uiStateOver(new Map([['side', stored]])),
        stateKey: 'side',
        sizedPane,
        handle: handle as unknown as HTMLElement,
        measure: () => ({ left: 100, span: 800 }),
        show: (width) => shown.push(width),
        anchor: fakeAnchor().anchor,
        timers: fakeTimers().timers,
      });
      press(handle, 1, pressAt);

      for (const clientX of moves) {
        move(handle, 1, clientX);
      }

      expect(shown.slice(1)).toEqual(expected);
    },
  );

  it.each([
    { stored: 240, direction: 'left', width: 264, written: 264 },
    { stored: 240, direction: 'right', width: 216, written: 216 },
    { stored: 600, direction: 'left', width: 600, written: undefined },
  ] as const)(
    'nudges the end pane it sizes against the direction: $stored $direction',
    ({ stored, direction, width, written }) => {
      const saved = new Map<string, unknown>([['side', stored]]);
      const divider = createSplitDivider({
        ...limits,
        uiState: uiStateOver(saved),
        stateKey: 'side',
        sizedPane: 'end',
        handle: fakeElement() as unknown as HTMLElement,
        measure: () => ({ left: 100, span: 800 }),
        show: () => undefined,
        anchor: fakeAnchor().anchor,
        timers: fakeTimers().timers,
      });
      saved.delete('side');

      divider.nudge(direction);

      expect(divider.width()).toBe(width);
      expect(saved.get('side')).toBe(written);
    },
  );
});

function asFakeElement(node: HTMLElement): FakeElement {
  return node as unknown as FakeElement;
}
