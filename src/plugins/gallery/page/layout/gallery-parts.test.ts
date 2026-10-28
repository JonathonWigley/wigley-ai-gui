import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  asFake,
  asHtml,
  FakeElement,
  findAll,
  installFakeDom,
  installFocusFakeDom,
  ScrollerFakeElement,
} from '../../../../shared/page/test-dom';
import {
  recordingAnchors,
  withUser,
} from '../../../../shared/page/layout-host/test-layouts';
import defaultLayout from '../../layouts/default/layout.js';
import type { Layout } from '../../layouts/layout';
import { createGalleryView } from '../gallery-view';
import {
  createGalleryParts,
  type GalleryParts,
  type GalleryPartsDeps,
  type SampleCell,
} from './gallery-parts';

function fakeDeps(
  keys: GalleryPartsDeps['keys'] = recordingAnchors().keys,
): GalleryPartsDeps {
  return {
    markdown: {
      block: (text) => text,
      inline: (text) => text,
      document: async (text) => text,
    },
    keys,
    commands: { exists: () => true, run: vi.fn() },
    platform: 'macos',
    log: vi.fn(),
  };
}

// The gallery's parts showing `mine` as the user's layout.
function partsShowing(mine: Layout): GalleryParts {
  const parts = createGalleryParts(fakeDeps());
  parts.setLayouts(withUser<Layout>(defaultLayout, mine));
  return parts;
}

function sampleCell(caption: string): SampleCell {
  return {
    sample: asHtml(new FakeElement('span')),
    caption,
    isWide: false,
  };
}

const fail = (): never => {
  throw new Error('broken part');
};

// A scroller fake whose scroll, and that of every element over it, also goes
// back to 0 as a node under it leaves, as a browser clamps a scroller's
// scroll when its content shrinks.
class ShrinkingScrollerFakeElement extends ScrollerFakeElement {
  override remove() {
    for (let node = this.parentNode; node !== null; node = node.parentNode) {
      node.scrollTop = 0;
    }
    super.remove();
  }
}

beforeEach(() => installFakeDom(vi.stubGlobal));
afterEach(() => vi.unstubAllGlobals());

