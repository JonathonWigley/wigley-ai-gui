import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeFuzzyMatcher } from '../../../shared/fake-fuzzy-matcher.test-support';
import { fakeListPickerService } from '../../../shared/page/fake-list-picker-service.test-support';
import type { DroppedFile, DropTarget } from '../../../contracts/drops';
import type { EditorEvents, EditorHost } from '../../../contracts/editor';
import type { FocusTarget, PaneDirection } from '../../../contracts/panes';
import type { Paths } from '../../../contracts/paths';
import type { PageChannel } from '../../../contracts/plugin';
import type { FollowupItem } from '../../../shared/followups/followup-file';
import { insertionText } from '../../../shared/page/file-drop/file-chips';
import {
  type RecordedAnchor,
  recordingAnchors,
  USER_LAYOUT,
  withUser as withLayouts,
} from '../../../shared/page/layout-host/test-layouts';
import {
  asFake,
  type FakeElement,
  type FocusFakeDocument,
  type FocusFakeElement,
  findAll,
  installFocusFakeDom,
} from '../../../shared/page/test-dom';
import type { BacklogChannel, BacklogRead } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import type { BacklogLayout } from '../layouts/layout';
import { createBacklogView } from './backlog-view';
import { NO_FENCES } from '../../../shared/page/markdown-mount.test-support';
import { noLayoutState } from '../../../shared/page/layout-host/fake-layout-state.test-support';

const ROOT = '/home/repo/docs/features';

interface CreatedEditor {
  parent: FakeElement;
  doc: string;
  events: EditorEvents;
  isDestroyed: boolean;
  focusOptions: unknown[];
  // Every text inserted at the cursor, which sits after an `x`.
  inserted: string[];
}

function item(title: string): FollowupItem {
  return {
    title,
    oneLine: `${title} gist`,
    tags: [],
    body: '',
    line: 1,
    endLine: 1,
    done: false,
  };
}

// The plan's moved copy, in a linked worktree, and its task's.
const PLAN_COPY = '/wt/docs/features/feature/plan-p/plan.md';
const TASK_COPY = '/wt/docs/features/feature/plan-p/01-t.md';

// One repo with one home holding two follow-ups and one plan of one task.
const READ: BacklogRead = {
  homes: [
    {
      repo: 'repo',
      root: ROOT,
      isCreateTarget: true,
      gitRoot: null,
      uncommitted: false,
      repoFolder: null,
      followupFiles: [
        {
          path: `${ROOT}/followups.md`,
          items: [item('First'), item('Second')],
        },
      ],
      plans: [
        {
          path: `${ROOT}/feature/plan-p/plan.md`,
          copyPath: PLAN_COPY,
          feature: 'feature',
          title: 'Plan',
          checked: 0,
          total: 0,
          target: null,
          written: null,
          tasks: [
            {
              path: `${ROOT}/feature/plan-p/01-t.md`,
              copyPath: TASK_COPY,
              title: 'Task',
              status: null,
            },
          ],
        },
      ],
      features: [],
    },
  ],
  message: null,
};

