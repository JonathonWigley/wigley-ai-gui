import type {
  ChannelShape,
  MainApi,
  MainPart,
} from '../../../contracts/plugin';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { keysManifest } from '../manifest';

type KeysApi = MainApi<typeof keysManifest, ChannelShape>;

// Registers keys's layouts.
export const keysMainPart: MainPart<typeof keysManifest> = {
  manifest: keysManifest,
  start(api: KeysApi) {
    const layouts = api.layouts.register({ layoutTypes });
    return { commands: {}, dispose: () => layouts.dispose() };
  },
};
