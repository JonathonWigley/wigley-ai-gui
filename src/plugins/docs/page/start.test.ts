import { afterEach, describe, expect, it, vi } from 'vitest';
import { coreModeSlot } from '../../../contracts/core-state';
import type { Registrations } from '../../../contracts/disposable';
import { NO_FENCES } from '../../../shared/page/markdown-mount.test-support';
import { installFocusFakeDom } from '../../../shared/page/test-dom';
import {
  dataEmitted,
  noCounts,
  startPagePart,
} from '../../../shared/plugin-part-harness.test-support';
import { createRegistrations } from '../../../shared/registrations';
import { sessionsRowsSlot } from '../../sessions/contract';
import { sessionRow } from '../../sessions/contract.test-support';
import {
  type DocsEdits,
  type DocsPageExports,
  type DocsPlace,
  docsPlaceSlot,
  MACHINE_SOURCE_ID,
  sessionSourceId,
} from '../contract';
import type { EditorHost } from '../../../contracts/editor';
import { docsPagePart } from './start';
import { fakeListPickerService } from '../../../shared/page/fake-list-picker-service.test-support';
import type { DocsView } from './docs-view';

// Each click method a docs view ran, by its view id: a click's command must
// reach the view its arg names.
const viewCalls = vi.hoisted(() => [] as [string, string, unknown][]);

vi.mock('./docs-view', async (importOriginal) => {
  const original = await importOriginal<typeof import('./docs-view')>();
  const clickMethods = [
    'openNode',
    'followLink',
    'openDocAt',
    'openRecentPage',
    'answerConfirm',
    'switchTreeView',
    'openListRow',
    'createMain',
    'editSectionAt',
  ] as const;
  return {
    ...original,
    createDocsView: (deps: Parameters<typeof original.createDocsView>[0]) => {
      const view: DocsView = original.createDocsView(deps);
      for (const method of clickMethods) {
        const real = view[method] as (arg: never) => void;
        view[method] = ((arg: never) => {
          viewCalls.push([deps.viewId, method, arg]);
          real(arg);
        }) as never;
      }
      return view;
    },
  };
});

const projectRow = (sessionId: string) =>
  sessionRow(sessionId, { label: sessionId, projectDir: '/p' });

// A document editor host whose editors hold the text set or typed last.
function documentEditors(): EditorHost {
  return {
    createDocument(_parent: HTMLElement, text: string) {
      let current = text;
      return {
        text: () => current,
        setText: (next: string) => {
          current = next;
        },
        focus: () => undefined,
        blur: () => undefined,
        destroy: () => undefined,
      };
    },
  } as unknown as EditorHost;
}

// An index entry for the doc at `path`.
function entryAt(path: string) {
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
    title: path,
    meta: {},
    walked: [],
    lastLoaded: null,
    headings: [],
    links: [],
  };
}

