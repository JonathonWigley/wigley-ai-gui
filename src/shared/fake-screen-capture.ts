import type { CaptureWindow, ScreenCapture } from '../contracts/screen-capture';

// The pid of the fake Unity editor that owns the fake's Game View and main
// editor windows.
export const FAKE_EDITOR_PROCESS_ID = 4242;

// A Game View rect `[x, y, width, height]` that lies inside the fake main
// editor window and outside its floating Game View window.
export const FAKE_GAME_RECT: readonly [number, number, number, number] = [
  500, 120, 360, 640,
];

const OTHER_PROCESS_ID = 5150;

// Front to back: another app's window, then the fake editor's floating Game
// View and its main window. Each source is a sample source of the window's
// own size.
const FAKE_WINDOWS: readonly CaptureWindow[] = [
  {
    sourceId: 'sample:800x600',
    processId: OTHER_PROCESS_ID,
    title: 'Other',
    bounds: { x: 300, y: 80, width: 800, height: 600 },
  },
  {
    sourceId: 'sample:405x760',
    processId: FAKE_EDITOR_PROCESS_ID,
    title: 'Game',
    bounds: { x: 1500, y: 120, width: 405, height: 760 },
  },
  {
    sourceId: 'sample:1440x900',
    processId: FAKE_EDITOR_PROCESS_ID,
    title: '[selftest-unity] SampleScene',
    bounds: { x: 0, y: 25, width: 1440, height: 900 },
  },
];

// A ScreenCapture over a fixed window list of sample sources, or blocked
// when `options.access` is `'blocked'`; opening the settings does nothing.
export function createFakeScreenCapture(
  options: { access?: 'granted' | 'blocked' } = {},
): ScreenCapture {
  return {
    listWindows: async () =>
      options.access === 'blocked'
        ? { access: 'blocked' }
        : { access: 'granted', windows: FAKE_WINDOWS },
    openAccessSettings: async () => {},
  };
}
