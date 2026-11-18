import { describe, expect, it } from 'vitest';
import type { DemoMainContext, DemoMainStep } from '../../../contracts/demo';
import type { MainServices } from '../../../contracts/plugin';
import { createDemoStepRegistry } from '../../../shared/demo-step-registry';
import { registerDemoSteps } from './demo-steps';

type TurnListener = (finished: {
  sessionId: string;
  how: 'idle' | 'rested';
}) => void;

// The auto compact step's main half over fakes: `launchSession` hands out
// `c1`, `c2`, …; `finish` ends a session's turn; `fireTimers` runs the timers
// set so far; `sent` holds each session sent to.
async function startCompactStep() {
  const registry = createDemoStepRegistry<DemoMainStep>();
  const due: (() => void)[] = [];
  const sent: string[] = [];
  let listener: TurnListener = () => undefined;
  let launched = 0;
  registerDemoSteps(
    {
      demoSteps: registry,
      timers: {
        set(run: () => void) {
          due.push(run);
          return due.length;
        },
        clear: () => undefined,
      },
      log: () => undefined,
    } as unknown as MainServices,
    {
      chat: {
        async send(sessionId) {
          sent.push(sessionId);
        },
      },
      onTurnFinished(heard) {
        listener = heard;
        return { dispose() {} };
      },
    },
  );
  const [step] = registry.list();
  const context = {
    scratchDir: '/scratch',
    async launchSession() {
      launched += 1;
      return `c${launched}`;
    },
  } as unknown as DemoMainContext;
  const entered = step.enter(context);
  entered.catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 0));
  return {
    entered,
    sent,
    finish: (sessionId: string, how: 'idle' | 'rested') =>
      listener({ sessionId, how }),
    fireTimers: () => {
      for (const run of due.splice(0)) {
        run();
      }
    },
  };
}

describe('auto-compact demo steps', () => {
  // Breaks on a wait that hears only idle ends, so a rested turn hangs the
  // step, or one with no time limit, so a turn that never ends locks the demo.
  it.each([
    { name: 'a rested end', rests: true, sent: ['c1'] },
    { name: 'no end before the time limit', rests: false, sent: [] },
  ])('compact_FirstTurnWait_ByEnd ($name)', async ({ rests, sent }) => {
    const step = await startCompactStep();

    if (rests) {
      step.finish('c1', 'rested');
    } else {
      step.fireTimers();
      await expect(step.entered).rejects.toThrow(
        'Session c1 did not finish turn 1.',
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(step.sent).toEqual(sent);
  });
});
