import type { Disposable } from '../../../contracts/disposable';
import type { Log } from '../../../contracts/log';
import type { PushedScope } from '../../../contracts/plugin';
import { element } from '../../../shared/page/dom';
import { inputFrame } from '../../../shared/page/ui/input-frame';
import { disposeAnchors } from '../../../shared/page/ui/key-anchors';
import { textBoxInput } from '../../../shared/page/text-box';
import type { TreeRowInput } from '../layouts/layout';
import type { TreeLeaf, TreeNode } from '../tree';
import {
  type DocsAnchor,
  defaultExpandedIds,
  edgeSelection,
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
import {
  type AppPart,
  appPart,
  type DocsParts,
  type DrawnPart,
  keepingFocusAndScroll,
} from './layout/docs-parts';

export interface TreeViewDeps {
  log: Log;
  // Draws the pane, the line and the rows through the docs layout.
  parts: DocsParts;
  // Whether the tree is Docs mode's, over the machine's index.
  isMachine: boolean;
  // What `l` or Enter does on a leaf: open its doc, and for Enter
  // (`focusDoc`) move focus to it.
  openLeaf(leaf: TreeLeaf, focusDoc: boolean): void;
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

// The tree pane, drawn by the layout's `treePane` around the app's status
// line, filter box, line slot and rows: in `default`, a header of the tree's
// keys (`/ filter`, `a new`, `A file`, `R rescan`, `c folder`) ending in the
// `⌥L doc ›` edge prompt, then those four. The line slot holds the layout's
// `treeLine` for an empty index, a filter matching nothing or a filter on;
// the rows are the layout's `treeRow` parts. `setTree` keeps the expanded ids,
// the selection and the filter; the first tree with rows expands
// `defaultExpandedIds` and selects its first row; a later tree that first
// shows the Starred group expands it. A row gets its status: a leaf's mark
// and a group's rollup as its detail, and a leaf's star and last-loaded time.
// The selected row draws as the keyboard cursor while focus is inside the
// pane, and a selected leaf ends in the `s star  r rename  d trash` cursor
// prompt.
export interface TreeView {
  element: HTMLElement;
  setStatus(text: string | null): void;
  // `hasIndex`: whether the index read last returned a document; false before
  // the first read lands and while the last read shown returned no document.
  setTree(
    tree: TreeNode[],
    pathOf: (entryId: string) => string,
    hasIndex: boolean,
  ): void;
  down(): void;
  up(): void;
  // `l`, `h` and Enter act on the selected row as `treeRowAction` says; a
  // step into a group or up to the parent logs the row it selects.
  // `l`: opens a leaf, expands a collapsed group, steps into an expanded
  // one.
  open(): void;
  // `h`: collapses an expanded group, else selects the parent.
  close(): void;
  // Enter: opens a leaf and focuses its doc, expands a collapsed group,
  // collapses an expanded one; under a filter, steps into it.
  toggle(): void;
  // Selects the first or last visible row, logging its title; nothing on an
  // empty tree.
  top(): void;
  bottom(): void;
  // The selected row's node, or null when no row is selected.
  selected(): TreeNode | null;
  // Selects the entry's leaf, expanding the groups above it; nothing when no
  // leaf holds it.
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
const ROW_ACTIONS = [
  ['toggleStar', 'star'],
  ['rename', 'rename'],
  ['trash', 'trash'],
] as const;

// The cursor prompt a selected leaf row ends in, after its end; `anchors`
// receives the anchors it names.
function rowActionsElement(
  anchors: Disposable[],
  anchor: DocsAnchor,
): HTMLElement {
  const actions = element('span', 'docs-row-actions');
  for (const [command, label] of ROW_ACTIONS) {
    const node = element('span');
    anchors.push(anchor(node, command, { scope: 'tree', label }));
    actions.append(node);
  }
  return actions;
}

export function createTreeView(deps: TreeViewDeps): TreeView {
  const { parts } = deps;
  const pane = element('div', 'docs-tree');
  pane.tabIndex = -1;
  // The anchors the cursor prompt names, for the view's life.
  const anchors: Disposable[] = [];
  const rowActions = rowActionsElement(anchors, deps.anchor);
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
  let drawnRows: DrawnPart[] = [];

  let tree: TreeNode[] = [];
  let pathOf: (entryId: string) => string = () => '';
  let state: TreeState = { expanded: new Set(), selectedId: null, filter: '' };
  let rows: TreeRow[] = [];
  let hasRows = false;
  let hasTree = false;
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
    let placing: AppPart[] = [];
    drawnPane = parts.draw(
      'treePane',
      pane,
      { isMachine: deps.isMachine },
      (kit) => {
        const statusPart = appPart(status, 'treePane', 'status');
        const filterPart = appPart(filterFrame, 'treePane', 'filterBox');
        const linePart = appPart(lineSlot, 'treePane', 'line');
        const rowsPart = appPart(list, 'treePane', 'rows');
        placing = [statusPart, filterPart, linePart, rowsPart];
        return {
          ...kit,
          status: statusPart.place,
          filterBox: filterPart.place,
          line: linePart.place,
          rows: rowsPart.place,
        };
      },
    );
    for (const part of placing) {
      part.appendIfLeftOut(drawnPane.element);
    }
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

  const draw = () => {
    pane.classList.toggle('is-pane-inactive', !hasFocus);
    rows = visibleRows(tree, state, pathOf);
    for (const drawn of drawnRows) {
      drawn.dispose();
    }
    rowActions.remove();
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
    const next = treeLine({
      hasTree,
      isIndexEmpty: tree.length === 0,
      filter: state.filter,
      rowCount: rows.length,
      isFilterOpen: filterScope !== null,
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
      type: node.type,
      title: node.title,
      depth: row.depth,
      isExpanded: row.isExpanded,
      detail,
      mark,
      time: marks?.time ?? null,
      isStarred: marks?.isStarred === true,
      isPrompted: node.id === state.selectedId && node.type === 'entry',
    };
  };

  // Draws the row part, then sets the app's cursor classes and click on its
  // root, which keeps the mouse from taking focus.
  const drawRow = (row: TreeRow): DrawnPart => {
    const input = rowInput(row);
    let placing: AppPart[] = [];
    const drawn = parts.draw('treeRow', list, input, (kit) => {
      const prompt = appPart(rowActions, 'treeRow', 'cursorPrompt');
      placing = input.isPrompted ? [prompt] : [];
      return {
        ...kit,
        cursorPrompt: (parent) =>
          input.isPrompted ? prompt.place(parent) : null,
      };
    });
    const item = drawn.element;
    for (const part of placing) {
      part.appendIfLeftOut(item);
    }
    item.classList.add('ui-row--action');
    item.addEventListener('mousedown', (event) => event.preventDefault());
    item.addEventListener('click', () => {
      state = { ...state, selectedId: row.node.id };
      pane.focus();
      view.open();
    });
    const isSelected = row.node.id === state.selectedId;
    item.classList.toggle('is-selected', isSelected);
    item.classList.toggle('is-cursor', isSelected && hasFocus);
    return drawn;
  };

  const setExpanded = (id: string, isExpanded: boolean) => {
    const expanded = new Set(state.expanded);
    if (isExpanded) {
      expanded.add(id);
    } else {
      expanded.delete(id);
    }
    state = { ...state, expanded };
  };

  const selectedRow = () =>
    rows.find((row) => row.node.id === state.selectedId);

  const actOnSelected = (key: TreeRowKey) => {
    const row = selectedRow();
    if (row === undefined) {
      return;
    }
    const { node } = row;
    const action = treeRowAction(tree, rows, row, state.filter, key);
    if (action.type === 'openLeaf' && node.type === 'entry') {
      draw();
      deps.openLeaf(node, action.focusDoc);
    } else if (action.type === 'expand' || action.type === 'collapse') {
      const isExpanding = action.type === 'expand';
      setExpanded(node.id, isExpanding);
      const verb = isExpanding ? 'expanded' : 'collapsed';
      deps.log('docs', `${verb} ${node.title}`);
      draw();
    } else if (action.type === 'select') {
      state = { ...state, selectedId: action.id };
      draw();
      deps.log('docs', `selected ${selectedRow()?.node.title}`);
    }
  };

  const step = (by: 1 | -1) => {
    state = { ...state, selectedId: stepSelection(rows, state.selectedId, by) };
    draw();
  };

  const selectEdge = (edge: 'first' | 'last') => {
    const selectedId = edgeSelection(rows, edge);
    if (selectedId === null) {
      return;
    }
    state = { ...state, selectedId };
    draw();
    deps.log('docs', `selected ${selectedRow()?.node.title}`);
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
    setTree(next, nextPathOf, hasIndex) {
      const previous = tree;
      tree = next;
      pathOf = nextPathOf;
      hasTree = hasIndex;
      const isFirstTree = !hasRows && next.length > 0;
      if (isFirstTree) {
        hasRows = true;
        state = { ...state, expanded: defaultExpandedIds(next) };
        rows = visibleRows(tree, state, pathOf);
        state = { ...state, selectedId: rows[0]?.node.id ?? null };
      } else {
        const expanded = expandNewStarred(previous, next, state.expanded);
        state = { ...state, expanded };
      }
      draw();
    },
    down: () => step(1),
    up: () => step(-1),
    top: () => selectEdge('first'),
    bottom: () => selectEdge('last'),
    open: () => actOnSelected('open'),
    close: () => actOnSelected('close'),
    toggle: () => actOnSelected('toggle'),
    selected: () => selectedRow()?.node ?? null,
    selectEntry(entryId) {
      const leafId = `entry:${entryId}`;
      const expanded = new Set(state.expanded);
      let parent = parentId(tree, leafId);
      if (parent === null && !tree.some((node) => node.id === leafId)) {
        return;
      }
      while (parent !== null) {
        expanded.add(parent);
        parent = parentId(tree, parent);
      }
      state = { ...state, expanded, selectedId: leafId };
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
      filterBox.value = state.filter;
      filterFrame.hidden = false;
      showLine();
      filterBox.focus();
    },
    acceptFilter() {
      if (filterScope === null) {
        return;
      }
      deps.log(
        'docs',
        state.filter === ''
          ? 'cleared the filter'
          : `filtered the tree: ${state.filter}`,
      );
      if (state.filter !== '' && rows.length === 0) {
        deps.log('docs', `no docs match "${state.filter}"`);
      }
      closeFilter(true);
    },
    cancelFilter() {
      if (filterScope === null) {
        return;
      }
      state = { ...state, filter: '' };
      draw();
      deps.log('docs', 'cleared the filter');
      closeFilter(true);
    },
    dismissFilter() {
      if (filterScope !== null) {
        closeFilter(false);
      }
    },
    statusesChanged: () => draw(),
    redraw() {
      if (isDisposed || !parts.picksChanged()) {
        return;
      }
      parts.markDrawn();
      isRedrawing = true;
      try {
        keepingFocusAndScroll(pane, [list], () => {
          drawPane();
          drawLine();
          draw();
        });
      } finally {
        isRedrawing = false;
      }
    },
    dispose() {
      isDisposed = true;
      disposeAnchors(anchors);
      for (const drawn of [drawnPane, drawnLine, ...drawnRows]) {
        drawn?.dispose();
      }
      drawnPane = null;
      drawnLine = null;
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
    state = { ...state, filter: filterBox.value };
    draw();
  });

  drawPane();
  return view;
}
