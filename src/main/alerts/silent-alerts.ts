import type { Alerts } from '../../contracts/alerts';

// For an OS with no icon badge, and the offscreen runs, which must never reach
// the user.
export const silentAlerts: Alerts = {
  setOpenCount: () => {},
};
