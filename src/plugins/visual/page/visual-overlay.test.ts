import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeVisualFrames } from '../../../shared/page/fake-visual-frames';
import { recordingAnchors } from '../../../shared/page/layout-host/test-layouts';
import { NO_FENCES } from '../../../shared/page/markdown-mount.test-support';
import {
  asFake,
  type FakeElement,
  installFakeDom,
} from '../../../shared/page/test-dom';
import defaultLayout from '../layouts/default/layout.js';
import { createVisualParts } from './layout/visual-parts';
import { createVisualOverlay } from './visual-overlay';

// An overlay over fake frames and the default layout: its backdrop, its log
// lines, how many times its scope popped, and the scope's base-changed and
// the layouts-changed listeners for the test to fire.
function overlayFixture() {
  const { frames, opened } = fakeVisualFrames();
  const logs: string[] = [];
  const contributed: FakeElement[] = [];
  const scope = { pops: 0, baseChanged: [] as (() => void)[] };
  const layoutsChanged: (() => void)[] = [];
  const parts = createVisualParts({
    defaultLayout,
    kit: {
      markdown: {
        block: (text) => text,
        inline: (text) => text,
        document: async (text) => text,
        ...NO_FENCES,
      },
      keys: recordingAnchors().keys,
      commands: { exists: () => true, run: () => undefined },
      platform: 'macos',
    },
    log: () => undefined,
  });
  const overlay = createVisualOverlay({
    overlay: {
      contribute(element) {
        contributed.push(asFake(element));
        return { dispose: () => undefined };
      },
    },
    pushScope: () => ({
      pop: () => {
        scope.pops += 1;
      },
      dispose: () => undefined,
      onBaseChanged: (listener) => {
        scope.baseChanged.push(() => listener('x'));
        return { dispose: () => undefined };
      },
    }),
    frames,
    parts,
    log: (_source, message) => logs.push(message),
    onLayoutsChanged: (listener) => layoutsChanged.push(listener),
  });
  return {
    overlay,
    backdrop: contributed[0],
    opened,
    logs,
    scope,
    layoutsChanged,
  };
}

describe('createVisualOverlay', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('overlay_Steps_ShowsEachSourceAndStopsAtTheEnds', () => {
    const test = overlayFixture();

    test.overlay.open(['a', 'b'], 0);
    test.overlay.next();
    test.overlay.next();
    test.overlay.previous();
    test.overlay.close();

    expect(test.opened.map((frame) => frame.source)).toEqual(['a', 'b', 'a']);
    expect(test.opened.every((frame) => frame.disposed)).toBe(true);
    expect(test.logs).toEqual([
      'visual overlay showing 1 of 2',
      'visual overlay showing 2 of 2',
      'no next visual',
      'visual overlay showing 1 of 2',
      'visual overlay closed',
    ]);
    expect(test.backdrop.hidden).toBe(true);
    expect(test.scope.pops).toBe(1);
  });

  it('overlay_BaseChanged_Closes', () => {
    const test = overlayFixture();
    test.overlay.open(['a'], 0);

    test.scope.baseChanged.forEach((fire) => fire());

    expect(test.logs.at(-1)).toBe('visual overlay closed');
    expect(test.opened.map((frame) => frame.disposed)).toEqual([true]);
  });

  it('overlay_LayoutsChanged_RedrawsAroundTheSameFrame', () => {
    const test = overlayFixture();
    test.overlay.open(['a'], 0);
    const firstDraw = test.backdrop.children[0];

    test.layoutsChanged.forEach((fire) => fire());

    expect(test.opened).toHaveLength(1);
    expect(test.opened[0].disposed).toBe(false);
    const draws = test.backdrop.children;
    expect(draws.map((draw) => draw.className)).toEqual(['visual-draw']);
    expect(draws[0]).not.toBe(firstDraw);
    const slot = draws[0].querySelector('.visual-frame-slot');
    expect(slot?.children).toEqual([asFake(test.opened[0].element)]);
  });
});
