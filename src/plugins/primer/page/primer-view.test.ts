import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from 'vitest';
import type { CommandId } from '../../../contracts/commands';
import type { EditorHost } from '../../../contracts/editor';
import { createEditorBoxes } from '../../../shared/page/editor-boxes';
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
import type { AnchorOptions } from '../../keys/contract';
import type { PrimerEntry } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import type { PrimerLayout } from '../layouts/layout';
import {
  boxKey,
  focusActionFor,
  PRIMER_BOX_IDENTITY,
  type PrimerBox,
} from './boxes';
import { primerCommandHandlers } from './primer-commands';
import { initialState } from './primer-state';
import { createPrimerStore } from './primer-store';
import { mountPrimerTab } from './primer-view';
import { presentedPrimer, primerEntry, primerItem } from './test-primers';

const host: EditorHost = {
  create: (_parent, doc, events) => ({
    text: () => doc,
    setText: () => undefined,
    focus: () => events.focused(),
    blur: () => events.blurred(),
    destroy: () => undefined,
  }),
  createDocument: () => {
    throw new Error('not used by the primer');
  },
  contains: () => false,
  typeInto: () => {},
  onPendingKeys: () => {},
  cancelPendingKeys: () => {},
  setKeymap: () => {},
};

type PrimerCommand = keyof ReturnType<typeof primerCommandHandlers>;

// One `keys.anchor` call the view made, its `dispose` a spy.
interface NamedAnchor {
  element: FakeElement;
  command: CommandId;
  options: AnchorOptions | undefined;
  dispose: Mock<() => void>;
}

// Primer p1, holding `entries`, open and active in its session's Primer tab,
// the visible tab; `tab` is the tab's element. The boxes and the commands are
// wired as the page wires them; `anchors` holds every anchor the view named.
function primerTabSetup(parts: { entries?: PrimerEntry[] } = {}) {
  const presented = presentedPrimer('p1', { entries: parts.entries });
  const store = createPrimerStore(
    initialState([presented], presented.sessionId),
  );
  const logs: string[] = [];
  const log = (_source: string, message: string) => logs.push(message);
  const boxes = createEditorBoxes(
    host,
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
  let tab: FakeElement | null = null;
  const view = mountPrimerTab({
    areas: {
      overlay: { contribute: () => ({ dispose: () => undefined }) },
    },
    sessions: {
      addTab: (_sessionId, view) => {
        tab = asFake(view.element);
        return {
          setStatus: () => undefined,
          select: () => undefined,
          takeOver: () => ({ release: () => undefined }),
          isVisible: () => true,
          remove: () => undefined,
        };
      },
    },
    beforeClose: () => true,
    setScope: () => undefined,
    pushConfirmScope: () => ({
      pop: () => undefined,
      onBaseChanged: () => undefined,
    }),
    store,
    boxes,
    markdown: {
      block: (text) => text,
      inline: (text) => text,
      document: async (text) => text,
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
    commands: { exists: () => true, run: () => undefined },
    platform: 'macos',
    uiState: { get: () => undefined, set: () => undefined },
    log,
  });
  if (tab === null) {
    throw new Error('the primer mounted no tab');
  }
  const handlers = primerCommandHandlers({
    store,
    boxes,
    finish: () => Promise.resolve(),
    closeSession: () => undefined,
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
    sessionId: presented.sessionId,
    tab: tab as FakeElement,
    // Fires `command` with no editor in its context, as a page key does.
    run: (command: PrimerCommand) => handlers[command]({}),
  };
}

function pane(tab: FakeElement, className: string): FakeElement {
  const [found] = findAll(tab, className);
  return found;
}

describe('primer tab under the cancel prompt', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the card behind a close prompt asked from the card', () => {
    const { store, sessionId, tab } = primerTabSetup();

    store.dispatch({ type: 'askClose', sessionId });

    expect(store.get().view).toBe('confirm');
    expect(pane(tab, 'primer-card').hidden).toBe(false);
    expect(pane(tab, 'primer-review-pane').hidden).toBe(true);
  });

  it('shows the review behind a cancel prompt asked from the review', () => {
    const { store, tab } = primerTabSetup();
    store.dispatch({ type: 'openReview' });

    store.dispatch({ type: 'askCancel' });

    expect(store.get().view).toBe('confirm');
    expect(pane(tab, 'primer-card').hidden).toBe(true);
    expect(pane(tab, 'primer-review-pane').hidden).toBe(false);
  });
});

