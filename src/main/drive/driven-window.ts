import type { Disposable } from '../../contracts/disposable';

// A rectangle in the page's CSS pixels, from its top left corner.
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

// An input event sent into the page as the OS would deliver it. A mouse
// event's modifiers name the buttons held while it happens, as the page's
// `buttons` reads them: a move with none held is a hover, not a drag.
export type DrivenInput =
  | { type: 'keyDown' | 'keyUp'; keyCode: string; modifiers: Modifier[] }
  | { type: 'char'; keyCode: string }
  | {
      type: 'mouseDown' | 'mouseUp' | 'mouseMove';
      x: number;
      y: number;
      button: 'left' | 'right';
      clickCount: number;
      modifiers: (Modifier | HeldButton)[];
    };

export type Modifier = 'control' | 'alt' | 'shift' | 'meta';

// Electron's spelling of a mouse button held down.
export type HeldButton = 'leftbuttondown' | 'rightbuttondown';

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
  // Gives the page keyboard focus. An offscreen window's page still lacks
  // document focus: `document.hasFocus()` stays false and no focus or blur
  // event fires.
  focus(): void;
  // Makes the page act as the focused window from now on, offscreen too:
  // `document.hasFocus()` holds, focus and blur events fire and focus styles
  // apply. Safe to repeat.
  emulateFocus(): Promise<void>;
  // Whether the page has drawn a frame since its last navigation; Chromium
  // drops input that reaches a page before its first frame.
  hasPaintedSinceNavigation(): boolean;
  // Hears every frame the page draws, with its PNG made on demand and the
  // time it arrived in milliseconds since the epoch.
  onFrame(listener: (png: () => Uint8Array, at: number) => void): Disposable;
  onConsole(listener: (message: ConsoleMessage) => void): Disposable;
}
