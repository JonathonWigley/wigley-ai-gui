import type { PageApi, PagePart } from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import { sessionsPageKey } from '../../sessions/contract';
import type { AgentsChannel } from '../contract';
import { agentsManifest } from '../manifest';
import { registerDemoSteps } from './demo-steps';

type AgentsApi = PageApi<typeof agentsManifest, AgentsChannel>;

// Draws nothing and holds nothing: `openPreview` asks main for agents' sample
// session. Registers the roster demo step, which shows its session through
// sessions' `activate`.
export const agentsPagePart: PagePart<typeof agentsManifest> = {
  manifest: agentsManifest,
  start(api: AgentsApi) {
    const { services } = api;
    const sessions = api.dependency(sessionsPageKey);
    registerDemoSteps(services, {
      activate: (sessionId) => sessions.activate(sessionId),
    });

    return {
      commands: {
        openPreview: () =>
          void api.channel.invoke('openPreview').catch((error: unknown) => {
            services.log(`agents preview not opened: ${errorText(error)}`);
            services.toast(
              `Agents preview not opened: ${errorText(error)}`,
              'error',
            );
          }),
      },
    };
  },
};
