import type { MainPart } from '../../../contracts/plugin';
import { buildsTeamcityManifest } from '../manifest';

export const buildsTeamcityMainPart: MainPart<typeof buildsTeamcityManifest> = {
  manifest: buildsTeamcityManifest,
  start() {
    return { commands: {} };
  },
};
