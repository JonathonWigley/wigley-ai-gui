import type { Log } from '../../../../contracts/log';
import type { ShownLayouts } from '../../../../contracts/plugin';
import {
  type AppSlot,
  appSlot,
} from '../../../../shared/page/layout-host/app-slot';
import {
  createBaseKit,
  type OwnerKitServices,
  ownerBaseKitDeps,
} from '../../../../shared/page/layout-host/base-kit';
import {
  type DrawnPart,
  type RollbackDeps,
  requireElementIn,
} from '../../../../shared/page/layout-host/draw-part';
import { createLayoutParts } from '../../../../shared/page/layout-host/layout-parts';
import defaultLayout from '../../layouts/default/layout.js';
import type {
  CompleteLayout,
  GalleryFramedInput,
  GalleryHeadInput,
  GalleryKit,
  GalleryPart,
  Layout,
  SampleKit,
  SectionKit,
} from '../../layouts/layout';
import { galleryManifest } from '../../manifest';

// What the gallery's kits and part draws read.
export interface GalleryPartsDeps extends OwnerKitServices {
  log: Log;
}

// One state of a section's primitive: the app's sample, its caption, and
// whether it fills a fixed width.
export interface SampleCell {
  sample: HTMLElement;
  caption: string;
  isWide: boolean;
}

// Each draw appends one part's root to `parent` in the user's layout of the
// shown set when it defines the part, else in `default`, and returns the drawn
// part. The head and each section keep one draw: drawing one again disposes
// its last draw, releasing the anchors it named, and removes its root. A
// section's draw covers its cells. The shown set is `default` alone until the
// first `setLayouts`.
export interface GalleryParts {
  setLayouts(shown: ShownLayouts<Layout>): void;
  drawHead(
    parent: HTMLElement,
    input: GalleryHeadInput,
  ): DrawnPart<GalleryPart>;
  drawSection(
    parent: HTMLElement,
    name: string,
    rows: SampleCell[][],
  ): DrawnPart<GalleryPart>;
  drawFramedSection(
    parent: HTMLElement,
    input: GalleryFramedInput,
    sample: HTMLElement,
  ): DrawnPart<GalleryPart>;
}

export function createGalleryParts(deps: GalleryPartsDeps): GalleryParts {
  const parts = createLayoutParts<Layout, CompleteLayout>({
    owner: galleryManifest.id,
    defaultLayout,
    log: deps.log,
  });

  const drawCell = (
    parent: HTMLElement,
    cell: SampleCell,
  ): DrawnPart<GalleryPart> =>
    parts.draw('cell', parent, (builder, cellParent, rollback) => {
      const slot = appSlot(cell.sample, 'sample', rollback);
      const kit = sampleKit(createGalleryKit(deps, rollback), slot);
      const input = { caption: cell.caption, isWide: cell.isWide };
      const part = builder(cellParent, input, kit);
      return withSample(cellParent, part, slot, 'cell');
    });

  return {
    setLayouts: (shown) => parts.setLayouts(shown),
    drawHead: (parent, input) =>
      parts.redraw('head', parent, (builder, headParent, rollback) => {
        const kit = createGalleryKit(deps, rollback);
        return builder(headParent, input, {
          ...kit,
          transparencyHint: (hintParent) =>
            kit.keyHint(hintParent, 'toggleTransparency', {
              label: 'transparency',
            }),
        });
      }),
    drawSection: (parent, name, rows) =>
      parts.redraw(
        'section',
        parent,
        (builder, sectionParent, rollback) => {
          // Each cell's dispose is recorded, so a rolled back section
          // releases its cells' anchors and its dispose covers them.
          const drawn = new Set<SampleCell>();
          const placeCell = (cellParent: HTMLElement, cell: SampleCell) => {
            drawn.add(cell);
            const part = drawCell(cellParent, cell);
            rollback.recordAnchor(part);
            return part.built.element;
          };
          const kit: SectionKit = {
            ...createGalleryKit(deps, rollback),
            cell(cellParent, row, column) {
              const cell = rows[row]?.[column];
              if (cell === undefined) {
                throw new Error(
                  `section ${name} has no cell ${row}, ${column}`,
                );
              }
              return placeCell(cellParent, cell);
            },
          };
          const input = {
            name,
            rows: rows.map((cells) =>
              cells.map(({ caption, isWide }) => ({ caption, isWide })),
            ),
          };
          const part = builder(sectionParent, input, kit);
          const root = requireElementIn(
            sectionParent,
            part?.element,
            'section',
          );
          for (const cell of rows.flat()) {
            if (!drawn.has(cell)) {
              placeCell(root, cell);
            }
          }
          return { element: root };
        },
        `section:${name}`,
      ),
    drawFramedSection: (parent, input, sample) =>
      parts.redraw(
        'framedSection',
        parent,
        (builder, sectionParent, rollback) => {
          const slot = appSlot(sample, 'sample', rollback);
          const kit = sampleKit(createGalleryKit(deps, rollback), slot);
          const part = builder(sectionParent, input, kit);
          return withSample(sectionParent, part, slot, 'framedSection');
        },
        `framedSection:${input.name}`,
      ),
  };
}

// The base kit in the `gallery` scope, naming gallery's own commands by their
// short names. Each anchor it names is recorded in `rollback`.
function createGalleryKit(
  deps: GalleryPartsDeps,
  rollback: RollbackDeps,
): GalleryKit {
  return createBaseKit(
    ownerBaseKitDeps(galleryManifest, deps, 'gallery', rollback),
  );
}

function sampleKit(kit: GalleryKit, slot: AppSlot): SampleKit {
  return { ...kit, sample: (parent) => slot.place(parent) };
}

// The part's checked root, with the sample placed at its end when the part
// left it out.
function withSample(
  parent: HTMLElement,
  part: GalleryPart | null | undefined,
  slot: AppSlot,
  partName: string,
): GalleryPart {
  const root = requireElementIn(parent, part?.element, partName);
  slot.placeIfLeftOut(root);
  return { element: root };
}
