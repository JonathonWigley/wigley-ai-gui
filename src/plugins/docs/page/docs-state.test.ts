import { describe, expect, it } from 'vitest';
import { harnessInfo } from '../../../shared/agent-harness-registry.test-support';
import { fakeFuzzyMatcher } from '../../../shared/fake-fuzzy-matcher.test-support';
import { posixPaths } from '../../../shared/paths/posix-paths';
import { windowsPaths } from '../../../shared/paths/windows-paths';
import {
  type CloneStatus,
  type FileStatus,
  type IndexContext,
  type IndexDocument,
  type IndexEntry,
  type IndexHeading,
  UNSAVED_TEXT,
} from '../contract';
import type {
  GroupRole,
  TreeGroup,
  TreeHeadingMatch,
  TreeLeaf,
  TreeNode,
  TreeWikiLabel,
  TreeWikiLink,
} from '../tree';
import {
  applyChange,
  changeableEntry,
  changedPaths,
  chips,
  codeFence,
  contextChoices,
  defaultExpandedIds,
  detailFields,
  edgeSelection,
  expandNewGroups,
  expandNewStarred,
  fetchText,
  fileStatuses,
  isEntryIdInside,
  movedEntryId,
  paneFocusedBy,
  parentId,
  provisionalEntry,
  readOnlyReason,
  type ReadOnlyReason,
  readOnlyText,
  reapplyChange,
  renameRecord,
  rollupText,
  settlePending,
  statusTexts,
  stepSelection,
  type TreeRow,
  type TreeRowAction,
  type TreeState,
  topVisibleLine,
  trashQuestion,
  treeLine,
  type TreeLine,
  type TreeLineState,
  type TreeRowKey,
  treeRowAction,
  treeRowStatus,
  visibleRows,
} from './docs-state';

function group(
  id: string,
  title: string,
  children: TreeNode[],
  role: GroupRole = { type: 'other' },
): TreeGroup {
  return { type: 'group', id, title, folder: '/', role, children };
}

function leaf(id: string, title: string, entryId: string): TreeLeaf {
  return { type: 'entry', id, title, entryId };
}

function state(overrides: Partial<TreeState>): TreeState {
  return { expanded: new Set(), selectedId: null, filter: '', ...overrides };
}

function rowSummary(rows: readonly TreeRow[]) {
  return rows.map((row) => ({
    id: row.node.id,
    depth: row.depth,
    isExpanded: row.isExpanded,
  }));
}

function rowsOf(...ids: string[]): TreeRow[] {
  return ids.map((id) => ({
    node: leaf(id, id, id),
    depth: 0,
    isExpanded: false,
  }));
}

// Root `a` holding group `b` holding leaf `c`.
const NESTED = [group('a', 'A', [group('b', 'B', [leaf('c', 'C', 'e:c')])])];

const FILTER_TREE = [
  group('root', 'Root', [
    group('rules', 'Rules', [leaf('style', 'Style', 'e:style')]),
    group('other', 'Others', [leaf('other', 'Other', 'e:other')]),
  ]),
];

const PATHS: Record<string, string> = {
  'e:style': '/r/rules/style.md',
  'e:other': '/r/x.md',
};

const pathOf = (entryId: string) => PATHS[entryId] ?? '';

const noHeadings = (): readonly IndexHeading[] => [];

const WIKI_LINK: TreeWikiLink = {
  type: 'wikiLink',
  id: 'link',
  title: 'Link',
  target: { type: 'all' },
  count: null,
  isDangling: false,
};

const WIKI_LABEL: TreeWikiLabel = {
  type: 'wikiLabel',
  id: 'label',
  title: 'Label',
};

const HEADING_MATCH: TreeHeadingMatch = {
  type: 'headingMatch',
  id: 'page/heading:9',
  title: 'Heading',
  entryId: 'e:page',
  line: 9,
  docTitle: 'Page',
  leafId: 'page',
};

function context(folder: string): IndexContext {
  return { folder, sessionId: null, loadedPlugins: {}, states: {} };
}

describe('visibleRows', () => {
  it('visibleRows_CollapsedGroup_HidesChildren', () => {
    const rows = visibleRows(
      NESTED,
      state({ expanded: new Set(['a']) }),
      pathOf,
      noHeadings,
      fakeFuzzyMatcher,
    );

    expect(rowSummary(rows)).toEqual([
      { id: 'a', depth: 0, isExpanded: true },
      { id: 'b', depth: 1, isExpanded: false },
    ]);
  });

  it('visibleRows_Filter_ShowsMatchesUnderExpandedGroups', () => {
    const rows = visibleRows(
      FILTER_TREE,
      state({ filter: 'STYLE' }),
      pathOf,
      noHeadings,
      fakeFuzzyMatcher,
    );

    expect(rowSummary(rows)).toEqual([
      { id: 'root', depth: 0, isExpanded: true },
      { id: 'rules', depth: 1, isExpanded: true },
      { id: 'style', depth: 2, isExpanded: false },
    ]);
  });

  it('visibleRows_FilterMatchesPath_Shown', () => {
    const rows = visibleRows(
      FILTER_TREE,
      state({ filter: 'rules/' }),
      pathOf,
      noHeadings,
      fakeFuzzyMatcher,
    );

    expect(rows.map((row) => row.node.id)).toContain('style');
    expect(rows.map((row) => row.node.id)).not.toContain('other');
  });

  it.each([
    { filter: ' RULES/style ', expected: ['style'] },
    { filter: 'rstyl', expected: [] },
  ])('visibleRows_PathIsSubstringOnly ($filter)', ({ filter, expected }) => {
    const rows = visibleRows(
      FILTER_TREE,
      state({ filter }),
      pathOf,
      noHeadings,
      fakeFuzzyMatcher,
    );

    expect(
      rows.filter((row) => row.node.type === 'entry').map((row) => row.node.id),
    ).toEqual(expected);
  });

  it('visibleRows_FuzzyTitle_ShowsLeafUnderGroups', () => {
    const tree = [
      group('root', 'Root', [
        group('docs', 'Docs', [leaf('stream', 'claude-stream', 'e:stream')]),
        group('other', 'Others', [leaf('other', 'Other', 'e:other')]),
      ]),
    ];

    const rows = visibleRows(
      tree,
      state({ filter: 'clstr' }),
      pathOf,
      noHeadings,
      fakeFuzzyMatcher,
    );

    expect(rowSummary(rows)).toEqual([
      { id: 'root', depth: 0, isExpanded: true },
      { id: 'docs', depth: 1, isExpanded: true },
      { id: 'stream', depth: 2, isExpanded: false },
    ]);
  });

  it('visibleRows_SpacesOnlyFilter_IsNoFilter', () => {
    const rows = visibleRows(
      FILTER_TREE,
      state({ expanded: new Set(['root']), filter: '   ' }),
      pathOf,
      noHeadings,
      fakeFuzzyMatcher,
    );

    expect(rowSummary(rows)).toEqual([
      { id: 'root', depth: 0, isExpanded: true },
      { id: 'rules', depth: 1, isExpanded: false },
      { id: 'other', depth: 1, isExpanded: false },
    ]);
  });

  describe('heading matches', () => {
    const HEADINGS: Record<string, IndexHeading[]> = {
      'e:b': [{ level: 2, text: 'Alpha notes', line: 4 }],
      'e:a': [
        { level: 1, text: 'Alpha', line: 1 },
        { level: 2, text: 'Alpha two', line: 9 },
      ],
      'e:c': [{ level: 1, text: 'Delta', line: 1 }],
    };
    const headingsOf = (entryId: string) => HEADINGS[entryId] ?? [];
    const treeTitling = (cTitle: string) => [
      group('root', 'Root', [
        leaf('b', 'Beta', 'e:b'),
        leaf('a', 'Alpha', 'e:a'),
        leaf('c', cTitle, 'e:c'),
      ]),
    ];

    it.each<{
      filter: string;
      cTitle: string;
      expected: [string, number][];
    }>([
      {
        filter: 'alpha',
        cTitle: 'Gamma',
        expected: [
          ['root', 0],
          ['a', 1],
          ['a/heading:9', 2],
          ['b', 1],
          ['b/heading:4', 2],
        ],
      },
      {
        filter: 'notes',
        cTitle: 'Gamma',
        expected: [
          ['root', 0],
          ['b', 1],
          ['b/heading:4', 2],
        ],
      },
      {
        filter: 'gamma',
        cTitle: 'Gamma',
        expected: [
          ['root', 0],
          ['c', 1],
        ],
      },
      {
        filter: 'delta',
        cTitle: '`Delta`',
        expected: [
          ['root', 0],
          ['c', 1],
        ],
      },
      {
        filter: '',
        cTitle: 'Gamma',
        expected: [
          ['root', 0],
          ['b', 1],
          ['a', 1],
          ['c', 1],
        ],
      },
    ])('visibleRows_HeadingMatch ($filter)', ({ filter, cTitle, expected }) => {
      const rows = visibleRows(
        treeTitling(cTitle),
        state({ expanded: new Set(['root']), filter }),
        pathOf,
        headingsOf,
        fakeFuzzyMatcher,
      );

      expect(rows.map((row) => [row.node.id, row.depth])).toEqual(expected);
    });

    it('visibleRows_HeadingMatch_NamesTitleAndDoc', () => {
      const rows = visibleRows(
        treeTitling('Gamma'),
        state({ filter: 'alpha' }),
        pathOf,
        headingsOf,
        fakeFuzzyMatcher,
      );

      expect(rows.find((row) => row.node.id === 'a/heading:9')?.node).toEqual({
        type: 'headingMatch',
        id: 'a/heading:9',
        title: 'Alpha two',
        entryId: 'e:a',
        line: 9,
        docTitle: 'Alpha',
        leafId: 'a',
      });
    });
  });

  it.each([
    { filter: '', expected: ['shelf', 'label', 'link', 'page'] },
    { filter: 'page', expected: ['shelf', 'page'] },
    { filter: 'zzz', expected: [] },
  ])('visibleRows_WikiRows ($filter)', ({ filter, expected }) => {
    const tree = [
      group('shelf', 'Shelf', [
        WIKI_LABEL,
        WIKI_LINK,
        leaf('page', 'Page', 'e:page'),
      ]),
    ];

    const rows = visibleRows(
      tree,
      state({ expanded: new Set(['shelf']), filter }),
      pathOf,
      noHeadings,
      fakeFuzzyMatcher,
    );

    expect(rows.map((row) => row.node.id)).toEqual(expected);
  });
});

