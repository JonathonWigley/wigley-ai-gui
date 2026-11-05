import type { MainPart } from '../../../contracts/plugin';
import { windowManifest } from '../manifest';

export const windowMainPart: MainPart<typeof windowManifest> = {
  manifest: windowManifest,
  start({ services }) {
    return {
      commands: {
        summon: ({ chord }) => {
          if (services.window.summon()) {
            services.log(`${chord ?? 'a command'} summoned the window`);
          }
        },
      },
    };
  },
};
