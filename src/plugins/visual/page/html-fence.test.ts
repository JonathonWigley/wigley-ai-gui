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

// A user layout whose `visual` draws `div.mine` holding a label and never
// calls `kit.frame`.
const MINE: Layout = {
  visual(parent, kit) {
    const root = kit.el(parent, 'div', 'mine');
    kit.el(root, 'span', 'mine-label', 'mine');
    return root;
  },
};

// An html fence over fake frames, its log lines kept as `[source] message`
// and each source its expand ran with in `expanded`.
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
      commands: { exists: () => true, run: () => undefined },
      platform: 'macos',
    },
    log: () => undefined,
  });
  const fence = createHtmlFence({
    frames,
    parts,
    registry,
    log: (source, message) => logs.push(`[${source}] ${message}`),
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
      logs: ['[visual] visual mounted: Flow'],
      expanded: [],
    },
    {
      name: "left-out frame and expand are placed at the root's end",
      layouts: 'mine',
      source: '<b>x</b>',
      closed: true,
      opened: ['<b>x</b>'],
      host: { part: 'mine', framed: true },
      registered: ['<b>x</b>'],
      logs: ['[visual] visual mounted: untitled'],
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
      logs: ['[visual] visual mounted: untitled'],
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
        asFake(view.element).querySelector('.ui-icon-button')?.click();
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
        const ends = root.children.slice(-2);
        expect(ends[0]).toBe(slot);
        expect(ends[1].tagName).toBe('BUTTON');
        expect(ends[1].classList.contains('ui-icon-button')).toBe(true);
      }
      expect(sourcesAround(test.registry, view)).toEqual(registered);
      expect(test.logs).toEqual(want.logs);
      expect(test.expanded).toEqual(want.expanded);
    },
  );

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
});
