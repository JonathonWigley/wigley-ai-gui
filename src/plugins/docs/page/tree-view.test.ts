import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeFuzzyMatcher } from '../../../shared/fake-fuzzy-matcher.test-support';
import { withUser } from '../../../shared/page/layout-host/test-layouts';
import {
  asFake,
  type FocusFakeElement,
  findAll,
  installFocusFakeDom,
} from '../../../shared/page/test-dom';
import defaultLayout from '../layouts/default/layout.js';
import type { Layout, TreeRowInput } from '../layouts/layout';
import type {
  TreeGroup,
  TreeLeaf,
  TreeNode,
  TreeWikiLabel,
  TreeWikiLink,
} from '../tree';
import { fakeDocsParts, fakePushedScope, noAnchor } from './docs-page-fakes';
import { createTreeView, type TreeView, type TreeViewDeps } from './tree-view';

// A tree pane marked `marker` that places every app part.
function paneLayout(marker: string): Layout {
  return {
    treePane(parent, _input, kit) {
      const pane = kit.el(parent, 'div', marker);
      kit.status(pane);
      kit.filterBox(pane);
      kit.line(pane);
      kit.rows(pane);
      return { element: pane };
    },
  };
}

function treeDeps(parts: ReturnType<typeof fakeDocsParts>['parts']) {
  return {
    log: () => undefined,
    matcher: fakeFuzzyMatcher,
    parts,
    isMachine: true,
    hasWiki: false,
    openLeaf: () => undefined,
    openHeading: () => undefined,
    openWikiLink: () => undefined,
    switchView: () => undefined,
    rowClicked: () => undefined,
    pushBoxScope: fakePushedScope,
    filterClosed: () => undefined,
    anchor: noAnchor,
    rowStatus: () => ({ mark: null, detail: null }),
    leafMarks: () => ({ time: null, isStarred: false }),
    placeChanged: () => undefined,
  };
}

function shelf(title: string, children: TreeNode[]): TreeGroup {
  return {
    type: 'group',
    id: `shelf:${title}`,
    title,
    folder: null,
    role: { type: 'other' },
    children,
  };
}

function page(title: string): TreeLeaf {
  return {
    type: 'entry',
    id: `entry:e:${title}`,
    title,
    entryId: `e:${title}`,
  };
}

function wikiLink(overrides: Partial<TreeWikiLink>): TreeWikiLink {
  return {
    type: 'wikiLink',
    id: 'link',
    title: 'Link',
    target: { type: 'kind', kind: 'skill' },
    count: null,
    isDangling: false,
    ...overrides,
  };
}

const WIKI_LABEL: TreeWikiLabel = {
  type: 'wikiLabel',
  id: 'label',
  title: 'Label',
};

// A wiki-capable tree whose rows draw `li.test-row` holding only the title and
// the prompt, its last input per row id in `inputs`, and the command each
// prompt element anchors in `commands`.
function wikiSetUp(overrides: Partial<TreeViewDeps> = {}) {
  const inputs = new Map<string, TreeRowInput>();
  const commands = new Map<unknown, string>();
  const rowLayout: Layout = {
    ...paneLayout('pane'),
    treeRow(parent, input, kit) {
      inputs.set(input.id, input);
      const row = kit.el(parent, 'li', 'test-row', input.title);
      kit.cursorPrompt(row);
      return { element: row };
    },
  };
  const { parts } = fakeDocsParts(() => withUser(defaultLayout, rowLayout));
  const openWikiLink = vi.fn();
  const switchView = vi.fn();
  const filterClosed = vi.fn();
  const tree = createTreeView({
    ...treeDeps(parts),
    hasWiki: true,
    openWikiLink,
    switchView,
    filterClosed,
    // A click runs `docs.openNode`, whose handler reaches `openNode`.
    rowClicked: (nodeId) => tree.openNode(nodeId),
    anchor: (element, command) => {
      commands.set(element, command);
      return { dispose: () => undefined };
    },
    ...overrides,
  });
  const root = asFake(tree.element);
  return {
    tree,
    root,
    inputs,
    commands,
    openWikiLink,
    switchView,
    filterClosed,
    titles: () => findAll(root, 'test-row').map((row) => row.textContent),
    selected: () => findAll(root, 'is-selected').map((row) => row.textContent),
    type: (filter: string) => {
      tree.openFilter();
      const box = findAll(root, 'docs-box')[0] as FocusFakeElement;
      box.value = filter;
      box.fire('input');
    },
  };
}