describe('stepSelection', () => {
  it('stepSelection_AtEnds_Clamps', () => {
    const rows = rowsOf('a', 'b', 'c');

    expect(stepSelection(rows, 'c', 1)).toBe('c');
    expect(stepSelection(rows, 'a', -1)).toBe('a');
    expect(stepSelection(rows, 'b', 1)).toBe('c');
  });

  it('stepSelection_SelectedNotShown_FirstRow', () => {
    expect(stepSelection(rowsOf('a', 'b', 'c'), 'z', 1)).toBe('a');
    expect(stepSelection([], 'z', 1)).toBeNull();
  });
});

describe('edgeSelection', () => {
  it.each([
    { rows: rowsOf('a', 'b', 'c'), edge: 'first', expected: 'a' },
    { rows: rowsOf('a', 'b', 'c'), edge: 'last', expected: 'c' },
    { rows: [], edge: 'first', expected: null },
  ] as const)(
    '$edge of $rows.length rows is $expected',
    ({ rows, edge, expected }) => {
      expect(edgeSelection(rows, edge)).toBe(expected);
    },
  );
});

describe('parentId', () => {
  it('parentId_LeafInGroup_GroupId', () => {
    expect(parentId(NESTED, 'c')).toBe('b');
    expect(parentId(NESTED, 'a')).toBeNull();
  });
});

describe('treeRowAction', () => {
  // Root `a` holding group `b` holding leaves `c` and `d`; each leaf's path
  // is its entry id.
  const tree = [
    group('a', 'A', [
      group('b', 'B', [leaf('c', 'C', 'e:c'), leaf('d', 'D', 'e:d')]),
    ]),
  ];
  const rowsFor = (expanded: string[], filter = '') =>
    visibleRows(
      tree,
      state({ expanded: new Set(expanded), filter }),
      String,
      noHeadings,
      fakeFuzzyMatcher,
    );
  const actionOf = (
    id: string,
    key: TreeRowKey,
    rows: readonly TreeRow[],
    filter = '',
  ) => {
    const row = rows.find((each) => each.node.id === id);
    if (row === undefined) {
      throw new Error(`No row ${id} shows`);
    }
    return treeRowAction(tree, rows, row, filter, key);
  };

  it.each<{
    id: string;
    key: TreeRowKey;
    expanded: string[];
    filter: string;
    expected: TreeRowAction;
  }>([
    {
      id: 'b',
      key: 'close',
      expanded: ['a', 'b'],
      filter: '   ',
      expected: { type: 'collapse' },
    },
    {
      id: 'b',
      key: 'toggle',
      expanded: ['a', 'b'],
      filter: '',
      expected: { type: 'collapse' },
    },
    {
      id: 'b',
      key: 'toggle',
      expanded: ['a'],
      filter: '',
      expected: { type: 'expand' },
    },
    {
      id: 'c',
      key: 'toggle',
      expanded: ['a', 'b'],
      filter: '',
      expected: { type: 'openLeaf', focusDoc: true },
    },
    {
      id: 'c',
      key: 'open',
      expanded: ['a', 'b'],
      filter: '',
      expected: { type: 'openLeaf', focusDoc: false },
    },
    {
      id: 'b',
      key: 'toggle',
      expanded: [],
      filter: 'e:d',
      expected: { type: 'select', id: 'd' },
    },
    {
      id: 'b',
      key: 'open',
      expanded: ['a', 'b'],
      filter: '',
      expected: { type: 'select', id: 'c' },
    },
    {
      id: 'b',
      key: 'close',
      expanded: ['a', 'b'],
      filter: '',
      expected: { type: 'collapse' },
    },
    {
      id: 'b',
      key: 'close',
      expanded: ['a'],
      filter: '',
      expected: { type: 'select', id: 'a' },
    },
  ])(
    '$key on $id with $expanded expanded and filter "$filter" → $expected.type',
    ({ id, key, expanded, filter, expected }) => {
      expect(actionOf(id, key, rowsFor(expanded, filter), filter)).toEqual(
        expected,
      );
    },
  );

  it('treeRowAction_OpenExpandedEmptyGroup_Nothing', () => {
    const withEmpty = [
      group('a', 'A', [group('b', 'B', []), leaf('c', 'C', 'e:c')]),
    ];
    const rows = visibleRows(
      withEmpty,
      state({ expanded: new Set(['a', 'b']) }),
      String,
      noHeadings,
      fakeFuzzyMatcher,
    );
    const [, emptyGroup] = rows;

    expect(treeRowAction(withEmpty, rows, emptyGroup, '', 'open')).toEqual({
      type: 'none',
    });
  });

  it.each<{
    given: string;
    node: TreeNode;
    key: TreeRowKey;
    expected: TreeRowAction;
  }>([
    {
      given: 'link on open',
      node: WIKI_LINK,
      key: 'open',
      expected: { type: 'openWikiLink', focusDoc: false },
    },
    {
      given: 'link on toggle',
      node: WIKI_LINK,
      key: 'toggle',
      expected: { type: 'openWikiLink', focusDoc: true },
    },
    {
      given: 'dangling link on toggle',
      node: { ...WIKI_LINK, isDangling: true },
      key: 'toggle',
      expected: { type: 'openWikiLink', focusDoc: true },
    },
    {
      given: 'link on close',
      node: WIKI_LINK,
      key: 'close',
      expected: { type: 'select', id: 'shelf' },
    },
    {
      given: 'label on open',
      node: WIKI_LABEL,
      key: 'open',
      expected: { type: 'none' },
    },
    {
      given: 'label on close',
      node: WIKI_LABEL,
      key: 'close',
      expected: { type: 'select', id: 'shelf' },
    },
    {
      given: 'heading on toggle',
      node: HEADING_MATCH,
      key: 'toggle',
      expected: { type: 'openHeading', focusDoc: true },
    },
    {
      given: 'heading on close',
      node: HEADING_MATCH,
      key: 'close',
      expected: { type: 'select', id: 'page' },
    },
  ])('treeRowAction_WikiRows ($given)', ({ node, key, expected }) => {
    const shelves = [
      group('shelf', 'Shelf', [
        WIKI_LABEL,
        WIKI_LINK,
        leaf('page', 'Page', 'e:page'),
      ]),
    ];
    const row = { node, depth: 1, isExpanded: false };

    expect(treeRowAction(shelves, [row], row, '', key)).toEqual(expected);
  });
});

