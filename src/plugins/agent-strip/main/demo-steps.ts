import type { Disposable } from '../../../contracts/disposable';
import type { MainServices } from '../../../contracts/plugin';
import { FAKE_AGENTS_TEXT } from '../../../shared/fake-agent-harness';
import { createRegistrations } from '../../../shared/registrations';

// The agent strip step's main half: one demo session running subagents.
export function registerDemoSteps(services: MainServices): Disposable {
  const registrations = createRegistrations();
  registrations.track(
    services.demoSteps.register({
      id: 'agent-strip.strip',
      enter: async (context) => ({
        sessions: { agents: await context.launchSession(FAKE_AGENTS_TEXT) },
        dispose() {},
      }),
    }),
  );
  return registrations;
}
