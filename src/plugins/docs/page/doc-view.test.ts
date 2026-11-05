import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DroppedFile, DropTarget } from '../../../contracts/drops';
import type { DocumentEditorEvents } from '../../../contracts/editor';
import type { ShownLayouts } from '../../../contracts/plugin';
import { withUser } from '../../../shared/page/layout-host/test-layouts';
import { posixPaths } from '../../../shared/paths/posix-paths';
import {
  asFake,
  asHtml,
  type FakeElement,
  findAll,
  installFocusFakeDom,
  ScrollerFakeElement,
  ShrinkingScrollerFakeElement,
} from '../../../shared/page/test-dom';
import type { IndexEntry } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import type { AsideLinkInput, DocHeaderInput, Layout } from '../layouts/layout';
import {
  createDocView,
  type DocDetail,
  type DocTarget,
  type DocView,
  type DocViewDeps,
} from './doc-view';
import { fakeDocsParts, fakePushedScope } from './docs-page-fakes';
import { readOnlyText, UNSAVED_TEXT } from './docs-state';
import {
  fencePlaceholder,
  installMarkdownDom,
  NO_FENCES,
} from '../../../shared/page/markdown-mount.test-support';

// A doc pane marked `marker` that places the scroller.
function paneLayout(marker: string): Layout {
  return {
    docPane(parent, _input, kit) {
      const pane = kit.el(parent, 'div', marker);
      kit.scroller(pane);
      return { element: pane };
    },
  };
}

// A page frame marked `marker` that places the article and the right column.
function frameLayout(marker: string): Layout {
  return {
    pageFrame(parent, _input, kit) {
      const frame = kit.el(parent, 'div', marker);
      kit.article(frame);
      kit.aside(frame);
      return { element: frame };
    },
  };
}

// A layout drawing the right column's headings and rows as plain lines that
// hold their titles, `links` recording each row's input.
function asideLayout() {
  const links: AsideLinkInput[] = [];
  const layout: Layout = {
    asideHeading(parent, input, kit) {
      return { element: kit.el(parent, 'div', ASIDE_HEADING, input.title) };
    },
    asideLink(parent, input, kit) {
      links.push(input);
      return { element: kit.el(parent, 'div', ASIDE_LINK, input.title) };
    },
  };
  return { layout, links };
}

const ASIDE_HEADING = 'test-aside-heading';
const ASIDE_LINK = 'test-aside-link';

// A body part marked `marker` that places the rendered body.
function bodyLayout(marker: string): Layout {
  return {
    docBody(parent, _input, kit) {
      const root = kit.el(parent, 'div', marker);
      kit.body(root);
      return { element: root };
    },
  };
}

// A drop target the view registered, and whether it has been disposed.
interface RecordedTarget {
  target: DropTarget;
  isDisposed: boolean;
}

// A doc view over a channel reading every doc as `# Doc`, drawing with the
// layouts `layouts` returns, its editor host recording each editor it makes
// and each text inserted, rendering through `markdown`. `replies` answers the
// channel by call name. `writeBytes` answers the channel's `writeBytes`, each
// call recorded in `writes`; each `writeDoc` is recorded in `docWrites`;
// `targets` holds each drop target; `anchored` holds the element each view
// anchor names, by command.
function docViewOver(
  layouts: () => ShownLayouts<Layout>,
  chipsOf: DocViewDeps['chipsOf'] = () => {
    throw new Error('no chips');
  },
  markdown: DocViewDeps['markdown'] = {
    block: (text: string) => text,
    inline: (text: string) => text,
    document: async (text: string) => text,
    ...NO_FENCES,
  },
) {
  const { parts } = fakeDocsParts(layouts);
  const editors: {
    parent: HTMLElement;
    line: number;
    events: DocumentEditorEvents;
    destroy: ReturnType<typeof vi.fn>;
    text(): string;
    change(next: string): void;
  }[] = [];
  const replies: Record<string, unknown> = {
    readDoc: '# Doc',
    writeDoc: { type: 'written' },
  };
  const inserts: string[] = [];
  const toasts: string[] = [];
  const writes: [string, number[]][] = [];
  const docWrites: { text: string; expected: string | null }[] = [];
  const anchored: Record<string, HTMLElement> = {};
  const targets: RecordedTarget[] = [];
  const io = {
    writeBytes: async (): Promise<unknown> => ({ type: 'written' }),
    now: 0,
  };
  const deps = {
    viewId: 'view',
    channel: {
      invoke: async (name: string, ...args: unknown[]) => {
        if (name === 'writeDoc') {
          const [, text, expected] = args as [string, string, string | null];
          docWrites.push({ text, expected });
        }
        if (name !== 'writeBytes') {
          return replies[name] ?? null;
        }
        const [path, bytes] = args as [string, Uint8Array];
        writes.push([path, [...bytes]]);
        return io.writeBytes();
      },
    },
    homeDir: '/home',
    editor: {
      createDocument(
        parent: HTMLElement,
        text: string,
        options: { line: number },
        events: DocumentEditorEvents,
      ) {
        const destroy = vi.fn();
        let current = text;
        const readText = () => current;
        editors.push({
          parent,
          line: options.line,
          events,
          destroy,
          text: readText,
          change: (next) => {
            current = next;
          },
        });
        return {
          text: readText,
          focus: () => undefined,
          blur: () => undefined,
          insert: (inserted: string) => inserts.push(inserted),
          charBeforeCursor: () => '',
          destroy,
        };
      },
    },
    markdown,
    paths: posixPaths,
    toast: (text: string) => toasts.push(text),
    log: () => undefined,
    drops: {
      addTarget(target: DropTarget) {
        const recorded = { target, isDisposed: false };
        targets.push(recorded);
        return {
          dispose: () => {
            recorded.isDisposed = true;
          },
        };
      },
    },
    now: () => io.now,
    chipsOf,
    statusesOf: () => [],
    loadedOf: () => null,
    followFile: () => undefined,
    pushConflictScope: fakePushedScope,
    anchor: (anchoring: HTMLElement, command: string) => {
      anchored[command] = anchoring;
      return { dispose: () => undefined };
    },
    parts,
    openChanged: () => undefined,
  } as unknown as DocViewDeps;
  return {
    view: createDocView(deps),
    editors,
    deps,
    replies,
    inserts,
    toasts,
    writes,
    docWrites,
    targets,
    anchored,
    io,
  };
}

