import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShownLayouts } from '../../../../contracts/plugin';
import {
  asFake,
  asHtml,
  FakeElement,
  findAll,
  installFakeDom,
} from '../../../../shared/page/test-dom';
import defaultLayout from '../../layouts/default/layout.js';
import type { Layout } from '../../layouts/layout';
import { createGalleryView } from '../gallery-view';
import {
  createGalleryParts,
  type GalleryPartsDeps,
  type SampleCell,
} from './gallery-parts';

// The live anchors the kits named, each by its command.
function recordingAnchors() {
  const live = new Set<{ command: string }>();
  const anchor = (_element: HTMLElement, command: string) => {
    const entry = { command };
    live.add(entry);
    return { dispose: () => live.delete(entry) };
  };
  const liveFor = (command: string) =>
    [...live].filter((entry) => entry.command === command).length;
  return { anchor, liveFor };
}

function fakeDeps(
  anchor: GalleryPartsDeps['keys']['anchor'] = () => ({
    dispose: () => undefined,
  }),
): GalleryPartsDeps {
  return {
    markdown: {
      block: (text) => text,
      inline: (text) => text,
      document: async (text) => text,
    },
    keys: { anchor, keysFor: () => null },
    commands: { exists: () => true, run: vi.fn() },
    platform: 'macos',
    log: vi.fn(),
  };
}

function shownWith(mine: Layout): ShownLayouts<Layout> {
  return {
    layouts: new Map<string, Layout>([
      ['default', defaultLayout],
      ['mine', mine],
    ]),
    user: 'mine',
  };
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

// The fake DOM of `test-dom` with `replaceWith`, which the collapsible card
// sample's chevron uses.
class GalleryFakeElement extends FakeElement {
  replaceWith(node: FakeElement) {
    const parent = this.parentNode;
    if (parent !== null) {
      parent.insertBefore(node, this);
      this.remove();
    }
  }
}

beforeEach(() => {
  installFakeDom(vi.stubGlobal);
  vi.stubGlobal('document', {
    createElement: (tag: string) => new GalleryFakeElement(tag),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('galleryParts', () => {
  // `roots` draws with the parts and returns the roots the fallback drew.
  it.each([
    {
      case: 'a section that throws',
      mine: { section: fail } as Layout,
      roots: (parent: HTMLElement, shown: ShownLayouts<Layout>) => [
        createGalleryParts(fakeDeps()).drawSection(
          parent,
          'Kbd',
          [[sampleCell('a')]],
          shown,
        ).built.element,
      ],
    },
    {
      case: 'a cell that throws',
      mine: { cell: fail } as Layout,
      roots: (parent: HTMLElement, shown: ShownLayouts<Layout>) => {
        createGalleryParts(fakeDeps()).drawSection(
          parent,
          'Kbd',
          [[sampleCell('a'), sampleCell('b')], [sampleCell('c')]],
          shown,
        );
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
      roots: (parent: HTMLElement, shown: ShownLayouts<Layout>) => [
        createGalleryParts(fakeDeps()).drawFramedSection(
          parent,
          { name: 'Split', isDialog: false },
          asHtml(new FakeElement('div')),
          shown,
        ).built.element,
      ],
    },
  ])('draws $case with default', ({ mine, roots }) => {
    const parent = asHtml(new FakeElement('div'));

    const drawn = roots(parent, shownWith(mine));

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
      draw(parent: HTMLElement, shown: ShownLayouts<Layout>) {
        const cells = [sampleCell('a'), sampleCell('b')];
        createGalleryParts(fakeDeps()).drawSection(
          parent,
          'Tag',
          [cells],
          shown,
        );
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
      draw(parent: HTMLElement, shown: ShownLayouts<Layout>) {
        const rows = [[sampleCell('a'), sampleCell('b')], [sampleCell('c')]];
        const section = createGalleryParts(fakeDeps()).drawSection(
          parent,
          'Tag',
          rows,
          shown,
        ).built.element;
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
      draw(parent: HTMLElement, shown: ShownLayouts<Layout>) {
        const sample = asHtml(new FakeElement('div'));
        const section = createGalleryParts(fakeDeps()).drawFramedSection(
          parent,
          { name: 'Split', isDialog: false },
          sample,
          shown,
        ).built.element;
        return {
          landed: [asFake(section).childNodes.at(-1)],
          samples: [sample],
        };
      },
    },
  ])('appends the piece $case leaves out', ({ mine, draw }) => {
    const parent = asHtml(new FakeElement('div'));

    const { landed, samples } = draw(parent, shownWith(mine));

    expect(landed).toEqual(samples);
  });
});

describe('galleryView', () => {
  const view = (deps: GalleryPartsDeps) =>
    createGalleryView({
      ...deps,
      uiState: { get: () => undefined, set: () => undefined },
    });

  it('leaves one transparency anchor however often the head draws', () => {
    const anchors = recordingAnchors();
    const gallery = view(fakeDeps(anchors.anchor));

    gallery.showTransparency('reduced');
    gallery.showTransparency('full');
    gallery.setLayouts(shownWith({}));

    expect(anchors.liveFor('gallery.toggleTransparency')).toBe(1);
  });

  it('keeps the scroll through a relayout', () => {
    const gallery = view(fakeDeps());
    gallery.sheet.scrollTop = 480;

    gallery.setLayouts(shownWith({}));

    expect(gallery.sheet.scrollTop).toBe(480);
  });
});
