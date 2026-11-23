import type { Disposable } from '../../../contracts/disposable';
import type { MainServices } from '../../../contracts/plugin';
import { callEach } from '../../../shared/call-each';
import { sampleSessionStep } from '../contract';

// The main halves of the Workflow step and the four sample workflows' steps:
// one demo session each, which opens no flow.
export function registerDemoSteps(services: MainServices): Disposable {
  const registered = [
    sampleSessionStep('workflow.engine', 'Workflow'),
    sampleSessionStep('workflow.small', 'Small workflow'),
    sampleSessionStep('workflow.medium', 'Medium workflow'),
    sampleSessionStep('workflow.spike', 'Spike workflow'),
    sampleSessionStep('workflow.large', 'Large workflow'),
  ].map((step) => services.demoSteps.register(step));
  return {
    dispose: () => callEach(registered, (each) => each.dispose()),
  };
}
