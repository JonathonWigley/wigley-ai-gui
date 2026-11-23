import type { Disposable } from '../../../contracts/disposable';
import type { MainServices } from '../../../contracts/plugin';

// The main half of step `builds.session`: launches the demo session whose row, hub and composer the page half draws
// the sample builds and offer in, as session `build`. The sample lives in the page, so the stage holds nothing.
export function registerSessionDemoStep(services: MainServices): Disposable {
  return services.demoSteps.register({
    id: 'builds.session',
    async enter(context) {
      const rowId = await context.launchSession('Fix the jump arc');
      return { sessions: { build: rowId }, dispose() {} };
    },
  });
}
