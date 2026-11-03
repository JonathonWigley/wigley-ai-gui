import { describe, expect, it, vi } from 'vitest';
import { activeForm } from '../../../shared/page/session-forms';
import type { AgentFormEnd } from '../../../contracts/agent-forms';
import type {
  ContentScroll,
  FocusOptions,
  ScrollStep,
  TextEditor,
} from '../../../contracts/editor';
import type { PaneDirection } from '../../../contracts/panes';
import type { PageCommandContext, ToastTone } from '../../../contracts/plugin';
import type { PrimerBody, PrimerEntry, PrimerFeature } from '../contract';
import { boxKey, type PrimerBox } from './boxes';
import {
  closePrimerFromMain,
  guardClose,
  type PrimerCommandDeps,
  primerCommandHandlers,
  primerFocusTarget,
} from './primer-commands';
import {
  buildBody,
  cardRow,
  initialState,
  type PrimerPane,
  rowName,
  selectedEntry,
} from './primer-state';
import { createPrimerStore } from './primer-store';
import {
  presentedPrimer,
  primerEntries,
  primerEntry,
  primerFeature,
  primerItem,
} from './test-primers';

type PrimerCommand = keyof ReturnType<typeof primerCommandHandlers>;

// The editor of each box a test fires a command in.
const boxEditors = new Map<TextEditor, PrimerBox>();

function editorOf(box: PrimerBox): TextEditor {
  const editor: TextEditor = {
    text: () => '',
    setText: () => undefined,
    insert: () => undefined,
    charBeforeCursor: () => '',
    focus: () => undefined,
    blur: () => undefined,
    destroy: () => undefined,
  };
  boxEditors.set(editor, box);
  return editor;
}

// Primer `p1`, active on the Feature row; tasks column rows: the feature (0),
// `1` with two items (1), `s1` (2), `extra-1` (3) unless `entries` says
// otherwise. `focusedRows` holds the card row's name at each focus.
function setup(
  parts: { entries?: PrimerEntry[]; feature?: PrimerFeature } = {},
) {
  const store = createPrimerStore(
    initialState(
      [
        presentedPrimer('p1', {
          entries: parts.entries ?? primerEntries(),
          feature: parts.feature,
        }),
      ],
      'p1-session',
    ),
  );
  const focused: PrimerBox[] = [];
  const focusedRows: string[] = [];
  const focusOptions: (FocusOptions | undefined)[] = [];
  let active: PrimerBox | null = null;
  let leaves = 0;
  const finished: { primerId: string; end: AgentFormEnd<PrimerBody> }[] = [];
  const toasts: string[] = [];
  const toastTones: ToastTone[] = [];
  const logs: string[] = [];
  let finishFailure: Error | null = null;
  let previewFailure: Error | null = null;
  const scrolls: [ScrollStep, 1 | -1][] = [];
  let scrollResult: ContentScroll | null = { moved: true, atEnd: false };
  const closedSessions: string[] = [];
  const log = (message: string) => logs.push(message);
  const closeSession = (sessionId: string) => closedSessions.push(sessionId);
  const toast = (text: string, tone: ToastTone) => {
    toasts.push(text);
    toastTones.push(tone);
  };
  const deps: PrimerCommandDeps = {
    store,
    boxes: {
      focus: (box, options) => {
        focused.push(box);
        const shown = activeForm(store.get());
        focusedRows.push(shown === null ? '' : rowName(cardRow(shown)));
        focusOptions.push(options);
        active = box;
      },
      leave: () => {
        leaves++;
        active = null;
      },
      active: () => active,
      boxOf: (editor) => boxEditors.get(editor),
    },
    finish: (primerId, end) => {
      finished.push({ primerId, end });
      return finishFailure === null
        ? Promise.resolve()
        : Promise.reject(finishFailure);
    },
    closeSession,
    scrollPrimer: (step, direction) => {
      scrolls.push([step, direction]);
      return scrollResult;
    },
    openPreview: () =>
      previewFailure === null
        ? Promise.resolve()
        : Promise.reject(previewFailure),
    toast,
    log,
  };
  const handlers = primerCommandHandlers(deps);
  const focusTarget = primerFocusTarget(deps);
  // Each Primer tab the guard selected, and each session it selected.
  const shownPrimers: string[] = [];
  const activated: string[] = [];
  const run = (command: PrimerCommand, context: PageCommandContext = {}) =>
    handlers[command](context);
  // A press of the core's focus key toward `direction`.
  const move = (direction: PaneDirection) => focusTarget.move(direction);
  const primer = () => {
    const current = activeForm(store.get());
    if (current === null) {
      throw new Error('No primer is active');
    }
    return current;
  };
  return {
    store,
    run,
    move,
    primer,
    focused,
    focusedRows,
    focusOptions,
    finished,
    toasts,
    toastTones,
    logs,
    scrolls,
    closedSessions,
    shownPrimers,
    activated,
    leaves: () => leaves,
    // Makes every later scroll return `result`.
    setScroll: (result: ContentScroll | null) => {
      scrollResult = result;
    },
    // Makes every later finish reject with `error`.
    failFinish: (error: Error) => {
      finishFailure = error;
    },
    // Makes every later preview open reject with `error`.
    failPreview: (error: Error) => {
      previewFailure = error;
    },
    // Main's formClosed for `primerId` reaching the page.
    closeFromMain: (primerId: string, byFinish = true) =>
      closePrimerFromMain(
        { store, closeSession, toast, log },
        { formId: primerId, byFinish },
      ),
    guardClose: (sessionId: string) =>
      guardClose(
        {
          store,
          toast,
          log,
          showPrimer: (id) => shownPrimers.push(id),
          activate: (id) => activated.push(id),
        },
        sessionId,
      ),
    // Focuses a box as the user clicking into it would, outside any command.
    setActive: (box: PrimerBox) => {
      active = box;
    },
  };
}

