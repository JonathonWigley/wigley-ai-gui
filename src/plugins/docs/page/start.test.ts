import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Registrations } from '../../../contracts/disposable';
import type { PagePart, PluginManifest } from '../../../contracts/plugin';
import { installFakeDom } from '../../../shared/page/test-dom';
import {
  fakeDependency,
  startPagePart,
} from '../../../shared/plugin-part-harness.test-support';
import { createRegistrations } from '../../../shared/registrations';
import { type KeysPageExports, keysPageKey } from '../../keys/contract';
import type { SessionTabHandle, SessionTabView } from '../../sessions/contract';
import type { DocsPageExports } from '../contract';
import { docsPagePart } from './start';

const NOTHING_LIVE = {
  registrations: 0,
  timers: 0,
  listeners: 0,
  observers: 0,
  frames: 0,
};

const SESSIONS_MANIFEST: PluginManifest = {
  id: 'sessions',
  dependsOn: { main: [], page: [] },
  commands: {},
  scopes: {},
  settings: {},
  settingInfo: {},
  themeTokens: {},
};

// A stand-in for sessions' part, which starts ahead of docs and adds the first
// mode, so Docs mode is not shown as it is added. `tabs` holds each tab's
// title; its handle files under the dependent.
function sessionsStandIn(tabs: string[]): PagePart {
  return {
    manifest: SESSIONS_MANIFEST,
    start(api) {
      api.modes.add({
        id: 'stand-in',
        title: 'Stand-in',
        icon: 'book',
        element: {} as HTMLElement,
        shown: () => undefined,
        hidden: () => undefined,
      });
      return {
        commands: {},
        exports: (consumer: Registrations) => ({
          addTab(_sessionId: string, tab: SessionTabView) {
            tabs.push(tab.title);
            return consumer.track({
              dispose: () => undefined,
            } as SessionTabHandle);
          },
        }),
      };
    },
  } as PagePart;
}

function startDocsPage() {
  installFakeDom(vi.stubGlobal);
  const tabs: string[] = [];
  const keys = fakeDependency(keysPageKey, (consumer): KeysPageExports => ({
    keysFor: () => null,
    onChanged: () => consumer.track({ dispose: () => undefined }),
    anchor: () => consumer.track({ dispose: () => undefined }),
  }));
  const harness = startPagePart(docsPagePart, {
    dependencies: [keys],
    parts: [sessionsStandIn(tabs)],
  });
  const exportsTo = (consumer: Registrations) =>
    harness.started().exports?.(consumer) as DocsPageExports;
  return { harness, exportsTo, tabs };
}

describe('docs page part lifecycle', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    { state: 'fresh start', sessionAdded: false, tabCount: 0 },
    { state: 'one Docs tab held', sessionAdded: true, tabCount: 1 },
  ])(
    'stop_LeavesNoLiveRegistration ($state)',
    async ({ sessionAdded, tabCount }) => {
      const { harness, tabs } = startDocsPage();
      if (sessionAdded) {
        harness.emit('sessions.sessionAdded', {
          sessionId: 's1',
          projectDir: '/p',
        });
      }

      await harness.stop();

      expect(tabs).toHaveLength(tabCount);
      expect(harness.counts()).toEqual(NOTHING_LIVE);
    },
  );

  it('stopThenStart_StartsAgain', async () => {
    const { harness } = startDocsPage();

    await harness.restart();

    expect(harness.started().exports).toBeDefined();
  });

  it('stop_PendingResizeFrame_CancelsIt', async () => {
    const { harness } = startDocsPage();
    harness.fireWindow('resize');
    expect(harness.counts().frames).toBe(1);

    await harness.stop();

    expect(harness.counts().frames).toBe(0);
  });

  it('stop_TwoResizesBeforeTheFrame_CancelsEveryFrame', async () => {
    const { harness } = startDocsPage();
    harness.fireWindow('resize');
    harness.fireWindow('resize');

    await harness.stop();

    expect(harness.counts().frames).toBe(0);
  });

  it('exports_ConsumerDisposed_DisposesItsView', () => {
    const { harness, exportsTo } = startDocsPage();
    const consumer = createRegistrations();
    exportsTo(consumer).addView('extra', { isVisible: () => false });
    expect(harness.counts().observers).toBe(1);

    consumer.dispose();

    expect(harness.counts().observers).toBe(0);
  });
});
