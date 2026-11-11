import type { DriveHost } from '../../../contracts/plugin';
import { argsObject } from '../../../shared/drive-args';
import type { AppUpdateStatus } from '../contract';

// `seed` swaps in the fixture build and clone, whose origin's main is one
// commit ahead, and an install that starts no program, then checks; `status`
// reads the slot.
export interface AppUpdateDriveDeps {
  seed(): Promise<AppUpdateStatus>;
  status(): AppUpdateStatus;
}

// `app-update.seed` and `app-update.status`.
export function addDriveActions(
  drive: DriveHost,
  deps: AppUpdateDriveDeps,
): void {
  drive.add('seed', {
    description:
      "Swaps in a fixture build whose origin's main is one commit ahead, and an install that starts no program (write install-exit-code in the plugin's data folder to end it), then checks; returns the status.",
    args: '{}',
    async run(rawArgs) {
      argsObject(rawArgs);
      return deps.seed();
    },
  });
  drive.add('status', {
    description: "Returns the update's status the title bar button draws.",
    args: '{}',
    async run(rawArgs) {
      argsObject(rawArgs);
      return deps.status();
    },
  });
}
