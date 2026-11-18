import type {
  ChannelShape,
  MainApi,
  MainPart,
} from '../../../contracts/plugin';
import { chatMainKey } from '../../chat/contract';
import { sessionsMainKey } from '../../sessions/contract';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { agentStripManifest } from '../manifest';
import { registerDemoSteps } from './demo-steps';
import { agentStripSelfTestScript } from './selftest-script';

type AgentStripApi = MainApi<typeof agentStripManifest, ChannelShape>;

// Every session chat starts carries it, so a task row's title reads whole.
const SHELL_TITLE_INSTRUCTION =
  'The Auri app titles each running shell command with the description you give its tool call, cut at 30 characters. Give every shell call a description of 2 to 4 words, at most 30 characters, that names the job like a heading ("Run Chat Tests", "Watch the Build"), not the command or a sentence.';

// Registers agent-strip's layouts and its demo step's main half, hands chat the
// shell title instruction and hands the self-test the strip's script.
export const agentStripMainPart: MainPart<typeof agentStripManifest> = {
  manifest: agentStripManifest,
  start(api: AgentStripApi) {
    api.layouts.register({ layoutTypes });
    registerDemoSteps(api.services);
    const { services } = api;
    const chat = api.dependency(chatMainKey);
    chat.addInstructions(SHELL_TITLE_INSTRUCTION);
    services.selfTest?.run(
      agentStripSelfTestScript({
        homeDir: services.homeDir,
        files: services.files,
        paths: services.paths,
        chat,
        sessions: api.dependency(sessionsMainKey),
      }),
    );
    return { commands: {} };
  },
};
