import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  onTestFinished,
  vi,
} from 'vitest';
import type { CommandArg, CommandId } from '../../../contracts/commands';
import type { CommandHandler } from '../../../contracts/plugin';
import type { DroppedFile, DropTarget } from '../../../contracts/drops';
import type { EditorHost, TextEditor } from '../../../contracts/editor';
import type { AnchorOptions } from '../../../contracts/keymap';
import type { FocusTarget, ResizeTarget } from '../../../contracts/panes';
import type { ShownLayouts } from '../../../contracts/plugin';
import { createEditorBoxes } from '../../../shared/page/editor-boxes';
import { insertionText } from '../../../shared/page/file-drop/file-chips';
import {
  USER_LAYOUT,
  withUser,
} from '../../../shared/page/layout-host/test-layouts';
import {
  asFake,
  type FakeElement,
  findAll,
  installFakeDom,
} from '../../../shared/page/test-dom';
import { NEEDS_YOU_ACTIVITY, type RowActivity } from '../../sessions/contract';
import type { PrimerColumn, PrimerEntry, PrimerPlace } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import type { PrimerLayout } from '../layouts/layout';
import { primerManifest } from '../manifest';
import {
  boxKey,
  focusActionFor,
  PRIMER_BOX_IDENTITY,
  type PrimerBox,
} from './boxes';
import { primerCommandHandlers } from './primer-commands';
import { initialState, type PrimerAction, primerPlace } from './primer-state';
import { createPrimerStore } from './primer-store';
import { mountPrimerPopups } from './primer-view';
import { presentedPrimer, primerEntry, primerItem } from './test-primers';
import { NO_FENCES } from '../../../shared/page/markdown-mount.test-support';
import { noLayoutState } from '../../../shared/page/layout-host/fake-layout-state.test-support';
import { fakeKitCommandsOf } from '../../../shared/page/layout-host/fake-kit-commands.test-support';

// One `insert` call on an editor the host made.
interface Inserted {
  editor: TextEditor;
  text: string;
}

// An editor host whose editors record each insert into `inserted`; every
// cursor sits after an `x`.
function fakeHost(inserted: Inserted[]): EditorHost {
  return {
    create: (_parent, doc, events) => {
      const editor: TextEditor = {
        text: () => doc,
        setText: () => undefined,
        insert: (text) => {
          inserted.push({ editor, text });
        },
        charBeforeCursor: () => 'x',
        focus: () => events.focused(),
        blur: () => events.blurred(),
        destroy: () => undefined,
      };
      return editor;
    },
    createDocument: () => {
      throw new Error('not used by the primer');
    },
    contains: () => false,
    takesChordKey: () => false,
    typeInto: () => {},
    onPendingKeys: () => ({ dispose: () => {} }),
    cancelPendingKeys: () => {},
    setKeymap: () => {},
  };
}

// A drop target the view registered, and whether its registration was
// disposed.
interface RegisteredTarget {
  target: DropTarget;
  isDisposed: boolean;
}

type PrimerCommand = keyof ReturnType<typeof primerCommandHandlers>;

// The short name of primer command `id`, as the handlers key it.
function primerShort(id: CommandId): PrimerCommand {
  return id.slice('primer.'.length) as PrimerCommand;
}

// One `keys.anchor` call the view made, its `dispose` a spy.
interface NamedAnchor {
  element: FakeElement;
  command: CommandId;
  options: AnchorOptions | undefined;
  dispose: Mock<() => void>;
}

