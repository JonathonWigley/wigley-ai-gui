import type { Disposable } from '../../../contracts/disposable';
import type { MainServices } from '../../../contracts/plugin';
import { sampleSessionStep } from '../../workflow/contract';

// The Small workflow step's main half: one demo session, which opens no flow.
export function registerDemoSteps(services: MainServices): Disposable {
  return services.demoSteps.register(
    sampleSessionStep('workflow-small.run', 'Small workflow'),
  );
}
