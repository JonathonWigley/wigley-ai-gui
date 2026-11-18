// A rectangle in global screen points, top-left origin.
export interface ScreenRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// One window the OS can stream.
export interface CaptureWindow {
  // The id the page hands getUserMedia, or a `sample:<width>x<height>` id.
  readonly sourceId: string;
  readonly processId: number; // the owning process
  readonly title: string;
  readonly bounds: ScreenRect;
}

// The windows the OS can stream, front to back, or `blocked` when the user
// has not granted screen capture to the app.
export type WindowList =
  | { readonly access: 'granted'; readonly windows: readonly CaptureWindow[] }
  | { readonly access: 'blocked' };

// Whether the user granted screen capture to the app, refused it, or was
// never asked; `undetermined` means the next `listWindows` may raise the OS's
// prompt.
export type ScreenAccess = 'granted' | 'blocked' | 'undetermined';

export interface ScreenCapture {
  // The OS's answer now, asking nothing; `granted` where the OS has no grant.
  access(): ScreenAccess;
  // Rejects when the OS has no adapter or the window list cannot be read.
  listWindows(): Promise<WindowList>;
  // Opens the OS's screen capture settings; rejects where the OS has none.
  openAccessSettings(): Promise<void>;
}