// Primer p1, holding `entries`, open and active in its session's primer
// popup, the visible surface, and each of `others` open in its own session's
// popup; `popup` is p1's popup element, `popups` every popup element by
// session, and `added` each popup's session and id in add order. The fake
// `addPopup` runs the popup's `shown` inside the call and reports it visible
// for p1's session alone, as sessions does for the focused session;
// `hidePopup` hides p1's popup. The boxes and the commands are wired as the
// page wires them; `anchors` holds every anchor the view named,
// `resizeTargets` every split handed to the resize keys, `focusTargets` every
// target handed to the focus keys, `uiWrites` every
// uiState write over the values `uiState` starts with, `targets` every drop
// target the view registered, `inserted` every insert into a box's editor, and
// `activities` every row activity the view set.
function primerPopupSetup(
  parts: {
    entries?: PrimerEntry[];
    uiState?: Record<string, unknown>;
    others?: string[];
    savedPlaces?: ReadonlyMap<string, PrimerPlace>;
  } = {},
) {
  const presented = presentedPrimer('p1', { entries: parts.entries });
  const others = (parts.others ?? []).map((primerId) =>
    presentedPrimer(primerId),
  );
  const store = createPrimerStore(
    initialState([presented, ...others], presented.sessionId),
  );
  const logs: string[] = [];
  const log = (message: string) => logs.push(message);
  const targets: RegisteredTarget[] = [];
  const inserted: Inserted[] = [];
  const boxes = createEditorBoxes(
    fakeHost(inserted),
    {
      changed: (box, value) =>
        store.dispatch({
          type: 'setText',
          formId: box.primerId,
          target: box.target,
          value,
        }),
      activated: (box) => {
        const action = focusActionFor(store.get(), box);
        if (action !== null) {
          store.dispatch(action);
        }
      },
    },
    log,
    PRIMER_BOX_IDENTITY,
  );
  const anchors: NamedAnchor[] = [];
  const resizeTargets: (ResizeTarget | null)[] = [];
  const focusTargets: (FocusTarget | null)[] = [];
  const uiValues = new Map(Object.entries(parts.uiState ?? {}));
  const uiWrites: [string, unknown][] = [];
  const popups = new Map<string, FakeElement>();
  const added: [string, string][] = [];
  const restoredAdds: [string, boolean][] = [];
  const activities: [string, string, RowActivity | null][] = [];
  const ran: [CommandId, CommandArg | undefined][] = [];
  let isPopupHidden = false;
  const view = mountPrimerPopups({
    areas: {
      overlay: { contribute: () => ({ dispose: () => undefined }) },
    },
    sessions: {
      addPopup: (sessionId, view, options) => {
        popups.set(sessionId, asFake(view.element));
        added.push([sessionId, view.id]);
        restoredAdds.push([sessionId, options?.restored === true]);
        const isPresented = sessionId === presented.sessionId;
        if (isPresented) {
          view.shown();
        }
        return {
          setStatus: () => undefined,
          open: () => undefined,
          hide: () => undefined,
          isVisible: () => isPresented && !isPopupHidden,
          dispose: () => undefined,
        };
      },
      setActivity: (sessionId, sourceId, activity) =>
        activities.push([sessionId, sourceId, activity]),
      addRowPart: () => ({ dispose: () => undefined }),
    },
    closesAtOnce: () => false,
    beforeClose: () => true,
    setScope: () => undefined,
    setResizeTarget: (target) => resizeTargets.push(target),
    setFocusTarget: (target) => focusTargets.push(target),
    pushConfirmScope: () => ({
      pop: () => undefined,
      dispose: () => undefined,
      onBaseChanged: () => ({ dispose: () => undefined }),
    }),
    store,
    boxes,
    markdown: {
      block: (text) => text,
      inline: (text) => text,
      document: async (text) => text,
      ...NO_FENCES,
    },
    keys: {
      anchor: (element, command, options) => {
        const anchor = {
          element: asFake(element),
          command,
          options,
          dispose: vi.fn<() => void>(),
        };
        anchors.push(anchor);
        return anchor;
      },
      keysFor: () => null,
    },
    run: () => undefined,
    commands: fakeKitCommandsOf(primerManifest, (id, arg) => {
      ran.push([id, arg]);
      if (id.startsWith('primer.')) {
        void (handlers[primerShort(id)] as CommandHandler)({ arg });
      }
    }),
    platform: 'macos',
    state: noLayoutState,
    uiState: {
      get: (key) => uiValues.get(key),
      set: (key, value) => {
        uiWrites.push([key, value]);
        uiValues.set(key, value);
      },
    },
    timers: { set: () => 0, clear: () => undefined },
    drops: {
      addTarget: (target) => {
        const registered = { target, isDisposed: false };
        targets.push(registered);
        return {
          dispose: () => {
            registered.isDisposed = true;
          },
        };
      },
      savePasted: () => Promise.reject(new Error('not used by the primer')),
    },
    toast: () => undefined,
    log,
    savedPlaces: parts.savedPlaces ?? new Map(),
  });
  const popup = popups.get(presented.sessionId);
  if (popup === undefined) {
    throw new Error('the primer mounted no popup for p1');
  }
  const handlers = primerCommandHandlers({
    store,
    boxes,
    finish: () => Promise.resolve(),
    scrollPrimer: () => null,
    openPreview: () => Promise.resolve(),
    toast: () => undefined,
    log,
  });
  return {
    view,
    store,
    boxes,
    logs,
    anchors,
    resizeTargets,
    focusTargets,
    uiWrites,
    targets,
    inserted,
    activities,
    sessionId: presented.sessionId,
    popup,
    popups,
    added,
    hidePopup: () => {
      isPopupHidden = true;
    },
    // Each added popup's session and whether it was added restored.
    restoredAdds,
    // Each command a click ran through the kit, with its arg.
    ran,
    // Fires `command` with no editor in its context, as a page key does.
    run: (command: PrimerCommand) =>
      (handlers[command] as CommandHandler)({ arg: undefined }),
  };
}

function pane(popup: FakeElement, className: string): FakeElement {
  const [found] = findAll(popup, className);
  return found;
}

// The column element of `column`.
function columnOf(popup: FakeElement, column: PrimerColumn): FakeElement {
  return pane(popup, `primer-${column}`);
}

// The body a column's part draws into.
function columnBody(popup: FakeElement, column: PrimerColumn): FakeElement {
  return pane(columnOf(popup, column), 'primer-column-body');
}

// Gives every split under `popup` a layout box 1000 pixels wide and its handle
// one 4 pixels wide, so the panes share a 996px span and a nudge moves the
// split, as a browser lays the splits out.
function measureSplits(popup: FakeElement): void {
  for (const [className, width] of [
    ['ui-split', 1000],
    ['ui-split-handle', 4],
  ] as const) {
    for (const node of findAll(popup, className)) {
      Object.assign(node, {
        getClientRects: () => [{}],
        getBoundingClientRect: () => ({ left: 0, width }),
      });
    }
  }
}

