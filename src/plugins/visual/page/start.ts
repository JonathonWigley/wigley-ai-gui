import './visual.css';
import type { PagePart, PageApi } from '../../../contracts/plugin';
import { callEach } from '../../../shared/call-each';
import { chatPageKey } from '../../chat/contract';
import type { VisualChannel, VisualPageEvents } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import defaultStylesheet from '../layouts/default/layout.css?url';
import type { Layout } from '../layouts/layout';
import { visualManifest } from '../manifest';
import { createHtmlFence } from './html-fence';
import { readVisualLayout } from './layout/read-visual-layout';
import { createVisualParts } from './layout/visual-parts';
import { createVisualCommands } from './visual-commands';
import { createVisualOverlay } from './visual-overlay';
import { createVisualRegistry } from './visual-registry';
import { kitCommandsOf } from '../../../shared/page/layout-host/base-kit';

type VisualApi = PageApi<
  typeof visualManifest,
  VisualChannel,
  VisualPageEvents
>;

// Contributes the live `html` fence to the markdown service while it runs, so
// every markdown owner draws an agent's html block as a visual through the
// `visual.layout` layout, and the full-size overlay, which `v` opens on chat's
// focused entry's visuals and each visual's expand control on that visual;
// each live view and the open overlay draw again on each layouts set. A stop
// closes the overlay and disposes every live view.
export const visualPagePart: PagePart<typeof visualManifest> = {
  manifest: visualManifest,
  start(api: VisualApi) {
    const { services } = api;
    const chat = api.dependency(chatPageKey);
    const layoutsChanged: (() => void)[] = [];
    const registry = createVisualRegistry();
    const parts = createVisualParts({
      defaultLayout,
      kit: {
        markdown: services.markdown,
        keys: api.keys,
        commands: kitCommandsOf(api),
        platform: api.platform.os,
        state: api.state.forLayouts,
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
      opened: (count, index) =>
        api.events.emit('visualOpened', { count, index }),
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
      defaultStylesheet,
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
      dispose() {
        callEach<() => void>(
          [() => overlay.close(), () => fence.dispose()],
          (step) => step(),
        );
      },
    };
  },
};
