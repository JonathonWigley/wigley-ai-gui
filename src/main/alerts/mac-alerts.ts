import { app } from 'electron';
import type { Alerts } from '../../contracts/alerts';
import type { Log } from '../../contracts/log';
import { createElectronAlerts } from './electron-alerts';

// Notifications, a Dock bounce and the Dock badge.
export function createMacAlerts(log: Log): Alerts {
  return createElectronAlerts(
    {
      drawAttention() {
        app.dock?.bounce('informational');
      },
      showOpenCount(total) {
        app.setBadgeCount(total);
      },
    },
    log,
  );
}
