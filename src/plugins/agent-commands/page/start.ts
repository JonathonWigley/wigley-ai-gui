import type {
  ChannelShape,
  PageApi,
  PagePart,
} from '../../../contracts/plugin';
import { sessionsPageKey } from '../../sessions/contract';
import { agentCommandsManifest } from '../manifest';
import { registerDemoSteps } from './demo-steps';

type AgentCommandsPageApi = PageApi<typeof agentCommandsManifest, ChannelShape>;

// Draws nothing: registers the page half of the `agent-commands.confirm` demo
// step, which shows its session through sessions' `activate`.
export const agentCommandsPagePart: PagePart<typeof agentCommandsManifest> = {
  manifest: agentCommandsManifest,
  start(api: AgentCommandsPageApi) {
    const sessions = api.dependency(sessionsPageKey);
    registerDemoSteps(api.services, {
      activate: (sessionId) => sessions.activate(sessionId),
    });
    return { commands: {} };
  },
};
