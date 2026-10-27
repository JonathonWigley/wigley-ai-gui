import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asFake, findAll } from '../../../shared/page/test-dom';
import type { Layout } from '../layouts/layout';
import {
  type DocsFakeElement,
  fakeDocsParts,
  fakePushedScope,
  installDocsFakeDom,
  noAnchor,
  shownLayouts,
} from './docs-page-fakes';
import { createTreeView } from './tree-view';

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

describe('createTreeView', () => {
  beforeEach(() =>
    installDocsFakeDom((name, value) => vi.stubGlobal(name, value)),
  );
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('redraw_FilterOpenWithText_KeepsTheInputItsTextAndFocus', () => {
    let shown = shownLayouts('slim', { slim: paneLayout('pane-1') });
    const { parts } = fakeDocsParts(() => shown);
    const tree = createTreeView({
      log: () => undefined,
      parts,
      isMachine: true,
      openLeaf: () => undefined,
      pushBoxScope: fakePushedScope,
      filterClosed: () => undefined,
      anchor: noAnchor,
      rowStatus: () => ({ mark: null, detail: null }),
      leafMarks: () => ({ time: null, isStarred: false }),
    });
    const root = asFake(tree.element);
    tree.openFilter();
    const input = findAll(root, 'docs-box')[0] as DocsFakeElement;
    input.value = 'plan';
    input.dispatch('input');

    shown = shownLayouts('slim', { slim: paneLayout('pane-2') });
    tree.redraw();

    expect(findAll(root, 'pane-2')).toHaveLength(1);
    expect(findAll(root, 'pane-1')).toEqual([]);
    expect(findAll(root, 'docs-box')[0]).toBe(input);
    expect(input.value).toBe('plan');
    expect(document.activeElement).toBe(input);
  });
});
