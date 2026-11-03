import type {
  ChannelShape,
  PageApi,
  PagePart,
} from '../../../contracts/plugin';
import type { SessionsPageExports } from '../../sessions/contract';
import type { UsagePageExports } from '../../usage/contract';
import { usageTabLineManifest } from '../manifest';

type UsageTabLineApi = PageApi<typeof usageTabLineManifest, ChannelShape>;

// Adds usage's session line to every session's tab bar as a sessions bar part,
// logging its lines under `usage-tab-line`.
export const usageTabLinePagePart: PagePart<typeof usageTabLineManifest> = {
  manifest: usageTabLineManifest,
  start(api: UsageTabLineApi) {
    const { services } = api;
    const usage = api.dependency<UsagePageExports>('usage');
    const sessions = api.dependency<SessionsPageExports>('sessions');
    sessions.addBarPart(
      usage.sessionLinePart('usage-tab-line.sessionLine', (line) =>
        services.log('usage-tab-line', line),
      ),
    );
    return { commands: {} };
  },
};
