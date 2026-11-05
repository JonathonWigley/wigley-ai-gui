import type { Disposable } from '../../../contracts/disposable';
import type { FuzzyMatcher } from '../../../contracts/fuzzy';
import type { PluginLog } from '../../../contracts/log';
import type { PushedScope } from '../../../contracts/plugin';
import { element } from '../../../shared/page/dom';
import type { AppSlot } from '../../../shared/page/layout-host/app-slot';
import { inputFrame } from '../../../shared/page/ui/input-frame';
import { disposeAnchors } from '../../../shared/page/ui/key-anchors';
import { rowAction } from '../../../shared/page/ui/row';
import { textBoxInput } from '../../../shared/page/text-box';
import type { IndexHeading } from '../contract';
import type { TreeRowInput } from '../layouts/layout';
import type {
  TreeHeadingMatch,
  TreeLeaf,
  TreeNode,
  TreeWikiLink,
} from '../tree';
import {
  type DocsAnchor,
  defaultExpandedIds,
  edgeSelection,
  expandNewGroups,
  expandNewStarred,
  parentId,
  stepSelection,
  type TreeLine,
  treeLine,
  type TreeRow,
  type TreeRowKey,
  type TreeRowStatus,
  treeRowAction,
  type TreeState,
  visibleRows,
} from './docs-state';
import { type DocsParts, type DrawnPart } from './layout/docs-parts';
import { keepingFocusAndScroll } from '../../../shared/page/layout-host/keeping-focus';

// The two trees a sidebar shows: the wiki's shelves, or All pages.
export type SidebarView = 'wiki' | 'all';

export interface TreeViewDeps {
  log: PluginLog;
  matcher: FuzzyMatcher;
  // Draws the pane, the line and the rows through the docs layout.
  parts: DocsParts;
  // Whether the tree is Docs mode's, over the machine's index.
  isMachine: boolean;
  // Whether the tree has the wiki view and draws the `sidebarSwitch`; without
  // it the tree stays on All pages.
  hasWiki: boolean;
  // What `l` or Enter does on a leaf: open its doc, and for Enter
  // (`focusDoc`) move focus to it.
  openLeaf(leaf: TreeLeaf, focusDoc: boolean): void;
  // What `l` or Enter does on a heading row: open its doc at the heading's
  // line, and for Enter (`focusDoc`) move focus to it.
  openHeading(match: TreeHeadingMatch, focusDoc: boolean): void;
  // What `l` or Enter does on a wiki link row: `focusDoc` for Enter.
  openWikiLink(link: TreeWikiLink, focusDoc: boolean): void;
  // A click on the `sidebarSwitch`.
  switchView(): void;
  // Pushes `docs.box` while the filter box is open.
  pushBoxScope(): PushedScope;
  // Runs once an accepted or cancelled filter box has closed and focus is
  // back on the tree.
  filterClosed(): void;
  anchor: DocsAnchor;
  // The node's status mark and detail, as the plugin-source statuses read now.
  rowStatus(node: TreeNode): TreeRowStatus;
  // The leaf's last-loaded time and star, read at each draw.
  leafMarks(leaf: TreeLeaf): LeafMarks;
}

// A leaf's last-loaded time, short with the full date and time as its
// `title`, or null when its doc was never loaded; and whether it is starred.
export interface LeafMarks {
  time: { text: string; title: string } | null;
  isStarred: boolean;
}

