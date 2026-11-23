import type {
  ChannelShape,
  MainApi,
  MainPart,
} from '../../../contracts/plugin';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { workBoardManifest } from '../manifest';

type WorkBoardApi = MainApi<typeof workBoardManifest, ChannelShape>;

// Registers the Board's layouts.
export const workBoardMainPart: MainPart<typeof workBoardManifest> = {
  manifest: workBoardManifest,
  start(api: WorkBoardApi) {
    api.layouts.register({ layoutTypes });
    return { commands: {} };
  },
};