function target(entryId: string | null, path = '/home/notes.md'): DocTarget {
  return {
    path,
    title: 'notes',
    entryId,
    detail: null,
    readOnly: null,
    line: null,
    fragment: null,
  };
}

// A hook entry's detail view, its `i` editing `/home/hook.md`.
const hookDetail: DocDetail = {
  fields: [['Event', 'Stop']],
  editFile: async () => ({ path: '/home/hook.md', text: '# Hook', line: 1 }),
};

// An own doc at `source`, whose link on `line` leads to `linkTarget`.
function linkingEntry(
  source: string,
  linkTarget: string,
  line: number,
): IndexEntry {
  return {
    id: source,
    kind: 'skill-file',
    source: 'repo',
    owner: 'mine',
    repo: null,
    root: null,
    plugin: null,
    path: source,
    line: null,
    title: 'Source',
    meta: {},
    walked: [],
    headings: [],
    links: [
      {
        form: 'markdown',
        raw: linkTarget,
        target: linkTarget,
        line,
        targetLine: null,
      },
    ],
    lastLoaded: null,
  };
}

describe('createDocView', () => {
  beforeEach(() =>
    installFocusFakeDom(
      (name, value) => vi.stubGlobal(name, value),
      ScrollerFakeElement,
    ),
  );
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('redraw_EditorOpen_KeepsTheEditorAndRedrawsTheFrameOnClose', async () => {
    let shown = withUser(defaultLayout, paneLayout('pane-1'));
    const { view, editors } = docViewOver(() => shown);
    await view.open(target(null));
    view.edit(1);
    const [editor] = editors;
    const host = asFake(editor.parent);
    const hostParent = host.parentNode;

    shown = withUser(defaultLayout, paneLayout('pane-2'));
    view.redraw();
    const whileEditing = {
      isHostInPlace: host.parentNode === hostParent,
      destroys: editor.destroy.mock.calls.length,
      pane: paneClasses(view.element),
    };
    view.quitEditor();

    expect(whileEditing).toEqual({
      isHostInPlace: true,
      destroys: 0,
      pane: ['pane-1'],
    });
    expect(paneClasses(view.element)).toEqual(['pane-2']);
  });

  it.each([
    {
      path: '/home/a.md',
      text: '# A\n## B',
      detail: null,
      linkedRows: 1,
      headings: ['On this page', 'Linked from'],
      isHidden: false,
    },
    {
      path: '/home/a.md',
      text: 'plain',
      detail: null,
      linkedRows: 1,
      headings: ['Linked from'],
      isHidden: false,
    },
    {
      path: '/home/a.md',
      text: '# A',
      detail: null,
      linkedRows: 0,
      headings: ['On this page'],
      isHidden: false,
    },
    {
      path: '/home/a.md',
      text: 'plain',
      detail: null,
      linkedRows: 0,
      headings: [],
      isHidden: true,
    },
    {
      path: '/home/a.json',
      text: '{}',
      detail: null,
      linkedRows: 1,
      headings: [],
      isHidden: true,
    },
    {
      path: '/home/a.md',
      text: '# A',
      detail: hookDetail,
      linkedRows: 1,
      headings: [],
      isHidden: true,
    },
  ])(
    'open_DocKind_DrawsTheAsideSectionsItHas $path $text $linkedRows',
    async ({ path, text, detail, linkedRows, headings, isHidden }) => {
      const { view, replies } = docViewOver(() =>
        withUser(defaultLayout, asideLayout().layout),
      );
      replies.readDoc = text;
      view.setEntries(
        Array.from({ length: linkedRows }, () =>
          linkingEntry('/home/source.md', path, 5),
        ),
      );

      await view.open({ ...target(null, path), detail });

      expect({
        headings: titlesOf(view, ASIDE_HEADING),
        openSections: findAll(
          asFake(view.element),
          'docs-aside-section',
        ).filter((section) => !section.hidden).length,
        isHidden: asideOf(view).hidden,
      }).toEqual({ headings, openSections: headings.length, isHidden });
    },
  );

  it('open_ReadOnlyDoc_KeepsTheAside', async () => {
    const { view } = docViewOver(() =>
      withUser(defaultLayout, paneLayout('pane')),
    );

    await view.open({
      ...target(null),
      readOnly: { type: 'downloaded', plugin: null },
    });

    expect(asideOf(view).hidden).toBe(false);
  });

  it('asideLink_NestedHeadings_IndentsFromTheLeastLevel', async () => {
    const { layout, links } = asideLayout();
    const { view, replies } = docViewOver(() =>
      withUser(defaultLayout, layout),
    );
    replies.readDoc = '## A\n### B';

    await view.open(target(null));

    expect(links.map(({ depth }) => depth)).toEqual([0, 1]);
  });

  it('asideLink_OnThisPage_RootTitleIsTheSectionTitle', async () => {
    const { view, replies } = docViewOver(() =>
      withUser(defaultLayout, asideLayout().layout),
    );
    replies.readDoc = '## A';

    await view.open(target(null));

    expect(rowsOf(view)[0].title).toBe('A');
  });

  it('asideLink_LinkedFrom_RootTitleIsTheTildePath', async () => {
    const { view, replies } = docViewOver(() =>
      withUser(defaultLayout, asideLayout().layout),
    );
    replies.readDoc = 'plain';
    view.setEntries([linkingEntry('/home/source.md', '/home/notes.md', 5)]);

    await view.open(target(null));

    expect(rowsOf(view)[0].title).toBe('~/source.md');
  });

  it('clickOnThisPage_ScrollsToTheHeadingsBlock', async () => {
    const { view, replies } = docViewOver(() =>
      withUser(defaultLayout, asideLayout().layout),
    );
    replies.readDoc = '---\nname: a\n---\n## A\n\n## B\n\n## C';
    await view.open(target(null));
    const body = findAll(asFake(view.element), 'docs-body')[0];
    body.append(sourceBlock(1, 40), sourceBlock(3, 200), sourceBlock(5, 400));

    rowsOf(view)[1].click();

    expect(scroller(view.element).scrollTop).toBe(200);
  });

  it('clickLinkedFrom_FollowsToTheLinkingLine', async () => {
    const { view, deps, replies } = docViewOver(() =>
      withUser(defaultLayout, asideLayout().layout),
    );
    const followFile = vi.spyOn(deps, 'followFile');
    replies.readDoc = 'plain';
    view.setEntries([linkingEntry('/home/source.md', '/home/notes.md', 5)]);
    await view.open(target(null));

    rowsOf(view)[0].click();

    expect(followFile.mock.calls).toEqual([['/home/source.md', 5, null]]);
  });

  it('setEntries_DocOpen_DrawsLinkedFromAgain', async () => {
    const { view } = docViewOver(() =>
      withUser(defaultLayout, asideLayout().layout),
    );
    await view.open(target(null));
    const pane = scroller(view.element);
    pane.scrollTop = 120;

    view.setEntries([linkingEntry('/home/source.md', '/home/notes.md', 5)]);

    expect({
      headings: titlesOf(view, ASIDE_HEADING),
      links: titlesOf(view, ASIDE_LINK),
      scrollTop: pane.scrollTop,
    }).toEqual({
      headings: ['On this page', 'Linked from'],
      links: ['Doc', 'Source'],
      scrollTop: 120,
    });
  });

  it('diskChanged_DocScrolled_KeepsBothScrollsAndShowsNewHeadings', async () => {
    installFocusFakeDom(
      (name, value) => vi.stubGlobal(name, value),
      ShrinkingScrollerFakeElement,
    );
    const { view, replies } = docViewOver(() =>
      withUser(defaultLayout, asideLayout().layout),
    );
    await view.open(target(null));
    const pane = scroller(view.element);
    pane.scrollTop = 120;
    asideOf(view).scrollTop = 40;
    replies.readDoc = '# New\n## Newer';

    view.diskChanged('/home/notes.md');
    await settled();

    expect({
      links: titlesOf(view, ASIDE_LINK),
      paneScrollTop: pane.scrollTop,
      asideScrollTop: asideOf(view).scrollTop,
    }).toEqual({
      links: ['New', 'Newer'],
      paneScrollTop: 120,
      asideScrollTop: 40,
    });
  });

  it('redraw_NewFrameLayout_KeepsScrollAndFocus', async () => {
    let shown = withUser(defaultLayout, frameLayout('frame-1'));
    const { view } = docViewOver(() => shown);
    await view.open(target(null));
    const pane = scroller(view.element);
    pane.scrollTop = 120;
    asideOf(view).scrollTop = 40;
    view.focus();

    shown = withUser(defaultLayout, frameLayout('frame-2'));
    view.redraw();

    expect({
      frames: frameCounts(view),
      paneScrollTop: pane.scrollTop,
      asideScrollTop: asideOf(view).scrollTop,
      isFocused: document.activeElement === asHtml(pane),
    }).toEqual({
      frames: { old: 0, new: 1 },
      paneScrollTop: 120,
      asideScrollTop: 40,
      isFocused: true,
    });
  });

  it('redraw_EditorOpen_DrawsTheFrameOnClose', async () => {
    let shown = withUser(defaultLayout, frameLayout('frame-1'));
    const { view, editors } = docViewOver(() => shown);
    await view.open(target(null));
    view.edit(1);
    const [editor] = editors;
    const host = asFake(editor.parent);
    const hostParent = host.parentNode;

    shown = withUser(defaultLayout, frameLayout('frame-2'));
    view.redraw();
    const whileEditing = {
      isHostInPlace: host.parentNode === hostParent,
      destroys: editor.destroy.mock.calls.length,
      frames: frameCounts(view),
    };
    view.quitEditor();

    expect(whileEditing).toEqual({
      isHostInPlace: true,
      destroys: 0,
      frames: { old: 1, new: 0 },
    });
    expect(frameCounts(view)).toEqual({ old: 0, new: 1 });
  });

  it('open_DocNoEntryNames_DrawsNoChips', async () => {
    const headers: DocHeaderInput[] = [];
    const header: Layout = {
      docHeader(parent, input, kit) {
        headers.push(input);
        return { element: kit.el(parent, 'div') };
      },
    };
    const { view } = docViewOver(() => withUser(defaultLayout, header));

    await view.open(target(null));

    expect(headers.map(({ chips, statuses }) => ({ chips, statuses }))).toEqual(
      [{ chips: [], statuses: [] }],
    );
  });

  it('redraw_NoEditor_KeepsThePaneScrollAndFocus', async () => {
    let shown = withUser(defaultLayout, paneLayout('pane-1'));
    const { view } = docViewOver(() => shown);
    await view.open(target(null));
    const pane = scroller(view.element);
    pane.scrollTop = 120;
    view.focus();

    shown = withUser(defaultLayout, paneLayout('pane-2'));
    view.redraw();

    expect({
      pane: paneClasses(view.element),
      scrollTop: pane.scrollTop,
      isFocused: document.activeElement === asHtml(pane),
    }).toEqual({ pane: ['pane-2'], scrollTop: 120, isFocused: true });
  });

  it('edit_NoLine_OpensAtTheBlockAtTheTopOfSightThoughItsTopIsFractional', async () => {
    const { view, editors } = docViewOver(() =>
      withUser(defaultLayout, paneLayout('pane')),
    );
    await view.open(target(null));
    const pane = scroller(view.element);
    const body = findAll(asFake(view.element), 'docs-body')[0];
    body.append(sourceBlock(3, -60), sourceBlock(7, 0.4), sourceBlock(9, 40));
    pane.scrollTop = 100;

    view.edit();

    expect(editors.map(({ line }) => line)).toEqual([7]);
  });

  it.each([
    ['quit', 'File', 'Renders'],
    ['writeQuit', 'File', 'Renders'],
    ['quit', 'Detail', 'Renders'],
    ['writeQuit', 'Detail', 'Renders'],
    ['quit', 'File', 'FailsToRender'],
  ] as const)(
    '%s_AfterEditFromAScrolled%sThat%s_ShowsItAtThatScroll',
    async (command, shows, render) => {
      const { view, editors, deps } = docViewOver(() =>
        withUser(defaultLayout, paneLayout('pane')),
      );
      await view.open(
        shows === 'File'
          ? target(null)
          : { ...target(null), detail: hookDetail },
      );
      const pane = scroller(view.element);
      pane.scrollTop = 120;
      view.edit(1);
      await settled();
      pane.scrollTop = 0;
      if (render === 'FailsToRender') {
        deps.markdown.document = async () => {
          throw new Error('render broke');
        };
      }

      if (command === 'quit') {
        editors[0].events.quit(false);
      } else {
        editors[0].events.writeQuit();
      }
      await settled();

      expect(pane.scrollTop).toBe(120);
    },
  );

  it.each([
    { steps: ['open'], live: [] },
    { steps: ['open', 'edit'], live: ['pane'] },
    { steps: ['open', 'edit', ':q'], live: [] },
    { steps: ['openReadOnly', 'edit'], live: [] },
    { steps: ['open', 'edit', 'clear'], live: [] },
    { steps: ['open', 'edit', 'dispose'], live: [] },
    { steps: ['open', 'edit', 'disposeAsDestroyThrows'], live: [] },
    { steps: ['openDetail', 'edit', 'dispose', 'settle'], live: [] },
  ])('dropTarget_OnlyWhileEditing $steps', async ({ steps, live }) => {
    const { view, editors, targets } = docViewOver(() =>
      withUser(defaultLayout, paneLayout('pane')),
    );
    for (const step of steps) {
      switch (step) {
        case 'open':
          await view.open(target(null));
          break;
        case 'openDetail':
          await view.open({ ...target(null), detail: hookDetail });
          break;
        case 'openReadOnly':
          await view.open({
            ...target(null),
            readOnly: { type: 'downloaded', plugin: null },
          });
          break;
        case 'edit':
          view.edit(1);
          break;
        case ':q':
          editors[0].events.quit(false);
          break;
        case 'clear':
          view.clear();
          break;
        case 'dispose':
          view.dispose();
          break;
        case 'disposeAsDestroyThrows':
          editors[0].destroy.mockImplementationOnce(() => {
            throw new Error('box gone');
          });
          expect(() => view.dispose()).toThrow('box gone');
          break;
        case 'settle':
          await settled();
          break;
      }
    }

    const pane = asHtml(scroller(view.element));
    expect(
      targets
        .filter(({ isDisposed }) => !isDisposed)
        .map(({ target: { element } }) =>
          element === pane ? 'pane' : 'other',
        ),
    ).toEqual(live);
  });

  // Every render answers only after the dispose. `inFlight` runs before the
  // dispose, which comes at once, or once the render began for `isRendering`;
  // `late` runs after it.
  it.each<{
    name: string;
    inFlight?: (shown: LateDocView) => void;
    isRendering?: boolean;
    late?: (shown: LateDocView) => void;
  }>([
    {
      name: 'an open at its render',
      inFlight: ({ view }) => {
        void view.open(target(null, '/home/other.md'));
      },
      isRendering: true,
    },
    {
      name: 'a disk change at its read',
      inFlight: ({ view }) => view.diskChanged('/home/notes.md'),
    },
    {
      name: 'a disk change at its render',
      inFlight: ({ view }) => view.diskChanged('/home/notes.md'),
      isRendering: true,
    },
    {
      name: "a :q's render",
      inFlight: ({ view, editors }) => {
        view.edit(1);
        editors[0].events.quit(false);
      },
    },
    {
      name: 'a move',
      late: ({ view }) => view.retarget(target(null, '/home/moved.md')),
    },
    { name: 'a clear', late: ({ view }) => view.clear() },
    { name: 'a chip refresh', late: ({ view }) => view.refreshChips() },
    { name: 'an entries change', late: ({ view }) => view.setEntries([]) },
    {
      name: 'a layout change',
      late: ({ view, changeLayouts }) => {
        changeLayouts();
        view.redraw();
      },
    },
  ])('dispose_ThenWorkLandingLate_DrawsNothing $name', async (row) => {
    let layouts = withUser(defaultLayout, paneLayout('pane-1'));
    const { view, editors, deps } = docViewOver(() => layouts);
    const changeLayouts = () => {
      layouts = withUser(defaultLayout, paneLayout('pane-2'));
    };
    const shown = { view, editors, changeLayouts };
    await view.open(target(null));
    let answerRender: () => void = () => undefined;
    deps.markdown.document = () =>
      new Promise((resolve) => {
        answerRender = () => resolve('# Doc');
      });
    row.inFlight?.(shown);
    if (row.isRendering === true) {
      await settled();
    }

    view.dispose();
    const draw = vi.spyOn(deps.parts, 'draw');
    const render = vi.spyOn(deps.markdown, 'document');
    const openChanged = vi.spyOn(deps, 'openChanged');
    row.late?.(shown);
    answerRender();
    await settled();

    expect({
      draws: draw.mock.calls.length,
      renders: render.mock.calls.length,
      openChanges: openChanged.mock.calls.length,
    }).toEqual({ draws: 0, renders: 0, openChanges: 0 });
  });

  // `writeBytes`: 'written' answers at once; 'refused' rejects; 'afterQuit'
  // answers only once the test has quit the editor with `:q`. Each take
  // settles before the next begins, unless `areOverlapping`.
  it.each([
    {
      name: 'a dropped image',
      takes: [[dropped('/n/docs/images/a.png', 'image/png')]],
      writeBytes: 'written',
      writes: [],
      inserts: ['![a.png](images/a.png)'],
      toasts: [],
    },
    {
      name: 'a pasted image',
      takes: [[pasted([1])]],
      writeBytes: 'written',
      writes: [['/n/docs/images/guide-20261102-090507.png', [1]]],
      inserts: [
        '![guide-20261102-090507.png](images/guide-20261102-090507.png)',
      ],
      toasts: [],
    },
    {
      name: 'a pasted image main refuses',
      takes: [[pasted([1])]],
      writeBytes: 'refused',
      writes: [['/n/docs/images/guide-20261102-090507.png', [1]]],
      inserts: [],
      toasts: ['Refused: outside the docs'],
    },
    {
      name: 'a pasted image main refuses, then a dropped doc',
      takes: [[pasted([1]), dropped('/n/notes/b.md', 'text/markdown')]],
      writeBytes: 'refused',
      writes: [['/n/docs/images/guide-20261102-090507.png', [1]]],
      inserts: ['[b.md](../notes/b.md)'],
      toasts: ['Refused: outside the docs'],
    },
    {
      name: 'a pasted image, then a dropped doc',
      takes: [[pasted([1]), dropped('/n/notes/b.md', 'text/markdown')]],
      writeBytes: 'written',
      writes: [['/n/docs/images/guide-20261102-090507.png', [1]]],
      inserts: [
        '![guide-20261102-090507.png](images/guide-20261102-090507.png) [b.md](../notes/b.md)',
      ],
      toasts: [],
    },
    {
      name: 'two takes in one second',
      takes: [[pasted([1])], [pasted([2])]],
      writeBytes: 'written',
      writes: [
        ['/n/docs/images/guide-20261102-090507.png', [1]],
        ['/n/docs/images/guide-20261102-090507-2.png', [2]],
      ],
      inserts: [
        '![guide-20261102-090507.png](images/guide-20261102-090507.png)',
        '![guide-20261102-090507-2.png](images/guide-20261102-090507-2.png)',
      ],
      toasts: [],
    },
    {
      name: 'two takes in one second, the second begun before any write answers',
      takes: [[pasted([1])], [pasted([2])]],
      areOverlapping: true,
      writeBytes: 'written',
      writes: [
        ['/n/docs/images/guide-20261102-090507.png', [1]],
        ['/n/docs/images/guide-20261102-090507-2.png', [2]],
      ],
      inserts: [
        '![guide-20261102-090507.png](images/guide-20261102-090507.png)',
        '![guide-20261102-090507-2.png](images/guide-20261102-090507-2.png)',
      ],
      toasts: [],
    },
    {
      name: 'a pasted image written after :q',
      takes: [[pasted([1])]],
      writeBytes: 'afterQuit',
      writes: [['/n/docs/images/guide-20261102-090507.png', [1]]],
      inserts: [],
      toasts: [
        'Saved /n/docs/images/guide-20261102-090507.png, not linked: the editor closed',
      ],
    },
  ])('take_FilesBecomeDocLinks $name', async (row) => {
    const shown = docViewOver(() =>
      withUser(defaultLayout, paneLayout('pane')),
    );
    const { view, editors, targets, io } = shown;
    io.now = new Date(2026, 10, 2, 9, 5, 7).getTime();
    let answerWrite: () => void = () => undefined;
    if (row.writeBytes === 'refused') {
      io.writeBytes = async () => {
        throw new Error('Refused: outside the docs');
      };
    } else if (row.writeBytes === 'afterQuit') {
      io.writeBytes = () =>
        new Promise((resolve) => {
          answerWrite = () => resolve({ type: 'written' });
        });
    }
    await view.open(target(null, '/n/docs/guide.md'));
    view.edit(1);

    for (const files of row.takes) {
      targets[0].target.take(files);
      if (row.areOverlapping !== true) {
        await settled();
      }
    }
    await settled();
    if (row.writeBytes === 'afterQuit') {
      editors[0].events.quit(false);
      answerWrite();
      await settled();
    }

    expect({
      writes: shown.writes,
      inserts: shown.inserts,
      toasts: shown.toasts,
    }).toEqual({
      writes: row.writes,
      inserts: row.inserts,
      toasts: row.toasts,
    });
  });

  describe('editSection', () => {
    it('editSection_TopOfSightInASection_OpensThatSectionsText', async () => {
      const { view, editors } = await sectionDoc(TWO_SECTIONS);
      scroller(view.element).scrollTop = 100;
      addBlocks(view, block(1, -100), block(3, -60), block(6, 0), block(7, 40));

      view.editSection();

      expect(editors.map(({ text, line }) => [text(), line])).toEqual([
        ['## B\ny', 1],
      ]);
    });

    it.each([
      {
        name: 'text above the first heading',
        text: 'intro\n\n## A\nx',
        lineAtTop: 1,
      },
      { name: 'a doc with no heading', text: 'plain\ntext', lineAtTop: 1 },
    ])(
      'editSection_AboveTheFirstHeading_OpensTheWholeFile $name',
      async ({ text, lineAtTop }) => {
        const { view, editors } = await sectionDoc(text);
        const pane = scroller(view.element);
        pane.scrollTop = 100;
        addBlocks(view, block(lineAtTop, 0));

        view.editSection();

        expect({
          text: editors[0].text(),
          isWholeFile: pane.classList.contains('is-editing'),
        }).toEqual({ text, isWholeFile: true });
      },
    );

    it.each([
      {
        name: 'a file that is not markdown',
        doc: target(null, '/home/a.json'),
        toast: 'Only a markdown doc has sections',
      },
      {
        name: 'a detail',
        doc: { ...target(null), detail: hookDetail },
        toast: 'Only a markdown doc has sections',
      },
      {
        name: 'a read-only doc',
        doc: {
          ...target(null),
          readOnly: { type: 'downloaded', plugin: null },
        } as DocTarget,
        toast: readOnlyText({ type: 'downloaded', plugin: null }),
      },
    ])(
      'editSection_Refuses_ToastsAndOpensNothing $name',
      async ({ doc, toast }) => {
        const { view, editors, toasts } = await sectionDoc(TWO_SECTIONS, doc);

        view.editSection();

        expect({ toasts, editors: editors.length }).toEqual({
          toasts: [toast],
          editors: 0,
        });
      },
    );

    it.each([
      { opens: 'edit', second: 'editSection' },
      { opens: 'editSection', second: 'editSection' },
      { opens: 'editSection', second: 'edit' },
    ] as const)(
      'editSection_EditorOpen_OnlyFocusesIt $opens then $second',
      async ({ opens, second }) => {
        const { view, editors } = await sectionDoc(TWO_SECTIONS);
        scroller(view.element).scrollTop = 100;
        addBlocks(view, block(3, 0));
        view[opens]();
        const { destroy } = editors[0];

        view[second]();

        expect({
          editors: editors.length,
          destroys: destroy.mock.calls.length,
        }).toEqual({ editors: 1, destroys: 0 });
      },
    );

    it('editSection_WhileTheClosedEditorsBodyRenders_OpensTheWholeFile', async () => {
      const shown = await openSection(TWO_SECTIONS);
      const { view, deps, editors } = shown;
      deps.markdown.document = () => new Promise(() => undefined);
      editors[0].change('## A\nnew heading\n\n## C\nz\n');
      editors[0].events.writeQuit();
      await settled();

      view.editSection();

      expect(scroller(view.element).classList.contains('is-editing')).toBe(
        true,
      );
    });

    it('openSection_HidesTheSectionsBlocksAndNotTheBody', async () => {
      const { view, blocks } = await openSection(TWO_SECTIONS);
      const pane = scroller(view.element);

      expect({
        hidden: blocks.map(({ hidden }) => hidden),
        isBodyHidden: findAll(asFake(view.element), 'docs-doc-body')[0].hidden,
        isWholeFile: pane.classList.contains('is-editing'),
        state: view.element.dataset.doc,
      }).toEqual({
        hidden: [false, true, true, false, false],
        isBodyHidden: false,
        isWholeFile: false,
        state: 'editing',
      });
    });

    it('clickOnThisPage_HiddenSection_LandsOnTheBlockAboveTheEditor', async () => {
      const { view } = await openSection(TWO_SECTIONS);
      const pane = scroller(view.element);
      pane.scrollTop = 0;

      findAll(asFake(view.element), 'ui-row')[1].click();

      // The block of line 1, two pixels above `## A`'s.
      expect(pane.scrollTop).toBe(-2);
    });
  });

  describe('section editor', () => {
    it.each([
      {
        name: 'text that adds a heading',
        doc: TWO_SECTIONS,
        firstLine: 3,
        first: '## A\na\n\n## N\nn\n',
        second: '## A\nb\n',
        writes: [
          {
            text: '# T\n\n## A\na\n\n## N\nn\n\n## B\ny',
            expected: TWO_SECTIONS,
          },
          {
            text: '# T\n\n## A\nb\n\n## B\ny',
            expected: '# T\n\n## A\na\n\n## N\nn\n\n## B\ny',
          },
        ],
      },
      {
        name: 'text ending in a new line, in a file with no last line ending',
        doc: '# T\n\n## A\nx',
        firstLine: 3,
        first: '## A\na\n',
        second: '## A\nb',
        writes: [
          { text: '# T\n\n## A\na\n', expected: '# T\n\n## A\nx' },
          { text: '# T\n\n## A\nb', expected: '# T\n\n## A\na\n' },
        ],
      },
      {
        name: 'emptied text at the end of a file with no last line ending',
        doc: '# T\n\n## A\nx',
        firstLine: 3,
        first: '',
        second: '## A\nb',
        writes: [
          { text: '# T\n\n', expected: '# T\n\n## A\nx' },
          { text: '# T\n\n## A\nb', expected: '# T\n\n' },
        ],
      },
    ])(
      'write_SectionEditor_WritesTheSplicedFileTwice $name',
      async ({ doc, firstLine, first, second, writes }) => {
        const { editors, docWrites } = await openSection(doc, firstLine);

        for (const next of [first, second]) {
          editors[0].change(next);
          editors[0].events.write();
          await settled();
        }

        expect(docWrites).toEqual(writes);
      },
    );

    it('hasUnsavedEdits_SectionEditor_ComparesWithTheSectionsSavedText', async () => {
      const { view, editors } = await openSection(TWO_SECTIONS);
      const atOpen = view.hasUnsavedEdits();
      editors[0].change('## A\nchanged\n');
      const afterChange = view.hasUnsavedEdits();

      editors[0].events.write();
      await settled();

      expect([atOpen, afterChange, view.hasUnsavedEdits()]).toEqual([
        false,
        true,
        false,
      ]);
    });

    it.each([
      { name: ':q with edits', act: 'quit', isClosed: false },
      { name: ':q! with edits', act: 'forceQuit', isClosed: true },
      { name: ':wq with edits', act: 'writeQuit', isClosed: true },
    ] as const)(
      'quit_SectionEditor_ActsAsTheWholeFileEditor $name',
      async ({ act, isClosed }) => {
        const { view, editors, toasts, blocks } =
          await openSection(TWO_SECTIONS);
        const pane = scroller(view.element);
        const host = asFake(editors[0].parent);
        pane.scrollTop = 0;
        editors[0].change('## A\nchanged\n');

        if (act === 'writeQuit') {
          editors[0].events.writeQuit();
        } else {
          editors[0].events.quit(act === 'forceQuit');
        }
        await settled();

        expect({
          destroys: editors[0].destroy.mock.calls.length,
          toastsUnsaved: toasts.includes(UNSAVED_TEXT),
          isHostSized: host.classList.contains('is-section'),
          isBlockHidden: blocks[1].hidden,
          scrollTop: pane.scrollTop,
        }).toEqual({
          destroys: isClosed ? 1 : 0,
          toastsUnsaved: !isClosed,
          isHostSized: !isClosed,
          isBlockHidden: !isClosed,
          scrollTop: isClosed ? SCROLL_BEFORE_OPEN : 0,
        });
      },
    );

    it('conflictReload_SectionStillThere_OpensItWithTheDiskText', async () => {
      const disk = '# T\n\nnew\n\n## A\ndisk\n\n## B\ny';
      const shown = await openSection(TWO_SECTIONS);
      const { view, editors, deps } = shown;
      const render = vi.spyOn(deps.markdown, 'document');
      await hitConflict(shown, disk);

      view.conflictReload();
      await settled();

      expect({
        first: editors[0].destroy.mock.calls.length,
        reopened: editors.map(({ text }) => text()).at(-1),
        rendered: render.mock.calls.at(-1)?.[0],
      }).toEqual({ first: 1, reopened: '## A\ndisk\n', rendered: disk });
    });

    it('conflictReload_SectionGone_ClosesAndToasts', async () => {
      const disk = '# T\n\n## B\ny';
      const shown = await openSection(TWO_SECTIONS);
      const { view, editors, deps, toasts } = shown;
      const render = vi.spyOn(deps.markdown, 'document');
      await hitConflict(shown, disk);

      view.conflictReload();
      await settled();

      expect({
        editors: editors.length,
        destroys: editors[0].destroy.mock.calls.length,
        rendered: render.mock.calls.at(-1)?.[0],
        namesTheSection: toasts.some((toast) => toast.includes('"A"')),
      }).toEqual({
        editors: 1,
        destroys: 1,
        rendered: disk,
        namesTheSection: true,
      });
    });

    it('conflictOverwrite_SectionEditor_WritesWithNoExpectedText', async () => {
      const shown = await openSection(TWO_SECTIONS);
      await hitConflict(shown, 'other');
      shown.replies.writeDoc = { type: 'written' };

      shown.view.conflictOverwrite();
      await settled();

      expect(shown.docWrites.at(-1)).toEqual({
        text: '# T\n\n## A\nchanged\n\n## B\ny',
        expected: null,
      });
    });

    it('drop_SectionEditor_InsertsAtTheCursor', async () => {
      const { targets, inserts } = await openSection(TWO_SECTIONS);

      targets[0].target.take([dropped('/home/b.md', 'text/markdown')]);
      await settled();

      expect(inserts).toEqual(['[b.md](b.md)']);
    });

    it('redraw_SectionEditor_DrawsTheBodyPartOnClose', async () => {
      let layouts = withUser(defaultLayout, bodyLayout('body-1'));
      const shown = await sectionDoc(TWO_SECTIONS, target(null), () => layouts);
      const { view, editors } = shown;
      scroller(view.element).scrollTop = 100;
      addBlocks(view, block(3, 0));
      view.editSection();

      layouts = withUser(defaultLayout, bodyLayout('body-2'));
      view.redraw();
      const whileEditing = {
        old: findAll(asFake(view.element), 'body-1').length,
        destroys: editors[0].destroy.mock.calls.length,
      };
      view.quitEditor();

      expect(whileEditing).toEqual({ old: 1, destroys: 0 });
      expect(findAll(asFake(view.element), 'body-2').length).toBe(1);
    });
  });

  describe('section controls', () => {
    // A doc whose two headings carry anchors, with their controls drawn.
    async function controlledDoc() {
      let layouts = withUser(defaultLayout, paneLayout('pane-1'));
      const shown = await sectionDoc(TWO_SECTIONS, target(null), () => layouts);
      const headings = [heading(3, 'a'), heading(6, 'b')];
      addBlocks(shown.view, ...headings);
      const redrawParts = (marker: string) => {
        layouts = withUser(defaultLayout, paneLayout(marker));
        shown.view.redraw();
      };
      redrawParts('pane-2');
      const controls = () =>
        findAll(asFake(shown.view.element), 'docs-section-edit');
      return { ...shown, headings, redrawParts, controls };
    }

    it('clickEdit_OtherSection_RefusesWithUnsavedEdits', async () => {
      const { controls, editors, toasts } = await controlledDoc();
      controls()[0].click();
      editors[0].change('## A\nchanged\n');

      controls()[1].click();
      await settled();

      expect({
        toasts,
        editors: editors.length,
        destroys: editors[0].destroy.mock.calls.length,
      }).toEqual({ toasts: [UNSAVED_TEXT], editors: 1, destroys: 0 });
    });

    it('clickEdit_OtherSection_SwitchesWhenClean', async () => {
      const { controls, editors } = await controlledDoc();
      controls()[0].click();

      controls()[1].click();
      await settled();

      expect({
        destroys: editors[0].destroy.mock.calls.length,
        opened: editors.map(({ text }) => text()),
      }).toEqual({ destroys: 1, opened: ['## A\nx\n', '## B\ny'] });
    });

    it.each([
      {
        name: 'a read-only doc',
        doc: {
          ...target(null),
          readOnly: { type: 'downloaded', plugin: null },
        } as DocTarget,
      },
      { name: 'a detail', doc: { ...target(null), detail: hookDetail } },
      {
        name: 'a file that is not markdown',
        doc: target(null, '/home/a.json'),
      },
    ])('sectionControls_ReadOnlyOrDetail_DrawNone $name', async ({ doc }) => {
      let layouts = withUser(defaultLayout, paneLayout('pane-1'));
      const { view } = await sectionDoc(TWO_SECTIONS, doc, () => layouts);
      addBlocks(view, heading(3, 'a'), heading(6, 'b'));

      layouts = withUser(defaultLayout, paneLayout('pane-2'));
      view.redraw();

      expect(findAll(asFake(view.element), 'docs-section-edit')).toEqual([]);
    });

    it('sectionControls_Redraw_LeavesOneSlotPerHeading', async () => {
      const { headings, redrawParts } = await controlledDoc();

      redrawParts('pane-3');

      expect(
        headings.map(
          (shownHeading) => findAll(shownHeading, 'docs-slot').length,
        ),
      ).toEqual([1, 1]);
    });

    it('sectionHint_OpenAfterOpen_FollowsTheDrawnDocsHeadings', async () => {
      const { view, replies, anchored } = await sectionDoc('## A\nx');
      const withHeadings = anchored['editSection'].hidden;
      replies.readDoc = 'plain';

      await view.open(target(null, '/home/plain.md'));

      expect([withHeadings, anchored['editSection'].hidden]).toEqual([
        false,
        true,
      ]);
    });
  });

  describe('moveSection', () => {
    // A doc whose three headings sit at content tops 0, 100 and 200 in a pane
    // that scrolls no further than `maxScroll`.
    async function movingDoc(maxScroll: number) {
      const shown = await sectionDoc('## A\nx\n\n## B\ny\n\n## C\nz');
      const pane = scroller(shown.view.element);
      let scrollTop = 0;
      Object.defineProperty(pane, 'scrollTop', {
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = Math.min(value, maxScroll);
        },
      });
      addBlocks(
        shown.view,
        ...[
          { line: 1, top: 0 },
          { line: 4, top: 100 },
          { line: 7, top: 200 },
        ].map(({ line, top }) => {
          const moving = block(line, 0);
          Object.defineProperty(moving, 'rectTop', {
            get: () => top - scrollTop,
          });
          return moving;
        }),
      );
      return { ...shown, pane };
    }

    it('moveSection_EditorOpen_ScrollsNothing', async () => {
      const { view, pane } = await movingDoc(1000);
      view.moveSection(1);
      view.editSection();
      const atOpen = pane.scrollTop;

      view.moveSection(1);

      expect(pane.scrollTop).toBe(atOpen);
    });

    it('moveSection_AtTheLastHeading_StaysAndKeepsTheScroll', async () => {
      const { view, pane } = await movingDoc(1000);
      view.moveSection(1);
      view.moveSection(1);
      const atLast = pane.scrollTop;

      view.moveSection(1);

      expect({ atLast, scrollTop: pane.scrollTop }).toEqual({
        atLast: 200,
        scrollTop: 200,
      });
    });

    it('moveSection_ThenEdit_OpensTheHeldSection', async () => {
      const { view, editors } = await movingDoc(120);
      view.moveSection(1);
      view.moveSection(1);

      view.editSection();

      expect(editors.map(({ text }) => text())).toEqual(['## C\nz']);
    });
  });
});

