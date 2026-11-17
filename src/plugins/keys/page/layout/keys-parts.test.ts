import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  recordingAnchors,
  withUser,
} from '../../../../shared/page/layout-host/test-layouts';
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
import { NO_FENCES } from '../../../../shared/page/markdown-mount.test-support';
import { noLayoutState } from '../../../../shared/page/layout-host/fake-layout-state.test-support';

// A part drawer whose kits record each anchor they name in `anchors`.
function fakeKeysParts() {
  const { anchors, keys } = recordingAnchors();
  const runs: string[] = [];
  const parts = createKeysParts({
    defaultLayout,
    kit: {
      markdown: {
        block: (text) => text,
        inline: (text) => text,
        document: async (text) => text,
        ...NO_FENCES,
      },
      keys,
      commands: {
        exists: () => true,
        argShape: () => undefined,
        run: (id) => {
          runs.push(id);
        },
      },
      platform: 'macos',
      state: noLayoutState,
    },
    log: () => undefined,
  });
  return { parts, anchors, runs };
}

// The set shown with `name`'s `layout` as the setting's layout.
function shownLayouts(name: string, layout: Layout) {
  return withUser<Layout>(defaultLayout, layout, name);
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
    const help = mountHelpView(overlay.area, SECTIONS, parts);
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
    expect(
      findAll(overlay.root, 'ui-button').map((button) => button.textContent),
    ).toEqual(['Close']);
  });

  it('setLayouts_HelpShownWithOwnFrame_OneCloseAndFrameFollowsTheSwitch', () => {
    const { parts } = fakeKeysParts();
    const overlay = fakeOverlay();
    const help = mountHelpView(overlay.area, SECTIONS, parts);
    help.show();
    expect(findAll(overlay.root, 'keys-frame-mine')).toHaveLength(0);

    parts.setLayouts(
      shownLayouts('mine', {
        dialogFrame: (parent, input, kit) => {
          const panel = kit.el(parent, 'div', 'keys-frame-mine', input.title);
          const body = kit.el(panel, 'div', 'ui-dialog-body');
          const actions = kit.el(panel, 'div', 'ui-dialog-actions');
          kit.el(actions, 'button', 'ui-button', 'Close');
          return { element: panel, body, actions };
        },
      }),
    );
    help.layoutsChanged();
    help.layoutsChanged();

    const panels = findAll(overlay.root, 'keys-frame-mine');
    expect(panels).toHaveLength(1);
    expect(panels[0].dataset.layout).toBe('mine');
    const buttons = findAll(overlay.root, 'ui-button');
    expect(buttons.map((button) => button.textContent)).toEqual(['Close']);
  });

  it('setLayouts_HelpHidden_NextShowDrawsNewBody', () => {
    const { parts } = fakeKeysParts();
    const overlay = fakeOverlay();
    const help = mountHelpView(overlay.area, SECTIONS, parts);

    parts.setLayouts(
      shownLayouts('slim', {
        help: (parent, _input, kit) => kit.el(parent, 'div', 'slim-help'),
      }),
    );
    help.layoutsChanged();
    const [hiddenBody] = findAll(overlay.root, 'ui-dialog-body');
    const whileHidden = hiddenBody.children.map((child) => child.className);
    help.show();

    const [body] = findAll(overlay.root, 'ui-dialog-body');
    expect(whileHidden).toEqual(['keys-help-sections']);
    expect(body.children.map((child) => child.className)).toEqual([
      'slim-help',
    ]);
  });

  it('setLayouts_WhichKeyShown_PanelUnchangedNextShowUsesNewSet', () => {
    const { parts } = fakeKeysParts();
    const overlay = fakeOverlay();
    const view = mountWhichKeyView(overlay.area, parts);
    const model = {
      title: 'Space',
      name: null,
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

  it('dialogFrame_Default_CloseRunsCloseHelpAndShowsItsKey', () => {
    const { parts, anchors, runs } = fakeKeysParts();
    const parent = asHtml(new FakeElement('div'));

    const { built } = parts.dialogFrame(parent, {
      title: 'Keys',
      hasActions: true,
    });

    const buttons = findAll(asFake(built.actions as HTMLElement), 'ui-button');
    buttons[0].click();
    expect(buttons.map((button) => button.textContent)).toEqual(['Close']);
    expect(runs).toEqual(['keys.closeHelp']);
    expect(
      anchors.map(({ command, scope }) => ({ command, scope })),
    ).toContainEqual({ command: 'keys.closeHelp', scope: 'keys.help' });
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

    expect(
      anchors.map(({ command, scope, isDisposed }) => ({
        command,
        scope,
        isDisposed,
      })),
    ).toEqual([
      { command: 'keys.toggleHelp', scope: undefined, isDisposed: false },
    ]);
  });
});