describe('defaultExpandedIds', () => {
  it('defaultExpandedIds_MineAndChildren_ThirdPartyCollapsed', () => {
    const tree = [
      group('owner:mine', 'Mine', [
        group('global', 'Global', []),
        group('repo:r', 'r', [group('repo:r/rule', 'Rules', [])]),
      ]),
      group('owner:third-party', 'Third-party', [
        group('owner:third-party/synced', 'Synced skills', []),
      ]),
    ];

    expect([...defaultExpandedIds(tree)]).toEqual([
      'owner:mine',
      'global',
      'repo:r',
    ]);
  });

  it('defaultExpandedIds_StarredRoot_Expanded', () => {
    const tree = [
      group('owner:starred', 'Starred', [
        leaf('owner:starred/entry:/a', 'A', '/a'),
      ]),
      group('owner:mine', 'Mine', [group('global', 'Global', [])]),
      group('owner:third-party', 'Third-party', []),
    ];

    const expanded = defaultExpandedIds(tree);

    expect(expanded.has('owner:starred')).toBe(true);
    expect(expanded.has('owner:mine')).toBe(true);
    expect(expanded.has('global')).toBe(true);
    expect(expanded.has('owner:third-party')).toBe(false);
  });

  it('defaultExpandedIds_WikiShelves_EachExpanded', () => {
    const tree = [
      group('shelf:A', 'A', [WIKI_LABEL, WIKI_LINK]),
      group('shelf:B', 'B', []),
    ];

    expect([...defaultExpandedIds(tree)]).toEqual(['shelf:A', 'shelf:B']);
  });
});

describe('expandNewStarred', () => {
  const mine = group('owner:mine', 'Mine', []);
  const starred = group('owner:starred', 'Starred', []);

  it('expandNewStarred_StarredAppears_Added', () => {
    const expanded = expandNewStarred(
      [mine],
      [starred, mine],
      new Set(['owner:mine']),
    );

    expect([...expanded].sort()).toEqual(['owner:mine', 'owner:starred']);
  });

  it('expandNewStarred_StarredWasThere_Unchanged', () => {
    const expanded = expandNewStarred(
      [starred, mine],
      [starred, mine],
      new Set(['owner:mine']),
    );

    expect([...expanded]).toEqual(['owner:mine']);
  });

  it('expandNewStarred_BackAfterAnEmptyTree_Unchanged', () => {
    const before = new Set(['owner:mine']);

    expect(expandNewStarred([], [starred, mine], before)).toBe(before);
  });

  it('expandNewStarred_NoStarred_Unchanged', () => {
    const before = new Set(['owner:mine']);

    expect(expandNewStarred([starred, mine], [mine], before)).toBe(before);
  });
});

describe('expandNewGroups', () => {
  const kept = group('shelf:Kept', 'Kept', []);
  const collapsed = group('shelf:Shut', 'Shut', []);
  const added = group('shelf:New', 'New', []);
  const nestedAdded = group('shelf:Outer', 'Outer', [
    group('shelf:Inner', 'Inner', []),
  ]);

  it.each<{
    name: string;
    seen: string[];
    next: TreeNode[];
    expected: string[];
  }>([
    {
      name: 'NewGroup_ExpandedAndCollapsedStays',
      seen: ['shelf:Kept', 'shelf:Shut'],
      next: [kept, collapsed, added],
      expected: ['shelf:Kept', 'shelf:New'],
    },
    {
      name: 'NestedNewGroup_BothExpanded',
      seen: ['shelf:Kept'],
      next: [kept, nestedAdded],
      expected: ['shelf:Inner', 'shelf:Kept', 'shelf:Outer'],
    },
    {
      name: 'GroupGone_KeepsTheIds',
      seen: ['shelf:Kept', 'shelf:Shut'],
      next: [collapsed],
      expected: ['shelf:Kept'],
    },
    {
      name: 'NewLeaf_AddsNothing',
      seen: ['shelf:Kept'],
      next: [kept, leaf('page', 'Page', 'e:page')],
      expected: ['shelf:Kept'],
    },
  ])('expandNewGroups_$name', ({ seen, next, expected }) => {
    const expanded = expandNewGroups(
      new Set(seen),
      next,
      new Set(['shelf:Kept']),
    );

    expect([...expanded].sort()).toEqual(expected);
  });
});

const HARNESSES = new Map([['claude', harnessInfo({ label: 'Claude Code' })]]);

describe('chips', () => {
  it('chips_StatesPresent_TextAndReason', () => {
    const withStates: IndexContext = {
      folder: '/Users/u',
      sessionId: null,
      loadedPlugins: {},
      states: { e: { claude: { state: 'launch', reason: 'user CLAUDE.md' } } },
    };

    expect(chips(withStates, 'e', false, HARNESSES)).toMatchObject({
      claude: { tooltip: 'user CLAUDE.md', state: 'launch' },
      codex: { tooltip: '', state: 'none' },
    });
  });

  it('chips_Pending_PendingText', () => {
    const result = chips(context('/Users/u'), 'e', true, HARNESSES);

    expect(result.claude.state).toBe('pending');
    expect(result.codex.state).toBe('pending');
  });

  it('chips_NoContext_Dashes', () => {
    const result = chips(null, 'e', false, HARNESSES);

    expect(result.claude.state).toBe('none');
    expect(result.codex.state).toBe('none');
  });
});

describe('contextChoices', () => {
  it('contextChoices_HomeFirstThenByFolder', () => {
    const document: IndexDocument = {
      schemaVersion: 5,
      generatedAt: '2026-10-20T00:00:00Z',
      entries: [],
      contexts: [
        context('/Users/u/dev/b'),
        context('/Users/u'),
        context('/Users/u/dev/a'),
      ],
    };

    const folders = contextChoices(document, '/Users/u', posixPaths).map(
      (c) => c.folder,
    );

    expect(folders).toEqual(['/Users/u', '/Users/u/dev/a', '/Users/u/dev/b']);
  });

  it('contextChoices_WindowsHomeOtherCase_First', () => {
    const document = documentOf(
      [],
      [
        context('C:\\Users\\u\\dev\\b'),
        context('c:\\users\\u'),
        context('C:\\Users\\u\\dev\\a'),
      ],
    );

    const folders = contextChoices(document, 'C:\\Users\\u', windowsPaths).map(
      (c) => c.folder,
    );

    expect(folders).toEqual([
      'c:\\users\\u',
      'C:\\Users\\u\\dev\\a',
      'C:\\Users\\u\\dev\\b',
    ]);
  });
});

describe('topVisibleLine', () => {
  it('topVisibleLine_LastBlockAtOrAboveScroll', () => {
    const blocks = [
      { line: 1, top: 0 },
      { line: 5, top: 100 },
      { line: 9, top: 200 },
    ];

    expect(topVisibleLine(blocks, 150, 4)).toBe(8);
    expect(topVisibleLine(blocks, 0, 4)).toBe(4);
  });
});

describe('codeFence', () => {
  it('codeFence_LongestRunPlusOne', () => {
    expect(codeFence('a ```` b `` c')).toBe('`````');
    expect(codeFence('plain text')).toBe('```');
  });
});

function entry(overrides: Partial<IndexEntry> & { path: string }): IndexEntry {
  return {
    id: overrides.path,
    kind: 'reference',
    source: 'global',
    owner: 'mine',
    repo: null,
    root: null,
    plugin: null,
    line: null,
    title: overrides.path.slice(overrides.path.lastIndexOf('/') + 1),
    meta: {},
    walked: [],
    headings: [],
    links: [],
    lastLoaded: null,
    ...overrides,
  };
}

function documentOf(
  entries: IndexEntry[],
  contexts: IndexContext[] = [],
): IndexDocument {
  return {
    schemaVersion: 5,
    generatedAt: '2026-10-20T00:00:00Z',
    entries,
    contexts,
  };
}

const pathsOf = (document: IndexDocument) =>
  document.entries.map((each) => each.path);

