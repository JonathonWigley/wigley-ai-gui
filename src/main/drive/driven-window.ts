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

// The page a script ran in is gone: its main frame committed a navigation, or
// its renderer went away, before the script answered.
export class PageNavigatedError extends Error {
  constructor() {
    super('The page navigated while the script ran');
    this.name = 'PageNavigatedError';
  }
}

// The `run` calls of one page not yet settled, for a `DrivenWindow` to reject
// when its page goes away.
export interface PendingRuns {
  // Resolves or rejects as `start()` does, unless `rejectAll` rejects it
  // first. The call is pending before `start` is called, so a `start` that
  // leads to `rejectAll` rejects its own call.
  track<T>(start: () => Promise<T>): Promise<T>;
  // Rejects every pending call with `PageNavigatedError`.
  rejectAll(): void;
}

export function createPendingRuns(): PendingRuns {
  // The reject of every call not yet settled.
  const rejects = new Set<(error: Error) => void>();
  return {
    track: <T>(start: () => Promise<T>) =>
      new Promise<T>((resolve, reject) => {
        rejects.add(reject);
        start()
          .then(resolve, reject)
          .finally(() => rejects.delete(reject));
      }),
    rejectAll() {
      for (const reject of rejects) {
        reject(new PageNavigatedError());
      }
      rejects.clear();
    },
  };
}

// The app window as the page driver drives it. Every size is the content
// size, the page's own area without the window frame.
export interface DrivenWindow {
  sendInput(input: DrivenInput): void;
  // Runs `script` in the page and resolves to its result. Rejects with
  // `PageNavigatedError` when the page's main frame commits a navigation, or
  // its renderer goes away, while the script runs.
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
  // apply. Safe to repeat. Rejects when it cannot, such as while another
  // debugger holds the page.
  emulateFocus(): Promise<void>;
  // Whether the page has drawn a frame since its last navigation; Chromium
  // drops input that reaches a page before its first frame.
  hasPaintedSinceNavigation(): boolean;
  // How many times the page has navigated, a reload included.
  navigationCount(): number;
  // Hears every frame the page draws, with its PNG made on demand and the
  // time it arrived in milliseconds since the epoch.
  onFrame(listener: (png: () => Uint8Array, at: number) => void): Disposable;
  onConsole(listener: (message: ConsoleMessage) => void): Disposable;
}
