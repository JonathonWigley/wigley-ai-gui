import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Timers } from '../../../contracts/ambient';
import type { UiState } from '../../../contracts/ui-state';
import type { AnchorNamer } from './key-anchors';
import { createSplit, createSplitDivider } from './split';

type Listener = (event: Event) => void;

// The DOM surface the split uses. Pointer capture is a set of pointer ids the
// test adds to through setPointerCapture and removes from by hand; `rect` is
// what getBoundingClientRect reports and `clientRects` what getClientRects
// does.
interface FakeElement {
  className: string;
  classes: Set<string>;
  captured: Set<number>;
  children: FakeElement[];
  rect: { left: number; width: number };
  clientRects: unknown[];
  fire(type: string, fields?: Record<string, unknown>): Record<string, unknown>;
}

function fakeElement(): FakeElement {
  const classes = new Set<string>();
  const captured = new Set<number>();
  const children: FakeElement[] = [];
  const listeners = new Map<string, Listener[]>();
  const node: FakeElement & Record<string, unknown> = {
    className: '',
    classes,
    captured,
    children,
    rect: { left: 0, width: 0 },
    clientRects: [{}],
    classList: {
      add: (name: string) => classes.add(name),
      remove: (name: string) => classes.delete(name),
      contains: (name: string) => classes.has(name),
      toggle: (name: string, force: boolean) =>
        force ? classes.add(name) : classes.delete(name),
    },
    style: { setProperty: () => undefined },
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

function stateOver(values: Map<string, unknown>): UiState {
  return {
    get: (key) => values.get(key),
    set: (key, value) => values.set(key, value),
  };
}

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

// The split's root reports an 800px wide rect at the client's left edge; the
// handle is the element createSplit gives the `ui-split-handle` class.
function splitWithHandle(saved: Map<string, unknown>) {
  const timers = fakeTimers();
  const anchor = fakeAnchor();
  const split = createSplit({
    ...limits,
    uiState: stateOver(saved),
    stateKey: 'side',
    anchor: anchor.anchor,
    timers: timers.timers,
  });
  asFakeElement(split.element).rect = { left: 0, width: 800 };
  const handle = created.find((node) => node.className === 'ui-split-handle')!;
  return { split, handle, timers, anchor };
}

// Presses at `clientX`; each split test presses on the start pane's edge, the
// drawn width from the root's left edge at 0.
function press(handle: FakeElement, pointerId: number, clientX: number) {
  handle.fire('pointerdown', { button: 0, pointerId, clientX });
}

function move(handle: FakeElement, pointerId: number, clientX: number) {
  handle.fire('pointermove', { pointerId, clientX });
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
  it('saves the dragged width when capture is lost', () => {
    const saved = new Map<string, unknown>();
    const { split, handle } = splitWithHandle(saved);
    press(handle, 1, 240);
    expect(handle.classes.has('is-active')).toBe(true);
    move(handle, 1, 300);
    loseCapture(handle, 1);
    expect(split.width()).toBe(300);
    expect(saved.get('side')).toBe(300);
    expect(handle.classes.has('is-active')).toBe(false);
  });

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

describe('createSplit endMin', () => {
  it('stacks while narrower than min plus endMin, side by side at it', () => {
    const { split } = splitWithHandle(new Map());
    const root = asFakeElement(split.element);

    resized([{ contentRect: { width: 359 } }]);
    expect(root.classes.has('is-stacked')).toBe(true);
    resized([{ contentRect: { width: 360 } }]);
    expect(root.classes.has('is-stacked')).toBe(false);
  });
});

describe('createSplit nudge', () => {
  it.each([
    { stored: 240, direction: 'right', width: 264, written: 264 },
    { stored: 240, direction: 'left', width: 216, written: 216 },
    { stored: 160, direction: 'left', width: 160, written: undefined },
    { stored: 700, direction: 'left', width: 572, written: 572 },
    { stored: 700, direction: 'right', width: 700, written: undefined },
  ] as const)(
    'nudges one step from the drawn width, stores only a changed width and takes the press, at a limit too: $stored $direction',
    ({ stored, direction, width, written }) => {
      const saved = new Map<string, unknown>([['side', stored]]);
      const { split, handle, timers } = splitWithHandle(saved);
      // A 4px handle leaves a 796px span, the start pane drawn at most 596.
      handle.rect = { left: 0, width: 4 };
      saved.delete('side');

      const took = split.nudge(direction);

      expect(took).toBe(true);
      expect(split.width()).toBe(width);
      expect(saved.get('side')).toBe(written);
      expect(handle.classes.has('is-nudged')).toBe(true);
      expect([...timers.armed.values()].map(({ ms }) => ms)).toEqual([1000]);
    },
  );

  it.each(['up', 'down'] as const)(
    'turns down a press off its axis and keeps its width: $0',
    (direction) => {
      const saved = new Map<string, unknown>([['side', 240]]);
      const { split, handle } = splitWithHandle(saved);
      handle.rect = { left: 0, width: 4 };

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

  it('does nothing while the handle has no layout box', () => {
    const saved = new Map<string, unknown>();
    const { split, handle } = splitWithHandle(saved);
    handle.clientRects = [];

    const took = split.nudge('right');

    expect(took).toBe(true);
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
  it('anchors the resize prompt in the handle', () => {
    const { handle, anchor } = splitWithHandle(new Map());
    const prompt = handle.children.find((child) =>
      child.className.split(' ').includes('ui-split-prompt'),
    );

    expect(
      anchor.named.map(({ command, options }) => ({ command, options })),
    ).toEqual([
      { command: 'panes.resizePaneLeft', options: undefined },
      { command: 'panes.resizePaneRight', options: undefined },
    ]);
    for (const { element } of anchor.named) {
      expect(prompt?.children).toContain(element);
    }
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
  // The start pane's left edge at 100 with an 800px span draws at most 600.
  it.each([
    { stored: 240, pressAt: 340, moves: [400, 900], shown: [300, 600] },
    { stored: 240, pressAt: 342, moves: [342, 402], shown: [240, 300] },
    { stored: 700, pressAt: 702, moves: [652], shown: [550] },
  ])(
    'drags a handle it did not build, keeping the grab offset: $stored at $pressAt',
    ({ stored, pressAt, moves, shown: expected }) => {
      const handle = fakeElement();
      const shown: number[] = [];
      createSplitDivider({
        ...limits,
        uiState: stateOver(new Map([['side', stored]])),
        stateKey: 'side',
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
});

function asFakeElement(node: HTMLElement): FakeElement {
  return node as unknown as FakeElement;
}
