import type { Disposable } from '../../../contracts/disposable';
import type { MainServices } from '../../../contracts/plugin';

// The Stash step's main half: the session the note dialog stashes.
export function registerDemoSteps(services: MainServices): Disposable {
  return services.demoSteps.register({
    id: 'session-stash.stash',
    async enter(context) {
      const session = await context.launchSession('Plan the next change.');
      return { sessions: { session }, dispose() {} };
    },
  });
}