describe('applyChange', () => {
  it('applyChange_Created_AddsEntry', () => {
    const before = documentOf([entry({ path: '/Users/u/dev/r/a.md' })]);

    const after = applyChange(
      before,
      {
        type: 'created',
        entry: entry({ path: '/Users/u/dev/r/b.md' }),
      },
      posixPaths,
    );

    expect(pathsOf(after)).toEqual([
      '/Users/u/dev/r/a.md',
      '/Users/u/dev/r/b.md',
    ]);
  });

  it('applyChange_RenamedFile_PathIdAndTitle', () => {
    const before = documentOf([
      entry({ path: '/r/a.md', title: 'a.md' }),
      entry({ path: '/r/c.md', title: 'Alpha' }),
    ]);

    const renamedA = applyChange(
      before,
      {
        type: 'renamed',
        from: '/r/a.md',
        to: '/r/sub/b.md',
      },
      posixPaths,
    );
    const renamedC = applyChange(
      before,
      {
        type: 'renamed',
        from: '/r/c.md',
        to: '/r/d.md',
      },
      posixPaths,
    );

    expect(renamedA.entries[0]).toMatchObject({
      id: '/r/sub/b.md',
      path: '/r/sub/b.md',
      title: 'b.md',
    });
    expect(renamedC.entries[1].title).toBe('Alpha');
  });

  it('applyChange_RenamedHashFolder_IdFollowsPath', () => {
    const before = documentOf([
      entry({ path: '/Users/u/dev/C#/AGENTS.md' }),
      entry({ id: '/Users/u/dev/C#/f.md#L3', path: '/Users/u/dev/C#/f.md' }),
    ]);

    const after = applyChange(
      before,
      { type: 'renamed', from: '/Users/u/dev/C#', to: '/Users/u/dev/D' },
      posixPaths,
    );

    expect(after.entries.map((each) => [each.id, each.path])).toEqual([
      ['/Users/u/dev/D/AGENTS.md', '/Users/u/dev/D/AGENTS.md'],
      ['/Users/u/dev/D/f.md#L3', '/Users/u/dev/D/f.md'],
    ]);
  });

  it('applyChange_Renamed_KeepsLastLoaded', () => {
    const before = documentOf([
      entry({
        path: '/Users/u/.claude/rules/a.md',
        lastLoaded: '2026-10-26T09:00:00Z',
      }),
    ]);

    const after = applyChange(
      before,
      {
        type: 'renamed',
        from: '/Users/u/.claude/rules/a.md',
        to: '/Users/u/.claude/rules/b.md',
      },
      posixPaths,
    );

    const moved = after.entries.find(
      (each) => each.id === '/Users/u/.claude/rules/b.md',
    );
    expect(moved?.lastLoaded).toBe('2026-10-26T09:00:00Z');
  });

  it('applyChange_RenamedFolder_MovesEntriesInside', () => {
    const before = documentOf([
      entry({ path: '/r/skills/s/SKILL.md', kind: 'skill', title: 's' }),
    ]);

    const after = applyChange(
      before,
      {
        type: 'renamed',
        from: '/r/skills/s',
        to: '/r/skills/t',
      },
      posixPaths,
    );

    expect(pathsOf(after)).toEqual(['/r/skills/t/SKILL.md']);
  });

  it('applyChange_WindowsRenamedFolder_MovesEntriesInside', () => {
    const before = documentOf([
      entry({ path: 'C:\\r\\.claude\\skills\\old\\SKILL.md', title: 'old' }),
      entry({
        path: 'C:\\r\\.claude\\skills\\older\\SKILL.md',
        title: 'older',
      }),
    ]);

    const after = applyChange(
      before,
      {
        type: 'renamed',
        from: 'C:\\r\\.claude\\skills\\old',
        to: 'C:\\r\\.claude\\skills\\new',
      },
      windowsPaths,
    );

    expect(pathsOf(after)).toEqual([
      'C:\\r\\.claude\\skills\\new\\SKILL.md',
      'C:\\r\\.claude\\skills\\older\\SKILL.md',
    ]);
  });

  it('applyChange_WindowsRenamedFromOtherCase_PathAndIdMove', () => {
    const launch = { claude: { state: 'launch' as const, reason: 'r' } };
    const before = documentOf(
      [
        entry({ path: 'C:\\R\\Docs\\a.md' }),
        entry({
          id: 'C:\\R\\Docs\\a.md#L4',
          path: 'C:\\R\\Docs\\a.md',
          line: 4,
        }),
      ],
      [
        {
          folder: 'C:\\R',
          sessionId: null,
          loadedPlugins: {},
          states: { 'C:\\R\\Docs\\a.md': launch },
        },
      ],
    );

    const after = applyChange(
      before,
      {
        type: 'renamed',
        from: 'c:\\r\\docs',
        to: 'C:\\R\\Notes',
      },
      windowsPaths,
    );

    expect(
      after.entries.map((each) => ({ id: each.id, path: each.path })),
    ).toEqual([
      { id: 'C:\\R\\Notes\\a.md', path: 'C:\\R\\Notes\\a.md' },
      { id: 'C:\\R\\Notes\\a.md#L4', path: 'C:\\R\\Notes\\a.md' },
    ]);
    expect(after.contexts[0].states).toEqual({ 'C:\\R\\Notes\\a.md': launch });
  });

  it('applyChange_Renamed_StatesFollowId', () => {
    const launch = { claude: { state: 'launch' as const, reason: 'r' } };
    const before = documentOf(
      [entry({ path: '/r/a.md' })],
      [
        {
          folder: '/r',
          sessionId: null,
          loadedPlugins: {},
          states: { '/r/a.md': launch },
        },
      ],
    );

    const after = applyChange(
      before,
      {
        type: 'renamed',
        from: '/r/a.md',
        to: '/r/sub/b.md',
      },
      posixPaths,
    );

    expect(after.contexts[0].states).toEqual({ '/r/sub/b.md': launch });
  });

  it('applyChange_TrashedFolder_DropsEntriesInside', () => {
    const before = documentOf([
      entry({ path: '/r/skills/s/SKILL.md' }),
      entry({ path: '/r/skills/s/ref.md' }),
      entry({ path: '/r/other.md' }),
    ]);

    const after = applyChange(
      before,
      {
        type: 'trashed',
        paths: ['/r/skills/s'],
      },
      posixPaths,
    );

    expect(pathsOf(after)).toEqual(['/r/other.md']);
  });

  it('applyChange_TrashedLinkAndTarget_DropsEntriesUnderBoth', () => {
    const before = documentOf([
      entry({ path: '/r/skills/s/SKILL.md' }),
      entry({ path: '/h/.claude/skills/s/SKILL.md' }),
      entry({ path: '/h/.claude/skills/t/SKILL.md' }),
    ]);

    const after = applyChange(
      before,
      {
        type: 'trashed',
        paths: ['/r/skills/s', '/h/.claude/skills/s'],
      },
      posixPaths,
    );

    expect(pathsOf(after)).toEqual(['/h/.claude/skills/t/SKILL.md']);
  });
});

describe('movedEntryId', () => {
  it('movedEntryId_FileItself_ToPath', () => {
    expect(movedEntryId('/r/a.md', '/r/a.md', '/r/b.md', posixPaths)).toBe(
      '/r/b.md',
    );
  });

  it('movedEntryId_ItemOfFile_KeepsSuffix', () => {
    expect(
      movedEntryId(
        '/f/followups.md#L3',
        '/f/followups.md',
        '/f/later.md',
        posixPaths,
      ),
    ).toBe('/f/later.md#L3');
  });

  it('movedEntryId_InsideFolder_Joined', () => {
    expect(movedEntryId('/r/s/ref/x.md', '/r/s', '/r/t', posixPaths)).toBe(
      '/r/t/ref/x.md',
    );
  });

  it('movedEntryId_HashInFolderName_KeepsPath', () => {
    expect(
      movedEntryId(
        '/Users/u/dev/C#/AGENTS.md',
        '/Users/u/dev/C#',
        '/Users/u/dev/D',
        posixPaths,
      ),
    ).toBe('/Users/u/dev/D/AGENTS.md');
    expect(
      movedEntryId('/u/C#notes/x.md', '/u/C', '/u/D', posixPaths),
    ).toBeNull();
  });

  it('movedEntryId_HashInFileName_KeepsPathAndSuffix', () => {
    expect(
      movedEntryId(
        '/r/docs/#drafts.md#L3',
        '/r/docs/#drafts.md',
        '/r/docs/a.md',
        posixPaths,
      ),
    ).toBe('/r/docs/a.md#L3');
    expect(
      movedEntryId(
        '/r/C#/settings.json#hook:PreToolUse:0',
        '/r/C#',
        '/r/D',
        posixPaths,
      ),
    ).toBe('/r/D/settings.json#hook:PreToolUse:0');
  });

  it('movedEntryId_Outside_Null', () => {
    expect(
      movedEntryId('/r/a.md', '/r/x.md', '/r/y.md', posixPaths),
    ).toBeNull();
    expect(
      movedEntryId('/r/a.mdx', '/r/a.md', '/r/b.md', posixPaths),
    ).toBeNull();
  });

  it('movedEntryId_WindowsItemOtherCase_Moves', () => {
    expect(
      movedEntryId(
        'C:\\R\\a.md#L4',
        'c:\\r\\a.md',
        'C:\\R\\b.md',
        windowsPaths,
      ),
    ).toBe('C:\\R\\b.md#L4');
  });
});

