import type { Disposable } from '../../../contracts/disposable';
import type { MainServices } from '../../../contracts/plugin';
import { sampleSessionStep } from '../contract';

// The Workflow step's main half: one demo session, which opens no flow.
export function registerDemoSteps(services: MainServices): Disposable {
  return services.demoSteps.register(
    sampleSessionStep('workflow.engine', 'Workflow'),
  );
}
