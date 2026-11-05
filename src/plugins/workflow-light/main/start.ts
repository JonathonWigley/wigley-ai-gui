import type { MainPart } from '../../../contracts/plugin';
import { chatMainKey } from '../../chat/contract';
import { sessionsMainKey } from '../../sessions/contract';
import { workflowMainKey } from '../../workflow/contract';
import { workflowLightManifest } from '../manifest';
import { lightMainWorkflow } from '../stages';
import { workflowLightSelfTestScript } from './selftest-script';

// Light's main half on the engine: its stages, its layouts' types and its self-test.
export const workflowLightMainPart: MainPart<typeof workflowLightManifest> = {
  manifest: workflowLightManifest,
  start(api) {
    const { services } = api;
    const workflow = api.dependency(workflowMainKey);
    api.layouts.register({ layoutTypes: workflow.layoutTypes });
    workflow.addWorkflow(lightMainWorkflow);

    if (services.selfTest !== null && workflow.selfTestHooks !== null) {
      services.selfTest.run(
        workflowLightSelfTestScript({
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
