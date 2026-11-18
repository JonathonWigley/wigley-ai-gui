import { describe, expect, it } from 'vitest';
import type { DemoStep } from '../../../contracts/demo';
import type { PageServices } from '../../../contracts/plugin';
import { placeWrites } from '../../../shared/page/place-slot';
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

describe('backlog demo step', () => {
  it('sampleRowSelected_DuringStep_LeavesSavedPlace', async () => {
    const written: string[] = [];
    const place = placeWrites((value: string) => written.push(value));
    const step = registeredStep((services) =>
      registerDemoSteps(services, {
        commands: { run: async () => undefined } as never,
        holdPlace: () => place.hold(),
      }),
    );

    const stage = await step.enter({ scratchDir: '/scratch', sessions: {} });
    place.write('sample row');
    await stage.dispose();
    place.write('user row');

    expect(written).toEqual(['user row']);
  });
});
