import type { Disposable } from '../../../contracts/disposable';
import type { MainServices } from '../../../contracts/plugin';
import { FAKE_CONTEXT_TEXT } from '../../../shared/fake-agent-harness';

// The Context step's main half: a session whose fake turn reports a context
// breakdown.
export function registerDemoSteps(services: MainServices): Disposable {
  return services.demoSteps.register({
    id: 'context-sources.context',
    async enter(context) {
      const session = await context.launchSession(FAKE_CONTEXT_TEXT);
      return { sessions: { session }, dispose() {} };
    },
  });
}
