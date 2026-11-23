import type {
  ChannelShape,
  MainApi,
  MainPart,
} from '../../../contracts/plugin';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { workInboxManifest } from '../manifest';

type WorkInboxMainApi = MainApi<typeof workInboxManifest, ChannelShape>;

// Registers Inbox's layouts.
export const workInboxMainPart: MainPart<typeof workInboxManifest> = {
  manifest: workInboxManifest,
  start(api: WorkInboxMainApi) {
    api.layouts.register({ layoutTypes });
    return { commands: {} };
  },
};
