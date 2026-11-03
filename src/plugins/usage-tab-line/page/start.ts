import type {
  ChannelShape,
  PageApi,
  PagePart,
} from '../../../contracts/plugin';
import { sessionsPageKey } from '../../sessions/contract';
import { usagePageKey } from '../../usage/contract';
import { usageTabLineManifest } from '../manifest';

type UsageTabLineApi = PageApi<typeof usageTabLineManifest, ChannelShape>;

// Adds usage's session line to every session's tab bar as a sessions bar part,
// logging its lines under `usage-tab-line`.
export const usageTabLinePagePart: PagePart<typeof usageTabLineManifest> = {
  manifest: usageTabLineManifest,
  start(api: UsageTabLineApi) {
    const { services } = api;
    const usage = api.dependency(usagePageKey);
    const sessions = api.dependency(sessionsPageKey);
    sessions.addBarPart(
      usage.sessionLinePart('usage-tab-line.sessionLine', services.log),
    );
    return { commands: {} };
  },
};