describe('isEntryIdInside', () => {
  it('isEntryIdInside_AtInsideItemOutside', () => {
    expect(isEntryIdInside('/r/a.md', '/r/a.md', posixPaths)).toBe(true);
    expect(isEntryIdInside('/r/s/x.md', '/r/s', posixPaths)).toBe(true);
    expect(
      isEntryIdInside('/f/followups.md#L3', '/f/followups.md', posixPaths),
    ).toBe(true);
    expect(isEntryIdInside('/r/ab.md', '/r/a', posixPaths)).toBe(false);
  });

  it('isEntryIdInside_HashInPath_WholePathCompared', () => {
    expect(isEntryIdInside('/u/C#notes/x.md', '/u/C#notes', posixPaths)).toBe(
      true,
    );
    expect(isEntryIdInside('/u/C#notes/x.md', '/u/C', posixPaths)).toBe(false);
    expect(
      isEntryIdInside('/r/docs/#drafts/a.md#L2', '/r/docs/#drafts', posixPaths),
    ).toBe(true);
  });

  it('isEntryIdInside_WindowsItemOtherCase_True', () => {
    expect(isEntryIdInside('C:\\R\\a.md#L4', 'c:\\r\\a.md', windowsPaths)).toBe(
      true,
    );
  });
});

describe('reapplyChange', () => {
  it('reapplyChange_CreatedIdListed_KeepsRunEntry', () => {
    const built = entry({
      path: '/r/rules/a.md',
      kind: 'rule',
      title: 'Alpha',
      meta: { paths: ['*.ts'] },
    });
    const provisional = entry({ path: '/r/rules/a.md', kind: 'reference' });

    const after = reapplyChange(
      documentOf([built]),
      {
        type: 'created',
        entry: provisional,
      },
      posixPaths,
    );

    expect(after.entries).toEqual([built]);
  });

  it('reapplyChange_CreatedIdMissing_AddsEntry', () => {
    const created = entry({ path: '/r/b.md' });

    const after = reapplyChange(
      documentOf([entry({ path: '/r/a.md' })]),
      {
        type: 'created',
        entry: created,
      },
      posixPaths,
    );

    expect(pathsOf(after)).toEqual(['/r/a.md', '/r/b.md']);
  });

  it('reapplyChange_RenamedToListed_FileMadeAtFromStays', () => {
    const before = documentOf([
      entry({ path: '/r/x.md' }),
      entry({ path: '/r/y.md' }),
    ]);

    const after = reapplyChange(
      before,
      {
        type: 'renamed',
        from: '/r/x.md',
        to: '/r/y.md',
      },
      posixPaths,
    );

    expect(pathsOf(after)).toEqual(['/r/x.md', '/r/y.md']);
  });

  it('reapplyChange_RenamedToMissing_Moves', () => {
    const after = reapplyChange(
      documentOf([entry({ path: '/r/x.md' })]),
      {
        type: 'renamed',
        from: '/r/x.md',
        to: '/r/y.md',
      },
      posixPaths,
    );

    expect(pathsOf(after)).toEqual(['/r/y.md']);
  });

  it('reapplyChange_RenamedFolderToListed_Skipped', () => {
    const before = documentOf([entry({ path: '/r/skills/t/SKILL.md' })]);

    const after = reapplyChange(
      before,
      {
        type: 'renamed',
        from: '/r/skills/s',
        to: '/r/skills/t',
      },
      posixPaths,
    );

    expect(pathsOf(after)).toEqual(['/r/skills/t/SKILL.md']);
  });

  it('reapplyChange_TrashedLinkAndTargetStillListed_DropsBoth', () => {
    const before = documentOf([
      entry({ path: '/r/skills/s/SKILL.md' }),
      entry({ path: '/h/.claude/skills/s/SKILL.md' }),
      entry({ path: '/r/other.md' }),
    ]);

    const after = reapplyChange(
      before,
      {
        type: 'trashed',
        paths: ['/r/skills/s', '/h/.claude/skills/s'],
      },
      posixPaths,
    );

    expect(pathsOf(after)).toEqual(['/r/other.md']);
  });
});

describe('renameRecord', () => {
  it('renameRecord_File_NamesFiles', () => {
    expect(renameRecord('/r/rules/a.md', '/r/rules/b.md', posixPaths)).toEqual({
      type: 'renamed',
      from: '/r/rules/a.md',
      to: '/r/rules/b.md',
    });
  });

  it('renameRecord_Skill_NamesFolders', () => {
    expect(
      renameRecord(
        '/r/.claude/skills/s/SKILL.md',
        '/r/.claude/skills/t/SKILL.md',
        posixPaths,
      ),
    ).toEqual({
      type: 'renamed',
      from: '/r/.claude/skills/s',
      to: '/r/.claude/skills/t',
    });
  });
});

describe('changeableEntry', () => {
  const rule = entry({ path: '/r/rules/a.md', kind: 'rule' });
  const skill = entry({ path: '/r/.claude/skills/s/SKILL.md', kind: 'skill' });
  const followup = entry({
    path: '/r/followups.md',
    kind: 'followup',
    id: '/r/followups.md#L4',
    line: 4,
    title: 'Fix it',
  });
  const hook = entry({
    path: '/r/.claude/settings.json',
    kind: 'hook',
    id: 'hook:1',
    title: 'PreToolUse',
  });
  const cached = entry({
    path: '/c/p/skills/s/SKILL.md',
    kind: 'skill',
    source: 'plugin',
    plugin: 'p@m',
    root: '/c/p',
  });
  const byId = new Map(
    [rule, skill, followup, hook, cached].map((each) => [each.id, each]),
  );
  const check = (entryId: string, unsavedPaths: string[] = []) =>
    changeableEntry(
      leaf(`entry:${entryId}`, entryId, entryId),
      (id) => byId.get(id),
      'Select a doc',
      unsavedPaths,
      posixPaths,
    );

  it('changeableEntry_Doc_Allowed', () => {
    expect(check(rule.id)).toEqual({ entry: rule });
  });

  it('changeableEntry_NothingSelectedOrGone_Null', () => {
    const none = changeableEntry(
      null,
      (id) => byId.get(id),
      'Select',
      [],
      posixPaths,
    );

    expect(none).toBe(null);
    expect(check('/r/gone.md')).toBe(null);
  });

  it.each<{ node: TreeNode }>([
    { node: group('group:/r', 'r', []) },
    { node: WIKI_LINK },
    { node: WIKI_LABEL },
    { node: HEADING_MATCH },
  ])(
    'changeableEntry_NotALeaf_RefusedWithGroupText ($node.type)',
    ({ node }) => {
      const checked = changeableEntry(
        node,
        (id) => byId.get(id),
        'Select a doc to rename',
        [],
        posixPaths,
      );

      expect(checked).toEqual({
        refusal: { text: 'Select a doc to rename', tone: 'info' },
      });
    },
  );

  it('changeableEntry_ItemInsideFile_Refused', () => {
    const refusedText = (id: string) => {
      const checked = check(id);
      return checked !== null && 'refusal' in checked
        ? checked.refusal.text
        : null;
    };

    expect(refusedText(followup.id)).toMatch(/Fix it.*followups\.md/);
    expect(refusedText(hook.id)).toMatch(/PreToolUse.*settings\.json/);
  });

  it('changeableEntry_ReadOnlyCopy_RefusedWithItsReadOnlyText', () => {
    expect(check(cached.id)).toEqual({
      refusal: { text: expect.stringContaining('p@m'), tone: 'info' },
    });
  });

  it('changeableEntry_UnsavedEditsOnFile_Refused', () => {
    expect(check(rule.id, ['/r/rules/a.md'])).toEqual({
      refusal: { text: UNSAVED_TEXT, tone: 'error' },
    });
    expect(check(rule.id, ['/r/rules/b.md'])).toEqual({ entry: rule });
  });

  it('changeableEntry_UnsavedEditsInSkillFolder_Refused', () => {
    expect(check(skill.id, ['/r/.claude/skills/s/reference.md'])).toEqual({
      refusal: { text: UNSAVED_TEXT, tone: 'error' },
    });
  });
});

