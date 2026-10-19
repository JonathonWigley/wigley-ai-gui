import './keys.css';
import type { PageApi, PagePart } from '../../../contracts/plugin';
import { keysManifest } from '../manifest';
import { whichKeyModel } from './which-key';
import { startWhichKey } from './which-key-controller';
import { mountWhichKeyView } from './which-key-view';

// The keys plugin has no main part, so its channel carries nothing.
type KeysApi = PageApi<
  typeof keysManifest,
  { invoke: Record<never, never>; messages: Record<never, never> }
>;

// Shows which-key over every pending key sequence, on the page and in a box.
export const keysPagePart: PagePart<typeof keysManifest> = {
  manifest: keysManifest,
  start(api: KeysApi) {
    const { keys, services, settings } = api;
    startWhichKey({
      onPending: (listener) => keys.onPending(listener),
      holdPending: () => keys.holdPending(),
      cancelPending: () => keys.cancelPending(),
      model: (pending) =>
        whichKeyModel(pending, keys.keymap, keys.command, keys.label),
      view: mountWhichKeyView(api.areas.overlay),
      timers: services.timers,
      delayMs: settings.whichKeyDelayMs,
      timeoutMs: settings.whichKeyTimeoutMs,
      log: services.log,
    });
    return { commands: {} };
  },
};
