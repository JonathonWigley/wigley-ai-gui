import { Notification } from 'electron';
import type { Alerts } from '../../contracts/alerts';
import type { Log } from '../../contracts/log';
import { createOpenCounts } from './open-counts';

// What an OS does beside its notifications.
export interface AttentionAndBadge {
  // For when no notification can show: unsigned macOS builds emit `failed`.
  drawAttention(): void;
  showOpenCount(total: number): void;
}

export function createElectronAlerts(
  attention: AttentionAndBadge,
  log: Log,
): Alerts {
  // A notification nothing references is collected, and its click never fires.
  const shown = new Set<Notification>();
  const openCounts = createOpenCounts();
  return {
    announce(title, body, onClick) {
      if (!Notification.isSupported()) {
        attention.drawAttention();
        return;
      }
      const notification = new Notification({ title, body });
      shown.add(notification);
      notification.on('click', () => {
        shown.delete(notification);
        onClick();
      });
      // On Windows a toast that times out moves to the Action Center, where it can still be clicked.
      notification.on('close', (event) => {
        if (event.reason !== 'timedOut') {
          shown.delete(notification);
        }
      });
      notification.on('failed', (_event, error) => {
        shown.delete(notification);
        log('alerts', `notification failed: ${error}`);
        attention.drawAttention();
      });
      notification.show();
    },
    setOpenCount(source, count) {
      attention.showOpenCount(openCounts.set(source, count));
    },
  };
}

// Notifications alone: no attention call and no badge.
export function createPlainAlerts(log: Log): Alerts {
  return createElectronAlerts({ drawAttention() {}, showOpenCount() {} }, log);
}
