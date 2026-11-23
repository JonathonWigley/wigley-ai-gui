import type { PagePart } from '../../../contracts/plugin';
import { buildsManifest } from '../manifest';

export const buildsPagePart: PagePart<typeof buildsManifest> = {
  manifest: buildsManifest,
  start() {
    return { commands: {} };
  },
};
