import { afterEach, describe, expect, it, vi } from 'vitest';
import { coreModeSlot } from '../../../contracts/core-state';
import type { Registrations } from '../../../contracts/disposable';
import { NO_FENCES } from '../../../shared/page/markdown-mount.test-support';
import {
  asFake,
  type FakeElement,
  findAll,
  installFocusFakeDom,
} from '../../../shared/page/test-dom';
import {
  dataEmitted,
  fakeDependency,
  noCounts,
  startPagePart,
} from '../../../shared/plugin-part-harness.test-support';
import { createRegistrations } from '../../../shared/registrations';
import {
  type SessionsPageExports,
  sessionsPageKey,
  sessionsRowsSlot,
  type SessionTabHandle,
  type SessionTabView,
} from '../../sessions/contract';
import { type DocsPageExports, sessionSourceId } from '../contract';
import { docsPagePart } from './start';
import { fakeListPickerService } from '../../../shared/page/fake-list-picker-service.test-support';

const projectRow = (sessionId: string) => ({
  sessionId,
  label: sessionId,
  project: 'project',
  harness: 'claude' as const,
  marked: false,
  projectDir: '/p',
  hostSessionId: null,
  titles: { user: null, agent: null, firstMessage: null },
  profileDir: null,
});

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

// `tabs` holds each tab's title and `liveTabs` each undisposed tab by session;
// its handle files under the dependent.
function fakeSessions(
  tabs: string[],
  liveTabs: Map<string, SessionTabView>,
  throwsNext: ThrowsNext,
) {
  const throwFromDispose = disposeThrowingOn(throwsNext, 'tab');
  return fakeDependency(
    sessionsPageKey,
    (consumer) =>
      ({
        addTab(sessionId: string, tab: SessionTabView) {
          tabs.push(tab.title);
          liveTabs.set(sessionId, tab);
          return consumer.track({
            dispose() {
              liveTabs.delete(sessionId);
              throwFromDispose();
            },
          } as SessionTabHandle);
        },
      }) as unknown as SessionsPageExports,
  );
}

function startDocsPage(
  invoke?: (method: string, ...args: unknown[]) => Promise<unknown>,
) {
  installFocusFakeDom(vi.stubGlobal);
  const tabs: string[] = [];
  const liveTabs = new Map<string, SessionTabView>();
  const throwsNext: ThrowsNext = { anchor: false, tab: false };
  const picker = fakeListPickerService();
  const harness = startPagePart(docsPagePart, {
    services: {
      picker,
      markdown: {
        block: (text) => text,
        inline: (text) => text,
        document: async (text) => text,
        ...NO_FENCES,
      },
    },
    dependencies: [fakeSessions(tabs, liveTabs, throwsNext)],
    anchorDispose: disposeThrowingOn(throwsNext, 'anchor'),
    firstModeTaken: true,
    invoke,
  });
  const exportsTo = (consumer: Registrations) =>
    harness.started().exports?.(consumer) as DocsPageExports;
  return { harness, exportsTo, tabs, liveTabs, throwsNext, picker };
}

type DocsPage = ReturnType<typeof startDocsPage>;

// Opens `path` through Docs mode's `openDoc` message.
function openByMessage({ harness }: DocsPage, path: string) {
  harness.send('openDoc', { path, line: null });
}

