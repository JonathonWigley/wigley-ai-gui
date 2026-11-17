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
import {
  docsEditSectionAtCommand,
  type IndexEntry,
  UNSAVED_TEXT,
} from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import type {
  DocHeaderInput,
  DocsKit,
  Layout,
  ListRowInput,
  RecentChangesInput,
} from '../layouts/layout';
import {
  createDocView,
  type DocAt,
  type DocDetail,
  type DocLink,
  type DocTarget,
  type DocView,
  type DocViewDeps,
} from './doc-view';
import { fakeDocsParts, fakePushedScope } from './docs-page-fakes';
import { type HarnessChip, readOnlyText } from './docs-state';
import type { ListPageContent } from './list-page';
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
// hold their titles.
function asideLayout(): Layout {
  return {
    asideHeading(parent, input, kit) {
      return { element: kit.el(parent, 'div', ASIDE_HEADING, input.title) };
    },
    asideLink(parent, input, kit) {
      return { element: kit.el(parent, 'div', ASIDE_LINK, input.title) };
    },
  };
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
  // A section control's click runs `docs.editSectionAt`, which start.ts sends
  // to the view its arg names.
  let view: DocView | null = null;
  const { parts } = fakeDocsParts(layouts, (id, arg) => {
    if (id === docsEditSectionAtCommand.id) {
      view?.editSectionAt((arg as { anchor: string }).anchor);
    }
  });
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
  // Each click's command and arg; start.ts sends each to the view it names.
  const clicks: unknown[][] = [];
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
          setText: (next: string) => {
            current = next;
          },
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
    followPlace: () => undefined,
    openListEntry: () => undefined,
    createMain: () => undefined,
    linkClicked: (link: DocLink) => {
      clicks.push(['followLink', link]);
      view?.followLink(link);
    },
    docAtClicked: (at: DocAt) => {
      clicks.push(['openDocAt', at]);
      view?.openDocAt(at);
    },
    recentPageClicked: (path: string) => {
      clicks.push(['openRecentPage', path]);
      view?.openRecentPage(path);
    },
    listRowClicked: (entryId: string) => {
      clicks.push(['openListRow', entryId]);
      view?.openListRow(entryId);
    },
    mainOfferClicked: () => {
      clicks.push(['createMain']);
      deps.createMain();
    },
    followWikiLink: () => false,
    asideSightLost: () => undefined,
    asideSectionOpened: () => undefined,
    pushConflictScope: fakePushedScope,
    anchor: (anchoring: HTMLElement, command: string) => {
      anchored[command] = anchoring;
      return { dispose: () => undefined };
    },
    parts,
    openChanged: () => undefined,
    editsChanged: () => undefined,
  } as unknown as DocViewDeps;
  const created = createDocView(deps);
  view = created;
  return {
    view: created,
    editors,
    deps,
    replies,
    inserts,
    toasts,
    writes,
    docWrites,
    targets,
    anchored,
    clicks,
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

// A spy on the channel of a doc view's `deps`.
function channelSpy(deps: DocViewDeps) {
  return vi.spyOn(deps.channel, 'invoke');
}

// The paths each `watchDoc` call `invoke` heard asks to watch, null to stop.
function watchedPaths(invoke: ReturnType<typeof channelSpy>): unknown[] {
  return invoke.mock.calls
    .filter(([name]) => name === 'watchDoc')
    .map(([, , path]) => path);
}

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
        withUser(defaultLayout, asideLayout()),
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

  it('pageFrame_LeavesOutItsParts_PlacesTheArticleFirstAndTheAsideLast', () => {
    const { view } = docViewOver(() =>
      withUser<Layout>(defaultLayout, {
        pageFrame(parent, _input, kit) {
          const frame = kit.el(parent, 'div', 'test-frame');
          kit.el(frame, 'div', 'test-own');
          return { element: frame };
        },
      }),
    );

    expect(
      findAll(asFake(view.element), 'test-frame')[0].children.map(
        (child) => child.className,
      ),
    ).toEqual(['docs-article', 'test-own', 'docs-aside']);
  });

  it('open_AnotherDoc_ScrollsTheAsideToTheTop', async () => {
    const { view } = docViewOver(() => withUser(defaultLayout, asideLayout()));
    await view.open(target(null));
    asideOf(view).scrollTop = 40;

    await view.open(target(null, OTHER_DOC));

    expect(asideOf(view).scrollTop).toBe(0);
  });

  it('clickOnThisPage_ScrollsToTheHeadingsBlock', async () => {
    const { view, replies } = docViewOver(() =>
      withUser(defaultLayout, asideLayout()),
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
      withUser(defaultLayout, asideLayout()),
    );
    const followFile = vi.spyOn(deps, 'followFile');
    replies.readDoc = 'plain';
    view.setEntries([linkingEntry('/home/source.md', '/home/notes.md', 5)]);
    await view.open(target(null));

    rowsOf(view)[0].click();

    expect(followFile.mock.calls).toEqual([['/home/source.md', 5, null]]);
  });

  it('setEntries_DocOpen_DrawsLinkedFromAgain', async () => {
    const { view } = docViewOver(() => withUser(defaultLayout, asideLayout()));
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

  it.each([
    {
      name: 'to a linked path',
      from: DOC,
      to: '/home/moved.md',
      rendered: '# Doc',
      headings: ['On this page', 'Linked from'],
      hasSectionHint: true,
    },
    {
      name: '.md to not .md',
      from: DOC,
      to: '/home/moved.json',
      rendered: '```json\n# Doc\n```',
      headings: [],
      hasSectionHint: false,
    },
    {
      name: 'not .md to .md',
      from: '/home/a.json',
      to: '/home/moved.md',
      rendered: '# Doc',
      headings: ['On this page', 'Linked from'],
      hasSectionHint: true,
    },
  ])(
    'retarget_NoEditor_DrawsForTheNewPath $name',
    async ({ from, to, rendered, headings, hasSectionHint }) => {
      const { view, deps, anchored } = docViewOver(() =>
        withUser(defaultLayout, asideLayout()),
      );
      view.setEntries([linkingEntry('/home/source.md', '/home/moved.md', 5)]);
      await view.open(target(null, from));
      const render = vi.spyOn(deps.markdown, 'document');

      view.retarget(target(null, to));
      await settled();

      expect({
        rendered: render.mock.calls.map(([text]) => text),
        headings: titlesOf(view, ASIDE_HEADING),
        isAsideHidden: asideOf(view).hidden,
        isSectionHintHidden: anchored['editSection'].hidden,
      }).toEqual({
        rendered: [rendered],
        headings,
        isAsideHidden: headings.length === 0,
        isSectionHintHidden: !hasSectionHint,
      });
    },
  );

  it.each<{
    name: string;
    from: DocTarget;
    to: DocTarget;
    isEditing: boolean;
    rendered: string[];
    isAsideHidden: boolean;
    watches: (string | null)[];
    fields: [string, string][];
    back: string;
    isReadRejected?: boolean;
  }>([
    {
      name: 'an editor open, to not .md',
      from: target(null),
      to: target(null, '/home/moved.json'),
      isEditing: true,
      rendered: [],
      isAsideHidden: true,
      watches: ['/home/moved.json'],
      fields: [],
      back: 'false',
    },
    {
      name: 'an editor open, to a target with a detail',
      from: target(null),
      to: { ...target(null, '/home/moved.md'), detail: hookDetail },
      isEditing: true,
      rendered: [],
      isAsideHidden: true,
      watches: ['/home/moved.md'],
      fields: [],
      back: 'true',
    },
    {
      name: 'a doc to a target with a detail shows its fields, its file let go',
      from: target(null),
      to: { ...target(null, '/home/moved.md'), detail: hookDetail },
      isEditing: false,
      rendered: [],
      isAsideHidden: true,
      watches: [null],
      fields: hookDetail.fields,
      back: 'true',
    },
    {
      name: 'a target with a detail',
      from: { ...target(null), detail: hookDetail },
      to: { ...target(null, '/home/moved.md'), detail: hookDetail },
      isEditing: false,
      rendered: [],
      isAsideHidden: true,
      watches: [],
      fields: hookDetail.fields,
      back: 'false',
    },
    {
      name: 'a detail with its editor open, to a target with a detail',
      from: { ...target(null), detail: hookDetail },
      to: { ...target(null, '/home/moved.md'), detail: hookDetail },
      isEditing: true,
      rendered: [],
      isAsideHidden: true,
      watches: [],
      fields: hookDetail.fields,
      back: 'false',
    },
    {
      name: 'a detail to a target with none reads the file',
      from: { ...target(null), detail: hookDetail },
      to: target(null, '/home/moved.md'),
      isEditing: false,
      rendered: ['# Doc'],
      isAsideHidden: false,
      watches: ['/home/moved.md'],
      fields: [],
      back: 'false',
    },
    {
      name: 'a detail to a target with none whose read rejects drops its fields',
      from: { ...target(null), detail: hookDetail },
      to: target(null, '/home/moved.md'),
      isEditing: false,
      rendered: [],
      isAsideHidden: true,
      watches: ['/home/moved.md'],
      fields: [],
      back: 'false',
      isReadRejected: true,
    },
  ])(
    'retarget_NothingToRenderFromItsText $name',
    async ({
      from,
      to,
      isEditing,
      rendered,
      isAsideHidden,
      watches,
      fields,
      back,
      isReadRejected,
    }) => {
      let drawnFields: [string, string][] = [];
      const fieldsLayout: Layout = {
        docBody(parent, input, kit) {
          drawnFields = input.fields;
          const root = kit.el(parent, 'div');
          kit.body(root);
          return { element: root };
        },
      };
      const { view, deps, editors, replies } = docViewOver(() =>
        withUser(defaultLayout, { ...asideLayout(), ...fieldsLayout }),
      );
      await view.open(from);
      if (isEditing) {
        view.edit(1);
        await settled();
      }
      const render = vi.spyOn(deps.markdown, 'document');
      const invoke = channelSpy(deps);
      if (isReadRejected === true) {
        replies.readDoc = Promise.reject(new Error('denied'));
      }

      view.retarget(to);
      await settled();

      expect({
        rendered: render.mock.calls.map(([text]) => text),
        destroys: editors.flatMap(({ destroy }) => destroy.mock.calls),
        path: view.openPath(),
        isAsideHidden: asideOf(view).hidden,
        watches: watchedPaths(invoke),
        fields: drawnFields,
        back: view.element.dataset.historyBack,
      }).toEqual({
        rendered,
        destroys: [],
        path: to.path,
        isAsideHidden,
        watches,
        fields,
        back,
      });
    },
  );

  describe('restoreEdits', () => {
    const EDITS = { path: DOC, text: '# Doc\nedited', baseText: '# Doc' };

    it('restored_edits_read_as_unsaved', async () => {
      const { view } = await sectionDoc('# Doc');

      view.restoreEdits(EDITS);

      expect(view.hasUnsavedEdits()).toBe(true);
      expect(view.edits()).toEqual(EDITS);
    });

    it.each([
      {
        name: 'disk unchanged keeps the edits',
        disk: '# Doc',
        after: EDITS.text,
      },
      { name: 'disk changed', disk: '# Disk', after: '# Disk' },
    ])(
      'restored_edits_with_changed_disk_open_the_prompt: $name',
      async ({ disk, after }) => {
        const { view, editors } = await sectionDoc(disk);
        view.restoreEdits(EDITS);

        // Reload acts only while the changed-on-disk prompt shows.
        view.conflictReload();

        expect(editors[0].text()).toBe(after);
      },
    );
  });

  describe("a detail's editor retargeted to a target with no detail", () => {
    // A detail whose `i` edits `editedPath`, its editor open, retargeted to
    // `/home/moved.md`.
    async function retargetedWhileEditing(editedPath: string) {
      const shownFields: { latest: [string, string][] } = { latest: [] };
      const fieldsLayout: Layout = {
        docBody(parent, input, kit) {
          shownFields.latest = input.fields;
          const root = kit.el(parent, 'div');
          kit.body(root);
          return { element: root };
        },
      };
      const test = docViewOver(() =>
        withUser(defaultLayout, { ...asideLayout(), ...fieldsLayout }),
      );
      const detail: DocDetail = {
        fields: [['Event', 'Stop']],
        editFile: async () => ({ path: editedPath, text: '# Held', line: 1 }),
      };
      await test.view.open({ ...target(null), detail });
      test.view.edit(1);
      await settled();
      const invoke = channelSpy(test.deps);
      test.view.retarget(target(null, '/home/moved.md'));
      await settled();
      return { ...test, invoke, shownFields };
    }

    const writtenPaths = (invoke: ReturnType<typeof channelSpy>) =>
      invoke.mock.calls
        .filter(([name]) => name === 'writeDoc')
        .map(([, path]) => path);

    it.each([
      {
        name: 'on another file, writes and watches that file',
        editedPath: '/home/hook.json',
        written: '/home/hook.json',
        watches: [],
      },
      {
        name: "on the target's own file, follows the move",
        editedPath: '/home/notes.md',
        written: '/home/moved.md',
        watches: ['/home/moved.md'],
      },
    ])(
      'retarget_DetailsEditorOpen_WriteGoesTo $name',
      async ({ editedPath, written, watches }) => {
        const { editors, invoke } = await retargetedWhileEditing(editedPath);

        editors[0].events.write();
        await settled();

        expect({
          written: writtenPaths(invoke),
          watches: watchedPaths(invoke),
          destroys: editors[0].destroy.mock.calls,
        }).toEqual({ written: [written], watches, destroys: [] });
      },
    );

    it.each([
      {
        name: 'its read answers',
        settleRead: (read: PromiseWithResolvers<string>) =>
          read.resolve('# Moved'),
        rendered: ['# Moved'],
        editedText: '# Moved',
      },
      {
        name: 'its read rejects',
        settleRead: (read: PromiseWithResolvers<string>) =>
          read.reject(new Error('denied')),
        rendered: [],
        editedText: '',
      },
    ])(
      "retarget_DetailsEditorThenCloses_ShowsAndWatchesTheTarget'sFile: $name",
      async ({ settleRead, rendered, editedText }) => {
        const { view, deps, editors, invoke, replies, shownFields } =
          await retargetedWhileEditing('/home/hook.json');
        const read = Promise.withResolvers<string>();
        replies.readDoc = read.promise;
        const render = vi.spyOn(deps.markdown, 'document');

        editors[0].events.quit(false);
        await settled();
        const fieldsWhileOut = shownFields.latest;
        settleRead(read);
        await settled();
        view.diskChanged('/home/hook.json');
        await settled();
        view.edit(1);
        await settled();

        expect({
          fieldsWhileOut,
          fields: shownFields.latest,
          reads: invoke.mock.calls
            .filter(([name]) => name === 'readDoc')
            .map(([, path]) => path),
          rendered: render.mock.calls.map(([text]) => text),
          watches: watchedPaths(invoke),
          editedText: editors[1].text(),
        }).toEqual({
          fieldsWhileOut: [],
          fields: [],
          reads: ['/home/moved.md'],
          rendered,
          watches: ['/home/moved.md'],
          editedText,
        });
      },
    );
  });

  it.each([
    {
      name: "the shown entry's new title",
      entryId: DOC,
      entries: () => [{ ...linkingEntry(DOC, OTHER_DOC, 3), title: 'New' }],
      titles: ['notes', 'New'],
    },
    {
      name: "a target no entry named, its file's entry now listed",
      entryId: null,
      entries: () => [{ ...linkingEntry(DOC, OTHER_DOC, 3), title: 'New' }],
      titles: ['notes', 'New'],
    },
    {
      name: "a target with an item's entry keeps its title, its id now on another item",
      entryId: `${DOC}#L5`,
      entries: () => [
        { ...linkingEntry(DOC, OTHER_DOC, 3), title: 'File' },
        {
          ...linkingEntry(DOC, OTHER_DOC, 3),
          id: `${DOC}#L5`,
          line: 5,
          title: 'Another item',
        },
      ],
      titles: ['notes'],
    },
    {
      name: 'the same title draws nothing',
      entryId: DOC,
      entries: () => [{ ...linkingEntry(DOC, OTHER_DOC, 3), title: 'notes' }],
      titles: ['notes'],
    },
    {
      name: 'the entry gone keeps the title',
      entryId: DOC,
      entries: () => [],
      titles: ['notes'],
    },
  ])('setEntries_ShownTitle $name', async ({ entryId, entries, titles }) => {
    const headers: DocHeaderInput[] = [];
    const header: Layout = {
      docHeader(parent, input, kit) {
        headers.push(input);
        return { element: kit.el(parent, 'div') };
      },
    };
    const chip = {
      harness: 'claude',
      text: '',
      tooltip: '',
      state: 'none',
    } as const;
    const { view } = docViewOver(
      () => withUser(defaultLayout, header),
      () => [chip],
    );
    await view.open(target(entryId));

    view.setEntries(entries());

    expect(headers.map(({ title }) => title)).toEqual(titles);
  });

  it('diskChanged_DocScrolled_KeepsBothScrollsAndShowsNewHeadings', async () => {
    installFocusFakeDom(
      (name, value) => vi.stubGlobal(name, value),
      ShrinkingScrollerFakeElement,
    );
    const { view, replies } = docViewOver(() =>
      withUser(defaultLayout, asideLayout()),
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

  it('followLink_ExternalTarget_CallsOpenExternalAndLogs', async () => {
    const url = 'https://example.invalid/page';
    const { view, deps } = docViewOver(() =>
      withUser(defaultLayout, paneLayout('pane')),
    );
    const logged: string[] = [];
    deps.log = (line) => logged.push(line);
    deps.openExternal = vi.fn(async () => undefined);
    await view.open(target(null));
    const [body] = findAll(asFake(view.element), 'docs-body');

    body.fire('click', {
      target: { closest: () => ({ dataset: { href: url } }) },
    });
    await vi.waitFor(() => {
      expect(logged).toContain(`opened link ${url}`);
    });

    expect(deps.openExternal).toHaveBeenCalledWith(url);
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

  it('open_IndexedDoc_DrawsItsChips', async () => {
    const headers: DocHeaderInput[] = [];
    const header: Layout = {
      docHeader(parent, input, kit) {
        headers.push(input);
        return { element: kit.el(parent, 'div') };
      },
    };
    const drawn: HarnessChip[] = [
      { harness: 'b', text: 'Bee launch', tooltip: 'r', state: 'launch' },
      { harness: 'claude', text: 'Claude Code —', tooltip: '', state: 'none' },
    ];
    const { view } = docViewOver(
      () => withUser(defaultLayout, header),
      () => drawn,
    );

    await view.open(target('e'));

    expect(headers.map(({ chips }) => chips)).toEqual([drawn]);
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
    {
      name: 'a page',
      late: ({ view }) => {
        view.showPage(list(['a']));
      },
    },
    {
      name: 'a list update',
      inFlight: ({ view }) => {
        view.showPage(list(['a']));
      },
      late: ({ view }) => view.updateList(listOf(['b'])),
    },
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

    it.each([
      { name: "the open section's row", row: 1 },
      { name: "a nested heading's row", row: 2 },
    ])(
      'clickOnThisPage_HiddenSection_LandsOnTheEditor $name',
      async ({ row }) => {
        const { view } = await openSection('# T\n\n## A\n### N\n\n## B\ny');
        const pane = scroller(view.element);
        pane.scrollTop = 50;
        const frame = findAll(asFake(view.element), 'docs-editor-frame')[0];
        (frame as ScrollerFakeElement).rectTop = 30;

        findAll(asFake(view.element), 'ui-row')[row].click();

        expect(pane.scrollTop).toBe(80);
      },
    );

    it.each([
      {
        name: 'the banner, by a change on disk',
        act: async ({ view, replies }: OpenSection) => {
          replies.readDoc = 'other';
          view.diskChanged(DOC);
          await settled();
        },
      },
      {
        name: 'the prompt, by a :w conflict',
        act: (shown: OpenSection) => hitConflict(shown, 'other'),
      },
    ])('notice_AboveASectionEditor_ScrollsToIt $name', async ({ act }) => {
      const noticeAt = (parent: HTMLElement, kit: DocsKit) => {
        const notice = kit.el(parent, 'div');
        (asFake(notice) as ScrollerFakeElement).rectTop = -30;
        return { element: notice };
      };
      const shown = await openSection(TWO_SECTIONS, 3, () =>
        withUser<Layout>(defaultLayout, {
          diskBanner: (parent, _input, kit) => noticeAt(parent, kit),
          conflictPrompt: (parent, _input, kit) => noticeAt(parent, kit),
        }),
      );

      await act(shown);

      expect(scroller(shown.view.element).scrollTop).toBe(
        SCROLL_BEFORE_OPEN - 30,
      );
    });

    it.each([
      { open: 'edit', lines: ['editing notes.md'] },
      { open: 'editSection', lines: ['editing section A in notes.md'] },
    ] as const)('editing_LogsOneLine $open', async ({ open, lines }) => {
      const { view, deps } = await sectionDoc(TWO_SECTIONS);
      const log = vi.spyOn(deps, 'log');
      scroller(view.element).scrollTop = 100;
      addBlocks(view, block(3, 0));

      view[open]();

      expect(
        log.mock.calls
          .map(([line]) => line)
          .filter((line) => line.startsWith('editing')),
      ).toEqual(lines);
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

  describe('section links', () => {
    it.each([
      { docLine: '12', line: 12 },
      { docLine: undefined, line: null },
    ])(
      'linkClick_DataDocPath_FollowsItsPathAndLine $docLine',
      async ({ docLine, line }) => {
        const { view, deps } = await sectionDoc(TWO_SECTIONS);
        const followFile = vi.spyOn(deps, 'followFile');

        clickLink(view, {
          docPath: OTHER_DOC,
          ...(docLine === undefined ? {} : { docLine }),
        });

        expect(followFile.mock.calls).toEqual([[OTHER_DOC, line, null]]);
      },
    );

    it('linkClick_SamePathLink_ScrollsAndReadsNothing', async () => {
      const { view, deps, editors } = await pinnedSectionEditor();
      const invoke = vi.spyOn(deps.channel, 'invoke');

      clickLink(view, { docPath: DOC, docLine: '7' });
      await settled();

      expect({
        reads: invoke.mock.calls.filter(([name]) => name === 'readDoc').length,
        scrollTop: scroller(view.element).scrollTop,
        destroys: editors[0].destroy.mock.calls.length,
      }).toEqual({ reads: 0, scrollTop: 210, destroys: 0 });
    });

    it.each([
      {
        name: "the file's entry",
        entries: () => [sectionLinkEntry()],
      },
      {
        name: "a follow-up item's entry ahead of its file's",
        entries: () => [
          { ...sectionLinkEntry(), id: `${DOC}#L5`, line: 5, links: [] },
          sectionLinkEntry(),
        ],
      },
    ])(
      'setEntries_LinksChanged_RendersTheBodyAgainKeepingScroll $name',
      async ({ entries }) => {
        installFocusFakeDom(
          (name, value) => vi.stubGlobal(name, value),
          ShrinkingScrollerFakeElement,
        );
        const { view, deps } = await sectionDoc(TWO_SECTIONS);
        const pane = scroller(view.element);
        const render = vi.spyOn(deps.markdown, 'document');

        view.setEntries(entries());
        // The scroll as the render answers, which the new body must keep.
        pane.scrollTop = 120;
        await settled();

        expect({
          renders: render.mock.calls.length,
          scrollTop: pane.scrollTop,
        }).toEqual({ renders: 1, scrollTop: 120 });
      },
    );

    it.each([
      {
        name: 'the same links',
        next: () => [sectionLinkEntry()],
        isEditing: false,
      },
      {
        name: 'only a markdown link changed',
        next: () => [
          {
            ...sectionLinkEntry(),
            links: [
              ...sectionLinkEntry().links,
              ...linkingEntry(DOC, OTHER_DOC, 3).links,
            ],
          },
        ],
        isEditing: false,
      },
      {
        name: 'new links with an editor open',
        next: () => [sectionLinkEntry(9)],
        isEditing: true,
      },
    ])(
      'setEntries_LinksSame_RendersNothing $name',
      async ({ next, isEditing }) => {
        const { view, deps } = docViewOver(() =>
          withUser(defaultLayout, paneLayout('pane')),
        );
        view.setEntries([sectionLinkEntry()]);
        await view.open(target(null));
        if (isEditing) {
          view.edit(1);
        }
        const render = vi.spyOn(deps.markdown, 'document');

        view.setEntries(next());
        await settled();

        expect(render.mock.calls.length).toBe(0);
      },
    );
  });

  describe('history', () => {
    it('history_BackAndForward_ReturnToTheReadPlace', async () => {
      const { view, followPlace } = await readThenLeft();

      view.historyBack();
      const back = followPlace.mock.calls.at(-1);
      await view.open(target(null, DOC), { isHistoryMove: true });
      view.historyForward();

      expect([back, followPlace.mock.calls.at(-1)]).toEqual([
        [DOC, 5],
        [OTHER_DOC, null],
      ]);
    });

    it('history_HistoryMove_PushesNothing', async () => {
      const { view, followPlace } = await readThenLeft();
      view.historyBack();
      await view.open(target(null, DOC), { isHistoryMove: true });
      const pane = scroller(view.element);
      pane.scrollTop = 77;

      view.historyBack();

      expect({
        followed: followPlace.mock.calls.length,
        scrollTop: pane.scrollTop,
      }).toEqual({ followed: 1, scrollTop: 0 });
    });

    it('history_SameFilePlace_ScrollsWithNoFollowPlace', async () => {
      const shown = await sectionDoc(TWO_SECTIONS);
      const { view, deps } = shown;
      const followPlace = vi.spyOn(deps, 'followPlace');
      const pane = scroller(view.element);
      pinBlocks(view);
      pane.scrollTop = 100;
      clickLink(view, { docPath: DOC, docLine: '7' });
      const atLink = pane.scrollTop;

      view.historyBack();

      expect({
        atLink,
        scrollTop: pane.scrollTop,
        followed: followPlace.mock.calls.length,
      }).toEqual({ atLink: 210, scrollTop: 100, followed: 0 });
    });

    it('history_UnsavedEdits_RefusesAndKeepsTheCursor', async () => {
      const { view, followPlace, editors, toasts } = await readThenLeft();
      view.edit(1);
      editors[0].change('changed');

      view.historyBack();
      const refused = {
        toasts: [...toasts],
        followed: followPlace.mock.calls.length,
      };
      editors[0].events.write();
      await settled();
      view.historyBack();

      expect(refused).toEqual({ toasts: [UNSAVED_TEXT], followed: 0 });
      expect(followPlace.mock.calls).toEqual([[DOC, 5]]);
    });

    it.each([
      { name: 'same path', isSamePath: true },
      { name: 'other path', isSamePath: false },
    ])('history_CleanEditor_ClosesItAndMoves $name', async ({ isSamePath }) => {
      const shown = await sectionDoc(TWO_SECTIONS);
      const { view, deps, editors } = shown;
      vi.spyOn(deps, 'followPlace').mockImplementation((path, line) => {
        void view.open(
          { ...target(null, path), line },
          { isHistoryMove: true },
        );
      });
      pinBlocks(view);
      if (isSamePath) {
        clickLink(view, { docPath: DOC, docLine: '7' });
      } else {
        await view.open(target(null, OTHER_DOC));
      }
      view.edit(1);

      view.historyBack();
      await settled();

      expect({
        destroys: editors[0].destroy.mock.calls.length,
        path: view.openPath(),
        scrollTop: scroller(view.element).scrollTop,
      }).toEqual({ destroys: 1, path: DOC, scrollTop: 0 });
    });

    it.each([
      { opens: [DOC], backs: 0, back: 'false', forward: 'false' },
      { opens: [DOC, OTHER_DOC], backs: 0, back: 'true', forward: 'false' },
      { opens: [DOC, OTHER_DOC], backs: 1, back: 'false', forward: 'true' },
    ])(
      'history_Edges_HideAtTheEnds $opens $backs',
      async ({ opens, backs, back, forward }) => {
        const { view } = docViewOver(() =>
          withUser(defaultLayout, paneLayout('pane')),
        );
        for (const path of opens) {
          await view.open(target(null, path));
        }

        for (let press = 0; press < backs; press++) {
          view.historyBack();
        }

        expect({
          back: view.element.dataset.historyBack,
          forward: view.element.dataset.historyForward,
        }).toEqual({ back, forward });
      },
    );

    it('moveWithinDoc_SectionEditorOpen_RecordsTheVisibleLine', async () => {
      const { view } = await pinnedSectionEditor();
      clickLink(view, { docPath: DOC, docLine: '7' });

      view.historyBack();
      await settled();

      // Line 1's block: the section's own blocks at the top of sight are hidden.
      expect(scroller(view.element).scrollTop).toBe(0);
    });

    it('moveWithinDoc_MissingHeading_RecordsNothing', async () => {
      vi.stubGlobal('CSS', { escape: (text: string) => text });
      const { view, followPlace, toasts } = await readThenLeft();
      pinBlocks(view);
      scroller(view.element).scrollTop = 100;

      clickLink(view, { href: '#gone' });
      view.historyBack();

      expect({ toasts, followed: followPlace.mock.calls }).toEqual({
        toasts: ['No heading #gone in this doc'],
        followed: [[DOC, 5]],
      });
    });

    it('open_Fragment_RecordsTheHeadingsWholeFileLine', async () => {
      vi.stubGlobal('CSS', { escape: (text: string) => text });
      const shown = docViewOver(() =>
        withUser(defaultLayout, paneLayout('pane')),
      );
      const { view, deps, replies } = shown;
      const followPlace = vi.spyOn(deps, 'followPlace');
      replies.readDoc = '---\nname: a\n---\nbody';
      const pane = scroller(view.element);
      const landed = heading(3, 'x');
      Object.defineProperty(landed, 'rectTop', {
        get: () => 200 - pane.scrollTop,
      });
      const body = findAll(asFake(view.element), 'docs-body')[0];
      body.querySelector = () => landed;
      body.querySelectorAll = () => [landed];
      await view.open({ ...target(null), fragment: 'x' });
      await view.open(target(null, OTHER_DOC));

      view.historyBack();

      expect(followPlace.mock.calls).toEqual([[DOC, 6]]);
    });

    it('moveWithinDoc_DidNotScroll_RecordsOnePlace', async () => {
      const { view } = await sectionDoc(TWO_SECTIONS);
      const pane = scroller(view.element);
      pinBlocks(view);
      pane.scrollTop = 110;

      // Line 5 has no block, so the move lands on line 4's, where the pane is.
      clickLink(view, { docPath: DOC, docLine: '5' });
      view.historyBack();

      expect(pane.scrollTop).toBe(0);
    });

    it('clickOnThisPage_ThenBack_ReturnsToTheReadPlace', async () => {
      const { view } = await sectionDoc(TWO_SECTIONS);
      const pane = scroller(view.element);
      pinBlocks(view);
      pane.scrollTop = 100;

      findAll(asFake(view.element), 'ui-row')[2].click();
      const atRow = pane.scrollTop;
      view.historyBack();

      expect({ atRow, scrollTop: pane.scrollTop }).toEqual({
        atRow: 200,
        scrollTop: 100,
      });
    });

    it.each([{ press: 'historyBack' }, { press: 'historyForward' }] as const)(
      'history_AtTheEnds_MovesNothing $press',
      async ({ press }) => {
        const { view, deps } = await sectionDoc(TWO_SECTIONS);
        const followPlace = vi.spyOn(deps, 'followPlace');
        const pane = scroller(view.element);
        pane.scrollTop = 77;

        view[press]();

        expect({
          followed: followPlace.mock.calls.length,
          scrollTop: pane.scrollTop,
        }).toEqual({ followed: 0, scrollTop: 77 });
      },
    );

    it.each([
      { name: 'a read that rejects', isRefused: false },
      { name: 'a refusal over unsaved edits', isRefused: true },
    ])('open_RefusedOrFailed_RecordsNoPlace $name', async ({ isRefused }) => {
      const { view, deps, editors } = await sectionDoc(TWO_SECTIONS);
      pinBlocks(view);
      scroller(view.element).scrollTop = 100;
      if (isRefused) {
        view.edit(1);
        editors[0].change('changed');
      } else {
        deps.channel.invoke = async () => {
          throw new Error('gone');
        };
      }

      const opened = await view.open(target(null, OTHER_DOC));

      expect({ opened, back: view.element.dataset.historyBack }).toEqual({
        opened: false,
        back: 'false',
      });
    });
  });

  describe('pages', () => {
    // A doc view whose list rows and Recent changes draw through a user layout
    // that records their inputs.
    function pageView(extra: Layout = {}) {
      const rows: ListRowInput[] = [];
      const recents: RecentChangesInput[] = [];
      let shown = withUser<Layout>(defaultLayout, {
        listRow(parent, input, kit) {
          rows.push(input);
          return { element: kit.el(parent, 'li', LIST_ROW, input.title) };
        },
        recentChanges(parent, input, kit) {
          recents.push(input);
          const root = kit.el(parent, 'div', RECENT);
          for (const row of input.rows) {
            for (const page of row.pages) {
              kit.pageLink(root, page.title, page.path);
            }
          }
          return { element: root };
        },
        ...extra,
      });
      const over = docViewOver(() => shown);
      const followPlace = vi.fn();
      over.deps.followPlace = followPlace;
      return {
        ...over,
        rows,
        recents,
        followPlace,
        setLayout: (layout: Layout) => {
          shown = withUser(defaultLayout, layout);
        },
      };
    }

    const onlyIn = (view: DocView, className: string) =>
      findAll(asFake(view.element), className)[0];

    const selectedRows = (view: DocView) =>
      findAll(asFake(view.element), LIST_ROW)
        .filter((row) => row.classList.contains('is-selected'))
        .map((row) => row.textContent);

    it('showPage_List_DrawsInTheArticleAndEmptiesTheDoc', async () => {
      const { view, deps } = pageView();
      await view.open(target(null));
      const openChanged = vi.fn();
      deps.openChanged = openChanged;

      const isShown = view.showPage(list(['a']));

      expect({
        isShown,
        path: view.openPath(),
        state: view.element.dataset.doc,
        openChanged: openChanged.mock.calls,
        isAsideHidden: asideOf(view).hidden,
        pagesInArticle: findAll(onlyIn(view, 'docs-article'), 'docs-list-page')
          .length,
      }).toEqual({
        isShown: true,
        path: null,
        state: 'page',
        openChanged: [[null]],
        isAsideHidden: true,
        pagesInArticle: 1,
      });
    });

    it('showPage_UnsavedEdits_Refuses', async () => {
      const { view, editors, toasts } = pageView();
      await view.open(target(null));
      view.edit(1);
      editors[0].change('changed');

      const isShown = view.showPage(list(['a']));

      expect({ isShown, toasts, path: view.openPath() }).toEqual({
        isShown: false,
        toasts: [UNSAVED_TEXT],
        path: DOC,
      });
    });

    it('open_FromAListPage_DropsThePage', async () => {
      const { view } = pageView();
      view.showPage(list(['a']));

      await view.open(target(null));

      expect({
        page: view.shownPage(),
        slotChildren: onlyIn(view, 'docs-page-slot').children.length,
      }).toEqual({ page: null, slotChildren: 0 });
    });

    it.each<{
      name: string;
      act(view: DocView): Promise<unknown> | void;
      expected: boolean;
    }>([
      { name: 'a new view', act: () => undefined, expected: false },
      {
        name: 'an open in flight',
        act: (view) => {
          void view.open(target(null));
        },
        expected: true,
      },
      {
        name: 'a doc shown',
        act: (view) => view.open(target(null)),
        expected: true,
      },
      {
        name: 'a page shown',
        act: (view) => {
          view.showPage(list(['a']));
        },
        expected: true,
      },
    ])('opensAsked rose: $name', async ({ act, expected }) => {
      const { view } = pageView();

      await act(view);

      expect(view.opensAsked() > 0).toBe(expected);
    });

    it('history_ListPlace_ReachesFollowPlace', async () => {
      const { view, followPlace } = pageView();
      view.showPage(list(['a']));
      await view.open(target(null, OTHER_DOC));

      view.historyBack();
      const back = followPlace.mock.calls.at(-1);
      view.showPage(list(['a']), { isHistoryMove: true });
      view.historyForward();

      expect([back, followPlace.mock.calls.at(-1)]).toEqual([
        [PLACE, null],
        [OTHER_DOC, null],
      ]);
    });

    it.each<{ name: string; show(view: DocView): Promise<unknown> | boolean }>([
      {
        name: 'the empty Main page',
        show: (view) => view.showPage({ type: 'mainEmpty', path: '~/Main.md' }),
      },
      {
        name: 'a detail',
        show: (view) =>
          view.open({ ...target(null, '/home/hook.md'), detail: hookDetail }),
      },
    ])('history_IsNoPlace $name', async ({ show }) => {
      const { view, followPlace } = pageView();
      await view.open(target(null, DOC));
      await show(view);
      await view.open(target(null, OTHER_DOC));

      view.historyBack();

      expect(followPlace.mock.calls).toEqual([[DOC, null]]);
    });

    const NO_PLACE_SHOWS: {
      name: string;
      show(view: DocView): Promise<unknown> | boolean;
    }[] = [
      {
        name: 'the empty Main page',
        show: (view) => view.showPage({ type: 'mainEmpty', path: '~/Main.md' }),
      },
      {
        name: 'a detail',
        show: (view) =>
          view.open({ ...target(null, '/home/hook.md'), detail: hookDetail }),
      },
    ];

    describe.each(NO_PLACE_SHOWS)('from $name', ({ show }) => {
      it.each<{
        given: string;
        places: string[];
        presses: ('historyBack' | 'historyForward')[];
        followed: [string, null][];
        said: string[];
        canBack: string;
      }>([
        {
          given: 'back lands on the current place, then moves on',
          places: [DOC, OTHER_DOC],
          presses: ['historyBack', 'historyBack'],
          followed: [
            [OTHER_DOC, null],
            [DOC, null],
          ],
          said: [],
          canBack: 'false',
        },
        {
          given: 'back lands on the only place',
          places: [DOC],
          presses: ['historyBack'],
          followed: [[DOC, null]],
          said: [],
          canBack: 'false',
        },
        {
          given: 'back with no place stays',
          places: [],
          presses: ['historyBack'],
          followed: [],
          said: ['no earlier place'],
          canBack: 'false',
        },
        {
          given: 'forward with no later place stays, and back can return',
          places: [DOC],
          presses: ['historyForward'],
          followed: [],
          said: ['no later place'],
          canBack: 'true',
        },
      ])(
        'history_NoPlaceShown $given',
        async ({ places, presses, followed, said, canBack }) => {
          const { view, deps, followPlace } = pageView();
          const logs: string[] = [];
          deps.log = (line) => logs.push(line);
          followPlace.mockImplementation((path: string) => {
            void view.open(target(null, path), { isHistoryMove: true });
          });
          for (const path of places) {
            await view.open(target(null, path));
          }
          await show(view);

          for (const press of presses) {
            view[press]();
            await settled();
          }

          expect({
            followed: followPlace.mock.calls,
            said: logs.filter((line) =>
              /^no (earlier|later) place$/.test(line),
            ),
            canBack: view.element.dataset.historyBack,
          }).toEqual({ followed, said, canBack });
        },
      );
    });

    it('history_ForwardFromADetail_MovesAsUsual', async () => {
      const { view, followPlace } = pageView();
      followPlace.mockImplementation((path) => {
        void view.open(target(null, path), { isHistoryMove: true });
      });
      await view.open(target(null, DOC));
      await view.open(target(null, OTHER_DOC));
      view.historyBack();
      await settled();
      await view.open({ ...target(null, '/home/hook.md'), detail: hookDetail });

      view.historyForward();
      await settled();

      expect(followPlace.mock.calls).toEqual([
        [DOC, null],
        [OTHER_DOC, null],
      ]);
    });

    it('history_ReturnToAPlaceThatFails_TheNextBackMovesPastIt', async () => {
      const { view, followPlace } = pageView();
      await view.open(target(null, DOC));
      await view.open(target(null, OTHER_DOC));
      await view.open({ ...target(null, '/home/hook.md'), detail: hookDetail });

      view.historyBack();
      view.historyBack();

      expect(followPlace.mock.calls).toEqual([
        [OTHER_DOC, null],
        [DOC, null],
      ]);
    });

    it('history_DetailOnThePlacesOwnPath_ReopensThePlace', async () => {
      const { view, followPlace } = pageView();
      await view.open(target(null, DOC));
      await view.open({ ...target(null, DOC), detail: hookDetail });

      view.historyBack();

      expect(followPlace.mock.calls).toEqual([[DOC, null]]);
    });

    it.each([
      {
        state: 'doc, to the end',
        edge: 'end' as const,
        setUp: async (view: DocView) => view.open(target(null)),
        expected: {
          scrollTop: 900,
          cursor: [],
          logs: ['scrolled notes.md to the end'],
        },
      },
      {
        state: 'doc, to the top',
        edge: 'top' as const,
        setUp: async (view: DocView) => view.open(target(null)),
        expected: {
          scrollTop: 0,
          cursor: [],
          logs: ['scrolled notes.md to the top'],
        },
      },
      {
        state: 'list page',
        edge: 'end' as const,
        setUp: async (view: DocView) => view.showPage(list(['a', 'b', 'c'])),
        expected: { scrollTop: 40, cursor: ['c'], logs: [] },
      },
      {
        state: 'editor open',
        edge: 'end' as const,
        setUp: async (view: DocView) => {
          await view.open(target(null));
          view.edit(1);
        },
        expected: {
          scrollTop: 40,
          cursor: [],
          logs: ['notes.md did not scroll: the editor is open'],
        },
      },
    ])('scrollToEdge_$state', async ({ edge, setUp, expected }) => {
      const { view, deps } = pageView();
      const logs: string[] = [];
      deps.log = (line) => logs.push(line);
      await setUp(view);
      const pane = scroller(view.element);
      Object.assign(pane, { scrollHeight: 900 });
      pane.scrollTop = 40;
      logs.length = 0;

      view.scrollToEdge(edge);

      expect({
        scrollTop: pane.scrollTop,
        cursor: selectedRows(view),
        logs,
      }).toEqual(expected);
    });

    it('scroll_ListShown_MovesTheCursorAndNotThePane', () => {
      const { view } = pageView();
      view.showPage(list(['a', 'b']));
      const pane = scroller(view.element);
      pane.scrollTop = 40;

      view.scroll(1);

      expect({ scrollTop: pane.scrollTop, cursor: selectedRows(view) }).toEqual(
        { scrollTop: 40, cursor: ['b'] },
      );
    });

    describe('listOpen', () => {
      // A doc view on a doc, its pane's document readable, and `focused`'s
      // element built by `place` taking focus, its clicks counted.
      async function focusedIn(
        place: (
          body: FakeElement,
        ) => { focused: ScrollerFakeElement; clicked: FakeElement } | null,
      ) {
        const shown = pageView();
        const openListEntry = vi.fn();
        shown.deps.openListEntry = openListEntry;
        await shown.view.open(target(null));
        Object.assign(scroller(shown.view.element), {
          ownerDocument: document,
        });
        const placed = place(onlyIn(shown.view, 'docs-body'));
        placed?.focused.focus();
        const clicks = vi.fn();
        placed?.clicked.addEventListener('click', clicks);
        return { ...shown, openListEntry, clicks };
      }

      const make = (tag: string) =>
        document.createElement(tag) as unknown as ScrollerFakeElement;

      it('listOpen_ListShown_OpensTheCursor', () => {
        const { view, deps } = pageView();
        const openListEntry = vi.fn();
        deps.openListEntry = openListEntry;
        view.showPage(list(['a', 'b']));
        view.scroll(1);

        view.listOpen();

        expect(openListEntry.mock.calls).toEqual([['b']]);
      });

      it.each<{
        name: string;
        place(body: FakeElement): {
          focused: ScrollerFakeElement;
          clicked: FakeElement;
        } | null;
        clicks: number;
      }>([
        {
          name: 'a link in the pane',
          place: (body) => {
            const link = make('a');
            body.append(link);
            return { focused: link, clicked: link };
          },
          clicks: 1,
        },
        {
          name: 'a span inside a button',
          place: (body) => {
            const button = make('button');
            const span = make('span');
            button.append(span);
            body.append(button);
            return { focused: span, clicked: button };
          },
          clicks: 1,
        },
        {
          name: 'a plain div in the pane',
          place: (body) => {
            const div = make('div');
            body.append(div);
            return { focused: div, clicked: div };
          },
          clicks: 0,
        },
        {
          name: 'a link outside the pane',
          place: () => {
            const link = make('a');
            return { focused: link, clicked: link };
          },
          clicks: 0,
        },
        { name: 'nothing focused', place: () => null, clicks: 0 },
      ])('listOpen_DocShown $name', async ({ place, clicks }) => {
        const shown = await focusedIn(place);

        shown.view.listOpen();

        expect({
          clicks: shown.clicks.mock.calls.length,
          opened: shown.openListEntry.mock.calls,
        }).toEqual({ clicks, opened: [] });
      });
    });

    it('updateList_ListShown_KeepsScrollAndHistory', async () => {
      const { view, followPlace } = pageView();
      view.showPage(list(['a']));
      const pane = scroller(view.element);
      pane.scrollTop = 80;

      view.updateList(listOf(['a', 'b']));
      const afterUpdate = {
        scrollTop: pane.scrollTop,
        rows: titlesOf(view, LIST_ROW),
      };
      await view.open(target(null, OTHER_DOC));
      view.historyBack();

      expect({
        afterUpdate,
        followed: followPlace.mock.calls,
        canBack: view.element.dataset.historyBack,
      }).toEqual({
        afterUpdate: { scrollTop: 80, rows: ['a', 'b'] },
        followed: [[PLACE, null]],
        canBack: 'false',
      });
    });

    it('edit_MainEmpty_CallsCreateMain', () => {
      const { view, deps, editors } = pageView();
      const createMain = vi.fn();
      deps.createMain = createMain;
      view.showPage({ type: 'mainEmpty', path: '~/Main.md' });

      view.edit();

      expect({
        created: createMain.mock.calls.length,
        editors: editors.length,
      }).toEqual({ created: 1, editors: 0 });
    });

    it('mainEmpty_LeavesOutTheHint_AppendsIt', () => {
      const { view } = pageView({
        mainEmpty(parent, input, kit) {
          return { element: kit.el(parent, 'div', 'test-main', input.path) };
        },
      });

      view.showPage({ type: 'mainEmpty', path: '~/Main.md' });

      expect(findAll(onlyIn(view, 'test-main'), 'docs-main-hint').length).toBe(
        1,
      );
    });

    it.each([
      { input: { rows: [] }, parts: 1 },
      { input: null, parts: 0 },
    ])('setRecentChanges $parts', ({ input, parts }) => {
      const { view } = pageView();
      view.setRecentChanges({ rows: [] });

      view.setRecentChanges(input);

      const article = onlyIn(view, 'docs-article');
      const bodyIndex = article.children.findIndex(
        (child) => findAll(child, 'docs-body').length > 0,
      );
      expect({
        parts: onlyIn(view, 'docs-recent-slot').children.length,
        isUnderTheBody:
          article.children[bodyIndex + 1].classList.contains(
            'docs-recent-slot',
          ),
      }).toEqual({ parts, isUnderTheBody: true });
    });

    // Recent changes draws under the Main page's body, so a doc is open. A
    // page naming the shown doc opens it again rather than scrolling in it.
    it.each([
      { name: 'another doc', path: '/home/one.md' },
      { name: 'the shown doc', path: '/home/notes.md' },
    ])(
      'pageLink_Click_RunsOpenRecentPageWhichFollowsTheFile $name',
      async ({ path }) => {
        const { view, deps, clicks } = pageView();
        const followFile = vi.fn();
        deps.followFile = followFile;
        await view.open(target(null));
        view.setRecentChanges({
          rows: [
            {
              sha: 'abc',
              subject: 'subject',
              time: { text: '3h', title: 'then' },
              pages: [{ title: 'One', path }],
            },
          ],
        });

        onlyIn(view, 'docs-recent-page').click();

        expect({ clicks, followed: followFile.mock.calls }).toEqual({
          clicks: [['openRecentPage', path]],
          followed: [[path, null, null]],
        });
      },
    );

    // `followLink` as `docs.followLink`'s handler reaches it, with no click.
    it.each<{
      name: string;
      link: Partial<DocLink>;
      opened: unknown[];
      followed: unknown[];
      toasts: string[];
    }>([
      {
        name: 'external',
        link: { href: 'https://example.invalid/x' },
        opened: [['https://example.invalid/x']],
        followed: [],
        toasts: [],
      },
      {
        name: 'missing heading',
        link: { href: '#gone' },
        opened: [],
        followed: [],
        toasts: ['No heading #gone in this doc'],
      },
      {
        name: 'file',
        link: { href: 'other.md' },
        opened: [],
        followed: [['/home/other.md', null, null]],
        toasts: [],
      },
      {
        name: 'unsupported',
        link: { href: 'wiki:kind/skill', title: 'Skills' },
        opened: [],
        followed: [],
        toasts: ['This link does not open here: wiki:kind/skill'],
      },
    ])(
      'followLink_ByLinkKind_ActsAsTheLinkMeans $name',
      async ({ link, opened, followed, toasts }) => {
        vi.stubGlobal('CSS', { escape: (text: string) => text });
        const shown = pageView();
        const openExternal = vi.fn(async () => undefined);
        const followFile = vi.fn();
        Object.assign(shown.deps, { openExternal, followFile });
        await shown.view.open(target(null));

        shown.view.followLink({ href: '', title: '', ...link });

        expect({
          opened: openExternal.mock.calls,
          followed: followFile.mock.calls,
          toasts: shown.toasts,
        }).toEqual({ opened, followed, toasts });
      },
    );

    // `openDocAt` as `docs.openDocAt`'s handler reaches it, with no click.
    it.each([
      { name: 'a line', line: 4, followed: [['/home/other.md', 4, null]] },
      { name: 'its top', line: 0, followed: [['/home/other.md', null, null]] },
    ])(
      'openDocAt_OtherDoc_FollowsItsFile $name',
      async ({ line, followed }) => {
        const shown = pageView();
        const followFile = vi.fn();
        shown.deps.followFile = followFile;
        await shown.view.open(target(null));

        shown.view.openDocAt({ path: '/home/other.md', line });

        expect(followFile.mock.calls).toEqual(followed);
      },
    );

    it.each<{ name: string; isOpen: boolean; line: number; log: string }>([
      {
        name: 'no doc open',
        isOpen: false,
        line: 4,
        log: 'no doc open for link /home/other.md',
      },
      {
        name: 'a line that is no whole number',
        isOpen: true,
        line: 2.5,
        log: 'no line 2.5 for link /home/other.md',
      },
    ])(
      'openDocAt_NoDocOrBadLine_LogsAndFollowsNothing $name',
      async ({ isOpen, line, log }) => {
        const shown = pageView();
        const logs: string[] = [];
        const followFile = vi.fn();
        Object.assign(shown.deps, {
          followFile,
          log: (line: string) => logs.push(line),
        });
        if (isOpen) {
          await shown.view.open(target(null));
          logs.length = 0;
        }

        shown.view.openDocAt({ path: OTHER_DOC, line });

        expect({ logs, followed: followFile.mock.calls }).toEqual({
          logs: [log],
          followed: [],
        });
      },
    );

    it('linkClick_OutsideALink_CallsNothing', async () => {
      const { view, clicks } = pageView();
      await view.open(target(null));

      findAll(asFake(view.element), 'docs-body')[0].fire('click', {
        target: { closest: () => null },
      });

      expect(clicks).toEqual([]);
    });

    it('linkClick_SectionLink_RunsOpenDocAtWithItsPlace', async () => {
      const { view, clicks } = pageView();
      await view.open(target(null));

      findAll(asFake(view.element), 'docs-body')[0].fire('click', {
        target: {
          closest: () => ({
            dataset: { docPath: OTHER_DOC, docLine: '9' },
            textContent: 'Other',
          }),
        },
      });

      expect(clicks).toEqual([['openDocAt', { path: OTHER_DOC, line: 9 }]]);
    });

    it('mainOfferClick_RunsCreateMain', () => {
      const { view, deps, clicks } = pageView();
      const createMain = vi.fn();
      deps.createMain = createMain;
      view.showPage({ type: 'mainEmpty', path: '~/Main.md' });

      findAll(asFake(view.element), 'docs-main-hint')[0].click();

      expect({ clicks, created: createMain.mock.calls.length }).toEqual({
        clicks: [['createMain']],
        created: 1,
      });
    });

    it('openListRow_NoShownRow_LogsAndOpensNothing', () => {
      const { view, deps } = pageView();
      const logs: string[] = [];
      const openListEntry = vi.fn();
      Object.assign(deps, {
        openListEntry,
        log: (line: string) => logs.push(line),
      });
      view.showPage(list(['a', 'b']));

      view.openListRow('gone');

      expect({ logs, opened: openListEntry.mock.calls }).toEqual({
        logs: ['no list row gone'],
        opened: [],
      });
    });

    it.each([
      { acts: true, toasts: [] },
      {
        acts: false,
        toasts: ['This link does not open here: wiki:kind/skill'],
      },
    ])('followLink_WikiHref $acts', async ({ acts, toasts }) => {
      const shown = pageView();
      const followWikiLink = vi.fn(() => acts);
      shown.deps.followWikiLink = followWikiLink;
      await shown.view.open(target(null));

      onlyIn(shown.view, 'docs-body').fire('click', {
        target: {
          closest: () => ({
            dataset: { href: 'wiki:kind/skill' },
            textContent: 'All skills',
          }),
        },
      });

      expect({
        heard: followWikiLink.mock.calls,
        toasts: shown.toasts,
      }).toEqual({ heard: [['wiki:kind/skill', 'All skills']], toasts });
    });

    it('redraw_ListShown_DrawsThePageAgain', () => {
      const { view, setLayout } = pageView();
      view.showPage(list(['a', 'b']));
      view.scroll(1);

      setLayout({
        listRow(parent, input, kit) {
          return { element: kit.el(parent, 'li', 'row-2', input.title) };
        },
      });
      view.redraw();

      expect(
        findAll(asFake(view.element), 'row-2')
          .filter((row) => row.classList.contains('is-selected'))
          .map((row) => row.textContent),
      ).toEqual(['b']);
    });
  });
});

const LIST_ROW = 'test-list-row';
const RECENT = 'test-recent';
const PLACE = 'wiki:kind/skill';

// A list page at `PLACE` with one group, each title also its entry id.
function listOf(titles: string[]): ListPageContent {
  return {
    place: PLACE,
    input: {
      title: 'Skills',
      count: titles.length,
      groups: [
        {
          title: 'Global',
          rows: titles.map((title) => ({
            title,
            path: `~/${title}`,
            time: null,
          })),
        },
      ],
    },
    entryIds: [titles],
  };
}

function list(titles: string[]) {
  return { type: 'list', content: listOf(titles) } as const;
}

// The path `target(null)` opens, and another doc's.
const DOC = '/home/notes.md';
const OTHER_DOC = '/home/other.md';

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
async function openSection(
  text: string,
  line = 3,
  layouts?: () => ShownLayouts<Layout>,
) {
  const shown = await sectionDoc(text, target(null), layouts);
  scroller(shown.view.element).scrollTop = SCROLL_BEFORE_OPEN;
  const lines = [1, 3, 4, 6, 7];
  const blocks = lines.map((sourceLine) =>
    block(sourceLine, sourceLine - line),
  );
  addBlocks(shown.view, ...blocks);
  shown.view.editSection();
  return { ...shown, blocks };
}

type OpenSection = Awaited<ReturnType<typeof openSection>>;

// Runs `:w` in the first editor against a disk that holds `diskText`.
async function hitConflict(
  { editors, replies }: OpenSection,
  diskText: string,
) {
  replies.writeDoc = { type: 'changedOnDisk', diskText };
  editors[0].change('## A\nchanged\n');
  editors[0].events.write();
  await settled();
}

// `body`'s click listener hearing a click inside an `a.md-link` holding `dataset`.
function clickLink(view: DocView, dataset: Record<string, string>) {
  findAll(asFake(view.element), 'docs-body')[0].fire('click', {
    target: { closest: () => ({ dataset }) },
  });
}

// Adds the blocks of `TWO_SECTIONS`'s lines 1, 3, 4, 6 and 7 at fixed content
// tops, whatever the pane's scroll: `pinned` reads each as the pane scrolls.
function pinBlocks(view: DocView) {
  const pane = scroller(view.element);
  const pinned = [
    { line: 1, top: 0 },
    { line: 3, top: 100 },
    { line: 4, top: 110 },
    { line: 6, top: 200 },
    { line: 7, top: 210 },
  ].map(({ line, top }) => {
    const moving = block(line, 0);
    Object.defineProperty(moving, 'rectTop', {
      get: () => top - pane.scrollTop,
    });
    return moving;
  });
  addBlocks(view, ...pinned);
}

// A section editor on `TWO_SECTIONS`'s `## A`, over pinned blocks.
async function pinnedSectionEditor() {
  const shown = await sectionDoc(TWO_SECTIONS);
  pinBlocks(shown.view);
  scroller(shown.view.element).scrollTop = 100;
  shown.view.editSection();
  return shown;
}

// A doc read at its line 5, left for `OTHER_DOC`.
async function readThenLeft() {
  const shown = docViewOver(() => withUser(defaultLayout, paneLayout('pane')));
  const { view, deps } = shown;
  const followPlace = vi.spyOn(deps, 'followPlace');
  await view.open(target(null, DOC));
  addBlocks(view, block(1, -100), block(5, 0), block(9, 40));
  scroller(view.element).scrollTop = 100;
  await view.open(target(null, OTHER_DOC));
  return { ...shown, followPlace };
}

// `DOC`'s entry, holding one section link.
function sectionLinkEntry(line = 3): IndexEntry {
  return {
    ...linkingEntry(DOC, OTHER_DOC, line),
    links: [
      {
        form: 'section',
        raw: '§ B',
        target: OTHER_DOC,
        line,
        targetLine: 2,
      },
    ],
  };
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
