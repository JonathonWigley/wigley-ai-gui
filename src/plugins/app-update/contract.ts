import type { ChannelShape } from '../../contracts/plugin';
import type { SlotKey } from '../../contracts/state';

// Where the installed app's update stands:
// - `none`: nothing to install, or nothing checked (the dev app, no clone);
// - `available`: origin's `main` holds commits the app was not built from, `sha` its short commit;
// - `installing`: `npm run install-app` runs, detached;
// - `failed`: the install ended with an error before quitting the app, `error` the last lines of its log.
export type AppUpdateStatus =
  | { kind: 'none' }
  | { kind: 'available'; sha: string }
  | { kind: 'installing' }
  | { kind: 'failed'; error: string };

// The update's status, which main writes at start and after each change.
export const appUpdateStatusSlot: SlotKey<
  AppUpdateStatus,
  'main',
  'app-update'
> = { id: 'app-update.status', process: 'main', kind: 'value' };

// The sample statuses the demo step shows.
export type DemoUpdateKind = 'available' | 'installing' | 'failed';

// `showDemoStatus` shows the demo step's sample status of `kind`; it throws while no demo step is entered.
export interface AppUpdateChannel extends ChannelShape {
  invoke: { showDemoStatus(kind: DemoUpdateKind): void };
  messages: Record<never, never>;
}
