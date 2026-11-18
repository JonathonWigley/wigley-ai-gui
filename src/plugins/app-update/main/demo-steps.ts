import type { Disposable } from '../../../contracts/disposable';
import type { MainServices } from '../../../contracts/plugin';
import type { AppUpdateStatus } from '../contract';
import { FIXTURE_ORIGIN_COMMIT } from './update-fixture';

export interface AppUpdateDemoDeps {
  // A status shows over the real one; null shows the real one again.
  setDemo(status: AppUpdateStatus | null): void;
}

// The main half of step `app-update.button`: shows a sample update in the
// title bar until the stage is disposed.
export function registerDemoSteps(
  services: MainServices,
  deps: AppUpdateDemoDeps,
): Disposable {
  return services.demoSteps.register({
    id: 'app-update.button',
    async enter() {
      deps.setDemo({
        kind: 'available',
        sha: FIXTURE_ORIGIN_COMMIT.slice(0, 7),
      });
      return { sessions: {}, dispose: () => deps.setDemo(null) };
    },
  });
}