describe('prompt texts', () => {
  it('trashQuestion_OneTarget_QuestionAlone', () => {
    expect(trashQuestion(['/h/a.md'], '/h', posixPaths)).toBe(
      'Move a.md to the Trash?',
    );
  });

  it('trashQuestion_TwoTargets_NamesLink', () => {
    const targets = ['/h/r/skills/s', '/h/.claude/skills/s'];

    expect(trashQuestion(targets, '/h', posixPaths)).toBe(
      'Move ~/r/skills/s and its link ~/.claude/skills/s to the Trash?',
    );
  });

  it('trashQuestion_ThreeTargets_NamesLinks', () => {
    const targets = [
      '/h/repo/skills/s',
      '/h/.claude/skills/s',
      '/h/.codex/skills/s',
    ];

    expect(trashQuestion(targets, '/h', posixPaths)).toBe(
      'Move ~/repo/skills/s and its links ~/.claude/skills/s, ~/.codex/skills/s to the Trash?',
    );
  });

  it('trashQuestion_WindowsLinkAndTarget_TildePaths', () => {
    const targets = [
      'C:\\Users\\u\\wigley-agents\\CLAUDE.md',
      'C:\\Users\\u\\.claude\\CLAUDE.md',
    ];

    expect(trashQuestion(targets, 'C:\\Users\\u', windowsPaths)).toBe(
      'Move ~\\wigley-agents\\CLAUDE.md and its link ~\\.claude\\CLAUDE.md to the Trash?',
    );
  });
});

describe('treeLine', () => {
  // `mentions` is the data the line's text carries: the filter it names.
  it.each<{
    lineState: TreeLineState;
    expected: (Omit<TreeLine, 'text'> & { mentions: string }) | null;
  }>([
    {
      lineState: {
        hasTree: true,
        isIndexEmpty: false,
        filter: '   ',
        rowCount: 0,
        isFilterOpen: false,
        isWikiView: false,
      },
      expected: null,
    },
    {
      lineState: {
        hasTree: false,
        isIndexEmpty: true,
        filter: 'neat',
        rowCount: 0,
        isFilterOpen: false,
        isWikiView: false,
      },
      expected: null,
    },
    {
      lineState: {
        hasTree: true,
        isIndexEmpty: true,
        filter: 'neat',
        rowCount: 0,
        isFilterOpen: false,
        isWikiView: false,
      },
      expected: {
        placement: 'empty',
        hint: { command: 'filter', words: 'to change it' },
        mentions: 'neat',
      },
    },
    {
      lineState: {
        hasTree: true,
        isIndexEmpty: true,
        filter: 'neat',
        rowCount: 0,
        isFilterOpen: false,
        isWikiView: true,
      },
      expected: {
        placement: 'empty',
        hint: { command: 'filter', words: 'to change it' },
        mentions: 'neat',
      },
    },
    {
      lineState: {
        hasTree: true,
        isIndexEmpty: true,
        filter: '',
        rowCount: 0,
        isFilterOpen: false,
        isWikiView: true,
      },
      expected: {
        placement: 'empty',
        hint: { command: 'rescan', words: 'to rescan' },
        mentions: 'Main.md',
      },
    },
    {
      lineState: {
        hasTree: true,
        isIndexEmpty: false,
        filter: 'zqzq',
        rowCount: 0,
        isFilterOpen: false,
        isWikiView: false,
      },
      expected: {
        placement: 'empty',
        hint: { command: 'filter', words: 'to change it' },
        mentions: 'zqzq',
      },
    },
    {
      lineState: {
        hasTree: true,
        isIndexEmpty: false,
        filter: 'zqzq',
        rowCount: 0,
        isFilterOpen: true,
        isWikiView: false,
      },
      expected: {
        placement: 'empty',
        hint: { command: 'filter', words: 'to change it' },
        mentions: 'zqzq',
      },
    },
    {
      lineState: {
        hasTree: true,
        isIndexEmpty: false,
        filter: 'neat',
        rowCount: 3,
        isFilterOpen: false,
        isWikiView: false,
      },
      expected: {
        placement: 'above',
        hint: { command: 'filter', words: 'to change it' },
        mentions: 'neat',
      },
    },
    {
      lineState: {
        hasTree: true,
        isIndexEmpty: false,
        filter: 'neat',
        rowCount: 3,
        isFilterOpen: true,
        isWikiView: false,
      },
      expected: null,
    },
    {
      lineState: {
        hasTree: true,
        isIndexEmpty: false,
        filter: '',
        rowCount: 3,
        isFilterOpen: false,
        isWikiView: false,
      },
      expected: null,
    },
  ])('$lineState → $expected.placement', ({ lineState, expected }) => {
    if (expected === null) {
      expect(treeLine(lineState)).toBeNull();
      return;
    }
    const { mentions, ...shape } = expected;
    expect(treeLine(lineState)).toEqual({
      ...shape,
      text: expect.stringContaining(mentions),
    });
  });
});

describe('provisionalEntry', () => {
  const repoEntries = [
    entry({
      path: '/Users/u/dev/r/AGENTS.md',
      source: 'repo',
      repo: 'r',
      root: '/Users/u/dev/r',
    }),
    entry({
      path: '/Users/u/dev/r/nested/AGENTS.md',
      source: 'repo',
      repo: 'n',
      root: '/Users/u/dev/r/nested',
    }),
  ];

  it('provisionalEntry_InsideRepoRoot_CopiesOwnerAndIsMineNeverLoaded', () => {
    const made = provisionalEntry(
      '/Users/u/dev/r/nested/x.md',
      null,
      repoEntries,
      posixPaths,
    );

    expect(made).toMatchObject({
      id: '/Users/u/dev/r/nested/x.md',
      source: 'repo',
      repo: 'n',
      root: '/Users/u/dev/r/nested',
      kind: 'reference',
      title: 'x.md',
      line: null,
      plugin: null,
      owner: 'mine',
      lastLoaded: null,
    });
  });

  it('provisionalEntry_GuessesKindFromPath', () => {
    const guessed = (path: string) =>
      provisionalEntry(path, null, repoEntries, posixPaths);

    expect(
      guessed('/Users/u/dev/r/.claude/skills/tidy/SKILL.md'),
    ).toMatchObject({ kind: 'skill', title: 'tidy' });
    expect(guessed('/Users/u/dev/r/.claude/rules/a.md').kind).toBe('rule');
    expect(guessed('/Users/u/dev/r/.claude/agents/a.md').kind).toBe('subagent');
    expect(guessed('/Users/u/dev/r/.claude/commands/a.md').kind).toBe(
      'command',
    );
    expect(guessed('/Users/u/dev/r/web/AGENTS.md').kind).toBe('instructions');
  });

  it('provisionalEntry_FeaturesOwner_FeatureDoc', () => {
    const owner = entry({
      path: '/Users/u/wigley-features/r/followups.md',
      source: 'features',
      repo: 'r',
      root: '/Users/u/wigley-features/r',
    });

    const made = provisionalEntry(
      '/Users/u/wigley-features/r/f/notes.md',
      null,
      [owner],
      posixPaths,
    );

    expect(made.kind).toBe('feature-doc');
  });

  it('provisionalEntry_InsideUnknownSourceRoot_OwnedGlobal', () => {
    const owner = entry({
      path: '/Users/u/scratch/a.md',
      source: 'scratch',
      root: '/Users/u/scratch',
    });

    const made = provisionalEntry(
      '/Users/u/scratch/b.md',
      null,
      [owner],
      posixPaths,
    );

    expect(made).toMatchObject({
      source: 'global',
      repo: null,
      root: null,
      walked: [],
      headings: [],
      links: [],
      lastLoaded: null,
    });
  });

  it('provisionalEntry_OutsideEveryRoot_Global', () => {
    const made = provisionalEntry(
      '/Users/u/.claude/rules/x.md',
      'rule',
      repoEntries,
      posixPaths,
    );

    expect(made).toMatchObject({
      source: 'global',
      repo: null,
      root: null,
      kind: 'rule',
    });
  });

  it('provisionalEntry_PluginRootIgnored', () => {
    const pluginEntry = entry({
      path: '/Users/u/.claude/plugins/cache/m/p/1/skills/a/SKILL.md',
      source: 'plugin',
      plugin: 'p@m',
      root: '/Users/u/.claude/plugins/cache/m/p/1',
    });

    const made = provisionalEntry(
      '/Users/u/.claude/plugins/cache/m/p/1/notes.md',
      null,
      [pluginEntry],
      posixPaths,
    );

    expect(made.source).toBe('global');
  });

  it('provisionalEntry_WindowsRulesFolder_Rule', () => {
    const made = provisionalEntry(
      'C:\\Users\\u\\.claude\\rules\\x.md',
      null,
      [],
      windowsPaths,
    );

    expect(made).toMatchObject({ kind: 'rule', title: 'x.md' });
  });

  it('provisionalEntry_WindowsFolderOtherCase_KindGuessed', () => {
    const guessed = (path: string) =>
      provisionalEntry(path, null, [], windowsPaths).kind;

    expect(guessed('C:\\Users\\u\\.claude\\Rules\\x.md')).toBe('rule');
    expect(guessed('C:/Users/u/.claude/AGENTS/x.md')).toBe('subagent');
    expect(guessed('C:\\Users\\u\\.claude\\Commands\\x.md')).toBe('command');
  });

  it('provisionalEntry_PosixFolderOtherCase_Reference', () => {
    const made = provisionalEntry(
      '/Users/u/.claude/Rules/x.md',
      null,
      [],
      posixPaths,
    );

    expect(made.kind).toBe('reference');
  });

  it('provisionalEntry_FileNamedLikeFolder_NotGuessedFromIt', () => {
    const made = provisionalEntry('/Users/u/notes/rules', null, [], posixPaths);

    expect(made.kind).toBe('reference');
  });

  it('provisionalEntry_InsideClonePluginFolder_TakesPluginKey', () => {
    const clone = '/Users/u/dev/m';
    const pluginEntries = [
      entry({
        path: `${clone}/AGENTS.md`,
        source: 'repo',
        repo: 'm',
        root: clone,
      }),
      ...['f', 'g'].map((skill) =>
        entry({
          path: `${clone}/plugins/w/skills/${skill}/SKILL.md`,
          kind: 'skill',
          source: 'repo',
          repo: 'm',
          root: clone,
          plugin: 'w@m',
        }),
      ),
    ];
    const inPlugin = provisionalEntry(
      `${clone}/plugins/w/skills/h/SKILL.md`,
      'skill',
      pluginEntries,
      posixPaths,
    );
    const outside = provisionalEntry(
      `${clone}/notes.md`,
      null,
      pluginEntries,
      posixPaths,
    );

    expect(inPlugin.plugin).toBe('w@m');
    expect(outside.plugin).toBe(null);
  });
});

