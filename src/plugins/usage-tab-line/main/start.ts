import type {
  ChannelShape,
  MainApi,
  MainPart,
} from '../../../contracts/plugin';
import { usageTabLineManifest } from '../manifest';
import { registerDemoSteps } from './demo-steps';

type UsageTabLineApi = MainApi<typeof usageTabLineManifest, ChannelShape>;

// Registers the tab line demo step's main half; the plugin keeps nothing in
// main.
export const usageTabLineMainPart: MainPart<typeof usageTabLineManifest> = {
  manifest: usageTabLineManifest,
  start(api: UsageTabLineApi) {
    registerDemoSteps(api.services);
    return { commands: {} };
  },
};
