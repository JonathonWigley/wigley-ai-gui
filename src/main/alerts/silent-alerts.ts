import type { Alerts } from '../../contracts/alerts';

// For the offscreen self-test, which must never reach the user.
export const silentAlerts: Alerts = {
  announce: () => {},
  setOpenCount: () => {},
};
