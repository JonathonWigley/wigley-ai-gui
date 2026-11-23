import type { MainPart } from '../../../contracts/plugin';
import { buildsLocalManifest } from '../manifest';

export const buildsLocalMainPart: MainPart<typeof buildsLocalManifest> = {
  manifest: buildsLocalManifest,
  start() {
    return { commands: {} };
  },
};
