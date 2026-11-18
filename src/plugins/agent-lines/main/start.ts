import type {
  ChannelShape,
  MainApi,
  MainPart,
} from '../../../contracts/plugin';
import { chatMainKey } from '../../chat/contract';
import { sessionsMainKey } from '../../sessions/contract';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { agentLinesManifest } from '../manifest';
import { registerDemoSteps } from './demo-steps';
import { agentLinesSelfTestScript } from './selftest-script';

type AgentLinesApi = MainApi<typeof agentLinesManifest, ChannelShape>;

// Registers agent-lines' layouts and its demo step's main half, and hands the
// self-test the lines' script.
export const agentLinesMainPart: MainPart<typeof agentLinesManifest> = {
  manifest: agentLinesManifest,
  start(api: AgentLinesApi) {
    api.layouts.register({ layoutTypes });
    registerDemoSteps(api.services);
    const { services } = api;
    services.selfTest?.run(
      agentLinesSelfTestScript({
        homeDir: services.homeDir,
        files: services.files,
        paths: services.paths,
        chat: api.dependency(chatMainKey),
        sessions: api.dependency(sessionsMainKey),
      }),
    );
    return { commands: {} };
  },
};