// The tree pane, drawn by the layout's `treePane` around the app's switch slot,
// status line, filter box, line slot and rows: in `default`, a header of the
// tree's keys (`/ filter`, `a new`, `A file`, `R rescan`, `c folder`) ending in
// the `⌥L doc ›` edge prompt, then those five. The line slot holds the layout's
// `treeLine` for an empty index, a filter matching nothing or a filter on;
// the rows are the layout's `treeRow` parts.
//
// It holds two views, the wiki and All pages, with `hasWiki`, and shows one;
// the switch slot draws `sidebarSwitch` over them, and without `hasWiki` it is
// hidden and All pages is the only view. Each view keeps its own trees,
// expanded ids, selection and filter text, and one not shown draws nothing. The
// wiki view holds a second tree, the user's whole own list, which its rows read
// while a filter is on. A new tree keeps the expanded ids, the selection and the
// filter; the first tree with rows expands `defaultExpandedIds` and selects its
// first row. A later All pages tree that first shows the Starred group expands
// it, and a later wiki tree expands each new group. In the wiki view with no
// filter, a selection that names no row moves to the first row.
//
// A row gets its status: a leaf's mark and a group's rollup as its detail, and a
// leaf's star and last-loaded time. A wiki link gets its count, and its dangling
// state. A filter also shows the section headings it matches, each a row under
// its doc's leaf with the doc's title as its detail.
// The selected row draws as the keyboard cursor while focus is inside the
// pane, and a selected leaf ends in the `s star  r rename  d trash` cursor
// prompt, with no `s star` in the wiki view.
export interface TreeView {
  element: HTMLElement;
  setStatus(text: string | null): void;
  // `hasIndex`: whether the index read last returned a document; false before
  // the first read lands and while the last read shown returned no document.
  setTree(
    tree: TreeNode[],
    pathOf: (entryId: string) => string,
    headingsOf: (entryId: string) => readonly IndexHeading[],
    hasIndex: boolean,
  ): void;
  // `filterTree`: what the wiki view's rows read while a filter is on. Keeps
  // the `pathOf` and `headingsOf` that `setTree` set.
  setWikiTree(
    tree: TreeNode[],
    filterTree: TreeNode[],
    hasIndex: boolean,
  ): void;
  // Closes the filter box, keeping its filter, as `dismissFilter` does, then
  // draws `view`.
  showView(view: SidebarView): void;
  shownView(): SidebarView;
  down(): void;
  up(): void;
  // `l`, `h` and Enter act on the selected row as `treeRowAction` says; a
  // step into a group or up to the parent logs the row it selects.
  // `l`: opens a leaf, a wiki link or a heading row's doc, expands a collapsed group, steps
  // into an expanded one.
  open(): void;
  // `h`: collapses an expanded group, else selects the parent; a heading row's
  // parent is its leaf.
  close(): void;
  // Enter: opens a leaf, a wiki link or a heading row's doc and focuses it,
  // expands a collapsed group, collapses an expanded one; under a filter, steps
  // into it.
  toggle(): void;
  // Selects the first or last visible row, logging its title; nothing on an
  // empty tree.
  top(): void;
  bottom(): void;
  // The shown view's selected row's node, or null when no row is selected.
  selected(): TreeNode | null;
  // The selected row's node in `view`, shown or not, or null when no row is
  // selected.
  selectedIn(view: SidebarView): TreeNode | null;
  // In each view on its own, selects the entry's leaf, expanding the groups
  // above it; nothing in a view whose rows hold no such leaf.
  selectEntry(entryId: string): void;
  focus(): void;
  isFilterOpen(): boolean;
  openFilter(): void;
  acceptFilter(): void;
  cancelFilter(): void;
  // Closes the filter box, keeping its filter, without moving focus or
  // hearing `filterClosed`.
  dismissFilter(): void;
  // Redraws the rows with the statuses `rowStatus` reads now.
  statusesChanged(): void;
  // Draws the pane, the line and the rows again when a layout pick changed
  // for one of them, keeping the rows' scroll, the filter's text and focus.
  redraw(): void;
  // Disposes the tree's anchors and drawn parts.
  dispose(): void;
}

function isSameLine(a: TreeLine | null, b: TreeLine | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  const isSameHint =
    a.hint === null || b.hint === null
      ? a.hint === b.hint
      : a.hint.command === b.hint.command && a.hint.words === b.hint.words;
  return a.placement === b.placement && a.text === b.text && isSameHint;
}

// The cursor prompt's actions, in the order they show.
const ALL_PAGES_ROW_ACTIONS = [
  ['toggleStar', 'star'],
  ['rename', 'rename'],
  ['trash', 'trash'],
] as const;

// A wiki row takes no star: stars stay in All pages.
const WIKI_ROW_ACTIONS = [
  ['rename', 'rename'],
  ['trash', 'trash'],
] as const;

