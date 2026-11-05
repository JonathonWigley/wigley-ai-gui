import type { PageApi, PagePart } from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import type { AgentsChannel } from '../contract';
import { agentsManifest } from '../manifest';

type AgentsApi = PageApi<typeof agentsManifest, AgentsChannel>;

// Draws nothing and holds nothing: `openPreview` asks main for agents' sample
// session.
export const agentsPagePart: PagePart<typeof agentsManifest> = {
  manifest: agentsManifest,
  start(api: AgentsApi) {
    const { services } = api;

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
