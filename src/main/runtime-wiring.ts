import type { CommandId } from '../contracts/commands';
import {
  coreRuntimeMainSlot,
  coreRuntimePageSlot,
  type RuntimeCatalog,
} from '../contracts/core-state';
import type { Disposable } from '../contracts/disposable';
import type { Keymap } from '../contracts/keymap';
import type { Log } from '../contracts/log';
import type { AppConfig } from '../contracts/settings';
import { errorText } from '../shared/error-text';
import { withoutUnhandledRuntimeBinds } from '../shared/plugin-manifests';
import { EMPTY_RUNTIME_CATALOG } from '../shared/runtime-commands';
import type { SlotStore } from '../shared/state/slot-store';
import type { PageCommands } from './page-commands';
import type { SlotHolder } from './state/slot-holder';

export interface RuntimeWiringDeps {
  slots: SlotStore; // holder.store
  applyPageWrite: SlotHolder['applyPageWrite'];
  config: {
    setRuntime(runtime: { main: RuntimeCatalog; page: RuntimeCatalog }): void;
    onChanged(listener: (config: AppConfig) => void): Disposable;
  };
  served(): AppConfig;
  pageCommands: Pick<PageCommands, 'pageGone'>;
  has(id: CommandId): boolean;
  // main.ts: `keybindings.setKeymap`, then `registerGlobalShortcuts` under today's guard.
  applyKeys(keymap: Keymap): void;
  log: Log;
}

export interface RuntimeWiring {
  // The keymap main's key paths run: `withoutUnhandledRuntimeBinds` over `keymap`, side 'main'.
  handledKeymap(keymap: Keymap): Keymap;
  // Called on `render-process-gone`. Writes the empty page catalog.
  pageProcessGone(): void;
}

// Feeds both catalogs to the config store now and at each change, ends the waiting
// page runs when the page's `started` falls, and applies each new keymap main can
// run. Called once, after the store's listener that pushes to the page.
export function wireRuntime(deps: RuntimeWiringDeps): RuntimeWiring {
  const mainSlot = deps.slots.read(coreRuntimeMainSlot, 'core');
  const pageSlot = deps.slots.read(coreRuntimePageSlot, 'core');
  const feedStore = () =>
    deps.config.setRuntime({
      main: mainSlot.get() ?? EMPTY_RUNTIME_CATALOG,
      page: pageSlot.get() ?? EMPTY_RUNTIME_CATALOG,
    });
  let wasPageStarted = pageSlot.get()?.started ?? false;
  mainSlot.on(feedStore);
  pageSlot.on((catalog) => {
    const isStarted = catalog?.started ?? false;
    feedStore();
    if (wasPageStarted && !isStarted) {
      deps.pageCommands.pageGone();
    }
    wasPageStarted = isStarted;
  });
  feedStore();

  const handledKeymap = (keymap: Keymap) =>
    withoutUnhandledRuntimeBinds(
      keymap,
      deps.served().commands,
      deps.has,
      'main',
    );
  let appliedKeymap = JSON.stringify(handledKeymap(deps.served().keymap));
  deps.config.onChanged(() => {
    const keymap = handledKeymap(deps.served().keymap);
    const text = JSON.stringify(keymap);
    if (text === appliedKeymap) {
      return;
    }
    try {
      deps.applyKeys(keymap);
      appliedKeymap = text;
    } catch (error) {
      deps.log('config', `keys not applied: ${errorText(error)}`);
    }
  });
  return {
    handledKeymap,
    pageProcessGone() {
      deps.applyPageWrite({
        id: coreRuntimePageSlot.id,
        kind: 'value',
        value: EMPTY_RUNTIME_CATALOG,
      });
    },
  };
}
