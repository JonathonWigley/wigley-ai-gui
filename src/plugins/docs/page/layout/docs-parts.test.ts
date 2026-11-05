import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeFuzzyMatcher } from '../../../../shared/fake-fuzzy-matcher.test-support';
import { element } from '../../../../shared/page/dom';
import {
  USER_LAYOUT,
  withUser,
} from '../../../../shared/page/layout-host/test-layouts';
import { asFake, installFocusFakeDom } from '../../../../shared/page/test-dom';
import defaultLayout from '../../layouts/default/layout.js';
import type { Layout } from '../../layouts/layout';
import { fakeDocsParts, noAnchor } from '../docs-page-fakes';
import { createTreeView } from '../tree-view';

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
    installFocusFakeDom((name, value) => vi.stubGlobal(name, value)),
  );
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    { part: 'diskBanner', layoutName: USER_LAYOUT },
    { part: 'emptyDoc', layoutName: 'default' },
  ] as const)(
    'draw_UserLayoutDefinesSomeParts_DrawsThoseFromItAndTheRestFromDefault $part',
    ({ part, layoutName }) => {
      const { parts } = fakeDocsParts(() =>
        withUser(defaultLayout, bannerLayout('slim-banner')),
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
    { next: 'same set', redraws: 1 },
    { next: 'new object for the drawn part', redraws: 2 },
    { next: 'new object for a layout no drawn part picks', redraws: 1 },
  ])(
    'redrawIfChanged_After_$next_Redraws_$redraws_Times',
    ({ next, redraws }) => {
      let shown = withUser(defaultLayout, bannerLayout('a'));
      const { parts } = fakeDocsParts(() => shown);
      let redrawn = 0;
      const drawBanner = () => {
        redrawn += 1;
        parts.draw('diskBanner', slotElement(), { text: 'x' }, (kit) => kit);
      };
      drawBanner();
      redrawn = 0;
      shown = withUser(defaultLayout, bannerLayout('b'));
      parts.redrawIfChanged(drawBanner);

      if (next === 'new object for the drawn part') {
        shown = withUser(defaultLayout, bannerLayout('c'));
      } else if (next === 'new object for a layout no drawn part picks') {
        shown = {
          layouts: new Map([
            ...shown.layouts,
            ['default', { ...defaultLayout }],
          ]),
          user: shown.user,
        };
      }
      parts.redrawIfChanged(drawBanner);

      expect(redrawn).toBe(redraws);
    },
  );

  it('treePane_PlacingNoAppPart_AppendsThemInContractOrder', () => {
    const bare: Layout = {
      treePane(parent, _input, kit) {
        return { element: kit.el(parent, 'div', 'bare-pane') };
      },
    };
    const { parts } = fakeDocsParts(() => withUser(defaultLayout, bare));

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
    const { parts, logs } = fakeDocsParts(() => withUser(defaultLayout, twice));
    const editorBox = element('div', 'docs-editor');

    const drawn = parts.draw(
      'editorFrame',
      slotElement(),
      { name: 'a.md', path: '/a.md' },
      (kit, slotFor) => ({
        ...kit,
        editor: slotFor(editorBox, 'editor').place,
      }),
    );

    expect(drawn.layoutName).toBe('default');
    expect(asFake(editorBox).parentNode).toBe(asFake(drawn.element));
    expect(logs).toEqual([
      `layout ${USER_LAYOUT} editorFrame failed: editorFrame: editor placed twice`,
    ]);
  });

  it('dispose_RemovesThePartAndItsAnchorsAndDetachesItsAppParts', () => {
    const hinted: Layout = {
      docHeader(parent, _input, kit) {
        const head = kit.el(parent, 'div', 'hinted');
        kit.keyHint(head, 'backToTree');
        kit.editHint(head);
        return { element: head };
      },
    };
    const { parts, anchors } = fakeDocsParts(() =>
      withUser(defaultLayout, hinted),
    );
    const editHint = element('span');
    const slot = slotElement();
    const drawn = parts.draw(
      'docHeader',
      slot,
      headerInput(),
      (kit, slotFor) => ({
        ...kit,
        editHint: slotFor(editHint, 'editHint').place,
      }),
    );

    drawn.dispose();

    expect(asFake(slot).children).toEqual([]);
    expect(
      anchors.map(({ command, isDisposed }) => ({ command, isDisposed })),
    ).toEqual([{ command: 'docs.backToTree', isDisposed: true }]);
    expect(asFake(slot).contains(asFake(editHint))).toBe(false);
  });
});

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
    matcher: fakeFuzzyMatcher,
    parts,
    isMachine: true,
    openLeaf: () => undefined,
    pushBoxScope: () => ({
      pop: () => undefined,
      dispose: () => undefined,
      onBaseChanged: () => ({ dispose: () => undefined }),
    }),
    filterClosed: () => undefined,
    anchor: noAnchor,
    rowStatus: () => ({ mark: null, detail: null }),
    leafMarks: () => ({ time: null, isStarred: false }),
  };
}