const newItem1: PrimerBox = {
  primerId: 'p1',
  target: { field: 'newItem', entryId: '1' },
};

describe('primerCommandHandlers', () => {
  it('logs the selected row, and nothing at the first row', () => {
    const { run, move, logs } = setup();

    run('prevRow');
    run('nextRow');
    move('right');
    logs.length = 0;
    run('nextRow');

    expect(logs).toEqual(['selected item 2 on task 1']);
  });

  it('says no task is selected when a need key fires on the Feature row', () => {
    const { run, logs } = setup();

    run('needYes');

    expect(logs).toHaveLength(1);
  });

  it('logs a changed need, and nothing for the need already held', () => {
    const { run, primer, logs } = setup();
    run('nextRow');
    logs.length = 0;

    run('needYes');
    run('needYes');

    expect(selectedEntry(primer())?.need).toBe('yes');
    expect(logs).toEqual([expect.stringContaining('task 1')]);
  });

  it("acts on the box's task when a need key fires in a box", () => {
    const { run, primer, logs } = setup();

    run('needNo', { editor: editorOf(newItem1) });

    expect(selectedEntry(primer())?.id).toBe('1');
    expect(selectedEntry(primer())?.need).toBe('no');
    expect(logs).toEqual([expect.stringContaining('task 1')]);
  });

  it("adds an extra task and focuses its name box at the text's end", () => {
    const { run, logs, focused, focusOptions } = setup();

    run('addExtraTask');

    expect(logs).toEqual(['added extra task extra-2']);
    expect(focused.map(boxKey)).toEqual(['p1/task/extra-2/name']);
    expect(focusOptions).toEqual([{ insertAtEnd: true }]);
  });

  it('adds no extra task at 60 tasks', () => {
    const entries = Array.from({ length: 60 }, (_, i) =>
      primerEntry(`${i + 1}`, 'primer'),
    );
    const { run, logs, focused } = setup({ entries });

    run('addExtraTask');

    expect(logs).toHaveLength(1);
    expect(focused).toEqual([]);
  });

  it('removes an extra task and logs it', () => {
    const { run, store, primer, logs } = setup();
    store.dispatch({ type: 'selectTask', row: 3 });

    run('removeExtraTask');

    expect(primer().entries.map((entry) => entry.id)).toEqual(['1', 's1']);
    expect(logs).toEqual(['removed extra task extra-1']);
  });

  it('refuses to remove a task that is not an extra one', () => {
    const { run, primer, logs } = setup();
    run('nextRow');
    logs.length = 0;

    run('removeExtraTask');

    expect(primer().entries).toHaveLength(3);
    expect(logs).toHaveLength(1);
  });

  // A move into a column commits add-item text and leaves the box; a move to
  // the card keeps it.
  it.each<{
    from: PrimerPane;
    direction: PaneDirection;
    pane: PrimerPane;
    moved: boolean;
    leaves: number;
  }>([
    {
      from: 'tasks',
      direction: 'right',
      pane: 'items',
      moved: true,
      leaves: 1,
    },
    { from: 'items', direction: 'right', pane: 'card', moved: true, leaves: 0 },
    { from: 'items', direction: 'left', pane: 'tasks', moved: true, leaves: 1 },
    { from: 'card', direction: 'left', pane: 'items', moved: true, leaves: 1 },
    {
      from: 'tasks',
      direction: 'left',
      pane: 'tasks',
      moved: false,
      leaves: 0,
    },
    { from: 'card', direction: 'right', pane: 'card', moved: false, leaves: 0 },
    { from: 'items', direction: 'up', pane: 'items', moved: false, leaves: 0 },
    { from: 'card', direction: 'down', pane: 'card', moved: false, leaves: 0 },
  ])(
    'moves focus $direction from $from to $pane, logging the move once',
    ({ from, direction, pane, moved, leaves: expectedLeaves }) => {
      const { move, store, primer, logs, leaves } = setup();
      store.dispatch({ type: 'focusPane', pane: from });

      const result = move(direction);

      expect(result).toBe(moved);
      expect(primer().pane).toBe(pane);
      expect(logs).toEqual(moved ? [`focused the ${pane}`] : []);
      expect(leaves()).toBe(expectedLeaves);
    },
  );

  it('moves no focus outside the primer view', () => {
    const { run, move, store } = setup();
    run('openReview');

    expect(move('left')).toBe(false);
    expect(move('right')).toBe(false);
    expect(store.get().view).toBe('review');
  });

  it('steps rows from a box, committing add-item text first', () => {
    const { run, store, primer, logs } = setup();
    store.dispatch({
      type: 'setText',
      formId: 'p1',
      target: newItem1.target,
      value: 'Test the store',
    });

    run('nextRow', { editor: editorOf(newItem1) });

    expect(primer().entries[0].items.at(-1)?.text).toBe('Test the store');
    // The box's card shows from the tasks column, so the step moves there.
    expect(logs).toEqual(['added item 3 on task 1', 'selected task s1']);
  });

  it('toggles the include mark and logs each way', () => {
    const { run, store, logs } = setup();
    store.dispatch({ type: 'selectTask', row: 1 });
    store.dispatch({ type: 'focusPane', pane: 'items' });
    logs.length = 0;

    run('toggleInclude');
    run('toggleInclude');

    expect(logs).toEqual([
      'left out item 1 on task 1',
      'included item 1 on task 1',
    ]);
  });

  it('says no item is selected for the item keys on a task row', () => {
    const { run, store, logs, focused } = setup();
    store.dispatch({ type: 'selectTask', row: 1 });
    logs.length = 0;

    run('toggleInclude');
    run('editItemComment');

    expect(logs).toEqual(['no item selected', 'no item selected']);
    expect(focused).toEqual([]);
  });

  it("focuses the item's comment box, and from its item card the task's boxes once the task card shows", () => {
    const { run, store, focused, focusedRows, focusOptions } = setup();
    const onItem2 = () => {
      store.dispatch({ type: 'selectTask', row: 1 });
      store.dispatch({ type: 'selectItem', item: 2 });
    };
    onItem2();

    run('editItemComment');
    run('editTaskComment');
    onItem2();
    run('addItem');

    expect(focused.map(boxKey)).toEqual([
      'p1/task/1/item/2/comment',
      'p1/task/1/comment',
      'p1/task/1/new-item',
    ]);
    expect(focusedRows).toEqual(['item 2 on task 1', 'task 1', 'task 1']);
    expect(focusOptions).toEqual([
      { insertAtEnd: true },
      { insertAtEnd: true },
      { insertAtEnd: true },
    ]);
  });

  it('says no task is selected for the task keys on the Feature row', () => {
    const { run, logs, focused } = setup();

    run('editTaskComment');
    run('addItem');

    expect(logs).toHaveLength(2);
    expect(focused).toEqual([]);
  });

  it('focuses the add-item box, or refuses on a task holding 20 items', () => {
    const full = primerEntry('1', 'primer', {
      items: Array.from({ length: 20 }, (_, i) => primerItem(`Item ${i}`)),
    });
    const open = setup();
    const capped = setup({ entries: [full] });
    open.run('nextRow');
    capped.run('nextRow');
    capped.logs.length = 0;

    open.run('addItem');
    capped.run('addItem');

    expect(open.focused.map(boxKey)).toEqual(['p1/task/1/new-item']);
    expect(capped.focused).toEqual([]);
    expect(capped.logs).toEqual([expect.stringContaining('task 1')]);
  });

  it('focuses the first box, or says there is none in the review', () => {
    const { run, focused, logs } = setup();

    run('editFirstField');
    run('openReview');
    run('editFirstField');

    expect(focused.map(boxKey)).toEqual(['p1/feature/name']);
    expect(logs).toEqual(['review opened', expect.any(String)]);
  });

  // `i` edits the first field of the Feature card and of an extra task; on
  // any other card it edits the box `a`, `C` or `c` would.
  it.each([
    { card: 'the Feature card', steps: [], box: 'p1/feature/name' },
    {
      card: 'an extra task',
      entries: [primerEntry('extra-1', 'extra')],
      steps: ['nextRow'],
      box: 'p1/task/extra-1/name',
    },
    { card: 'a task, as a', steps: ['nextRow'], box: 'p1/task/1/new-item' },
    {
      card: 'a full task, as C',
      entries: [
        primerEntry('1', 'primer', {
          items: Array.from({ length: 20 }, (_, i) => primerItem(`Item ${i}`)),
        }),
      ],
      steps: ['nextRow'],
      box: 'p1/task/1/comment',
    },
    {
      card: 'an item, as c',
      steps: ['nextRow'],
      moves: ['right'],
      box: 'p1/task/1/item/1/comment',
    },
  ])(
    'focuses $box on $card for editFirstField',
    ({ entries, steps, moves, box }) => {
      const { run, move, focused } = setup({ entries });
      for (const step of steps as PrimerCommand[]) {
        run(step);
      }
      for (const direction of (moves ?? []) as PaneDirection[]) {
        move(direction);
      }

      run('editFirstField');

      expect(focused.map(boxKey)).toEqual([box]);
    },
  );

  it('steps to the next box with no focus options', () => {
    const { run, focused, focusOptions, setActive } = setup();
    setActive({ primerId: 'p1', target: { field: 'feature', name: 'name' } });

    run('nextBox');

    expect(focused.map(boxKey)).toEqual(['p1/feature/slug']);
    expect(focusOptions).toEqual([undefined]);
  });

  it('adds the add-item text on nextBox and focuses the task comment box', () => {
    const { run, store, primer, focused, logs, setActive } = setup();
    run('nextRow');
    store.dispatch({
      type: 'setText',
      formId: 'p1',
      target: newItem1.target,
      value: 'Test the store',
    });
    setActive(newItem1);
    logs.length = 0;

    run('nextBox');

    expect(primer().entries[0].items.at(-1)?.text).toBe('Test the store');
    expect(logs).toEqual([expect.stringContaining('item 3 on task 1')]);
    expect(focused.map(boxKey)).toEqual(['p1/task/1/comment']);
  });

  it('opens the review and adds nothing from an add-item box on a task holding 20 items', () => {
    const full = primerEntry('1', 'primer', {
      items: Array.from({ length: 20 }, (_, i) => primerItem(`Item ${i}`)),
    });
    const { run, store, primer, logs } = setup({ entries: [full] });
    store.dispatch({
      type: 'setText',
      formId: 'p1',
      target: newItem1.target,
      value: 'Test the store',
    });

    run('openReview', { editor: editorOf(newItem1) });

    expect(store.get().view).toBe('review');
    expect(primer().entries[0].items).toHaveLength(20);
    expect(logs).toEqual([expect.stringContaining('task 1'), 'review opened']);
  });

  it('adds nothing for blank add-item text', () => {
    const { run, primer, logs } = setup();

    run('leaveBox', { editor: editorOf(newItem1) });

    expect(primer().entries[0].items).toHaveLength(2);
    expect(logs).toEqual(['left the box']);
  });

  it('sends add-item text no key committed once the review opens', () => {
    const { run, store, finished } = setup();
    store.dispatch({
      type: 'setText',
      formId: 'p1',
      target: newItem1.target,
      value: 'Test the store',
    });

    run('openReview');
    run('submit');

    const [sent] = finished;
    expect(sent.end.body.entries[0].items.map((item) => item.text)).toEqual([
      'Read the store',
      'Write the store',
      'Test the store',
    ]);
  });

  it('scrolls the primer and logs it', () => {
    const { run, logs, scrolls, setScroll } = setup();
    run('halfPageDown');
    setScroll({ moved: true, atEnd: true });
    run('lineUp');

    expect(scrolls).toEqual([
      ['halfPage', 1],
      ['line', -1],
    ]);
    expect(logs).toHaveLength(2);
  });

  it('logs no primer to scroll', () => {
    const { run, logs, setScroll } = setup();
    setScroll(null);

    run('lineDown');

    expect(logs).toHaveLength(1);
  });

  it('logs the review opening and closing once each', () => {
    const { run, logs } = setup();

    run('openReview');
    run('openReview');
    run('closeReview');
    run('closeReview');

    expect(logs).toEqual(['review opened', 'review closed']);
  });

  it('refuses a submit with problems and sends nothing', () => {
    const { run, finished, logs } = setup({
      feature: primerFeature({ slug: 'Bad Slug' }),
    });
    run('openReview');
    logs.length = 0;

    run('submit');

    expect(finished).toEqual([]);
    expect(logs).toEqual([expect.stringContaining('submit refused')]);
  });

  it('submits only from the review', () => {
    const { run, finished } = setup();

    run('submit');

    expect(finished).toEqual([]);
  });

  it('hands main the body on submit, then toasts the send when main closes it', () => {
    const {
      run,
      primer,
      store,
      finished,
      toasts,
      toastTones,
      logs,
      closeFromMain,
    } = setup();
    run('openReview');
    const body = buildBody(primer());

    run('submit');
    expect(finished).toEqual([
      { primerId: 'p1', end: { kind: 'submitted', body } },
    ]);
    expect(primer().sending).toEqual({
      kind: 'submitted',
      closesSession: false,
    });
    closeFromMain('p1');

    expect(store.get().forms).toEqual([]);
    expect(store.get().view).toBe('idle');
    expect(logs.at(-1)).toBe('submitted');
    expect(toasts).toEqual([expect.stringContaining('project · p1')]);
    expect(toastTones).toEqual(['success']);
  });

  it('keeps a primer whose finish rejects and toasts the error', async () => {
    const { run, primer, toasts, toastTones, logs, failFinish } = setup();
    run('openReview');
    failFinish(new Error('disk full'));

    run('submit');

    await vi.waitFor(() =>
      expect(toasts).toEqual([expect.stringContaining('disk full')]),
    );
    expect(toastTones).toEqual(['error']);
    expect(logs).toContainEqual(expect.stringContaining('p1'));
    expect(primer().sending).toBeNull();
  });

  it('asks before cancelling, then hands main a cancelled primer', () => {
    const { run, store, finished, toasts, toastTones, closeFromMain } = setup();
    run('openReview');

    run('askCancel');
    expect(store.get().view).toBe('confirm');
    run('dismissConfirm');
    expect(store.get().view).toBe('review');
    run('askCancel');
    run('confirmCancel');

    expect(finished.map((entry) => entry.end.kind)).toEqual(['cancelled']);
    closeFromMain('p1');
    expect(toasts).toEqual([expect.stringContaining('project · p1')]);
    expect(toastTones).toEqual(['info']);
  });
});

