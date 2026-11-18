import type { Disposable } from '../../../contracts/disposable';
import type { MainServices } from '../../../contracts/plugin';
import { createRegistrations } from '../../../shared/registrations';
import type { DocsMainExports } from '../contract';

export interface DocsDemoMainDeps {
  addSampleDocs: DocsMainExports['addSampleDocs'];
}

// The Docs steps' main halves: each holds the sample docs for its length, and
// the Docs tab step also launches the demo session whose tab shows them.
export function registerDemoSteps(
  services: MainServices,
  deps: DocsDemoMainDeps,
): Disposable {
  const registrations = createRegistrations();
  registrations.track(
    services.demoSteps.register({
      id: 'docs.mode',
      async enter(context) {
        const sample = await deps.addSampleDocs(context.scratchDir);
        return { sessions: {}, dispose: () => sample.dispose() };
      },
    }),
  );
  registrations.track(
    services.demoSteps.register({
      id: 'docs.sessionTab',
      async enter(context) {
        const sample = await deps.addSampleDocs(context.scratchDir);
        try {
          const session = await context.launchSession(
            'Which docs does this session read?',
          );
          return { sessions: { session }, dispose: () => sample.dispose() };
        } catch (error) {
          sample.dispose();
          throw error;
        }
      },
    }),
  );
  return registrations;
}
