import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShownLayouts } from '../../../../contracts/plugin';
import { element } from '../../../../shared/page/dom';
import { asFake } from '../../../../shared/page/test-dom';
import type { Layout } from '../../layouts/layout';
import {
  fakeDocsParts,
  installDocsFakeDom,
  noAnchor,
  shownLayouts,
} from '../docs-page-fakes';
import { createTreeView } from '../tree-view';
import { appPart } from './docs-parts';

// A layout whose `diskBanner` draws `div.<marker>`.
function bannerLayout(marker: string): Layout {
  return {
    diskBanner(parent, input, kit) {
      return { element: kit.el(parent, 'div', marker, input.text) };
    },
  };
}

function slotElement(): HTMLElement {
  return element('div');
}

describe('createDocsParts', () => {
  beforeEach(() =>
    installDocsFakeDom((name, value) => vi.stubGlobal(name, value)),
  );
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    { part: 'diskBanner', layoutName: 'slim' },
    { part: 'emptyDoc', layoutName: 'default' },
  ] as const)(
    'draw_UserLayoutDefinesSomeParts_DrawsThoseFromItAndTheRestFromDefault $part',
    ({ part, layoutName }) => {
      const { parts } = fakeDocsParts(() =>
        shownLayouts('slim', { slim: bannerLayout('slim-banner') }),
      );
      const slot = slotElement();

      const drawn = parts.draw(part, slot, { text: 'words' }, (kit) => kit);

      expect(drawn.layoutName).toBe(layoutName);
      expect(asFake(drawn.element).parentNode).toBe(asFake(slot));
      expect(drawn.element.dataset.layout).toBe(layoutName);
      expect(drawn.element.dataset.layoutOwner).toBe('docs');
    },
  );

  it.each([
    { next: 'same set', changed: false },
    { next: 'new object for the drawn part', changed: true },
    { next: 'new object for a layout no drawn part picks', changed: false },
  ])('picksChanged_After_$next_Is_$changed', ({ next, changed }) => {
    const slim = bannerLayout('slim-banner');
    let shown: ShownLayouts<Layout> = shownLayouts('slim', { slim });
    const { parts } = fakeDocsParts(() => shown);
    parts.draw('diskBanner', slotElement(), { text: 'x' }, (kit) => kit);

    if (next === 'new object for the drawn part') {
      shown = shownLayouts('slim', { slim: bannerLayout('slim-banner') });
    } else if (next === 'new object for a layout no drawn part picks') {
      shown = {
        layouts: new Map([
          ...shown.layouts,
          ['default', { ...defaultOf(shown) }],
        ]),
        user: 'slim',
      };
    }

    expect(parts.picksChanged()).toBe(changed);
  });

  it('markDrawn_ThenANewSet_ReportsNoChangeUntilAPartDraws', () => {
    let shown = shownLayouts('slim', { slim: bannerLayout('a') });
    const { parts } = fakeDocsParts(() => shown);
    parts.draw('diskBanner', slotElement(), { text: 'x' }, (kit) => kit);

    parts.markDrawn();
    shown = shownLayouts('slim', { slim: bannerLayout('b') });

    expect(parts.picksChanged()).toBe(false);
  });

  it('treePane_PlacingNoAppPart_AppendsThemInContractOrder', () => {
    const bare: Layout = {
      treePane(parent, _input, kit) {
        return { element: kit.el(parent, 'div', 'bare-pane') };
      },
    };
    const { parts } = fakeDocsParts(() => shownLayouts('bare', { bare }));

    const tree = createTreeView(treeDeps(parts));

    const pane = asFake(tree.element).children[0];
    expect(pane.classList.contains('bare-pane')).toBe(true);
    expect(pane.children.map((child) => child.className)).toEqual([
      'docs-status',
      'ui-input docs-filter',
      'docs-line-slot',
      'docs-rows',
    ]);
  });

  it('draw_AppPartPlacedTwice_DrawsDefaultAndLogsTheFailure', () => {
    const twice: Layout = {
      editorFrame(parent, _input, kit) {
        const frame = kit.el(parent, 'div', 'twice');
        kit.editor(frame);
        kit.editor(frame);
        return { element: frame };
      },
    };
    const { parts, logs } = fakeDocsParts(() =>
      shownLayouts('twice', { twice }),
    );
    const editorBox = element('div', 'docs-editor');

    const drawn = parts.draw(
      'editorFrame',
      slotElement(),
      { name: 'a.md', path: '/a.md' },
      (kit) => ({
        ...kit,
        editor: appPart(editorBox, 'editorFrame', 'editor').place,
      }),
    );

    expect(drawn.layoutName).toBe('default');
    expect(asFake(editorBox).parentNode).toBe(asFake(drawn.element));
    expect(logs).toEqual([
      'layout twice editorFrame failed: editorFrame: editor placed twice',
    ]);
  });

  it('dispose_RemovesThePartAndItsAnchorsAndDetachesItsAppParts', () => {
    const hinted: Layout = {
      docHeader(parent, _input, kit) {
        const head = kit.el(parent, 'div', 'hinted');
        kit.keyHint(head, 'focusTree');
        kit.editHint(head);
        return { element: head };
      },
    };
    const { parts, anchors } = fakeDocsParts(() =>
      shownLayouts('hinted', { hinted }),
    );
    const editHint = element('span');
    const slot = slotElement();
    const drawn = parts.draw('docHeader', slot, headerInput(), (kit) => ({
      ...kit,
      editHint: appPart(editHint, 'docHeader', 'editHint').place,
    }));

    drawn.dispose();

    expect(asFake(slot).children).toEqual([]);
    expect(anchors).toEqual([{ command: 'docs.focusTree', isDisposed: true }]);
    expect(asFake(slot).contains(asFake(editHint))).toBe(false);
  });
});

function defaultOf(shown: ShownLayouts<Layout>): Layout {
  const layout = shown.layouts.get('default');
  if (layout === undefined) {
    throw new Error('no default');
  }
  return layout;
}

function headerInput() {
  return {
    title: 'A',
    path: '~/a.md',
    fullPath: '/home/a.md',
    readOnly: null,
    chips: [],
    statuses: [],
    loaded: null,
  };
}

function treeDeps(parts: ReturnType<typeof fakeDocsParts>['parts']) {
  return {
    log: () => undefined,
    parts,
    isMachine: true,
    openLeaf: () => undefined,
    pushBoxScope: () => ({
      pop: () => undefined,
      onBaseChanged: () => undefined,
    }),
    filterClosed: () => undefined,
    anchor: noAnchor,
    rowStatus: () => ({ mark: null, detail: null }),
    leafMarks: () => ({ time: null, isStarred: false }),
  };
}