// The cursor prompt a selected leaf row ends in, after its end; `anchors`
// receives the anchors it names.
function rowActionsElement(
  rowActions: typeof ALL_PAGES_ROW_ACTIONS | typeof WIKI_ROW_ACTIONS,
  anchors: Disposable[],
  anchor: DocsAnchor,
): HTMLElement {
  const actions = element('span', 'docs-row-actions');
  for (const [command, label] of rowActions) {
    const node = element('span');
    anchors.push(anchor(node, command, { scope: 'tree', label }));
    actions.append(node);
  }
  return actions;
}

// One view's trees and its place in them.
interface ViewSlot {
  tree: TreeNode[];
  // What the rows read while a filter is on; null reads `tree`.
  filterTree: TreeNode[] | null;
  state: TreeState;
  hasRows: boolean;
  hasTree: boolean;
}

function emptySlot(): ViewSlot {
  return {
    tree: [],
    filterTree: null,
    state: { expanded: new Set(), selectedId: null, filter: '' },
    hasRows: false,
    hasTree: false,
  };
}

// The tree holding the rows `slot` shows now.
function rowTree(slot: ViewSlot): TreeNode[] {
  const isFiltered = slot.state.filter.trim() !== '';
  return slot.filterTree !== null && isFiltered ? slot.filterTree : slot.tree;
}

// Selects the leaf `leafId` in `slot`, expanding the groups above it; nothing
// when its rows hold no such leaf.
function selectLeafIn(slot: ViewSlot, leafId: string): void {
  const tree = rowTree(slot);
  const expanded = new Set(slot.state.expanded);
  let parent = parentId(tree, leafId);
  if (parent === null && !tree.some((node) => node.id === leafId)) {
    return;
  }
  while (parent !== null) {
    expanded.add(parent);
    parent = parentId(tree, parent);
  }
  slot.state = { ...slot.state, expanded, selectedId: leafId };
}

