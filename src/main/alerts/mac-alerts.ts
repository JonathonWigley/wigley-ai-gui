import { app } from 'electron';
import type { Alerts } from '../../contracts/alerts';
import { createOpenCounts } from './open-counts';

// The Dock badge.
export function createMacAlerts(): Alerts {
  const openCounts = createOpenCounts();
  return {
    setOpenCount(source, count, noun) {
      app.setBadgeCount(openCounts.set(source, count, noun).total);
    },
  };
}
