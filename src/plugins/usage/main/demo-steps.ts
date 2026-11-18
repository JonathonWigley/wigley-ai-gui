import type { Clock } from '../../../contracts/ambient';
import type { Disposable } from '../../../contracts/disposable';
import type { MainServices } from '../../../contracts/plugin';
import type { UsageSnapshot } from '../contract';
import { usageFixture } from './usage-fixture';

// `showSample` shows a snapshot in `usage.snapshot` over the real one until
// the handle's dispose.
export interface UsageDemoMainDeps {
  clock: Clock;
  showSample(sample: UsageSnapshot): Disposable;
}

// The Usage step's main half: a session, and the fixture's plans and that
// session's usage shown in place of the user's.
export function registerDemoSteps(
  services: MainServices,
  deps: UsageDemoMainDeps,
): Disposable {
  return services.demoSteps.register({
    id: 'usage.meters',
    async enter(context) {
      const session = await context.launchSession('Plan the next change.');
      const sample = deps.showSample(
        usageFixture('fresh', deps.clock.now(), session),
      );
      return { sessions: { session }, dispose: () => sample.dispose() };
    },
  });
}
