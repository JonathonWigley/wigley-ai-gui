import type { MainApi, MainPart } from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import { createFakeAgentHarness } from '../../../shared/fake-agent-harness';
import { chatMainKey } from '../../chat/contract';
import { scopedAgentsMainKey } from '../../scoped-agents/contract';
import {
  type DemoChannel,
  type DemoStepBrief,
  demoRunSlot,
  STEP_AGENT_ID,
} from '../contract';
import { demoManifest } from '../manifest';
import { createDemoRun, PROFILE_FOLDER, SCRATCH_FOLDER } from './demo-run';
import { realSessionMainStep } from './real-session-step';
import {
  createStepAgentStore,
  stepAgentInstructions,
  stepAgentTitle,
} from './step-agent';

type DemoApi = MainApi<typeof demoManifest, DemoChannel>;

// Serves the page's run over the channel: the scratch and profile folders in
// plugin data, the unlisted demo harness on the fake agent harness, the
// plugin switch's hold, and each step's main half. Registers the step agent
// with scoped-agents, one per step id, in the app's own clone (the home
// folder when none resolves), its instructions built from the brief the page
// last described for the step and the `demo.run` slot. Registers the
// real-session step's main half. Stopping the part stops a live run.
export const demoMainPart: MainPart<typeof demoManifest> = {
  manifest: demoManifest,
  start(api: DemoApi) {
    const { services, channel } = api;
    const chat = api.dependency(chatMainKey);
    const run = createDemoRun({
      chat,
      harnesses: services.agentHarnesses,
      makeHarness: (identity) =>
        createFakeAgentHarness(
          services.clock,
          services.files,
          services.timers,
          identity,
        ),
      steps: services.demoSteps,
      pluginSwitch: services.pluginSwitch,
      data: api.data,
      scratchDir: services.paths.join(api.dataFolder, SCRATCH_FOLDER),
      profileDir: services.paths.join(api.dataFolder, PROFILE_FOLDER),
      log: services.log,
    });
    const briefs = new Map<string, DemoStepBrief>();
    const runSlot = api.state.read(demoRunSlot);
    const folder = services.cloneDir ?? services.homeDir;
    api.dependency(scopedAgentsMainKey).addScopedAgent({
      owner: demoManifest.id,
      agentId: STEP_AGENT_ID,
      folder: () => folder,
      instructions: async (scope) =>
        stepAgentInstructions(scope, briefs.get(scope), runSlot.get(), folder),
      title: async (scope) => stepAgentTitle(scope, briefs.get(scope)),
      store: createStepAgentStore(api.data, services.log),
    });
    services.demoSteps.register(realSessionMainStep(chat));
    channel.handle('start', () => run.start());
    channel.handle('enterStep', (stepId) => run.enterStep(stepId));
    channel.handle('leaveStep', (stepId) => run.leaveStep(stepId));
    channel.handle('describeStep', (brief) => {
      briefs.set(brief.id, brief);
    });
    channel.handle('stop', () => run.stop());
    return {
      commands: {},
      dispose: async () => {
        try {
          await run.stop();
        } catch (error) {
          services.log(`stop failed: ${errorText(error)}`);
        }
      },
    };
  },
};
