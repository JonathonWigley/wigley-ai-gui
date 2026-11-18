import { coreScopeSlot } from '../../../contracts/core-state';
import type {
  ChannelShape,
  PageApi,
  PagePart,
} from '../../../contracts/plugin';
import { sessionLogManifest } from '../manifest';
import { registerDemoSteps } from './demo-steps';

type SessionLogApi = PageApi<typeof sessionLogManifest, ChannelShape>;

// Registers the Recently closed demo step; the plugin has no surface.
export const sessionLogPagePart: PagePart<typeof sessionLogManifest> = {
  manifest: sessionLogManifest,
  start(api: SessionLogApi) {
    const { services } = api;
    registerDemoSteps(services, {
      runCommand: (id) => void api.commands.run(id),
      scope: api.state.read(coreScopeSlot),
      timers: services.timers,
      log: services.log,
    });
    return { commands: {} };
  },
};
