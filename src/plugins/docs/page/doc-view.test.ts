import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShownLayouts } from '../../../contracts/plugin';
import { posixPaths } from '../../../shared/paths/posix-paths';
import { asFake, type FakeElement } from '../../../shared/page/test-dom';
import type { DocHeaderInput, Layout } from '../layouts/layout';
import { createDocView, type DocTarget, type DocViewDeps } from './doc-view';
import {
  fakeDocsParts,
  fakePushedScope,
  installDocsFakeDom,
  noAnchor,
  shownLayouts,
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
  const editors: { parent: HTMLElement; destroy: ReturnType<typeof vi.fn> }[] =
    [];
  const deps = {
    viewId: 'view',
    channel: {
      invoke: async (name: string) => (name === 'readDoc' ? '# Doc' : null),
    },
    homeDir: '/home',
    editor: {
      createDocument(parent: HTMLElement, text: string) {
        const destroy = vi.fn();
        editors.push({ parent, destroy });
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
    installDocsFakeDom((name, value) => vi.stubGlobal(name, value)),
  );
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('redraw_EditorOpen_KeepsTheEditorAndRedrawsTheFrameOnClose', async () => {
    let shown = shownLayouts('slim', { slim: paneLayout('pane-1') });
    const { view, editors } = docViewOver(() => shown);
    await view.open(target(null));
    view.edit(1);
    const [editor] = editors;
    const host = asFake(editor.parent);
    const hostParent = host.parentNode;

    shown = shownLayouts('slim', { slim: paneLayout('pane-2') });
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
    const { view } = docViewOver(() => shownLayouts('header', { header }));

    await view.open(target(null));

    expect(headers.map(({ chips, statuses }) => ({ chips, statuses }))).toEqual(
      [{ chips: [], statuses: [] }],
    );
  });
});

// The classes of the doc pane part's root.
function paneClasses(root: HTMLElement): string[] {
  return asFake(root).children.map((child: FakeElement) => child.className);
}
