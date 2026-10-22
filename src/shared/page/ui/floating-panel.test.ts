import { describe, expect, it } from 'vitest';
import { openFloatingPanel } from './floating-panel';

type Listener = (event: Event) => void;

interface FakeElement {
  hidden: boolean;
  classes: Set<string>;
  listeners: Map<string, Set<Listener>>;
  fire(type: string, target?: FakeElement): void;
}

function fakeElement(hidden: boolean): FakeElement {
  const classes = new Set<string>();
  const listeners = new Map<string, Set<Listener>>();
  const node: FakeElement & Record<string, unknown> = {
    hidden,
    classes,
    listeners,
    classList: {
      add: (name: string) => classes.add(name),
      remove: (name: string) => classes.delete(name),
      contains: (name: string) => classes.has(name),
    },
    addEventListener: (type: string, listener: Listener) => {
      const set = listeners.get(type) ?? new Set<Listener>();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener: (type: string, listener: Listener) => {
      listeners.get(type)?.delete(listener);
    },
    fire(type: string, target: FakeElement = node) {
      for (const listener of listeners.get(type) ?? []) {
        listener({ type, target } as unknown as Event);
      }
    },
  };
  return node;
}

function asElement(node: FakeElement): HTMLElement {
  return node as unknown as HTMLElement;
}

describe('openFloatingPanel', () => {
  it('shows a hidden panel and marks it opening', () => {
    const panel = fakeElement(true);
    openFloatingPanel(asElement(panel));
    expect(panel.hidden).toBe(false);
    expect(panel.classes.has('is-opening')).toBe(true);
  });

  it('shows the hiding ancestor and marks the panel opening', () => {
    const panel = fakeElement(false);
    const scrim = fakeElement(true);
    openFloatingPanel(asElement(panel), asElement(scrim));
    expect(scrim.hidden).toBe(false);
    expect(panel.classes.has('is-opening')).toBe(true);
    expect(scrim.classes.has('is-opening')).toBe(false);
  });

  it('drops the opening mark when the fade ends', () => {
    const panel = fakeElement(true);
    openFloatingPanel(asElement(panel));
    panel.fire('transitionend');
    expect(panel.classes.has('is-opening')).toBe(false);
    expect(panel.listeners.get('transitionend')?.size).toBe(0);
    expect(panel.listeners.get('transitioncancel')?.size).toBe(0);
  });

  it('drops the opening mark when the fade is cancelled', () => {
    const panel = fakeElement(true);
    openFloatingPanel(asElement(panel));
    panel.fire('transitioncancel');
    expect(panel.classes.has('is-opening')).toBe(false);
  });

  it('keeps the opening mark through a child transition', () => {
    const panel = fakeElement(true);
    openFloatingPanel(asElement(panel));
    panel.fire('transitionend', fakeElement(false));
    expect(panel.classes.has('is-opening')).toBe(true);
  });

  it('does not mark a panel that was already shown', () => {
    const panel = fakeElement(false);
    openFloatingPanel(asElement(panel));
    expect(panel.classes.has('is-opening')).toBe(false);
  });

  it('adds one pair of listeners when opened twice before the fade ends', () => {
    const panel = fakeElement(true);
    openFloatingPanel(asElement(panel));
    panel.hidden = true;
    openFloatingPanel(asElement(panel));
    expect(panel.listeners.get('transitionend')?.size).toBe(1);
  });
});
