import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeFuzzyMatcher } from '../../../../shared/fake-fuzzy-matcher.test-support';
import { element } from '../../../../shared/page/dom';
import type { BaseKit } from '../../../../shared/page/layout-host/kit';
import {
  USER_LAYOUT,
  withUser,
} from '../../../../shared/page/layout-host/test-layouts';
import {
  asFake,
  findAll,
  installFocusFakeDom,
} from '../../../../shared/page/test-dom';
import defaultLayout from '../../layouts/default/layout.js';
import type { Layout } from '../../layouts/layout';
import { fakeDocsParts, noAnchor } from '../docs-page-fakes';
import { createTreeView } from '../tree-view';
import { createDocsParts, type DocsScope } from './docs-parts';

// A user layout that defines no part.
const NO_PARTS: Layout = {};

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
      'docs-switch-slot',
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
    const sectionHint = element('span');
    const slot = slotElement();
    const drawn = parts.draw(
      'docHeader',
      slot,
      headerInput(),
      (kit, slotFor) => ({
        ...kit,
        sectionHint: slotFor(sectionHint, 'sectionHint').place,
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

  it.each([
    { part: 'pageFrame', scope: 'doc' },
    { part: 'pageAside', scope: 'doc' },
    { part: 'asideHeading', scope: 'doc' },
    { part: 'asideLink', scope: 'doc' },
    { part: 'sectionEditControl', scope: 'doc' },
    { part: 'recentChanges', scope: 'doc' },
    { part: 'listPage', scope: 'doc' },
    { part: 'listRow', scope: 'doc' },
    { part: 'sidebarSwitch', scope: 'tree' },
    { part: 'mainEmpty', scope: 'doc' },
  ] as const)('draw_NewPart_FiresInItsScope $part', ({ part, scope }) => {
    const scopes: DocsScope[] = [];
    const kitFree = {
      [part](parent: HTMLElement) {
        const root = element('div');
        parent.append(root);
        return { element: root };
      },
    } as Layout;
    const parts = createDocsParts({
      layouts: () => withUser(defaultLayout, kitFree),
      defaultLayout,
      baseKit(drawScope) {
        scopes.push(drawScope);
        return {} as BaseKit;
      },
      log: () => undefined,
    });

    parts.draw(part, slotElement(), {}, (kit) => kit);

    expect(scopes).toEqual([scope]);
  });

  it('listPage_DefaultDraw_PlacesEachGroupsRowsInOrder', () => {
    const { parts } = fakeDocsParts(() => withUser(defaultLayout, NO_PARTS));
    const placed: number[] = [];

    const drawn = parts.draw(
      'listPage',
      slotElement(),
      {
        title: 'Skills',
        count: 3,
        groups: [
          { title: 'Mine', rows: [] },
          { title: 'Third-party', rows: [] },
        ],
      },
      (kit) => ({
        ...kit,
        rows(parent, groupIndex) {
          placed.push(groupIndex);
          return kit.el(parent, 'ol', 'docs-list-rows');
        },
      }),
    );

    expect(placed).toEqual([0, 1]);
    expect(drawn.layoutName).toBe('default');
  });

  it.each([
    { view: 'wiki', shown: 'Wiki' },
    { view: 'all', shown: 'All pages' },
  ] as const)(
    'sidebarSwitch_DefaultDraw_MarksTheShownView $view',
    ({ view, shown }) => {
      const { parts } = fakeDocsParts(() => withUser(defaultLayout, NO_PARTS));

      const drawn = parts.draw(
        'sidebarSwitch',
        slotElement(),
        { view },
        (kit) => kit,
      );

      expect(
        findAll(asFake(drawn.element), 'is-active').map(
          (option) => option.textContent,
        ),
      ).toEqual([shown]);
    },
  );
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
    hasWiki: false,
    openLeaf: () => undefined,
    openHeading: () => undefined,
    openWikiLink: () => undefined,
    switchView: () => undefined,
    rowClicked: () => undefined,
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
