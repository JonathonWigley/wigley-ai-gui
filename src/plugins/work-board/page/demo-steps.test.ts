import { describe, expect, it } from 'vitest';
import type { DemoStep } from '../../../contracts/demo';
import type { PageServices } from '../../../contracts/plugin';
import type { WorkState } from '../../work/contract';
import { registerDemoSteps } from './demo-steps';
import { SAMPLE_LOCAL_TASK, SAMPLE_SUGGESTION_CARD } from './sample-state';

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

describe('board demo step', () => {
  it('the Board step registers and its beats enter and dispose without throwing', async () => {
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
        selectCard: (id) => events.push(`card ${id}`),
        now: () => Date.parse('2026-11-23T12:00:00.000Z'),
      }),
    );

    const stage = await step.enter({ scratchDir: '/scratch', sessions: {} });
    for (const beat of stage.beats) {
      await beat.show();
    }
    await stage.dispose();

    expect(step.id).toBe('work-board.mode');
    expect(sample).not.toBeNull();
    expect(events).toEqual([
      'sample',
      'run work-board.main',
      `card ${SAMPLE_SUGGESTION_CARD}`,
      `card ${SAMPLE_LOCAL_TASK}`,
      'sample ended',
    ]);
  });
});
