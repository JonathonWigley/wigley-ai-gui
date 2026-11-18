import type { MainPart } from '../../../contracts/plugin';
import { chatMainKey } from '../../chat/contract';
import { sessionsMainKey } from '../../sessions/contract';
import { workflowMainKey } from '../../workflow/contract';
import { workflowSpikeManifest } from '../manifest';
import { spikeMainWorkflow } from '../stages';
import { registerDemoSteps } from './demo-steps';
import { workflowSpikeSelfTestScript } from './selftest-script';

// Spike's main half on the engine: its stages, its layouts' types, its self-test
// and its demo step's session.
export const workflowSpikeMainPart: MainPart<typeof workflowSpikeManifest> = {
  manifest: workflowSpikeManifest,
  start(api) {
    const { services } = api;
    const workflow = api.dependency(workflowMainKey);
    api.layouts.register({ layoutTypes: workflow.layoutTypes });
    workflow.addWorkflow(spikeMainWorkflow);
    registerDemoSteps(services);

    if (services.selfTest !== null && workflow.selfTestHooks !== null) {
      services.selfTest.run(
        workflowSpikeSelfTestScript({
          homeDir: services.homeDir,
          files: services.files,
          paths: services.paths,
          chat: api.dependency(chatMainKey),
          sessions: api.dependency(sessionsMainKey),
          harnesses: services.agentHarnesses,
          hooks: workflow.selfTestHooks,
        }),
      );
    }

    return { commands: {} };
  },
};
