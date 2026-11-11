import { describe, expect, it } from 'vitest';
import type { CaptureWindow, ScreenRect } from '../contracts/screen-capture';
import {
  createFakeScreenCapture,
  FAKE_EDITOR_PROCESS_ID,
  FAKE_GAME_RECT,
} from './fake-screen-capture';

const [x, y, width, height] = FAKE_GAME_RECT;
const GAME_RECT: ScreenRect = { x, y, width, height };

function holds(bounds: ScreenRect, rect: ScreenRect): boolean {
  return (
    rect.x >= bounds.x &&
    rect.y >= bounds.y &&
    rect.x + rect.width <= bounds.x + bounds.width &&
    rect.y + rect.height <= bounds.y + bounds.height
  );
}

async function editorWindows(): Promise<readonly CaptureWindow[]> {
  const list = await createFakeScreenCapture().listWindows();
  if (list.access === 'blocked') {
    throw new Error('the fake listed no windows');
  }
  return list.windows.filter(
    (window) => window.processId === FAKE_EDITOR_PROCESS_ID,
  );
}

describe('createFakeScreenCapture', () => {
  // Live view's pick and self-test rely on the rect landing in the main
  // window, behind a floating Game View that does not hold it.
  it('fakeScreenCapture_GameRectLiesInTheMainWindowOnly', async () => {
    const [floating, main] = await editorWindows();

    expect({
      floating: holds(floating.bounds, GAME_RECT),
      main: holds(main.bounds, GAME_RECT),
    }).toEqual({ floating: false, main: true });
  });

  it('fakeScreenCapture_BlockedAccess_ListsNoWindows', async () => {
    const list = await createFakeScreenCapture({
      access: 'blocked',
    }).listWindows();

    expect(list).toEqual({ access: 'blocked' });
  });
});
