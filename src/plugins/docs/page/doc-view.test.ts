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
} from '../../../shared/page/test-dom';
import defaultLayout from '../layouts/default/layout.js';
import type { DocHeaderInput, Layout } from '../layouts/layout';
import {
  createDocView,
  type DocDetail,
  type DocTarget,
  type DocViewDeps,
} from './doc-view';
import { fakeDocsParts, fakePushedScope, noAnchor } from './docs-page-fakes';
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

// A drop target the view registered, and whether it has been disposed.
interface RecordedTarget {
  target: DropTarget;
  isDisposed: boolean;
}

// A doc view over a channel reading every doc as `# Doc`, drawing with the
// layouts `layouts` returns, its editor host recording each editor it makes
// and each text inserted, rendering through `markdown`. `writeBytes` answers
// the channel's `writeBytes`, each call recorded in `writes`; `targets` holds
// each drop target.
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
  }[] = [];
  const replies: Record<string, unknown> = {
    readDoc: '# Doc',
    writeDoc: { type: 'written' },
  };
  const inserts: string[] = [];
  const toasts: string[] = [];
  const writes: [string, number[]][] = [];
  const targets: RecordedTarget[] = [];
  const io = {
    writeBytes: async (): Promise<unknown> => ({ type: 'written' }),
    now: 0,
  };
  const deps = {
    viewId: 'view',
    channel: {
      invoke: async (name: string, ...args: unknown[]) => {
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
        editors.push({ parent, line: options.line, events, destroy });
        return {
          text: () => text,
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
    anchor: noAnchor,
    parts,
    openChanged: () => undefined,
  } as unknown as DocViewDeps;
  return {
    view: createDocView(deps),
    editors,
    deps,
    inserts,
    toasts,
    writes,
    targets,
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
  ])('dropTarget_OnlyWhileEditing $steps', async ({ steps, live }) => {
    const { view, editors, targets } = docViewOver(() =>
      withUser(defaultLayout, paneLayout('pane')),
    );
    for (const step of steps) {
      switch (step) {
        case 'open':
          await view.open(target(null));
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
});

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
