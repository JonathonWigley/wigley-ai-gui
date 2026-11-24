import type { FeatureKey } from '../../../contracts/contributions';
import type { Disposable } from '../../../contracts/disposable';
import type {
  ChannelShape,
  PageApi,
  PagePart,
} from '../../../contracts/plugin';
import { settingsPageKey } from '../../settings/contract';
import { contributionsFeaturesSlot } from '../contract';
import { contributionsManifest } from '../manifest';
import { strategyKind, workflowListKind } from './control-kinds';

type ContributionsPageApi = PageApi<typeof contributionsManifest, ChannelShape>;

// Adds Settings' `strategy-list:workflows` control kind once, and one
// `strategy:<key>` kind per feature key `contributions.features` holds, each
// disposed when its key leaves the slot. Each kind reads the slot at each
// call.
export const contributionsPagePart: PagePart<typeof contributionsManifest> = {
  manifest: contributionsManifest,
  start(api: ContributionsPageApi) {
    const settings = api.dependency(settingsPageKey);
    const features = api.state.read(contributionsFeaturesSlot);
    settings.addControlKind(workflowListKind(() => features.get('workflows')));
    const strategyKinds = new Map<string, Disposable>();
    const follow = (key: string) => {
      const isHeld = features.get(key) !== undefined;
      const added = strategyKinds.get(key);
      if (isHeld && added === undefined) {
        const featureKey = key as FeatureKey;
        strategyKinds.set(
          key,
          settings.addControlKind(
            strategyKind(featureKey, () => features.get(key)),
          ),
        );
      } else if (!isHeld && added !== undefined) {
        added.dispose();
        strategyKinds.delete(key);
      }
    };
    for (const key of features.all().keys()) {
      follow(key);
    }
    features.on((key) => follow(key));
    return { commands: {} };
  },
};
