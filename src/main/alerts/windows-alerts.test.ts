import type { BrowserWindow } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import type { AlertNoun } from '../../contracts/alerts';
import { createWindowsAlerts } from './windows-alerts';

const DOT = 'dot';
const F: AlertNoun = {
  singular: 'open agent form',
  plural: 'open agent forms',
};
const P: AlertNoun = {
  singular: 'open feature primer',
  plural: 'open feature primers',
};

const electron = vi.hoisted(() => ({
  nativeImage: { createFromBitmap: () => 'dot' },
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
    setOverlayIcon(icon: unknown, description: string) {
      live();
      calls.push(['setOverlayIcon', icon, description]);
    },
  };
  return { window: window as unknown as BrowserWindow, calls };
}

describe('createWindowsAlerts', () => {
  it('destroyedWindow_AnswersWithoutThrowing', () => {
    const { window, calls } = fakeWindow({ isDestroyed: true });
    const alerts = createWindowsAlerts(window);

    alerts.setOpenCount('forms', 0, F);

    expect(calls).toEqual([]);
  });

  it('liveWindow_UsesTheWindow', () => {
    const { window, calls } = fakeWindow({ isDestroyed: false });
    const alerts = createWindowsAlerts(window);

    alerts.setOpenCount('forms', 2, F);
    alerts.setOpenCount('primer', 1, P);
    alerts.setOpenCount('forms', 0, F);
    alerts.setOpenCount('primer', 0, P);

    expect(calls).toEqual([
      ['setOverlayIcon', DOT, '2 open agent forms'],
      ['setOverlayIcon', DOT, '2 open agent forms, 1 open feature primer'],
      ['setOverlayIcon', DOT, '1 open feature primer'],
      ['setOverlayIcon', null, ''],
    ]);
  });
});
