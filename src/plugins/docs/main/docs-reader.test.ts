import { describe, expect, it } from 'vitest';
import type { DocsContribution } from '../../../contracts/contributions';
import type {
  ContributionSource,
  Strategy,
} from '../../contributions/contract';
import { docsReader, mergeDocs } from './docs-reader';

const SOURCE: ContributionSource = {
  pluginName: 'notes',
  pluginKey: 'notes@m',
  version: '1.0.0',
  root: '/plugins/notes',
  harnessId: 'claude',
};

// The user's own plugin's `docs` section.
const USER_SECTION = {
  globalFolders: [
    {
      path: '~/wigley-agents',
      referenceFiles: ['decisions.md'],
      subfolders: ['learning', 'wiki'],
      skip: ['archive', 'learning/archive'],
    },
  ],
  wikiMain: '~/wigley-agents/wiki/Main.md',
  linkPrefixes: { 'wigley:': 'wigley@wigley-ai-marketplace' },
};

function strategy(
  id: string,
  value: DocsContribution,
): Strategy<DocsContribution> {
  return { id, label: id, source: { ...SOURCE, pluginName: id }, value };
}

describe('docsReader', () => {
  it('read_UserSection_ReadsWithEveryField', () => {
    expect(docsReader.read(USER_SECTION, SOURCE)).toEqual({
      ok: true,
      value: USER_SECTION,
    });
  });

  it('read_SparseSection_FillsListsAndPrefixesLeavesWikiMainOut', () => {
    expect(
      docsReader.read({ globalFolders: [{ path: '/n' }], other: 1 }, SOURCE),
    ).toEqual({
      ok: true,
      value: {
        globalFolders: [
          { path: '/n', referenceFiles: [], subfolders: [], skip: [] },
        ],
        linkPrefixes: {},
      },
    });
  });

  it.each<{ section: unknown; reason: string }>([
    { section: [], reason: '"docs" is not an object' },
    {
      section: { globalFolders: '~/x' },
      reason: 'globalFolders: not a list of folders',
    },
    {
      section: { globalFolders: [{ path: 'x' }] },
      reason: 'globalFolders[0].path: not a ~ or absolute path',
    },
    {
      section: { globalFolders: [{ path: '~/x', referenceFiles: ['/a.md'] }] },
      reason: 'globalFolders[0].referenceFiles: not a list of relative paths',
    },
    {
      section: { globalFolders: [{ path: '~/x', subfolders: ['../y'] }] },
      reason: 'globalFolders[0].subfolders: not a list of relative paths',
    },
    {
      section: { globalFolders: [{ path: '~/x', skip: 'archive' }] },
      reason: 'globalFolders[0].skip: not a list of relative paths',
    },
    {
      section: { wikiMain: '~/wiki/Main.txt' },
      reason: 'wikiMain: not a ~ or absolute .md path',
    },
    {
      section: { linkPrefixes: { wigley: 'wigley@m' } },
      reason: 'linkPrefixes: not { "<prefix>:": "<plugin key>" }',
    },
    {
      section: { linkPrefixes: { 'w:': 'wigley' } },
      reason: 'linkPrefixes: not { "<prefix>:": "<plugin key>" }',
    },
  ])('read refuses with "$reason"', ({ section, reason }) => {
    expect(docsReader.read(section, SOURCE)).toEqual({
      ok: false,
      reasons: [reason],
    });
  });
});

describe('mergeDocs', () => {
  it('mergeDocs_TwoStrategies_UnionFirstWikiMainAndDuplicateLogged', () => {
    const logged: string[] = [];
    const first = strategy('mine', {
      globalFolders: [{ path: '~/a', referenceFiles: ['r.md'] }],
      linkPrefixes: { 'a:': 'a@m' },
    });
    const second = strategy('theirs', {
      globalFolders: [{ path: '~/a' }, { path: '~/b' }],
      wikiMain: '~/b/Main.md',
      linkPrefixes: { 'b:': 'b@m' },
    });

    const merged = mergeDocs([first, second], (line) => logged.push(line));

    expect(merged).toEqual({
      globalFolders: [
        { path: '~/a', referenceFiles: ['r.md'], subfolders: [], skip: [] },
        { path: '~/b', referenceFiles: [], subfolders: [], skip: [] },
      ],
      wikiMain: '~/b/Main.md',
      linkPrefixes: { 'a:': 'a@m', 'b:': 'b@m' },
    });
    expect(logged).toEqual([
      'docs: global folder ~/a from theirs dropped: mine lists it',
    ]);
  });

  it('mergeDocs_PrefixClash_FirstKeptAndLogged', () => {
    const logged: string[] = [];
    const strategies = [
      strategy('mine', {
        wikiMain: '~/a/Main.md',
        linkPrefixes: { 'w:': 'w@m' },
      }),
      strategy('theirs', {
        wikiMain: '~/b/Main.md',
        linkPrefixes: { 'w:': 'w@other' },
      }),
    ];

    const merged = mergeDocs(strategies, (line) => logged.push(line));

    expect(merged.wikiMain).toBe('~/a/Main.md');
    expect(merged.linkPrefixes).toEqual({ 'w:': 'w@m' });
    expect(logged).toEqual([
      'docs: link prefix w: from theirs dropped: mine maps it',
    ]);
  });

  it('mergeDocs_NoStrategies_Empty', () => {
    expect(mergeDocs([], () => undefined)).toEqual({
      globalFolders: [],
      wikiMain: null,
      linkPrefixes: {},
    });
  });
});
