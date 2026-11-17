import { describe, expect, it, vi } from 'vitest';
import { createMacAlerts } from './mac-alerts';

const electron = vi.hoisted(() => ({
  app: { setBadgeCount: vi.fn() },
}));
vi.mock('electron', () => electron);

describe('createMacAlerts', () => {
  it('setOpenCount_TwoSources_BadgesTheSum', () => {
    const alerts = createMacAlerts();

    alerts.setOpenCount('forms', 2, {
      singular: 'open agent form',
      plural: 'open agent forms',
    });
    alerts.setOpenCount('primer', 3, {
      singular: 'open feature primer',
      plural: 'open feature primers',
    });

    expect(electron.app.setBadgeCount).toHaveBeenLastCalledWith(5);
  });
});
