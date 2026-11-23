import type { MainApi, MainPart } from '../../../contracts/plugin';
import { readColumns, type WorkChannel, workStateSlot } from '../contract';
import { workManifest } from '../manifest';
import { buildWorkState, createWorkStore } from './store';

type WorkMainApi = MainApi<typeof workManifest, WorkChannel>;

// Keeps the user's work in `work.json` through the work store and publishes it as `work.state`, built against
// `work.columns`: the slot holds no value until the store's load ends, then is written again on each store change and
// each settings change. `dispose` waits for every store update to settle.
export const workMainPart: MainPart<typeof workManifest> = {
  manifest: workManifest,
  start(api: WorkMainApi) {
    const state = api.state.publish(workStateSlot);
    const store = createWorkStore(api.data, api.services.log);
    let isLoaded = false;
    let isStopped = false;

    const publish = () => {
      if (isStopped) {
        return;
      }
      const columns = readColumns(api.settings().columns);
      state.set(buildWorkState(store.file(), columns, store.problem()));
    };

    store.onChange(publish);
    api.onSettingsChanged(() => {
      if (isLoaded) {
        publish();
      }
    });
    void store.load().then(() => {
      isLoaded = true;
      publish();
    });

    return {
      commands: {},
      async dispose() {
        isStopped = true;
        await store.settled();
      },
    };
  },
};