const TWO_SECTIONS = '# T\n\n## A\nx\n\n## B\ny';

// The pane's scroll as `openSection` opens its editor.
const SCROLL_BEFORE_OPEN = 100;

// A doc view showing `text`, read at `doc`.
async function sectionDoc(
  text: string,
  doc: DocTarget = target(null),
  layouts: () => ShownLayouts<Layout> = () =>
    withUser(defaultLayout, paneLayout('pane')),
) {
  const shown = docViewOver(layouts);
  shown.replies.readDoc = text;
  await shown.view.open(doc);
  return shown;
}

// A section editor on `text`'s section at file line `line`, its blocks in
// `blocks`: the file's lines 1, 3, 4, 6 and 7, with the block of `line` at the
// top of sight.
async function openSection(text: string, line = 3) {
  const shown = await sectionDoc(text);
  scroller(shown.view.element).scrollTop = SCROLL_BEFORE_OPEN;
  const lines = [1, 3, 4, 6, 7];
  const blocks = lines.map((sourceLine) =>
    block(sourceLine, sourceLine - line),
  );
  addBlocks(shown.view, ...blocks);
  shown.view.editSection();
  return { ...shown, blocks };
}

// Runs `:w` in the first editor against a disk that holds `diskText`.
async function hitConflict(
  { editors, replies }: Awaited<ReturnType<typeof openSection>>,
  diskText: string,
) {
  replies.writeDoc = { type: 'changedOnDisk', diskText };
  editors[0].change('## A\nchanged\n');
  editors[0].events.write();
  await settled();
}