describe('primer item card', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Task `1` with an added second item, on item 2's card.
  function onAddedItem(added: boolean) {
    const setup = primerTabSetup({
      entries: [
        primerEntry('1', 'primer', {
          items: [
            primerItem('Read the store'),
            primerItem('Write the store', { added, include: false }),
          ],
        }),
      ],
    });
    setup.store.dispatch({ type: 'selectRow', row: 1 });
    setup.store.dispatch({ type: 'selectRow', row: 3 });
    return setup;
  }

  it.each([true, false])(
    'holds the place, the item, its mark and its comment box (added %s)',
    (added) => {
      const { tab, boxes } = onAddedItem(added);
      const card = pane(tab, 'primer-card');

      expect(pane(card, 'primer-item-step').textContent).toContain('2 of 2');
      expect(pane(card, 'primer-card-heading').textContent).toBe(
        'Write the store',
      );
      const [mark] = findAll(card, 'ui-toggle-mark');
      expect(mark.classList.contains('is-selected')).toBe(false);
      expect(card.textContent.includes('Added')).toBe(added);
      const itemComment: PrimerBox = {
        primerId: 'p1',
        target: { field: 'itemComment', entryId: '1', item: 2 },
      };
      expect(boxes.isMounted(itemComment)).toBe(true);
      expect(findAll(card, 'primer-box')).toHaveLength(1);
    },
  );

  it('flips its mark on toggleInclude with no rebuild', () => {
    const { tab, boxes, run } = onAddedItem(false);
    const card = pane(tab, 'primer-card');
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
  setup: ReturnType<typeof primerTabSetup>,
  text: string,
): void {
  setup.store.dispatch({ type: 'selectRow', row: 1 });
  setup.boxes.focus(newItem1);
  setup.store.dispatch({
    type: 'setText',
    formId: 'p1',
    target: newItem1.target,
    value: text,
  });
}

function itemCount(setup: ReturnType<typeof primerTabSetup>): number {
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
    const setup = primerTabSetup();
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
    const setup = primerTabSetup();
    typeNewItem(setup, 'Test the store');

    setup.run('leaveBox');

    expect(itemCount(setup)).toBe(3);
    expect(addedLines(setup.logs)).toEqual([
      expect.stringContaining('item 3 on task 1'),
    ]);
    expect(setup.boxes.active()).toBeNull();
  });

  it('adds the item once on focusRail', () => {
    const setup = primerTabSetup();
    typeNewItem(setup, 'Test the store');

    setup.run('focusRail');

    expect(itemCount(setup)).toBe(3);
    expect(addedLines(setup.logs)).toEqual([
      expect.stringContaining('item 3 on task 1'),
    ]);
    expect(setup.boxes.active()).toBeNull();
  });

  it('leaves the card once the 20th item lands, focusing the task comment box on nextBox', () => {
    const setup = primerTabSetup({ entries: taskWithItems(19) });
    typeNewItem(setup, 'Test the store');

    setup.run('nextBox');

    expect(itemCount(setup)).toBe(20);
    expect(addedLines(setup.logs)).toEqual([
      expect.stringContaining('item 20 on task 1'),
    ]);
    expect(setup.boxes.isMounted(newItem1)).toBe(false);
    expect(findAll(setup.tab, 'primer-field')).toHaveLength(1);
    const active = setup.boxes.active();
    expect(active === null ? null : boxKey(active)).toBe('p1/task/1/comment');
  });

  it('focuses the task comment box on prevBox from the box the 20th item filled', () => {
    const setup = primerTabSetup({ entries: taskWithItems(19) });
    typeNewItem(setup, 'Test the store');

    setup.run('prevBox');

    expect(itemCount(setup)).toBe(20);
    const active = setup.boxes.active();
    expect(active === null ? null : boxKey(active)).toBe('p1/task/1/comment');
  });

  it('shows no add-item box on a task holding 20 items, and the add-item key refuses once', () => {
    const setup = primerTabSetup({ entries: taskWithItems(20) });
    setup.store.dispatch({ type: 'selectRow', row: 1 });

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
    const { tab, anchors } = primerTabSetup({ entries: taskWithItems(0) });

    const adds = anchorsOf(anchors, 'primer.addExtraTask');
    const header = findAll(tab, 'ui-section-header').find((node) =>
      node.textContent.startsWith('Extra tasks'),
    );
    expect(adds).toHaveLength(1);
    expect(header).toBeDefined();
    expect(isInside(adds[0].element, header as FakeElement)).toBe(true);
    expect(adds[0].options).toEqual({ scope: 'primer.rail', label: 'add' });
  });

  it("anchors the item card's step keys in the rail and the card scope, so they show while either has focus", () => {
    const { store, tab, anchors } = primerTabSetup();
    store.dispatch({ type: 'selectRow', row: 1 });
    store.dispatch({ type: 'selectRow', row: 2 });

    const [step] = findAll(tab, 'primer-item-step');
    const stepAnchors = anchors
      .filter((anchor) => isInside(anchor.element, step))
      .map((anchor) => [anchor.command, anchor.options?.scope]);
    expect(stepAnchors).toEqual([
      ['primer.prevRow', 'primer.rail'],
      ['primer.prevRow', 'primer.card'],
      ['primer.nextRow', 'primer.rail'],
      ['primer.nextRow', 'primer.card'],
    ]);
  });

  it('moves the row prompt to the selected row and shows include only on an item row and remove only on an extra task', () => {
    // Rows: the feature (0), `1` (1), `s1` (2), `extra-1` (3); on `1`, its
    // items at 2 and 3.
    const { store, tab, anchors } = primerTabSetup();
    const [remove] = anchorsOf(anchors, 'primer.removeExtraTask');
    const [include] = anchorsOf(anchors, 'primer.toggleInclude').filter(
      (anchor) => anchor.options?.scope === 'primer.rail',
    );
    const selectedRowNode = () => {
      const [prompt] = findAll(tab, 'primer-row-prompt');
      const [selected] = findAll(tab, 'is-selected').filter((node) =>
        node.classList.contains('ui-row'),
      );
      expect(prompt.parentNode).toBe(selected);
      return selected;
    };
    expect(findAll(tab, 'primer-row-prompt')).toHaveLength(0);

    store.dispatch({ type: 'selectRow', row: 3 });
    expect(selectedRowNode().textContent).toContain('extra-1 task');
    expect(remove.element.hidden).toBe(false);
    expect(include.element.hidden).toBe(true);

    store.dispatch({ type: 'selectRow', row: 1 });
    expect(selectedRowNode().textContent).toContain('1 task');
    expect(remove.element.hidden).toBe(true);
    expect(include.element.hidden).toBe(true);

    store.dispatch({ type: 'selectRow', row: 3 });
    expect(selectedRowNode().textContent).toContain('Write the store');
    expect(include.element.hidden).toBe(false);
    expect(remove.element.hidden).toBe(true);
  });

  it("draws the selected task's items as rail rows and toggles one by its mark", () => {
    const { store, tab } = primerTabSetup();
    store.dispatch({ type: 'selectRow', row: 1 });
    const rail = pane(tab, 'primer-rail');
    expect(findAll(rail, 'primer-rail-item-lead')).toHaveLength(2);

    const [, secondLead] = findAll(rail, 'primer-rail-item-lead');
    const [mark] = findAll(secondLead, 'ui-toggle-mark');
    mark.click();

    const primer = store.get().forms[0];
    expect(primer.selected).toEqual({ kind: 'item', entryId: '1', item: 2 });
    expect(primer.entries[0].items.map((item) => item.include)).toEqual([
      true,
      false,
    ]);
  });
});