describe('primer column widths', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each<{
    name: string;
    uiState: Record<string, unknown>;
    writes: [string, unknown][];
  }>([
    {
      name: 'a rail width and no tasks width',
      uiState: { 'primer-rail-width': 300 },
      writes: [
        ['tasks-width', 300],
        ['primer-rail-width', undefined],
      ],
    },
    {
      name: 'a rail width and a tasks width',
      uiState: { 'primer-rail-width': 300, 'tasks-width': 200 },
      writes: [],
    },
    { name: 'no rail width', uiState: {}, writes: [] },
    {
      name: 'a rail width that is not a number',
      uiState: { 'primer-rail-width': 'wide' },
      writes: [],
    },
  ])(
    'moves the old rail width to the tasks width once: $name',
    ({ uiState, writes }) => {
      const { uiWrites } = primerPopupSetup({ uiState });

      expect(uiWrites).toEqual(writes);
    },
  );

  it.each<{
    name: string;
    isHidden: boolean;
    actions: PrimerAction[];
    key: string | null;
  }>([
    {
      name: 'the tasks column',
      isHidden: false,
      actions: [{ type: 'selectTask', row: 1 }],
      key: 'tasks-width',
    },
    {
      name: 'the items column',
      isHidden: false,
      actions: [{ type: 'focusPane', pane: 'items' }],
      key: 'items-width',
    },
    {
      name: 'the card',
      isHidden: false,
      actions: [{ type: 'focusPane', pane: 'card' }],
      key: 'items-width',
    },
    {
      name: 'the review',
      isHidden: false,
      actions: [{ type: 'openReview' }],
      key: null,
    },
    {
      // A hidden popup hands no split, so the tasks column's from its first
      // show stays.
      name: 'the review with the popup hidden',
      isHidden: true,
      actions: [{ type: 'openReview' }],
      key: 'tasks-width',
    },
  ])(
    'hands the resize keys the split of the focused pane: $name',
    ({ isHidden, actions, key }) => {
      const { store, popup, resizeTargets, uiWrites, hidePopup } =
        primerPopupSetup();
      measureSplits(popup);
      if (isHidden) {
        hidePopup();
      }
      for (const action of actions) {
        store.dispatch(action);
      }
      const target = resizeTargets.at(-1) ?? null;
      uiWrites.length = 0;

      target?.nudge('right');

      expect(uiWrites.map(([written]) => written)).toEqual(
        key === null ? [] : [key],
      );
      expect(target === null).toBe(key === null);
    },
  );

  it('hands the focus keys the panes in the primer view, and none in the review', () => {
    const { store, focusTargets } = primerPopupSetup();
    const inPrimer = focusTargets.at(-1) ?? null;

    store.dispatch({ type: 'openReview' });

    expect(inPrimer).not.toBeNull();
    expect(focusTargets.at(-1)).toBeNull();
  });
});

describe('primer popup under the cancel prompt', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the review behind a cancel prompt asked from the review', () => {
    const { store, popup } = primerPopupSetup();
    store.dispatch({ type: 'openReview' });

    store.dispatch({ type: 'askCancel' });

    expect(store.get().view).toBe('confirm');
    expect(pane(popup, 'primer-card').hidden).toBe(true);
    expect(pane(popup, 'primer-review-pane').hidden).toBe(false);
  });
});

describe('primer review cursor', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('review_CursorRow_DrawsIsCursorOnItsBlock', () => {
    const { store, popup } = primerPopupSetup();
    store.dispatch({ type: 'openReview' });

    store.dispatch({ type: 'reviewNext' });

    const taskBlocks = findAll(
      pane(popup, 'primer-review-body'),
      'primer-review-block',
    ).slice(1);
    expect(
      taskBlocks.map((block) => block.classList.contains('is-cursor')),
    ).toEqual([false, true, false]);
  });
});

describe('primer popups of several sessions', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("draws an unfocused session's primer in its popup while the focused primer takes the keys", () => {
    const { store, popups, focusTargets } = primerPopupSetup({
      others: ['p2'],
    });
    const unfocused = popups.get('p2-session') as FakeElement;

    store.dispatch({ type: 'openReview' });

    expect(pane(unfocused, 'primer-form').hidden).not.toBe(true);
    expect(pane(unfocused, 'primer-card').hidden).toBe(false);
    expect(pane(unfocused, 'primer-review-pane').hidden).toBe(true);
    expect(focusTargets.at(-1)).toBeNull();
    expect(store.get().activeFormId).toBe('p1');
  });

  it('restoredPrimer_AddsItsPopupRestored_NewPrimerDoesNot', () => {
    const saved = initialState([presentedPrimer('p1')], 'p1-session');
    const { store, restoredAdds } = primerPopupSetup({
      others: ['p2'],
      savedPlaces: new Map([['p1', primerPlace(saved, saved.forms[0])]]),
    });

    store.dispatch({ type: 'formShown', form: presentedPrimer('p3') });

    expect(restoredAdds).toEqual([
      ['p1-session', true],
      ['p2-session', false],
      ['p3-session', false],
    ]);
  });

  it('draws a primer that arrives for an unfocused session', () => {
    const { store, popups } = primerPopupSetup();

    store.dispatch({ type: 'formShown', form: presentedPrimer('p2') });

    const unfocused = popups.get('p2-session') as FakeElement;
    expect(pane(unfocused, 'primer-form').hidden).not.toBe(true);
    expect(pane(unfocused, 'primer-card').hidden).toBe(false);
  });
});

describe('primer popup opening', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a session's first primer opens its popup, and the resize and focus keys reach that primer", () => {
    const { added, resizeTargets, focusTargets } = primerPopupSetup();

    expect(added).toEqual([['p1-session', 'primer']]);
    expect(resizeTargets.at(-1)).not.toBeNull();
    expect(focusTargets.at(-1)).not.toBeNull();
  });
});

describe('primer popup row activity', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sets the session's row to needs you while its primer shows, and clears it when the primer closes", () => {
    const { store, sessionId, activities } = primerPopupSetup();

    store.dispatch({ type: 'formClosed', formId: 'p1' });

    expect(activities).toEqual([
      [sessionId, 'primer', NEEDS_YOU_ACTIVITY],
      [sessionId, 'primer', null],
    ]);
  });
});

