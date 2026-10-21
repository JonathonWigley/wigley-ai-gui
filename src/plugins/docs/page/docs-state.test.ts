import { describe, expect, it } from 'vitest';
import type { IndexContext, IndexDocument } from '../contract';
import type { TreeGroup, TreeLeaf, TreeNode } from '../tree';
import {
  chips,
  codeFence,
  contextChoices,
  parentId,
  rootIds,
  stepSelection,
  type TreeRow,
  type TreeState,
  topVisibleLine,
  visibleRows,
} from './docs-state';

function group(id: string, title: string, children: TreeNode[]): TreeGroup {
  return { type: 'group', id, title, folder: '/', children };
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

function context(folder: string): IndexContext {
  return { folder, sessionId: null, states: {} };
}

describe('visibleRows', () => {
  it('visibleRows_CollapsedGroup_HidesChildren', () => {
    const rows = visibleRows(
      NESTED,
      state({ expanded: new Set(['a']) }),
      pathOf,
    );

    expect(rowSummary(rows)).toEqual([
      { id: 'a', depth: 0, isExpanded: true },
      { id: 'b', depth: 1, isExpanded: false },
    ]);
  });

  it('visibleRows_Filter_ShowsMatchesUnderExpandedGroups', () => {
    const rows = visibleRows(FILTER_TREE, state({ filter: 'STYLE' }), pathOf);

    expect(rowSummary(rows)).toEqual([
      { id: 'root', depth: 0, isExpanded: true },
      { id: 'rules', depth: 1, isExpanded: true },
      { id: 'style', depth: 2, isExpanded: false },
    ]);
  });

  it('visibleRows_FilterMatchesPath_Shown', () => {
    const rows = visibleRows(FILTER_TREE, state({ filter: 'rules/' }), pathOf);

    expect(rows.map((row) => row.node.id)).toContain('style');
    expect(rows.map((row) => row.node.id)).not.toContain('other');
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

describe('parentId', () => {
  it('parentId_LeafInGroup_GroupId', () => {
    expect(parentId(NESTED, 'c')).toBe('b');
    expect(parentId(NESTED, 'a')).toBeNull();
  });
});

describe('rootIds', () => {
  it('rootIds_Tree_RootsOnly', () => {
    expect([...rootIds(FILTER_TREE)]).toEqual(['root']);
  });
});

describe('chips', () => {
  it('chips_StatesPresent_TextAndReason', () => {
    const withStates: IndexContext = {
      folder: '/Users/u',
      sessionId: null,
      states: { e: { claude: { state: 'launch', reason: 'user CLAUDE.md' } } },
    };

    expect(chips(withStates, 'e', false)).toEqual({
      claude: {
        text: 'Claude launch',
        tooltip: 'user CLAUDE.md',
        state: 'launch',
      },
      codex: { text: 'Codex —', tooltip: '', state: 'none' },
    });
  });

  it('chips_Pending_PendingText', () => {
    const result = chips(context('/Users/u'), 'e', true);

    expect(result.claude).toEqual({
      text: 'Claude pending',
      tooltip: 'Changed since the last build',
      state: 'pending',
    });
    expect(result.codex.text).toBe('Codex pending');
    expect(result.codex.tooltip).toBe('Changed since the last build');
  });

  it('chips_NoContext_Dashes', () => {
    const result = chips(null, 'e', false);

    expect(result.claude.text).toBe('Claude —');
    expect(result.codex.text).toBe('Codex —');
  });
});

describe('contextChoices', () => {
  it('contextChoices_HomeFirstThenByFolder', () => {
    const document: IndexDocument = {
      schemaVersion: 1,
      generatedAt: '2026-10-20T00:00:00Z',
      entries: [],
      contexts: [
        context('/Users/u/dev/b'),
        context('/Users/u'),
        context('/Users/u/dev/a'),
      ],
    };

    const folders = contextChoices(document, '/Users/u').map((c) => c.folder);

    expect(folders).toEqual(['/Users/u', '/Users/u/dev/a', '/Users/u/dev/b']);
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
