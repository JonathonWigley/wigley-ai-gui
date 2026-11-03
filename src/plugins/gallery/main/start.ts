import type {
  ChannelShape,
  MainApi,
  MainPart,
} from '../../../contracts/plugin';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { galleryManifest } from '../manifest';

type GalleryApi = MainApi<typeof galleryManifest, ChannelShape>;

// Registers gallery's layouts.
export const galleryMainPart: MainPart<typeof galleryManifest> = {
  manifest: galleryManifest,
  start(api: GalleryApi) {
    api.layouts.register({ layoutTypes });
    return { commands: {} };
  },
};
