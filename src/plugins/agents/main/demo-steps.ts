import type { Clock } from '../../../contracts/ambient';
import type { Disposable } from '../../../contracts/disposable';
import type { MainServices } from '../../../contracts/plugin';
import type { KeyedSlotWriter } from '../../../contracts/state';
import { createRegistrations } from '../../../shared/registrations';
import type { Roster } from '../contract';
import { sampleRoster } from './preview';

export interface AgentsDemoMainDeps {
  clock: Clock;
  rosters: Pick<KeyedSlotWriter<Roster>, 'set' | 'delete'>;
  // Keeps the session's `agents.rosters` key out of the agent-event fold until
  // the dispose.
  holdSample(sessionId: string): Disposable;
}

// The roster step's main half: one demo session whose `agents.rosters` key
// holds the sample roster, held against the fold for the stage's length.
export function registerDemoSteps(
  services: MainServices,
  deps: AgentsDemoMainDeps,
): Disposable {
  const registrations = createRegistrations();
  registrations.track(
    services.demoSteps.register({
      id: 'agents.roster',
      async enter(context) {
        const session = await context.launchSession(
          'Map every caller of the session list.',
        );
        const hold = deps.holdSample(session);
        deps.rosters.set(session, sampleRoster(deps.clock.now()));
        return {
          sessions: { session },
          dispose() {
            deps.rosters.delete(session);
            hold.dispose();
          },
        };
      },
    }),
  );
  return registrations;
}
