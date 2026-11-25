import type { Disposable } from './disposable';

export interface TerminalPalette {
  background: string;
  foreground: string;
  cursor: string;
  selection: string;
}

export interface TerminalScreenOptions {
  fontFamily: string;
  fontSize: number;
  palette: TerminalPalette;
}

export interface TerminalSize {
  cols: number;
  rows: number;
}

// `dispose` removes the element and frees the screen; a second call does
// nothing.
export interface TerminalScreen extends Disposable {
  // The screen's own element; the caller places it. The element stops the
  // bubble of every keydown that is not Esc, and the shell never receives Esc.
  readonly element: HTMLElement;
  // Writes shell output to the screen.
  write(data: string): void;
  // Hears each piece of text the user types into the screen, to send to the
  // shell.
  onInput(listener: (data: string) => void): Disposable;
  // Hears the screen's new size each time its columns or rows change.
  onResize(listener: (size: TerminalSize) => void): Disposable;
  // The screen's columns and rows now; 80 and 24 before its first fit.
  size(): TerminalSize;
  // Fits the columns and rows to the element's box; does nothing while the
  // element is not in the page or has no width or height.
  fit(): void;
  // Fits, then moves keyboard focus into the screen.
  focus(): void;
  // Sets the colours and font, then fits.
  setPalette(
    palette: TerminalPalette,
    fontFamily: string,
    fontSize: number,
  ): void;
  // Clears the screen and its scrollback, as a new shell needs.
  reset(): void;
}

export interface TerminalEmulator {
  create(options: TerminalScreenOptions): TerminalScreen;
}
