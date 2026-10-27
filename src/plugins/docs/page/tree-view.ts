import type { Disposable } from '../../../contracts/disposable';
import type { Log } from '../../../contracts/log';
import type { PushedScope } from '../../../contracts/plugin';
import { element } from '../../../shared/page/dom';
import { emptyState } from '../../../shared/page/ui/empty-state';
import {
  disposeAnchors,
  keyChevron,
  keyEdge,
} from '../../../shared/page/ui/key-anchors';
import { icon } from '../../../shared/page/ui/icon';
import { inputFrame } from '../../../shared/page/ui/input-frame';
import { row as rowPart } from '../../../shared/page/ui/row';
import { statusDot } from '../../../shared/page/ui/status-dot';
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
import { textBoxInput } from '../../../shared/page/text-box';

export interface TreeViewDeps {
  log: Log;
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

// The tree pane: a header of the tree's keys (`/ filter`, `a new`, `A file`,
// `R rescan`, `c folder`) ending in the `⌥L doc ›` edge prompt, a status line,
// the filter box, a line for an empty index, a filter matching nothing or a
// filter on, and the rows. `setTree` keeps the
// expanded ids, the selection and the filter; the first tree with rows expands
// `defaultExpandedIds` and selects its first row; a later tree that first
// shows the Starred group expands it. A row draws its status: a leaf's mark as
// a warning StatusDot, a group's rollup as its detail. A leaf's star shows in
// its caret slot, and its last-loaded time and status mark at its end. The
// selected row draws as the keyboard cursor while focus is inside the pane, and
// a selected leaf ends in the `s star  r rename  d trash` cursor prompt.
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
  // Disposes the tree's anchors.
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

// The line's hint, its command's keys anchored with its words as their
// label; null for no hint.
function hintElement(
  hint: TreeLine['hint'],
  anchors: Disposable[],
  anchor: DocsAnchor,
): HTMLElement | null {
  if (hint === null) {
    return null;
  }
  const node = element('span', 'docs-hint');
  anchors.push(
    anchor(node, hint.command, { scope: 'tree', label: hint.words }),
  );
  return node;
}

// The line's element; `anchors` receives the anchor its hint names.
function lineElement(
  line: TreeLine | null,
  anchors: Disposable[],
  anchor: DocsAnchor,
): HTMLElement {
  if (line === null) {
    const slot = element('div');
    slot.hidden = true;
    return slot;
  }
  const hint = hintElement(line.hint, anchors, anchor);
  if (line.placement === 'empty') {
    return emptyState(line.text, hint);
  }
  const above = element('div', 'docs-filtered');
  above.append(element('span', 'docs-filtered-text', line.text));
  if (hint !== null) {
    above.append(hint);
  }
  return above;
}

// A leaf's row end: its time, its status dot, then `actions`, the cursor
// prompt; the dot alone with neither of the others.
function rowEnd(
  time: LeafMarks['time'],
  markDot: HTMLElement | null,
  actions: HTMLElement | null,
): HTMLElement | null {
  if (time === null && actions === null) {
    return markDot;
  }
  const end = element('span', 'docs-row-end');
  if (time !== null) {
    const shown = element('span', 'docs-row-time', time.text);
    shown.title = time.title;
    end.append(shown);
  }
  if (markDot !== null) {
    end.append(markDot);
  }
  if (actions !== null) {
    end.append(actions);
  }
  return end;
}

// The header's box hints, in the order they show.
const HEADER_HINTS = [
  ['filter', 'filter'],
  ['createByKind', 'new'],
  ['createByPath', 'file'],
  ['rescan', 'rescan'],
  ['pickContext', 'folder'],
] as const;

// The cursor prompt's actions, in the order they show.
const ROW_ACTIONS = [
  ['toggleStar', 'star'],
  ['rename', 'rename'],
  ['trash', 'trash'],
] as const;

// A span anchoring the command's keys and label in the tree scope.
function anchoredSpan(
  command: Parameters<DocsAnchor>[1],
  label: string,
  anchors: Disposable[],
  anchor: DocsAnchor,
): HTMLElement {
  const node = element('span');
  anchors.push(anchor(node, command, { scope: 'tree', label }));
  return node;
}

// The pane's header: the box hints, then the `⌥L doc ›` edge prompt at its
// end.
function headerElement(anchors: Disposable[], anchor: DocsAnchor): HTMLElement {
  const header = element('div', 'docs-tree-header');
  for (const [command, label] of HEADER_HINTS) {
    header.append(anchoredSpan(command, label, anchors, anchor));
  }
  const edge = keyEdge('docs-edge docs-edge--end', [
    anchoredSpan('focusDoc', 'doc', anchors, anchor),
    keyChevron('›'),
  ]);
  header.append(edge);
  return header;
}

// The cursor prompt a selected leaf row ends in.
function rowActionsElement(
  anchors: Disposable[],
  anchor: DocsAnchor,
): HTMLElement {
  const actions = element('span', 'docs-row-actions');
  for (const [command, label] of ROW_ACTIONS) {
    actions.append(anchoredSpan(command, label, anchors, anchor));
  }
  return actions;
}

export function createTreeView(deps: TreeViewDeps): TreeView {
  const pane = element('div', 'docs-tree');
  pane.tabIndex = -1;
  // The anchors the header and cursor prompt name, for the view's life.
  const anchors: Disposable[] = [];
  const header = headerElement(anchors, deps.anchor);
  const rowActions = rowActionsElement(anchors, deps.anchor);
  const status = element('div', 'docs-status');
  status.hidden = true;
  const filterFrame = inputFrame();
  filterFrame.classList.add('docs-filter');
  filterFrame.hidden = true;
  const filterBox = textBoxInput('docs-box');
  filterFrame.append(filterBox);
  const list = element('ol', 'docs-rows');
  let shownLine: TreeLine | null = null;
  // The anchor the shown line's hint names, disposed as the line is replaced.
  const lineAnchors: Disposable[] = [];
  let line = lineElement(shownLine, lineAnchors, deps.anchor);
  pane.append(header, status, filterFrame, line, list);

  let tree: TreeNode[] = [];
  let pathOf: (entryId: string) => string = () => '';
  let state: TreeState = { expanded: new Set(), selectedId: null, filter: '' };
  let rows: TreeRow[] = [];
  let hasRows = false;
  let hasTree = false;
  let filterScope: PushedScope | null = null;
  let hasFocus = false;
  let isDisposed = false;

  const draw = () => {
    pane.classList.toggle('is-pane-inactive', !hasFocus);
    rows = visibleRows(tree, state, pathOf);
    rowActions.remove();
    list.replaceChildren(...rows.map(rowElement));
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
    disposeAnchors(lineAnchors);
    const nextLine = lineElement(next, lineAnchors, deps.anchor);
    line.replaceWith(nextLine);
    line = nextLine;
  };

  const rowElement = (row: TreeRow) => {
    const caret = element('span', 'docs-row-caret');
    const marks = row.node.type === 'entry' ? deps.leafMarks(row.node) : null;
    if (row.node.type === 'group') {
      caret.append(icon(row.isExpanded ? 'chevron-down' : 'chevron-right'));
    } else if (marks?.isStarred === true) {
      const star = icon('star-full');
      star.classList.add('docs-row-star');
      caret.append(star);
    }
    const { mark, detail } = deps.rowStatus(row.node);
    let markDot: HTMLElement | null = null;
    if (mark !== null) {
      markDot = statusDot('warning');
      markDot.title = mark;
    }
    const isSelected = row.node.id === state.selectedId;
    const isSelectedLeaf = isSelected && row.node.type === 'entry';
    const item = rowPart({
      density: 'tree',
      tag: 'li',
      label: row.node.title,
      detail,
      depth: row.depth,
      leading: caret,
      trailing: rowEnd(
        marks?.time ?? null,
        markDot,
        isSelectedLeaf ? rowActions : null,
      ),
      onClick: () => {
        state = { ...state, selectedId: row.node.id };
        pane.focus();
        view.open();
      },
    });
    item.classList.toggle('is-selected', isSelected);
    item.classList.toggle('is-cursor', isSelected && hasFocus);
    return item;
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
    dispose() {
      isDisposed = true;
      disposeAnchors(anchors);
      disposeAnchors(lineAnchors);
    },
  };

  pane.addEventListener('focusin', () => {
    if (!hasFocus) {
      hasFocus = true;
      draw();
    }
  });
  pane.addEventListener('focusout', (event) => {
    const next = event.relatedTarget;
    const isLeavingPane = !(next instanceof Node && pane.contains(next));
    if (hasFocus && isLeavingPane) {
      hasFocus = false;
      draw();
    }
  });

  filterBox.addEventListener('input', () => {
    state = { ...state, filter: filterBox.value };
    draw();
  });

  return view;
}
