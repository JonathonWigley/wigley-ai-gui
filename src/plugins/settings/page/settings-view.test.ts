import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeFuzzyMatcher } from '../../../shared/fake-fuzzy-matcher.test-support';
import { fakeListPickerService } from '../../../shared/page/fake-list-picker-service.test-support';
import type { EditorHost } from '../../../contracts/editor';
import type { FocusTarget, PaneDirection } from '../../../contracts/panes';
import type { UserKeymap } from '../../../contracts/keymap';
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
import { noLayoutState } from '../../../shared/page/layout-host/fake-layout-state.test-support';

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

// A channel serving `schema`, `keymap` and an empty settings file, recording
// each settings write and each keymap write, which the next read then serves.
function fakeChannel(schema: UserConfigSchema, keymap: UserKeymap | null) {
  const written: Record<string, unknown>[] = [];
  const writtenKeymaps: UserKeymap[] = [];
  const read: UserConfigRead = {
    settings: { state: 'ok', layer: null, text: null },
    keymap: { state: 'ok', layer: keymap, text: null },
    themes: [],
  };
  const invoke = async (method: string, ...args: unknown[]) => {
    switch (method) {
      case 'schema':
        return schema;
      case 'read':
        return read;
      case 'writeSettings':
        written.push(args[0] as Record<string, unknown>);
        return { type: 'written' };
      case 'writeKeymap':
        writtenKeymaps.push(args[0] as UserKeymap);
        read.keymap = { state: 'ok', layer: args[0] as UserKeymap, text: null };
        return { type: 'written' };
      default:
        throw new Error(`unexpected ${method}`);
    }
  };
  const channel = {
    invoke,
    on: () => ({ dispose: () => undefined }),
  } as unknown as PageChannel<SettingsChannel>;
  return { channel, written, writtenKeymaps };
}