describe('primer item card', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Task `1` with an added second item, on item 2's card.
  function onAddedItem(added: boolean) {
    const setup = primerPopupSetup({
      entries: [
        primerEntry('1', 'primer', {
          items: [
            primerItem('Read the store'),
            primerItem('Write the store', { added, include: false }),
          ],
        }),
      ],
    });
    setup.store.dispatch({ type: 'selectTask', row: 1 });
    setup.store.dispatch({ type: 'selectItem', item: 2 });
    return setup;
  }

  const itemText2: PrimerBox = {
    primerId: 'p1',
    target: { field: 'itemText', entryId: '1', item: 2 },
  };
  const itemComment2: PrimerBox = {
    primerId: 'p1',
    target: { field: 'itemComment', entryId: '1', item: 2 },
  };

  it("holds the place, an agent item's text as heading, its mark and its comment box", () => {
    const { popup, boxes } = onAddedItem(false);
    const card = pane(popup, 'primer-card');

    expect(pane(card, 'primer-item-step').textContent).toContain('2 of 2');
    expect(pane(card, 'primer-card-heading').textContent).toBe(
      'Write the store',
    );
    const [mark] = findAll(card, 'ui-toggle-mark');
    expect(mark.classList.contains('is-selected')).toBe(false);
    expect(card.textContent.includes('Added')).toBe(false);
    expect(boxes.isMounted(itemText2)).toBe(false);
    expect(boxes.isMounted(itemComment2)).toBe(true);
    expect(findAll(card, 'primer-box')).toHaveLength(1);
  });

  it("holds an added item's text box in place of the heading, then its comment box", () => {
    const { popup, boxes } = onAddedItem(true);
    const card = pane(popup, 'primer-card');

    expect(findAll(card, 'primer-card-heading')).toEqual([]);
    expect(card.textContent.includes('Added')).toBe(true);
    expect(boxes.isMounted(itemText2)).toBe(true);
    expect(boxes.isMounted(itemComment2)).toBe(true);
    expect(findAll(card, 'primer-box')).toHaveLength(2);
  });

  it("rebuilds the card on the item that takes a dropped blank item's place", () => {
    const setup = primerPopupSetup({
      entries: [
        primerEntry('1', 'primer', {
          items: [
            primerItem('Read the store'),
            primerItem('Write the store', { added: true }),
            primerItem('Test the store', { added: true }),
          ],
        }),
      ],
    });
    setup.store.dispatch({ type: 'selectTask', row: 1 });
    setup.store.dispatch({ type: 'selectItem', item: 2 });
    const card = pane(setup.popup, 'primer-card');
    const before = findAll(card, 'primer-box');
    setup.store.dispatch({
      type: 'setText',
      formId: 'p1',
      target: itemText2.target,
      value: '',
    });

    setup.store.dispatch({
      type: 'dropBlankItem',
      formId: 'p1',
      entryId: '1',
      item: 2,
    });

    expect(pane(card, 'primer-item-step').textContent).toContain('2 of 2');
    const after = findAll(card, 'primer-box');
    expect(after).toHaveLength(2);
    expect(after.some((frame) => before.includes(frame))).toBe(false);
  });

  it('flips its mark on toggleInclude with no rebuild', () => {
    const { popup, boxes, run } = onAddedItem(false);
    const card = pane(popup, 'primer-card');
    const [mark] = findAll(card, 'ui-toggle-mark');
    const [frame] = findAll(card, 'primer-box');

    run('toggleInclude');

    expect(mark.classList.contains('is-selected')).toBe(true);
    expect(findAll(card, 'primer-box')).toEqual([frame]);
    expect(
      boxes.isMounted({
        primerId: 'p1',
        target: { field: 'itemComment', entryId: '1', item: 2 },
      }),
    ).toBe(true);
  });
});

const newItem1: PrimerBox = {
  primerId: 'p1',
  target: { field: 'newItem', entryId: '1' },
};

// Task `1` holding `count` items, alone in the primer.
function taskWithItems(count: number): PrimerEntry[] {
  return [
    primerEntry('1', 'primer', {
      items: Array.from({ length: count }, (_, i) => primerItem(`Item ${i}`)),
    }),
  ];
}

// The primer's task `1` with `text` typed in its add-item box, the box
// focused.
function typeNewItem(
  setup: ReturnType<typeof primerPopupSetup>,
  text: string,
): void {
  setup.store.dispatch({ type: 'selectTask', row: 1 });
  setup.boxes.focus(newItem1);
  setup.store.dispatch({
    type: 'setText',
    formId: 'p1',
    target: newItem1.target,
    value: text,
  });
}

function itemCount(setup: ReturnType<typeof primerPopupSetup>): number {
  const form = setup.store.get().forms[0];
  return form.entries.find((entry) => entry.id === '1')?.items.length ?? 0;
}

function addedLines(logs: string[]): string[] {
  return logs.filter((line) => line.startsWith('added item'));
}

