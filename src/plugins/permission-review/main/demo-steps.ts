import type { Disposable } from '../../../contracts/disposable';
import type { MainServices } from '../../../contracts/plugin';
import { FAKE_PERMISSION_TEXT } from '../../../shared/fake-agent-harness';

// The verdict step's main half: a session whose fake turn asks permission for
// a Bash call, which the demo harness's ask reviews with its default reply.
export function registerDemoSteps(services: MainServices): Disposable {
  return services.demoSteps.register({
    id: 'permission-review.verdict',
    async enter(context) {
      const session = await context.launchSession(FAKE_PERMISSION_TEXT);
      return { sessions: { session }, dispose() {} };
    },
  });
}
