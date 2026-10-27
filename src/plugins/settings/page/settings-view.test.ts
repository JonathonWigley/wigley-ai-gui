import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorHost } from '../../../contracts/editor';
import type { PageChannel } from '../../../contracts/plugin';
import type {
  UserConfigRead,
  UserConfigSchema,
} from '../../../contracts/user-config';
import {
  asFake,
  FakeElement,
  findAll,
  installFakeDom,
} from '../../../shared/page/test-dom';
import type { SettingsChannel } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import type { SettingsLayout } from '../layouts/layout';
import { createSettingsView, type SettingsView } from './settings-view';

// The fake DOM of `test-dom` with what the view's focus and boxes use: an
// `activeElement` that `focus` sets and that leaves an element as it or an
// ancestor is removed (as a browser blurs a detached element), an input's
// value and selection, and `prepend`.
class FocusFakeElement extends FakeElement {
  value = '';
  selectionStart: number | null = null;
  selectionEnd: number | null = null;
  selectionDirection: string | null = null;

  focus() {
    fakeDocument().activeElement = this;
  }

  blur() {
    if (fakeDocument().activeElement === this) {
      fakeDocument().activeElement = null;
    }
  }

  select() {}

  setSelectionRange(start: number, end: number) {
    this.selectionStart = start;
    this.selectionEnd = end;
  }

  prepend(node: FakeElement) {
    node.remove();
    node.parentNode = this;
    this.childNodes.unshift(node);
  }

  override remove() {
    const doc = fakeDocument();
    if (doc.activeElement !== null && this.contains(doc.activeElement)) {
      doc.activeElement = null;
    }
    super.remove();
  }
}

interface FakeDocument {
  activeElement: FakeElement | null;
  createElement(tag: string): FakeElement;
}

function fakeDocument(): FakeDocument {
  return (globalThis as unknown as { document: FakeDocument }).document;
}

// One plugin section: a string leaf, then a choice leaf defaulting to `a`.
const SCHEMA: UserConfigSchema = {
  sections: [
    {
      id: 'p',
      title: 'P',
      leaves: [
        {
          path: 'p.name',
          label: 'Name',
          description: 'A name',
          control: { kind: 'string' },
          fallback: { value: '' },
        },
        {
          path: 'p.mode',
          label: 'Mode',
          description: 'A mode',
          control: { kind: 'choice', choices: ['a', 'b', 'c'] },
          fallback: { value: 'a' },
        },
      ],
    },
  ],
  commands: {},
  scopes: [],
  defaultBindLayers: [],
  defaultAccelerators: { app: [], global: [], intercept: [] },
  defaultLeader: '<Space>',
};

// A channel serving SCHEMA and empty files, recording each settings write.
function fakeChannel() {
  const written: Record<string, unknown>[] = [];
  const read: UserConfigRead = {
    settings: { state: 'ok', layer: null, text: null },
    keymap: { state: 'ok', layer: null, text: null },
    themes: [],
  };
  const invoke = async (method: string, ...args: unknown[]) => {
    switch (method) {
      case 'schema':
        return SCHEMA;
      case 'read':
        return read;
      case 'writeSettings':
        written.push(args[0] as Record<string, unknown>);
        return { type: 'written' };
      default:
        throw new Error(`unexpected ${method}`);
    }
  };
  const channel = {
    invoke,
    on: () => ({ remove: () => undefined }),
  } as unknown as PageChannel<SettingsChannel>;
  return { channel, written };
}

// A view over the fake channel, shown with its first section open and focus
// on the rows, and the overlay its picker draws in.
async function shownView() {
  const { channel, written } = fakeChannel();
  const overlay = new FocusFakeElement('div');
  const anchor = () => ({ dispose: () => undefined });
  const view = createSettingsView({
    channel,
    editor: {} as EditorHost,
    platform: 'macos',
    markdown: {
      block: (text) => text,
      inline: (text) => text,
      document: async (text) => text,
    },
    keys: { anchor, keysFor: () => null },
    commands: { exists: () => true, run: () => undefined },
    log: () => undefined,
    toast: () => undefined,
    setScope: () => undefined,
    pushScope: () => ({ pop: () => undefined, onBaseChanged: () => undefined }),
    addOverlay(element) {
      overlay.append(asFake(element));
      return { dispose: () => undefined };
    },
    anchor,
    sectionShown: () => undefined,
    sectionPicked: () => undefined,
  });
  await view.load();
  view.shown();
  view.commands.focusRows();
  return { view, overlay, written, sheet: asFake(view.sheet) };
}

// Lets the row actions, which read the files first, run.
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function setUserLayout(view: SettingsView, layout: SettingsLayout) {
  view.setLayouts({
    layouts: new Map<string, SettingsLayout>([
      ['default', defaultLayout],
      ['mine', layout],
    ]),
    user: 'mine',
  });
}

function only(root: FakeElement, className: string): FakeElement {
  const [found, ...rest] = findAll(root, className);
  expect(found).toBeDefined();
  expect(rest).toEqual([]);
  return found;
}

describe('createSettingsView', () => {
  beforeEach(() => {
    installFakeDom((name, value) => vi.stubGlobal(name, value));
    vi.stubGlobal('document', {
      activeElement: null,
      createElement: (tag: string) => new FocusFakeElement(tag),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('a layout reload keeps the open row box', async () => {
    const { view, sheet } = await shownView();
    view.commands.edit();
    await settle();
    const box = only(sheet, 'settings-box');
    const input = only(box, 'settings-box-input') as FocusFakeElement;
    input.value = 'typed';

    setUserLayout(view, {
      settingRow(parent, input, kit) {
        const row = kit.el(parent, 'li', 'mine-row', input.label);
        kit.box(row).classList.add('mine-box');
        return row;
      },
    });

    const row = findAll(sheet, 'mine-row')[0];
    expect(row.dataset.layout).toBe('mine');
    expect(box.parentNode).toBe(only(row, 'mine-box'));
    expect(input.value).toBe('typed');
    expect(fakeDocument().activeElement).toBe(input);
  });

  it('a row that leaves out its slots still gets the prompt and the box', async () => {
    const { view, sheet } = await shownView();
    setUserLayout(view, {
      settingRow: (parent, input, kit) =>
        kit.el(parent, 'li', 'bare-row', input.label),
    });

    const row = findAll(sheet, 'bare-row')[0];
    expect(only(sheet, 'settings-row-actions').parentNode).toBe(row);

    view.commands.edit();
    await settle();

    expect(only(sheet, 'settings-box').parentNode).toBe(row);
  });

  it("the picker's rows draw through pickerRow and redraw on a reload", async () => {
    const { view, overlay, written } = await shownView();
    view.commands.down();
    view.commands.edit();
    await settle();
    view.commands.pickerDown();

    setUserLayout(view, {
      pickerRow: (parent, input, kit) =>
        kit.el(parent, 'li', 'mine-pick', input.label),
    });

    const picks = findAll(overlay, 'mine-pick');
    expect(
      picks.map((pick) => [
        pick.textContent,
        pick.dataset.layout,
        pick.classList.contains('is-cursor'),
      ]),
    ).toEqual([
      ['a', 'mine', false],
      ['b', 'mine', true],
      ['c', 'mine', false],
    ]);
    expect(only(overlay, 'ui-picker-layer').hidden).toBe(false);

    picks[1].click();
    await settle();

    expect(written).toEqual([{ p: { mode: 'b' } }]);
  });
});
