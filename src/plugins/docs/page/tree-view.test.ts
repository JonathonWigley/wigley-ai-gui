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
import type { Layout } from '../layouts/layout';
import type { TreeLeaf } from '../tree';
import { fakeDocsParts, fakePushedScope, noAnchor } from './docs-page-fakes';
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

function treeDeps(parts: ReturnType<typeof fakeDocsParts>['parts']) {
  return {
    log: () => undefined,
    matcher: fakeFuzzyMatcher,
    parts,
    isMachine: true,
    openLeaf: () => undefined,
    openHeading: () => undefined,
    pushBoxScope: fakePushedScope,
    filterClosed: () => undefined,
    anchor: noAnchor,
    rowStatus: () => ({ mark: null, detail: null }),
    leafMarks: () => ({ time: null, isStarred: false }),
  };
}

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
});
