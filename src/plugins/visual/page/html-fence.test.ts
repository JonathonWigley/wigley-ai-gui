import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FenceView } from '../../../contracts/markdown';
import { fakeVisualFrames } from '../../../shared/page/fake-visual-frames';
import {
  recordingAnchors,
  withUser,
} from '../../../shared/page/layout-host/test-layouts';
import { NO_FENCES } from '../../../shared/page/markdown-mount.test-support';
import {
  asFake,
  asHtml,
  FakeElement,
  installFakeDom,
} from '../../../shared/page/test-dom';
import defaultLayout from '../layouts/default/layout.js';
import type { Layout } from '../layouts/layout';
import { createHtmlFence } from './html-fence';
import { createVisualParts } from './layout/visual-parts';
import { createVisualRegistry, type VisualRegistry } from './visual-registry';
import { noLayoutState } from '../../../shared/page/layout-host/fake-layout-state.test-support';

// A user layout whose `visual` draws `div.mine` holding a label and never
// calls `kit.frame`.
const MINE: Layout = {
  visual(parent, kit) {
    const root = kit.el(parent, 'div', 'mine');
    kit.el(root, 'span', 'mine-label', 'mine');
    return root;
  },
};

// An html fence over fake frames, its log lines kept in `logs` and each source
// its expand ran with in `expanded`.
function fenceFixture() {
  const { frames, opened } = fakeVisualFrames();
  const logs: string[] = [];
  const expanded: string[] = [];
  const registry = createVisualRegistry();
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
      commands: {
        exists: () => true,
        argShape: () => undefined,
        run: () => undefined,
      },
      platform: 'macos',
      state: noLayoutState,
    },
    log: () => undefined,
  });
  const fence = createHtmlFence({
    frames,
    parts,
    registry,
    log: (message: string) => logs.push(message),
    expand: (source) => expanded.push(source),
  });
  return { fence, parts, registry, opened, logs, expanded };
}

// The registry's sources under an `li` holding the view's host, since a
// root's own class is not among its matches.
function sourcesAround(registry: VisualRegistry, view: FenceView): string[] {
  const entry = new FakeElement('li');
  entry.append(asFake(view.element));
  return registry.sourcesIn(asHtml(entry));
}

// The view's icon button titled `title`.
function controlOf(view: FenceView, title: string): FakeElement | undefined {
  return asFake(view.element)
    .querySelectorAll('.ui-icon-button')
    .find((button) => button.title === title);
}

// The part root in the host's one `div.visual-draw`.
function partRoot(view: FenceView): FakeElement {
  const draws = asFake(view.element).children;
  expect(draws.map((draw) => draw.className)).toEqual(['visual-draw']);
  const roots = draws[0].children;
  expect(roots).toHaveLength(1);
  return roots[0];
}