function addBlocks(view: DocView, ...blocks: FakeElement[]) {
  findAll(asFake(view.element), 'docs-body')[0].append(...blocks);
}

function block(line: number, top: number): ScrollerFakeElement {
  return sourceBlock(line, top);
}

// A rendered heading of the source `line`, its anchor `anchor`.
function heading(line: number, anchor: string): ScrollerFakeElement {
  const shownHeading = sourceBlock(line, line);
  shownHeading.dataset.anchor = anchor;
  return shownHeading;
}

// What a row of the late-work table acts on.
interface LateDocView {
  view: DocView;
  editors: { events: DocumentEditorEvents }[];
  changeLayouts(): void;
}

// A file dropped from disk at `path`.
function dropped(path: string, mediaType: string): DroppedFile {
  return {
    name: path.slice(path.lastIndexOf('/') + 1),
    mediaType,
    path,
    bytes: async () => {
      throw new Error('a dropped file is never read');
    },
  };
}

// A pasted PNG holding `bytes`, with no path on disk.
function pasted(bytes: number[]): DroppedFile {
  return {
    name: 'image.png',
    mediaType: 'image/png',
    path: '',
    bytes: async () => new Uint8Array(bytes),
  };
}

// The classes of the doc pane part's root.
function paneClasses(root: HTMLElement): string[] {
  return asFake(root).children.map((child: FakeElement) => child.className);
}

