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

describe('practice demo step', () => {
  it('sampleProblemOpened_DuringStep_LeavesSavedPlace', async () => {
    const written: string[] = [];
    const place = placeWrites((value: string) => written.push(value));
    const step = registeredStep((services) =>
      registerDemoSteps(services, {
        commands: { run: async () => undefined } as never,
        openProblemRow: () => undefined,
        holdPlace: () => place.hold(),
        saveDrafts: async () => undefined,
      }),
    );

    const stage = await step.enter({ scratchDir: '/scratch', sessions: {} });
    place.write('two-sum');
    await stage.dispose();
    place.write('user problem');

    expect(written).toEqual(['user problem']);
  });

  it('leave_PendingSampleDraft_SavesBeforeTheStepEnds', async () => {
    const events: string[] = [];
    const step = registeredStep((services) =>
      registerDemoSteps(services, {
        commands: { run: async () => undefined } as never,
        openProblemRow: () => undefined,
        holdPlace: () => ({ dispose: () => events.push('place released') }),
        saveDrafts: async () => {
          await Promise.resolve();
          events.push('drafts saved');
        },
      }),
    );

    const stage = await step.enter({ scratchDir: '/scratch', sessions: {} });
    await stage.dispose();

    expect(events).toEqual(['drafts saved', 'place released']);
  });
});