describe('galleryParts', () => {
  // `roots` draws with the parts and returns the roots the fallback drew.
  it.each([
    {
      case: 'a section that throws',
      mine: { section: fail } as Layout,
      roots: (parent: HTMLElement, parts: GalleryParts) => [
        parts.drawSection(parent, 'Kbd', [[sampleCell('a')]]).built.element,
      ],
    },
    {
      case: 'a section asking for a cell its rows lack',
      mine: {
        section: (parent, _input, kit) => {
          const root = kit.el(parent, 'section');
          kit.cell(root, 5, 0);
          return { element: root };
        },
      } as Layout,
      roots: (parent: HTMLElement, parts: GalleryParts) => [
        parts.drawSection(parent, 'Kbd', [[sampleCell('a')]]).built.element,
      ],
    },
    {
      case: 'a section drawing a cell beside its root',
      mine: {
        section: (parent, _input, kit) => {
          kit.cell(parent, 0, 0);
          return { element: kit.el(parent, 'section') };
        },
      } as Layout,
      roots: (parent: HTMLElement, parts: GalleryParts) => [
        parts.drawSection(parent, 'Kbd', [[sampleCell('a')]]).built.element,
      ],
    },
    {
      case: 'a cell that throws',
      mine: { cell: fail } as Layout,
      roots: (parent: HTMLElement, parts: GalleryParts) => {
        parts.drawSection(parent, 'Kbd', [
          [sampleCell('a'), sampleCell('b')],
          [sampleCell('c')],
        ]);
        return findAll(asFake(parent), 'gallery-cell').map(asHtml);
      },
    },
    {
      case: 'a framedSection returning an element not in parent',
      mine: {
        framedSection: (parent, _input, kit) => ({
          element: kit.el(kit.el(parent, 'div'), 'section'),
        }),
      } as Layout,
      roots: (parent: HTMLElement, parts: GalleryParts) => [
        parts.drawFramedSection(
          parent,
          { name: 'Split', isDialog: false },
          asHtml(new FakeElement('div')),
        ).built.element,
      ],
    },
  ])('draws $case with default', ({ mine, roots }) => {
    const parent = asHtml(new FakeElement('div'));

    const drawn = roots(parent, partsShowing(mine));

    expect(drawn.length).toBeGreaterThan(0);
    for (const root of drawn) {
      expect(root.dataset).toMatchObject({
        layout: 'default',
        layoutOwner: 'gallery',
      });
    }
  });

  // `draw` returns where each sample landed, and the samples in the order
  // they should land there.
  it.each([
    {
      case: 'a cell that never calls kit.sample',
      mine: {
        cell: (parent, _input, kit) => ({
          element: kit.el(parent, 'div', 'mine-cell'),
        }),
      } as Layout,
      draw(parent: HTMLElement, parts: GalleryParts) {
        const cells = [sampleCell('a'), sampleCell('b')];
        parts.drawSection(parent, 'Tag', [cells]);
        return {
          // The sample ends each cell.
          landed: findAll(asFake(parent), 'mine-cell').map((cell) =>
            cell.childNodes.at(-1),
          ),
          samples: cells.map((cell) => cell.sample),
        };
      },
    },
    {
      case: 'a section that draws no cell',
      mine: {
        section: (parent, input, kit) => {
          const root = kit.el(parent, 'section', 'mine-section');
          kit.sectionHeader(root, input.name);
          return { element: root };
        },
      } as Layout,
      draw(parent: HTMLElement, parts: GalleryParts) {
        const rows = [[sampleCell('a'), sampleCell('b')], [sampleCell('c')]];
        const section = parts.drawSection(parent, 'Tag', rows).built.element;
        const [header, ...cells] = asFake(section).children;
        return {
          // The header, then each default cell holding its sample first.
          landed: [header.className, ...cells.map((cell) => cell.children[0])],
          samples: [
            'ui-section-header',
            ...rows.flat().map((cell) => cell.sample),
          ],
        };
      },
    },
    {
      case: 'a framedSection that never calls kit.sample',
      mine: {
        framedSection: (parent, input, kit) => {
          const root = kit.el(parent, 'section', 'mine-framed');
          kit.sectionHeader(root, input.name);
          return { element: root };
        },
      } as Layout,
      draw(parent: HTMLElement, parts: GalleryParts) {
        const sample = asHtml(new FakeElement('div'));
        const section = parts.drawFramedSection(
          parent,
          { name: 'Split', isDialog: false },
          sample,
        ).built.element;
        return {
          landed: [asFake(section).childNodes.at(-1)],
          samples: [sample],
        };
      },
    },
  ])('appends the piece $case leaves out', ({ mine, draw }) => {
    const parent = asHtml(new FakeElement('div'));

    const { landed, samples } = draw(parent, partsShowing(mine));

    expect(landed).toEqual(samples);
  });
});

describe('galleryView', () => {
  const view = (deps: GalleryPartsDeps) =>
    createGalleryView(
      { ...deps, uiState: { get: () => undefined, set: () => undefined } },
      'reduced',
    );

  it('leaves one transparency anchor however often the head draws', () => {
    const recorded = recordingAnchors();
    const gallery = view(fakeDeps(recorded.keys));

    gallery.showTransparency('full');
    gallery.showTransparency(null);
    gallery.setLayouts(withUser<Layout>(defaultLayout, {}));

    const live = recorded.anchors.filter(
      (anchor) =>
        anchor.command === 'gallery.toggleTransparency' && !anchor.isDisposed,
    );
    expect(live).toHaveLength(1);
  });

  it('draws the head with the starting transparency', () => {
    const gallery = view(fakeDeps());

    const [status] = findAll(asFake(gallery.element), 'gallery-status');

    expect(status.textContent).toContain('reduced');
  });

  it('keeps the scroll through a relayout', () => {
    installFocusFakeDom(vi.stubGlobal, ShrinkingScrollerFakeElement);
    const gallery = view(fakeDeps());
    gallery.sheet.scrollTop = 480;

    gallery.setLayouts(withUser<Layout>(defaultLayout, {}));

    expect(gallery.sheet.scrollTop).toBe(480);
  });
});
