import type {
  ChannelShape,
  MainApi,
  MainPart,
} from '../../../contracts/plugin';
import type { ChatMainExports } from '../../chat/contract';
import type { SessionsMainExports } from '../../sessions/contract';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { agentStripManifest } from '../manifest';
import { agentStripSelfTestScript } from './selftest-script';

type AgentStripApi = MainApi<typeof agentStripManifest, ChannelShape>;

// Registers agent-strip's layouts and hands the self-test the strip's script.
export const agentStripMainPart: MainPart<typeof agentStripManifest> = {
  manifest: agentStripManifest,
  start(api: AgentStripApi) {
    const layouts = api.layouts.register({ layoutTypes });
    const { services } = api;
    services.selfTest?.run(
      agentStripSelfTestScript({
        homeDir: services.homeDir,
        files: services.files,
        paths: services.paths,
        chat: api.dependency<ChatMainExports>('chat'),
        sessions: api.dependency<SessionsMainExports>('sessions'),
      }),
    );
    return { commands: {}, dispose: () => layouts.dispose() };
  },
};
