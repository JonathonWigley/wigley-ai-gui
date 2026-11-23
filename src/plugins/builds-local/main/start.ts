import type { MainPart } from '../../../contracts/plugin';
import { buildsMainKey } from '../../builds/contract';
import { buildsLocalManifest } from '../manifest';
import { localBackendKind } from './local-backend';

// Registers the `local` backend kind with builds, which drops it when this part stops.
export const buildsLocalMainPart: MainPart<typeof buildsLocalManifest> = {
  manifest: buildsLocalManifest,
  start(api) {
    api.dependency(buildsMainKey).addBackend(localBackendKind);
    return { commands: {} };
  },
};
