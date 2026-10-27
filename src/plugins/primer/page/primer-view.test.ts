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
  asFake,
  type FakeElement,
  findAll,
  installFakeDom,
} from '../../../shared/page/test-dom';
import type { AnchorOptions } from '../../keys/contract';
import type { PrimerEntry } from '../contract';
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
  mountPrimerTab({
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
    },
    run: () => undefined,
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
    toast: () => undefined,
    log,
  });
  return {
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
    expect(addedLines(setup.logs)).toEqual(['added item 3 on task 1']);
    expect(setup.boxes.active()).toBeNull();
  });

  it('adds the item once on focusRail', () => {
    const setup = primerTabSetup();
    typeNewItem(setup, 'Test the store');

    setup.run('focusRail');

    expect(itemCount(setup)).toBe(3);
    expect(addedLines(setup.logs)).toEqual(['added item 3 on task 1']);
    expect(setup.boxes.active()).toBeNull();
  });

  it('leaves the card once the 20th item lands, focusing the task comment box on nextBox', () => {
    const setup = primerTabSetup({ entries: taskWithItems(19) });
    typeNewItem(setup, 'Test the store');

    setup.run('nextBox');

    expect(itemCount(setup)).toBe(20);
    expect(addedLines(setup.logs)).toEqual(['added item 20 on task 1']);
    expect(setup.boxes.isMounted(newItem1)).toBe(false);
    expect(
      findAll(setup.tab, 'primer-field').map((f) => f.textContent),
    ).toEqual(['Comment']);
    const active = setup.boxes.active();
    expect(active === null ? null : boxKey(active)).toBe('p1/task/1/comment');
  });

  it("focuses the new item's comment box on prevBox from the box the 20th item filled", () => {
    const setup = primerTabSetup({ entries: taskWithItems(19) });
    typeNewItem(setup, 'Test the store');

    setup.run('prevBox');

    const active = setup.boxes.active();
    expect(active === null ? null : boxKey(active)).toBe(
      'p1/task/1/item/20/comment',
    );
  });

  it('shows no add-item box on a task holding 20 items, and the add-item key refuses once', () => {
    const setup = primerTabSetup({ entries: taskWithItems(20) });
    setup.store.dispatch({ type: 'selectRow', row: 1 });

    setup.run('addItem');

    expect(setup.boxes.isMounted(newItem1)).toBe(false);
    expect(setup.logs).toEqual(['no item added: task 1 holds 20 items']);
  });
});

describe('primer rail with no extra tasks', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows only that there are no extra tasks', () => {
    const { tab } = primerTabSetup({ entries: taskWithItems(0) });

    const [line] = findAll(tab, 'ui-empty');
    expect(line.textContent).toBe('No extra tasks.');
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

  it('moves the row prompt to the selected task and shows remove only on an extra task', () => {
    // Rows: the feature (0), `1` (1), `s1` (2), `extra-1` (3).
    const { store, tab, anchors } = primerTabSetup();
    const [remove] = anchorsOf(anchors, 'primer.removeExtraTask');
    expect(findAll(tab, 'primer-row-prompt')).toHaveLength(0);

    store.dispatch({ type: 'selectRow', row: 3 });
    const [extraPrompt] = findAll(tab, 'primer-row-prompt');
    const [extraRow] = findAll(tab, 'is-selected');
    expect(extraPrompt.parentNode).toBe(extraRow);
    expect(extraRow.textContent).toContain('extra-1 task');
    expect(remove.element.hidden).toBe(false);

    store.dispatch({ type: 'selectRow', row: 1 });
    const [taskPrompt] = findAll(tab, 'primer-row-prompt');
    const [taskRow] = findAll(tab, 'is-selected');
    expect(taskPrompt.parentNode).toBe(taskRow);
    expect(taskRow.textContent).toContain('1 task');
    expect(remove.element.hidden).toBe(true);
  });

  it("disposes the old card's anchors on a card rebuild", () => {
    const { store, tab, anchors } = primerTabSetup();
    store.dispatch({ type: 'selectRow', row: 1 });
    const cardPane = pane(tab, 'primer-card');
    const firstCard = anchors.filter((anchor) =>
      isInside(anchor.element, cardPane),
    );
    const [edge] = anchorsOf(anchors, 'primer.focusRail');
    expect(firstCard.length).toBeGreaterThan(0);

    store.dispatch({ type: 'selectRow', row: 2 });

    for (const anchor of firstCard) {
      expect(anchor.dispose).toHaveBeenCalledOnce();
    }
    expect(edge.dispose).not.toHaveBeenCalled();
    expect(isInside(edge.element, tab)).toBe(true);
  });
});