// A view over the fake channel, shown with its first section open and focus
// on the rows, the overlay its picker draws in, every anchor its layout parts
// named, `handed`: each scope set and each focus target handed over, in
// order, `logged`: each line logged, and `picked`: each `sectionPicked`
// after the rows take the keys.
async function shownView(schema = SCHEMA, keymap: UserKeymap | null = null) {
  const { channel, written, writtenKeymaps } = fakeChannel(schema, keymap);
  const overlay = asFake(document.createElement('div'));
  const anchor = () => ({ dispose: () => undefined });
  const { anchors, keys } = recordingAnchors();
  const handed: (string | FocusTarget)[] = [];
  const logged: string[] = [];
  const picked = vi.fn();
  const view = createSettingsView({
    channel,
    editor: {} as EditorHost,
    matcher: fakeFuzzyMatcher,
    platform: 'macos',
    state: noLayoutState,
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
      run: () => undefined,
    },
    log: (line) => logged.push(line),
    toast: () => undefined,
    setScope: (scope) => handed.push(scope),
    setFocusTarget: (target) => handed.push(target),
    pushScope: () => ({
      pop: () => undefined,
      dispose: () => undefined,
      onBaseChanged: () => ({ dispose: () => undefined }),
    }),
    picker: fakeListPickerService({
      place(element) {
        overlay.append(asFake(element));
      },
    }),
    anchor,
    sectionShown: () => undefined,
    sectionPicked: picked,
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
  picked.mockClear();
  return {
    view,
    overlay,
    written,
    writtenKeymaps,
    anchors,
    handed,
    logged,
    picked,
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
    { from: 'sections', direction: 'right', after: 'rows', moved: true },
    { from: 'rows', direction: 'left', after: 'rows', moved: false },
    { from: 'rows', direction: 'right', after: 'rows', moved: false },
    { from: 'sections', direction: 'left', after: 'sections', moved: false },
    { from: 'rows', direction: 'up', after: 'rows', moved: false },
    { from: 'sections', direction: 'down', after: 'sections', moved: false },
  ] as const)(
    'focusTarget_MovesBetweenSectionsAndRows: $from $direction',
    async ({ from, direction, after, moved }) => {
      const { view, handed, picked, move } = await shownView();
      if (from === 'sections') {
        view.focusSideBar();
      }
      const handedBefore = handed.length;
      const pane = { sections: view.sideBar, rows: view.sheet };

      expect(move(direction)).toBe(moved);

      expect(fakeDocument.activeElement).toBe(asFake(pane[after]));
      expect(handed.slice(handedBefore).map((each) => typeof each)).toEqual(
        moved ? ['string', 'object'] : [],
      );
      expect(picked).toHaveBeenCalledTimes(moved ? 1 : 0);
    },
  );

  it.each([
    { command: 'open', focused: 'sheet', pickedCount: 1 },
    { command: 'openKeepingFocus', focused: 'sideBar', pickedCount: 0 },
  ] as const)(
    'sectionKeys_OpenTheSection: $command',
    async ({ command, focused, pickedCount }) => {
      const { view, logged, picked } = await shownView();
      view.focusSideBar();
      view.commands.down();

      const loggedBefore = logged.length;

      view.commands[command]();

      expect(logged.slice(loggedBefore)).toContain('section keymap');
      expect(fakeDocument.activeElement).toBe(asFake(view[focused]));
      expect(picked).toHaveBeenCalledTimes(pickedCount);
    },
  );

  it('focusSideBarThenFocusMain_MovesAndLogsOnce', async () => {
    const { view, handed, logged, picked } = await shownView();
    const handedBefore = handed.length;
    const loggedBefore = logged.length;

    view.focusSideBar();
    view.focusSideBar();
    view.focusMain();

    expect(picked).toHaveBeenCalledTimes(1);
    expect(
      logged.slice(loggedBefore).filter((line) => line.endsWith(' focused')),
    ).toEqual(['sections focused', 'rows focused']);
    expect(
      handed.slice(handedBefore).filter((each) => typeof each === 'string'),
    ).toEqual(['sections', 'sections', 'rows']);
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

  it('a row that leaves the list on Remove hands the cursor to the row in its place', async () => {
    const command = {
      id: 'p.pick',
      plugin: 'p',
      label: 'pick',
      group: 'g',
      runsIn: 'page',
      arg: 'number',
    } as const;
    const bind = (keys: string, arg: number) => ({
      keys,
      scope: 'any',
      command: command.id,
      arg,
    });
    const { view, writtenKeymaps } = await shownView(
      { ...SCHEMA, sections: [], commands: { [command.id]: command } },
      { binds: [bind('a', 1), bind('b', 2), bind('c', 3)] },
    );
    // The leader row, then one row per argument.
    view.commands.down();
    view.commands.down();

    view.commands.removeBind();
    await settle();
    view.commands.removeBind();
    await settle();

    expect(writtenKeymaps).toEqual([
      { binds: [bind('a', 1), bind('c', 3)] },
      { binds: [bind('a', 1)] },
    ]);
  });

  it('a row a new filter hides hands the cursor to the first match', async () => {
    const [section] = SCHEMA.sections;
    const last = {
      ...section.leaves[0],
      path: 'p.last',
      label: 'Last',
      description: 'Last',
    };
    const { view, sheet } = await shownView({
      ...SCHEMA,
      sections: [{ ...section, leaves: [...section.leaves, last] }],
    });
    view.commands.down();
    view.commands.down();
    view.commands.filter();
    const frame = only(sheet, 'settings-filter');
    const filter = only(frame, 'settings-box-input') as FocusFakeElement;
    // Matches Name and Mode, leaving out Last, where the cursor is.
    filter.value = 'm';
    filter.fire('input');

    // Name, a string, opens a box; Mode, a choice, would open the picker.
    view.commands.edit();
    await settle();

    expect(findAll(sheet, 'settings-box')).toHaveLength(1);
  });
});
