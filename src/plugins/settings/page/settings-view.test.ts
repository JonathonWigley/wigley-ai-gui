import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorHost } from '../../../contracts/editor';
import type { FocusTarget, PaneDirection } from '../../../contracts/panes';
import type { PageChannel } from '../../../contracts/plugin';
import type {
  UserConfigRead,
  UserConfigSchema,
} from '../../../contracts/user-config';
import {
  recordingAnchors,
  withUser,
} from '../../../shared/page/layout-host/test-layouts';
import {
  asFake,
  type FakeElement,
  type FocusFakeDocument,
  type FocusFakeElement,
  findAll,
  installFocusFakeDom,
} from '../../../shared/page/test-dom';
import type { SettingsChannel } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import type { SettingsLayout } from '../layouts/layout';
import { createSettingsView, type SettingsView } from './settings-view';
import { NO_FENCES } from '../../../shared/page/markdown-mount.test-support';

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
// on the rows, the overlay its picker draws in, every anchor its layout parts
// named, and `handed`: each scope set and each focus target handed over, in
// order. The side bar shows unless `isSideBarShown` is false.
async function shownView(isSideBarShown = true) {
  const { channel, written } = fakeChannel();
  const overlay = asFake(document.createElement('div'));
  const anchor = () => ({ dispose: () => undefined });
  const { anchors, keys } = recordingAnchors();
  const handed: (string | FocusTarget)[] = [];
  const view = createSettingsView({
    channel,
    editor: {} as EditorHost,
    platform: 'macos',
    markdown: {
      block: (text) => text,
      inline: (text) => text,
      document: async (text) => text,
      ...NO_FENCES,
    },
    keys,
    commands: { exists: () => true, run: () => undefined },
    log: () => undefined,
    toast: () => undefined,
    setScope: (scope) => handed.push(scope),
    setFocusTarget: (target) => handed.push(target),
    isSideBarShown: () => isSideBarShown,
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
  const move = (direction: PaneDirection): boolean => {
    const target = handed.at(-1);
    if (typeof target !== 'object') {
      throw new Error('no focus target handed over last');
    }
    return target.move(direction);
  };
  move('right');
  return {
    view,
    overlay,
    written,
    anchors,
    handed,
    move,
    sheet: asFake(view.sheet),
  };
}

// Lets the row actions, which read the files first, run.
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function setUserLayout(view: SettingsView, layout: SettingsLayout) {
  view.setLayouts(withUser<SettingsLayout>(defaultLayout, layout));
}

function only(root: FakeElement, className: string): FakeElement {
  const [found, ...rest] = findAll(root, className);
  expect(found).toBeDefined();
  expect(rest).toEqual([]);
  return found;
}

describe('createSettingsView', () => {
  let fakeDocument: FocusFakeDocument;

  beforeEach(() => {
    fakeDocument = installFocusFakeDom((name, value) =>
      vi.stubGlobal(name, value),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    {
      from: 'rows',
      direction: 'left',
      bar: true,
      after: 'sections',
      moved: true,
    },
    {
      from: 'rows',
      direction: 'left',
      bar: false,
      after: 'rows',
      moved: false,
    },
    {
      from: 'sections',
      direction: 'right',
      bar: true,
      after: 'rows',
      moved: true,
    },
    {
      from: 'rows',
      direction: 'right',
      bar: true,
      after: 'rows',
      moved: false,
    },
    {
      from: 'sections',
      direction: 'left',
      bar: true,
      after: 'sections',
      moved: false,
    },
    { from: 'rows', direction: 'up', bar: true, after: 'rows', moved: false },
    {
      from: 'sections',
      direction: 'down',
      bar: true,
      after: 'sections',
      moved: false,
    },
  ] as const)(
    'focusTarget_MovesBetweenSectionsAndRows: $from $direction, side bar $bar',
    async ({ from, direction, bar, after, moved }) => {
      const { view, handed, move } = await shownView(bar);
      if (from === 'sections') {
        move('left');
      }
      const handedBefore = handed.length;
      const pane = { sections: view.sideBar, rows: view.sheet };

      expect(move(direction)).toBe(moved);

      expect(fakeDocument.activeElement).toBe(asFake(pane[after]));
      expect(handed.slice(handedBefore).map((each) => typeof each)).toEqual(
        moved ? ['string', 'object'] : [],
      );
    },
  );

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
    expect(fakeDocument.activeElement).toBe(input);
  });

  it('a row that leaves out its slots still gets the prompt and the box', async () => {
    const { view, sheet } = await shownView();
    setUserLayout(view, {
      settingRow: (parent, input, kit) =>
        kit.el(parent, 'li', 'bare-row', input.label),
    });

    const row = findAll(sheet, 'bare-row')[0];
    expect(row.contains(only(sheet, 'settings-row-actions'))).toBe(true);

    view.commands.edit();
    await settle();

    expect(row.contains(only(sheet, 'settings-box'))).toBe(true);
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

  it("a picker row's anchors are disposed as the picker closes", async () => {
    const { view, anchors } = await shownView();
    setUserLayout(view, {
      pickerRow(parent, input, kit) {
        const row = kit.el(parent, 'li', 'mine-pick', input.label);
        kit.keyHint(row, 'pickerChoose');
        return row;
      },
    });
    view.commands.down();
    view.commands.edit();
    await settle();
    const rowAnchors = () =>
      anchors.filter((anchor) => anchor.command === 'settings.pickerChoose');
    expect(rowAnchors().length).toBeGreaterThan(0);

    view.commands.pickerCancel();

    expect(rowAnchors().every((anchor) => anchor.isDisposed)).toBe(true);
  });
});
