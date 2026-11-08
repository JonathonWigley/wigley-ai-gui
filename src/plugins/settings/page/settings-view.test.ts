import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeFuzzyMatcher } from '../../../shared/fake-fuzzy-matcher.test-support';
import { fakeListPickerService } from '../../../shared/page/fake-list-picker-service.test-support';
import type { PluginStatus } from '../../../contracts/core-state';
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
  FakeElement,
  type FocusFakeDocument,
  type FocusFakeElement,
  findAll,
  installFocusFakeDom,
} from '../../../shared/page/test-dom';
import type { SettingsChannel, SettingsPlace } from '../contract';
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
// each settings write and each keymap write, which the next read then serves,
// and each `mayDisable` asked, which `mayDisable` answers.
function fakeChannel(
  schema: UserConfigSchema,
  keymap: UserKeymap | null,
  mayDisable: (pluginId: string) => Promise<string | null>,
) {
  const written: Record<string, unknown>[] = [];
  const writtenKeymaps: UserKeymap[] = [];
  const asked: string[] = [];
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
      case 'mayDisable':
        asked.push(args[0] as string);
        return mayDisable(args[0] as string);
      default:
        throw new Error(`unexpected ${method}`);
    }
  };
  const channel = {
    invoke,
    on: () => ({ dispose: () => undefined }),
  } as unknown as PageChannel<SettingsChannel>;
  return { channel, written, writtenKeymaps, asked };
}

interface ShownViewOptions {
  // The side bar shows unless false.
  isSideBarShown?: boolean;
  schema?: UserConfigSchema;
  keymap?: UserKeymap | null;
  // A reloaded page's place, put back before the load.
  restored?: SettingsPlace;
  plugins?: () => readonly PluginStatus[];
  mayDisable?: (pluginId: string) => Promise<string | null>;
}