describe('createHtmlFence', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    {
      name: 'open block draws the card',
      layouts: 'default',
      source: '<p>half',
      closed: false,
      opened: [],
      host: { part: 'visual-card', framed: false },
      registered: [],
      logs: [],
      expanded: [],
    },
    {
      name: 'closed block draws the frame',
      layouts: 'default',
      source: '<title> Flow </title><p>done</p>',
      closed: true,
      opened: ['<title> Flow </title><p>done</p>'],
      host: { part: 'visual', framed: true },
      registered: ['<title> Flow </title><p>done</p>'],
      logs: ['visual mounted: Flow'],
      expanded: [],
    },
    {
      name: "left-out frame, expand and widen are placed at the root's end",
      layouts: 'mine',
      source: '<b>x</b>',
      closed: true,
      opened: ['<b>x</b>'],
      host: { part: 'mine', framed: true },
      registered: ['<b>x</b>'],
      logs: ['visual mounted: untitled'],
      expanded: [],
    },
    {
      name: 'expand runs with the source',
      layouts: 'default',
      source: '<i>e</i>',
      closed: true,
      opened: ['<i>e</i>'],
      host: { part: 'visual', framed: true },
      registered: ['<i>e</i>'],
      logs: ['visual mounted: untitled'],
      expanded: ['<i>e</i>'],
    },
  ])(
    'htmlFence_Mount_DrawsByClosedFlag $name',
    ({ layouts, source, closed, opened, host, registered, ...want }) => {
      const test = fenceFixture();
      if (layouts === 'mine') {
        test.parts.setLayouts(withUser<Layout>(defaultLayout, MINE));
      }

      const view = test.fence.contribution.mount(source, closed);
      if (want.expanded.length > 0) {
        controlOf(view, 'Expand')?.click();
      }

      expect(test.opened.map((frame) => frame.source)).toEqual(opened);
      const root = partRoot(view);
      expect(root.classList.contains(host.part)).toBe(true);
      const slot = asFake(view.element).querySelector('.visual-frame-slot');
      if (host.framed) {
        expect(slot?.parentNode).toBe(root);
        expect(slot?.children).toEqual([asFake(test.opened[0].element)]);
      } else {
        expect(slot).toBeNull();
      }
      if (layouts === 'mine') {
        const ends = root.children.slice(-3);
        expect(ends[0]).toBe(slot);
        expect(ends.slice(1).map((button) => button.title)).toEqual([
          'Expand',
          'Widen or narrow',
        ]);
      }
      expect(sourcesAround(test.registry, view)).toEqual(registered);
      expect(test.logs).toEqual(want.logs);
      expect(test.expanded).toEqual(want.expanded);
    },
  );

  it.each([
    { name: 'no mark', source: '<p>x</p>', wide: false },
    {
      name: 'name then content',
      source: '<meta name="visual-width" content="wide"><p>x</p>',
      wide: true,
    },
    {
      name: 'content then name, unquoted',
      source: '<META content=wide name=visual-width><p>x</p>',
      wide: true,
    },
    {
      name: 'another width',
      source: '<meta name="visual-width" content="reading"><p>x</p>',
      wide: false,
    },
    {
      name: 'another meta',
      source: '<meta name="viewport" content="wide"><p>x</p>',
      wide: false,
    },
  ])('htmlFence_MountClosed_OpensWideOnTheMark $name', ({ source, wide }) => {
    const test = fenceFixture();

    const view = test.fence.contribution.mount(source, true);

    expect(asFake(view.element).classList.contains('is-wide')).toBe(wide);
  });

  it('htmlFence_WidenControl_FlipsWidthAndKeepsItOnRedraw', () => {
    const test = fenceFixture();
    const view = test.fence.contribution.mount('<p>x</p>', true);
    const host = asFake(view.element);

    controlOf(view, 'Widen or narrow')?.click();
    const wideAfterClick = host.classList.contains('is-wide');
    test.parts.setLayouts(withUser<Layout>(defaultLayout, MINE));
    test.fence.redraw();
    const wideAfterRedraw = host.classList.contains('is-wide');
    controlOf(view, 'Widen or narrow')?.click();

    expect([wideAfterClick, wideAfterRedraw]).toEqual([true, true]);
    expect(host.classList.contains('is-wide')).toBe(false);
    expect(test.logs).toEqual([
      'visual mounted: untitled',
      'visual width: wide',
      'visual width: reading',
    ]);
  });

  it('htmlFence_DisposeClosedView_DisposesTheFrame', () => {
    const test = fenceFixture();
    const view = test.fence.contribution.mount('<p>done</p>', true);
    const slot = asFake(view.element).querySelector('.visual-frame-slot');

    view.dispose();

    expect(test.opened.map((frame) => frame.disposed)).toEqual([true]);
    expect(slot).not.toBeNull();
    expect(slot?.parentNode).toBeNull();
    expect(sourcesAround(test.registry, view)).toEqual([]);
  });

  it('htmlFence_Redraw_KeepsTheFrame', () => {
    const test = fenceFixture();
    const view = test.fence.contribution.mount('<p>done</p>', true);
    const slot = asFake(view.element).querySelector('.visual-frame-slot');

    test.parts.setLayouts(withUser<Layout>(defaultLayout, MINE));
    test.fence.redraw();

    expect(test.opened.map((frame) => frame.disposed)).toEqual([false]);
    const root = partRoot(view);
    expect(root.classList.contains('mine')).toBe(true);
    expect(slot?.parentNode).toBe(root);
  });

  it('htmlFence_Dispose_DisposesEveryLiveView', () => {
    const test = fenceFixture();
    const drawVisual = vi.spyOn(test.parts, 'visual');
    const views = [
      test.fence.contribution.mount('<p>one</p>', true),
      test.fence.contribution.mount('<p>two</p>', true),
    ];
    const disposeFirstDrawn = vi.spyOn(
      drawVisual.mock.results[0].value,
      'dispose',
    );

    test.fence.dispose();
    views[0].dispose();

    expect(test.opened.map((frame) => frame.disposed)).toEqual([true, true]);
    for (const view of views) {
      expect(sourcesAround(test.registry, view)).toEqual([]);
    }
    expect(disposeFirstDrawn).toHaveBeenCalledTimes(1);
  });
});
