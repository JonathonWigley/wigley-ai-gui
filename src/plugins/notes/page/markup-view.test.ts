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
});
