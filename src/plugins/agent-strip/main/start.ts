import type {
  ChannelShape,
  MainApi,
  MainPart,
} from '../../../contracts/plugin';
import { chatMainKey } from '../../chat/contract';
import { sessionsMainKey } from '../../sessions/contract';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { agentStripManifest } from '../manifest';
import { agentStripSelfTestScript } from './selftest-script';

type AgentStripApi = MainApi<typeof agentStripManifest, ChannelShape>;

// Registers agent-strip's layouts and hands the self-test the strip's script.
export const agentStripMainPart: MainPart<typeof agentStripManifest> = {
  manifest: agentStripManifest,
  start(api: AgentStripApi) {
    api.layouts.register({ layoutTypes });
    const { services } = api;
    services.selfTest?.run(
      agentStripSelfTestScript({
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
