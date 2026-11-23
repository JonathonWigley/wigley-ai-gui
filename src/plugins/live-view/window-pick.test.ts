import { describe, expect, it } from 'vitest';
import type {
  CaptureWindow,
  ScreenRect,
  WindowList,
} from '../../contracts/screen-capture';
import {
  createFakeScreenCapture,
  FAKE_EDITOR_PROCESS_ID,
  FAKE_GAME_RECT,
} from '../../shared/fake-screen-capture';
import {
  cropOf,
  demoStreamPick,
  pickEditorWindow,
  pickOf,
  rectOfTuple,
  streamMoved,
} from './window-pick';

const EDITOR = FAKE_EDITOR_PROCESS_ID;

// The fake's windows, front to back: another process's, the editor's floating
// Game View, the editor's main window.
const FAKE_LIST = await createFakeScreenCapture().listWindows();
if (FAKE_LIST.access !== 'granted') {
  throw new Error('the fake ScreenCapture lists no windows');
}
const FAKE_WINDOWS = FAKE_LIST.windows;
const [OTHER, FLOATING, MAIN] = FAKE_WINDOWS as [
  CaptureWindow,
  CaptureWindow,
  CaptureWindow,
];

// Another process's window, frontmost and larger than any of the editor's,
// holding the fake Game View rect.
const LARGE_OTHER: CaptureWindow = {
  sourceId: 'sample:2000x1200',
  processId: 5150,
  title: 'Large other',
  bounds: { x: 0, y: 0, width: 2000, height: 1200 },
};

// An editor window the size of the main one, behind it.
const EQUAL_TO_MAIN: CaptureWindow = {
  sourceId: 'sample:900x1440',
  processId: EDITOR,
  title: 'Equal',
  bounds: { x: 10, y: 40, width: 900, height: 1440 },
};

const GAME_RECT = rectOfTuple(FAKE_GAME_RECT);
const MAIN_BOUNDS = MAIN.bounds;

describe('pickEditorWindow', () => {
  it.each<{
    given: string;
    windows: readonly CaptureWindow[];
    rect: ScreenRect | null;
    picked: CaptureWindow | null;
  }>([
    {
      given: 'the fake Game View rect, inside the main window only',
      windows: FAKE_WINDOWS,
      rect: GAME_RECT,
      picked: MAIN,
    },
    {
      given: 'a rect inside the floating window',
      windows: FAKE_WINDOWS,
      rect: { x: 1510, y: 150, width: 385, height: 684 },
      picked: FLOATING,
    },
    {
      given: 'no rect',
      windows: FAKE_WINDOWS,
      rect: null,
      picked: MAIN,
    },
    {
      given: 'a rect inside no window',
      windows: FAKE_WINDOWS,
      rect: { x: 2000, y: 1000, width: 100, height: 200 },
      picked: null,
    },
    {
      given: 'a rect 1 point past every edge of the main window',
      windows: FAKE_WINDOWS,
      rect: {
        x: MAIN_BOUNDS.x - 1,
        y: MAIN_BOUNDS.y - 1,
        width: MAIN_BOUNDS.width + 2,
        height: MAIN_BOUNDS.height + 2,
      },
      picked: MAIN,
    },
    {
      given: 'a rect 2 points past the left edge of the main window',
      windows: FAKE_WINDOWS,
      rect: { x: MAIN_BOUNDS.x - 2, y: 300, width: 400, height: 300 },
      picked: null,
    },
    {
      given: 'a rect 2 points past the bottom edge of the main window',
      windows: FAKE_WINDOWS,
      rect: {
        x: 300,
        y: 500,
        width: 400,
        height: MAIN_BOUNDS.y + MAIN_BOUNDS.height + 2 - 500,
      },
      picked: null,
    },
    {
      given: "another process's larger frontmost window and no rect",
      windows: [LARGE_OTHER, FLOATING, MAIN],
      rect: null,
      picked: MAIN,
    },
    {
      given: "another process's larger frontmost window holding the rect",
      windows: [LARGE_OTHER, FLOATING, MAIN],
      rect: GAME_RECT,
      picked: MAIN,
    },
    {
      given: 'two editor windows of equal area and no rect',
      windows: [OTHER, MAIN, EQUAL_TO_MAIN],
      rect: null,
      picked: MAIN,
    },
  ])(
    'pickEditorWindow_PicksTheEditorWindow_given $given',
    ({ windows, rect, picked }) => {
      expect(pickEditorWindow(windows, EDITOR, rect)).toBe(picked);
    },
  );
});

