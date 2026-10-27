import type { Log } from '../../../../contracts/log';
import type { MarkdownRenderer } from '../../../../contracts/markdown';
import type { ShownLayouts } from '../../../../contracts/plugin';
import type { Platform } from '../../../../contracts/platform';
import {
  createBaseKit,
  type KitCommands,
} from '../../../../shared/page/layout-host/base-kit';
import {
  type DrawnPart,
  drawPart,
  requireElementIn,
  type RollbackDeps,
} from '../../../../shared/page/layout-host/draw-part';
import { pickLayout } from '../../../../shared/page/layout-host/pick';
import { qualify } from '../../../../shared/plugin-manifests';
import type { KeysPageExports } from '../../../keys/contract';
import defaultLayout from '../../layouts/default/layout.js';
import type {
  GalleryFramedInput,
  GalleryHeadInput,
  GalleryKit,
  GalleryPart,
  Layout,
  SampleKit,
  SectionKit,
} from '../../layouts/layout';
import { galleryManifest } from '../../manifest';

const DEFAULT_LAYOUT = 'default';

// What the gallery's kits and part draws read: the keys plugin's `anchor` and
// `keysFor`, and the commands a kit's `command` reaches.
export interface GalleryPartsDeps {
  markdown: MarkdownRenderer;
  keys: Pick<KeysPageExports, 'anchor' | 'keysFor'>;
  commands: KitCommands;
  platform: Platform;
  log: Log;
}

// One state of a section's primitive: the app's sample, its caption, and
// whether it fills a fixed width.
export interface SampleCell {
  sample: HTMLElement;
  caption: string;
  isWide: boolean;
}

// Each draw appends one part's root to `parent` in the user's layout of
// `shown`, else in `default`, and returns the drawn part, whose `dispose`
// releases the anchors its draw named. A section's dispose covers its cells.
export interface GalleryParts {
  drawHead(
    parent: HTMLElement,
    input: GalleryHeadInput,
    shown: ShownLayouts<Layout>,
  ): DrawnPart<GalleryPart>;
  drawSection(
    parent: HTMLElement,
    name: string,
    rows: SampleCell[][],
    shown: ShownLayouts<Layout>,
  ): DrawnPart<GalleryPart>;
  drawFramedSection(
    parent: HTMLElement,
    input: GalleryFramedInput,
    sample: HTMLElement,
    shown: ShownLayouts<Layout>,
  ): DrawnPart<GalleryPart>;
}

export function createGalleryParts(deps: GalleryPartsDeps): GalleryParts {
  const draw = <B>(
    partName: keyof Layout,
    parent: HTMLElement,
    shown: ShownLayouts<Layout>,
    part: (layout: Layout) => B | undefined,
    build: (
      builder: B,
      parent: HTMLElement,
      rollback: RollbackDeps,
    ) => GalleryPart,
  ): DrawnPart<GalleryPart> =>
    drawPart<Layout, B, GalleryPart>({
      owner: galleryManifest.id,
      parent,
      pick: pickLayout(
        [shown.user, DEFAULT_LAYOUT],
        shown.layouts,
        (layout) => layout[partName] !== undefined,
      ),
      defaultLayout,
      part,
      build,
      log: deps.log,
      logSource: galleryManifest.id,
      partName,
    });

  const drawCell = (
    parent: HTMLElement,
    cell: SampleCell,
    shown: ShownLayouts<Layout>,
  ): DrawnPart<GalleryPart> =>
    draw(
      'cell',
      parent,
      shown,
      (layout) => layout.cell,
      (builder, cellParent, rollback) => {
        const kit = sampleKit(createGalleryKit(deps, rollback), cell.sample);
        const input = { caption: cell.caption, isWide: cell.isWide };
        const part = builder(cellParent, input, kit);
        return withSample(cellParent, part, cell.sample, 'cell');
      },
    );

  return {
    drawHead: (parent, input, shown) =>
      draw(
        'head',
        parent,
        shown,
        (layout) => layout.head,
        (builder, headParent, rollback) => {
          const kit = createGalleryKit(deps, rollback);
          return builder(headParent, input, {
            ...kit,
            transparencyHint: (hintParent) =>
              kit.keyHint(hintParent, 'toggleTransparency', {
                label: 'transparency',
              }),
          });
        },
      ),
    drawSection: (parent, name, rows, shown) =>
      draw(
        'section',
        parent,
        shown,
        (layout) => layout.section,
        (builder, sectionParent, rollback) => {
          // Each cell's dispose is recorded, so a rolled back section
          // releases its cells' anchors and its dispose covers them.
          const drawn = new Set<SampleCell>();
          const placeCell = (cellParent: HTMLElement, cell: SampleCell) => {
            drawn.add(cell);
            const part = drawCell(cellParent, cell, shown);
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
      ),
    drawFramedSection: (parent, input, sample, shown) =>
      draw(
        'framedSection',
        parent,
        shown,
        (layout) => layout.framedSection,
        (builder, sectionParent, rollback) => {
          const kit = sampleKit(createGalleryKit(deps, rollback), sample);
          const part = builder(sectionParent, input, kit);
          return withSample(sectionParent, part, sample, 'framedSection');
        },
      ),
  };
}

// The base kit in the `gallery` scope, naming gallery's own commands by their
// short names. Each anchor it names is recorded in `rollback`.
function createGalleryKit(
  deps: GalleryPartsDeps,
  rollback: RollbackDeps,
): GalleryKit {
  return createBaseKit({
    markdown: deps.markdown,
    keys: {
      anchor(node, command, options) {
        const anchor = deps.keys.anchor(node, command, options);
        rollback.recordAnchor(anchor);
        return anchor;
      },
      keysFor: (command, scope) => deps.keys.keysFor(command, scope),
    },
    commands: deps.commands,
    scope: qualify(galleryManifest.id, 'gallery'),
    commandNamed: (short) =>
      Object.hasOwn(galleryManifest.commands, short)
        ? qualify(galleryManifest.id, short)
        : null,
    platform: deps.platform,
  });
}

function sampleKit(kit: GalleryKit, sample: HTMLElement): SampleKit {
  return {
    ...kit,
    sample(parent) {
      parent.append(sample);
      return sample;
    },
  };
}

// The part's checked root, with `sample` appended at its end when the part
// left the sample out of it.
function withSample(
  parent: HTMLElement,
  part: GalleryPart | null | undefined,
  sample: HTMLElement,
  partName: string,
): GalleryPart {
  const root = requireElementIn(parent, part?.element, partName);
  if (!root.contains(sample)) {
    root.append(sample);
  }
  return { element: root };
}
