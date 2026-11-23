import type { MainPart } from '../../../contracts/plugin';
import { buildsManifest } from '../manifest';

export const buildsMainPart: MainPart<typeof buildsManifest> = {
  manifest: buildsManifest,
  start() {
    return {
      commands: {
        queue: () => {
          throw new Error('builds.queue: not built yet');
        },
        offer: () => {
          throw new Error('builds.offer: not built yet');
        },
        launchSetAgent: () => {
          throw new Error('builds.launchSetAgent: not built yet');
        },
      },
    };
  },
};
