import { describe, expect, it } from 'vitest';
import type { DemoStep } from '../../../contracts/demo';
import type { PageServices } from '../../../contracts/plugin';
import type { WorkState } from '../../work/contract';
import { registerDemoSteps } from './demo-steps';

function registeredStep(register: (services: PageServices) => void): DemoStep {
  let step: DemoStep | null = null;
  register({
    demoSteps: {
      register(registered: DemoStep) {
        step = registered;
        return { dispose: () => undefined };
      },
    },
  } as unknown as PageServices);
  if (step === null) {
    throw new Error('no step registered');
  }
  return step;
}

describe('inbox demo step', () => {
  it('the Inbox step registers and its beats enter and dispose without throwing', async () => {
    const events: string[] = [];
    let sample: WorkState | null = null;
    const step = registeredStep((services) =>
      registerDemoSteps(services, {
        commands: {
          run: async (...args: unknown[]) => {
            events.push(`run ${String(args[1])}`);
          },
        } as never,
        showSample(state) {
          sample = state;
          events.push('sample');
          return { dispose: () => events.push('sample ended') };
        },
        selectSection: (id) => events.push(`section ${id}`),
        now: () => Date.parse('2026-11-23T12:00:00.000Z'),
      }),
    );

    const stage = await step.enter({ scratchDir: '/scratch', sessions: {} });
    for (const beat of stage.beats) {
      await beat.show();
    }
    await stage.dispose();

    expect(step.id).toBe('work-inbox.mode');
    expect(sample).not.toBeNull();
    expect(events).toEqual([
      'sample',
      'run work-inbox.main',
      'section needs_you',
      'section waiting',
      'section all',
      'sample ended',
    ]);
  });
});
