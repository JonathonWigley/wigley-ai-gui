import { describe, expect, it } from 'vitest';
import {
  fakeDependency,
  noCounts,
  startPagePart,
} from '../../../shared/plugin-part-harness.test-support';
import {
  type DocsPageExports,
  docsPageKey,
  type DocsViewHandle,
  sessionSourceId,
  UNSAVED_TEXT,
} from '../../docs/contract';
import {
  type SessionsPageExports,
  sessionsPageKey,
  sessionsRowsSlot,
  type SessionTabHandle,
  type SessionTabView,
} from '../../sessions/contract';
import { sessionRow } from '../../sessions/contract.test-support';
import { docsSessionTabPagePart } from './start';

const projectRow = (sessionId: string) =>
  sessionRow(sessionId, { label: sessionId, projectDir: '/p' });

// What throws the next time one is disposed, once.
interface ThrowsNext {
  view: boolean;
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

// What the fakes saw: each tab added and each view added, the live ones by
// session, the `isVisible` each view was added with by source, each view
// shown by source, and each dispose in order. A tab's `isVisible` reads
// whether its session is in `visibleTabs`. The fakes file nothing under the
// dependent, so only the part's own teardown empties `liveTabs` and
// `liveViews`.
interface Seen {
  tabs: SessionTabView[];
  liveTabs: Map<string, SessionTabView>;
  visibleTabs: Set<string>;
  sources: string[];
  liveViews: Map<string, DocsViewHandle>;
  viewIsVisible: Map<string, () => boolean>;
  shownViews: string[];
  replaced: string[];
  disposed: string[];
  hasUnsavedEdits: boolean;
  throwsNext: ThrowsNext;
}

function fakeDocs(seen: Seen) {
  const throwFromDispose = disposeThrowingOn(seen.throwsNext, 'view');
  return fakeDependency(
    docsPageKey,
    () =>
      ({
        addView(sourceId: string, options: { isVisible(): boolean }) {
          seen.sources.push(sourceId);
          seen.viewIsVisible.set(sourceId, () => options.isVisible());
          const handle: DocsViewHandle = {
            element: {} as HTMLElement,
            shown: () => seen.shownViews.push(sourceId),
            hasUnsavedEdits: () => seen.hasUnsavedEdits,
            sourceReplaced: () => seen.replaced.push(sourceId),
            dispose() {
              seen.liveViews.delete(sourceId);
              seen.disposed.push(`view ${sourceId}`);
              throwFromDispose();
            },
          };
          seen.liveViews.set(sourceId, handle);
          return handle;
        },
      }) as unknown as DocsPageExports,
  );
}

function fakeSessions(seen: Seen) {
  const throwFromDispose = disposeThrowingOn(seen.throwsNext, 'tab');
  return fakeDependency(
    sessionsPageKey,
    () =>
      ({
        addTab(sessionId: string, tab: SessionTabView) {
          seen.tabs.push(tab);
          seen.liveTabs.set(sessionId, tab);
          return {
            isVisible: () => seen.visibleTabs.has(sessionId),
            dispose() {
              seen.liveTabs.delete(sessionId);
              seen.disposed.push(`tab ${sessionId}`);
              throwFromDispose();
            },
          } as unknown as SessionTabHandle;
        },
      }) as unknown as SessionsPageExports,
  );
}

// The part on the harness with `sessionIds` rows published and the page ready.
function startWithRows(sessionIds: readonly string[]) {
  const seen: Seen = {
    tabs: [],
    liveTabs: new Map(),
    visibleTabs: new Set(),
    sources: [],
    liveViews: new Map(),
    viewIsVisible: new Map(),
    shownViews: [],
    replaced: [],
    disposed: [],
    hasUnsavedEdits: false,
    throwsNext: { view: false, tab: false },
  };
  const harness = startPagePart(docsSessionTabPagePart, {
    dependencies: [fakeDocs(seen), fakeSessions(seen)],
  });
  const rows = harness.state.publish(sessionsRowsSlot);
  for (const sessionId of sessionIds) {
    rows.set(sessionId, projectRow(sessionId));
  }
  harness.ready();
  return { harness, rows, seen };
}

describe('docsSessionTabPagePart', () => {
  it('rows_RowArrives_AddsDocsTabOverItsSessionSource', async () => {
    const { harness, seen } = startWithRows(['s1']);

    expect(seen.sources).toEqual([sessionSourceId('s1')]);
    expect(seen.tabs).toEqual([
      expect.objectContaining({
        id: 'docs',
        title: 'Docs',
        icon: 'book',
        order: 1,
      }),
    ]);
    expect(seen.tabs[0].element).toBe(
      seen.liveViews.get(sessionSourceId('s1'))?.element,
    );
    await harness.stop();
  });

  it.each([
    { name: 'page load', restarts: false },
    { name: 'live restart', restarts: true },
  ])(
    'ready_RowArrivesAfterLoad_AddsItsDocsTab: $name',
    async ({ restarts }) => {
      const { harness, rows, seen } = startWithRows(['s1']);
      if (restarts) {
        await harness.restart();
      }

      rows.set('s2', projectRow('s2'));

      expect([...seen.liveTabs.keys()]).toEqual(['s1', 's2']);
      await harness.stop();
    },
  );

  it.each([
    { state: 'hidden', isTabVisible: false },
    { state: 'visible', isTabVisible: true },
  ])(
    'tab_ShownOrVisible_ReachesOnlyItsSessionsView (s1 tab $state)',
    async ({ isTabVisible }) => {
      const { harness, seen } = startWithRows(['s1', 's2']);
      if (isTabVisible) {
        seen.visibleTabs.add('s1');
      }

      seen.liveTabs.get('s1')?.shown();

      expect({
        shown: seen.shownViews,
        visible: ['s1', 's2'].map((sessionId) =>
          seen.viewIsVisible.get(sessionSourceId(sessionId))?.(),
        ),
      }).toEqual({
        shown: [sessionSourceId('s1')],
        visible: [isTabVisible, false],
      });
      await harness.stop();
    },
  );

  // An at-once close still keeps unsaved edits: closing would lose them.
  it.each([
    {
      state: 'no unsaved edits',
      hasUnsavedEdits: false,
      atOnce: false,
      toasts: [],
    },
    {
      state: 'unsaved edits',
      hasUnsavedEdits: true,
      atOnce: false,
      toasts: [`toast error: ${UNSAVED_TEXT}`],
    },
    {
      state: 'unsaved edits, closed at once',
      hasUnsavedEdits: true,
      atOnce: true,
      toasts: [`toast error: ${UNSAVED_TEXT}`],
    },
  ])(
    'beforeClose_RefusesOnlyOverUnsavedEdits ($state)',
    async ({ hasUnsavedEdits, atOnce, toasts }) => {
      const { harness, seen } = startWithRows(['s1']);
      seen.hasUnsavedEdits = hasUnsavedEdits;

      const closes = await seen.liveTabs.get('s1')?.beforeClose(atOnce);

      expect(closes).toBe(!hasUnsavedEdits);
      expect(
        harness.logs
          .map(({ message }) => message)
          .filter((message) => message.startsWith('toast')),
      ).toEqual(toasts);
      await harness.stop();
    },
  );

  it('rows_HostChangedOrRemoved_ReachOnlyThatRowsView', async () => {
    const { harness, rows, seen } = startWithRows(['s1', 's2']);

    rows.set('s1', { ...projectRow('s1'), hostSessionId: 'moved' });
    expect(seen.replaced).toEqual([sessionSourceId('s1')]);

    rows.delete('s1');
    expect([...seen.liveTabs.keys()]).toEqual(['s2']);
    expect([...seen.liveViews.keys()]).toEqual([sessionSourceId('s2')]);
    expect(seen.disposed).toEqual([`tab s1`, `view ${sessionSourceId('s1')}`]);
    await harness.stop();
  });

  it.each([
    { state: 'fresh start', sessionIds: [] },
    { state: 'one Docs tab held', sessionIds: ['s1'] },
  ])('stop_LeavesNoLiveRegistration ($state)', async ({ sessionIds }) => {
    const { harness, seen } = startWithRows(sessionIds);

    await harness.stop();

    expect(seen.tabs).toHaveLength(sessionIds.length);
    expect(seen.liveTabs.size + seen.liveViews.size).toBe(0);
    expect(harness.counts()).toEqual(noCounts);
  });

  it.each([
    { part: 'view' as const, error: 'view gone' },
    { part: 'tab' as const, error: 'tab gone' },
  ])(
    'stop_OneSessionsTeardownThrows_TearsDownEveryView ($part)',
    async ({ part, error }) => {
      const { harness, seen } = startWithRows(['s1', 's2']);
      seen.throwsNext[part] = true;

      await expect(harness.stop()).rejects.toThrow(error);

      expect(seen.disposed).toEqual([
        'tab s1',
        `view ${sessionSourceId('s1')}`,
        'tab s2',
        `view ${sessionSourceId('s2')}`,
      ]);
      expect(harness.counts()).toEqual(noCounts);
    },
  );
});
