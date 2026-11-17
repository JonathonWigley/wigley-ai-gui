import { describe, expect, it, vi } from 'vitest';
import type { Timers } from '../contracts/ambient';
import { asFake, asHtml, FakeElement } from '../shared/page/test-dom';
import type { ToastInput } from './shell/layouts/layout';
import { createToasts, type DrawToast } from './toasts';

// Timers that hold each run until `fire` runs them all; `delays` holds each
// timer's delay in the order set.
function fakeTimers() {
  const runs: (() => void)[] = [];
  const delays: number[] = [];
  const timers: Timers = {
    set(run, ms) {
      runs.push(run);
      delays.push(ms);
      return runs.length;
    },
    clear: () => undefined,
  };
  return { timers, delays, fire: () => runs.forEach((run) => run()) };
}

// A draw that appends a fresh root to its parent and records each call;
// `dispose` counts its runs, or throws when `disposeThrows`.
function fakeDraw(disposeThrows = false) {
  const calls: [FakeElement, ToastInput][] = [];
  const roots: FakeElement[] = [];
  let disposes = 0;
  const draw: DrawToast = (parent, input) => {
    calls.push([asFake(parent), input]);
    const root = new FakeElement('div');
    asFake(parent).append(root);
    roots.push(root);
    return {
      element: asHtml(root),
      dispose() {
        disposes += 1;
        if (disposeThrows) {
          throw new Error('dispose failed');
        }
      },
    };
  };
  return { draw, calls, roots, disposes: () => disposes };
}

describe('createToasts', () => {
  // Breaks if the core drops a mark, skips the fade, times the toast wrong,
  // or removes it without disposing the draw.
  it('createToasts_Show_MarksFadesAndRemovesAfterToastMs', () => {
    const layer = new FakeElement('div');
    const { timers, delays, fire } = fakeTimers();
    const drawn = fakeDraw();
    const toasts = createToasts(
      asHtml(layer),
      timers,
      drawn.draw,
      () => undefined,
    );

    toasts.show('Saved', 'success');

    expect(drawn.calls).toEqual([[layer, { text: 'Saved', tone: 'success' }]]);
    const [root] = drawn.roots;
    expect(root.dataset.tone).toBe('success');
    expect(root.attributes.get('role')).toBe('status');
    expect(root.hidden).toBe(false);
    expect(root.classList.contains('is-opening')).toBe(true);
    expect(delays).toEqual([4000]);
    expect(layer.children).toEqual([root]);
    expect(drawn.disposes()).toBe(0);

    fire();

    expect(drawn.disposes()).toBe(1);
    expect(layer.children).toEqual([]);
  });

  // Breaks if a dispose that throws leaves the toast on screen.
  it('createToasts_DisposeThrows_StillRemovesTheRoot', () => {
    const layer = new FakeElement('div');
    const { timers, fire } = fakeTimers();
    const drawn = fakeDraw(true);
    const toasts = createToasts(
      asHtml(layer),
      timers,
      drawn.draw,
      () => undefined,
    );
    toasts.show('Saved', 'error');

    expect(fire).toThrow('dispose failed');

    expect(layer.children).toEqual([]);
  });

  // Breaks if a draw that throws reaches `show`'s caller or goes unlogged.
  it('createToasts_DrawThrows_LogsAndShowsNothing', () => {
    const layer = new FakeElement('div');
    const { timers, delays } = fakeTimers();
    const log = vi.fn<(message: string) => void>();
    const draw: DrawToast = () => {
      throw new Error('bad toast');
    };
    const toasts = createToasts(asHtml(layer), timers, draw, log);

    expect(() => toasts.show('Saved', 'info')).not.toThrow();

    expect(layer.children).toEqual([]);
    expect(delays).toEqual([]);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toMatch(/bad toast/);
  });
});