describe('pickOf', () => {
  const granted: WindowList = { access: 'granted', windows: FAKE_WINDOWS };

  it.each<{
    given: string;
    list: WindowList;
    processId: number;
    rect: ScreenRect | null;
    result: ReturnType<typeof pickOf>;
  }>([
    {
      given: 'access blocked',
      list: { access: 'blocked' },
      processId: EDITOR,
      rect: GAME_RECT,
      result: { pick: { kind: 'blocked' } },
    },
    {
      given: 'a rect inside the main window',
      list: granted,
      processId: EDITOR,
      rect: GAME_RECT,
      result: {
        pick: {
          kind: 'stream',
          sourceId: MAIN.sourceId,
          summary: 'Game View · Game',
          windowSize: { width: 1440, height: 900 },
          crop: {
            x: 500 / 1440,
            y: 95 / 900,
            width: 360 / 1440,
            height: 640 / 900,
          },
        },
      },
    },
    {
      given: 'no rect',
      list: granted,
      processId: EDITOR,
      rect: null,
      result: {
        pick: {
          kind: 'stream',
          sourceId: MAIN.sourceId,
          summary: 'Editor · Game',
          windowSize: { width: 1440, height: 900 },
          crop: null,
        },
      },
    },
    {
      given: 'no window of the process, with a rect',
      list: granted,
      processId: 7,
      rect: GAME_RECT,
      result: {
        error:
          "Game's editor (process 7) has no window the app can stream; a minimized window cannot stream.",
      },
    },
    {
      given: 'no window of the process, without a rect',
      list: granted,
      processId: 7,
      rect: null,
      result: {
        error:
          "Game's editor (process 7) has no window the app can stream; a minimized window cannot stream.",
      },
    },
    {
      given: 'a rect outside every window of the process',
      list: granted,
      processId: EDITOR,
      rect: { x: 2000, y: 1000, width: 100, height: 200 },
      result: {
        error:
          "The Game View rect [2000, 1000, 100, 200] is not inside any window of Game's editor. Call show_live_view again with the Game View rect of a fresh capture, or with no gameRect to stream the whole editor.",
      },
    },
  ])(
    'pickOf_BuildsThePickOrTheError_given $given',
    ({ list, processId, rect, result }) => {
      expect(pickOf(list, processId, rect, 'Game')).toEqual(result);
    },
  );
});

describe('demoStreamPick', () => {
  const APP = 4000;
  const UNITY = 6000;
  const windowOf = (
    processId: number,
    title: string,
    width: number,
    height: number,
  ): CaptureWindow => ({
    sourceId: `sample:${width}x${height}`,
    processId,
    title,
    bounds: { x: 20, y: 30, width, height },
  });
  // The Unity editor's titled window is the smaller of its two.
  const UNITY_TITLED = windowOf(
    UNITY,
    'Game - Main - macOS - Unity 6000.0.1f1',
    800,
    600,
  );
  const UNITY_LARGE = windowOf(UNITY, 'Inspector', 1600, 1000);
  const APP_SMALL = windowOf(APP, 'Settings', 400, 300);
  const APP_LARGE = windowOf(APP, 'wigley-ai-gui', 1200, 800);
  const OTHER_WINDOW = windowOf(7, 'Notes', 2000, 1200);
  const streamOf = (window: CaptureWindow, summary: string) => ({
    kind: 'stream',
    sourceId: window.sourceId,
    summary,
    windowSize: { width: window.bounds.width, height: window.bounds.height },
    crop: null,
  });

  // Breaks on a pick of the titled window over its process's largest, or of
  // the app over a running editor.
  it.each<{ given: string; list: WindowList; pick: unknown }>([
    {
      given: 'access blocked',
      list: { access: 'blocked' },
      pick: { kind: 'blocked' },
    },
    {
      given: 'a Unity editor window and app windows',
      list: {
        access: 'granted',
        windows: [APP_LARGE, UNITY_TITLED, APP_SMALL, UNITY_LARGE],
      },
      pick: streamOf(UNITY_LARGE, 'Unity editor'),
    },
    {
      given: 'app windows only',
      list: {
        access: 'granted',
        windows: [OTHER_WINDOW, APP_SMALL, APP_LARGE],
      },
      pick: streamOf(APP_LARGE, 'This app'),
    },
    {
      given: 'neither',
      list: { access: 'granted', windows: [OTHER_WINDOW] },
      pick: null,
    },
  ])('demoStreamPick_PicksUnityElseTheApp_given $given', ({ list, pick }) => {
    expect(demoStreamPick(list, APP)).toEqual(pick);
  });
});

describe('cropOf', () => {
  const bounds: ScreenRect = { x: 100, y: 50, width: 400, height: 600 };

  it.each<{ given: string; rect: ScreenRect; crop: ScreenRect }>([
    {
      given: 'a rect inside the window',
      rect: { x: 130, y: 75, width: 210, height: 330 },
      crop: { x: 30 / 400, y: 25 / 600, width: 210 / 400, height: 330 / 600 },
    },
    {
      given: 'a rect 1 point past every edge',
      rect: { x: 99, y: 49, width: 402, height: 602 },
      crop: { x: 0, y: 0, width: 1, height: 1 },
    },
    {
      given: 'a window-sized rect 1 point right of and below the origin',
      rect: { x: 101, y: 51, width: 400, height: 600 },
      crop: { x: 1 / 400, y: 1 / 600, width: 399 / 400, height: 599 / 600 },
    },
  ])(
    'cropOf_IsTheRectAsFractionsOfTheWindow_given $given',
    ({ rect, crop }) => {
      expect(cropOf(rect, bounds)).toEqual({
        x: expect.closeTo(crop.x, 12),
        y: expect.closeTo(crop.y, 12),
        width: expect.closeTo(crop.width, 12),
        height: expect.closeTo(crop.height, 12),
      });
    },
  );
});

describe('streamMoved', () => {
  it.each([
    {
      given: 'the same aspect ratio',
      stream: { width: 800, height: 450 },
      moved: false,
    },
    {
      given: 'a ratio 1% wider',
      stream: { width: 808, height: 450 },
      moved: false,
    },
    {
      given: 'a ratio 3% wider',
      stream: { width: 824, height: 450 },
      moved: true,
    },
    {
      given: 'a ratio 3% narrower',
      stream: { width: 776, height: 450 },
      moved: true,
    },
  ])('streamMoved_ComparesAspectRatios_given $given', ({ stream, moved }) => {
    expect(streamMoved({ width: 1600, height: 900 }, stream)).toBe(moved);
  });
});