// A view over the fake channel, shown with its first section open and focus
// on the rows, the overlay its picker draws in, every anchor its layout parts
// named, and `handed`: each scope set and each focus target handed over, in
// order. `runs` holds each command a click ran with its arg, `logs` each line
// logged, `toasts` each toast and `picked` the count of `sectionPicked` calls.
// `places` holds each place the view reported.
async function shownView({
  isSideBarShown = true,
  schema = SCHEMA,
  keymap = null,
  restored,
  plugins = () => [],
  mayDisable = async () => null,
}: ShownViewOptions = {}) {
  const { channel, written, writtenKeymaps, asked } = fakeChannel(
    schema,
    keymap,
    mayDisable,
  );
  const overlay = asFake(document.createElement('div'));
  const anchor = () => ({ dispose: () => undefined });
  const { anchors, keys } = recordingAnchors();
  const handed: (string | FocusTarget)[] = [];
  const runs: [string, unknown][] = [];
  const logs: string[] = [];
  const toasts: [string, string][] = [];
  const picked = { count: 0 };
  const places: SettingsPlace[] = [];
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
    log: (line) => logs.push(line),
    toast: (text, tone) => toasts.push([text, tone]),
    setScope: (scope) => handed.push(scope),
    setFocusTarget: (target) => handed.push(target),
    isSideBarShown: () => isSideBarShown,
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
    sectionPicked: () => {
      picked.count += 1;
    },
    runKey: (key, arg) => runs.push([key.id, arg]),
    placeChanged: (place) => places.push(place),
    plugins,
  });
  if (restored !== undefined) {
    view.restorePlace(restored);
  }
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
    writtenKeymaps,
    asked,
    anchors,
    handed,
    move,
    runs,
    logs,
    toasts,
    picked,
    places,
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
      const { view, handed, move } = await shownView({ isSideBarShown: bar });
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
    const { view, writtenKeymaps, move } = await shownView({
      schema: { ...SCHEMA, sections: [], commands: { [command.id]: command } },
      keymap: { binds: [bind('a', 1), bind('b', 2), bind('c', 3)] },
    });
    // Plugins, then Keymap.
    view.openSectionAt(1);
    move('right');
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
      schema: {
        ...SCHEMA,
        sections: [{ ...section, leaves: [...section.leaves, last] }],
      },
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

  it.each([
    {
      where: 'outside its box',
      inBox: false,
      runs: [['settings.moveToRow', 'p.name']],
    },
    { where: 'inside its box', inBox: true, runs: [] },
  ])(
    'rowClick_InsideBoxOrOutside_RunsMoveToRowOnlyOutside: $where',
    async ({ inBox, runs: expected }) => {
      vi.stubGlobal('Element', FakeElement);
      const { view, sheet, runs } = await shownView();
      view.commands.edit();
      await settle();
      const [row] = findAll(sheet, 'settings-row');
      const target = inBox ? only(row, 'settings-box') : row;

      row.fire('click', { target });

      expect(runs).toEqual(expected);
    },
  );

  it.each([
    { name: 'a box open', opensBox: true, key: 'p.mode' },
    { name: 'an unknown key', opensBox: false, key: 'p.gone' },
  ])(
    'moveToRow_BoxOpenOrUnknownKey_LeavesTheCursor: $name',
    async ({ opensBox, key }) => {
      const { view, sheet, logs } = await shownView();
      if (opensBox) {
        view.commands.edit();
        await settle();
      }
      const logsBefore = logs.length;

      view.moveToRow(key);

      const cursorRows = findAll(sheet, 'settings-row').filter((row) =>
        row.classList.contains('is-selected'),
      );
      expect(cursorRows.map((row) => row.textContent)).toEqual([
        expect.stringContaining('Name'),
      ]);
      expect(logs.slice(logsBefore)).toEqual(opensBox ? [] : [`no row ${key}`]);
    },
  );

  it.each([
    { name: 'a held index', index: 2, opened: 'section keymap', picks: 1 },
    {
      name: 'an index with no section',
      index: 9,
      opened: 'no section 9',
      picks: 0,
    },
  ])(
    'openSectionAt_Index_OpensAndCallsSectionPicked: $name',
    async ({ index, opened, picks }) => {
      const { view, logs, picked } = await shownView();
      const logsBefore = logs.length;

      view.openSectionAt(index);

      expect(logs.slice(logsBefore)).toContain(opened);
      expect(picked.count).toBe(picks);
    },
  );

  // Section `q` sits after `p`, holding one row.
  const TWO_SECTIONS: UserConfigSchema = {
    ...SCHEMA,
    sections: [
      ...SCHEMA.sections,
      {
        id: 'q',
        title: 'Q',
        leaves: [
          {
            path: 'q.size',
            label: 'Size',
            description: 'A size',
            control: { kind: 'string' },
            fallback: { value: '' },
          },
        ],
      },
    ],
  };

  it.each([
    {
      name: 'a held section, row and filter',
      saved: {
        sectionsCursor: 1,
        openSectionId: 'q',
        cursorKey: 'q.size',
        filter: 'size',
      },
      opened: 'section q',
      sectionsCursor: 1,
      cursorKey: 'q.size',
      isFilterShown: true,
    },
    {
      // Sections p, q, Plugins and Keymap: index 3 is the last.
      name: 'a sections cursor past the last section',
      saved: {
        sectionsCursor: 9,
        openSectionId: 'q',
        cursorKey: 'q.size',
        filter: '',
      },
      opened: 'section q',
      sectionsCursor: 3,
      cursorKey: 'q.size',
      isFilterShown: false,
    },
    {
      name: 'a gone row',
      saved: {
        sectionsCursor: 0,
        openSectionId: 'p',
        cursorKey: 'p.gone',
        filter: '',
      },
      opened: 'section p',
      sectionsCursor: 0,
      cursorKey: 'p.name',
      isFilterShown: false,
    },
    {
      name: 'a gone section',
      saved: {
        sectionsCursor: 2,
        openSectionId: 'gone',
        cursorKey: 'q.size',
        filter: 'size',
      },
      opened: 'section p',
      sectionsCursor: 0,
      cursorKey: 'p.name',
      isFilterShown: false,
    },
  ])(
    'restores_cursor_and_filter: $name',
    async ({ saved, opened, sectionsCursor, cursorKey, isFilterShown }) => {
      const { logs, places, sheet } = await shownView({
        schema: TWO_SECTIONS,
        restored: saved,
      });

      expect(logs).toContain(opened);
      expect(places.at(-1)?.sectionsCursor).toBe(sectionsCursor);
      expect(places.at(-1)?.cursorKey).toBe(cursorKey);
      expect(only(sheet, 'settings-filter').hidden).toBe(!isFilterShown);
    },
  );

  // Core holding the plugin list leaf, defaulting to `fallback`, and one
  // other leaf, then section `p`: Plugins sits at index 2.
  function pluginsSchema(fallback: readonly string[]): UserConfigSchema {
    return {
      ...SCHEMA,
      sections: [
        {
          id: 'core',
          title: 'Core',
          leaves: [
            {
              path: 'keySequenceTimeoutMs',
              label: 'Key sequence timeout',
              description: 'A timeout',
              control: { kind: 'number' },
              fallback: { value: 1000 },
            },
            {
              path: 'plugins.disabled',
              label: 'Disabled plugins',
              description: 'The plugins that do not run',
              control: { kind: 'json' },
              fallback: { value: fallback },
            },
          ],
        },
        ...SCHEMA.sections,
      ],
    };
  }

  const PLUGINS_INDEX = 2;

  function status(
    id: string,
    label: string,
    on: boolean,
    neededBy: readonly string[] = [],
  ): PluginStatus {
    return { id, label, description: `Adds ${label}.`, on, neededBy };
  }

  // Settings open on its Plugins section, the picker open on `pluginId`'s row.
  async function pickerOnPlugin(pluginId: string, options: ShownViewOptions) {
    const shown = await shownView(options);
    shown.view.openSectionAt(PLUGINS_INDEX);
    shown.view.moveToRow(`plugin:${pluginId}`);
    shown.view.commands.edit();
    await settle();
    return shown;
  }

  it.each([
    {
      name: 'no reason',
      reason: null,
      written: [{ plugins: { disabled: ['gallery'] } }],
      refused: [],
      toasts: [],
    },
    {
      name: 'a reason',
      reason: 'Gallery is needed by X',
      written: [],
      refused: ['refused settings.json: Gallery is needed by X'],
      toasts: [['Gallery is needed by X', 'error']],
    },
  ])(
    'pluginRow_PickFalse_AsksMayDisableFirst: $name',
    async ({ reason, written: expected, refused, toasts: expectedToasts }) => {
      const { view, written, asked, logs, toasts } = await pickerOnPlugin(
        'gallery',
        {
          schema: pluginsSchema([]),
          plugins: () => [status('gallery', 'Gallery', true)],
          mayDisable: async () => reason,
        },
      );

      view.commands.pickerDown();
      view.commands.pickerChoose();
      await settle();

      expect(asked).toEqual(['gallery']);
      expect(written).toEqual(expected);
      expect(logs.filter((line) => line.startsWith('refused'))).toEqual(
        refused,
      );
      expect(toasts).toEqual(expectedToasts);
    },
  );

  it('pluginRow_PickFalseOnSettings_RefusesWithoutAsking', async () => {
    const { view, written, asked, toasts } = await pickerOnPlugin('settings', {
      schema: pluginsSchema([]),
      plugins: () => [status('settings', 'Settings', true)],
    });

    view.commands.pickerDown();
    view.commands.pickerChoose();
    await settle();

    expect(asked).toEqual([]);
    expect(written).toEqual([]);
    expect(toasts).toEqual([
      ['Settings cannot switch itself off: edit settings.json', 'error'],
    ]);
  });

  it('pluginRow_MayDisableRejects_LogsAndWritesNothing', async () => {
    const { view, written, logs, toasts } = await pickerOnPlugin('gallery', {
      schema: pluginsSchema([]),
      plugins: () => [status('gallery', 'Gallery', true)],
      mayDisable: () => Promise.reject(new Error('main is gone')),
    });

    view.commands.pickerDown();
    view.commands.pickerChoose();
    await settle();

    expect(written).toEqual([]);
    expect(logs).toContain('write failed: main is gone');
    expect(toasts).toEqual([['main is gone', 'error']]);
  });

  it('pluginRow_PickTrue_WritesWithoutAsking', async () => {
    const { view, written, asked } = await pickerOnPlugin('gallery', {
      schema: pluginsSchema(['gallery']),
      plugins: () => [status('gallery', 'Gallery', false)],
    });

    view.commands.pickerUp();
    view.commands.pickerChoose();
    await settle();

    expect(asked).toEqual([]);
    expect(written).toEqual([{ plugins: { disabled: [] } }]);
  });

  it('sections_ListPluginsBeforeKeymap_AndCoreHasNoListRow', async () => {
    const { view, sheet } = await shownView({ schema: pluginsSchema([]) });
    setUserLayout(view, {
      settingRow: (parent, input, kit) =>
        kit.el(parent, 'li', 'mine-row', input.path),
    });

    const sectionTitles = findAll(asFake(view.sideBar), 'ui-row-label').map(
      (label) => label.textContent,
    );
    expect(sectionTitles).toEqual(['Core', 'P', 'Plugins', 'Keymap']);
    expect(findAll(sheet, 'mine-row').map((row) => row.textContent)).toEqual([
      'keySequenceTimeoutMs',
    ]);
  });

  it('pluginsChanged_PluginsSectionOpen_Redraws', async () => {
    let statuses = [status('gallery', 'Gallery', true)];
    const { view, sheet } = await shownView({
      schema: pluginsSchema([]),
      plugins: () => statuses,
    });
    view.openSectionAt(PLUGINS_INDEX);
    const values = () =>
      findAll(sheet, 'settings-row-value').map((value) => value.textContent);
    expect(values()).toEqual(['true']);

    statuses = [status('gallery', 'Gallery', false)];
    view.pluginsChanged();

    expect(values()).toEqual(['false']);
  });

  it('pluginRow_NeededByARunningPlugin_DrawsTheLock', async () => {
    const { view, sheet } = await shownView({
      schema: pluginsSchema([]),
      plugins: () => [
        status('gallery', 'Gallery', true, ['b']),
        status('b', 'Bee', true),
      ],
    });

    view.openSectionAt(PLUGINS_INDEX);

    const lock = only(sheet, 'settings-row-lock');
    expect(lock.textContent).toBe('Needed by Bee');
    expect(lock.title).toBe('Needed by Bee');
    expect(only(sheet, 'settings-row-end--locked')).toBe(lock.parentNode);
  });
});
