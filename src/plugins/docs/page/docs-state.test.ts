import { describe, expect, it } from 'vitest';
import type { IndexContext, IndexDocument, IndexEntry } from '../contract';
import type { TreeGroup, TreeLeaf, TreeNode } from '../tree';
import {
  applyChange,
  changeableEntry,
  chips,
  codeFence,
  conflictText,
  contextChoices,
  detailFields,
  noPlaceText,
  parentId,
  provisionalEntry,
  readOnlyText,
  reapplyChange,
  renameRecord,
  rootIds,
  settlePending,
  stepSelection,
  type TreeRow,
  type TreeState,
  topVisibleLine,
  trashQuestion,
  UNSAVED_TEXT,
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

function entry(overrides: Partial<IndexEntry> & { path: string }): IndexEntry {
  return {
    id: overrides.path,
    kind: 'reference',
    source: 'global',
    repo: null,
    root: null,
    plugin: null,
    line: null,
    title: overrides.path.slice(overrides.path.lastIndexOf('/') + 1),
    meta: {},
    ...overrides,
  };
}

function documentOf(
  entries: IndexEntry[],
  contexts: IndexContext[] = [],
): IndexDocument {
  return {
    schemaVersion: 1,
    generatedAt: '2026-10-20T00:00:00Z',
    entries,
    contexts,
  };
}

const paths = (document: IndexDocument) =>
  document.entries.map((each) => each.path);

describe('applyChange', () => {
  it('applyChange_Created_AddsEntry', () => {
    const before = documentOf([entry({ path: '/Users/u/dev/r/a.md' })]);

    const after = applyChange(before, {
      type: 'created',
      entry: entry({ path: '/Users/u/dev/r/b.md' }),
    });

    expect(paths(after)).toEqual([
      '/Users/u/dev/r/a.md',
      '/Users/u/dev/r/b.md',
    ]);
  });

  it('applyChange_RenamedFile_PathIdAndTitle', () => {
    const before = documentOf([
      entry({ path: '/r/a.md', title: 'a.md' }),
      entry({ path: '/r/c.md', title: 'Alpha' }),
    ]);

    const renamedA = applyChange(before, {
      type: 'renamed',
      from: '/r/a.md',
      to: '/r/sub/b.md',
    });
    const renamedC = applyChange(before, {
      type: 'renamed',
      from: '/r/c.md',
      to: '/r/d.md',
    });

    expect(renamedA.entries[0]).toMatchObject({
      id: '/r/sub/b.md',
      path: '/r/sub/b.md',
      title: 'b.md',
    });
    expect(renamedC.entries[1].title).toBe('Alpha');
  });

  it('applyChange_RenamedFolder_MovesEntriesInside', () => {
    const before = documentOf([
      entry({ path: '/r/skills/s/SKILL.md', kind: 'skill', title: 's' }),
    ]);

    const after = applyChange(before, {
      type: 'renamed',
      from: '/r/skills/s',
      to: '/r/skills/t',
    });

    expect(paths(after)).toEqual(['/r/skills/t/SKILL.md']);
  });

  it('applyChange_Renamed_StatesFollowId', () => {
    const launch = { claude: { state: 'launch' as const, reason: 'r' } };
    const before = documentOf(
      [entry({ path: '/r/a.md' })],
      [{ folder: '/r', sessionId: null, states: { '/r/a.md': launch } }],
    );

    const after = applyChange(before, {
      type: 'renamed',
      from: '/r/a.md',
      to: '/r/sub/b.md',
    });

    expect(after.contexts[0].states).toEqual({ '/r/sub/b.md': launch });
  });

  it('applyChange_TrashedFolder_DropsEntriesInside', () => {
    const before = documentOf([
      entry({ path: '/r/skills/s/SKILL.md' }),
      entry({ path: '/r/skills/s/ref.md' }),
      entry({ path: '/r/other.md' }),
    ]);

    const after = applyChange(before, { type: 'trashed', path: '/r/skills/s' });

    expect(paths(after)).toEqual(['/r/other.md']);
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

    const after = reapplyChange(documentOf([built]), {
      type: 'created',
      entry: provisional,
    });

    expect(after.entries).toEqual([built]);
  });

  it('reapplyChange_CreatedIdMissing_AddsEntry', () => {
    const created = entry({ path: '/r/b.md' });

    const after = reapplyChange(documentOf([entry({ path: '/r/a.md' })]), {
      type: 'created',
      entry: created,
    });

    expect(paths(after)).toEqual(['/r/a.md', '/r/b.md']);
  });

  it('reapplyChange_RenamedToListed_FileMadeAtFromStays', () => {
    const before = documentOf([
      entry({ path: '/r/x.md' }),
      entry({ path: '/r/y.md' }),
    ]);

    const after = reapplyChange(before, {
      type: 'renamed',
      from: '/r/x.md',
      to: '/r/y.md',
    });

    expect(paths(after)).toEqual(['/r/x.md', '/r/y.md']);
  });

  it('reapplyChange_RenamedToMissing_Moves', () => {
    const after = reapplyChange(documentOf([entry({ path: '/r/x.md' })]), {
      type: 'renamed',
      from: '/r/x.md',
      to: '/r/y.md',
    });

    expect(paths(after)).toEqual(['/r/y.md']);
  });

  it('reapplyChange_RenamedFolderToListed_Skipped', () => {
    const before = documentOf([entry({ path: '/r/skills/t/SKILL.md' })]);

    const after = reapplyChange(before, {
      type: 'renamed',
      from: '/r/skills/s',
      to: '/r/skills/t',
    });

    expect(paths(after)).toEqual(['/r/skills/t/SKILL.md']);
  });
});

describe('renameRecord', () => {
  it('renameRecord_File_NamesFiles', () => {
    expect(renameRecord('/r/rules/a.md', '/r/rules/b.md')).toEqual({
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
    );

  it('changeableEntry_Doc_Allowed', () => {
    expect(check(rule.id)).toEqual({ entry: rule });
  });

  it('changeableEntry_NothingSelectedOrGone_Null', () => {
    const none = changeableEntry(null, (id) => byId.get(id), 'Select', []);

    expect(none).toBe(null);
    expect(check('/r/gone.md')).toBe(null);
  });

  it('changeableEntry_Group_RefusedWithGroupText', () => {
    const checked = changeableEntry(
      group('group:/r', 'r', []),
      (id) => byId.get(id),
      'Select a doc to rename',
      [],
    );

    expect(checked).toEqual({
      refusal: { text: 'Select a doc to rename', tone: 'info' },
    });
  });

  it('changeableEntry_ItemInsideFile_Refused', () => {
    const refusedText = (id: string) => {
      const checked = check(id);
      return checked !== null && 'refusal' in checked
        ? checked.refusal.text
        : null;
    };

    expect(refusedText(followup.id)).toBe(
      'Fix it is an item inside followups.md; it cannot be renamed or moved to the Trash alone',
    );
    expect(refusedText(hook.id)).toBe(
      'PreToolUse is an item inside settings.json; it cannot be renamed or moved to the Trash alone',
    );
  });

  it('changeableEntry_PluginCache_RefusedReadOnly', () => {
    expect(check(cached.id)).toEqual({
      refusal: { text: readOnlyText('p@m'), tone: 'info' },
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

describe('key hint texts', () => {
  it('conflictText_AllBound_EachAnswerWithKeys', () => {
    expect(conflictText({ reload: 'r', overwrite: 'o', cancel: 'Esc' })).toBe(
      'File changed on disk — r reload, o overwrite, Esc cancel',
    );
  });

  it('conflictText_UnboundAnswer_DropsOut', () => {
    expect(conflictText({ reload: 'R', overwrite: null, cancel: 'q' })).toBe(
      'File changed on disk — R reload, q cancel',
    );
    expect(conflictText({ reload: null, overwrite: null, cancel: null })).toBe(
      'File changed on disk',
    );
  });

  it('trashQuestion_Keys_AfterQuestion', () => {
    expect(trashQuestion('a.md', { yes: 'y', no: 'n' })).toBe(
      'Move a.md to the Trash? y/n',
    );
    expect(trashQuestion('a.md', { yes: 'Y', no: null })).toBe(
      'Move a.md to the Trash? Y',
    );
    expect(trashQuestion('a.md', { yes: null, no: null })).toBe(
      'Move a.md to the Trash?',
    );
  });

  it('noPlaceText_CreateByPathBoundOrNot', () => {
    expect(noPlaceText('learning', 'A')).toBe(
      'No place holds a learning yet — A creates a file by path',
    );
    expect(noPlaceText('learning', null)).toBe('No place holds a learning yet');
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

  it('provisionalEntry_InsideRepoRoot_CopiesOwner', () => {
    const made = provisionalEntry(
      '/Users/u/dev/r/nested/x.md',
      null,
      repoEntries,
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
    });
  });

  it('provisionalEntry_GuessesKindFromPath', () => {
    const guessed = (path: string) => provisionalEntry(path, null, repoEntries);

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
    );

    expect(made.kind).toBe('feature-doc');
  });

  it('provisionalEntry_OutsideEveryRoot_Global', () => {
    const made = provisionalEntry(
      '/Users/u/.claude/rules/x.md',
      'rule',
      repoEntries,
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
    );

    expect(made.source).toBe('global');
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

    expect(detailFields(hook, '/Users/u')).toEqual([
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

    expect(detailFields(plugin, '/Users/u')).toEqual([
      ['Harness', 'Claude'],
      ['Version', '1.0.0'],
      ['Enabled', '—'],
      ['Installs', 'user, project · ~/dev/r'],
    ]);
  });
});
