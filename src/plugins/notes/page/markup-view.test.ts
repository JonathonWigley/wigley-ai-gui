import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MarkupEditor, MarkupSession } from '../../../contracts/markup';
import type { PageChannel, PushedScope } from '../../../contracts/plugin';
import { withUser } from '../../../shared/page/layout-host/test-layouts';
import {
  asFake,
  findAll,
  installFocusFakeDom,
} from '../../../shared/page/test-dom';
import type { NotesChannel } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import type { Layout, MarkupTool } from '../layouts/layout';
import { createNotesParts } from './layout/notes-parts';
import { createMarkupView } from './markup-view';
import { notesPartsDeps } from './notes-page-fakes';

const settle = () => new Promise((resolve) => setImmediate(resolve));

// A markup editor whose session takes every call and draws nothing.
const markup: MarkupEditor = {
  open: () =>
    Promise.resolve({
      setTool: () => undefined,
      setColour: () => undefined,
      undo: () => undefined,
      redo: () => undefined,
      onChange: () => undefined,
      finishEdit: () => undefined,
      toJson: () => '{}',
      toPng: () => Promise.resolve(new Uint8Array()),
      dispose: () => undefined,
    } as unknown as MarkupSession),
} as unknown as MarkupEditor;

// A markup view over `parts`, opened on image 1 once `settle` runs, each line
// it logs in `logged` and each colour its session took in `colours`.
function openedView() {
  const logged: string[] = [];
  const colours: string[] = [];
  const view = createMarkupView({
    channel: {
      invoke: () => Promise.resolve(null),
    } as unknown as PageChannel<NotesChannel>,
    markup: {
      open: async (...args: Parameters<MarkupEditor['open']>) => ({
        ...(await markup.open(...args)),
        setColour: (colour: string) => colours.push(colour),
      }),
    } as unknown as MarkupEditor,
    parts: createNotesParts(notesPartsDeps().deps),
    pushScope: () =>
      ({
        pop: () => undefined,
        onBaseChanged: () => undefined,
      }) as unknown as PushedScope,
    imageBytes: () => Promise.resolve(new Uint8Array()),
    closed: () => undefined,
    saved: () => undefined,
    log: (line) => logged.push(line),
    toast: () => undefined,
  });
  view.open(1, 1);
  return { view, logged, colours };
}

describe('markup view', () => {
  beforeEach(() => {
    installFocusFakeDom((name, value) => vi.stubGlobal(name, value));
    vi.stubGlobal('getComputedStyle', () => ({
      getPropertyValue: () => 'red',
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('markupView_ToolButtonFromLayout_MarksTheToolInUse', async () => {
    const parts = createNotesParts(notesPartsDeps().deps);
    const view = createMarkupView({
      channel: {
        invoke: () => Promise.resolve(null),
      } as unknown as PageChannel<NotesChannel>,
      markup,
      parts,
      pushScope: () =>
        ({
          pop: () => undefined,
          onBaseChanged: () => undefined,
        }) as unknown as PushedScope,
      imageBytes: () => Promise.resolve(new Uint8Array()),
      closed: () => undefined,
      saved: () => undefined,
      log: () => undefined,
      toast: () => undefined,
    });
    const order: MarkupTool[] = ['box', 'arrow', 'text', 'pen', 'select'];
    parts.setLayouts(
      withUser<Layout>(defaultLayout, {
        markupToolbar(parent, kit) {
          const root = kit.el(parent, 'div', 'mine-tools');
          for (const tool of order) {
            kit.toolButton(root, tool);
          }
          return { element: root };
        },
      }),
    );
    view.redrawToolbar();
    view.open(1, 1);
    await settle();

    view.setTool('arrow');

    const [tools] = findAll(asFake(view.element), 'mine-tools');
    const active = tools.children
      .slice(0, order.length)
      .filter((button) => button.classList.contains('is-active'))
      .map((button) => button.textContent);
    expect(active).toEqual(['Arrow']);
  });

  it('pickColourByName_UnknownName_ChangesNothing', async () => {
    const { view, logged, colours } = openedView();
    await settle();
    const coloursBefore = colours.length;

    view.pickColourByName('purple');

    expect(colours.length).toBe(coloursBefore);
    expect(logged.at(-1)).toBe('no markup colour purple');
  });

  it('pickColourByName_KnownName_SetsThePenAndLogsColour', async () => {
    const { view, logged, colours } = openedView();
    await settle();
    const activeColour = () =>
      findAll(asFake(view.element), 'notes-colour')
        .filter((button) => button.classList.contains('is-active'))
        .map((button) => button.textContent);

    view.pickColourByName('green');

    expect(colours.length).toBeGreaterThan(1);
    expect(logged.at(-1)).toBe('colour green');
    expect(activeColour()).toEqual(['Green']);
  });
});