// Focus fires the editor's focused event, as a real editor's DOM focus does.
function fakeEditorHost() {
  const created: CreatedEditor[] = [];
  const host = {
    create(parent: HTMLElement, doc: string, events: EditorEvents) {
      const editor: CreatedEditor = {
        parent: asFake(parent),
        doc,
        events,
        isDestroyed: false,
        focusOptions: [],
        inserted: [],
      };
      created.push(editor);
      return {
        text: () => editor.doc,
        setText: () => undefined,
        insert: (text: string) => {
          editor.inserted.push(text);
        },
        charBeforeCursor: () => 'x',
        focus: (options: unknown) => {
          editor.focusOptions.push(options);
          events.focused();
        },
        blur: () => events.blurred(),
        destroy: () => {
          editor.isDestroyed = true;
        },
      };
    },
  } as unknown as EditorHost;
  return { host, created };
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// One call to the view's `setScope`, `setResizeTarget` or `setFocusTarget`; a
// target is `'target'` when one was set, else null.
type ScopeCall =
  | ['setScope', string]
  | ['setResizeTarget' | 'setFocusTarget', 'target' | null];

// A Backlog view, shown, over a channel that loads `READ`, with its home
// open and its first follow-up selected. `calls` logs every `setScope`,
// `setResizeTarget` and `setFocusTarget` call, in call order; `move` presses
// the core's focus key toward `direction` on the last focus target set.
// `targets` holds every drop target the view registered; `readDocs` each
// path the view read through the channel; `openedDocs` each path it asked
// Docs to open. `runs` holds each command a click ran with its arg, `logs`
// each line logged and `picked` the count of `homePicked` calls.
async function backlogSetup() {
  const calls: ScopeCall[] = [];
  const readDocs: string[] = [];
  const openedDocs: string[] = [];
  const runs: [string, unknown][] = [];
  const logs: string[] = [];
  const picked = { count: 0 };
  const targets: DropTarget[] = [];
  let focusTarget: FocusTarget | null = null;
  const { host, created } = fakeEditorHost();
  const overlays: FakeElement[] = [];
  const recorded = recordingAnchors();
  const anchors = recorded.anchors;
  const { keys } = recorded;
  const channel = {
    invoke: async (method: string, ...args: unknown[]) => {
      if (method === 'readDoc') {
        readDocs.push(String(args[0]));
      }
      return method === 'load' ? READ : '';
    },
  } as unknown as PageChannel<BacklogChannel>;
  const view = createBacklogView({
    channel,
    editor: host,
    matcher: fakeFuzzyMatcher,
    markdown: {
      block: (text) => text,
      inline: (text) => text,
      document: async (text) => text,
      ...NO_FENCES,
    },
    paths: { tilde: (path: string) => path } as unknown as Paths,
    homeDir: '/home',
    uiState: { get: () => undefined, set: () => undefined },
    timers: { set: () => 0, clear: () => undefined },
    log: (line) => logs.push(line),
    toast: () => undefined,
    drops: {
      addTarget: (target) => {
        targets.push(target);
        return { dispose: () => undefined };
      },
      savePasted: () => Promise.reject(new Error('not used by the backlog')),
    },
    keys,
    platform: 'macos',
    state: noLayoutState,
    commands: {
      exists: () => true,
      argShape: () => undefined,
      run: () => undefined,
    },
    tags: () => ['agent-ready', 'later'],
    openDoc: (path) => openedDocs.push(path),
    setScope: (scope) => calls.push(['setScope', scope]),
    setResizeTarget: (target) =>
      calls.push(['setResizeTarget', target === null ? null : 'target']),
    setFocusTarget: (target) => {
      focusTarget = target;
      calls.push(['setFocusTarget', target === null ? null : 'target']);
    },
    pushScope: () => ({
      pop: () => undefined,
      dispose: () => undefined,
      onBaseChanged: () => ({ dispose: () => undefined }),
    }),
    picker: fakeListPickerService({
      place(element) {
        overlays.push(asFake(element));
      },
    }),
    addOverlay: (element) => {
      overlays.push(asFake(element));
      return { dispose: () => undefined };
    },
    run: () => undefined,
    isShown: () => true,
    revealSideBar: () => undefined,
    homePicked: () => {
      picked.count += 1;
    },
    savedPlace: null,
    placeChanged: () => undefined,
    homeShown: () => undefined,
    runKey: (key, arg) => runs.push([key.id, arg]),
  });
  const sheet = asFake(view.sheet);
  sheet.isPageRoot = true;
  view.load();
  await settle();
  view.commands.toggle();
  await settle();
  picked.count = 0;
  const move = (direction: PaneDirection) =>
    focusTarget?.move(direction) ?? false;
  return {
    view,
    created,
    anchors,
    overlays,
    sheet,
    calls,
    move,
    targets,
    readDocs,
    openedDocs,
    runs,
    logs,
    picked,
  };
}

// The side bar's home rows and the list's rows, as drawn now.
function drawnRows(setup: Awaited<ReturnType<typeof backlogSetup>>) {
  const [list] = findAll(setup.sheet, 'backlog-rows');
  return {
    homes: findAll(asFake(setup.view.sideBar), 'ui-row'),
    items: list.children.filter((row) => row.classList.contains('ui-row')),
  };
}

// The key the second list row's click runs `backlog.selectRow` with.
function secondRowKey(setup: Awaited<ReturnType<typeof backlogSetup>>) {
  drawnRows(setup).items[1].click();
  const [, key] = setup.runs.splice(0).at(-1) ?? [];
  return key as string;
}

function withUser(layout: BacklogLayout) {
  return withLayouts<BacklogLayout>(defaultLayout, layout);
}

// The live editors mounted for `field`.
function liveEditors(created: CreatedEditor[], field: string) {
  return created.filter(
    (editor) =>
      !editor.isDestroyed &&
      editor.parent.classList.contains(`backlog-editor-box--${field}`),
  );
}

// A user editor pane that mounts only the title box.
const titleOnlyEditor: BacklogLayout = {
  editor(parent, _input, kit) {
    const root = kit.el(parent, 'div', 'mine-editor');
    kit.textBox(root, 'title');
    return { element: root };
  },
};

describe('backlog view layouts', () => {
  let fakeDocument: FocusFakeDocument;

  beforeEach(() => {
    fakeDocument = installFocusFakeDom((name, value) =>
      vi.stubGlobal(name, value),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('a layout reload keeps the open editor draft and focused box', async () => {
    const { view, created, sheet } = await backlogSetup();
    view.commands.create();
    const [title] = liveEditors(created, 'title');
    title.events.changed('Changed title');
    title.events.modeChanged({ mode: 'insert', subMode: '' });

    view.setLayouts(withUser(titleOnlyEditor));

    const [remounted] = liveEditors(created, 'title');
    expect(remounted).not.toBe(title);
    expect(remounted.doc).toBe('Changed title');
    expect(remounted.focusOptions).toEqual([{ insertAtEnd: true }]);
    const [pane] = findAll(sheet, 'mine-editor');
    expect(pane.dataset.layout).toBe(USER_LAYOUT);
  });

  it('a box the editor pane leaves out is appended', async () => {
    const { view, created } = await backlogSetup();
    view.setLayouts(withUser(titleOnlyEditor));

    view.commands.create();

    const mounted = ['title', 'oneLine', 'tags', 'body'].map(
      (field) => liveEditors(created, field).length,
    );
    expect(mounted).toEqual([1, 1, 1, 1]);
  });

  it('a partial layout draws its own rows and default for the rest', async () => {
    const { view, sheet } = await backlogSetup();

    view.setLayouts(
      withUser({
        followupRow(parent, input, kit) {
          const row = kit.el(parent, 'li', 'mine-row', input.title);
          kit.cursorActions(row);
          return row;
        },
      }),
    );

    const [rows] = findAll(sheet, 'backlog-rows');
    const followupRows = findAll(rows, 'mine-row');
    const planRows = rows.children.filter((row) =>
      row.classList.contains('ui-row'),
    );
    expect(followupRows.map((row) => row.dataset.layout)).toEqual([
      USER_LAYOUT,
      USER_LAYOUT,
    ]);
    expect(planRows.map((row) => row.dataset.layout)).toEqual(['default']);
    const [prompt] = findAll(rows, 'backlog-row-actions');
    const slot = prompt.parentNode!;
    expect(slot.classList.contains('backlog-row-actions-slot')).toBe(true);
    expect(slot.parentNode).toBe(followupRows[0]);
    expect(followupRows[0].classList.contains('is-selected')).toBe(true);
  });

  it.each([
    { case: 'a follow-up', select: () => undefined },
    {
      case: 'a plan',
      select: (view: Awaited<ReturnType<typeof backlogSetup>>['view']) =>
        view.commands.listBottom(),
    },
  ])(
    "a reload draws $case's detail again at its scroll",
    async ({ select }) => {
      const { view, sheet } = await backlogSetup();
      select(view);
      await settle();
      const [detail] = findAll(sheet, 'backlog-detail');
      detail.scrollTop = 120;

      view.setLayouts(
        withUser({
          followupDetail: (parent, _input, kit) =>
            kit.el(parent, 'div', 'mine-detail'),
          docDetail: (parent, _input, kit) =>
            kit.el(parent, 'div', 'mine-detail'),
        }),
      );
      await settle();

      expect(findAll(detail, 'mine-detail')).toHaveLength(1);
      expect(detail.scrollTop).toBe(120);
    },
  );

  it('scrollEnd_DetailShown_ScrollsItToTheEndAndLogs', async () => {
    const { view, sheet, logs } = await backlogSetup();
    const [detail] = findAll(sheet, 'backlog-detail');
    Object.assign(detail, { scrollHeight: 900 });
    detail.scrollTop = 40;
    logs.length = 0;

    view.commands.scrollEnd();

    expect({ scrollTop: detail.scrollTop, logs }).toEqual({
      scrollTop: 900,
      logs: ['scrolled the detail to the end'],
    });
  });

  it("a plan's detail reads its moved copy", async () => {
    const { view, readDocs } = await backlogSetup();

    view.commands.listBottom();
    await settle();

    expect(readDocs).toEqual([PLAN_COPY]);
  });

  // `expand` opens the plan's task rows, the task row then being the bottom.
  it.each([
    { case: 'a plan', expand: false, opened: `${ROOT}/feature/plan-p/plan.md` },
    { case: 'a task', expand: true, opened: `${ROOT}/feature/plan-p/01-t.md` },
  ])(
    'Open in Docs on $case opens the index copy, not the newest',
    async ({ expand, opened }) => {
      const { view, openedDocs } = await backlogSetup();
      view.commands.listBottom();
      if (expand) {
        view.commands.open();
        view.commands.listBottom();
      }

      view.commands.openInDocs();

      expect(openedDocs).toEqual([opened]);
    },
  );

  it('a reload keeps the open filter text and focus', async () => {
    const { view, sheet } = await backlogSetup();
    view.commands.filter();
    const [input] = findAll(sheet, 'backlog-filter-input');
    (input as FocusFakeElement).value = 'fir';

    view.setLayouts(
      withUser({
        list(parent, kit) {
          const root = kit.el(parent, 'div', 'mine-list');
          kit.filterBox(root);
          kit.rows(root);
          return { element: root };
        },
      }),
    );

    const [pane] = findAll(sheet, 'mine-list');
    const [moved] = findAll(pane, 'backlog-filter-input');
    expect(moved).toBe(input);
    expect((moved as FocusFakeElement).value).toBe('fir');
    expect(fakeDocument.activeElement).toBe(input);
  });

  it.each([
    {
      case: 'the Tags picker',
      layout: {
        pickerRow(parent, input, kit) {
          return kit.row(parent, {
            density: 'list',
            tag: 'li',
            label: input.label,
            trailing: kit.trailing(),
          });
        },
      } satisfies BacklogLayout,
      open: (view: Awaited<ReturnType<typeof backlogSetup>>['view']) =>
        view.commands.pickTag(),
      check(overlays: FakeElement[]) {
        const [layer] = overlays;
        const [list] = findAll(layer, 'ui-picker-list');
        expect(layer.hidden).toBe(false);
        expect(list.children.map((row) => row.dataset.layout)).toEqual([
          USER_LAYOUT,
          USER_LAYOUT,
        ]);
      },
    },
    {
      case: 'the delete prompt',
      layout: {
        confirmBody(parent, input, kit) {
          const root = kit.el(parent, 'div', 'mine-body', input.body);
          kit.keepButton(root);
          return root;
        },
      } satisfies BacklogLayout,
      open: (view: Awaited<ReturnType<typeof backlogSetup>>['view']) =>
        view.commands.delete(),
      check(overlays: FakeElement[], anchors: RecordedAnchor[]) {
        const deleteScrim = overlays[1];
        const [body] = findAll(deleteScrim, 'mine-body');
        const [actions] = findAll(deleteScrim, 'ui-dialog-actions');
        expect(deleteScrim.hidden).toBe(false);
        expect(body.dataset.layout).toBe(USER_LAYOUT);
        expect(actions.textContent).toContain('Delete');
        const liveConfirms = anchors.filter(
          (anchor) =>
            anchor.command === 'backlog.confirmYes' && !anchor.isDisposed,
        );
        expect(liveConfirms.length).toBeGreaterThan(0);
      },
    },
  ])(
    '$case draws through the layout and redraws on a reload',
    async ({ layout, open, check }) => {
      const { view, overlays, anchors } = await backlogSetup();
      open(view);

      view.setLayouts(withUser(layout as BacklogLayout));

      check(overlays, anchors);
    },
  );
});

describe('backlog pane targets', () => {
  beforeEach(() => {
    installFocusFakeDom((name, value) => vi.stubGlobal(name, value));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each<{
    name: string;
    run(setup: Awaited<ReturnType<typeof backlogSetup>>): void;
    last: ScopeCall[];
  }>([
    {
      name: 'a focus move to the detail',
      run: (setup) => setup.move('right'),
      last: [
        ['setScope', 'detail'],
        ['setResizeTarget', 'target'],
        ['setFocusTarget', 'target'],
      ],
    },
    {
      name: 'sideBarOpenedOver',
      run: (setup) => setup.view.sideBarOpenedOver(),
      last: [
        ['setScope', 'homes'],
        ['setResizeTarget', null],
        ['setFocusTarget', 'target'],
      ],
    },
  ])(
    '$name sets the scope, then the resize and focus targets',
    async ({ run, last }) => {
      const setup = await backlogSetup();

      run(setup);

      expect(setup.calls.slice(-3)).toEqual(last);
    },
  );

  // `scope` is the scope the view sets last; a move that returns false sets
  // none.
  it.each<{
    from: 'list' | 'detail' | 'homes';
    direction: PaneDirection;
    scope: string;
    moved: boolean;
  }>([
    { from: 'list', direction: 'right', scope: 'detail', moved: true },
    { from: 'detail', direction: 'left', scope: 'list', moved: true },
    { from: 'list', direction: 'left', scope: 'list', moved: false },
    { from: 'detail', direction: 'right', scope: 'detail', moved: false },
    { from: 'homes', direction: 'right', scope: 'list', moved: true },
    { from: 'homes', direction: 'left', scope: 'homes', moved: false },
    { from: 'list', direction: 'up', scope: 'list', moved: false },
    { from: 'detail', direction: 'down', scope: 'detail', moved: false },
  ])(
    'moves focus $direction from the $from to scope $scope',
    async ({ from, direction, scope, moved }) => {
      const setup = await backlogSetup();
      if (from === 'detail') {
        setup.move('right');
      } else if (from === 'homes') {
        setup.view.sideBarOpenedOver();
      }
      const before = setup.calls.length;

      const result = setup.move(direction);

      const scopes = setup.calls.filter((call) => call[0] === 'setScope');
      expect(result).toBe(moved);
      expect(scopes.at(-1)?.[1]).toBe(scope);
      expect(setup.calls.length > before).toBe(moved);
    },
  );

  it('focusTarget_EditorOpen_IgnoresEveryMove', async () => {
    const setup = await backlogSetup();
    setup.view.commands.create();
    const before = setup.calls.length;
    const logsBefore = setup.logs.length;
    const directions: PaneDirection[] = ['left', 'right', 'up', 'down'];

    const results = directions.map((direction) => setup.move(direction));

    expect(results).toEqual([true, true, true, true]);
    expect(setup.calls.slice(before)).toEqual([]);
    expect(setup.logs.slice(logsBefore)).toEqual(
      directions.map(() => 'pane keys ignored: the editor is open'),
    );
  });

  // The rows without the side bar's turn catch a `focusMain` that leaves the
  // scope and targets to a render that never runs when the focus is unchanged,
  // as after a turn in another plugin's scope.
  it.each<{
    last: string;
    run(setup: Awaited<ReturnType<typeof backlogSetup>>): void;
    isFromSideBar: boolean;
  }>([
    {
      last: 'list',
      run: (setup) => {
        setup.move('right');
        setup.move('left');
      },
      isFromSideBar: true,
    },
    {
      last: 'detail',
      run: (setup) => setup.move('right'),
      isFromSideBar: true,
    },
    {
      last: 'detail',
      run: (setup) => setup.move('right'),
      isFromSideBar: false,
    },
    {
      last: 'editor',
      run: (setup) => setup.view.commands.create(),
      isFromSideBar: false,
    },
  ])(
    'focusMain_ReturnsToMainsLastPane: $last, from the side bar $isFromSideBar',
    async ({ last, run, isFromSideBar }) => {
      const setup = await backlogSetup();
      run(setup);
      if (isFromSideBar) {
        setup.view.focusSideBar();
      }
      const before = setup.calls.length;

      setup.view.focusMain();

      expect(setup.calls.slice(before).slice(-3)).toEqual([
        ['setScope', last],
        ['setResizeTarget', 'target'],
        ['setFocusTarget', 'target'],
      ]);
      expect(setup.picked.count).toBe(1);
    },
  );

  it.each([
    { command: 'open', picked: 0 },
    { command: 'toggle', picked: 1 },
  ] as const)(
    'homeKeys_PickClosesOverlayOnlyOnEnter: $command',
    async ({ command, picked }) => {
      const setup = await backlogSetup();
      setup.view.sideBarOpenedOver();

      setup.view.commands[command]();

      expect(setup.picked.count).toBe(picked);
    },
  );
});

describe('backlog follow-up editor drop target', () => {
  beforeEach(() => {
    installFocusFakeDom((name, value) => vi.stubGlobal(name, value));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('followupEditor_DropTarget_OnTheSlot', async () => {
    const { view, created, sheet, targets } = await backlogSetup();
    const file: DroppedFile = {
      name: 'a.md',
      mediaType: 'text/markdown',
      path: '/d/a.md',
      bytes: async () => new Uint8Array(),
    };
    view.commands.create();

    targets[0].take([file]);
    await settle();

    const [slot] = findAll(sheet, 'backlog-editor');
    expect(targets).toHaveLength(1);
    expect(asFake(targets[0].element)).toBe(slot);
    const [title] = liveEditors(created, 'title');
    expect(title.inserted).toEqual([insertionText(['/d/a.md'], 'x')]);
  });

  it('followupEditor_DropAfterRedraw_GoesToTheBoxUsedLast', async () => {
    const { view, created, targets } = await backlogSetup();
    const file: DroppedFile = {
      name: 'a.md',
      mediaType: 'text/markdown',
      path: '/d/a.md',
      bytes: async () => new Uint8Array(),
    };
    view.commands.create();
    const [body] = liveEditors(created, 'body');
    body.events.focused();
    body.events.blurred();

    view.setLayouts(withUser(titleOnlyEditor));
    targets[0].take([file]);
    await settle();

    const [remountedBody] = liveEditors(created, 'body');
    const [remountedTitle] = liveEditors(created, 'title');
    expect(remountedBody.inserted).toEqual([insertionText(['/d/a.md'], 'x')]);
    expect(remountedTitle.inserted).toEqual([]);
  });
});

describe('backlog row commands', () => {
  beforeEach(() => {
    installFocusFakeDom((name, value) => vi.stubGlobal(name, value));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rowClick_RunsItsCommandWithItsKey: home row', async () => {
    const setup = await backlogSetup();

    drawnRows(setup).homes[0].click();

    expect(setup.runs).toEqual([['backlog.openHomeRow', ROOT]]);
  });

  it('rowClick_RunsItsCommandWithItsKey: item row', async () => {
    const setup = await backlogSetup();

    drawnRows(setup).items[1].click();

    const [[id, key]] = setup.runs;
    expect(id).toBe('backlog.selectRow');
    setup.view.selectRow(key as string);
    const selected = drawnRows(setup).items.map((row) =>
      row.classList.contains('is-selected'),
    );
    expect(selected.slice(0, 2)).toEqual([false, true]);
  });

  it('openHomeRow_DispatchesThenCallsHomePicked', async () => {
    const setup = await backlogSetup();
    const pickedBefore = setup.picked.count;

    setup.view.openHomeRow(ROOT);

    expect(setup.picked.count).toBe(pickedBefore + 1);
    expect(drawnRows(setup).homes[0].classList.contains('is-selected')).toBe(
      true,
    );
  });

  it('selectRow_SelectsTheRowAndFocusesTheItems', async () => {
    const setup = await backlogSetup();
    const key = secondRowKey(setup);
    setup.view.sideBarOpenedOver();

    setup.view.selectRow(key);

    const cursor = drawnRows(setup).items.map((row) =>
      row.classList.contains('is-cursor'),
    );
    expect(cursor.slice(0, 2)).toEqual([false, true]);
  });

  it.each<{
    name: string;
    run(view: Awaited<ReturnType<typeof backlogSetup>>['view']): void;
    logged: string;
  }>([
    {
      name: 'unknown root',
      run: (view) => view.openHomeRow('/gone'),
      logged: 'no home /gone',
    },
    {
      name: 'unknown key',
      run: (view) => view.selectRow('followup:gone'),
      logged: 'no row followup:gone',
    },
  ])(
    'rowCommand_TargetGone_LogsAndChangesNothing: $name',
    async ({ run, logged }) => {
      const setup = await backlogSetup();
      setup.view.sideBarOpenedOver();
      const logsBefore = setup.logs.length;
      const pickedBefore = setup.picked.count;

      run(setup.view);

      const { homes, items } = drawnRows(setup);
      expect(setup.logs.slice(logsBefore)).toEqual([logged]);
      expect(setup.picked.count).toBe(pickedBefore);
      expect(homes[0].classList.contains('is-cursor')).toBe(true);
      expect(items.some((row) => row.classList.contains('is-cursor'))).toBe(
        false,
      );
    },
  );
});
