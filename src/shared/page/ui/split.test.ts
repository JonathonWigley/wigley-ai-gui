import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UiState } from '../../../contracts/ui-state';
import { createSplit } from './split';

type Listener = (event: Event) => void;

// The DOM surface the split uses. Pointer capture is a set of pointer ids the
// test adds to through setPointerCapture and removes from by hand.
interface FakeElement {
  className: string;
  classes: Set<string>;
  captured: Set<number>;
  fire(type: string, fields?: Record<string, unknown>): Record<string, unknown>;
}

function fakeElement(): FakeElement {
  const classes = new Set<string>();
  const captured = new Set<number>();
  const listeners = new Map<string, Listener[]>();
  const node: FakeElement & Record<string, unknown> = {
    className: '',
    classes,
    captured,
    classList: {
      add: (name: string) => classes.add(name),
      remove: (name: string) => classes.delete(name),
      contains: (name: string) => classes.has(name),
      toggle: (name: string, force: boolean) =>
        force ? classes.add(name) : classes.delete(name),
    },
    style: { setProperty: () => undefined },
    append: () => undefined,
    getBoundingClientRect: () => ({ left: 0 }),
    setPointerCapture: (id: number) => captured.add(id),
    hasPointerCapture: (id: number) => captured.has(id),
    addEventListener: (type: string, listener: Listener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
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

const limits = { initial: 240, min: 160, max: 400 };
let created: FakeElement[];

function stateOver(values: Map<string, unknown>): UiState {
  return {
    get: (key) => values.get(key),
    set: (key, value) => values.set(key, value),
  };
}

// The handle is the element createSplit gives the `ui-split-handle` class.
function splitWithHandle(saved: Map<string, unknown>) {
  const split = createSplit({
    ...limits,
    uiState: stateOver(saved),
    stateKey: 'side',
  });
  const handle = created.find((node) => node.className === 'ui-split-handle')!;
  return { split, handle };
}

function press(handle: FakeElement, pointerId: number) {
  handle.fire('pointerdown', { button: 0, pointerId });
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

beforeEach(() => {
  created = [];
  fakeWin = fakeWindow();
  vi.stubGlobal('window', fakeWin);
  vi.stubGlobal('document', {
    createElement: () => {
      const node = fakeElement();
      created.push(node);
      return node;
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createSplit drag', () => {
  it('saves the dragged width when capture is lost', () => {
    const saved = new Map<string, unknown>();
    const { split, handle } = splitWithHandle(saved);
    press(handle, 1);
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
    press(handle, 1);
    press(handle, 2);
    handle.fire('lostpointercapture', { pointerId: 2 });
    expect(handle.classes.has('is-active')).toBe(true);
    move(handle, 1, 320);
    expect(split.width()).toBe(320);
    expect(saved.has('side')).toBe(false);
  });

  it('drags again after capture was lost without reaching the handle', () => {
    const saved = new Map<string, unknown>();
    const { split, handle } = splitWithHandle(saved);
    press(handle, 1);
    move(handle, 1, 300);
    handle.captured.delete(1);
    press(handle, 5);
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
    press(handle, 1);
    move(handle, 1, 300);
    fakeWin.fire('pointerup', { pointerId: 1 });
    expect(saved.get('side')).toBe(300);
    expect(handle.classes.has('is-active')).toBe(false);
  });

  it('saves the dragged width when the pointer is cancelled', () => {
    const saved = new Map<string, unknown>();
    const { handle } = splitWithHandle(saved);
    press(handle, 1);
    move(handle, 1, 300);
    fakeWin.fire('pointercancel', { pointerId: 1 });
    expect(saved.get('side')).toBe(300);
  });

  it('keeps the drag when another pointer is released', () => {
    const saved = new Map<string, unknown>();
    const { split, handle } = splitWithHandle(saved);
    press(handle, 1);
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
    press(handle, 1);
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
    press(handle, 1);
    move(handle, 1, 300);
    saved.set('side', 350);
    split.reloadWidth();
    expect(split.width()).toBe(300);
  });
});

describe('createSplit endMin', () => {
  it('stacks while narrower than min plus endMin, side by side at it', () => {
    let resized: (entries: { contentRect: { width: number } }[]) => void = () =>
      undefined;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: typeof resized) {
          resized = callback;
        }
        observe() {}
      },
    );
    const split = createSplit({
      ...limits,
      endMin: 200,
      uiState: stateOver(new Map()),
      stateKey: 'side',
    });
    const root = asFakeElement(split.element);

    resized([{ contentRect: { width: 359 } }]);
    expect(root.classes.has('is-stacked')).toBe(true);
    resized([{ contentRect: { width: 360 } }]);
    expect(root.classes.has('is-stacked')).toBe(false);
  });
});

function asFakeElement(node: HTMLElement): FakeElement {
  return node as unknown as FakeElement;
}