describe('openPreview', () => {
  it('logs and toasts a failed preview open', async () => {
    const { run, failPreview, logs, toasts, toastTones } = setup();
    failPreview(new Error('no preview session'));

    run('openPreview');

    await vi.waitFor(() =>
      expect(toasts).toEqual([expect.stringContaining('no preview session')]),
    );
    expect(toastTones).toEqual(['error']);
    expect(logs).toEqual([expect.stringContaining('no preview session')]);
  });
});

describe('guardClose', () => {
  it('keeps the session of a sending primer and says so', () => {
    const {
      run,
      logs,
      toasts,
      toastTones,
      activated,
      shownPrimers,
      guardClose,
    } = setup();
    run('openReview');
    run('submit');
    logs.length = 0;

    expect(guardClose('p1-session')).toBe(false);

    expect(logs).toEqual([expect.stringContaining('project · p1')]);
    expect(toasts).toEqual([expect.stringContaining('project · p1')]);
    expect(toastTones).toEqual(['info']);
    expect(activated).toEqual([]);
    expect(shownPrimers).toEqual([]);
  });

  it("keeps a background primer's session, says why and selects it", () => {
    const { store, logs, toasts, toastTones, activated, guardClose } = setup();
    store.dispatch({ type: 'formShown', form: presentedPrimer('p2') });
    const before = store.get();

    expect(guardClose('p2-session')).toBe(false);

    expect(store.get()).toBe(before);
    expect(logs).toEqual([expect.stringContaining('project · p2')]);
    expect(toasts).toEqual([expect.stringContaining('project · p2')]);
    expect(toastTones).toEqual(['info']);
    expect(activated).toEqual(['p2-session']);
  });

  it('asks to cancel the active primer, and confirming closes its session', () => {
    const {
      run,
      store,
      logs,
      shownPrimers,
      closedSessions,
      guardClose,
      closeFromMain,
    } = setup();

    expect(guardClose('p1-session')).toBe(false);
    expect(shownPrimers).toEqual(['p1-session']);
    expect(store.get().view).toBe('confirm');
    expect(logs).toEqual(['closing the session asks to cancel project · p1']);
    run('confirmCancel');
    closeFromMain('p1');

    expect(closedSessions).toEqual(['p1-session']);
  });

  it('lets a session with no primer close', () => {
    const { guardClose } = setup();

    expect(guardClose('other')).toBe(true);
  });
});
