import type { BrowserWindow } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElectronAlerts } from './electron-alerts';

vi.mock('electron', () => ({
  app: {},
  nativeImage: { createFromBitmap: () => ({}) },
  Notification: { isSupported: () => false },
}));

describe('createElectronAlerts', () => {
  const realPlatform = process.platform;

  beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: realPlatform });
  });

  it.each([
    { isDestroyed: false, calls: 1 },
    { isDestroyed: true, calls: 0 },
  ])(
    'calls the taskbar $calls time(s) when isDestroyed is $isDestroyed',
    ({ isDestroyed, calls }) => {
      const setOverlayIcon = vi.fn();
      const flashFrame = vi.fn();
      const window = {
        on: vi.fn(),
        isDestroyed: () => isDestroyed,
        setOverlayIcon,
        flashFrame,
      } as unknown as BrowserWindow;
      const alerts = createElectronAlerts(window, vi.fn());

      alerts.setOpenCount('forms', 2);
      alerts.announce('title', 'body', vi.fn());

      expect(setOverlayIcon).toHaveBeenCalledTimes(calls);
      expect(flashFrame).toHaveBeenCalledTimes(calls);
    },
  );
});