// The right column, `div.docs-aside`.
function asideOf(view: DocView): FakeElement {
  return findAll(asFake(view.element), 'docs-aside')[0];
}

// The right column's drawn rows, as `asideLayout` draws them.
function rowsOf(view: DocView): FakeElement[] {
  return findAll(asFake(view.element), ASIDE_LINK);
}

// The texts of the elements drawn with `className`, as `asideLayout` draws
// them.
function titlesOf(view: DocView, className: string): string[] {
  return findAll(asFake(view.element), className).map(
    (node) => node.textContent,
  );
}

// How many of `frameLayout`'s `frame-1` and `frame-2` frames the view holds.
function frameCounts(view: DocView): { old: number; new: number } {
  const root = asFake(view.element);
  return {
    old: findAll(root, 'frame-1').length,
    new: findAll(root, 'frame-2').length,
  };
}

// The pane's scroller, `div.docs-doc`.
function scroller(root: HTMLElement): ScrollerFakeElement {
  return findAll(asFake(root), 'docs-doc')[0] as ScrollerFakeElement;
}

// A rendered block of the source `line`, its client rect `top` below the
// scroller's.
function sourceBlock(line: number, top: number): ScrollerFakeElement {
  const block = new ScrollerFakeElement('p');
  block.dataset.sourceLine = String(line);
  block.rectTop = top;
  return block;
}

