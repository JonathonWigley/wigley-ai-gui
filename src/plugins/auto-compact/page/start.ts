import type {
  ChannelShape,
  PageApi,
  PagePart,
} from '../../../contracts/plugin';
import { sessionsPageKey } from '../../sessions/contract';
import { autoCompactManifest } from '../manifest';
import { registerDemoSteps } from './demo-steps';

type AutoCompactApi = PageApi<typeof autoCompactManifest, ChannelShape>;

// Draws nothing: registers the auto compact demo step, which shows its
// sessions through sessions' `activate`.
export const autoCompactPagePart: PagePart<typeof autoCompactManifest> = {
  manifest: autoCompactManifest,
  start(api: AutoCompactApi) {
    const sessions = api.dependency(sessionsPageKey);
    registerDemoSteps(api.services, {
      activate: (sessionId) => sessions.activate(sessionId),
    });
    return { commands: {} };
  },
};
