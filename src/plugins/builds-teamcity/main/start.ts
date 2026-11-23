import type { MainPart } from '../../../contracts/plugin';
import { buildsMainKey } from '../../builds/contract';
import { buildsTeamcityManifest } from '../manifest';
import { teamcityBackendKind } from './teamcity-backend';

// Adds the `teamcity` backend kind to builds.
export const buildsTeamcityMainPart: MainPart<typeof buildsTeamcityManifest> = {
  manifest: buildsTeamcityManifest,
  start(api) {
    api.dependency(buildsMainKey).addBackend(teamcityBackendKind);
    return { commands: {} };
  },
};