describe('primer add-item box', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps its text when focus moves to another box or leaves the page', () => {
    const setup = primerPopupSetup();
    typeNewItem(setup, 'Test the store');

    setup.boxes.focus({
      primerId: 'p1',
      target: { field: 'taskComment', entryId: '1' },
    });
    setup.boxes.leave();

    expect(itemCount(setup)).toBe(2);
    expect(setup.store.get().forms[0].newItemTexts['1']).toBe('Test the store');
    expect(setup.boxes.isMounted(newItem1)).toBe(true);
  });

  it('adds the item once on leaveBox', () => {
    const setup = primerPopupSetup();
    typeNewItem(setup, 'Test the store');

    setup.run('leaveBox');

    expect(itemCount(setup)).toBe(3);
    expect(addedLines(setup.logs)).toEqual([
      expect.stringContaining('item 3 on task 1'),
    ]);
    expect(setup.boxes.active()).toBeNull();
  });

  it('adds the item once on a focus move to the items', () => {
    const setup = primerPopupSetup();
    typeNewItem(setup, 'Test the store');

    const moved = setup.focusTargets.at(-1)?.move('left');

    expect(moved).toBe(true);

    expect(itemCount(setup)).toBe(3);
    expect(addedLines(setup.logs)).toEqual([
      expect.stringContaining('item 3 on task 1'),
    ]);
    expect(setup.boxes.active()).toBeNull();
  });

  it('leaves the card once the 20th item lands, focusing the task comment box on nextBox', () => {
    const setup = primerPopupSetup({ entries: taskWithItems(19) });
    typeNewItem(setup, 'Test the store');

    setup.run('nextBox');

    expect(itemCount(setup)).toBe(20);
    expect(addedLines(setup.logs)).toEqual([
      expect.stringContaining('item 20 on task 1'),
    ]);
    expect(setup.boxes.isMounted(newItem1)).toBe(false);
    expect(findAll(setup.popup, 'primer-field')).toHaveLength(1);
    const active = setup.boxes.active();
    expect(active === null ? null : boxKey(active)).toBe('p1/task/1/comment');
  });

  it('focuses the task comment box on prevBox from the box the 20th item filled', () => {
    const setup = primerPopupSetup({ entries: taskWithItems(19) });
    typeNewItem(setup, 'Test the store');

    setup.run('prevBox');

    expect(itemCount(setup)).toBe(20);
    const active = setup.boxes.active();
    expect(active === null ? null : boxKey(active)).toBe('p1/task/1/comment');
  });

  it('shows no add-item box on a task holding 20 items, and the add-item key refuses once', () => {
    const setup = primerPopupSetup({ entries: taskWithItems(20) });
    setup.store.dispatch({ type: 'selectTask', row: 1 });

    setup.run('addItem');

    expect(setup.boxes.isMounted(newItem1)).toBe(false);
    expect(setup.logs).toEqual([expect.stringContaining('task 1')]);
  });
});

// Whether `node` sits inside `root`, `root` itself included.
function isInside(node: FakeElement, root: FakeElement): boolean {
  for (let at: FakeElement | null = node; at !== null; at = at.parentNode) {
    if (at === root) {
      return true;
    }
  }
  return false;
}

function anchorsOf(anchors: NamedAnchor[], command: string): NamedAnchor[] {
  return anchors.filter((anchor) => anchor.command === command);
}