// Main's side over an index listing `paths` for every source, each doc reading
// `# Doc` but `/p/gone.md`, which throws; each read path goes to `readDocs`.
function servingIndexOf(paths: readonly string[], readDocs: unknown[]) {
  return async (method: string, ...args: unknown[]): Promise<unknown> => {
    if (method === 'loadIndex') {
      return {
        document: {
          schemaVersion: 5,
          generatedAt: '2026-11-05T00:00:00Z',
          entries: paths.map(entryAt),
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
  };
}

const placeAt = (
  openPath: string | null,
  edits: DocsEdits | null = null,
): DocsPlace => ({
  openPath,
  expanded: [],
  selectedId: null,
  filter: '',
  edits,
});

function startDocsPage(
  invoke?: (method: string, ...args: unknown[]) => Promise<unknown>,
  anchorDispose?: () => void,
) {
  installFocusFakeDom(vi.stubGlobal);
  const picker = fakeListPickerService();
  const harness = startPagePart(docsPagePart, {
    services: {
      picker,
      editor: documentEditors(),
      markdown: {
        block: (text) => text,
        inline: (text) => text,
        document: async (text) => text,
        ...NO_FENCES,
      },
    },
    anchorDispose,
    firstModeTaken: true,
    invoke,
  });
  const exportsTo = (consumer: Registrations) =>
    harness.started().exports?.(consumer) as DocsPageExports;
  return { harness, exportsTo, picker };
}

type DocsPage = ReturnType<typeof startDocsPage>;

// Stops the page, leaves `places` in the docs place slot as the last page's,
// and holds the rows of `sessionIds`, each `rowOf` its id, before the page
// starts again; resolves to the rows' writer.
async function reloadWith(
  { harness }: DocsPage,
  places: Record<string, DocsPlace>,
  sessionIds: readonly string[],
  rowOf = projectRow,
) {
  await harness.stop();
  const seed = harness.state.publish(docsPlaceSlot);
  for (const [sourceId, place] of Object.entries(places)) {
    seed.set(sourceId, place);
  }
  seed.dispose();
  const rows = harness.state.publish(sessionsRowsSlot);
  for (const sessionId of sessionIds) {
    rows.set(sessionId, rowOf(sessionId));
  }
  await harness.restart();
  return rows;
}

// The docs view a session's Docs tab adds over that session's source.
const sessionView = ({ exportsTo }: DocsPage, sessionId: string) =>
  exportsTo(createRegistrations()).addView(sessionSourceId(sessionId), {
    isVisible: () => true,
  });

const openedPaths = ({ harness }: DocsPage) =>
  dataEmitted(harness, 'docs.docOpened').map(
    (data) => (data as { path: string }).path,
  );

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
      const readDocs: unknown[] = [];
      const page = startDocsPage(servingIndexOf([path], readDocs));
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

  it('stop_FreshStart_LeavesNoLiveRegistration', async () => {
    const { harness } = startDocsPage();

    await harness.stop();

    expect(harness.counts()).toEqual(noCounts);
  });

  it.each([
    {
      command: 'openNode' as const,
      arg: { nodeId: 'entry:x' },
      reached: 'entry:x',
    },
    {
      command: 'followLink' as const,
      arg: { href: 'a.md', title: 'A' },
      reached: { href: 'a.md', title: 'A' },
    },
    {
      command: 'openDocAt' as const,
      arg: { path: '/p/a.md', line: 4 },
      reached: { path: '/p/a.md', line: 4 },
    },
    {
      command: 'openRecentPage' as const,
      arg: { path: '/p/a.md' },
      reached: '/p/a.md',
    },
    {
      command: 'answerConfirm' as const,
      arg: { answer: 'yes' },
      reached: 'yes',
    },
    { command: 'switchTreeView' as const, arg: {}, reached: undefined },
    {
      command: 'openListRow' as const,
      arg: { entryId: 'entry:y' },
      reached: 'entry:y',
    },
    { command: 'createMain' as const, arg: {}, reached: undefined },
    {
      command: 'editSectionAt' as const,
      arg: { anchor: 'intro' },
      reached: 'intro',
    },
  ])(
    'clickCommand_ViewIdOfAnAddedView_ActsOnThatView ($command)',
    async ({ command, arg, reached }) => {
      const { harness, exportsTo } = startDocsPage();
      exportsTo(createRegistrations()).addView('extra', {
        isVisible: () => false,
      });
      harness.state.publish(coreModeSlot).set('docs.docs');
      viewCalls.length = 0;
      const run = harness.started().commands[command] as (context: {
        arg: unknown;
      }) => void;

      run({ arg: { viewId: 'view:1', ...arg } });

      expect(viewCalls).toEqual([['view:1', command, reached]]);
      await harness.stop();
    },
  );

  it('clickCommand_UnknownView_LogsAndActsOnNoView', async () => {
    const { harness } = startDocsPage();
    viewCalls.length = 0;

    harness.started().commands.openNode({
      arg: { viewId: 'view:9', nodeId: 'entry:x' },
    });

    expect({
      calls: viewCalls,
      logged: harness.logs.some(
        ({ message }) => message === 'openNode for unknown view view:9 ignored',
      ),
    }).toEqual({ calls: [], logged: true });
    await harness.stop();
  });

  it('answerConfirm_UnknownAnswer_LogsAndAnswersNothing', async () => {
    const { harness } = startDocsPage();

    harness.started().commands.answerConfirm({
      arg: { viewId: 'machine', answer: 'maybe' },
    });

    expect(
      harness.logs.filter(({ message }) => message.includes('trash answer')),
    ).toEqual([expect.objectContaining({ message: 'no trash answer maybe' })]);
    await harness.stop();
  });

  it('reload_reopens_the_doc_per_view', async () => {
    const page = startDocsPage(
      servingIndexOf(['/p/machine.md', '/p/session.md'], []),
    );
    const { harness } = page;
    openByMessage(page, '/p/machine.md');
    await vi.waitFor(() => expect(openedPaths(page)).toHaveLength(1));
    const openedBefore = openedPaths(page).length;

    await reloadWith(
      page,
      { [sessionSourceId('s1')]: placeAt('/p/session.md') },
      ['s1'],
    );
    harness.started().commands.showMode({ arg: undefined });
    sessionView(page, 's1').shown();

    await vi.waitFor(() =>
      expect(openedPaths(page).slice(openedBefore).sort()).toEqual([
        '/p/machine.md',
        '/p/session.md',
      ]),
    );
    await harness.stop();
  });

  it.each([
    { case: 'gone while no page ran', rowsAtReload: ['kept'] },
    { case: 'removed while the page runs', rowsAtReload: ['gone', 'kept'] },
  ])(
    'rowGone_DeletesItsPlace_KeepsTheOthers ($case)',
    async ({ rowsAtReload }) => {
      const page = startDocsPage();
      const { harness } = page;

      const rows = await reloadWith(
        page,
        {
          [MACHINE_SOURCE_ID]: placeAt('/p/machine.md'),
          [sessionSourceId('gone')]: placeAt('/p/gone.md'),
          [sessionSourceId('kept')]: placeAt('/p/kept.md'),
        },
        rowsAtReload,
      );
      rows.delete('gone');

      expect(
        [...harness.state.read(docsPlaceSlot, 'test').all().keys()].sort(),
      ).toEqual([MACHINE_SOURCE_ID, sessionSourceId('kept')].sort());
      await harness.stop();
    },
  );

  // The tab's view outlives the row for a moment: docs and the tab each follow
  // the rows, in either order.
  it('rowGone_ItsViewDisposedAfter_WritesThePlaceNoMore', async () => {
    const page = startDocsPage(servingIndexOf(['/p/open.md'], []));
    const { harness } = page;
    const rows = await reloadWith(
      page,
      { [sessionSourceId('gone')]: placeAt('/p/open.md') },
      ['gone'],
    );
    const view = sessionView(page, 'gone');
    view.shown();
    await vi.waitFor(() => expect(openedPaths(page)).toEqual(['/p/open.md']));

    rows.delete('gone');
    view.dispose();

    expect([...harness.state.read(docsPlaceSlot, 'test').all().keys()]).toEqual(
      [],
    );
    await harness.stop();
  });

  const restoredEdits = {
    path: '/p/kept.md',
    text: '# Doc\nedited',
    baseText: '# Doc',
  };

  it.each([
    { case: 'view shown, edits back in the editor', isShown: true },
    { case: 'view never shown, restore waiting', isShown: false },
  ])('restoredEdits_CountAsUnsaved ($case)', async ({ isShown }) => {
    const page = startDocsPage(servingIndexOf(['/p/kept.md'], []));
    const { harness } = page;

    await reloadWith(
      page,
      { [sessionSourceId('s1')]: placeAt('/p/kept.md', restoredEdits) },
      ['s1'],
    );
    const view = sessionView(page, 's1');
    if (isShown) {
      view.shown();
      await vi.waitFor(() =>
        expect(
          harness.logs.some(({ message }) =>
            message.startsWith('restored edits on'),
          ),
        ).toBe(true),
      );
    }

    expect(view.hasUnsavedEdits()).toBe(true);
    await harness.stop();
  });

  const planEdits = { path: '/w/plan.md', text: 'new', baseText: 'old' };

  it.each([
    { case: 'NoEdits_Null', sourceId: null, expected: null },
    {
      case: 'DocsModeEdits_NamesDocsMode',
      sourceId: MACHINE_SOURCE_ID,
      expected: 'Save or discard the edits to plan.md in Docs mode first',
    },
    {
      case: 'SessionTabEdits_NamesTheSession',
      sourceId: sessionSourceId('s1'),
      expected:
        "Save or discard the edits to plan.md in gamma 2's Docs tab first",
    },
    // The restore waits for the tab to show, so its edits are still pending.
    {
      case: 'SessionTabEditsRestorePending_NamesTheSession',
      sourceId: sessionSourceId('s1'),
      showsTab: false,
      expected:
        "Save or discard the edits to plan.md in gamma 2's Docs tab first",
    },
  ])('mayStop_$case', async ({ sourceId, showsTab = true, expected }) => {
    const page = startDocsPage(servingIndexOf(['/w/plan.md'], []));
    const { harness } = page;

    await reloadWith(
      page,
      sourceId === null ? {} : { [sourceId]: placeAt('/w/plan.md', planEdits) },
      ['s1'],
      (sessionId) =>
        sessionRow(sessionId, { label: 'gamma 2', projectDir: '/p' }),
    );
    harness.started().commands.showMode({ arg: undefined });
    const view = sessionView(page, 's1');
    if (showsTab) {
      view.shown();
    }
    if (sourceId !== null && showsTab) {
      await vi.waitFor(() =>
        expect(
          harness.logs.some(({ message }) =>
            message.startsWith('restored edits on'),
          ),
        ).toBe(true),
      );
    }

    expect(harness.started().mayStop?.()).toBe(expected);
    await harness.stop();
  });

  // `/p/gone.md`'s read throws; `/p/unlisted.md` is no indexed doc.
  it.each([
    { case: 'read failed', path: '/p/gone.md' },
    { case: 'not indexed', path: '/p/unlisted.md' },
  ])(
    'restoredEdits_OpenFails_ToastsTheDroppedEdits ($case)',
    async ({ path }) => {
      const page = startDocsPage(servingIndexOf(['/p/gone.md'], []));
      const { harness } = page;

      await reloadWith(
        page,
        {
          [sessionSourceId('s1')]: placeAt(path, { ...restoredEdits, path }),
        },
        ['s1'],
      );
      sessionView(page, 's1').shown();

      await vi.waitFor(() =>
        expect(
          harness.logs.filter(({ message }) =>
            message.includes('edits not restored'),
          ),
        ).toEqual([
          expect.objectContaining({
            message: `toast error: Unsaved edits not restored: ${path}`,
          }),
        ]),
      );
      await harness.stop();
    },
  );

  it('restorePending_TreeDraws_KeepsTheLastPagesPlace', async () => {
    const readDocs: unknown[] = [];
    const serve = servingIndexOf(['/p/kept.md'], readDocs);
    // The restore's doc read never settles, so the restore stays pending.
    const page = startDocsPage((method, ...args) => {
      if (method === 'readDoc') {
        readDocs.push(args[0]);
        return new Promise(() => undefined);
      }
      return serve(method, ...args);
    });
    const { harness } = page;
    const saved = {
      ...placeAt('/p/kept.md', restoredEdits),
      expanded: ['shelf:x'],
    };

    await reloadWith(page, { [sessionSourceId('s1')]: saved }, ['s1']);
    sessionView(page, 's1').shown();
    await vi.waitFor(() => expect(readDocs).toEqual(['/p/kept.md']));

    expect(
      harness.state
        .read(docsPlaceSlot, 'test')
        .all()
        .get(sessionSourceId('s1')),
    ).toEqual(saved);
    await harness.stop();
  });

  it.each([
    { case: 'view shown', isShown: true, tracked: 1 },
    { case: 'view never shown', isShown: false, tracked: 0 },
  ])(
    'restoredOpen_TrackedUntilItsDocReadSettles ($case)',
    async ({ isShown, tracked }) => {
      const serve = servingIndexOf(['/p/kept.md'], []);
      const read = Promise.withResolvers<string>();
      const page = startDocsPage((method, ...args) =>
        method === 'readDoc' ? read.promise : serve(method, ...args),
      );
      const { harness } = page;
      const trackedBefore = harness.restores.length;

      await reloadWith(
        page,
        { [sessionSourceId('s1')]: placeAt('/p/kept.md') },
        ['s1'],
      );
      const view = sessionView(page, 's1');
      if (isShown) {
        view.shown();
      }
      const restores = harness.restores.slice(trackedBefore);
      let settled = 0;
      for (const restore of restores) {
        void restore.then(() => {
          settled += 1;
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
      const settledBeforeRead = settled;
      read.resolve('# Doc');
      await Promise.all(restores);

      expect([restores.length, settledBeforeRead, settled]).toEqual([
        tracked,
        0,
        tracked,
      ]);
      await harness.stop();
    },
  );

  it.each([
    { state: 'before its first show', isShown: false, rebuilt: [] },
    { state: 'after its first show', isShown: true, rebuilt: ['source'] },
  ])(
    'sourceReplaced_AddedView_RebuildsOnlyOnceShown ($state)',
    async ({ isShown, rebuilt }) => {
      const invoked: unknown[][] = [];
      const { harness, exportsTo } = startDocsPage(async (method, ...args) => {
        invoked.push([method, ...args]);
        return method === 'pluginStatus'
          ? { clones: [] }
          : {
              document: null,
              message: null,
              title: 'index',
              canRebuild: false,
            };
      });
      const view = exportsTo(createRegistrations()).addView('source', {
        isVisible: () => true,
      });
      if (isShown) {
        view.shown();
        await vi.waitFor(() =>
          expect(invoked).toContainEqual(['loadIndex', 'source']),
        );
      }

      view.sourceReplaced();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(
        invoked
          .filter(([method]) => method === 'rebuildIndex')
          .map(([, sourceId]) => sourceId),
      ).toEqual(rebuilt);
      await harness.stop();
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

  it('start_TwoViews_CreatesOnePicker', () => {
    const { exportsTo, picker } = startDocsPage();

    exportsTo(createRegistrations()).addView('extra', {
      isVisible: () => false,
    });

    expect(picker.created).toHaveLength(1);
  });

  it.each([
    { state: 'no dispose throws', error: null },
    { state: 'one anchor dispose throws', error: 'anchor gone' },
  ])(
    'exports_ConsumerDisposed_DisposesEveryView ($state)',
    async ({ error }) => {
      let isAnchorThrowOwed = false;
      const { harness, exportsTo } = startDocsPage(undefined, () => {
        if (isAnchorThrowOwed) {
          isAnchorThrowOwed = false;
          throw new Error('anchor gone');
        }
      });
      const consumer = createRegistrations();
      const observersBefore = harness.counts().observers;
      for (const sourceId of ['s1', 's2']) {
        exportsTo(consumer).addView(sourceId, { isVisible: () => false });
      }
      expect(harness.counts().observers).toBeGreaterThan(observersBefore);
      isAnchorThrowOwed = error !== null;

      const disposing = () => consumer.dispose();

      if (error === null) {
        expect(disposing).not.toThrow();
      } else {
        expect(disposing).toThrow(error);
      }
      expect(harness.counts().observers).toBe(observersBefore);
      await harness.stop();
      expect(harness.counts()).toEqual(noCounts);
    },
  );
});
