import type { Disposable } from '../../../contracts/disposable';
import type { MainServices } from '../../../contracts/plugin';
import type { StatsSnapshot } from '../contract';
import { statsFixture } from './stats-fixture';

export interface SystemStatsDemoDeps {
  // A snapshot holds the slot over real readings; null hands it back to them.
  setDemo(snapshot: StatsSnapshot | null): void;
}

// The main half of step `system-stats.panel`: holds the busy fixture in the
// slot until the stage is disposed, so the user's own processes never show.
export function registerDemoSteps(
  services: MainServices,
  deps: SystemStatsDemoDeps,
): Disposable {
  return services.demoSteps.register({
    id: 'system-stats.panel',
    async enter() {
      deps.setDemo(statsFixture('busy', services.clock.now()));
      return { sessions: {}, dispose: () => deps.setDemo(null) };
    },
  });
}
