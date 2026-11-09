import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeFuzzyMatcher } from '../../../shared/fake-fuzzy-matcher.test-support';
import type { KeyBind, UserKeymap } from '../../../contracts/keymap';
import type { FocusTarget, PaneDirection } from '../../../contracts/panes';
import type { CommandInfo } from '../../../contracts/plugin';
import type { UserConfigSchema } from '../../../contracts/user-config';
import { installFocusFakeDom } from '../../../shared/page/test-dom';
import type { Judgement, RecordRequest } from './key-recorder';
import type { CommandRow } from './keymap-rows';
import type { BuiltRow } from './layout/settings-kit';
import type { LeaderGroup } from './leader-tree';
import {
  createLeaderMenuView,
  type LeaderMenuView,
  type LeaderScope,
} from './leader-menu-view';
import type { BoxRequest, RowBox } from './row-box';
import type { CommitVia, PickRequest, RowContext } from './settings-view';

function command(
  id: string,
  label: string,
  extra: Partial<CommandInfo> = {},
): CommandInfo {
  const [plugin] = id.split('.');
  return { id, plugin, label, group: plugin, runsIn: 'page', ...extra };
}

const CLOSE = 'sessions.closeSession';
const NEW = 'sessions.newSession';

const SCHEMA: UserConfigSchema = {
  sections: [],
  commands: {
    [CLOSE]: command(CLOSE, 'close session'),
    [NEW]: command(NEW, 'new session'),
    'p.scoped': command('p.scoped', 'scoped'),
    'p.free': command('p.free', 'free'),
    'p.pick': command('p.pick', 'pick', { arg: 'number' }),
  },
  scopes: [{ id: 'p.s', title: 'In p', plugin: 'p' }],
  defaultBindLayers: [
    [
      { keys: '<Leader>bd', scope: 'any', command: CLOSE },
      { keys: '<Leader>bn', scope: 'any', command: NEW },
      { keys: '<Leader>bs', scope: 'p.s', command: 'p.scoped' },
    ],
  ],
  defaultAccelerators: { app: [], global: [], intercept: [] },
  defaultGroups: { '<Leader>b': 'session' },
  defaultLeader: '<Space>',
};

interface Commit {
  layer: UserKeymap;
  via: CommitVia;
  written?: () => void;
}

// A Leader menu over SCHEMA and `layer`, drawn and focused on the groups
// pane, keeping every commit, recording, picker, box, toast, log line, scope
// and focus target it hands out. `land` applies the last commit as a
// landed write does: the layer changes, `written` runs, the rows redraw.
function shownMenu(layer: UserKeymap | null = null) {
  let current = layer;
  const committed: Commit[] = [];
  const recordings: RecordRequest[] = [];
  const pickers: PickRequest<unknown>[] = [];
  const boxes: BoxRequest[] = [];
  const toasts: string[] = [];
  const logs: string[] = [];
  const scopes: LeaderScope[] = [];
  const targets: FocusTarget[] = [];
  const unread = () => {
    throw new Error('not read by the Leader menu');
  };
  const context: RowContext = {
    schema: SCHEMA,
    platform: 'macos',
    read: unread,
    settingsLayer: unread,
    keymapLayer: () => current,
    matcher: fakeFuzzyMatcher,
    openBox: (request) => boxes.push(request),
    closeBox: () => undefined,
    boxProblem: unread,
    openPicker: <T>(picker: PickRequest<T>) =>
      pickers.push(picker as unknown as PickRequest<unknown>),
    commitSettings: unread,
    commitKeymap: (written, via, landed) =>
      committed.push({ layer: written, via, written: landed }),
    toast: (text) => toasts.push(text),
    plugins: unread,
    mayDisable: unread,
    refuse: unread,
    recordKey: (request) => recordings.push(request),
    recording: () => null,
  };
  const parent = document.createElement('div');
  const view: LeaderMenuView = createLeaderMenuView({
    context,
    drawPanes: () => ({
      element: document.createElement('li'),
      groupRows: document.createElement('ol'),
      itemRows: document.createElement('ol'),
    }),
    drawRow(_row, at): BuiltRow {
      const element = document.createElement('li');
      at.append(element);
      return {
        element,
        actions: document.createElement('span'),
        box: document.createElement('div'),
      };
    },
    anchor: () => ({ dispose: () => undefined }),
    setScope: (scope) => scopes.push(scope),
    setFocusTarget: (target) => targets.push(target),
    redraw: () => view.draw(parent),
    log: (line) => logs.push(line),
  });
  view.draw(parent);
  view.focus();
  const land = () => {
    const last = committed[committed.length - 1];
    current = last.layer;
    last.written?.();
    view.draw(parent);
  };
  // The last `cursor` line logged.
  const cursor = () =>
    logs.filter((line) => line.startsWith('cursor ')).at(-1) ?? null;
  return {
    view,
    committed,
    recordings,
    pickers,
    boxes,
    toasts,
    logs,
    scopes,
    targets,
    land,
    cursor,
    redraw: () => view.draw(parent),
  };
}

