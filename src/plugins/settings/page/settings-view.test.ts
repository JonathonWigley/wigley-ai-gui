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
  type RecordedAnchor,
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
import type {
  SettingControlKind,
  SettingsChannel,
  SettingsPlace,
} from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import type { SettingsLayout } from '../layouts/layout';
import { deferred } from '../../../shared/plugin-part-harness.test-support';
import { BUILT_IN_CONTROL_KINDS } from './built-in-control-kinds';
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
          control: { kind: 'string', choices: null },
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
  defaultGroups: {},
  defaultLeader: '<Space>',
};

// A channel serving `schema`, `keymap` (or `keymapRead`, when given) and a
// settings file holding `settingsLayer` (null: no file), recording each
// settings write and each keymap write, which the next read then serves, and
// each `mayDisable` asked, which `mayDisable` answers. Each settings write is
// refused with the next of `refusals` while any are left.
function fakeChannel(
  schema: UserConfigSchema,
  keymap: UserKeymap | null,
  mayDisable: (pluginId: string) => Promise<string | null>,
  keymapRead?: UserConfigRead['keymap'],
  refusals: string[] = [],
  settingsLayer: Record<string, unknown> | null = null,
  held?: (method: string) => Promise<unknown> | undefined,
) {
  const written: Record<string, unknown>[] = [];
  const writtenKeymaps: UserKeymap[] = [];
  const asked: string[] = [];
  const read: UserConfigRead = {
    settings: { state: 'ok', layer: settingsLayer, text: null },
    keymap: keymapRead ?? { state: 'ok', layer: keymap, text: null },
    themes: [],
    layoutNames: {},
  };
  const invoke = async (method: string, ...args: unknown[]) => {
    const answer = held?.(method);
    if (answer !== undefined) {
      return answer;
    }
    switch (method) {
      case 'schema':
        return schema;
      case 'read':
        return read;
      case 'writeSettings': {
        const problem = refusals.shift();
        if (problem !== undefined) {
          return { type: 'refused', problem };
        }
        written.push(args[0] as Record<string, unknown>);
        return { type: 'written' };
      }
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
  return { channel, written, writtenKeymaps, asked, read };
}

interface ShownViewOptions {
  schema?: UserConfigSchema;
  keymap?: UserKeymap | null;
  keymapRead?: UserConfigRead['keymap'];
  // The problems the settings writes are refused with, in order.
  refusals?: string[];
  // A reloaded page's place, put back before the load.
  restored?: SettingsPlace;
  plugins?: () => readonly PluginStatus[];
  mayDisable?: (pluginId: string) => Promise<string | null>;
  settingsLayer?: Record<string, unknown> | null;
  controlKind?: (id: string) => SettingControlKind | undefined;
  // Runs on the created view before its load.
  beforeLoad?: (view: SettingsView) => void;
  // Answers an invoke in place of the channel's own answer; undefined leaves
  // it to the channel.
  held?: (method: string) => Promise<unknown> | undefined;
}

const builtInKind = (id: string) =>
  BUILT_IN_CONTROL_KINDS.find((kind) => kind.id === id);

// A view over the fake channel, shown with its first section open and focus
// on the rows, the overlay its picker draws in, every anchor its layout parts
// named, and `handed`: each scope set and each focus target handed over, in
// order. `runs` holds each command a click ran with its arg, `logs` each line
// logs, `toasts` each toast and `picked` the count of `sectionPicked` calls
// after the rows take the keys. `places` holds each place the view reported.
async function shownView({
  schema = SCHEMA,
  keymap = null,
  keymapRead,
  refusals,
  restored,
  plugins = () => [],
  mayDisable = async () => null,
  settingsLayer = null,
  controlKind = builtInKind,
  beforeLoad = () => undefined,
  held,
}: ShownViewOptions = {}) {
  const { channel, written, writtenKeymaps, asked, read } = fakeChannel(
    schema,
    keymap,
    mayDisable,
    keymapRead,
    refusals,
    settingsLayer,
    held,
  );
  const overlay = asFake(document.createElement('div'));
  const { anchors, keys } = recordingAnchors();
  const handed: (string | FocusTarget)[] = [];
  const runs: [string, unknown][] = [];
  const logs: string[] = [];
  const toasts: [string, string][] = [];
  const picked = { count: 0 };
  const places: SettingsPlace[] = [];
  const capture = fakeCapture();
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
    pushScope: () => ({
      pop: () => undefined,
      dispose: () => undefined,
      onBaseChanged: () => ({ dispose: () => undefined }),
    }),
    captureKey: capture.captureKey,
    picker: fakeListPickerService({
      place(element) {
        overlay.append(asFake(element));
      },
    }),
    sectionShown: () => undefined,
    sectionPicked: () => {
      picked.count += 1;
    },
    runKey: (key, arg) => runs.push([key.id, arg]),
    placeChanged: (place) => places.push(place),
    plugins,
    controlKind,
  });
  if (restored !== undefined) {
    view.restorePlace(restored);
  }
  beforeLoad(view);
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
  picked.count = 0;
  return {
    view,
    overlay,
    read,
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
    capture,
    sheet: asFake(view.sheet),
  };
}

