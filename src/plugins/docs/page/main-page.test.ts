import { describe, expect, it, vi } from 'vitest';
import type { PageChannel } from '../../../contracts/plugin';
import { posixPaths } from '../../../shared/paths/posix-paths';
import type { DocsChannel, IndexEntry, RecentChange } from '../contract';
import { loadedAt } from '../loaded-time';
import type { TreeNode } from '../tree';
import { parseWikiMain } from '../wiki-main';
import {
  createRecentReader,
  type EmptyMainFocusState,
  emptyMainTakesFocus,
  isMainPageStale,
  linkedPages,
  MAIN_STARTER_TEXT,
  mainOpenStep,
  type MainPageState,
  type MainShowCause,
  recentRows,
} from './main-page';

const AT = '2026-11-05T12:00:00Z';
const NOW = Date.parse(AT) + 3 * 3_600_000;

function change(paths: string[], sha = 'abc'): RecentChange {
  return { sha, subject: `subject ${sha}`, at: AT, paths };
}

// Lets every settled promise's chain run.
const settled = () => new Promise((resolve) => setTimeout(resolve));

describe('the Main page against its file', () => {
  it.each([
    {
      given: 'the file open and on disk',
      cause: 'picked',
      isFileOpen: true,
      isEmptyPageShown: false,
      isFileTrashedFromPane: false,
      file: 'exists',
      step: 'alreadyShows',
      isStale: false,
    },
    {
      given: 'the file open and gone from disk',
      cause: 'picked',
      isFileOpen: true,
      isEmptyPageShown: false,
      isFileTrashedFromPane: false,
      file: 'absent',
      step: 'showEmptyPage',
      isStale: true,
    },
    {
      given: 'the empty page over no file',
      cause: 'picked',
      isFileOpen: false,
      isEmptyPageShown: true,
      isFileTrashedFromPane: false,
      file: 'absent',
      step: 'alreadyShows',
      isStale: false,
    },
    {
      given: 'the empty page over a file that appeared',
      cause: 'fileChanged',
      isFileOpen: false,
      isEmptyPageShown: true,
      isFileTrashedFromPane: false,
      file: 'exists',
      step: 'openFile',
      isStale: true,
    },
    {
      given: 'another doc, with the file on disk',
      cause: 'picked',
      isFileOpen: false,
      isEmptyPageShown: false,
      isFileTrashedFromPane: false,
      file: 'exists',
      step: 'openFile',
      isStale: false,
    },
    {
      given: 'another doc, with no file',
      cause: 'picked',
      isFileOpen: false,
      isEmptyPageShown: false,
      isFileTrashedFromPane: false,
      file: 'absent',
      step: 'showEmptyPage',
      isStale: false,
    },
    {
      given: 'the pane emptied by the trash, the read landed after',
      cause: 'fileChanged',
      isFileOpen: false,
      isEmptyPageShown: false,
      isFileTrashedFromPane: true,
      file: 'absent',
      step: 'showEmptyPage',
      isStale: true,
    },
    {
      given: 'the pane emptied by the trash, the read not landed yet',
      cause: 'picked',
      isFileOpen: false,
      isEmptyPageShown: false,
      isFileTrashedFromPane: true,
      file: 'exists',
      step: 'openFile',
      isStale: false,
    },
    {
      given: 'the file open and its read rejected',
      cause: 'picked',
      isFileOpen: true,
      isEmptyPageShown: false,
      isFileTrashedFromPane: false,
      file: 'unreadable',
      step: 'alreadyShows',
      isStale: false,
    },
    {
      given: 'the empty page and a read rejected',
      cause: 'picked',
      isFileOpen: false,
      isEmptyPageShown: true,
      isFileTrashedFromPane: false,
      file: 'unreadable',
      step: 'alreadyShows',
      isStale: false,
    },
    {
      given:
        'gh over neither page, another doc or a blank pane, a read rejected',
      cause: 'picked',
      isFileOpen: false,
      isEmptyPageShown: false,
      isFileTrashedFromPane: false,
      file: 'unreadable',
      step: 'openFile',
      isStale: false,
    },
    {
      given: 'the pane emptied by the trash and a read rejected',
      cause: 'picked',
      isFileOpen: false,
      isEmptyPageShown: false,
      isFileTrashedFromPane: true,
      file: 'unreadable',
      step: 'openFile',
      isStale: false,
    },
    {
      given: 'a first show on a blank pane, the first read rejected',
      cause: 'firstShow',
      isFileOpen: false,
      isEmptyPageShown: false,
      isFileTrashedFromPane: false,
      file: 'unreadable',
      step: 'leavePane',
      isStale: false,
    },
    {
      given: 'a first show, rejected first then absent',
      cause: 'firstShow',
      isFileOpen: false,
      isEmptyPageShown: false,
      isFileTrashedFromPane: false,
      file: 'absent',
      step: 'showEmptyPage',
      isStale: false,
    },
    {
      given: 'a first show, rejected first then a text',
      cause: 'firstShow',
      isFileOpen: false,
      isEmptyPageShown: false,
      isFileTrashedFromPane: false,
      file: 'exists',
      step: 'openFile',
      isStale: false,
    },
    {
      given: 'the file open, a known text then rejected then absent',
      cause: 'fileChanged',
      isFileOpen: true,
      isEmptyPageShown: false,
      isFileTrashedFromPane: false,
      file: 'absent',
      step: 'showEmptyPage',
      isStale: true,
    },
  ] satisfies (MainPageState & {
    given: string;
    cause: MainShowCause;
    step: string;
    isStale: boolean;
  })[])(
    '$given → $step',
    ({ cause, step, isStale, given: _given, ...state }) => {
      expect(mainOpenStep(state, cause)).toBe(step);
      expect(isMainPageStale(state)).toBe(isStale);
    },
  );
});