const NOTHING = () => '';
const NO_HEADINGS = () => [];

describe('createTreeView', () => {
  beforeEach(() =>
    installFocusFakeDom((name, value) => vi.stubGlobal(name, value)),
  );
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('redraw_FilterOpenWithText_KeepsTheInputItsTextAndFocus', () => {
    let shown = withUser(defaultLayout, paneLayout('pane-1'));
    const { parts } = fakeDocsParts(() => shown);
    const tree = createTreeView(treeDeps(parts));
    const root = asFake(tree.element);
    tree.openFilter();
    const input = findAll(root, 'docs-box')[0] as FocusFakeElement;
    input.value = 'plan';
    input.fire('input');

    shown = withUser(defaultLayout, paneLayout('pane-2'));
    tree.redraw();

    expect(findAll(root, 'pane-2')).toHaveLength(1);
    expect(findAll(root, 'pane-1')).toEqual([]);
    expect(findAll(root, 'docs-box')[0]).toBe(input);
    expect(input.value).toBe('plan');
    expect(document.activeElement).toBe(input);
  });

  it('dispose_AnchorThrows_DisposesTheDrawnParts', () => {
    const hintingPane: Layout = {
      treePane(parent, _input, kit) {
        const pane = kit.el(parent, 'div');
        kit.keyHint(pane, 'filter');
        return { element: pane };
      },
    };
    const { parts, anchors } = fakeDocsParts(() =>
      withUser(defaultLayout, hintingPane),
    );
    const tree = createTreeView({
      ...treeDeps(parts),
      anchor: () => ({
        dispose() {
          throw new Error('anchor gone');
        },
      }),
    });
    tree.redraw();
    expect(anchors.length).toBeGreaterThan(0);

    expect(() => tree.dispose()).toThrow('anchor gone');

    expect(anchors.filter((anchor) => !anchor.isDisposed)).toEqual([]);
  });

  it('toggle_HeadingRow_CallsOpenHeading', () => {
    const shown = withUser(defaultLayout, paneLayout('pane'));
    const { parts } = fakeDocsParts(() => shown);
    const openHeading = vi.fn();
    const tree = createTreeView({ ...treeDeps(parts), openHeading });
    const page: TreeLeaf = {
      type: 'entry',
      id: 'page',
      title: 'Page',
      entryId: 'e:page',
    };
    tree.setTree(
      [
        {
          type: 'group',
          id: 'root',
          title: 'Root',
          folder: null,
          role: { type: 'other' },
          children: [page],
        },
      ],
      () => '',
      () => [{ level: 2, text: 'Some notes', line: 4 }],
      true,
    );
    tree.openFilter();
    const input = findAll(
      asFake(tree.element),
      'docs-box',
    )[0] as FocusFakeElement;
    input.value = 'notes';
    input.fire('input');
    tree.acceptFilter();
    tree.down();
    tree.down();

    tree.toggle();

    expect(openHeading).toHaveBeenCalledExactlyOnceWith(
      {
        type: 'headingMatch',
        id: 'page/heading:4',
        title: 'Some notes',
        entryId: 'e:page',
        line: 4,
        docTitle: 'Page',
        leafId: 'page',
      },
      true,
    );
  });

  it('showView_AwayAndBack_KeepsTheSelectionAndTheCollapsedGroup', () => {
    const { tree, titles, selected } = wikiSetUp();
    tree.setWikiTree(
      [shelf('One', [page('a')]), shelf('Two', [page('b')])],
      [],
      true,
    );
    tree.down();
    tree.down();
    tree.close();
    tree.up();

    tree.showView('all');
    tree.showView('wiki');

    expect(titles()).toEqual(['One', 'a', 'Two']);
    expect(selected()).toEqual(['a']);
  });

  it('showView_AllHoldsAFilter_WikiUnfilteredAndTheFilterReturns', () => {
    const { tree, titles, type } = wikiSetUp();
    tree.setWikiTree([shelf('One', [page('wiki page')])], [], true);
    tree.setTree(
      [shelf('Mine', [page('alpha'), page('beta')])],
      NOTHING,
      NO_HEADINGS,
      true,
    );
    tree.showView('all');
    type('alpha');
    tree.acceptFilter();

    tree.showView('wiki');
    expect(titles()).toEqual(['One', 'wiki page']);

    tree.showView('all');
    expect(titles()).toEqual(['Mine', 'alpha']);
  });

  it.each([
    { name: 'BoxHoldsFocus', isFocusElsewhere: false, closedCalls: 1 },
    { name: 'FocusElsewhere', isFocusElsewhere: true, closedCalls: 0 },
  ])(
    'showView_FilterOpen_FocusEndsOnThePaneOnlyFromTheBox_$name',
    ({ isFocusElsewhere, closedCalls }) => {
      const { tree, filterClosed, type } = wikiSetUp();
      type('alpha');
      const elsewhere = document.createElement('button');
      if (isFocusElsewhere) {
        elsewhere.focus();
      }

      tree.showView('all');

      expect(document.activeElement).toBe(
        isFocusElsewhere ? elsewhere : tree.element,
      );
      expect(filterClosed).toHaveBeenCalledTimes(closedCalls);
    },
  );

  it('wikiFilter_DocOutsideMain_ShowsUnderItsGroups', () => {
    const { tree, titles, type } = wikiSetUp();
    tree.setWikiTree(
      [shelf('One', [page('listed')])],
      [shelf('Repo', [shelf('Rules', [page('outside')])])],
      true,
    );

    type('outside');

    expect(titles()).toEqual(['Repo', 'Rules', 'outside']);
  });

  it('wikiFilter_NoMainPage_StillFindsTheDocs', () => {
    const { tree, titles, type, root } = wikiSetUp();
    tree.setWikiTree([], [shelf('Repo', [page('outside')])], true);
    expect(findAll(root, 'docs-line-slot')[0].textContent).toContain('Main.md');

    type('outside');

    expect(titles()).toEqual(['Repo', 'outside']);
  });

  it('wikiFilter_EndsOnARowTheShelvesDoNotHold_SelectsTheFirstRow', () => {
    const { tree, selected, type } = wikiSetUp();
    tree.setWikiTree(
      [shelf('One', [page('listed')])],
      [shelf('Repo', [page('outside')])],
      true,
    );
    type('outside');
    tree.acceptFilter();
    tree.down();
    tree.down();
    expect(selected()).toEqual(['outside']);

    tree.openFilter();
    tree.cancelFilter();

    expect(selected()).toEqual(['One']);
  });

  it('setWikiTree_DropsTheSelectedRow_SelectsTheFirstRow', () => {
    const { tree, selected } = wikiSetUp();
    tree.setWikiTree([shelf('One', [page('a'), page('b')])], [], true);
    tree.down();
    tree.down();
    expect(selected()).toEqual(['b']);

    tree.setWikiTree([shelf('One', [page('a')])], [], true);

    expect(selected()).toEqual(['One']);
  });

  it('setWikiTree_AddsAGroup_ExpandsItAndTheCollapsedGroupStays', () => {
    const { tree, titles } = wikiSetUp();
    tree.setWikiTree([shelf('One', [page('a')])], [], true);
    tree.close();

    tree.setWikiTree(
      [shelf('One', [page('a')]), shelf('Two', [page('b')])],
      [],
      true,
    );

    expect(titles()).toEqual(['One', 'Two', 'b']);
  });

  it('setWikiTree_EmptyTreeThenBack_TheCollapsedGroupStaysCollapsed', () => {
    const { tree, titles } = wikiSetUp();
    const shelves = [shelf('One', [page('a')])];
    tree.setWikiTree(shelves, [], true);
    tree.close();

    tree.setWikiTree([], [], true);
    tree.setWikiTree(shelves, [], true);

    expect(titles()).toEqual(['One']);
  });

  it('click_LabelRowWithFocusInThePane_DrawsTheNewSelection', () => {
    const { tree, root, selected } = wikiSetUp();
    tree.setWikiTree([shelf('One', [WIKI_LABEL, page('a')])], [], true);
    tree.focus();
    const label = findAll(root, 'test-row').find(
      (row) => row.textContent === 'Label',
    );

    label?.click();

    expect(selected()).toEqual(['Label']);
  });

  it('openNode_Row_SelectsFocusesThenOpens', () => {
    const openLeaf = vi.fn();
    const { tree, selected } = wikiSetUp({ openLeaf });
    tree.setWikiTree([shelf('One', [page('a'), page('b')])], [], true);

    tree.openNode('entry:e:b');

    expect({
      selected: selected(),
      isFocused: document.activeElement === tree.element,
      opened: openLeaf.mock.calls.map(([leaf]) => (leaf as TreeLeaf).title),
    }).toEqual({ selected: ['b'], isFocused: true, opened: ['b'] });
  });

  it('openNode_NoRow_LogsAndKeepsTheSelection', () => {
    const logs: string[] = [];
    const openLeaf = vi.fn();
    const { tree, selected } = wikiSetUp({
      openLeaf,
      log: (line) => logs.push(line),
    });
    tree.setWikiTree([shelf('One', [page('a')])], [], true);

    tree.openNode('entry:e:gone');

    expect({ selected: selected(), logs, opened: openLeaf.mock.calls }).toEqual(
      {
        selected: ['One'],
        logs: ['no row entry:e:gone'],
        opened: [],
      },
    );
  });

  it.each<{
    name: string;
    node: TreeNode;
    expected: Partial<TreeRowInput>;
  }>([
    {
      name: 'DanglingLink',
      node: wikiLink({ isDangling: true }),
      expected: {
        type: 'wikiLink',
        isDangling: true,
        count: null,
        isPrompted: false,
      },
    },
    {
      name: 'LinkWithACount',
      node: wikiLink({ count: 7 }),
      expected: {
        type: 'wikiLink',
        isDangling: false,
        count: 7,
        isPrompted: false,
      },
    },
    {
      name: 'Label',
      node: WIKI_LABEL,
      expected: {
        type: 'wikiLabel',
        isDangling: false,
        count: null,
        isPrompted: false,
      },
    },
  ])('rowInput_$name_SelectedRowHoldsItsFields', ({ node, expected }) => {
    const { tree, inputs, selected } = wikiSetUp();
    tree.setWikiTree([shelf('One', [node])], [], true);
    tree.down();
    expect(selected()).toEqual([node.title]);

    expect(inputs.get(node.id)).toMatchObject(expected);
  });

  it('prompt_PageRowInTheWiki_OffersRenameAndTrashAndNoStar', () => {
    const { tree, root, commands } = wikiSetUp();
    tree.setWikiTree([shelf('One', [page('a')])], [], true);
    tree.setTree([shelf('Mine', [page('a')])], NOTHING, NO_HEADINGS, true);
    const promptCommands = () =>
      findAll(root, 'docs-row-actions')
        .flatMap((actions) => actions.children)
        .map((action) => commands.get(action));
    tree.down();

    expect(promptCommands()).toEqual(['rename', 'trash']);

    tree.showView('all');
    tree.down();
    expect(promptCommands()).toEqual(['toggleStar', 'rename', 'trash']);
  });

  it('selectEntry_InBothViews_EachSelectsItWhileTheWikiShows', () => {
    const { tree, selected } = wikiSetUp();
    tree.setWikiTree(
      [shelf('One', [page('other')]), shelf('Two', [page('both')])],
      [],
      true,
    );
    tree.setTree(
      [shelf('Mine', [page('other'), page('both')])],
      NOTHING,
      NO_HEADINGS,
      true,
    );

    tree.selectEntry('e:both');

    expect(selected()).toEqual(['both']);
    expect(tree.selectedIn('all')).toEqual(page('both'));
  });

  it('selectEntry_OnlyInAllPages_WikiKeepsItsSelection', () => {
    const { tree, selected } = wikiSetUp();
    tree.setWikiTree([shelf('One', [page('other')])], [], true);
    tree.setTree([shelf('Mine', [page('alone')])], NOTHING, NO_HEADINGS, true);

    tree.selectEntry('e:alone');

    expect(selected()).toEqual(['One']);
    expect(tree.selectedIn('all')).toEqual(page('alone'));
  });

  it('selectEntryIn_All_LeavesTheWikiSelection', () => {
    const { tree, selected } = wikiSetUp();
    tree.setWikiTree(
      [shelf('One', [page('other')]), shelf('Two', [page('both')])],
      [],
      true,
    );
    tree.setTree(
      [shelf('Mine', [page('other'), page('both')])],
      NOTHING,
      NO_HEADINGS,
      true,
    );

    tree.selectEntryIn('all', 'e:both');

    expect(selected()).toEqual(['One']);
    expect(tree.selectedIn('all')).toEqual(page('both'));
  });

  const views = [
    {
      name: 'wiki',
      hasWiki: true,
      setTree: (tree: TreeView, nodes: TreeNode[]) =>
        tree.setWikiTree(nodes, [], true),
    },
    {
      name: 'all pages',
      hasWiki: false,
      setTree: (tree: TreeView, nodes: TreeNode[]) =>
        tree.setTree(nodes, NOTHING, NO_HEADINGS, true),
    },
  ];

  // A saved selection naming no row of the first tree falls back to its first
  // row.
  it.each(
    views.flatMap((view) => [
      {
        ...view,
        selectedId: 'entry:e:b',
        selected: ['b'],
        selectedAfter: 'entry:e:b',
      },
      {
        ...view,
        selectedId: 'entry:e:gone',
        selected: ['One'],
        selectedAfter: 'shelf:One',
      },
    ]),
  )(
    'restored_place_holds_until_and_through_the_first_tree: $name $selectedId',
    ({ hasWiki, setTree, selectedId, selected: selects, selectedAfter }) => {
      const { tree, titles, selected } = wikiSetUp({ hasWiki });
      const restored = { expanded: ['shelf:Two'], selectedId, filter: '' };
      tree.restorePlace(restored);
      // A tree with no rows draws, and reports its place, before the rows come.
      setTree(tree, []);
      const placeBeforeRows = tree.place();

      setTree(tree, [shelf('One', [page('a')]), shelf('Two', [page('b')])]);

      expect(titles()).toEqual(['One', 'Two', 'b']);
      expect(selected()).toEqual(selects);
      expect({ placeBeforeRows, placeAfter: tree.place() }).toEqual({
        placeBeforeRows: restored,
        placeAfter: { ...restored, selectedId: selectedAfter },
      });
    },
  );

  it('sessionTree_NoWiki_DrawsNoSwitchAndShowsItsTree', () => {
    const { tree, root, titles } = wikiSetUp({ hasWiki: false });

    tree.setTree([shelf('Mine', [page('a')])], NOTHING, NO_HEADINGS, true);

    expect(findAll(root, 'docs-sidebar-switch')).toEqual([]);
    expect(findAll(root, 'docs-switch-slot')[0].hidden).toBe(true);
    expect(titles()).toEqual(['Mine', 'a']);
  });

  it('sidebarSwitch_DrawnForTheShownViewAndItsClickSwitches', () => {
    const { tree, root, switchView } = wikiSetUp();
    const activeOption = () =>
      findAll(root, 'is-active').map((option) => option.textContent);
    expect(activeOption()).toEqual(['Wiki']);

    tree.showView('all');

    expect(activeOption()).toEqual(['All pages']);
    const control = findAll(root, 'docs-sidebar-switch')[0] as FocusFakeElement;
    control.fire('click');
    expect(switchView).toHaveBeenCalledOnce();
  });

  it.each([
    { key: 'open', focusDoc: false },
    { key: 'toggle', focusDoc: true },
  ] as const)(
    '$key_WikiLinkRow_CallsOpenWikiLinkWithFocusDoc_$focusDoc',
    ({ key, focusDoc }) => {
      const { tree, openWikiLink } = wikiSetUp();
      const link = wikiLink({});
      tree.setWikiTree([shelf('One', [link])], [], true);
      tree.down();

      tree[key]();

      expect(openWikiLink).toHaveBeenCalledExactlyOnceWith(link, focusDoc);
    },
  );
});