describe('changedPaths', () => {
  it('changedPaths_CreatedWithNoDocument_ListsItsPath', () => {
    const created = entry({ path: '/r/rules/tidy.md', kind: 'rule' });

    expect(
      changedPaths({ type: 'created', entry: created }, null, posixPaths),
    ).toEqual(['/r/rules/tidy.md']);
  });

  it('changedPaths_Renamed_ListsEntriesInsideItsNewPath', () => {
    const next = documentOf([
      entry({ path: '/r/skills/new/SKILL.md' }),
      entry({ path: '/r/skills/other/SKILL.md' }),
    ]);

    expect(
      changedPaths(
        { type: 'renamed', from: '/r/skills/old', to: '/r/skills/new' },
        next,
        posixPaths,
      ),
    ).toEqual(['/r/skills/new/SKILL.md']);
  });
});

describe('settlePending', () => {
  it('settlePending_ClearsOnlySettledChanges', () => {
    const pending = new Map([
      ['/a', 1],
      ['/b', 2],
    ]);

    expect([...settlePending(pending, 1)]).toEqual([['/b', 2]]);
    expect([...settlePending(pending, 2)]).toEqual([]);
  });
});

describe('detailFields', () => {
  it('detailFields_Hook_NullMatcherDash', () => {
    const hook = entry({
      path: '/Users/u/.claude/settings.json',
      kind: 'hook',
      meta: { event: 'PreToolUse', matcher: null, command: 'lint' },
    });

    expect(detailFields(hook, '/Users/u', posixPaths, HARNESSES)).toEqual([
      ['Event', 'PreToolUse'],
      ['Matcher', '—'],
      ['Command', 'lint'],
    ]);
  });

  it('detailFields_Plugin_InstallsJoined', () => {
    const plugin = entry({
      path: '/Users/u/.claude/plugins/cache/m/p/1',
      kind: 'plugin',
      meta: {
        harness: 'claude',
        version: '1.0.0',
        installs: [
          { scope: 'user', projectPath: null },
          { scope: 'project', projectPath: '/Users/u/dev/r' },
        ],
      },
    });

    expect(detailFields(plugin, '/Users/u', posixPaths, HARNESSES)).toEqual([
      ['Harness', 'Claude Code'],
      ['Version', '1.0.0'],
      ['Enabled', '—'],
      ['Installs', 'user, project · ~/dev/r'],
    ]);
  });
});

describe('readOnlyReason', () => {
  it('readOnlyReason_ThirdPartyPlugin_Downloaded', () => {
    const plugin = entry({
      path: '/c/v/skills/s/SKILL.md',
      owner: 'third-party',
      source: 'plugin',
      plugin: 'v@m',
      root: '/c/v',
    });

    expect(readOnlyReason(plugin)).toEqual({
      type: 'downloaded',
      plugin: 'v@m',
    });
  });

  it('readOnlyReason_SyncedSkill_DownloadedNoPlugin', () => {
    const synced = entry({
      path: '/Users/u/.claude/skills/synced/pdf/SKILL.md',
      owner: 'third-party',
      source: 'global',
    });

    expect(readOnlyReason(synced)).toEqual({
      type: 'downloaded',
      plugin: null,
    });
  });

  it('readOnlyReason_InstalledOnly_Installed', () => {
    const installed = entry({
      path: '/c/p/skills/s/SKILL.md',
      source: 'plugin',
      plugin: 'p@m',
      root: '/c/p',
    });

    expect(readOnlyReason(installed)).toEqual({
      type: 'installed',
      plugin: 'p@m',
    });
  });

  it('readOnlyReason_OwnRepoFile_Null', () => {
    const own = entry({
      path: '/Users/u/dev/m/plugins/w/skills/f/SKILL.md',
      source: 'repo',
      repo: 'm',
      root: '/Users/u/dev/m',
      plugin: 'w@m',
    });

    expect(readOnlyReason(own)).toBe(null);
  });
});

describe('readOnlyText', () => {
  it.each<{ reason: ReadOnlyReason; parts: string[] }>([
    { reason: { type: 'downloaded', plugin: 'v@m' }, parts: ['v@m'] },
    { reason: { type: 'installed', plugin: 'p@m' }, parts: ['p@m'] },
  ])(
    '$reason.type copy of $reason.plugin names $parts',
    ({ reason, parts }) => {
      const text = readOnlyText(reason);

      for (const part of parts) {
        expect(text).toContain(part);
      }
    },
  );
});

function fileStatus(overrides: Partial<FileStatus>): FileStatus {
  return {
    uncommitted: false,
    unpushed: false,
    notInstalled: [],
    ...overrides,
  };
}

function cloneStatus(overrides: Partial<CloneStatus>): CloneStatus {
  return {
    root: '/r',
    fetchedAt: null,
    fetchFailed: false,
    files: {},
    ...overrides,
  };
}

describe('fileStatuses', () => {
  it('fileStatuses_TwoClones_MergedByEntryId', () => {
    const s1 = fileStatus({ uncommitted: true });
    const s2 = fileStatus({ notInstalled: ['codex'] });
    const read = {
      clones: [
        cloneStatus({ root: '/a', files: { a: s1 } }),
        cloneStatus({ root: '/b', files: { b: s2 } }),
      ],
    };

    expect([...fileStatuses(read)]).toEqual([
      ['a', s1],
      ['b', s2],
    ]);
    expect(fileStatuses(null).size).toBe(0);
  });
});

describe('statusTexts', () => {
  // Plugin `w@m`'s file in the clone, with the given installed copies.
  const pluginFile = (installed: object[]) =>
    entry({
      path: '/Users/u/dev/m/plugins/w/skills/f/SKILL.md',
      source: 'repo',
      repo: 'm',
      root: '/Users/u/dev/m',
      plugin: 'w@m',
      meta: { installed },
    });
  const claudeCopy = {
    harness: 'claude',
    version: '1.9.1',
    path: '/Users/u/.claude/plugins/cache/m/w/1.9.1/skills/f/SKILL.md',
  };

  it('statusTexts_EverySet_InPinnedOrder', () => {
    const status = fileStatus({
      uncommitted: true,
      unpushed: true,
      notInstalled: ['codex', 'claude'],
    });

    expect(
      statusTexts(
        pluginFile([claudeCopy]),
        status,
        { 'w@m': '1.9.0' },
        HARNESSES,
      ),
    ).toEqual([
      expect.any(String),
      expect.any(String),
      expect.stringContaining('Claude Code'),
      expect.stringContaining('codex'),
      expect.any(String),
    ]);
  });

  it('statusTexts_LoadedSameVersion_NotStale', () => {
    expect(
      statusTexts(
        pluginFile([claudeCopy]),
        undefined,
        { 'w@m': '1.9.1' },
        HARNESSES,
      ),
    ).toEqual([]);
  });

  it('statusTexts_KeyNotLoaded_NotStale', () => {
    expect(
      statusTexts(pluginFile([claudeCopy]), undefined, {}, HARNESSES),
    ).toEqual([]);
  });

  it('statusTexts_NoClaudeCopy_NotStale', () => {
    const codexCopy = {
      harness: 'codex',
      version: '0.17.1',
      path: '/Users/u/.codex/plugins/cache/m/w/0.17.1/skills/f/SKILL.md',
    };

    expect(
      statusTexts(
        pluginFile([codexCopy]),
        undefined,
        { 'w@m': '0.1.0' },
        HARNESSES,
      ),
    ).toEqual([]);
  });
});