describe('emptyMainTakesFocus', () => {
  const FREE = {
    isViewActive: true,
    isFilterOpen: false,
    isDialogOpen: false,
  };

  it.each([
    { given: 'gh', cause: 'picked', ...FREE, takes: true },
    {
      given: 'gh, on an inactive view with a filter and a dialog open',
      cause: 'picked',
      isViewActive: false,
      isFilterOpen: true,
      isDialogOpen: true,
      takes: true,
    },
    { given: 'a free first show', cause: 'firstShow', ...FREE, takes: true },
    {
      given: 'a first show on an inactive view',
      cause: 'firstShow',
      ...FREE,
      isViewActive: false,
      takes: false,
    },
    {
      given: 'a first show under an open filter',
      cause: 'firstShow',
      ...FREE,
      isFilterOpen: true,
      takes: false,
    },
    {
      given: 'a first show under an open dialog',
      cause: 'firstShow',
      ...FREE,
      isDialogOpen: true,
      takes: false,
    },
    { given: 'a file change', cause: 'fileChanged', ...FREE, takes: false },
  ] satisfies (EmptyMainFocusState & { given: string; takes: boolean })[])(
    '$given → $takes',
    ({ takes, given: _given, ...state }) => {
      expect(emptyMainTakesFocus(state)).toBe(takes);
    },
  );
});

describe('linkedPages', () => {
  it('linkedPages_WalksLeavesOnly', () => {
    const leaf = (id: string, title: string, entryId: string): TreeNode => ({
      type: 'entry',
      id,
      title,
      entryId,
    });
    const shelf = (id: string, children: TreeNode[]): TreeNode => ({
      type: 'group',
      id,
      title: id,
      folder: null,
      role: { type: 'other' },
      children,
    });
    const tree = [
      shelf('first', [
        { type: 'wikiLabel', id: 'label', title: 'Label' },
        leaf('l1', 'One', 'e1'),
        {
          type: 'wikiLink',
          id: 'link',
          title: 'Dangling',
          target: { type: 'path', path: 'gone.md' },
          count: null,
          isDangling: true,
        },
        leaf('l2', 'Again', 'e1'),
        leaf('l3', 'Gone', 'gone'),
      ]),
      shelf('second', [leaf('l4', 'Two', 'e2')]),
    ];
    const entries: Record<string, Pick<IndexEntry, 'path'>> = {
      e1: { path: '/r/one.md' },
      e2: { path: '/r/two.md' },
    };

    const pages = linkedPages(tree, (id) => entries[id] as IndexEntry);

    expect(pages).toEqual([
      { title: 'One', path: '/r/one.md' },
      { title: 'Two', path: '/r/two.md' },
    ]);
  });
});