type Menu = ReturnType<typeof shownMenu>;

// Puts the items cursor `down` rows into the group `downGroups` rows below
// Top level: Top level, then `<Leader>b`, then any user group.
function onItem(menu: Menu, downGroups: number, down: number) {
  for (let step = 0; step < downGroups; step++) {
    menu.view.commands.down();
  }
  menu.view.commands.open();
  for (let step = 0; step < down; step++) {
    menu.view.commands.down();
  }
}

// `<Leader>b`'s items: d, n, s, then the add row.
const onSessionItem = (menu: Menu, down: number) => onItem(menu, 1, down);

function pickRow(menu: Menu, index: number, id: string) {
  const picker = menu.pickers[index] as PickRequest<CommandRow>;
  const row = picker.items.find((each) => each.command.id === id);
  if (row === undefined) {
    throw new Error(`no ${id} in ${picker.title}`);
  }
  picker.chosen(row, 'text');
  return picker;
}

function boxWith(request: BoxRequest, text: string): RowBox {
  return {
    key: request.key,
    element: document.createElement('div'),
    expectedText: null,
    text: () => text,
    accept: () => request.accept(boxWith(request, text)),
    showMessage: () => undefined,
    focus: () => undefined,
    keepFocusAcross: (move) => move(),
    destroy: () => undefined,
  };
}

const bind = (keys: string, cmd: string, extra: Partial<KeyBind> = {}) => ({
  keys,
  scope: 'any' as const,
  command: cmd,
  ...extra,
});

