import type { Disposable } from './disposable';

export type MarkupTool = 'select' | 'pen' | 'text' | 'arrow' | 'box';

export interface MarkupSession {
  setTool(tool: MarkupTool): void;
  setColour(colour: string): void; // a CSS colour the caller read from a theme token
  undo(): void;
  redo(): void;
  // Ends an active text edit, recording it as a mark (a blank text is removed); a no-op otherwise.
  // `toJson` and `toPng` call it first.
  finishEdit(): void;
  // The markup as JSON, to reopen with `open`'s `saved`.
  toJson(): string;
  // The image with its markup, flattened, at the image's own pixel size.
  toPng(): Promise<Uint8Array>;
  onChange(listener: () => void): Disposable;
  dispose(): void;
}

export interface MarkupEditor {
  // Draws the PNG `image` in `host`, scaled to fit, with the markup `saved` over it (null: none).
  // `host` must already be laid out at a non-zero size: open measures it once, and rejects with
  // `Markup host has no size` otherwise, with `Markup image did not load` for a bad `image`, or
  // with Fabric's own error for a `saved` JSON Fabric cannot load.
  // The session starts on the `select` tool, coloured with the host's computed `color`.
  open(
    host: HTMLElement,
    image: Uint8Array,
    saved: string | null,
  ): Promise<MarkupSession>;
}
