import { afterEach, describe, expect, it, vi } from 'vitest';
import { coreModeSlot } from '../../../contracts/core-state';
import type { Registrations } from '../../../contracts/disposable';
import { installFocusFakeDom } from '../../../shared/page/test-dom';
import {
  fakeDependency,
  noCounts,
  startPagePart,
} from '../../../shared/plugin-part-harness.test-support';
import { createRegistrations } from '../../../shared/registrations';
import {
  type SessionsPageExports,
  sessionsPageKey,
  type SessionTabHandle,
  type SessionTabView,
} from '../../sessions/contract';
import type { DocsPageExports } from '../contract';
import { docsPagePart } from './start';

// What throws the next time one is disposed, once.
interface ThrowsNext {
  anchor: boolean;
  tab: boolean;
}

function disposeThrowingOn(
  throwsNext: ThrowsNext,
  part: keyof ThrowsNext,
): () => void {
  return () => {
    if (throwsNext[part]) {
      throwsNext[part] = false;
      throw new Error(`${part} gone`);
    }
  };
}

// `tabs` holds each tab's title; its handle files under the dependent.
function fakeSessions(tabs: string[], throwsNext: ThrowsNext) {
  return fakeDependency(
    sessionsPageKey,
    (consumer) =>
      ({
        addTab(_sessionId: string, tab: SessionTabView) {
          tabs.push(tab.title);
          return consumer.track({
            dispose: disposeThrowingOn(throwsNext, 'tab'),
          } as SessionTabHandle);
        },
      }) as unknown as SessionsPageExports,
  );
}

function startDocsPage() {
  installFocusFakeDom(vi.stubGlobal);
  const tabs: string[] = [];
  const throwsNext: ThrowsNext = { anchor: false, tab: false };
  const harness = startPagePart(docsPagePart, {
    dependencies: [fakeSessions(tabs, throwsNext)],
    anchorDispose: disposeThrowingOn(throwsNext, 'anchor'),
    firstModeTaken: true,
  });
  const exportsTo = (consumer: Registrations) =>
    harness.started().exports?.(consumer) as DocsPageExports;
  return { harness, exportsTo, tabs, throwsNext };
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
      expect(harness.counts()).toEqual(noCounts);
    },
  );

  it.each([
    { part: 'anchor' as const, error: 'anchor gone' },
    { part: 'tab' as const, error: 'tab gone' },
  ])(
    'stop_OneSessionsTeardownThrows_TearsDownEveryView ($part)',
    async ({ part, error }) => {
      const { harness, throwsNext } = startDocsPage();
      for (const sessionId of ['s1', 's2']) {
        harness.emit('sessions.sessionAdded', { sessionId, projectDir: '/p' });
      }
      expect(harness.counts().observers).toBeGreaterThan(0);
      throwsNext[part] = true;

      await expect(harness.stop()).rejects.toThrow(error);

      expect(harness.counts()).toEqual(noCounts);
    },
  );

  it('start_ModeSlotChanges_TracksDocsModeShown', async () => {
    const { harness } = startDocsPage();
    const shownMode = harness.state.publish(coreModeSlot);
    // The fake mode's side bar is hidden, so with Docs mode shown a tree command
    // reports its tree out of sight, and with it not shown no view acts at all.
    const treeDownActed = () => {
      const before = harness.logs.length;
      harness.started().commands.treeDown({ arg: undefined });
      return harness.logs.length > before;
    };
    expect(treeDownActed()).toBe(false);

    shownMode.set('docs.docs');
    expect(treeDownActed()).toBe(true);

    shownMode.set('other.mode');
    expect(treeDownActed()).toBe(false);
    await harness.stop();
  });

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
