import type {
  ChannelShape,
  MainApi,
  MainPart,
} from '../../../contracts/plugin';
import type { ChatMainExports } from '../../chat/contract';
import type { SessionsMainExports } from '../../sessions/contract';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { agentLinesManifest } from '../manifest';
import { agentLinesSelfTestScript } from './selftest-script';

type AgentLinesApi = MainApi<typeof agentLinesManifest, ChannelShape>;

// Registers agent-lines' layouts and hands the self-test the lines' script.
export const agentLinesMainPart: MainPart<typeof agentLinesManifest> = {
  manifest: agentLinesManifest,
  start(api: AgentLinesApi) {
    const layouts = api.layouts.register({ layoutTypes });
    const { services } = api;
    services.selfTest?.run(
      agentLinesSelfTestScript({
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