describe('primer anchors', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('anchors adding a task in the Extra tasks header', () => {
    const { popup, anchors } = primerPopupSetup({ entries: taskWithItems(0) });

    const adds = anchorsOf(anchors, 'primer.addExtraTask');
    const header = findAll(popup, 'ui-section-header').find((node) =>
      node.textContent.startsWith('Extra tasks'),
    );
    expect(adds).toHaveLength(1);
    expect(header).toBeDefined();
    expect(isInside(adds[0].element, header as FakeElement)).toBe(true);
    expect(adds[0].options).toEqual({ scope: 'primer.tasks', label: 'add' });
  });

  it("anchors the item card's step keys in the items and the card scope, so they show while either has focus", () => {
    const { store, popup, anchors } = primerPopupSetup();
    store.dispatch({ type: 'selectTask', row: 1 });
    store.dispatch({ type: 'selectItem', item: 1 });

    const [step] = findAll(popup, 'primer-item-step');
    const stepAnchors = anchors
      .filter((anchor) => isInside(anchor.element, step))
      .map((anchor) => [anchor.command, anchor.options?.scope]);
    expect(stepAnchors).toEqual([
      ['primer.prevRow', 'primer.items'],
      ['primer.prevRow', 'primer.card'],
      ['primer.nextRow', 'primer.items'],
      ['primer.nextRow', 'primer.card'],
    ]);
  });

  it.each<{
    name: string;
    container: (popup: FakeElement) => FakeElement;
    expected: [string, AnchorOptions | undefined][];
  }>([
    {
      name: 'the tasks column head',
      container: (popup) =>
        pane(columnOf(popup, 'tasks'), 'primer-column-head'),
      expected: [
        ['primer.prevRow', { scope: 'primer.tasks' }],
        ['primer.nextRow', { scope: 'primer.tasks' }],
        ['panes.focusRight', { scope: 'primer.tasks', label: 'items' }],
      ],
    },
    {
      name: 'the items column head',
      container: (popup) =>
        pane(columnOf(popup, 'items'), 'primer-column-head'),
      expected: [
        ['panes.focusLeft', { scope: 'primer.items' }],
        ['primer.prevRow', { scope: 'primer.items' }],
        ['primer.nextRow', { scope: 'primer.items' }],
        ['panes.focusRight', { scope: 'primer.items', label: 'card' }],
      ],
    },
    {
      name: 'the card edge strip',
      container: (popup) => pane(popup, 'primer-card-edge'),
      expected: [['panes.focusLeft', { scope: 'primer.card' }]],
    },
  ])('anchors the header keys of $name', ({ container, expected }) => {
    const { popup, anchors } = primerPopupSetup();

    const inside = anchors
      .filter((anchor) => isInside(anchor.element, container(popup)))
      .map((anchor) => [anchor.command, anchor.options]);

    // Anchor call order is build order, not DOM order.
    expect(inside).toHaveLength(expected.length);
    expect(inside).toEqual(expect.arrayContaining(expected));
  });

  it("moves each column's row prompt to its selected row, with remove only on an extra task", () => {
    // Tasks column rows: the feature (0), `1` (1), `s1` (2), `extra-1` (3);
    // only `1` holds items.
    const { store, popup, anchors } = primerPopupSetup();
    const [remove] = anchorsOf(anchors, 'primer.removeExtraTask');
    const [include] = anchorsOf(anchors, 'primer.toggleInclude').filter(
      (anchor) => anchor.options?.scope === 'primer.items',
    );
    // The text of the selected row holding `column`'s prompt; null when the
    // column shows no prompt.
    const promptRow = (column: PrimerColumn) => {
      const [prompt] = findAll(columnOf(popup, column), 'primer-row-prompt');
      if (prompt === undefined) {
        return null;
      }
      const row = prompt.parentNode as FakeElement;
      expect(row.classList.contains('is-selected')).toBe(true);
      return row.textContent;
    };
    const onFeature = [promptRow('tasks'), promptRow('items')];

    store.dispatch({ type: 'selectTask', row: 3 });
    const onExtra = [promptRow('tasks'), promptRow('items')];
    const removeOnExtra = remove.element.hidden;

    store.dispatch({ type: 'selectTask', row: 1 });
    const onTask = [promptRow('tasks'), promptRow('items')];
    const removeOnTask = remove.element.hidden;

    store.dispatch({ type: 'selectItem', item: 2 });
    const onItem = promptRow('items');

    expect(onFeature).toEqual([null, null]);
    expect(onExtra).toEqual([expect.stringContaining('extra-1 task'), null]);
    expect(removeOnExtra).toBe(false);
    expect(onTask).toEqual([
      expect.stringContaining('1 task'),
      expect.stringContaining('Read the store'),
    ]);
    expect(removeOnTask).toBe(true);
    expect(include.element.hidden).toBe(false);
    expect(onItem).toContain('Write the store');
  });

  it("draws the selected task's items in the items column and toggles one by its mark", () => {
    const { store, popup } = primerPopupSetup();
    store.dispatch({ type: 'selectTask', row: 1 });
    const items = columnOf(popup, 'items');
    expect(findAll(items, 'primer-item-lead')).toHaveLength(2);

    const [, secondLead] = findAll(items, 'primer-item-lead');
    const [mark] = findAll(secondLead, 'ui-toggle-mark');
    mark.click();

    const primer = store.get().forms[0];
    expect(primer).toMatchObject({
      selectedTask: { kind: 'task', entryId: '1' },
      selectedItem: 2,
      pane: 'items',
    });
    expect(primer.entries[0].items.map((item) => item.include)).toEqual([
      true,
      false,
    ]);
  });

  // Task rows: Feature (0), task 1 (1); task 1's items are 1 and 2.
  it.each<{
    control: string;
    click: (popup: FakeElement) => void;
    ran: [CommandId, CommandArg | undefined];
  }>([
    {
      control: 'a task row',
      click: (popup) =>
        findAll(columnBody(popup, 'tasks'), 'ui-row')[1].click(),
      ran: ['primer.selectTask', 1],
    },
    {
      control: 'an item row',
      click: (popup) =>
        findAll(columnBody(popup, 'items'), 'ui-row')[1].click(),
      ran: ['primer.selectItem', 2],
    },
    {
      control: "an item row's mark",
      click: (popup) => {
        const [, lead] = findAll(columnOf(popup, 'items'), 'primer-item-lead');
        findAll(lead, 'ui-toggle-mark')[0].click();
      },
      ran: ['primer.toggleIncludeAt', 2],
    },
    {
      control: "the item card's mark",
      click: (popup) =>
        findAll(pane(popup, 'primer-card'), 'ui-toggle-mark')[0].click(),
      ran: ['primer.toggleInclude', undefined],
    },
  ])('tasksAndItems_Click_RunTheirCommands: $control', ({ click, ran }) => {
    const setup = primerPopupSetup();
    setup.store.dispatch({ type: 'selectTask', row: 1 });
    setup.store.dispatch({ type: 'selectItem', item: 1 });

    click(setup.popup);

    expect(setup.ran).toEqual([ran]);
  });

  it.each<{ name: string; actions: PrimerAction[]; copy: string }>([
    {
      name: 'the Feature row',
      actions: [],
      copy: 'Select a task to see its items.',
    },
    {
      name: 'a task with no items',
      actions: [{ type: 'selectTask', row: 2 }],
      copy: 'No items. Press a on the task card to add one.',
    },
  ])("shows the items column's empty state on $name", ({ actions, copy }) => {
    const { store, popup } = primerPopupSetup();

    for (const action of actions) {
      store.dispatch(action);
    }

    expect(columnBody(popup, 'items').textContent).toContain(copy);
  });
});

// The element a part drew into `paneClass`'s pane: its first child.
function partIn(popup: FakeElement, paneClass: string): FakeElement {
  return pane(popup, paneClass).children[0];
}

// The element a column's part drew: its body's first child.
function columnPart(popup: FakeElement, column: PrimerColumn): FakeElement {
  return columnBody(popup, column).children[0];
}

