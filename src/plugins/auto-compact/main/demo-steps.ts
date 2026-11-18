import type { Timers } from '../../../contracts/ambient';
import type { Disposable } from '../../../contracts/disposable';
import type { MainServices } from '../../../contracts/plugin';
import { FAKE_COLD_TEXT } from '../../../shared/fake-agent-harness';
import { createRegistrations } from '../../../shared/registrations';
import type { ChatMainExports } from '../../chat/contract';

export interface AutoCompactDemoMainDeps {
  chat: Pick<ChatMainExports, 'send'>;
  onTurnFinished(
    listener: (finished: { sessionId: string; how: 'idle' | 'rested' }) => void,
  ): Disposable;
}

const CARRY_ON = { text: 'Carry on with the plan.', images: [] };
// How long the step waits on one session's turn to finish.
export const TURN_WAIT_MS = 15_000;

// Counts the turns each session finished, idle or rested, from the moment it
// is made. `idle(id, n)` resolves once session `id` finished `n` or more
// turns, and rejects once it has not after `TURN_WAIT_MS`.
function idleTurnCounter(
  deps: Pick<AutoCompactDemoMainDeps, 'onTurnFinished'>,
  timers: Timers,
) {
  const counts = new Map<string, number>();
  const waits: { sessionId: string; count: number; resolve(): void }[] = [];
  const subscription = deps.onTurnFinished(({ sessionId }) => {
    const count = (counts.get(sessionId) ?? 0) + 1;
    counts.set(sessionId, count);
    for (const wait of waits.filter(
      (candidate) =>
        candidate.sessionId === sessionId && candidate.count <= count,
    )) {
      waits.splice(waits.indexOf(wait), 1);
      wait.resolve();
    }
  });
  return {
    idle: (sessionId: string, count: number) =>
      new Promise<void>((resolve, reject) => {
        if ((counts.get(sessionId) ?? 0) >= count) {
          resolve();
          return;
        }
        const wait = {
          sessionId,
          count,
          resolve() {
            timers.clear(timer);
            resolve();
          },
        };
        const timer = timers.set(() => {
          waits.splice(waits.indexOf(wait), 1);
          reject(
            new Error(`Session ${sessionId} did not finish turn ${count}.`),
          );
        }, TURN_WAIT_MS);
        waits.push(wait);
      }),
    dispose: () => subscription.dispose(),
  };
}

// The auto compact step's main half: `compacted`, a cold session whose next
// send the gate held and compacted; `cold`, a cold session nothing was sent to.
export function registerDemoSteps(
  services: MainServices,
  deps: AutoCompactDemoMainDeps,
): Disposable {
  const registrations = createRegistrations();
  registrations.track(
    services.demoSteps.register({
      id: 'auto-compact.compact',
      async enter(context) {
        const turns = idleTurnCounter(deps, services.timers);
        const dispose = () => turns.dispose();
        try {
          const compacted = await context.launchSession(FAKE_COLD_TEXT);
          await turns.idle(compacted, 1);
          await deps.chat.send(compacted, CARRY_ON);
          // `send` resolves as the gate starts the compaction; the second idle
          // finish comes after it ended.
          await turns.idle(compacted, 2);
          const cold = await context.launchSession(FAKE_COLD_TEXT);
          return { sessions: { compacted, cold }, dispose };
        } catch (error) {
          dispose();
          throw error;
        }
      },
    }),
  );
  return registrations;
}
