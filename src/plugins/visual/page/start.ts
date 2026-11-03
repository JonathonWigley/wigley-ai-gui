import './visual.css';
import type { PagePart, PageApi } from '../../../contracts/plugin';
import type { ChatPageExports } from '../../chat/contract';
import type { KeysPageExports } from '../../keys/contract';
import type { VisualChannel } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import type { Layout } from '../layouts/layout';
import { visualManifest } from '../manifest';
import { createHtmlFence } from './html-fence';
import { readVisualLayout } from './layout/read-visual-layout';
import { createVisualParts } from './layout/visual-parts';
import { createVisualCommands } from './visual-commands';
import { createVisualOverlay } from './visual-overlay';
import { createVisualRegistry } from './visual-registry';

type VisualApi = PageApi<typeof visualManifest, VisualChannel>;

// Contributes the live `html` fence to the markdown service for the page's
// life, so every markdown owner draws an agent's html block as a visual
// through the `visual.layout` layout, and the full-size overlay, which `v`
// opens on chat's focused entry's visuals and each visual's expand control
// on that visual; each live view and the open overlay draw again on each
// layouts set.
export const visualPagePart: PagePart<typeof visualManifest> = {
  manifest: visualManifest,
  start(api: VisualApi) {
    const { services } = api;
    const keys = api.dependency<KeysPageExports>('keys');
    const chat = api.dependency<ChatPageExports>('chat');
    const layoutsChanged: (() => void)[] = [];
    const registry = createVisualRegistry();
    const parts = createVisualParts({
      defaultLayout,
      kit: {
        markdown: services.markdown,
        keys: { anchor: keys.anchor, keysFor: keys.keysFor },
        commands: {
          exists: (id) => api.keys.command(id) !== undefined,
          run: (id) => api.commands.run(id),
        },
        platform: api.platform,
      },
      log: services.log,
    });
    const overlay = createVisualOverlay({
      overlay: api.areas.overlay,
      pushScope: () => api.keys.pushScope('overlay'),
      frames: services.visualFrames,
      parts,
      log: services.log,
      onLayoutsChanged: (listener) => layoutsChanged.push(listener),
    });
    const fence = createHtmlFence({
      frames: services.visualFrames,
      parts,
      registry,
      log: services.log,
      expand: (source) => overlay.open([source], 0),
    });
    services.markdown.addFence(fence.contribution);

    api.layouts.show<Layout>({
      defaultLayout,
      defaultStylesheet: null,
      read: readVisualLayout,
      userLayout: () => api.settings().layout,
      setLayouts(shown) {
        parts.setLayouts(shown);
        fence.redraw();
        for (const listener of layoutsChanged) {
          listener();
        }
      },
    });

    return {
      commands: createVisualCommands({
        chat,
        registry,
        overlay,
        log: services.log,
      }),
    };
  },
};