describe('rollupText', () => {
  it('rollupText_Counts_InOrderZerosLeftOut', () => {
    const counts = {
      uncommitted: 3,
      unpushed: 1,
      notInstalled: { claude: 0, codex: 12 },
    };

    expect(rollupText(counts, HARNESSES)).toMatch(/3.*1.*12.*codex/);
  });

  it('rollupText_BothHarnesses_ClaudeFirst', () => {
    const counts = {
      uncommitted: 0,
      unpushed: 0,
      notInstalled: { claude: 2, codex: 5 },
    };

    expect(rollupText(counts, HARNESSES)).toMatch(/2.*Claude Code.*5.*codex/);
  });

  it('rollupText_AllZero_Null', () => {
    const counts = {
      uncommitted: 0,
      unpushed: 0,
      notInstalled: { claude: 0, codex: 0 },
    };

    expect(rollupText(counts, HARNESSES)).toBe(null);
  });
});

describe('fetchText', () => {
  const wrapped = (iso: string) => `T(${iso})`;

  it('fetchText_FailedFetched_OriginAsOf', () => {
    const clone = cloneStatus({
      fetchFailed: true,
      fetchedAt: '2026-10-24T10:00:00Z',
    });

    expect(fetchText(clone, wrapped)).toContain(
      wrapped('2026-10-24T10:00:00Z'),
    );
  });

  it('fetchText_FailedNeverFetched_OriginNeverFetched', () => {
    const clone = cloneStatus({ fetchFailed: true, fetchedAt: null });

    expect(fetchText(clone, wrapped)).toEqual(expect.any(String));
  });

  it('fetchText_NotFailed_Null', () => {
    const clone = cloneStatus({
      fetchFailed: false,
      fetchedAt: '2026-10-24T10:00:00Z',
    });

    expect(fetchText(clone, wrapped)).toBe(null);
  });
});

describe('treeRowStatus', () => {
  const noTexts = () => [];
  const asIs = (iso: string) => iso;
  const leafA = leaf('entry:a', 'A', 'a');
  const uncommittedA = new Map([['a', fileStatus({ uncommitted: true })]]);
  const failedClone = cloneStatus({
    root: '/r',
    fetchFailed: true,
    files: { a: fileStatus({ uncommitted: true }) },
  });

  it('treeRowStatus_StarredGroup_NoDetail', () => {
    const starredGroup = group('owner:starred', 'Starred', [
      leaf('owner:starred/entry:a', 'A', 'a'),
    ]);

    expect(
      treeRowStatus(
        starredGroup,
        noTexts,
        uncommittedA,
        [],
        asIs,
        posixPaths,
        HARNESSES,
      ),
    ).toEqual({ mark: null, detail: null });
  });

  it.each<{ node: TreeNode; detail: string | null }>([
    { node: HEADING_MATCH, detail: 'Page' },
    { node: WIKI_LINK, detail: null },
    { node: WIKI_LABEL, detail: null },
  ])('treeRowStatus_WikiRows ($node.type)', ({ node, detail }) => {
    expect(
      treeRowStatus(
        node,
        noTexts,
        uncommittedA,
        [],
        asIs,
        posixPaths,
        HARNESSES,
      ),
    ).toEqual({ mark: null, detail });
  });

  it('treeRowStatus_LeafWithTexts_MarkJoined', () => {
    const texts = () => ['Uncommitted', 'Not installed · codex'];

    expect(
      treeRowStatus(leafA, texts, new Map(), [], asIs, posixPaths, HARNESSES),
    ).toEqual({ mark: 'Uncommitted · Not installed · codex', detail: null });
  });

  it('treeRowStatus_LeafNoTexts_Nothing', () => {
    expect(
      treeRowStatus(leafA, noTexts, new Map(), [], asIs, posixPaths, HARNESSES),
    ).toEqual({ mark: null, detail: null });
  });

  it('treeRowStatus_PluginNode_Rollup', () => {
    const plugin = group(
      'repo:m/plugin:w@m',
      'w@m',
      [
        group('repo:m/plugin:w@m/skill', 'Skills', [
          leafA,
          leaf('entry:b', 'B', 'b'),
          leaf('entry:c', 'C', 'c'),
        ]),
      ],
      { type: 'plugin' },
    );
    const files = new Map([
      ['a', fileStatus({ uncommitted: true })],
      ['b', fileStatus({ uncommitted: true, unpushed: true })],
    ]);

    expect(
      treeRowStatus(plugin, noTexts, files, [], asIs, posixPaths, HARNESSES),
    ).toEqual({ mark: null, detail: expect.stringMatching(/2.*1/) });
  });

  it('treeRowStatus_RepoNodeFetchFailed_RollupThenOrigin', () => {
    const repo = group('repo:m', 'm', [leafA], { type: 'repo', clone: '/r' });

    const status = treeRowStatus(
      repo,
      noTexts,
      uncommittedA,
      [failedClone],
      asIs,
      posixPaths,
      HARNESSES,
    );

    expect(status.detail).toMatch(/^1 /);
    expect(status.detail).toContain(fetchText(failedClone, asIs) as string);
  });

  it('treeRowStatus_SplitRepoNode_RollupNoOrigin', () => {
    const repo = group('repo:m', 'm', [leafA], { type: 'repo', clone: null });

    const status = treeRowStatus(
      repo,
      noTexts,
      uncommittedA,
      [failedClone],
      asIs,
      posixPaths,
      HARNESSES,
    );

    expect(status.detail).toMatch(/^1 /);
    expect(status.detail).not.toContain(fetchText(failedClone, asIs) as string);
  });

  it('treeRowStatus_KindGroup_NoDetail', () => {
    const kind = group('repo:m/skill', 'Skills', [leafA]);

    expect(
      treeRowStatus(
        kind,
        noTexts,
        uncommittedA,
        [],
        asIs,
        posixPaths,
        HARNESSES,
      ),
    ).toEqual({ mark: null, detail: null });
  });
});

describe('paneFocusedBy', () => {
  it.each([
    {
      from: 'tree',
      direction: 'right',
      isTreeOwnPane: true,
      isAsideInSight: true,
      after: 'doc',
    },
    {
      from: 'tree',
      direction: 'right',
      isTreeOwnPane: false,
      isAsideInSight: false,
      after: 'doc',
    },
    {
      from: 'doc',
      direction: 'left',
      isTreeOwnPane: true,
      isAsideInSight: true,
      after: 'tree',
    },
    {
      from: 'doc',
      direction: 'left',
      isTreeOwnPane: false,
      isAsideInSight: true,
      after: null,
    },
    {
      from: 'doc',
      direction: 'right',
      isTreeOwnPane: true,
      isAsideInSight: true,
      after: 'aside',
    },
    {
      from: 'doc',
      direction: 'right',
      isTreeOwnPane: true,
      isAsideInSight: false,
      after: null,
    },
    {
      from: 'aside',
      direction: 'left',
      isTreeOwnPane: false,
      isAsideInSight: true,
      after: 'doc',
    },
    {
      from: 'aside',
      direction: 'right',
      isTreeOwnPane: true,
      isAsideInSight: true,
      after: null,
    },
    {
      from: 'tree',
      direction: 'left',
      isTreeOwnPane: true,
      isAsideInSight: true,
      after: null,
    },
    {
      from: 'tree',
      direction: 'up',
      isTreeOwnPane: true,
      isAsideInSight: true,
      after: null,
    },
    {
      from: 'doc',
      direction: 'down',
      isTreeOwnPane: true,
      isAsideInSight: true,
      after: null,
    },
    {
      from: 'aside',
      direction: 'up',
      isTreeOwnPane: true,
      isAsideInSight: true,
      after: null,
    },
  ] as const)(
    'paneFocusedBy: $from $direction, own tree $isTreeOwnPane, aside $isAsideInSight',
    ({ from, direction, isTreeOwnPane, isAsideInSight, after }) => {
      expect(
        paneFocusedBy(from, direction, { isTreeOwnPane, isAsideInSight }),
      ).toBe(after);
    },
  );
});