// The page's one-shot key capture: `press` hands keys to the armed capture,
// `isArmed` reads whether one is, `disposes` counts each dispose of an armed
// one.
function fakeCapture() {
  let armed: { onKey(keys: string): void; onCancel(): void } | null = null;
  const counts = { disposes: 0 };
  return {
    counts,
    captureKey(onKey: (keys: string) => void, onCancel: () => void) {
      const held = { onKey, onCancel };
      armed = held;
      return {
        dispose() {
          if (armed === held) {
            armed = null;
            counts.disposes += 1;
          }
        },
      };
    },
    press(keys: string) {
      const held = armed;
      if (held === null) {
        throw new Error('no capture armed');
      }
      armed = null;
      held.onKey(keys);
    },
    isArmed: () => armed !== null,
  };
}

// Lets the row actions, which read the files first, run.
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function setUserLayout(view: SettingsView, layout: SettingsLayout) {
  view.setLayouts(withUser<SettingsLayout>(defaultLayout, layout));
}

// The keys the live cursor prompt hints name, by scope: each live anchor
// drawn in a `settings-row-actions` prompt.
function livePromptAnchors(anchors: readonly RecordedAnchor[]) {
  return anchors
    .filter(
      (anchor) =>
        !anchor.isDisposed &&
        asFake(anchor.element).parentNode?.classList.contains(
          'settings-row-actions',
        ),
    )
    .map(({ command, label, scope }) => ({ command, label, scope }))
    .sort((a, b) => String(a.scope).localeCompare(String(b.scope)));
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
    vi.restoreAllMocks();
  });

  it('draws and logs nothing when a read lands after dispose', async () => {
    const setup = await shownView();
    const logsBefore = [...setup.logs];

    setup.view.reread();
    setup.view.dispose();
    await settle();

    expect(setup.logs).toEqual(logsBefore);
    expect(setup.toasts).toEqual([]);
  });

  it('dispose disposes every anchor the side bar, the rows pane and its rows named', async () => {
    const { view, anchors } = await shownView();
    expect(anchors.map((anchor) => anchor.command)).toEqual(
      expect.arrayContaining([
        'panes.focusRight',
        'panes.focusLeft',
        'settings.edit',
      ]),
    );

    view.dispose();

    expect(anchors.filter((anchor) => !anchor.isDisposed)).toEqual([]);
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
      expect(picked.count).toBe(moved ? 1 : 0);
    },
  );

  it.each([
    { command: 'open', focused: 'sheet', pickedCount: 1 },
    { command: 'openKeepingFocus', focused: 'sideBar', pickedCount: 0 },
  ] as const)(
    'sectionKeys_OpenTheSection: $command',
    async ({ command, focused, pickedCount }) => {
      const { view, logs, picked } = await shownView();
      view.focusSideBar();
      view.commands.down();

      const logsBefore = logs.length;

      view.commands[command]();

      expect(logs.slice(logsBefore)).toContain('section plugins');
      expect(fakeDocument.activeElement).toBe(asFake(view[focused]));
      expect(picked.count).toBe(pickedCount);
    },
  );

  it('focusSideBarThenFocusMain_MovesAndLogsOnce', async () => {
    const { view, handed, logs, picked } = await shownView();
    const handedBefore = handed.length;
    const logsBefore = logs.length;

    view.focusSideBar();
    view.focusSideBar();
    view.focusMain();

    expect(picked.count).toBe(1);
    expect(
      logs.slice(logsBefore).filter((line) => line.endsWith(' focused')),
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
    const prompt = only(sheet, 'settings-row-actions');
    expect(row.contains(prompt)).toBe(true);
    expect(prompt.dataset.layout).toBe('default');

    view.commands.edit();
    await settle();

    expect(row.contains(only(sheet, 'settings-box'))).toBe(true);
  });

  // Section p's rows are setting rows; with no sections the Keybindings
  // section is second, and its rows are the leader row, then one per bind.
  it.each([
    {
      case: 'a setting row',
      isKeyRow: false,
      actions: [
        { command: 'settings.edit', label: 'edit' },
        { command: 'settings.reset', label: 'reset' },
      ],
    },
    {
      case: 'a key row',
      isKeyRow: true,
      actions: [
        { command: 'settings.open', label: 'reassign' },
        { command: 'settings.addBind', label: 'add key' },
        { command: 'settings.removeBind', label: 'clear' },
        { command: 'settings.reset', label: 'reset' },
      ],
    },
  ])(
    'cursorPrompt_CursorMove_DrawsOnTheReachedRowOnly: $case',
    async ({ isKeyRow, actions }) => {
      const command = {
        id: 'p.pick',
        plugin: 'p',
        label: 'pick',
        group: 'g',
        runsIn: 'page',
        arg: 'number',
      } as const;
      const { view, sheet, anchors, move } = await shownView(
        isKeyRow
          ? {
              schema: {
                ...SCHEMA,
                sections: [],
                commands: { [command.id]: command },
              },
              keymap: {
                binds: [
                  { keys: 'a', scope: 'any', command: command.id, arg: 1 },
                ],
              },
            }
          : {},
      );
      if (isKeyRow) {
        view.openSectionAt(1);
        move('right');
      }
      const draws = { rows: 0, prompts: 0 };
      const countingLayout: SettingsLayout = {
        settingRow(parent, input, kit) {
          draws.rows += 1;
          return defaultLayout.settingRow(parent, input, kit);
        },
        keyRow(parent, input, kit) {
          draws.rows += 1;
          return defaultLayout.keyRow(parent, input, kit);
        },
        cursorPrompt(parent, input, kit) {
          draws.prompts += 1;
          return defaultLayout.cursorPrompt(parent, input, kit);
        },
      };
      view.setLayouts(withUser<SettingsLayout>(defaultLayout, countingLayout));
      draws.rows = 0;
      draws.prompts = 0;

      view.commands.down();

      expect(draws).toEqual({ rows: 0, prompts: 1 });
      expect(findAll(sheet, 'settings-row-actions')).toHaveLength(1);
      expect(livePromptAnchors(anchors)).toEqual(
        actions.map(({ command: id, label }) => ({
          command: id,
          label,
          scope: 'settings.rows',
        })),
      );

      view.setLayouts(
        withUser<SettingsLayout>(defaultLayout, countingLayout, 'again'),
      );

      expect(findAll(sheet, 'settings-row-actions')).toHaveLength(1);
    },
  );

  it.each([
    {
      case: 'first message',
      refusals: ['no write'],
      isReloaded: false,
      text: 'no write',
      layout: 'default',
    },
    {
      case: 'a second message replaces the first',
      refusals: ['no write', 'still no'],
      isReloaded: false,
      text: 'still no',
      layout: 'default',
    },
    {
      case: 'a layout reload draws it in the user layout',
      refusals: ['no write'],
      isReloaded: true,
      text: 'no write',
      layout: 'mine',
    },
  ])(
    'boxMessage_DrawsThroughTheLayout: $case',
    async ({ refusals, isReloaded, text, layout }) => {
      const { view, sheet } = await shownView({ refusals: [...refusals] });
      view.commands.edit();
      await settle();
      const box = only(sheet, 'settings-box');
      const input = only(box, 'settings-box-input') as FocusFakeElement;
      input.value = 'typed';
      for (let attempt = 0; attempt < refusals.length; attempt += 1) {
        view.commands.boxAccept();
        await settle();
      }

      if (isReloaded) {
        setUserLayout(view, {
          boxMessage: (parent, message, kit) =>
            kit.el(parent, 'div', 'settings-box-message', message.text),
        });
      }

      const message = only(sheet, 'settings-box-message');
      expect(message.textContent).toBe(text);
      expect(message.dataset.layout).toBe(layout);
      expect(fakeDocument.activeElement).toBe(input);
    },
  );

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

  it('an open kind picker takes a newer read’s items in place, keeping its cursor item', async () => {
    const { view, overlay, read, written } = await shownView({
      schema: {
        ...SCHEMA,
        sections: [
          {
            id: 'docs',
            title: 'Docs',
            leaves: [
              {
                path: 'docs.layout',
                label: 'Layout',
                description: 'The docs layout',
                control: { kind: 'layout', choices: null },
                fallback: { value: 'default' },
              },
            ],
          },
        ],
      },
    });
    read.layoutNames = { docs: ['default', 'zeta'] };
    view.commands.edit();
    await settle();
    view.commands.pickerDown();

    read.layoutNames = { docs: ['alpha', 'default', 'zeta'] };
    view.reread();
    await settle();

    const rows = findAll(overlay, 'ui-row').map((row) => [
      row.textContent,
      row.classList.contains('is-cursor'),
    ]);
    view.commands.pickerChoose();
    await settle();

    expect(rows).toEqual([
      ['alpha', false],
      ['default', false],
      ['zeta', true],
    ]);
    expect(written).toEqual([{ docs: { layout: 'zeta' } }]);
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
    // Plugins, then Keybindings.
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

  // Section p's rows: Name, then Mode; the sheet scrolled down first.
  it.each([
    {
      case: 'a later row keeps the scroll and follows the row into view',
      moves: ['down'] as const,
      scrollTop: 40,
    },
    {
      case: 'the first row scrolls the sheet to its top',
      moves: ['down', 'up'] as const,
      scrollTop: 0,
    },
  ])('markCursor_ScrollsToTheCursor: $case', async ({ moves, scrollTop }) => {
    const { view, sheet } = await shownView();
    const scrolled = vi.spyOn(FakeElement.prototype, 'scrollIntoView');
    sheet.scrollTop = 40;

    for (const move of moves) {
      view.commands[move]();
    }

    expect(sheet.scrollTop).toBe(scrollTop);
    // Only the move down to Mode follows a row into view.
    expect(scrolled).toHaveBeenCalledTimes(1);
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

  const NO_LEADER_CURSORS = { groups: null, items: null };

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
            control: { kind: 'string', choices: null },
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
        leaderCursors: NO_LEADER_CURSORS,
      },
      opened: 'section q',
      sectionsCursor: 1,
      cursorKey: 'q.size',
      isFilterShown: true,
    },
    {
      // Sections p, q, Plugins, Keybindings and Leader menu: index 4 is the
      // last.
      name: 'a sections cursor past the last section',
      saved: {
        sectionsCursor: 9,
        openSectionId: 'q',
        cursorKey: 'q.size',
        filter: '',
        leaderCursors: NO_LEADER_CURSORS,
      },
      opened: 'section q',
      sectionsCursor: 4,
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
        leaderCursors: NO_LEADER_CURSORS,
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
        leaderCursors: NO_LEADER_CURSORS,
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
              control: { kind: 'number', choices: null },
              fallback: { value: 1000 },
            },
            {
              path: 'plugins.disabled',
              label: 'Disabled plugins',
              description: 'The plugins that do not run',
              control: { kind: 'json', choices: null },
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
    return {
      id,
      label,
      description: `Adds ${label}.`,
      on,
      neededBy,
      origin: 'built-in',
      problem: null,
    };
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

  // `drawnOn` is the status the row draws with; the pick always sees it on.
  it.each([
    {
      name: 'no reason',
      drawnOn: true,
      reason: null,
      written: [{ plugins: { disabled: ['gallery'] } }],
      refused: [],
      toasts: [],
    },
    {
      name: 'a reason',
      drawnOn: true,
      reason: 'Gallery is needed by X',
      written: [],
      refused: ['refused settings.json: Gallery is needed by X'],
      toasts: [['Gallery is needed by X', 'error']],
    },
    {
      name: 'off at draw, on at pick',
      drawnOn: false,
      reason: null,
      written: [{ plugins: { disabled: ['gallery'] } }],
      refused: [],
      toasts: [],
    },
  ])(
    'pluginRow_PickFalse_AsksMayDisableFirst: $name',
    async ({
      drawnOn,
      reason,
      written: expected,
      refused,
      toasts: expectedToasts,
    }) => {
      let galleryOn = drawnOn;
      const { view, written, asked, logs, toasts } = await pickerOnPlugin(
        'gallery',
        {
          schema: pluginsSchema([]),
          plugins: () => [status('gallery', 'Gallery', galleryOn)],
          mayDisable: async () => reason,
        },
      );
      galleryOn = true;

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

  it.each([
    {
      case: 'mayDisable rejects',
      held: 'mayDisable',
      outcome: 'reject',
      value: () => undefined,
      before: {},
    },
    {
      case: 'the write resolves',
      held: 'writeSettings',
      outcome: 'resolve',
      value: () => ({ type: 'written' }),
      before: {},
    },
    {
      case: 'the write rejects',
      held: 'writeSettings',
      outcome: 'reject',
      value: () => undefined,
      before: {},
    },
    {
      case: 'the read after a write changed on disk resolves',
      held: 'read',
      outcome: 'resolve',
      value: (setup: { read: UserConfigRead }) => setup.read,
      before: { writeSettings: { type: 'changedOnDisk' } },
    },
  ] as const)(
    'a reply landing after dispose logs, toasts and writes nothing: $case',
    async ({ held, outcome, value, before }) => {
      const reply = deferred<unknown>();
      let isArmed = false;
      const setup = await pickerOnPlugin('gallery', {
        schema: pluginsSchema([]),
        plugins: () => [status('gallery', 'Gallery', true)],
        held: (method) =>
          isArmed && method === held
            ? reply.promise
            : isArmed && method in before
              ? Promise.resolve(before[method as keyof typeof before])
              : undefined,
      });
      isArmed = true;
      setup.view.commands.pickerDown();
      setup.view.commands.pickerChoose();
      await settle();
      setup.view.dispose();
      const logsBefore = [...setup.logs];
      const toastsBefore = [...setup.toasts];
      const writtenBefore = [...setup.written];
      const handedBefore = setup.handed.length;

      if (outcome === 'resolve') {
        reply.resolve(value(setup));
      } else {
        reply.reject(new Error('late'));
      }
      await settle();

      expect(setup.logs).toEqual(logsBefore);
      expect(setup.toasts).toEqual(toastsBefore);
      expect(setup.written).toEqual(writtenBefore);
      expect(setup.handed).toHaveLength(handedBefore);
    },
  );

  it.each([
    { case: 'resolves', outcome: 'resolve' },
    { case: 'rejects', outcome: 'reject' },
  ] as const)(
    'the read before a row action that $case after dispose opens and logs nothing',
    async ({ outcome }) => {
      const reply = deferred<unknown>();
      let isArmed = false;
      const setup = await shownView({
        held: (method) =>
          isArmed && method === 'read' ? reply.promise : undefined,
      });
      isArmed = true;
      setup.view.commands.edit();
      await settle();
      setup.view.dispose();
      const logsBefore = [...setup.logs];
      const toastsBefore = [...setup.toasts];

      if (outcome === 'resolve') {
        reply.resolve(setup.read);
      } else {
        reply.reject(new Error('late'));
      }
      await settle();

      expect(setup.logs).toEqual(logsBefore);
      expect(setup.toasts).toEqual(toastsBefore);
      expect(findAll(setup.sheet, 'settings-box')).toEqual([]);
    },
  );

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

  it('sections_ListPluginsBeforeKeybindings_AndCoreHasNoListRow', async () => {
    const { view, sheet } = await shownView({ schema: pluginsSchema([]) });
    setUserLayout(view, {
      settingRow: (parent, input, kit) =>
        kit.el(parent, 'li', 'mine-row', input.path),
    });

    const sectionTitles = findAll(asFake(view.sideBar), 'ui-row-label').map(
      (label) => label.textContent,
    );
    expect(sectionTitles).toEqual([
      'Core',
      'P',
      'Plugins',
      'Keybindings',
      'Leader menu',
    ]);
    expect(findAll(sheet, 'mine-row').map((row) => row.textContent)).toEqual([
      'keySequenceTimeoutMs',
    ]);
  });

  // SCHEMA's sections: p, Plugins, then Keybindings.
  const KEYS_INDEX = 2;

  // A view open on the Keybindings section with the rows focused.
  async function keysView() {
    const shown = await shownView();
    shown.view.openSectionAt(KEYS_INDEX);
    shown.move('right');
    return shown;
  }

  it('keysSection_FilterKey_CyclesChipsAndLogs', async () => {
    const inSchemaSection = await shownView();
    const schemaLogsBefore = inSchemaSection.logs.length;
    inSchemaSection.view.commands.cycleKeyFilter();
    const { view, logs } = await keysView();
    const logsBefore = logs.length;

    for (let press = 0; press < 4; press++) {
      view.commands.cycleKeyFilter();
    }

    expect(inSchemaSection.logs.slice(schemaLogsBefore)).toEqual([]);
    expect(
      logs.slice(logsBefore).filter((line) => line.startsWith('key filter')),
    ).toEqual([
      'key filter bound',
      'key filter unbound',
      'key filter changed',
      'key filter all',
    ]);
  });

  it('keysSection_FindByKey_EscClearsFirst', async () => {
    const { view, logs, capture, sheet } = await keysView();
    view.commands.filter();
    const filter = only(
      only(sheet, 'settings-filter'),
      'settings-box-input',
    ) as FocusFakeElement;
    filter.value = 'x';
    filter.fire('input');
    view.commands.boxAccept();

    view.commands.findByKey();
    capture.press('j');
    const logsBefore = logs.length;
    view.commands.clearFilter();

    expect(logs).toContain('find by key j');
    expect(logs.slice(logsBefore)).toEqual(['find by key cleared']);
    expect(only(sheet, 'settings-filter').hidden).toBe(false);
  });

  it.each([
    {
      case: 'opening a section',
      end: (view: SettingsView) => view.openSectionAt(0),
    },
    { case: 'hiding the mode', end: (view: SettingsView) => view.hidden() },
  ])('recording_EndsOnSectionOpenAndHide: $case', async ({ end }) => {
    const { view, capture, logs } = await keysView();
    view.commands.findByKey();

    end(view);

    expect(capture.isArmed()).toBe(false);
    expect(capture.counts.disposes).toBe(1);
    expect(logs).toContain('recording cancelled find');
  });

  it('keysSection_ChipHidesTheCursorRow_CursorMovesToTheFirstMatch', async () => {
    const command = (id: string) =>
      ({ id, plugin: 'p', label: id, group: 'g', runsIn: 'page' }) as const;
    const { view, places, move } = await shownView({
      schema: {
        ...SCHEMA,
        commands: {
          'p.a': command('p.a'),
          'p.b': command('p.b'),
          'p.c': command('p.c'),
        },
        defaultBindLayers: [
          [
            { keys: 'x', scope: 'any', command: 'p.a' },
            { keys: 'y', scope: 'any', command: 'p.c' },
          ],
        ],
      },
    });
    view.openSectionAt(KEYS_INDEX);
    move('right');
    view.moveToRow('p.b');

    view.commands.cycleKeyFilter();

    expect(places.at(-1)?.cursorKey).toBe('p.a');
  });

  it('recording_Find_SurvivesRedraw', async () => {
    const { view, capture } = await keysView();
    view.commands.findByKey();

    view.reread();
    await settle();

    expect(capture.isArmed()).toBe(true);
  });

  // SCHEMA's sections with a b group holding a, and c at the top level:
  // p, Plugins, Keybindings, then the Leader menu.
  const LEADER_INDEX = 3;
  const LEADER_SCHEMA: UserConfigSchema = {
    ...SCHEMA,
    commands: {
      'p.a': { id: 'p.a', plugin: 'p', label: 'a', group: 'g', runsIn: 'page' },
      'p.c': { id: 'p.c', plugin: 'p', label: 'c', group: 'g', runsIn: 'page' },
    },
    defaultBindLayers: [
      [
        { keys: '<Leader>ba', scope: 'any', command: 'p.a' },
        { keys: '<Leader>c', scope: 'any', command: 'p.c' },
      ],
    ],
  };

  // A view open on the Leader menu with its groups pane focused.
  async function leaderView(options: ShownViewOptions = {}) {
    const shown = await shownView({ schema: LEADER_SCHEMA, ...options });
    shown.view.openSectionAt(LEADER_INDEX);
    shown.move('right');
    return shown;
  }

  it('leaderMenu_Routing_CommandsReachTheView', async () => {
    const { view, logs, sheet } = await leaderView();
    const filterShown = () => !only(sheet, 'settings-filter').hidden;

    view.commands.filter();
    const isShownFromRows = filterShown();
    view.commands.down();
    view.commands.renameGroup();
    view.commands.boxCancel();
    view.focusSideBar();
    view.commands.filter();

    expect(isShownFromRows).toBe(false);
    expect(filterShown()).toBe(false);
    expect(logs).toContain('leader groups focused');
    expect(logs).toContain('cursor group <Leader>b');
    expect(logs).toContain('box open group <Leader>b');
  });

  // Top level's items: the b group, then c.
  it.each([
    {
      case: 'open on the groups pane focuses the items pane',
      act: (view: SettingsView) => view.commands.open(),
      log: 'leader items focused',
    },
    {
      case: 'open on a nested group row opens the group',
      act(view: SettingsView) {
        view.commands.open();
        view.commands.open();
      },
      log: 'cursor group <Leader>b',
    },
    {
      case: 'open on an item row, changing its action, is refused',
      act(view: SettingsView) {
        view.commands.open();
        view.commands.down();
        view.commands.open();
      },
      log: 'cursor item any <Leader>c',
    },
    {
      case: 'add is refused',
      act: (view: SettingsView) => view.commands.addBind(),
      log: 'leader groups focused',
    },
  ])('leaderMenu_BrokenKeymap_OpenStillMoves: $case', async ({ act, log }) => {
    const { view, logs, overlay, capture } = await leaderView({
      keymapRead: { state: 'broken', problem: 'bad json', text: '{' },
    });

    act(view);
    await settle();

    expect(logs).toContain(log);
    expect(only(overlay, 'ui-picker-layer').hidden).toBe(true);
    expect(capture.isArmed()).toBe(false);
  });

  it('leaderMenu_Recording_SurvivesRedraw', async () => {
    const { view, capture, logs } = await leaderView();
    view.commands.down();
    view.commands.open();
    view.commands.changeKey();

    view.reread();
    await settle();

    expect(logs).toContain('recording item any <Leader>ba');
    expect(capture.isArmed()).toBe(true);
  });

  it.each([
    {
      name: 'held rows',
      saved: { groups: 'group <Leader>b', items: 'item any <Leader>ba' },
      restored: { groups: 'group <Leader>b', items: 'item any <Leader>ba' },
    },
    {
      name: 'gone rows',
      saved: { groups: 'group <Leader>z', items: 'item any <Leader>za' },
      restored: { groups: 'group top', items: null },
    },
  ])(
    'leaderMenu_RestoredPlace_PutsBackItsCursors: $name',
    async ({ saved, restored }) => {
      const { places } = await shownView({
        schema: LEADER_SCHEMA,
        restored: {
          sectionsCursor: LEADER_INDEX,
          openSectionId: 'leader',
          cursorKey: null,
          filter: '',
          leaderCursors: saved,
        },
      });

      expect(places.at(-1)?.leaderCursors).toEqual(restored);
    },
  );

  it('leaderMenu_RowClickAndMoves_MoveItsPaneCursorAndReportIt', async () => {
    vi.stubGlobal('Element', FakeElement);
    const { view, sheet, runs, logs, places, anchors } = await leaderView();
    // The groups top and b, then Top level's items: b, c and add.
    const row = findAll(sheet, 'settings-leader-row')[3];
    // Only the groups pane has a cursor row yet: Top level.
    expect(livePromptAnchors(anchors)).toEqual([
      {
        command: 'settings.addBind',
        label: 'add group',
        scope: 'settings.leaderGroups',
      },
    ]);

    row.fire('click', { target: row });
    const [[command, key]] = runs;
    view.moveToRow(key as string);

    const clicked = places.at(-1)?.leaderCursors;
    view.commands.up();

    expect(command).toBe('settings.moveToRow');
    expect(logs).toContain('leader items focused');
    expect(clicked).toEqual({
      groups: 'group top',
      items: 'item any <Leader>c',
    });
    expect(places.at(-1)?.leaderCursors.items).toBe('opens <Leader>b');
    // Top level's prompt stays; the nested group row's is `open`.
    expect(livePromptAnchors(anchors)).toEqual([
      {
        command: 'settings.addBind',
        label: 'add group',
        scope: 'settings.leaderGroups',
      },
      {
        command: 'settings.open',
        label: 'open',
        scope: 'settings.leaderItems',
      },
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

  // Section `p` holding one leaf of kind `nope`, which no registration holds,
  // the user's value `{ a: 1 }`.
  const UNREGISTERED: UserConfigSchema = {
    ...SCHEMA,
    sections: [
      {
        id: 'p',
        title: 'P',
        leaves: [
          {
            path: 'p.blob',
            label: 'Blob',
            description: 'A blob',
            control: { kind: 'nope', choices: null },
            fallback: { value: null },
          },
        ],
      },
    ],
  };

  it('settingRow_UnregisteredKind_DrawsJsonTextAndResetsOnly', async () => {
    const { view, sheet, overlay, written } = await shownView({
      schema: UNREGISTERED,
      settingsLayer: { p: { blob: { a: 1 } }, theme: 't' },
    });

    const values = findAll(sheet, 'settings-row-value').map(
      (value) => value.textContent,
    );
    view.commands.edit();
    await settle();
    const boxes = findAll(sheet, 'settings-box').length;
    const shownPickers = findAll(overlay, 'ui-picker-layer').filter(
      (layer) => !layer.hidden,
    ).length;
    view.commands.reset();
    await settle();

    expect(values).toEqual(['{"a":1}']);
    expect([boxes, shownPickers]).toEqual([0, 0]);
    expect(written).toEqual([{ theme: 't' }]);
  });

  it.each([
    { when: 'after the load', isBeforeLoad: false },
    { when: 'before the load reads the schema', isBeforeLoad: true },
  ])(
    'controlKindsChanged_RedrawsTheOpenSection: $when',
    async ({ isBeforeLoad }) => {
      let drawn: SettingControlKind | undefined;
      const drawnKind: SettingControlKind = {
        id: 'choice',
        text: () => 'drawn',
        edit: { type: 'picker', items: () => [], label: String },
      };
      const { view, sheet } = await shownView({
        controlKind: (id) => (id === 'choice' ? drawn : builtInKind(id)),
        beforeLoad: (created) => {
          if (isBeforeLoad) {
            drawn = drawnKind;
            created.controlKindsChanged();
          }
        },
      });
      drawn = drawnKind;

      view.controlKindsChanged();

      expect(
        findAll(sheet, 'settings-row-value').map((value) => value.textContent),
      ).toEqual(['', 'drawn']);
    },
  );

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

  // `end` lists the row end's children by class or text: `failed`, the origin
  // Tag's text, `lock`, then the value.
  it.each([
    {
      name: 'built-in with no problem',
      origin: 'built-in',
      on: true,
      problem: null,
      neededBy: [],
      end: ['true'],
    },
    {
      name: 'user',
      origin: 'user',
      on: true,
      problem: null,
      neededBy: [],
      end: ['user', 'true'],
    },
    {
      name: 'replaced built-in with a problem',
      origin: 'replaces-built-in',
      on: false,
      problem: 'Did not start: boom',
      neededBy: [],
      end: ['failed', 'replaces built-in', 'false'],
    },
    {
      name: 'locked replaced built-in with a problem',
      origin: 'replaces-built-in',
      on: true,
      problem: 'Did not start: boom',
      neededBy: ['b'],
      end: ['failed', 'replaces built-in', 'lock', 'true'],
    },
    {
      name: 'user whose last good version runs',
      origin: 'user',
      on: true,
      problem: 'Did not start: boom',
      neededBy: [],
      end: ['failed', 'user', 'true'],
    },
    {
      name: 'built-in with a held-back problem',
      origin: 'built-in',
      on: true,
      problem: 'needs plugin "z", which is not loaded',
      neededBy: [],
      end: ['failed', 'true'],
    },
  ] as const)(
    'pluginRow_OriginAndProblem_DrawsTagsAndLine: $name',
    async ({ origin, on, problem, neededBy, end }) => {
      const { view, sheet } = await shownView({
        schema: pluginsSchema([]),
        plugins: () => [
          { ...status('gallery', 'Gallery', on, neededBy), origin, problem },
          status('b', 'Bee', true),
        ],
      });

      view.openSectionAt(PLUGINS_INDEX);

      const [row] = findAll(sheet, 'settings-row');
      const [rowEnd] = findAll(row, 'settings-row-end');
      expect(
        rowEnd.children.map((child) => {
          if (child.classList.contains('settings-row-failed')) {
            expect(child.classList.contains('ui-tag--error')).toBe(true);
            return child.textContent;
          }
          if (child.classList.contains('settings-row-origin')) {
            expect(child.classList.contains('ui-tag--neutral')).toBe(true);
            return child.textContent;
          }
          if (child.classList.contains('settings-row-lock')) {
            return 'lock';
          }
          if (child.classList.contains('settings-row-value')) {
            return child.textContent;
          }
          return `unexpected ${child.className}`;
        }),
      ).toEqual(end);
      expect(
        findAll(row, 'settings-row-problem').map((line) => line.textContent),
      ).toEqual(problem === null ? [] : [problem]);
    },
  );
});
