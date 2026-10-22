import type { Disposable } from '../../contracts/disposable';

// A rectangle in the page's CSS pixels, from its top left corner.
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

// An input event sent into the page as the OS would deliver it.
export type DrivenInput =
  | { type: 'keyDown' | 'keyUp'; keyCode: string; modifiers: Modifier[] }
  | { type: 'char'; keyCode: string }
  | {
      type: 'mouseDown' | 'mouseUp' | 'mouseMove';
      x: number;
      y: number;
      button: 'left' | 'right';
      clickCount: number;
    };

export type Modifier = 'control' | 'alt' | 'shift' | 'meta';

// A message the page wrote to its console.
export interface ConsoleMessage {
  level: string;
  text: string;
  source: string;
}

// The app window as the page driver drives it. Every size is the content
// size, the page's own area without the window frame.
export interface DrivenWindow {
  sendInput(input: DrivenInput): void;
  // Runs `script` in the page and resolves to its result.
  run<T>(script: string): Promise<T>;
  // PNG bytes of the window, or of `box` in it; null when the capture is empty.
  capture(box?: Box): Promise<Uint8Array | null>;
  contentSize(): { width: number; height: number };
  // The content width at the window's minimum size.
  minimumWidth(): number;
  // Keeps the height.
  setContentWidth(width: number): void;
  setSize(width: number, height: number): void;
  focus(): void;
  // Whether the page has drawn a frame since its last navigation; Chromium
  // drops input that reaches a page before its first frame.
  hasPaintedSinceNavigation(): boolean;
  // Hears every frame the page draws, with its PNG made on demand and the
  // time it arrived in milliseconds since the epoch.
  onFrame(listener: (png: () => Uint8Array, at: number) => void): Disposable;
  onConsole(listener: (message: ConsoleMessage) => void): Disposable;
}
