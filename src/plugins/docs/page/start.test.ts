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
import type { DocsPageExports } from '../contract';
import { docsPagePart } from './start';
import { fakeListPickerService } from '../../../shared/page/fake-list-picker-service.test-support';

function startDocsPage(
  invoke?: (method: string, ...args: unknown[]) => Promise<unknown>,
  anchorDispose?: () => void,
) {
  installFocusFakeDom(vi.stubGlobal);
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
    anchorDispose,
    firstModeTaken: true,
    invoke,
  });
  const exportsTo = (consumer: Registrations) =>
    harness.started().exports?.(consumer) as DocsPageExports;
  return { harness, exportsTo, picker };
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

  it('stop_FreshStart_LeavesNoLiveRegistration', async () => {
    const { harness } = startDocsPage();

    await harness.stop();

    expect(harness.counts()).toEqual(noCounts);
  });

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
