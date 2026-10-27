import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViewScope } from '../../../../contracts/keymap';
import type { ShownLayouts } from '../../../../contracts/plugin';
import {
  asFake,
  asHtml,
  FakeElement,
  findAll,
  installFakeDom,
} from '../../../../shared/page/test-dom';
import defaultLayout from '../../layouts/default/layout.js';
import type { Layout } from '../../layouts/layout';
import { mountHelpView } from '../help-view';
import { mountWhichKeyView } from '../which-key-view';
import { createKeysParts } from './keys-parts';

// One key anchor a kit named.
interface FakeAnchor {
  command: string;
  scope: ViewScope | undefined;
  isDisposed: boolean;
}

// A part drawer whose kits record each anchor they name in `anchors`.
function fakeKeysParts() {
  const anchors: FakeAnchor[] = [];
  const parts = createKeysParts({
    defaultLayout,
    kit: {
      markdown: {
        block: (text) => text,
        inline: (text) => text,
        document: async (text) => text,
      },
      keys: {
        anchor(_element, command, options) {
          const named: FakeAnchor = {
            command,
            scope: options?.scope,
            isDisposed: false,
          };
          anchors.push(named);
          return {
            dispose: () => {
              named.isDisposed = true;
            },
          };
        },
        keysFor: () => null,
      },
      commands: { exists: () => true, run: () => undefined },
      platform: 'macos',
    },
    log: () => undefined,
  });
  return { parts, anchors };
}

// The set shown with `user` as the setting's layout, holding `default` and
// `user`'s layout.
function shownLayouts(user: string, layout: Layout): ShownLayouts<Layout> {
  return {
    layouts: new Map<string, Layout>([
      ['default', defaultLayout],
      [user, layout],
    ]),
    user,
  };
}

// An overlay area appending each contribution under `root`.
function fakeOverlay() {
  const root = new FakeElement('div');
  return {
    root,
    area: {
      contribute(node: HTMLElement) {
        root.append(asFake(node));
        return { dispose: () => undefined };
      },
    },
  };
}

const SECTIONS = [
  {
    title: 'Everywhere',
    hints: [
      { keys: 'Space ?', label: 'help' },
      { keys: 'Esc', label: 'close' },
    ],
  },
  { title: 'In forms', hints: [{ keys: 'j', label: 'next item' }] },
];

describe('createKeysParts', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('help_UserDefinesOnlyHelpRow_RowsFromUserInsideDefaultSections', () => {
    const { parts } = fakeKeysParts();
    parts.setLayouts(
      shownLayouts('slim', {
        helpRow: (parent, input, kit) =>
          kit.el(parent, 'li', 'slim-row', input.label),
      }),
    );
    const parent = asHtml(new FakeElement('div'));

    const drawn = parts.help(parent, { sections: SECTIONS });

    const sections = findAll(asFake(drawn.element), 'keys-help-section');
    const rows = findAll(asFake(drawn.element), 'slim-row');
    expect(drawn.element.dataset.layout).toBe('default');
    expect(sections.map((section) => section.dataset.layout)).toEqual([
      'default',
      'default',
    ]);
    expect(rows.map((row) => row.textContent)).toEqual([
      'help',
      'close',
      'next item',
    ]);
    expect(rows.every((row) => row.dataset.layout === 'slim')).toBe(true);
    expect(rows.every((row) => row.dataset.layoutOwner === 'keys')).toBe(true);
  });

  it('setLayouts_HelpShown_RedrawsOneBodyInPlace', () => {
    const { parts } = fakeKeysParts();
    const overlay = fakeOverlay();
    const help = mountHelpView(
      overlay.area,
      SECTIONS,
      () => undefined,
      asHtml(new FakeElement('span')),
      parts,
    );
    help.show();

    parts.setLayouts(
      shownLayouts('slim', {
        help: (parent, _input, kit) => kit.el(parent, 'div', 'slim-help'),
      }),
    );
    help.layoutsChanged();

    const [scrim] = overlay.root.children;
    const [body] = findAll(overlay.root, 'ui-dialog-body');
    expect(body.children.map((child) => child.className)).toEqual([
      'slim-help',
    ]);
    expect(scrim.hidden).toBe(false);
  });

  it('setLayouts_WhichKeyShown_PanelUnchangedNextShowUsesNewSet', () => {
    const { parts } = fakeKeysParts();
    const overlay = fakeOverlay();
    const view = mountWhichKeyView(overlay.area, parts);
    const model = {
      title: 'Space',
      entries: [{ keys: 'a', label: 'agents', kind: 'prefix' as const }],
    };
    view.show(model);
    const [panel] = overlay.root.children;
    const before = [...panel.childNodes];

    parts.setLayouts(
      shownLayouts('marked', {
        whichKey: (parent, _input, kit) => kit.el(parent, 'div', 'marked'),
      }),
    );
    const after = [...panel.childNodes];
    view.show(model);

    expect(after).toHaveLength(before.length);
    expect(after.every((node, index) => node === before[index])).toBe(true);
    expect(panel.children.map((child) => child.className)).toEqual(['marked']);
  });

  it('titleBarButton_Redraw_DisposesOldHintAnchor', () => {
    const { parts, anchors } = fakeKeysParts();
    const slot = asHtml(new FakeElement('span'));

    parts.titleBarButton(slot).dispose();
    parts.titleBarButton(slot);

    expect(anchors.filter((anchor) => !anchor.isDisposed)).toHaveLength(1);
    expect(asFake(slot).children).toHaveLength(1);
  });

  it('titleBarButton_Hint_AnchoredWithoutScope', () => {
    const { parts, anchors } = fakeKeysParts();

    parts.titleBarButton(asHtml(new FakeElement('span')));

    expect(anchors).toEqual([
      { command: 'keys.toggleHelp', scope: undefined, isDisposed: false },
    ]);
  });
});
