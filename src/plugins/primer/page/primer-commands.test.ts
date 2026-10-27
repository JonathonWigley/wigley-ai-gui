import { describe, expect, it, vi } from 'vitest';
import type { AgentFormEnd } from '../../../contracts/agent-forms';
import type {
  ContentScroll,
  FocusOptions,
  ScrollStep,
  TextEditor,
} from '../../../contracts/editor';
import type { PageCommandContext, ToastTone } from '../../../contracts/plugin';
import type { PrimerBody, PrimerEntry, PrimerFeature } from '../contract';
import { boxKey, type PrimerBox } from './boxes';
import {
  closePrimerFromMain,
  guardClose,
  primerCommandHandlers,
} from './primer-commands';
import {
  activePrimer,
  buildBody,
  initialState,
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
    focus: () => undefined,
    blur: () => undefined,
    destroy: () => undefined,
  };
  boxEditors.set(editor, box);
  return editor;
}

// Primer `p1`, active; rows: the feature (0), `1` with two items (1), `s1`
// (2), `extra-1` (3) unless `entries` says otherwise.
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
  const focusOptions: (FocusOptions | undefined)[] = [];
  let active: PrimerBox | null = null;
  let leaves = 0;
  const finished: { primerId: string; end: AgentFormEnd<PrimerBody> }[] = [];
  const toasts: string[] = [];
  const toastTones: ToastTone[] = [];
  const logs: string[] = [];
  let finishFailure: Error | null = null;
  const scrolls: [ScrollStep, 1 | -1][] = [];
  let scrollResult: ContentScroll | null = { moved: true, atEnd: false };
  const closedSessions: string[] = [];
  const log = (_source: string, message: string) => logs.push(message);
  const closeSession = (sessionId: string) => closedSessions.push(sessionId);
  const toast = (text: string, tone: ToastTone) => {
    toasts.push(text);
    toastTones.push(tone);
  };
  const handlers = primerCommandHandlers({
    store,
    boxes: {
      focus: (box, options) => {
        focused.push(box);
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
    toast,
    log,
  });
  // Each Primer tab the guard selected, and each session it selected.
  const shownPrimers: string[] = [];
  const activated: string[] = [];
  const run = (command: PrimerCommand, context: PageCommandContext = {}) =>
    handlers[command](context);
  const primer = () => {
    const current = activePrimer(store.get());
    if (current === null) {
      throw new Error('No primer is active');
    }
    return current;
  };
  return {
    store,
    run,
    primer,
    focused,
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
    const { run, logs } = setup();

    run('prevRow');
    run('nextRow');

    expect(logs).toEqual(['selected task 1']);
  });

  it('says no task is selected when a need key fires on the Feature row', () => {
    const { run, logs } = setup();

    run('needYes');

    expect(logs).toEqual(['no task selected']);
  });

  it('logs a changed need, and nothing for the need already held', () => {
    const { run, primer, logs } = setup();
    run('nextRow');
    logs.length = 0;

    run('needYes');
    run('needYes');

    expect(selectedEntry(primer())?.need).toBe('yes');
    expect(logs).toEqual(['need yes on task 1']);
  });

  it("acts on the box's task when a need key fires in a box", () => {
    const { run, primer, logs } = setup();

    run('needNo', { editor: editorOf(newItem1) });

    expect(selectedEntry(primer())?.id).toBe('1');
    expect(selectedEntry(primer())?.need).toBe('no');
    expect(logs).toEqual(['need no on task 1']);
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

    expect(logs).toEqual(['no task added: the primer holds 60 tasks']);
    expect(focused).toEqual([]);
  });

  it('removes an extra task and logs it', () => {
    const { run, primer, logs } = setup();
    run('nextRow');
    run('nextRow');
    run('nextRow');
    logs.length = 0;

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
    expect(logs).toEqual(['only an extra task can be removed']);
  });

  it('logs focusing the card once, then the rail, leaving any box', () => {
    const { run, logs, leaves } = setup();

    run('focusCard');
    run('focusCard');
    run('focusRail');

    expect(logs).toEqual(['focused the card', 'focused the rail']);
    expect(leaves()).toBe(1);
  });

  it('logs the selected item, and nothing at the last item', () => {
    const { run, logs } = setup();
    run('nextRow');
    logs.length = 0;

    run('nextItem');
    run('nextItem');

    expect(logs).toEqual(['selected item 2 on task 1']);
  });

  it('toggles the include mark and logs each way', () => {
    const { run, logs } = setup();
    run('nextRow');
    logs.length = 0;

    run('toggleInclude');
    run('toggleInclude');

    expect(logs).toEqual([
      'left out item 1 on task 1',
      'included item 1 on task 1',
    ]);
  });

  it('says no item is selected for the item keys on a task with no items', () => {
    const { run, logs, focused } = setup();
    run('nextRow');
    run('nextRow');
    logs.length = 0;

    run('toggleInclude');
    run('editItemComment');

    expect(logs).toEqual(['no item selected', 'no item selected']);
    expect(focused).toEqual([]);
  });

  it("focuses the item's comment box and the task's comment box at the end", () => {
    const { run, focused, focusOptions } = setup();
    run('nextRow');
    run('nextItem');

    run('editItemComment');
    run('editTaskComment');

    expect(focused.map(boxKey)).toEqual([
      'p1/task/1/item/2/comment',
      'p1/task/1/comment',
    ]);
    expect(focusOptions).toEqual([
      { insertAtEnd: true },
      { insertAtEnd: true },
    ]);
  });

  it('says no task is selected for the task keys on the Feature row', () => {
    const { run, logs, focused } = setup();

    run('editTaskComment');
    run('addItem');

    expect(logs).toEqual(['no task selected', 'no task selected']);
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
    expect(capped.logs).toEqual(['no item added: task 1 holds 20 items']);
  });

  it('focuses the first box, or says there is none in the review', () => {
    const { run, focused, logs } = setup();

    run('editFirstField');
    run('openReview');
    run('editFirstField');

    expect(focused.map(boxKey)).toEqual(['p1/feature/name']);
    expect(logs).toEqual(['review opened', 'no box to focus']);
  });

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
      primerId: 'p1',
      target: newItem1.target,
      value: 'Test the store',
    });
    setActive(newItem1);
    logs.length = 0;

    run('nextBox');

    expect(primer().entries[0].items.at(-1)?.text).toBe('Test the store');
    expect(logs).toEqual(['added item 3 on task 1']);
    expect(focused.map(boxKey)).toEqual(['p1/task/1/comment']);
  });

  it('adds the add-item text on leaveBox, then leaves the box', () => {
    const { run, store, primer, logs, leaves } = setup();
    store.dispatch({
      type: 'setText',
      primerId: 'p1',
      target: newItem1.target,
      value: 'Test the store',
    });

    run('leaveBox', { editor: editorOf(newItem1) });

    expect(primer().entries[0].items).toHaveLength(3);
    expect(logs).toEqual(['added item 3 on task 1', 'left the box']);
    expect(leaves()).toBe(1);
  });

  it('adds nothing on leaveBox from a task holding 20 items', () => {
    const full = primerEntry('1', 'primer', {
      items: Array.from({ length: 20 }, (_, i) => primerItem(`Item ${i}`)),
    });
    const { run, store, primer, logs } = setup({ entries: [full] });
    store.dispatch({
      type: 'setText',
      primerId: 'p1',
      target: newItem1.target,
      value: 'Test the store',
    });

    run('leaveBox', { editor: editorOf(newItem1) });

    expect(primer().entries[0].items).toHaveLength(20);
    expect(logs).toEqual([
      'no item added: task 1 holds 20 items',
      'left the box',
    ]);
  });

  it('adds nothing for blank add-item text', () => {
    const { run, primer, logs } = setup();

    run('leaveBox', { editor: editorOf(newItem1) });

    expect(primer().entries[0].items).toHaveLength(2);
    expect(logs).toEqual(['left the box']);
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
    expect(logs).toEqual([
      'scrolled the primer down half a page',
      'scrolled the primer up a line to the top',
    ]);
  });

  it('logs no primer to scroll', () => {
    const { run, logs, setScroll } = setup();
    setScroll(null);

    run('lineDown');

    expect(logs).toEqual(['no primer to scroll']);
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
    expect(logs).toEqual([
      'submit refused: The slug must be lowercase letters, digits and dashes, starting with a letter or digit.',
    ]);
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

    expect(store.get().primers).toEqual([]);
    expect(store.get().view).toBe('idle');
    expect(logs.at(-1)).toBe('submitted');
    expect(toasts).toEqual(['Primer sent: project · p1']);
    expect(toastTones).toEqual(['success']);
  });

  it('keeps a primer whose finish rejects and toasts the error', async () => {
    const { run, primer, toasts, toastTones, logs, failFinish } = setup();
    run('openReview');
    failFinish(new Error('disk full'));

    run('submit');

    await vi.waitFor(() =>
      expect(toasts).toEqual(['Primer not sent: disk full']),
    );
    expect(toastTones).toEqual(['error']);
    expect(logs).toContain('primer p1 not finished: disk full');
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
    expect(toasts).toEqual(['Primer cancelled: project · p1']);
    expect(toastTones).toEqual(['info']);
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

    expect(logs).toEqual(['session close kept: project · p1 is sending']);
    expect(toasts).toEqual(["Sending project · p1's primer…"]);
    expect(toastTones).toEqual(['info']);
    expect(activated).toEqual([]);
    expect(shownPrimers).toEqual([]);
  });

  it("keeps a background primer's session, says why and selects it", () => {
    const { store, logs, toasts, toastTones, activated, guardClose } = setup();
    store.dispatch({ type: 'primerShown', primer: presentedPrimer('p2') });
    const before = store.get();

    expect(guardClose('p2-session')).toBe(false);

    expect(store.get()).toBe(before);
    expect(logs).toEqual([
      'session close kept: project · p2 is open in the background',
    ]);
    expect(toasts).toEqual(["Finish or cancel project · p2's primer first"]);
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