// Resolves once every promise already settling has run its callbacks.
function settled(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('createDocView fences', () => {
  beforeEach(() =>
    installMarkdownDom((name, value) => vi.stubGlobal(name, value)),
  );
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // A doc view whose every document renders one closed `html` placeholder,
  // its live contribution counting mounts and view disposals.
  function fencedDocView() {
    const counts = { mounts: 0, disposals: 0 };
    const html = {
      language: 'html',
      live: true,
      mount: () => {
        counts.mounts += 1;
        return {
          element: document.createElement('div'),
          dispose: () => {
            counts.disposals += 1;
          },
        };
      },
    };
    const { view } = docViewOver(
      () => withUser(defaultLayout, paneLayout('pane')),
      undefined,
      {
        block: (text: string) => text,
        inline: (text: string) => text,
        document: async () => fencePlaceholder('html', true, 'x'),
        addFence: () => ({ dispose: () => undefined }),
        fence: (language: string) => (language === 'html' ? html : undefined),
      },
    );
    return { view, counts };
  }

  it.each([
    { file: 'a.md', result: 'live', mounts: 1 },
    { file: 'a.html', result: 'as code', mounts: 0 },
  ])("draws a $file file's html fence $result", async ({ file, mounts }) => {
    const { view, counts } = fencedDocView();

    await view.open(target(null, `/home/${file}`));

    expect(counts.mounts).toBe(mounts);
  });

  it.each([
    {
      name: 'keeps its fence view once drawn',
      isDisposed: false,
      disposals: 0,
    },
    {
      name: 'disposes its fence view on dispose',
      isDisposed: true,
      disposals: 1,
    },
  ])('$name', async ({ isDisposed, disposals }) => {
    const { view, counts } = fencedDocView();
    await view.open(target(null, '/home/a.md'));
    await settled();

    if (isDisposed) {
      view.dispose();
    }

    expect(counts.disposals).toBe(disposals);
  });
});
