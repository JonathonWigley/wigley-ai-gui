import type { Log } from '../../../contracts/log';
import type { PushedScope } from '../../../contracts/plugin';
import { element } from '../../../shared/page/dom';
import type { TreeLeaf, TreeNode } from '../tree';
import {
  parentId,
  rootIds,
  stepSelection,
  type TreeRow,
  type TreeState,
  visibleRows,
} from './docs-state';

// Keys a docs text box leaves to the page's binds; every other key, Space
// included, stays in the box.
const BOX_KEYS = new Set(['Tab', 'Enter', 'Escape']);

// A one-line docs text box. Typed keys never reach the page keys; Tab, Enter,
// Escape and every chord do, so the box's binds in scope `box` run.
export function textBoxInput(className: string): HTMLInputElement {
  const input = element('input', className);
  input.type = 'text';
  input.spellcheck = false;
  input.addEventListener('keydown', (event) => {
    const isChord = event.ctrlKey || event.altKey || event.metaKey;
    if (!isChord && !BOX_KEYS.has(event.key)) {
      event.stopPropagation();
    }
  });
  return input;
}

export interface TreeViewDeps {
  log: Log;
  // What `l` does on a leaf: open its doc.
  openLeaf(leaf: TreeLeaf): void;
  // Pushes `docs.box` while the filter box is open.
  pushBoxScope(): PushedScope;
  // Runs once an accepted or cancelled filter box has closed and focus is
  // back on the tree.
  filterClosed(): void;
}

// The tree pane: a status line, the filter box and the rows. `setTree` keeps
// the expanded ids, the selection and the filter; the first tree with rows
// expands its roots and selects its first row.
export interface TreeView {
  element: HTMLElement;
  setStatus(text: string | null): void;
  setTree(tree: TreeNode[], pathOf: (entryId: string) => string): void;
  down(): void;
  up(): void;
  open(): void;
  close(): void;
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
}

export function createTreeView(deps: TreeViewDeps): TreeView {
  const pane = element('div', 'docs-tree');
  pane.tabIndex = -1;
  const status = element('div', 'docs-status');
  status.hidden = true;
  const filterBox = textBoxInput('docs-box docs-filter');
  filterBox.hidden = true;
  const list = element('ol', 'docs-rows');
  pane.append(status, filterBox, list);

  let tree: TreeNode[] = [];
  let pathOf: (entryId: string) => string = () => '';
  let state: TreeState = { expanded: new Set(), selectedId: null, filter: '' };
  let rows: TreeRow[] = [];
  let hasRows = false;
  let filterScope: PushedScope | null = null;

  const draw = () => {
    rows = visibleRows(tree, state, pathOf);
    list.replaceChildren(...rows.map(rowElement));
    list.querySelector('.is-selected')?.scrollIntoView({ block: 'nearest' });
  };

  const rowElement = (row: TreeRow) => {
    const item = element('li', 'docs-row');
    item.style.paddingLeft = `${row.depth}rem`;
    item.classList.toggle('is-selected', row.node.id === state.selectedId);
    const caret = row.node.type === 'entry' ? '' : row.isExpanded ? '▾' : '▸';
    item.append(
      element('span', 'docs-row-caret', caret),
      element('span', 'docs-row-title', row.node.title),
    );
    item.addEventListener('click', () => {
      state = { ...state, selectedId: row.node.id };
      view.open();
    });
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

  const step = (by: 1 | -1) => {
    state = { ...state, selectedId: stepSelection(rows, state.selectedId, by) };
    draw();
  };

  // Pops the box's scope; `refocus` returns focus to the tree.
  const closeFilter = (refocus: boolean) => {
    filterScope?.pop();
    filterScope = null;
    filterBox.hidden = true;
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
    setTree(next, nextPathOf) {
      tree = next;
      pathOf = nextPathOf;
      const isFirstTree = !hasRows && next.length > 0;
      if (isFirstTree) {
        hasRows = true;
        state = { ...state, expanded: rootIds(next) };
        rows = visibleRows(tree, state, pathOf);
        state = { ...state, selectedId: rows[0]?.node.id ?? null };
      }
      draw();
    },
    down: () => step(1),
    up: () => step(-1),
    open() {
      const row = selectedRow();
      if (row === undefined) {
        return;
      }
      const { node } = row;
      if (node.type === 'entry') {
        draw();
        deps.openLeaf(node);
      } else if (!row.isExpanded) {
        setExpanded(node.id, true);
        deps.log('docs', `expanded ${node.title}`);
        draw();
      } else if (node.children.length > 0) {
        state = { ...state, selectedId: node.children[0].id };
        draw();
      }
    },
    close() {
      const row = selectedRow();
      if (row === undefined) {
        return;
      }
      const isCollapsible =
        row.node.type === 'group' && row.isExpanded && state.filter === '';
      if (isCollapsible) {
        setExpanded(row.node.id, false);
        deps.log('docs', `collapsed ${row.node.title}`);
        draw();
        return;
      }
      const parent = parentId(tree, row.node.id);
      if (parent !== null) {
        state = { ...state, selectedId: parent };
        draw();
      }
    },
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
      filterBox.hidden = false;
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
  };

  filterBox.addEventListener('input', () => {
    state = { ...state, filter: filterBox.value };
    draw();
  });

  return view;
}
