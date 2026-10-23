import { describe, expect, it, vi } from 'vitest';
import type { FocusOptions, TextEditor } from '../../../contracts/editor';
import type { PageCommandContext, ToastTone } from '../../../contracts/plugin';
import type { Finding, Question, RoundEnd } from '../contract';
import type { BoxRef } from './boxes';
import {
  activeRound,
  buildBody,
  focusedItem,
  initialState,
} from './form-state';
import {
  closeRoundFromMain,
  formsCommandHandlers,
  guardClose,
} from './forms-commands';
import { createFormsStore } from './forms-store';
import {
  decision,
  finding,
  nit,
  notice,
  presentedRound,
  question,
} from './test-rounds';

type FormsCommand = keyof ReturnType<typeof formsCommandHandlers>;

// The editor of each box a test fires a command in.
const boxEditors = new Map<TextEditor, BoxRef>();

function editorOf(box: BoxRef): TextEditor {
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

// Rail: notice 1 (position 0), then `findings`, then `questions`, by default
// Alpha and Beta (1 and 2 with no findings).
function setup(
  findings: Finding[] = [],
  questions: Question[] = [question('Alpha'), question('Beta')],
) {
  const store = createFormsStore(
    initialState(
      [
        presentedRound('r1', {
          notices: [notice('Heads up')],
          findings,
          questions,
        }),
      ],
      'r1-session',
    ),
  );
  const focused: BoxRef[] = [];
  const focusOptions: (FocusOptions | undefined)[] = [];
  let active: BoxRef | null = null;
  let leaves = 0;
  const finished: { roundId: string; end: RoundEnd }[] = [];
  const toasts: string[] = [];
  const toastTones: ToastTone[] = [];
  const logs: string[] = [];
  // Each layout method invoked, with its arguments.
  const layoutCalls: unknown[][] = [];
  let layoutFailure: Error | null = null;
  let finishFailure: Error | null = null;
  const invokeLayout = (...call: unknown[]) => {
    layoutCalls.push(call);
    return layoutFailure === null
      ? Promise.resolve()
      : Promise.reject(layoutFailure);
  };
  // Each closed session, with the rounds the store held at the call.
  const closedSessions: { sessionId: string; roundCount: number }[] = [];
  const log = (_source: string, message: string) => logs.push(message);
  const closeSession = (sessionId: string) =>
    closedSessions.push({ sessionId, roundCount: store.get().rounds.length });
  const toast = (text: string, tone: ToastTone) => {
    toasts.push(text);
    toastTones.push(tone);
  };
  const handlers = formsCommandHandlers({
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
    finish: (roundId, end) => {
      finished.push({ roundId, end });
      return finishFailure === null
        ? Promise.resolve()
        : Promise.reject(finishFailure);
    },
    closeSession,
    layouts: {
      cycleLayout: (step) => invokeLayout('cycleLayout', step),
      copyLayout: () => invokeLayout('copyLayout'),
      openPreview: () => invokeLayout('openPreview'),
    },
    toast,
    log,
  });
  // Each Form tab the guard selected, with the store's view at that moment.
  const shownForms: { sessionId: string; view: string }[] = [];
  const showForm = (sessionId: string) =>
    shownForms.push({ sessionId, view: store.get().view });
  // Each session the guard selected.
  const activated: string[] = [];
  const activate = (sessionId: string) => activated.push(sessionId);
  const run = (command: FormsCommand, context: PageCommandContext = {}) =>
    handlers[command](context);
  const round = () => {
    const current = activeRound(store.get());
    if (current === null) {
      throw new Error('No round is active');
    }
    return current;
  };
  return {
    store,
    handlers,
    run,
    round,
    focused,
    focusOptions,
    finished,
    toasts,
    toastTones,
    logs,
    layoutCalls,
    // Makes every later layout method reject with `error`.
    failLayouts: (error: Error) => {
      layoutFailure = error;
    },
    // Makes every later finish reject with `error`.
    failFinish: (error: Error) => {
      finishFailure = error;
    },
    // Main's roundClosed for `roundId` reaching the page; `byFinish` false is
    // main closing it on its own.
    closeFromMain: (roundId: string, byFinish = true) =>
      closeRoundFromMain(
        { store, closeSession, toast, log },
        { roundId, byFinish },
      ),
    closedSessions,
    shownForms,
    activated,
    guardClose: (sessionId: string) =>
      guardClose({ store, toast, log, showForm, activate }, sessionId),
    leaves: () => leaves,
    // Focuses a box as the user clicking into it would, outside any command.
    setActive: (box: BoxRef) => {
      active = box;
    },
  };
}

const notes1: BoxRef = {
  roundId: 'r1',
  target: { field: 'notes', item: { kind: 'question', index: 1 } },
};
const notes2: BoxRef = {
  roundId: 'r1',
  target: { field: 'notes', item: { kind: 'question', index: 2 } },
};
const reason1: BoxRef = {
  roundId: 'r1',
  target: { field: 'dontAskReason', item: { kind: 'question', index: 1 } },
};

describe('formsCommandHandlers', () => {
  it('picks a choice on the focused question, and the same number clears it', () => {
    const { run, round, logs } = setup();

    run('choose2');
    expect(round().answers[0].choice).toBe(2);
    run('choose2');

    expect(round().answers[0].choice).toBe(0);
    expect(logs).toEqual([
      'chose 2 on question 1',
      'cleared the choice on question 1',
    ]);
  });

  it('picks a choice on the focused finding and logs it', () => {
    const { run, round, logs } = setup([finding('Leak')]);

    run('choose2');

    expect(round().findingAnswers[0].choice).toBe(2);
    expect(logs).toEqual(['chose 2 on finding 1']);
  });

  it('actFixNow clears the fix_now a finding starts on, and again picks it', () => {
    const { run, round, logs } = setup([finding('Leak')]);

    run('actFixNow');
    expect(round().findingAnswers[0].action).toBe('');
    run('actFixNow');

    expect(round().findingAnswers[0].action).toBe('fix_now');
    expect(logs).toEqual([
      'cleared the action on finding 1',
      'chose Fix now on finding 1',
    ]);
  });

  it.each([
    ['actFollowUp', 'follow_up', 'Follow-up'],
    ['actLeaveIt', 'leave_it', 'Leave it'],
  ] as const)(
    '%s picks its action on the focused finding, and again clears it',
    (command, action, label) => {
      const { run, round, logs } = setup([finding('Leak')]);

      run(command);
      expect(round().findingAnswers[0].action).toBe(action);
      run(command);

      expect(round().findingAnswers[0].action).toBe('');
      expect(logs).toEqual([
        `chose ${label} on finding 1`,
        'cleared the action on finding 1',
      ]);
    },
  );

  it('logs the card word of the action it chose on a Decision', () => {
    const { run, round, logs } = setup([decision('Shape')]);

    run('actFixNow');
    run('actFixNow');

    expect(round().findingAnswers[0].action).toBe('fix_now');
    expect(logs).toEqual([
      'cleared the action on finding 1',
      'chose Decide now on finding 1',
    ]);
  });

  it('logs that a Nit offers no follow-up and keeps its answer', () => {
    const { run, store, logs } = setup([nit('Typo')]);
    const before = store.get();

    run('actFollowUp');

    expect(store.get()).toBe(before);
    expect(logs).toEqual(['finding 1 offers no follow-up']);
  });

  it('logs nothing for a Nit lacking the action outside the forms view', () => {
    const { run, store, logs } = setup([nit('Typo')]);
    run('openReview');
    logs.length = 0;
    const before = store.get();

    run('actFollowUp');

    expect(store.get()).toBe(before);
    expect(logs).toEqual([]);
  });

  it('accepts the recommendation on the focused question and logs it', () => {
    const { run, round, logs } = setup(
      [],
      [question('Alpha', { recommend: 1 })],
    );

    run('acceptRecommendation');

    expect(round().answers[0].choice).toBe(1);
    expect(logs).toEqual(['accepted the recommendation on question 1']);
  });

  it('logs nothing when the recommendation is already held', () => {
    const { run, logs } = setup([], [question('Alpha', { recommend: 1 })]);
    run('choose1');
    logs.length = 0;

    run('acceptRecommendation');

    expect(logs).toEqual([]);
  });

  it('logs nothing when an action command runs on a question', () => {
    const { run, logs } = setup();

    run('actFixNow');

    expect(logs).toEqual([]);
  });

  it("acts on the box's question when fired in a box", () => {
    const { run, round, logs } = setup();

    run('choose1', { editor: editorOf(notes2) });

    expect(round().focus).toBe(2);
    expect(round().answers[1].choice).toBe(1);
    expect(logs).toEqual(['chose 1 on question 2']);
  });

  it('logs nothing when a pick changes nothing', () => {
    const { run, logs } = setup();
    run('prevItem');
    run('choose1');
    expect(logs).toEqual([]);
  });

  it('toggles not applicable and logs it', () => {
    const { run, round, logs } = setup();

    run('toggleNotApplicable');

    expect(round().answers[0].notApplicable).toBe(true);
    expect(logs).toEqual(['not applicable on question 1']);
  });

  it("focuses the reason box when Don't ask turns on", () => {
    const { run, focused } = setup();

    run('toggleDontAsk');

    expect(focused).toEqual([reason1]);
  });

  it("focuses nothing when Don't ask turns off", () => {
    const { run, focused } = setup();
    run('toggleDontAsk');

    run('toggleDontAsk');

    expect(focused).toHaveLength(1);
  });

  it("focuses a notice's comment box for the notes key", () => {
    const { run, focused } = setup();
    run('prevItem');

    run('editNotes');

    expect(focused).toEqual([
      { roundId: 'r1', target: { field: 'comment', notice: 1 } },
    ]);
  });

  it('starts the notes and note boxes typing at the end, as vim A', () => {
    const { run, focusOptions } = setup();

    run('editNotes');
    run('openReview');
    run('editNote');

    expect(focusOptions).toEqual([
      { insertAtEnd: true },
      { insertAtEnd: true },
    ]);
  });

  it('focuses no note box in the form', () => {
    const { run, focused } = setup();
    run('editNote');
    expect(focused).toEqual([]);
  });

  it('steps to the next box from the box it fired in', () => {
    const { run, focused } = setup();
    run('toggleDontAsk');
    focused.length = 0;

    run('nextBox', { editor: editorOf(notes1) });

    expect(focused).toEqual([reason1]);
  });

  it("focuses the next item's notes box when moving items from a box", () => {
    const { run, round, focused } = setup();

    run('nextItem', {
      editor: editorOf({
        roundId: 'r1',
        target: { field: 'comment', notice: 1 },
      }),
    });

    expect(round().focus).toBe(1);
    expect(focused).toEqual([notes1]);
  });

  it('moves items without focusing a box from the page', () => {
    const { run, focused } = setup();
    run('nextItem');
    expect(focused).toEqual([]);
  });

  it('acts on the active box when a chord fires with no editor', () => {
    const { run, focused, setActive } = setup();
    setActive(notes1);

    run('nextItem', {});

    expect(focused.at(-1)).toEqual(notes2);
  });

  it("moves from the active box into the next unanswered item's notes box", () => {
    const { run, round, logs, focused, setActive } = setup();
    setActive(notes1);

    run('nextUnanswered', {});

    expect(focused.at(-1)).toEqual(notes2);
    expect(focusedItem(round())).toEqual({ kind: 'question', index: 2 });
    expect(logs).toEqual(['jumped to question 2']);
  });

  it('stays on the focused item when it is the only unanswered one', () => {
    const { run, store, round, logs } = setup();
    store.dispatch({ type: 'focusItem', item: 1 });
    run('choose1');
    store.dispatch({ type: 'focusItem', item: 2 });
    logs.length = 0;

    run('nextUnanswered');

    expect(focusedItem(round())).toEqual({ kind: 'question', index: 2 });
    expect(logs).toEqual(['no other unanswered item']);

    run('choose1');
    logs.length = 0;
    run('nextUnanswered');

    expect(focusedItem(round())).toEqual({ kind: 'question', index: 2 });
    expect(logs).toEqual(['no unanswered item']);
  });

  it('jumps to the next unanswered item, wrapping', () => {
    const { run, store, round, logs } = setup([finding('Leak')]);
    store.dispatch({ type: 'focusItem', item: 3 });

    run('nextUnanswered');

    expect(focusedItem(round())).toEqual({ kind: 'finding', index: 1 });
    expect(logs).toEqual(['jumped to finding 1']);
  });

  it('jumps to the previous unanswered question', () => {
    const { run, store, round } = setup();
    store.dispatch({ type: 'focusItem', item: 2 });

    run('prevUnanswered');

    expect(focusedItem(round())).toEqual({ kind: 'question', index: 1 });
  });

  it('leaves the box and logs it', () => {
    const { run, logs, leaves } = setup();

    run('leaveBox');

    expect(leaves()).toBe(1);
    expect(logs).toEqual(['left the box']);
  });

  it('logs the review opening', () => {
    const { run, store, logs } = setup();

    run('openReview');

    expect(store.get().view).toBe('review');
    expect(logs).toEqual(['review opened']);
  });

  it('submits only from the review', () => {
    const { run, finished } = setup();
    run('submit');
    expect(finished).toEqual([]);
  });

  it('hands main the body on submit and keeps the round until main closes it', () => {
    const { run, round, store, finished, toasts, logs } = setup();
    run('choose3');
    run('openReview');
    const body = buildBody(round());

    run('submit');

    expect(finished).toEqual([
      { roundId: 'r1', end: { kind: 'submitted', body } },
    ]);
    expect(round().sending).toEqual({
      kind: 'submitted',
      closesSession: false,
    });
    expect(store.get().view).toBe('review');
    expect(toasts).toEqual([]);
    expect(logs.at(-1)).toBe('review opened');
  });

  it('closes a submitted round when main closes it, then logs and toasts the send', () => {
    const { run, store, toasts, toastTones, logs, closeFromMain } = setup();
    run('openReview');
    run('submit');

    closeFromMain('r1');

    expect(store.get().rounds).toEqual([]);
    expect(store.get().view).toBe('idle');
    expect(logs.at(-1)).toBe('submitted');
    expect(toasts).toEqual(['Answers sent: project · r1']);
    expect(toastTones).toEqual(['success']);
  });

  it('keeps a round whose finish rejects, with its answers, and toasts the error', async () => {
    const {
      run,
      round,
      store,
      finished,
      toasts,
      toastTones,
      logs,
      failFinish,
    } = setup();
    run('choose3');
    run('openReview');
    failFinish(new Error('round r1 has no question 3'));

    run('submit');

    await vi.waitFor(() =>
      expect(toasts).toEqual(['Round not sent: round r1 has no question 3']),
    );
    expect(toastTones).toEqual(['error']);
    expect(logs).toContain('round r1 not finished: round r1 has no question 3');
    expect(round().sending).toBeNull();
    expect(round().answers[0].choice).toBe(3);
    expect(store.get().view).toBe('review');
    run('submit');
    expect(finished).toHaveLength(2);
  });

  it('sends nothing more while a round is sending', () => {
    const { run, store, finished } = setup();
    run('openReview');

    run('submit');
    run('submit');
    run('closeReview');

    expect(finished).toHaveLength(1);
    expect(store.get().view).toBe('review');
  });

  it('asks before cancelling, then hands main a cancelled round', () => {
    const { run, store, finished, toasts, toastTones, logs, closeFromMain } =
      setup();
    run('openReview');

    run('askCancel');
    expect(store.get().view).toBe('confirm');
    expect(finished).toEqual([]);
    run('confirmCancel');

    expect(finished.map((entry) => entry.end.kind)).toEqual(['cancelled']);
    expect(store.get().view).toBe('confirm');
    closeFromMain('r1');
    expect(store.get().rounds).toEqual([]);
    expect(logs.at(-1)).toBe('cancelled');
    expect(toasts).toEqual(['Round cancelled: project · r1']);
    expect(toastTones).toEqual(['info']);
  });

  it('keeps the round when the confirmation is dismissed', () => {
    const { run, store, finished, closedSessions, closeFromMain } = setup();
    run('openReview');
    run('askCancel');

    run('dismissConfirm');

    expect(store.get().view).toBe('review');
    expect(finished).toEqual([]);
    expect(closedSessions).toEqual([]);
    run('askCancel');
    run('confirmCancel');
    closeFromMain('r1');
    expect(closedSessions).toEqual([]);
  });

  it('the close guard lets a session with no round close', () => {
    const { store, logs, shownForms, toasts, activated, guardClose } = setup();
    const before = store.get();

    expect(guardClose('other')).toBe(true);

    expect(store.get()).toBe(before);
    expect(logs).toEqual([]);
    expect(shownForms).toEqual([]);
    expect(toasts).toEqual([]);
    expect(activated).toEqual([]);
  });

  it("the close guard selects the session's Form tab before the prompt shows", () => {
    const { store, shownForms, guardClose } = setup();

    guardClose('r1-session');

    expect(shownForms).toEqual([{ sessionId: 'r1-session', view: 'forms' }]);
    expect(store.get().view).toBe('confirm');
  });

  it('the close guard opens the prompt and keeps a session with an open round', () => {
    const { store, logs, toasts, activated, guardClose } = setup();

    expect(guardClose('r1-session')).toBe(false);
    expect(store.get().view).toBe('confirm');
    expect(logs).toEqual(['closing the session asks to cancel project · r1']);
    expect(guardClose('r1-session')).toBe(false);

    expect(logs).toHaveLength(1);
    expect(toasts).toEqual([]);
    expect(activated).toEqual([]);
  });

  it("the close guard keeps a background round's session, says why and selects it", () => {
    const {
      store,
      logs,
      shownForms,
      toasts,
      toastTones,
      activated,
      guardClose,
    } = setup();
    store.dispatch({ type: 'roundShown', round: presentedRound('r2') });
    const before = store.get();

    expect(guardClose('r2-session')).toBe(false);

    expect(store.get()).toBe(before);
    expect(shownForms).toEqual([]);
    expect(logs).toEqual([
      'session close kept: project · r2 is open in the background',
    ]);
    expect(toasts).toEqual(["Finish or cancel project · r2's round first"]);
    expect(toastTones).toEqual(['info']);
    expect(activated).toEqual(['r2-session']);
  });

  it('confirming a close prompt cancels the round, then closes its session', () => {
    const { run, finished, closedSessions, guardClose, closeFromMain } =
      setup();
    guardClose('r1-session');

    run('confirmCancel');

    expect(finished.map((entry) => [entry.roundId, entry.end.kind])).toEqual([
      ['r1', 'cancelled'],
    ]);
    expect(closedSessions).toEqual([]);
    closeFromMain('r1');
    expect(closedSessions).toEqual([
      { sessionId: 'r1-session', roundCount: 0 },
    ]);
  });

  it('a close prompt whose cancel fails keeps the session and the prompt', async () => {
    const {
      run,
      round,
      store,
      toasts,
      closedSessions,
      guardClose,
      failFinish,
    } = setup();
    guardClose('r1-session');
    failFinish(new Error('disk full'));

    run('confirmCancel');

    await vi.waitFor(() =>
      expect(toasts).toEqual(['Round not sent: disk full']),
    );
    expect(closedSessions).toEqual([]);
    expect(store.get().view).toBe('confirm');
    expect(round().sending).toBeNull();
  });

  it('closing a round main closed on its own shows no toast and closes no session', () => {
    const { store, toasts, logs, closedSessions, closeFromMain } = setup();

    closeFromMain('r1', false);

    expect(store.get().rounds).toEqual([]);
    expect(toasts).toEqual([]);
    expect(logs).toEqual([]);
    expect(closedSessions).toEqual([]);
  });

  it('main closing a round on its own while its cancel sends shows no toast and closes no session', () => {
    const {
      run,
      store,
      toasts,
      logs,
      closedSessions,
      guardClose,
      closeFromMain,
    } = setup();
    guardClose('r1-session');
    run('confirmCancel');
    logs.length = 0;

    closeFromMain('r1', false);

    expect(store.get().rounds).toEqual([]);
    expect(toasts).toEqual([]);
    expect(logs).toEqual([]);
    expect(closedSessions).toEqual([]);
  });

  it('the close guard keeps the session of the active round while it sends, and says so', () => {
    const { run, store, logs, shownForms, toasts, toastTones, guardClose } =
      setup();
    run('openReview');
    run('submit');
    logs.length = 0;
    const before = store.get();

    expect(guardClose('r1-session')).toBe(false);

    expect(store.get()).toBe(before);
    expect(shownForms).toEqual([]);
    expect(logs).toEqual(['session close kept: project · r1 is sending']);
    expect(toasts).toEqual(["Sending project · r1's round…"]);
    expect(toastTones).toEqual(['info']);
  });

  it('the close guard keeps the session of a background round while it sends, and says so', () => {
    const { store, logs, toasts, activated, guardClose } = setup();
    store.dispatch({ type: 'roundShown', round: presentedRound('r2') });
    store.dispatch({ type: 'sendStarted', roundId: 'r2', kind: 'submitted' });
    const before = store.get();

    expect(guardClose('r2-session')).toBe(false);

    expect(store.get()).toBe(before);
    expect(logs).toEqual(['session close kept: project · r2 is sending']);
    expect(toasts).toEqual(["Sending project · r2's round…"]);
    expect(activated).toEqual([]);
  });

  it('nextLayout_InvokesCycleLayoutForward', () => {
    const { run, layoutCalls } = setup();

    run('nextLayout');

    expect(layoutCalls).toEqual([['cycleLayout', 1]]);
  });

  it('prevLayout_InvokesCycleLayoutBackward', () => {
    const { run, layoutCalls } = setup();

    run('prevLayout');

    expect(layoutCalls).toEqual([['cycleLayout', -1]]);
  });

  it('openPreview_Rejects_ToastsError', async () => {
    const { run, failLayouts, toasts, toastTones, logs } = setup();
    failLayouts(new Error('no preview round'));

    run('openPreview');

    await vi.waitFor(() =>
      expect(toasts).toEqual(['Layout command failed: no preview round']),
    );
    expect(toastTones).toEqual(['error']);
    expect(logs).toContain('layout command failed: no preview round');
  });
});
