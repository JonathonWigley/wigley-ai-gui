import type { Disposable } from '../../../contracts/disposable';
import type { MainServices } from '../../../contracts/plugin';
import { FAKE_VISUAL_TEXT } from '../../../shared/fake-agent-harness';
import { createRegistrations } from '../../../shared/registrations';

// The visuals step's main half: one demo session whose agent writes visuals.
export function registerDemoSteps(services: MainServices): Disposable {
  const registrations = createRegistrations();
  registrations.track(
    services.demoSteps.register({
      id: 'visual.visuals',
      enter: async (context) => ({
        sessions: { visual: await context.launchSession(FAKE_VISUAL_TEXT) },
        dispose() {},
      }),
    }),
  );
  return registrations;
}
