import type { Disposable } from './disposable';

export type MarkupTool = 'select' | 'pen' | 'text' | 'arrow' | 'box';

export interface MarkupSession {
  setTool(tool: MarkupTool): void;
  setColour(colour: string): void; // a CSS colour the caller read from a theme token
  undo(): void;
  redo(): void;
  // The markup as JSON, to reopen with `open`'s `saved`.
  toJson(): string;
  // The image with its markup, flattened, at the image's own pixel size.
  toPng(): Promise<Uint8Array>;
  onChange(listener: () => void): Disposable;
  dispose(): void;
}

export interface MarkupEditor {
  // Draws the PNG `image` in `host`, scaled to fit, with the markup `saved` over it (null: none).
  open(
    host: HTMLElement,
    image: Uint8Array,
    saved: string | null,
  ): Promise<MarkupSession>;
}