describe('createLeaderMenuView', () => {
  beforeEach(() => {
    installFocusFakeDom((name, value) => vi.stubGlobal(name, value));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each<{
    pane: 'groups' | 'items';
    direction: PaneDirection;
    moved: boolean;
    scope: LeaderScope;
  }>([
    { pane: 'groups', direction: 'right', moved: true, scope: 'leaderItems' },
    { pane: 'items', direction: 'left', moved: true, scope: 'leaderGroups' },
    { pane: 'groups', direction: 'left', moved: false, scope: 'leaderGroups' },
    { pane: 'items', direction: 'right', moved: false, scope: 'leaderItems' },
    { pane: 'groups', direction: 'up', moved: false, scope: 'leaderGroups' },
    { pane: 'items', direction: 'down', moved: false, scope: 'leaderItems' },
  ])(
    'leaderMenu_FocusTarget_MovesBetweenPanes: $pane $direction',
    ({ pane, direction, moved, scope }) => {
      const menu = shownMenu();
      if (pane === 'items') {
        menu.view.commands.open();
      }

      expect(menu.targets.at(-1)?.move(direction)).toBe(moved);

      expect(menu.scopes.at(-1)).toBe(scope);
    },
  );

  it.each<{
    case: string;
    layer: UserKeymap | null;
    on: (menu: Menu) => void;
    act: (menu: Menu) => void;
    expected: UserKeymap[];
  }>([
    {
      case: 'change key',
      layer: null,
      on: (menu) => onSessionItem(menu, 0),
      act(menu) {
        menu.view.commands.changeKey();
        menu.recordings[0].keep('q');
      },
      expected: [
        {
          unbind: [{ keys: '<Leader>bd', scope: 'any' }],
          binds: [bind('<Leader>bq', CLOSE)],
        },
      ],
    },
    {
      case: 'change key onto its own keys',
      layer: null,
      on: (menu) => onSessionItem(menu, 0),
      act(menu) {
        menu.view.commands.changeKey();
        menu.recordings[0].keep('d');
      },
      expected: [],
    },
    {
      case: 'move to group',
      layer: null,
      on: (menu) => onSessionItem(menu, 0),
      act(menu) {
        menu.view.commands.moveToGroup();
        const picker = menu.pickers[0] as PickRequest<LeaderGroup>;
        picker.chosen(picker.items[0], null);
        menu.recordings[0].keep('q');
      },
      expected: [
        {
          unbind: [{ keys: '<Leader>bd', scope: 'any' }],
          binds: [bind('<Leader>q', CLOSE)],
        },
      ],
    },
    {
      case: 'change action drops the argument',
      layer: { binds: [bind('<Leader>x', 'p.pick', { arg: 2 })] },
      // Top level's items: the b group, then x.
      on: (menu) => onItem(menu, 0, 1),
      act(menu) {
        menu.view.commands.open();
        pickRow(menu, 0, 'p.free');
      },
      expected: [{ binds: [bind('<Leader>x', 'p.free')] }],
    },
    {
      case: 'clear',
      layer: null,
      on: (menu) => onSessionItem(menu, 0),
      act: (menu) => menu.view.commands.removeBind(),
      expected: [{ unbind: [{ keys: '<Leader>bd', scope: 'any' }] }],
    },
    {
      case: 'reset',
      layer: {
        unbind: [{ keys: '<Leader>bd', scope: 'any' }],
        binds: [bind('<Leader>bq', CLOSE)],
      },
      // b's items: n, q, s.
      on: (menu) => onSessionItem(menu, 1),
      act: (menu) => menu.view.commands.reset(),
      expected: [{}],
    },
  ])('leaderMenu_ItemEdit_Commits: $case', ({ layer, on, act, expected }) => {
    const menu = shownMenu(layer);
    on(menu);

    act(menu);

    expect(menu.committed.map((each) => each.layer)).toEqual(expected);
  });

  it('leaderMenu_ChangeAction_MovesAnAlreadyBoundCommand', () => {
    const menu = shownMenu();
    onSessionItem(menu, 0);

    menu.view.commands.open();
    const picker = pickRow(menu, 0, NEW);

    expect(menu.committed.map((each) => each.layer)).toEqual([
      {
        unbind: [
          { keys: '<Leader>bd', scope: 'any' },
          { keys: '<Leader>bn', scope: 'any' },
        ],
        binds: [bind('<Leader>bd', NEW)],
      },
    ]);
    const newRow = picker.items.find(
      (each) => (each as CommandRow).command.id === NEW,
    );
    expect(newRow && picker.keysOf?.(newRow)).toBe('Space b n');
  });

  it.each([
    {
      case: 'Add_MovesAnAlreadyBoundCommand',
      id: NEW,
      key: 'q',
      expected: [
        {
          unbind: [{ keys: '<Leader>bn', scope: 'any' }],
          binds: [bind('<Leader>bq', NEW)],
        },
      ],
      toasts: [],
    },
    {
      case: 'Add_AddsAnUnboundCommand',
      id: 'p.free',
      key: 'q',
      expected: [{ binds: [bind('<Leader>bq', 'p.free')] }],
      toasts: [],
    },
    {
      case: 'Add_AnyOverAScopedItem_Refused',
      id: 'p.free',
      key: 's',
      expected: [],
      toasts: ['Space b s already runs "scoped" in In p'],
    },
  ])('leaderMenu_$case', ({ id, key, expected, toasts }) => {
    const menu = shownMenu();
    onSessionItem(menu, 0);

    menu.view.commands.addBind();
    menu.recordings[0].keep(key);
    pickRow(menu, 0, id);
    menu.pickers[1].chosen('any', null);

    expect(menu.recordings[0].key).toBe('add <Leader>b');
    expect(menu.pickers.map((each) => each.title)).toEqual(['Action', 'Scope']);
    expect(menu.committed.map((each) => each.layer)).toEqual(expected);
    expect(menu.toasts).toEqual(toasts);
  });

  it.each([
    {
      result: 'written',
      isWritten: true,
      cursor: 'cursor item any <Leader>bq set',
    },
    {
      result: 'refused, changed on disk or rejected',
      isWritten: false,
      cursor: 'cursor item any <Leader>bn',
    },
  ])(
    'leaderMenu_Commit_FollowsTheCursorOnlyWhenWritten: $result',
    ({ isWritten, cursor }) => {
      const menu = shownMenu();
      onSessionItem(menu, 0);
      menu.view.commands.changeKey();
      menu.recordings[0].keep('q');
      const [commit] = menu.committed;
      if (!isWritten) {
        commit.written = undefined;
      }

      menu.land();

      expect(menu.cursor()).toBe(cursor);
    },
  );

  it.each<{
    case: string;
    on: (menu: Menu) => void;
    start: (menu: Menu) => void;
    keys: string;
    expected: Judgement;
  }>([
    {
      case: 'chord',
      on: (menu) => onSessionItem(menu, 0),
      start: (menu) => menu.view.commands.changeKey(),
      keys: '<C-x>',
      expected: {
        type: 'refused',
        note: 'A leader item is one key with no Ctrl, Alt or Cmd',
        reason: 'chord',
      },
    },
    {
      case: 'group',
      on: (menu) => menu.view.commands.open(),
      start: (menu) => menu.view.commands.addBind(),
      keys: 'b',
      expected: {
        type: 'refused',
        note: 'Space b opens the session group',
        reason: 'group',
      },
    },
    {
      case: 'taken in any',
      on: (menu) => onSessionItem(menu, 0),
      start: (menu) => menu.view.commands.changeKey(),
      keys: 'n',
      expected: {
        type: 'refused',
        note: 'Space b n already runs "new session"',
        reason: 'taken',
      },
    },
    {
      case: 'taken in a scope',
      on: (menu) => onSessionItem(menu, 0),
      start: (menu) => menu.view.commands.changeKey(),
      keys: 's',
      expected: {
        type: 'refused',
        note: 'Space b s already runs "scoped" in In p',
        reason: 'taken',
      },
    },
    {
      case: 'free',
      on: (menu) => onSessionItem(menu, 0),
      start: (menu) => menu.view.commands.changeKey(),
      keys: 'z',
      expected: { type: 'free' },
    },
  ])('leaderMenu_RecordJudgement: $case', ({ on, start, keys, expected }) => {
    const menu = shownMenu();
    on(menu);
    start(menu);

    expect(menu.recordings[0].judge(keys)).toEqual(expected);
  });

  it.each<{
    case: string;
    layer: UserKeymap | null;
    downGroups: number;
    act: (menu: Menu) => void;
    committed: UserKeymap[];
    toasts: string[];
  }>([
    {
      case: 'rename to a name',
      layer: null,
      downGroups: 1,
      act(menu) {
        menu.view.commands.renameGroup();
        boxWith(menu.boxes[0], 'mine').accept();
      },
      committed: [{ groups: { '<Leader>b': 'mine' } }],
      toasts: [],
    },
    {
      case: 'rename to empty removes the entry',
      layer: { groups: { '<Leader>b': 'mine' } },
      downGroups: 1,
      act(menu) {
        menu.view.commands.renameGroup();
        boxWith(menu.boxes[0], '').accept();
      },
      committed: [{}],
      toasts: [],
    },
    {
      case: 'rename to the default name removes the entry',
      layer: { groups: { '<Leader>b': 'mine' } },
      downGroups: 1,
      act(menu) {
        menu.view.commands.renameGroup();
        boxWith(menu.boxes[0], 'session').accept();
      },
      committed: [{}],
      toasts: [],
    },
    {
      case: 'add group',
      layer: null,
      downGroups: 0,
      act(menu) {
        menu.view.commands.addBind();
        menu.recordings[0].keep('q');
        boxWith(menu.boxes[0], 'quick').accept();
      },
      committed: [{ groups: { '<Leader>q': 'quick' } }],
      toasts: [],
    },
    {
      case: 'remove a group with items',
      layer: null,
      downGroups: 1,
      act: (menu) => menu.view.commands.removeBind(),
      committed: [],
      toasts: ['Move or clear its items first'],
    },
    {
      case: 'remove an empty group',
      layer: { groups: { '<Leader>w': 'wide' } },
      downGroups: 2,
      act: (menu) => menu.view.commands.removeBind(),
      committed: [{}],
      toasts: [],
    },
  ])(
    'leaderMenu_GroupEdit: $case',
    ({ layer, downGroups, act, committed, toasts }) => {
      const menu = shownMenu(layer);
      for (let step = 0; step < downGroups; step++) {
        menu.view.commands.down();
      }

      act(menu);

      expect(menu.committed.map((each) => each.layer)).toEqual(committed);
      expect(menu.toasts).toEqual(toasts);
    },
  );

  it('leaderMenu_FocusOnItems_GroupsPromptStaysInItsCursorRow', () => {
    const menu = shownMenu();

    menu.view.commands.open();

    const promptsIn = (key: string) =>
      menu.view.drawnRow(key)?.actions.children.length;
    expect([promptsIn('group top'), promptsIn('opens <Leader>b')]).toEqual([
      1, 1,
    ]);
  });

  it('leaderMenu_CursorFollowsTheMovedBind', () => {
    const menu = shownMenu();
    onSessionItem(menu, 0);
    menu.view.commands.moveToGroup();
    const picker = menu.pickers[0] as PickRequest<LeaderGroup>;
    picker.chosen(picker.items[0], null);
    menu.recordings[0].keep('q');
    const logsBefore = menu.logs.length;

    menu.land();

    expect(menu.logs.slice(logsBefore)).toEqual([
      'cursor group top',
      'cursor item any <Leader>q set',
    ]);
  });
});
