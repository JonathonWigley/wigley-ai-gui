import type { BrowserWindow } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { createWindowsAlerts } from './windows-alerts';

const DOT = 'dot';

const electron = vi.hoisted(() => ({
  nativeImage: { createFromBitmap: () => 'dot' },
  Notification: { isSupported: () => false },
}));
vi.mock('electron', () => electron);

// A window whose calls throw once it is destroyed, as Electron's do.
function fakeWindow({ isDestroyed }: { isDestroyed: boolean }) {
  const calls: unknown[][] = [];
  const live = () => {
    if (isDestroyed) {
      throw new TypeError('Object has been destroyed');
    }
  };
  const window = {
    isDestroyed: () => isDestroyed,
    on: () => {},
    flashFrame(flag: boolean) {
      live();
      calls.push(['flashFrame', flag]);
    },
    setOverlayIcon(icon: unknown) {
      live();
      calls.push(['setOverlayIcon', icon]);
    },
  };
  return { window: window as unknown as BrowserWindow, calls };
}

describe('createWindowsAlerts', () => {
  it('destroyedWindow_AnswersWithoutThrowing', () => {
    const { window, calls } = fakeWindow({ isDestroyed: true });
    const alerts = createWindowsAlerts(window, vi.fn());

    alerts.setOpenCount('forms', 0);
    alerts.announce('title', 'body', vi.fn());

    expect(calls).toEqual([]);
  });

  it('liveWindow_UsesTheWindow', () => {
    const { window, calls } = fakeWindow({ isDestroyed: false });
    const alerts = createWindowsAlerts(window, vi.fn());

    alerts.setOpenCount('forms', 2);
    alerts.setOpenCount('forms', 0);
    alerts.announce('title', 'body', vi.fn());

    expect(calls).toEqual([
      ['setOverlayIcon', DOT],
      ['setOverlayIcon', null],
      ['flashFrame', true],
    ]);
  });
});
