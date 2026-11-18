import type { MainPart } from '../../../contracts/plugin';
import { chatMainKey } from '../../chat/contract';
import { sessionsMainKey } from '../../sessions/contract';
import { workflowMainKey } from '../../workflow/contract';
import { workflowSmallManifest } from '../manifest';
import { smallMainWorkflow } from '../stages';
import { registerDemoSteps } from './demo-steps';
import { workflowSmallSelfTestScript } from './selftest-script';

// Small's main half on the engine: its stages, its layouts' types, its self-test
// and its demo step's session.
export const workflowSmallMainPart: MainPart<typeof workflowSmallManifest> = {
  manifest: workflowSmallManifest,
  start(api) {
    const { services } = api;
    const workflow = api.dependency(workflowMainKey);
    api.layouts.register({ layoutTypes: workflow.layoutTypes });
    workflow.addWorkflow(smallMainWorkflow);
    registerDemoSteps(services);

    if (services.selfTest !== null && workflow.selfTestHooks !== null) {
      services.selfTest.run(
        workflowSmallSelfTestScript({
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