// The element a part drew into `paneClass`'s pane: its first child.
function partIn(tab: FakeElement, paneClass: string): FakeElement {
  return pane(tab, paneClass).children[0];
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
    const { store, tab } = primerTabSetup();
    const layoutOf = (paneClass: string) => {
      const part = partIn(tab, paneClass);
      return [part.dataset.layout, part.dataset.layoutOwner];
    };
    const drawn = [layoutOf('primer-card'), layoutOf('primer-rail-body')];
    store.dispatch({ type: 'selectRow', row: 1 });
    drawn.push(layoutOf('primer-card'));
    store.dispatch({ type: 'selectRow', row: 2 });
    drawn.push(layoutOf('primer-card'));
    store.dispatch({ type: 'openReview' });
    drawn.push(layoutOf('primer-review-body'));

    expect(drawn).toEqual(Array(5).fill(['default', 'primer']));
  });

  it('draws a part from the user layout when it defines it, the rest from default', () => {
    const { store, tab, view } = primerTabSetup();
    view.setLayouts(withUser<PrimerLayout>(defaultLayout, BARE_TASK));

    store.dispatch({ type: 'selectRow', row: 1 });
    const task = partIn(tab, 'primer-card').dataset.layout;
    const rail = partIn(tab, 'primer-rail-body').dataset.layout;
    store.dispatch({ type: 'selectRow', row: 2 });
    const item = partIn(tab, 'primer-card').dataset.layout;

    expect({ task, item, rail }).toEqual({
      task: USER_LAYOUT,
      item: 'default',
      rail: 'default',
    });
  });

  it('falls back to default when a user card throws after mounting a box, mounting each box once', () => {
    const { store, tab, view, boxes, logs } = primerTabSetup();
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

    store.dispatch({ type: 'selectRow', row: 1 });

    const card = partIn(tab, 'primer-card');
    expect(card.dataset.layout).toBe('default');
    expect(logs).toContainEqual(
      expect.stringContaining(
        `layout ${USER_LAYOUT} task card failed: card broke`,
      ),
    );
    expect(boxes.isMounted(taskComment1)).toBe(true);
    expect(boxes.isMounted(newItem1)).toBe(true);
    expect(findAll(pane(tab, 'primer-card'), 'primer-box')).toHaveLength(2);
  });

  it('appends the boxes a user card leaves out, in shownBoxes order', () => {
    const setup = primerTabSetup();
    setup.view.setLayouts(withUser<PrimerLayout>(defaultLayout, BARE_TASK));
    setup.store.dispatch({ type: 'selectRow', row: 1 });

    const card = partIn(setup.tab, 'primer-card');
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
    const { store, tab, view, boxes } = primerTabSetup();
    store.dispatch({ type: 'selectRow', row: 1 });
    boxes.focus(taskComment1);
    const before = partIn(tab, 'primer-card');

    view.setLayouts(withUser<PrimerLayout>(defaultLayout, BARE_TASK));

    const after = partIn(tab, 'primer-card');
    expect(after).not.toBe(before);
    expect(after.dataset.layout).toBe(USER_LAYOUT);
    const active = boxes.active();
    expect(active === null ? null : boxKey(active)).toBe('p1/task/1/comment');
  });

  it("runs the item card's update on a toggle without a rebuild", () => {
    const { store, tab, view, run } = primerTabSetup();
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
    store.dispatch({ type: 'selectRow', row: 1 });
    store.dispatch({ type: 'selectRow', row: 2 });
    const card = partIn(tab, 'primer-card');
    updates.length = 0;

    run('toggleInclude');

    expect(partIn(tab, 'primer-card')).toBe(card);
    expect(updates).toEqual([false]);
  });

  it("appends the row prompt at the rail pane's end when the rail never calls railRow for the selected row", () => {
    const { store, tab, view } = primerTabSetup();
    view.setLayouts(
      withUser<PrimerLayout>(defaultLayout, {
        rail(parent, input, kit) {
          const list = kit.el(parent, 'div', 'plain-rail');
          kit.row(list, { density: 'list', label: input.feature.kind });
          return { element: list };
        },
      }),
    );

    store.dispatch({ type: 'selectRow', row: 1 });

    const [prompt] = findAll(tab, 'primer-row-prompt');
    const rail = partIn(tab, 'primer-rail-body');
    expect(rail.dataset.layout).toBe(USER_LAYOUT);
    expect(prompt.parentNode).toBe(rail);
  });

  it("disposes a part's anchors before it draws the part again and when the view goes", () => {
    const { store, tab, view, anchors, sessionId } = primerTabSetup();
    store.dispatch({ type: 'selectRow', row: 1 });
    const inPane = (paneClass: string) =>
      anchors.filter((anchor) =>
        isInside(anchor.element, pane(tab, paneClass)),
      );
    const firstRail = inPane('primer-rail-body').filter(
      (anchor) => anchor.command === 'primer.addExtraTask',
    );
    const firstCard = inPane('primer-card');
    const [edge] = anchorsOf(anchors, 'primer.focusRail');

    store.dispatch({ type: 'selectRow', row: 2 });
    const secondRail = inPane('primer-rail-body').filter(
      (anchor) => anchor.command === 'primer.addExtraTask',
    );
    const secondCard = inPane('primer-card');
    const disposedOnRedraw = [...firstRail, ...firstCard].map(
      (anchor) => anchor.dispose.mock.calls.length,
    );
    view.forgetSession(sessionId);

    expect(firstRail).toHaveLength(1);
    expect(firstCard.length).toBeGreaterThan(0);
    expect(disposedOnRedraw.every((calls) => calls === 1)).toBe(true);
    for (const anchor of [...secondRail, ...secondCard, edge]) {
      expect(anchor.dispose).toHaveBeenCalledOnce();
    }
  });
});
