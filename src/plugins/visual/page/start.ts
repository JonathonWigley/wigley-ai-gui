import './visual.css';
import type { PagePart, PageApi } from '../../../contracts/plugin';
import type { KeysPageExports } from '../../keys/contract';
import type { VisualChannel } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import type { Layout } from '../layouts/layout';
import { visualManifest } from '../manifest';
import { createHtmlFence } from './html-fence';
import { readVisualLayout } from './layout/read-visual-layout';
import { createVisualParts } from './layout/visual-parts';

type VisualApi = PageApi<typeof visualManifest, VisualChannel>;

// Contributes the live `html` fence to the markdown service for the page's
// life, so every markdown owner draws an agent's html block as a visual
// through the `visual.layout` layout; each live view draws again on each
// layouts set.
export const visualPagePart: PagePart<typeof visualManifest> = {
  manifest: visualManifest,
  start(api: VisualApi) {
    const { services } = api;
    const keys = api.dependency<KeysPageExports>('keys');
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
    const fence = createHtmlFence({
      frames: services.visualFrames,
      parts,
      log: services.log,
    });
    services.markdown.addFence(fence.contribution);

    api.layouts.show<Layout>({
      defaultLayout,
      read: readVisualLayout,
      userLayout: () => api.settings().layout,
      setLayouts(shown) {
        parts.setLayouts(shown);
        fence.redraw();
      },
    });

    return { commands: {} };
  },
};
