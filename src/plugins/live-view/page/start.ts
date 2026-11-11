import './live-view.css';
import type { Disposable } from '../../../contracts/disposable';
import type {
  ChannelShape,
  PageApi,
  PagePart,
} from '../../../contracts/plugin';
import { callEach } from '../../../shared/call-each';
import { kitCommandsOf } from '../../../shared/page/layout-host/base-kit';
import { chatPageKey } from '../../chat/contract';
import { followRows, sessionsRowsSlot } from '../../sessions/contract';
import { livePicksSlot } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import defaultStylesheet from '../layouts/default/layout.css?url';
import type { Layout } from '../layouts/layout';
import { liveViewManifest } from '../manifest';
import { readLiveViewLayout } from './layout/read-live-view-layout';
import { createLiveSection } from './live-section';
import { createStreamSource } from './stream-source';

type LiveViewApi = PageApi<
  typeof liveViewManifest,
  ChannelShape,
  Record<never, never>
>;

const VISIBILITY_CHANGE = 'visibilitychange';

// Reports the last entry of each batch: the target's state now.
function observeIntersection(
  target: HTMLElement,
  report: (isIntersecting: boolean) => void,
): Disposable {
  const observer = new IntersectionObserver((entries) => {
    const entry = entries.at(-1);
    if (entry !== undefined) {
      report(entry.isIntersecting);
    }
  });
  observer.observe(target);
  return { dispose: () => observer.disconnect() };
}

// Draws the session hub's Live section through chat's side parts and the `live-view.layout` layout. Reads
// `live-view.picks`, redrawing a session's section each time its pick changes, and streams each section's pick while
// the section is on screen and the page visible, at the `frameRate` setting read at each open. Names each session by
// its side-bar label for the page log.
export const liveViewPagePart: PagePart<typeof liveViewManifest> = {
  manifest: liveViewManifest,
  start(api: LiveViewApi) {
    const { services } = api;
    const picks = api.state.read(livePicksSlot);
    const chat = api.dependency(chatPageKey);
    const rows = api.state.read(sessionsRowsSlot);
    const streams = createStreamSource({ timers: services.timers });
    const section = createLiveSection({
      kit: {
        markdown: services.markdown,
        keys: api.keys,
        commands: kitCommandsOf(api),
        platform: api.platform.os,
        state: api.state.forLayouts,
      },
      log: services.log,
      nameOf: (sessionId) => rows.get(sessionId)?.label ?? sessionId,
      pick: (sessionId) => picks.get(sessionId),
      openStream: (sourceId) =>
        streams.openStream(sourceId, api.settings().frameRate),
      observeIntersection,
      isPageVisible: () => document.visibilityState === 'visible',
    });
    chat.addSidePart(section.part);

    followRows(rows, { removed: (sessionId) => section.forget(sessionId) });

    api.layouts.show<Layout>({
      defaultLayout,
      defaultStylesheet,
      read: readLiveViewLayout,
      userLayout: () => api.settings().layout,
      setLayouts: (shown) => section.setLayouts(shown),
    });

    const visibilityChanged = () => section.pageVisibilityChanged();
    document.addEventListener(VISIBILITY_CHANGE, visibilityChanged);

    return {
      dispose() {
        document.removeEventListener(VISIBILITY_CHANGE, visibilityChanged);
      },
      commands: {},
      ready() {
        picks.on((sessionId) => section.pickUpdated(sessionId));
        callEach([...picks.all().keys()], (sessionId) =>
          section.pickUpdated(sessionId),
        );
      },
    };
  },
};