export function createTreeView(deps: TreeViewDeps): TreeView {
  const { parts } = deps;
  const pane = element('div', 'docs-tree');
  pane.tabIndex = -1;
  // The anchors the cursor prompt names, for the view's life.
  const anchors: Disposable[] = [];
  const allPagesRowActions = rowActionsElement(
    ALL_PAGES_ROW_ACTIONS,
    anchors,
    deps.anchor,
  );
  const wikiRowActions = rowActionsElement(
    WIKI_ROW_ACTIONS,
    anchors,
    deps.anchor,
  );
  const switchSlot = element('div', 'docs-switch-slot');
  switchSlot.hidden = !deps.hasWiki;
  const status = element('div', 'docs-status');
  status.hidden = true;
  const filterFrame = inputFrame();
  filterFrame.classList.add('docs-filter');
  filterFrame.hidden = true;
  const filterBox = textBoxInput('docs-box');
  filterFrame.append(filterBox);
  // The slot `treeLine` draws into; it takes no space while empty.
  const lineSlot = element('div', 'docs-line-slot');
  lineSlot.hidden = true;
  const list = element('ol', 'docs-rows');
  let shownLine: TreeLine | null = null;
  let drawnPane: DrawnPart | null = null;
  let drawnLine: DrawnPart | null = null;
  let drawnSwitch: DrawnPart | null = null;
  let drawnRows: DrawnPart[] = [];

  const slots: Record<SidebarView, ViewSlot> = {
    wiki: emptySlot(),
    all: emptySlot(),
  };
  let shownView: SidebarView = deps.hasWiki ? 'wiki' : 'all';
  const shownSlot = () => slots[shownView];
  let pathOf: (entryId: string) => string = () => '';
  let headingsOf: (entryId: string) => readonly IndexHeading[] = () => [];
  let rows: TreeRow[] = [];
  let filterScope: PushedScope | null = null;
  let hasFocus = false;
  let isDisposed = false;
  // True while a layout reload redraws the pane: focus moves it makes change
  // nothing and draw nothing.
  let isRedrawing = false;

  // Draws the pane part around the app's elements, those it leaves out
  // appended in contract order.
  const drawPane = () => {
    drawnPane?.dispose();
    let placing: AppSlot[] = [];
    drawnPane = parts.draw(
      'treePane',
      pane,
      { isMachine: deps.isMachine },
      (kit, slotFor) => {
        const switchPart = slotFor(switchSlot, 'sidebarSwitch');
        const statusPart = slotFor(status, 'status');
        const filterPart = slotFor(filterFrame, 'filterBox');
        const linePart = slotFor(lineSlot, 'line');
        const rowsPart = slotFor(list, 'rows');
        placing = [switchPart, statusPart, filterPart, linePart, rowsPart];
        return {
          ...kit,
          sidebarSwitch: switchPart.place,
          status: statusPart.place,
          filterBox: filterPart.place,
          line: linePart.place,
          rows: rowsPart.place,
        };
      },
    );
    for (const part of placing) {
      part.placeIfLeftOut(drawnPane.element);
    }
  };

  // Draws the shown view's switch into its slot, with `hasWiki`.
  const drawSwitch = () => {
    if (!deps.hasWiki) {
      return;
    }
    drawnSwitch?.dispose();
    drawnSwitch = parts.draw(
      'sidebarSwitch',
      switchSlot,
      { view: shownView },
      (kit) => kit,
    );
    rowAction(drawnSwitch.element, () => deps.switchView());
  };

  // Draws `shownLine` into the line slot, emptying it for no line.
  const drawLine = () => {
    drawnLine?.dispose();
    drawnLine = null;
    lineSlot.hidden = shownLine === null;
    if (shownLine !== null) {
      drawnLine = parts.draw('treeLine', lineSlot, shownLine, (kit) => kit);
    }
  };

  const rowsOf = (slot: ViewSlot) =>
    visibleRows(rowTree(slot), slot.state, pathOf, headingsOf, deps.matcher);

  const draw = () => {
    pane.classList.toggle('is-pane-inactive', !hasFocus);
    const slot = shownSlot();
    rows = rowsOf(slot);
    const isUnfilteredWiki =
      shownView === 'wiki' && slot.state.filter.trim() === '';
    const selectsARow = rows.some(
      (row) => row.node.id === slot.state.selectedId,
    );
    if (isUnfilteredWiki && !selectsARow) {
      slot.state = { ...slot.state, selectedId: rows[0]?.node.id ?? null };
    }
    for (const drawn of drawnRows) {
      drawn.dispose();
    }
    drawnRows = rows.map(drawRow);
    list.querySelector('.is-selected')?.scrollIntoView({ block: 'nearest' });
    showLine();
  };

  // Replaces the line only when it changed, so a selection move leaves it; a
  // disposed view names no new anchor.
  const showLine = () => {
    if (isDisposed) {
      return;
    }
    const slot = shownSlot();
    const next = treeLine({
      hasTree: slot.hasTree,
      isIndexEmpty: rowTree(slot).length === 0,
      filter: slot.state.filter,
      rowCount: rows.length,
      isFilterOpen: filterScope !== null,
      isWikiView: shownView === 'wiki',
    });
    if (isSameLine(next, shownLine)) {
      return;
    }
    shownLine = next;
    drawLine();
  };

  const rowInput = (row: TreeRow): TreeRowInput => {
    const { node } = row;
    const marks = node.type === 'entry' ? deps.leafMarks(node) : null;
    const { mark, detail } = deps.rowStatus(node);
    return {
      id: node.id,
      type: node.type === 'headingMatch' ? 'entry' : node.type,
      title: node.title,
      depth: row.depth,
      isExpanded: row.isExpanded,
      detail,
      mark,
      time: marks?.time ?? null,
      isStarred: marks?.isStarred === true,
      isPrompted:
        node.id === shownSlot().state.selectedId && node.type === 'entry',
      isDangling: node.type === 'wikiLink' && node.isDangling,
      count: node.type === 'wikiLink' ? node.count : null,
    };
  };

  // Draws the row part, then sets the app's cursor classes and click on its
  // root, which keeps the mouse from taking focus.
  const drawRow = (row: TreeRow): DrawnPart => {
    const input = rowInput(row);
    let placing: AppSlot[] = [];
    const drawn = parts.draw('treeRow', list, input, (kit, slotFor) => {
      const rowActions =
        shownView === 'wiki' ? wikiRowActions : allPagesRowActions;
      const prompt = slotFor(rowActions, 'cursorPrompt');
      placing = input.isPrompted ? [prompt] : [];
      return {
        ...kit,
        cursorPrompt: (parent) =>
          input.isPrompted ? prompt.place(parent) : null,
      };
    });
    const item = drawn.element;
    for (const part of placing) {
      part.placeIfLeftOut(item);
    }
    rowAction(item, () => {
      const slot = shownSlot();
      slot.state = { ...slot.state, selectedId: row.node.id };
      pane.focus();
      view.open();
    });
    const isSelected = row.node.id === shownSlot().state.selectedId;
    item.classList.toggle('is-selected', isSelected);
    item.classList.toggle('is-cursor', isSelected && hasFocus);
    return drawn;
  };

  const setExpanded = (id: string, isExpanded: boolean) => {
    const slot = shownSlot();
    const expanded = new Set(slot.state.expanded);
    if (isExpanded) {
      expanded.add(id);
    } else {
      expanded.delete(id);
    }
    slot.state = { ...slot.state, expanded };
  };

  const selectedRow = () =>
    rows.find((row) => row.node.id === shownSlot().state.selectedId);

  const actOnSelected = (key: TreeRowKey) => {
    const row = selectedRow();
    if (row === undefined) {
      return;
    }
    const { node } = row;
    const slot = shownSlot();
    const action = treeRowAction(
      rowTree(slot),
      rows,
      row,
      slot.state.filter,
      key,
    );
    if (action.type === 'openLeaf' && node.type === 'entry') {
      draw();
      deps.openLeaf(node, action.focusDoc);
    } else if (action.type === 'openHeading' && node.type === 'headingMatch') {
      draw();
      deps.openHeading(node, action.focusDoc);
    } else if (action.type === 'openWikiLink' && node.type === 'wikiLink') {
      draw();
      deps.openWikiLink(node, action.focusDoc);
    } else if (action.type === 'expand' || action.type === 'collapse') {
      const isExpanding = action.type === 'expand';
      setExpanded(node.id, isExpanding);
      const verb = isExpanding ? 'expanded' : 'collapsed';
      deps.log(`${verb} ${node.title}`);
      draw();
    } else if (action.type === 'select') {
      slot.state = { ...slot.state, selectedId: action.id };
      draw();
      deps.log(`selected ${selectedRow()?.node.title}`);
    }
  };

  const step = (by: 1 | -1) => {
    const slot = shownSlot();
    slot.state = {
      ...slot.state,
      selectedId: stepSelection(rows, slot.state.selectedId, by),
    };
    draw();
  };

  const selectEdge = (edge: 'first' | 'last') => {
    const selectedId = edgeSelection(rows, edge);
    if (selectedId === null) {
      return;
    }
    const slot = shownSlot();
    slot.state = { ...slot.state, selectedId };
    draw();
    deps.log(`selected ${selectedRow()?.node.title}`);
  };

  // The first tree with rows in `slot`: expands its default groups and selects
  // its first row.
  const openFirstTree = (slot: ViewSlot) => {
    slot.hasRows = true;
    slot.state = { ...slot.state, expanded: defaultExpandedIds(slot.tree) };
    slot.state = {
      ...slot.state,
      selectedId: rowsOf(slot)[0]?.node.id ?? null,
    };
  };

  // Pops the box's scope; `refocus` returns focus to the tree.
  const closeFilter = (refocus: boolean) => {
    filterScope?.pop();
    filterScope = null;
    filterFrame.hidden = true;
    showLine();
    if (refocus) {
      pane.focus();
      deps.filterClosed();
    }
  };

  const view: TreeView = {
    element: pane,
    setStatus(text) {
      status.hidden = text === null;
      status.textContent = text ?? '';
      status.title = text ?? '';
    },
    setTree(next, nextPathOf, nextHeadingsOf, hasIndex) {
      const slot = slots.all;
      const previous = slot.tree;
      slot.tree = next;
      pathOf = nextPathOf;
      headingsOf = nextHeadingsOf;
      slot.hasTree = hasIndex;
      const isFirstTree = !slot.hasRows && next.length > 0;
      if (isFirstTree) {
        openFirstTree(slot);
      } else {
        const expanded = expandNewStarred(previous, next, slot.state.expanded);
        slot.state = { ...slot.state, expanded };
      }
      if (shownView === 'all') {
        draw();
      }
    },
    setWikiTree(next, filterTree, hasIndex) {
      const slot = slots.wiki;
      const previous = slot.tree;
      slot.tree = next;
      slot.filterTree = filterTree;
      slot.hasTree = hasIndex;
      const isFirstTree = !slot.hasRows && next.length > 0;
      if (isFirstTree) {
        openFirstTree(slot);
      } else {
        const expanded = expandNewGroups(previous, next, slot.state.expanded);
        slot.state = { ...slot.state, expanded };
      }
      if (shownView === 'wiki') {
        draw();
      }
    },
    showView(next) {
      view.dismissFilter();
      shownView = next;
      drawSwitch();
      draw();
    },
    shownView: () => shownView,
    down: () => step(1),
    up: () => step(-1),
    top: () => selectEdge('first'),
    bottom: () => selectEdge('last'),
    open: () => actOnSelected('open'),
    close: () => actOnSelected('close'),
    toggle: () => actOnSelected('toggle'),
    selected: () => selectedRow()?.node ?? null,
    selectedIn(shown) {
      const slot = slots[shown];
      const row = rowsOf(slot).find(
        (each) => each.node.id === slot.state.selectedId,
      );
      return row?.node ?? null;
    },
    selectEntry(entryId) {
      const leafId = `entry:${entryId}`;
      selectLeafIn(slots.all, leafId);
      selectLeafIn(slots.wiki, leafId);
      draw();
    },
    focus() {
      pane.focus();
    },
    isFilterOpen: () => filterScope !== null,
    openFilter() {
      if (filterScope !== null) {
        return;
      }
      const scope = deps.pushBoxScope();
      scope.onBaseChanged(() => {
        if (filterScope === scope) {
          closeFilter(false);
        }
      });
      filterScope = scope;
      filterBox.value = shownSlot().state.filter;
      filterFrame.hidden = false;
      showLine();
      filterBox.focus();
    },
    acceptFilter() {
      if (filterScope === null) {
        return;
      }
      const { filter } = shownSlot().state;
      const isFiltered = filter.trim() !== '';
      deps.log(
        !isFiltered ? 'cleared the filter' : `filtered the tree: ${filter}`,
      );
      if (isFiltered && rows.length === 0) {
        deps.log(`no docs match "${filter}"`);
      }
      closeFilter(true);
    },
    cancelFilter() {
      if (filterScope === null) {
        return;
      }
      const slot = shownSlot();
      slot.state = { ...slot.state, filter: '' };
      draw();
      deps.log('cleared the filter');
      closeFilter(true);
    },
    dismissFilter() {
      if (filterScope !== null) {
        closeFilter(false);
      }
    },
    statusesChanged: () => draw(),
    redraw() {
      if (isDisposed) {
        return;
      }
      parts.redrawIfChanged(() => {
        isRedrawing = true;
        try {
          keepingFocusAndScroll(pane, [list], () => {
            drawPane();
            drawSwitch();
            drawLine();
            draw();
          });
        } finally {
          isRedrawing = false;
        }
      });
    },
    dispose() {
      isDisposed = true;
      disposeAnchors(anchors);
      for (const drawn of [drawnPane, drawnLine, drawnSwitch, ...drawnRows]) {
        drawn?.dispose();
      }
      drawnPane = null;
      drawnLine = null;
      drawnSwitch = null;
      drawnRows = [];
    },
  };

  pane.addEventListener('focusin', () => {
    if (!hasFocus && !isRedrawing) {
      hasFocus = true;
      draw();
    }
  });
  pane.addEventListener('focusout', (event) => {
    const next = event.relatedTarget;
    const isLeavingPane = !(next instanceof Node && pane.contains(next));
    if (hasFocus && isLeavingPane && !isRedrawing) {
      hasFocus = false;
      draw();
    }
  });

  filterBox.addEventListener('input', () => {
    const slot = shownSlot();
    slot.state = { ...slot.state, filter: filterBox.value };
    draw();
  });

  drawPane();
  drawSwitch();
  return view;
}
