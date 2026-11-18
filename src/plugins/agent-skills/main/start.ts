import type {
  ChannelShape,
  MainApi,
  MainPart,
} from '../../../contracts/plugin';
import { chatMainKey } from '../../chat/contract';
import { sessionsMainKey } from '../../sessions/contract';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { agentSkillsManifest } from '../manifest';
import { registerDemoSteps } from './demo-steps';
import { agentSkillsSelfTestScript } from './selftest-script';

type AgentSkillsApi = MainApi<typeof agentSkillsManifest, ChannelShape>;

// Registers agent-skills' layouts and the Skills demo step's main half, and
// hands the self-test the list's script.
export const agentSkillsMainPart: MainPart<typeof agentSkillsManifest> = {
  manifest: agentSkillsManifest,
  start(api: AgentSkillsApi) {
    api.layouts.register({ layoutTypes });
    const { services } = api;
    const chat = api.dependency(chatMainKey);
    registerDemoSteps(services, { chat });
    services.selfTest?.run(
      agentSkillsSelfTestScript({
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
