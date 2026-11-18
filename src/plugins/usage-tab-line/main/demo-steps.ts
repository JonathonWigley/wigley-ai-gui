import type { Disposable } from '../../../contracts/disposable';
import type { MainServices } from '../../../contracts/plugin';

// The tab line step's main half: a session whose echo turn reports usage, so
// its line reads a context.
export function registerDemoSteps(services: MainServices): Disposable {
  return services.demoSteps.register({
    id: 'usage-tab-line.line',
    async enter(context) {
      const session = await context.launchSession('Plan the next change.');
      return { sessions: { session }, dispose() {} };
    },
  });
}