// Shows an added view, then steps its tree down to the only leaf and opens it:
// `treeOpen` expands or enters a group until it reaches the leaf, which reads
// its doc.
async function openFromTree(
  { harness, exportsTo }: DocsPage,
  _path: string,
  readDocs: readonly unknown[],
) {
  exportsTo(createRegistrations())
    .addView('source', { isVisible: () => true })
    .shown();
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const { commands } = harness.started();
  await settle();
  commands.treeDown({ arg: undefined });
  for (let press = 0; press < 8 && readDocs.length === 0; press += 1) {
    commands.treeOpen({ arg: undefined });
    await settle();
  }
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
        harness.state.publish(sessionsRowsSlot).set('s1', projectRow('s1'));
        harness.emit('core.pageReady', null);
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
      const rows = harness.state.publish(sessionsRowsSlot);
      for (const sessionId of ['s1', 's2']) {
        rows.set(sessionId, projectRow(sessionId));
      }
      harness.emit('core.pageReady', null);
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

  it.each([
    {
      case: 'a message opening a doc that reads',
      open: openByMessage,
      path: '/p/kept.md',
      opened: ['/p/kept.md'],
    },
    {
      case: 'a message opening a missing doc',
      open: openByMessage,
      path: '/p/gone.md',
      opened: [],
    },
    {
      case: 'the tree opening a doc that reads',
      open: openFromTree,
      path: '/p/kept.md',
      opened: ['/p/kept.md'],
    },
    {
      case: 'the tree opening a missing doc',
      open: openFromTree,
      path: '/p/gone.md',
      opened: [],
    },
  ])(
    'docOpened_DocOpens_FiresOnlyThen ($case)',
    async ({ open, path, opened }) => {
      const entry = {
        id: path,
        kind: 'instructions',
        source: 'global',
        owner: 'mine',
        repo: null,
        root: null,
        plugin: null,
        path,
        line: null,
        title: path,
        meta: {},
        walked: [],
        lastLoaded: null,
        headings: [],
        links: [],
      };
      const readDocs: unknown[] = [];
      const page = startDocsPage(async (method, ...args) => {
        if (method === 'loadIndex') {
          return {
            document: {
              schemaVersion: 5,
              generatedAt: '2026-11-05T00:00:00Z',
              entries: [entry],
              contexts: [],
            },
            message: null,
            title: 'index',
            canRebuild: false,
          };
        }
        if (method === 'wikiMainPath') {
          return '/p/wiki/Main.md';
        }
        if (method === 'readDocIfPresent') {
          return null;
        }
        if (method !== 'readDoc') {
          return { clones: [] };
        }
        readDocs.push(args[0]);
        if (args[0] === '/p/gone.md') {
          throw new Error('no such file');
        }
        return '# Doc';
      });
      const { harness } = page;

      await open(page, path, readDocs);
      const hasSettled = () =>
        dataEmitted(harness, 'docs.docOpened').length > 0 ||
        harness.logs.some(({ message }) => message.includes('Could not open'));
      await vi.waitFor(() => expect(hasSettled()).toBe(true));

      expect(dataEmitted(harness, 'docs.docOpened')).toEqual(
        opened.map((each) => ({ path: each })),
      );
      await harness.stop();
    },
  );

  it('rows_HostChangedOrRemoved_ReachOnlyThatRowsView', async () => {
    const rebuilt: unknown[] = [];
    const { harness, liveTabs } = startDocsPage(async (method, ...args) => {
      if (method === 'rebuildIndex') {
        rebuilt.push(args[0]);
      }
      return method === 'pluginStatus'
        ? { clones: [] }
        : { document: null, message: null, title: 'index', canRebuild: false };
    });
    const rows = harness.state.publish(sessionsRowsSlot);
    const observersOfNone = harness.counts().observers;
    for (const sessionId of ['s1', 's2']) {
      rows.set(sessionId, projectRow(sessionId));
    }
    harness.emit('core.pageReady', null);
    for (const tab of liveTabs.values()) {
      tab.shown?.();
    }

    rows.set('s1', { ...projectRow('s1'), hostSessionId: 'moved' });
    await vi.waitFor(() => expect(rebuilt).toEqual([sessionSourceId('s1')]));

    const observersOfBoth = harness.counts().observers;
    rows.delete('s1');
    expect([...liveTabs.keys()]).toEqual(['s2']);
    expect(harness.counts().observers - observersOfNone).toBe(
      (observersOfBoth - observersOfNone) / 2,
    );
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

  it('start_TwoViews_CreatesOnePicker', () => {
    const { exportsTo, picker } = startDocsPage();

    exportsTo(createRegistrations()).addView('extra', {
      isVisible: () => false,
    });

    expect(picker.created).toHaveLength(1);
  });

  it('exports_ConsumerDisposed_DisposesItsView', () => {
    const { harness, exportsTo } = startDocsPage();
    const consumer = createRegistrations();
    const observersBefore = harness.counts().observers;
    exportsTo(consumer).addView('extra', { isVisible: () => false });
    expect(harness.counts().observers).toBeGreaterThan(observersBefore);

    consumer.dispose();

    expect(harness.counts().observers).toBe(observersBefore);
  });
});

// A whole doc of the user's at `path`, titled `title`, linking to each of
// `linksTo`.
function ownDoc(path: string, title: string, linksTo: string[] = []) {
  return {
    id: path,
    kind: 'instructions',
    source: 'global',
    owner: 'mine',
    repo: null,
    root: null,
    plugin: null,
    path,
    line: null,
    title,
    meta: {},
    walked: [],
    lastLoaded: null,
    headings: [],
    links: linksTo.map((target) => ({
      form: 'markdown' as const,
      raw: `[${target}](${target})`,
      target,
      line: 1,
      targetLine: null,
    })),
  };
}

const SECTIONED = '/p/sectioned.md';
const PLAIN = '/p/plain.md';
const GUIDE = '/p/guide.md';
const TARGET = '/p/target.md';

const TEXTS: Record<string, string> = {
  [SECTIONED]: '# Sectioned\n\n## Alpha\n\nOne.\n\n## Beta\n\nTwo.\n',
  [PLAIN]: 'No headings.\n',
  [GUIDE]: 'Links [target](target.md).\n',
  [TARGET]: 'No headings either.\n',
};

// Docs mode's machine view over an index of the docs in `TEXTS`, guide.md
// linking `guideLinks` (target.md), its right column laid out wide enough to
// be in sight. A path in `heldReads` reads as its promise settles.
function startMachineView() {
  const heldReads = new Map<string, Promise<string>>();
  const guideLinks = [TARGET];
  const page = startDocsPage(async (method, ...args) => {
    if (method === 'loadIndex' || method === 'rebuildIndex') {
      return {
        document: {
          schemaVersion: 5,
          generatedAt: '2026-11-05T00:00:00Z',
          entries: [
            ownDoc(SECTIONED, 'Sectioned'),
            ownDoc(PLAIN, 'Plain'),
            ownDoc(GUIDE, 'Guide', guideLinks),
            ownDoc(TARGET, 'Target'),
          ],
          contexts: [],
        },
        message: null,
        title: 'index',
        canRebuild: false,
      };
    }
    if (method === 'wikiMainPath') {
      return '/p/wiki/Main.md';
    }
    if (method === 'readDocIfPresent') {
      return null;
    }
    if (method === 'readDoc') {
      const path = args[0] as string;
      return heldReads.get(path) ?? TEXTS[path];
    }
    return { clones: [] };
  });
  const { harness } = page;
  const mode = harness.mode('docs.docs');
  const sheet = asFake(mode.element);
  const [aside] = findAll(sheet, 'docs-aside');
  Object.assign(aside, { offsetWidth: 200 });
  // Opens `path` by message and resolves once it shows.
  const open = async (path: string) => {
    const before = dataEmitted(harness, 'docs.docOpened').length;
    harness.send('openDoc', { path, line: null });
    await vi.waitFor(() =>
      expect(dataEmitted(harness, 'docs.docOpened').length).toBe(before + 1),
    );
  };
  const active = () =>
    (document as unknown as { activeElement: FakeElement | null })
      .activeElement;
  const isDocFocused = () => {
    const held = active();
    return held !== null && sheet.contains(held) && !aside.contains(held);
  };
  const docFocusedLogs = () =>
    harness.logs.filter(({ message }) => message.endsWith('doc focused'))
      .length;
  const ringedRows = () =>
    findAll(aside, 'is-cursor').map((row) => row.textContent);
  return {
    ...page,
    mode,
    aside,
    heldReads,
    guideLinks,
    open,
    active,
    isDocFocused,
    docFocusedLogs,
    ringedRows,
  };
}

// Focuses `target` as a click or a key does, its `focusin` reaching it and
// each element over it.
function focusIn(target: FakeElement) {
  (target as unknown as { focus(): void }).focus();
  for (let node: FakeElement | null = target; node; node = node.parentNode) {
    node.fire('focusin', { target });
  }
}

describe('docs view focus', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Breaks: `focusin` in the column not taking the column's scope, or not
  // drawing the ring on its cursor row.
  it('focusin_InsideTheColumn_TakesItsScopeAndRing', async () => {
    const view = startMachineView();
    await view.open(SECTIONED);

    focusIn(view.aside);

    expect({
      scope: view.harness.scope(),
      ringed: view.ringedRows(),
    }).toEqual({ scope: 'docs.aside', ringed: ['Sectioned'] });
    await view.harness.stop();
  });

  // Breaks: a shown view whose scope comes back as the column's leaving the
  // DOM focus nowhere, so the keys move a cursor that draws no ring.
  it('shown_ScopeComesBackAsTheColumns_FocusesTheColumn', async () => {
    const view = startMachineView();
    await view.open(SECTIONED);
    focusIn(view.aside);
    (view.aside as unknown as { blur(): void }).blur();
    view.aside.fire('focusout', { relatedTarget: null });

    view.mode.shown();

    expect({
      isColumnFocused: view.active() === view.aside,
      ringed: view.ringedRows(),
    }).toEqual({ isColumnFocused: true, ringed: ['Sectioned'] });
    await view.harness.stop();
  });

  // The column leaves sight (a doc with no column opens, or the window
  // narrows) while it holds the keys. Breaks: the doc taking DOM focus from
  // the right bar, or while the view is not active; or not taking it
  // otherwise, as when a Linked from row's open that would have focused it
  // fails or a later open replaces it, leaving focus on the body.
  it.each([
    { name: 'focus in the column', where: 'column', isDocFocused: true },
    { name: 'focus in the right bar', where: 'outside', isDocFocused: false },
    { name: 'the view not active', where: 'inactive', isDocFocused: false },
    {
      name: 'while a landing open fails',
      where: 'failedOpen',
      isDocFocused: true,
    },
    {
      name: 'while a later open replaces a landing open',
      where: 'supersededOpen',
      isDocFocused: true,
    },
  ])(
    'asideSightLost_ColumnLeavesSight $name',
    async ({ where, isDocFocused }) => {
      const view = startMachineView();
      const isLanding = where === 'failedOpen' || where === 'supersededOpen';
      await view.open(isLanding ? TARGET : SECTIONED);
      focusIn(view.aside);
      const rightBar = document.createElement('div') as unknown as FakeElement;
      if (where === 'outside') {
        (rightBar as unknown as { focus(): void }).focus();
      }
      if (where === 'inactive') {
        view.harness.state.publish(coreModeSlot).set('other.mode');
      }
      const logsBefore = view.docFocusedLogs();

      if (isLanding) {
        const guideRead = Promise.withResolvers<string>();
        view.heldReads.set(GUIDE, guideRead.promise);
        // Enter on Target's Linked from row opens Guide.
        view.harness.started().commands.asideOpen({ arg: undefined });
        if (where === 'failedOpen') {
          // A rebuilt index with Guide's link gone empties the column.
          view.guideLinks.length = 0;
          view.harness.setSideBarShown(true);
          view.harness.started().commands.rescan({ arg: undefined });
          await vi.waitFor(() => expect(view.aside.hidden).toBe(true));
          guideRead.reject(new Error('gone'));
        } else {
          await view.open(PLAIN);
          guideRead.resolve(TEXTS[GUIDE]);
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      } else {
        await view.open(PLAIN);
      }

      expect({
        isDocFocused: view.isDocFocused(),
        docFocusedLogs: view.docFocusedLogs() - logsBefore,
        isRightBarKept: where !== 'outside' || view.active() === rightBar,
      }).toEqual({
        isDocFocused,
        docFocusedLogs: isDocFocused ? 1 : 0,
        isRightBarKept: true,
      });
      await view.harness.stop();
    },
  );

  // Main takes the keys back from the right bar. Breaks: the column's branch
  // landing on the doc, or the side bar's overlay left open over main.
  it.each([
    { name: 'from the column', fromColumn: true, isColumnFocused: true },
    { name: 'from the doc', fromColumn: false, isColumnFocused: false },
  ])(
    'focusMain_ReturnsToMainsLastPane $name',
    async ({ fromColumn, isColumnFocused }) => {
      const view = startMachineView();
      await view.open(SECTIONED);
      if (fromColumn) {
        focusIn(view.aside);
      }
      (document.createElement('div') as unknown as { focus(): void }).focus();

      view.mode.focusMain();

      expect({
        isColumnFocused: view.active() === view.aside,
        isDocFocused: view.isDocFocused(),
        picks: view.harness.picks,
      }).toEqual({
        isColumnFocused,
        isDocFocused: !isColumnFocused,
        picks: ['docs.docs'],
      });
      await view.harness.stop();
    },
  );

  // Enter on the column's cursor row. Breaks: a section row leaving focus in
  // the column, or the doc focused twice as a linking doc with no column lands.
  it.each([
    { name: 'a section row', opened: SECTIONED },
    { name: 'a Linked from row', opened: TARGET },
  ])('asideOpen_FocusesTheDocOnce $name', async ({ opened }) => {
    const view = startMachineView();
    await view.open(opened);
    focusIn(view.aside);
    const logsBefore = view.docFocusedLogs();

    view.harness.started().commands.asideOpen({ arg: undefined });
    await vi.waitFor(() =>
      expect(view.docFocusedLogs() - logsBefore).toBeGreaterThan(0),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect({
      isDocFocused: view.isDocFocused(),
      docFocusedLogs: view.docFocusedLogs() - logsBefore,
    }).toEqual({ isDocFocused: true, docFocusedLogs: 1 });
    await view.harness.stop();
  });
});
