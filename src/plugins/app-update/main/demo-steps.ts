import type { Disposable } from '../../../contracts/disposable';
import type { MainServices } from '../../../contracts/plugin';
import type { AppUpdateStatus, DemoUpdateKind } from '../contract';
import { FIXTURE_ORIGIN_COMMIT } from './update-fixture';

export interface AppUpdateDemoDeps {
  // A status shows over the real one; null shows the real one again.
  setDemo(status: AppUpdateStatus | null): void;
}

// The sample status the demo step shows for `kind`.
export function demoStatus(kind: DemoUpdateKind): AppUpdateStatus {
  switch (kind) {
    case 'available':
      return { kind: 'available', sha: FIXTURE_ORIGIN_COMMIT.slice(0, 7) };
    case 'installing':
      return { kind: 'installing' };
    case 'failed':
      return { kind: 'failed', error: 'install-app exited with code 1' };
  }
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
      deps.setDemo(demoStatus('available'));
      return { sessions: {}, dispose: () => deps.setDemo(null) };
    },
  });
}