describe('recentRows', () => {
  const ONE = { title: 'One', path: '/r/a.md' };
  const TWO = { title: 'Two', path: '/r/b.md' };

  it.each([
    { paths: ['/r/a.md'], pages: [ONE], expected: [ONE] },
    { paths: ['/r/b.md', '/r/a.md'], pages: [ONE, TWO], expected: [TWO, ONE] },
    { paths: ['/r/x.md', '/r/a.md'], pages: [ONE], expected: [ONE] },
    { paths: ['/r/a.md', '/r/a.md'], pages: [ONE], expected: [ONE] },
  ])('recentRows_MapsPathsToTitles $paths', ({ paths, pages, expected }) => {
    const rows = recentRows([change(paths)], pages, NOW, posixPaths);

    expect(rows).toEqual([
      {
        sha: 'abc',
        subject: 'subject abc',
        time: { text: '3h', title: loadedAt(AT) },
        pages: expected,
      },
    ]);
  });
});

describe('createRecentReader', () => {
  const PAGES = [
    { title: 'One', path: '/r/a.md' },
    { title: 'Two', path: '/r/b.md' },
  ];

  // A reader whose `recentChanges` calls wait in `calls` for the test to settle.
  function setUp() {
    const calls: {
      paths: string[];
      answer: PromiseWithResolvers<RecentChange[]>;
    }[] = [];
    const channel = {
      invoke: (_name: string, paths: string[]) => {
        const answer = Promise.withResolvers<RecentChange[]>();
        calls.push({ paths, answer });
        return answer.promise;
      },
    } as unknown as PageChannel<DocsChannel>;
    const show = vi.fn();
    const logs: string[] = [];
    const reader = createRecentReader({
      channel,
      pages: () => PAGES,
      now: () => NOW,
      paths: posixPaths,
      log: (line) => logs.push(line),
      show,
    });
    return { calls, show, logs, reader };
  }

  it('refresh_AsksThePagesPaths', () => {
    const { calls, reader } = setUp();

    reader.refresh();

    expect(calls[0].paths).toEqual(['/r/a.md', '/r/b.md']);
  });

  it('refresh_OlderAnswerLandsLate_DropsIt', async () => {
    const { calls, show, reader } = setUp();
    reader.refresh();
    reader.refresh();

    calls[1].answer.resolve([change(['/r/a.md'], 'new')]);
    await settled();
    calls[0].answer.resolve([change(['/r/a.md'], 'old')]);
    await settled();

    expect(
      show.mock.calls.map(([input]) =>
        input.rows.map((row: { sha: string }) => row.sha),
      ),
    ).toEqual([['new']]);
  });

  it('refresh_CallRejects_DrawsNothing', async () => {
    const { calls, show, logs, reader } = setUp();
    reader.refresh();

    calls[0].answer.reject(new Error('boom'));
    await settled();

    expect({ shown: show.mock.calls, logs }).toEqual({
      shown: [[null]],
      logs: ['recent changes not read: boom'],
    });
  });

  it('clear_AnswerInFlight_DrawsNothing', async () => {
    const { calls, show, reader } = setUp();
    reader.refresh();

    reader.clear();
    calls[0].answer.resolve([change(['/r/a.md'])]);
    await settled();

    expect(show.mock.calls).toEqual([[null]]);
  });

  it('refresh_EmptyAnswer_ShowsNoRows', async () => {
    const { calls, show, logs, reader } = setUp();
    reader.refresh();

    calls[0].answer.resolve([]);
    await settled();

    expect({ shown: show.mock.calls, logs }).toEqual({
      shown: [[{ rows: [] }]],
      logs: ['recent changes: 0 commits'],
    });
  });
});

describe('MAIN_STARTER_TEXT', () => {
  it('MAIN_STARTER_TEXT_NamesNoShelf', () => {
    expect(parseWikiMain(MAIN_STARTER_TEXT)).toEqual([]);
  });
});
