import type {
  ChannelShape,
  PageApi,
  PagePart,
} from '../../../contracts/plugin';
import { callEach } from '../../../shared/call-each';
import { kitCommandsOf } from '../../../shared/page/layout-host/base-kit';
import { chatPageKey } from '../../chat/contract';
import { followRows, sessionsRowsSlot } from '../../sessions/contract';
import { contextBreakdownsSlot } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import defaultStylesheet from '../layouts/default/layout.css?url';
import type { Layout } from '../layouts/layout';
import { contextSourcesManifest } from '../manifest';
import { readContextSourcesLayout } from './layout/read-context-sources-layout';
import { createContextSection } from './context-section';

type ContextSourcesApi = PageApi<
  typeof contextSourcesManifest,
  ChannelShape,
  Record<never, never>
>;

// Draws the session hub's Context section through chat's side parts and the `context-sources.layout` layout. Reads
// `context-sources.breakdowns`, redrawing a session's section each time its breakdown changes, and names each session
// by its side-bar label for the page log.
export const contextSourcesPagePart: PagePart<typeof contextSourcesManifest> = {
  manifest: contextSourcesManifest,
  start(api: ContextSourcesApi) {
    const { services } = api;
    const breakdowns = api.state.read(contextBreakdownsSlot);
    const chat = api.dependency(chatPageKey);
    const rows = api.state.read(sessionsRowsSlot);
    const section = createContextSection({
      kit: {
        markdown: services.markdown,
        keys: api.keys,
        commands: kitCommandsOf(api),
        platform: api.platform.os,
        state: api.state.forLayouts,
      },
      log: services.log,
      nameOf: (sessionId) => rows.get(sessionId)?.label ?? sessionId,
      breakdown: (sessionId) => breakdowns.get(sessionId),
      showPath: (path) => services.paths.tilde(path, services.homeDir),
    });
    chat.addSidePart(section.part);

    followRows(rows, { removed: (sessionId) => section.forget(sessionId) });

    api.layouts.show<Layout>({
      defaultLayout,
      defaultStylesheet,
      read: readContextSourcesLayout,
      userLayout: () => api.settings().layout,
      setLayouts: (shown) => section.setLayouts(shown),
    });

    return {
      commands: {},
      ready() {
        breakdowns.on((sessionId) => section.breakdownUpdated(sessionId));
        callEach([...breakdowns.all().keys()], (sessionId) =>
          section.breakdownUpdated(sessionId),
        );
      },
    };
  },
};
