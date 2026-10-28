import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  type ScrollerFakeElement,
} from '../../../shared/page/test-dom';
import defaultLayout from '../layouts/default/layout.js';
import type { DocHeaderInput, Layout } from '../layouts/layout';
import { createDocView, type DocTarget, type DocViewDeps } from './doc-view';
import {
  fakeDocsParts,
  fakePushedScope,
  noAnchor,
  SourceLineFakeElement,
} from './docs-page-fakes';

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

// A doc view over a channel reading every doc as `# Doc`, drawing with the
// layouts `layouts` returns, its editor host recording each editor it makes.
function docViewOver(
  layouts: () => ShownLayouts<Layout>,
  chipsOf: DocViewDeps['chipsOf'] = () => {
    throw new Error('no chips');
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
  const deps = {
    viewId: 'view',
    channel: {
      invoke: async (name: string) => replies[name] ?? null,
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
          destroy,
        };
      },
    },
    markdown: {
      block: (text: string) => text,
      inline: (text: string) => text,
      document: async (text: string) => text,
    },
    paths: posixPaths,
    toast: () => undefined,
    log: () => undefined,
    chipsOf,
    statusesOf: () => [],
    loadedOf: () => null,
    followFile: () => undefined,
    pushConflictScope: fakePushedScope,
    anchor: noAnchor,
    parts,
    openChanged: () => undefined,
  } as unknown as DocViewDeps;
  return { view: createDocView(deps), editors };
}

function target(entryId: string | null): DocTarget {
  return {
    path: '/home/notes.md',
    title: 'notes',
    entryId,
    detail: null,
    readOnly: null,
    line: null,
    fragment: null,
  };
}

describe('createDocView', () => {
  beforeEach(() =>
    installFocusFakeDom(
      (name, value) => vi.stubGlobal(name, value),
      SourceLineFakeElement,
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

  it.each(['quit', 'writeQuit'] as const)(
    '%s_AfterEditFromAScrolledPane_ShowsTheDocAtThatScroll',
    async (command) => {
      const { view, editors } = docViewOver(() =>
        withUser(defaultLayout, paneLayout('pane')),
      );
      await view.open(target(null));
      const pane = scroller(view.element);
      pane.scrollTop = 120;
      view.edit(1);

      if (command === 'quit') {
        editors[0].events.quit(false);
      } else {
        editors[0].events.writeQuit();
      }
      await settled();

      expect(pane.scrollTop).toBe(120);
    },
  );
});

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
function sourceBlock(line: number, top: number): SourceLineFakeElement {
  const block = new SourceLineFakeElement('p');
  block.dataset.sourceLine = String(line);
  block.rectTop = top;
  return block;
}

// Resolves once every promise already settling has run its callbacks.
function settled(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
