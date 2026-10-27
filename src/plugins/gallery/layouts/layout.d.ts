import type { BaseKit } from '../../../shared/page/layout-host/kit';

// Gallery mode's layout contract: the status line over the sheet, each primitive's sample block and each sample
// cell. Every part appends its root element to `parent` and returns it; the app sets `data-layout="<name>"` and
// `data-layout-owner="gallery"` on that root. The app builds every sample with the shared primitives and keeps the
// tab strip, the sheet, its scrolling and the transparency switch. A layout's CSS selects under its own root only,
// so it never restyles a primitive.

// The status line: the transparency override in force, null when the setting decides.
export interface GalleryHeadInput {
  transparency: 'full' | 'reduced' | null;
}
// One state of a primitive: its caption, and whether its sample fills a fixed width (a row, a card).
export interface GalleryCellInput {
  caption: string;
  isWide: boolean;
}
// A primitive's block: its name over each row of state cells.
export interface GallerySectionInput {
  name: string;
  rows: GalleryCellInput[][];
}
// A primitive shown as one sample spanning the grid row (Split, FloatingPanel, Dialog); `isDialog` for the dialog,
// whose frame holds its scrim.
export interface GalleryFramedInput {
  name: string;
  isDialog: boolean;
}

// What a part returns: its root element.
export interface GalleryPart {
  element: HTMLElement;
}

// The parts every gallery kit holds, beside the base kit's.
export interface GalleryKit extends BaseKit {}

export interface HeadKit extends GalleryKit {
  // `span`: the `toggleTransparency` keys with the label `transparency`.
  transparencyHint(parent: HTMLElement): HTMLElement;
}
export interface SectionKit extends GalleryKit {
  // Draws the cell at `row` and `column` of `input.rows` with the `cell` part into `parent`, and returns its root.
  // A cell the section leaves out, the app draws at the end of the section's root, in row order.
  cell(parent: HTMLElement, row: number, column: number): HTMLElement;
}
export interface SampleKit extends GalleryKit {
  // Appends the app's sample to `parent` and returns it. Left out: the sample goes at the end of the part's root.
  sample(parent: HTMLElement): HTMLElement;
}

// A layout defines only the parts it changes; each part comes from the `gallery.layout` setting's layout when it
// defines the part, else from `default`. A part that throws, or returns no element appended to `parent`, is drawn by
// `default` instead.
export interface Layout {
  // The status line over the tab strip, drawn again on each transparency switch.
  head?(
    parent: HTMLElement,
    input: GalleryHeadInput,
    kit: HeadKit,
  ): GalleryPart;
  // One per primitive shown as rows of state cells, into the sheet's grid.
  section?(
    parent: HTMLElement,
    input: GallerySectionInput,
    kit: SectionKit,
  ): GalleryPart;
  // One per primitive shown as one framed sample, into the sheet's grid.
  framedSection?(
    parent: HTMLElement,
    input: GalleryFramedInput,
    kit: SampleKit,
  ): GalleryPart;
  // One per state of a section's primitive, where the section asks for it.
  cell?(
    parent: HTMLElement,
    input: GalleryCellInput,
    kit: SampleKit,
  ): GalleryPart;
}

// The built-in `default` layout, which defines every part.
export interface CompleteLayout extends Required<Layout> {}
