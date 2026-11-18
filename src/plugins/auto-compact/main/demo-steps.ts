import type { AgentHarnessRegistry } from '../../../contracts/agent';
import { DEMO_HARNESS_ID } from '../../../contracts/demo';
import type { Disposable } from '../../../contracts/disposable';
import type { MainServices } from '../../../contracts/plugin';
import {
  FAKE_COLD_TEXT,
  type FakeAgentHarness,
  isFakeAgentHarness,
} from '../../../shared/fake-agent-harness';
import { createRegistrations } from '../../../shared/registrations';
import type { ChatMainExports } from '../../chat/contract';

export interface AutoCompactDemoMainDeps {
  chat: Pick<ChatMainExports, 'send'>;
  harnesses: AgentHarnessRegistry;
  onTurnFinished(
    listener: (finished: { sessionId: string; how: 'idle' | 'rested' }) => void,
  ): Disposable;
}

const CARRY_ON = { text: 'Carry on with the plan.', images: [] };

// Counts the turns each session finished idle, from the moment it is made.
// `idle(id, n)` resolves once session `id` finished `n` or more idle turns.
function idleTurnCounter(deps: Pick<AutoCompactDemoMainDeps, 'onTurnFinished'>) {
  const counts = new Map<string, number>();
  const waits: { sessionId: string; count: number; resolve(): void }[] = [];
  const subscription = deps.onTurnFinished(({ sessionId, how }) => {
    if (how !== 'idle') {
      return;
    }
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
      new Promise<void>((resolve) => {
        if ((counts.get(sessionId) ?? 0) >= count) {
          resolve();
          return;
        }
        waits.push({ sessionId, count, resolve });
      }),
    dispose: () => subscription.dispose(),
  };
}

// The auto compact step's main half: `compacted`, a cold session whose next
// send the gate held and compacted, its compaction ended before compactions
// are held; `held`, the same with its compaction held open; `cold`, a cold
// session nothing was sent to. The stage releases the held compactions.
export function registerDemoSteps(
  services: MainServices,
  deps: AutoCompactDemoMainDeps,
): Disposable {
  const registrations = createRegistrations();
  registrations.track(
    services.demoSteps.register({
      id: 'auto-compact.compact',
      async enter(context) {
        const turns = idleTurnCounter(deps);
        let heldHarness: FakeAgentHarness | null = null;
        const dispose = () => {
          heldHarness?.releaseCompactions();
          heldHarness = null;
          turns.dispose();
        };
        try {
          const compacted = await context.launchSession(FAKE_COLD_TEXT);
          await turns.idle(compacted, 1);
          await deps.chat.send(compacted, CARRY_ON);
          // `send` resolves as the gate starts the compaction; the second idle
          // finish comes after it ended.
          await turns.idle(compacted, 2);
          const harness = deps.harnesses.get(DEMO_HARNESS_ID);
          if (harness !== null && isFakeAgentHarness(harness)) {
            harness.holdCompactions();
            heldHarness = harness;
          } else {
            services.log('demo compact: no demo harness to hold');
          }
          const held = await context.launchSession(FAKE_COLD_TEXT);
          await turns.idle(held, 1);
          await deps.chat.send(held, CARRY_ON);
          const cold = await context.launchSession(FAKE_COLD_TEXT);
          return { sessions: { compacted, held, cold }, dispose };
        } catch (error) {
          dispose();
          throw error;
        }
      },
    }),
  );
  return registrations;
}
