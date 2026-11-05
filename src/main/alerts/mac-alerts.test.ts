import { describe, expect, it, vi } from 'vitest';
import { createMacAlerts } from './mac-alerts';

const electron = vi.hoisted(() => ({
  app: { dock: { bounce: vi.fn() }, setBadgeCount: vi.fn() },
  Notification: { isSupported: () => false },
}));
vi.mock('electron', () => electron);

describe('createMacAlerts', () => {
  it('announce_NotificationUnsupported_BouncesTheDock', () => {
    createMacAlerts(vi.fn()).announce('title', 'body', vi.fn());

    expect(electron.app.dock.bounce).toHaveBeenCalledWith('informational');
  });

  it('setOpenCount_TwoSources_BadgesTheSum', () => {
    const alerts = createMacAlerts(vi.fn());

    alerts.setOpenCount('forms', 2);
    alerts.setOpenCount('primer', 3);

    expect(electron.app.setBadgeCount).toHaveBeenLastCalledWith(5);
  });
});