const taskComment1: PrimerBox = {
  primerId: 'p1',
  target: { field: 'taskComment', entryId: '1' },
};

// A layout whose task card draws its heading alone.
const BARE_TASK: PrimerLayout = {
  cards: {
    task(parent, input, kit) {
      const card = kit.el(parent, 'div', 'bare-task');
      kit.el(card, 'h2', '', input.name);
      return { element: card };
    },
  },
};

describe('primer layout', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('draws every part with default and marks data-layout', () => {
    const { store, popup } = primerPopupSetup();
    const layoutOf = (part: FakeElement) => [
      part.dataset.layout,
      part.dataset.layoutOwner,
    ];
    const drawn = [
      layoutOf(partIn(popup, 'primer-card')),
      layoutOf(columnPart(popup, 'tasks')),
      layoutOf(columnPart(popup, 'items')),
    ];
    store.dispatch({ type: 'selectTask', row: 1 });
    drawn.push(layoutOf(partIn(popup, 'primer-card')));
    store.dispatch({ type: 'selectItem', item: 1 });
    drawn.push(layoutOf(partIn(popup, 'primer-card')));
    store.dispatch({ type: 'openReview' });
    drawn.push(layoutOf(partIn(popup, 'primer-review-body')));

    expect(drawn).toEqual(Array(6).fill(['default', 'primer']));
  });

  it('draws a part from the user layout when it defines it, the rest from default', () => {
    const { store, popup, view } = primerPopupSetup();
    view.setLayouts(withUser<PrimerLayout>(defaultLayout, BARE_TASK));

    store.dispatch({ type: 'selectTask', row: 1 });
    const task = partIn(popup, 'primer-card').dataset.layout;
    const tasks = columnPart(popup, 'tasks').dataset.layout;
    const items = columnPart(popup, 'items').dataset.layout;
    store.dispatch({ type: 'selectItem', item: 1 });
    const item = partIn(popup, 'primer-card').dataset.layout;

    expect({ task, item, tasks, items }).toEqual({
      task: USER_LAYOUT,
      item: 'default',
      tasks: 'default',
      items: 'default',
    });
  });

  it('falls back to default when a user card throws after mounting a box, mounting each box once', () => {
    const { store, popup, view, boxes, logs } = primerPopupSetup();
    view.setLayouts(
      withUser<PrimerLayout>(defaultLayout, {
        cards: {
          task(parent, _input, kit) {
            kit.textBox(parent, 'comment');
            throw new Error('card broke');
          },
        },
      }),
    );

    store.dispatch({ type: 'selectTask', row: 1 });

    const card = partIn(popup, 'primer-card');
    expect(card.dataset.layout).toBe('default');
    expect(logs).toContainEqual(
      expect.stringContaining(
        `layout ${USER_LAYOUT} task card failed: card broke`,
      ),
    );
    expect(boxes.isMounted(taskComment1)).toBe(true);
    expect(boxes.isMounted(newItem1)).toBe(true);
    expect(findAll(pane(popup, 'primer-card'), 'primer-box')).toHaveLength(2);
  });

  it('appends the boxes a user card leaves out, in shownBoxes order', () => {
    const setup = primerPopupSetup();
    setup.view.setLayouts(withUser<PrimerLayout>(defaultLayout, BARE_TASK));
    setup.store.dispatch({ type: 'selectTask', row: 1 });

    const card = partIn(setup.popup, 'primer-card');
    const labels = findAll(card, 'ui-section-header-text').map(
      (label) => label.textContent,
    );
    setup.run('editFirstField');
    const first = setup.boxes.active();
    setup.run('nextBox');
    const second = setup.boxes.active();

    expect(labels).toEqual(['New item', 'Comment']);
    expect([first, second].map((box) => box && boxKey(box))).toEqual([
      'p1/task/1/new-item',
      'p1/task/1/comment',
    ]);
  });

  it('rebuilds the shown card on setLayouts with a new pick and keeps the focused box', () => {
    const { store, popup, view, boxes } = primerPopupSetup();
    store.dispatch({ type: 'selectTask', row: 1 });
    boxes.focus(taskComment1);
    const before = partIn(popup, 'primer-card');

    view.setLayouts(withUser<PrimerLayout>(defaultLayout, BARE_TASK));

    const after = partIn(popup, 'primer-card');
    expect(after).not.toBe(before);
    expect(after.dataset.layout).toBe(USER_LAYOUT);
    const active = boxes.active();
    expect(active === null ? null : boxKey(active)).toBe('p1/task/1/comment');
  });

  it("runs the item card's update on a toggle without a rebuild", () => {
    const { store, popup, view, run } = primerPopupSetup();
    const updates: boolean[] = [];
    view.setLayouts(
      withUser<PrimerLayout>(defaultLayout, {
        cards: {
          item(parent, input, kit) {
            const card = kit.el(parent, 'div', 'watching-item');
            kit.textBox(card, 'comment');
            return {
              element: card,
              update: (current) => updates.push(current.include),
            };
          },
        },
      }),
    );
    store.dispatch({ type: 'selectTask', row: 1 });
    store.dispatch({ type: 'selectItem', item: 1 });
    const card = partIn(popup, 'primer-card');
    updates.length = 0;

    run('toggleInclude');

    expect(partIn(popup, 'primer-card')).toBe(card);
    expect(updates).toEqual([false]);
  });

  // A user part for each column that draws one plain row and never calls the
  // kit's row function.
  const PLAIN_COLUMNS: Record<PrimerColumn, PrimerLayout> = {
    tasks: {
      tasks(parent, input, kit) {
        const list = kit.el(parent, 'div', 'plain-tasks');
        kit.row(list, { density: 'list', label: input.feature.name });
        return { element: list };
      },
    },
    items: {
      items(parent, input, kit) {
        const list = kit.el(parent, 'div', 'plain-items');
        kit.row(list, { density: 'list', label: input.task?.name ?? '' });
        return { element: list };
      },
    },
  };

  it.each<PrimerColumn>(['tasks', 'items'])(
    "appends the %s column's row prompt at its part's end when the part never calls its row function",
    (column) => {
      const { store, popup, view } = primerPopupSetup();
      view.setLayouts(
        withUser<PrimerLayout>(defaultLayout, PLAIN_COLUMNS[column]),
      );

      store.dispatch({ type: 'selectTask', row: 1 });

      const [prompt] = findAll(columnOf(popup, column), 'primer-row-prompt');
      const part = columnPart(popup, column);
      expect(part.dataset.layout).toBe(USER_LAYOUT);
      expect(prompt.parentNode).toBe(part);
    },
  );

  it("disposes a part's anchors before it draws the part again and when the view goes", () => {
    const { store, popup, view, anchors, sessionId } = primerPopupSetup();
    store.dispatch({ type: 'selectTask', row: 1 });
    const inside = (node: FakeElement) =>
      anchors.filter((anchor) => isInside(anchor.element, node));
    const addsIn = (node: FakeElement) =>
      inside(node).filter((anchor) => anchor.command === 'primer.addExtraTask');
    const firstTasks = addsIn(columnBody(popup, 'tasks'));
    const firstCard = inside(pane(popup, 'primer-card'));
    const edges = anchors.filter((anchor) =>
      anchor.command.startsWith('panes.focus'),
    );
    const splitAnchors = anchors.filter((anchor) =>
      anchor.command.startsWith('panes.resizePane'),
    );

    store.dispatch({ type: 'selectItem', item: 1 });
    const secondTasks = addsIn(columnBody(popup, 'tasks'));
    const secondCard = inside(pane(popup, 'primer-card'));
    const disposedOnRedraw = [...firstTasks, ...firstCard].map(
      (anchor) => anchor.dispose.mock.calls.length,
    );
    view.forgetSession(sessionId);

    expect(firstTasks).toHaveLength(1);
    expect(firstCard.length).toBeGreaterThan(0);
    expect(splitAnchors).toHaveLength(4);
    expect(disposedOnRedraw.every((calls) => calls === 1)).toBe(true);
    for (const anchor of [
      ...secondTasks,
      ...secondCard,
      ...edges,
      ...splitAnchors,
    ]) {
      expect(anchor.dispose).toHaveBeenCalledOnce();
    }
  });

  it("keys a live default's fallback card update failure by the bundled default", () => {
    const { store, view, run, logs } = primerPopupSetup();
    const bundledItem = defaultLayout.cards.item;
    const breaksUpdate = vi
      .spyOn(defaultLayout.cards, 'item')
      .mockImplementation((parent, input, kit) => ({
        ...bundledItem(parent, input, kit),
        update() {
          throw new Error('update broke');
        },
      }));
    onTestFinished(() => breaksUpdate.mockRestore());
    // A live default, shown as `default`, whose item card throws at draw.
    const liveDefault = (): ShownLayouts<PrimerLayout> => ({
      layouts: new Map<string, PrimerLayout>([
        [
          'default',
          {
            ...defaultLayout,
            cards: {
              ...defaultLayout.cards,
              item() {
                throw new Error('card broke');
              },
            },
          },
        ],
      ]),
      user: 'default',
    });
    view.setLayouts(liveDefault());
    store.dispatch({ type: 'selectTask', row: 1 });
    store.dispatch({ type: 'selectItem', item: 1 });

    run('toggleInclude');
    view.setLayouts(liveDefault());
    run('toggleInclude');

    expect(
      logs.filter((line) => line.includes('item card update failed')),
    ).toEqual(['layout default item card update failed: update broke']);
  });
});

