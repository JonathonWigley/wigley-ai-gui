import type { Disposable } from '../../../contracts/disposable';
import type { MainServices } from '../../../contracts/plugin';

// The main half of `notes.note`: a demo session for the sample note to name.
// It holds nothing to dispose; the demo closes the session.
export function registerDemoSteps(services: MainServices): Disposable {
  return services.demoSteps.register({
    id: 'notes.note',
    async enter(context) {
      const sessionId = await context.launchSession(
        'A sample session for the notes step.',
      );
      return { sessions: { session: sessionId }, dispose() {} };
    },
  });
}