describe('primer popup drop target', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const file: DroppedFile = {
    name: 'a.md',
    mediaType: 'text/markdown',
    path: '/d/a.md',
    bytes: async () => new Uint8Array(),
  };

  it.each<{ name: string; actions: PrimerAction[] }>([
    { name: 'its pane focused', actions: [] },
    {
      name: 'its pane unfocused by a Chat pane',
      actions: [{ type: 'sessionActivated', sessionId: 'chat-session' }],
    },
  ])(
    'primerView_DropTarget_FollowsThePrimer with $name',
    async ({ actions }) => {
      const { store, boxes, popup, targets, inserted } = primerPopupSetup({
        others: ['p2'],
      });
      for (const action of actions) {
        store.dispatch(action);
      }
      const p1Root = pane(popup, 'primer-form');
      const p1Targets = targets.filter(
        ({ target }) => asFake(target.element) === p1Root,
      );
      expect(p1Targets).toHaveLength(1);
      const [p1Target] = p1Targets;

      p1Target.target.take([file]);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(inserted.map(({ text }) => text)).toEqual([
        insertionText(['/d/a.md'], 'x'),
      ]);
      expect(boxes.boxOf(inserted[0].editor)?.primerId).toBe('p1');

      store.dispatch({ type: 'formClosed', formId: 'p1' });

      expect(targets.map(({ isDisposed }) => isDisposed)).toEqual(
        targets.map((registered) => registered === p1Target),
      );
    },
  );
});
