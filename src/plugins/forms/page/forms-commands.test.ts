import { describe, expect, it, vi } from 'vitest';
import { activeForm } from '../../../shared/page/session-forms';
import type {
  ContentScroll,
  FocusOptions,
  ScrollStep,
  TextEditor,
} from '../../../contracts/editor';
import type {
  CommandHandler,
  PageCommandContext,
  ToastTone,
} from '../../../contracts/plugin';
import { createReducerStore } from '../../../shared/page/reducer-store';
import type { Finding, FormsView, Question, RoundEnd } from '../contract';
import type { BoxRef } from './boxes';
import {
  apply,
  buildBody,
  focusedItem,
  type FormsAction,
  initialState,
  type ItemAnswer,
} from './form-state';
import {
  closeRoundFromMain,
  formsCommandHandlers,
  mayCloseRound,
} from './forms-commands';
import { type FormsPageEvent, startFormsEvents } from './forms-events';
import { finding, notice, presentedRound, question } from './test-rounds';

type FormsCommand = keyof ReturnType<typeof formsCommandHandlers>;

// A command a row of a table runs, with its argument when it takes one.
type TableRun = FormsCommand | { command: FormsCommand; arg: number };

// The editor of each box a test fires a command in.
const boxEditors = new Map<TextEditor, BoxRef>();

function editorOf(box: BoxRef): TextEditor {
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

// Rail: notice 1 (position 0), then `findings`, then `questions`, by default
// Alpha and Beta (1 and 2 with no findings).
function setup(
  findings: Finding[] = [],
  questions: Question[] = [question('Alpha'), question('Beta')],
) {
  const store = createReducerStore(
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
    apply,
  );
  const focused: BoxRef[] = [];
  const focusOptions: (FocusOptions | undefined)[] = [];
  let active: BoxRef | null = null;
  let leaves = 0;
  const finished: { roundId: string; end: RoundEnd }[] = [];
  const toasts: string[] = [];
  const toastTones: ToastTone[] = [];
  const logs: string[] = [];
  let layoutFailure: Error | null = null;
  let finishFailure: Error | null = null;
  // Each step and direction the form was scrolled, and what every scroll
  // returns.
  const scrolls: [ScrollStep, 1 | -1][] = [];
  let scrollResult: ContentScroll | null = { moved: true, atEnd: false };
  const log = (message: string) => logs.push(message);
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
    layouts: {
      openPreview: () =>
        layoutFailure === null
          ? Promise.resolve()
          : Promise.reject(layoutFailure),
    },
    scrollForm: (step, direction) => {
      scrolls.push([step, direction]);
      return scrollResult;
    },
    toast,
    log,
  });
  const run = (
    command: FormsCommand,
    context: Partial<PageCommandContext<any>> = {},
  ) => (handlers[command] as CommandHandler)({ arg: undefined, ...context });
  const round = () => {
    const current = activeForm(store.get());
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
    // Makes every later openPreview reject with `error`.
    failLayouts: (error: Error) => {
      layoutFailure = error;
    },
    scrolls,
    // Makes every later form scroll return `result`.
    setScroll: (result: ContentScroll | null) => {
      scrollResult = result;
    },
    // Makes every later finish reject with `error`.
    failFinish: (error: Error) => {
      finishFailure = error;
    },
    // Main's formClosed for `roundId` reaching the page; `byFinish` false is
    // main closing it on its own.
    closeFromMain: (roundId: string, byFinish = true) =>
      closeRoundFromMain({ store, toast, log }, { formId: roundId, byFinish }),
    mayClose: (sessionId: string) =>
      mayCloseRound({ store, toast, log }, sessionId),
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
const reason2: BoxRef = {
  roundId: 'r1',
  target: { field: 'dontAskReason', item: { kind: 'question', index: 2 } },
};

describe('formsCommandHandlers', () => {
  // Entries: 1 fix_now/1, 2 fix_now/2, 3 follow_up/0, 4 leave_it/0.
  const twoFix = finding('Leak', {
    choices: [
      { text: 'A', reason: 'A reason', action: 'fix_now' },
      { text: 'B', reason: 'B reason', action: 'fix_now' },
    ],
  });

  it.each<{
    name: string;
    findings?: Finding[];
    questions?: Question[];
    before: TableRun[];
    command: TableRun;
    logs: string[];
  }>([
    {
      name: 'a choice picked on a question',
      before: [],
      command: { command: 'choose', arg: 2 },
      logs: ['chose 2 on question 1'],
    },
    {
      name: 'the same choice picked again, clearing it',
      before: [{ command: 'choose', arg: 2 }],
      command: { command: 'choose', arg: 2 },
      logs: ['cleared the choice on question 1'],
    },
    {
      name: 'an entry picked on a finding',
      findings: [twoFix],
      before: [],
      command: { command: 'choose', arg: 3 },
      logs: ['chose 3 on finding 1'],
    },
    {
      name: 'the same entry picked again, clearing it',
      findings: [twoFix],
      before: [{ command: 'choose', arg: 3 }],
      command: { command: 'choose', arg: 3 },
      logs: ['cleared the choice on finding 1'],
    },
    {
      name: 'the recommendation accepted',
      questions: [question('Alpha', { recommend: 1 })],
      before: [],
      command: 'acceptRecommendation',
      logs: ['accepted the recommendation on question 1'],
    },
    {
      name: 'the recommendation already held',
      questions: [question('Alpha', { recommend: 1 })],
      before: [{ command: 'choose', arg: 1 }],
      command: 'acceptRecommendation',
      logs: [],
    },
    {
      name: 'a pick on a notice, which changes nothing',
      before: ['prevItem'],
      command: { command: 'choose', arg: 1 },
      logs: [],
    },
    {
      name: 'not applicable toggled on',
      before: [],
      command: 'toggleNotApplicable',
      logs: ['not applicable on question 1'],
    },
  ])(
    'logs an answer command only when it changes state: $name',
    ({ findings, questions, before, command, logs: expected }) => {
      const { run, logs } = setup(findings, questions);
      const runRow = (row: TableRun) =>
        typeof row === 'string' ? run(row) : run(row.command, { arg: row.arg });
      for (const each of before) {
        runRow(each);
      }
      logs.length = 0;

      runRow(command);

      expect(logs).toEqual(expected);
    },
  );

  it("acts on the box's question when fired in a box", () => {
    const { run, round } = setup();

    run('choose', { arg: 1, editor: editorOf(notes2) });

    expect(round().focus).toBe(2);
    expect(round().answers[1].choice).toBe(1);
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

    run('nextItem');

    expect(focused.at(-1)).toEqual(notes2);
  });

  it("moves from the active box into the next unanswered item's notes box", () => {
    const { run, round, focused, setActive } = setup();
    setActive(notes1);

    run('nextUnanswered');

    expect(focused.at(-1)).toEqual(notes2);
    expect(focusedItem(round())).toEqual({ kind: 'question', index: 2 });
  });

  it('stays on the focused item when it is the only unanswered one', () => {
    const { run, store, round, logs } = setup();
    store.dispatch({ type: 'focusItem', item: 1 });
    run('choose', { arg: 1 });
    store.dispatch({ type: 'focusItem', item: 2 });
    logs.length = 0;

    run('nextUnanswered');

    expect(focusedItem(round())).toEqual({ kind: 'question', index: 2 });

    run('choose', { arg: 1 });
    logs.length = 0;
    run('nextUnanswered');

    expect(focusedItem(round())).toEqual({ kind: 'question', index: 2 });
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
    expect(logs).toHaveLength(1);
  });

  it.each<{
    command: FormsCommand;
    result: ContentScroll | null;
    scrolls: [ScrollStep, 1 | -1][];
    logs: string[];
  }>([
    {
      command: 'halfPageDown',
      result: { moved: true, atEnd: false },
      scrolls: [['halfPage', 1]],
      logs: ['scrolled the form down half a page'],
    },
    {
      command: 'lineDown',
      result: { moved: true, atEnd: false },
      scrolls: [['line', 1]],
      logs: ['scrolled the form down a line'],
    },
    {
      command: 'lineUp',
      result: { moved: true, atEnd: true },
      scrolls: [['line', -1]],
      logs: ['scrolled the form up a line to the top'],
    },
    {
      command: 'halfPageUp',
      result: { moved: true, atEnd: true },
      scrolls: [['halfPage', -1]],
      logs: ['scrolled the form up half a page to the top'],
    },
    {
      command: 'halfPageUp',
      result: { moved: false, atEnd: true },
      scrolls: [['halfPage', -1]],
      logs: ['the form did not scroll up'],
    },
    {
      command: 'halfPageUp',
      result: null,
      scrolls: [['halfPage', -1]],
      logs: ['no round to scroll'],
    },
  ])(
    '$command with scroll result $result scrolls $scrolls and logs $logs',
    ({ command, result, scrolls: expectedScrolls, logs: expectedLogs }) => {
      const { run, logs, scrolls, setScroll } = setup();
      setScroll(result);

      run(command);

      expect(scrolls).toEqual(expectedScrolls);
      expect(logs).toEqual(expectedLogs);
    },
  );

  it('keeps the box focused while scrolling', () => {
    const { run, store, focused, leaves } = setup();
    const before = store.get();

    run('halfPageDown', { editor: editorOf(notes1) });
    run('lineDown', { editor: editorOf(notes1) });

    expect(focused).toEqual([]);
    expect(leaves()).toBe(0);
    expect(store.get()).toBe(before);
  });

  it('submits only from the review', () => {
    const { run, finished } = setup();
    run('submit');
    expect(finished).toEqual([]);
  });

  it('hands main the body on submit and keeps the round until main closes it', () => {
    const { run, round, store, finished, toasts } = setup();
    run('choose', { arg: 3 });
    run('openReview');
    const body = buildBody(round());

    run('submit');

    expect(finished).toEqual([
      { roundId: 'r1', end: { kind: 'submitted', body } },
    ]);
    expect(round().sending).toEqual({ kind: 'submitted' });
    expect(store.get().view).toBe('review');
    expect(toasts).toEqual([]);
  });

  it('closes a submitted round when main closes it, then logs and toasts the send', () => {
    const { run, store, toasts, toastTones, closeFromMain } = setup();
    run('openReview');
    run('submit');

    closeFromMain('r1');

    expect(store.get().forms).toEqual([]);
    expect(store.get().view).toBe('idle');
    expect(toasts).toEqual([expect.stringContaining('project · r1')]);
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
    run('choose', { arg: 3 });
    run('openReview');
    failFinish(new Error('round r1 has no question 3'));

    run('submit');

    await vi.waitFor(() =>
      expect(toasts).toEqual([
        expect.stringContaining('round r1 has no question 3'),
      ]),
    );
    expect(toastTones).toEqual(['error']);
    expect(logs).toContainEqual(
      expect.stringContaining('round r1 has no question 3'),
    );
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
    const { run, store, finished, toasts, toastTones, closeFromMain } = setup();
    run('openReview');

    run('askCancel');
    expect(store.get().view).toBe('confirm');
    expect(finished).toEqual([]);
    run('confirmCancel');

    expect(finished.map((entry) => entry.end.kind)).toEqual(['cancelled']);
    expect(store.get().view).toBe('confirm');
    closeFromMain('r1');
    expect(store.get().forms).toEqual([]);
    expect(toasts).toEqual([expect.stringContaining('project · r1')]);
    expect(toastTones).toEqual(['info']);
  });

  it('review cancel leaves the session open', () => {
    const { run, store, finished, closeFromMain } = setup();
    run('openReview');
    run('askCancel');

    run('dismissConfirm');

    expect(store.get().view).toBe('review');
    expect(finished).toEqual([]);
    run('askCancel');
    run('confirmCancel');
    closeFromMain('r1');
    expect(store.get().activeSessionId).toBe('r1-session');
    expect(store.get().view).toBe('idle');
  });

  it.each([
    { name: 'no round', sessionId: 'other', background: false },
    { name: 'its active round', sessionId: 'r1-session', background: false },
    { name: 'a background round', sessionId: 'r2-session', background: true },
  ])(
    'the close check lets a session with $name close, with no prompt or toast',
    ({ sessionId, background }) => {
      const { store, logs, toasts, mayClose } = setup();
      if (background) {
        store.dispatch({ type: 'formShown', form: presentedRound('r2') });
      }
      const before = store.get();

      expect(mayClose(sessionId)).toBe(true);

      expect(store.get()).toBe(before);
      expect(logs).toEqual([]);
      expect(toasts).toEqual([]);
    },
  );

  it('closing a round main closed on its own shows no toast', () => {
    const { store, toasts, logs, closeFromMain } = setup();

    closeFromMain('r1', false);

    expect(store.get().forms).toEqual([]);
    expect(toasts).toEqual([]);
    expect(logs).toEqual([]);
  });

  it.each([
    { byFinish: false, outcome: 'closed' },
    { byFinish: true, outcome: 'submitted' },
  ])(
    'a sending round main closes with byFinish $byFinish finishes as $outcome',
    ({ byFinish, outcome }) => {
      const { run, store, closeFromMain } = setup();
      const emitted: FormsPageEvent[] = [];
      startFormsEvents(store, (event) => emitted.push(event));
      run('openReview');
      run('submit');

      closeFromMain('r1', byFinish);

      const outcomes = emitted.flatMap((event) =>
        event.name === 'roundFinished' ? [event.data.outcome] : [],
      );
      expect(outcomes).toEqual([outcome]);
    },
  );

  it.each([
    { name: 'active', roundId: 'r1', background: false },
    { name: 'background', roundId: 'r2', background: true },
  ])(
    'the close check keeps the session of a sending $name round, and says so',
    ({ roundId, background }) => {
      const { run, store, logs, toasts, toastTones, mayClose } = setup();
      if (background) {
        store.dispatch({ type: 'formShown', form: presentedRound('r2') });
        store.dispatch({
          type: 'sendStarted',
          formId: 'r2',
          kind: 'submitted',
        });
      } else {
        run('openReview');
        run('submit');
      }
      logs.length = 0;
      const before = store.get();

      expect(mayClose(`${roundId}-session`)).toBe(false);

      expect(store.get()).toBe(before);
      expect(logs).toEqual([expect.stringContaining(`project · ${roundId}`)]);
      expect(toasts).toEqual([expect.stringContaining(`project · ${roundId}`)]);
      expect(toastTones).toEqual(['info']);
    },
  );

  // Rail: notice 1 (0), question 1 (1), question 2 (2); the box focused sits
  // on question 1, and each command names question 2.
  it.each<{
    command: FormsCommand;
    arg: unknown;
    before: FormsAction[];
    answer: Partial<ItemAnswer>;
    logs: string[];
  }>([
    {
      command: 'chooseAt',
      arg: { item: 2, number: 3 },
      before: [],
      answer: { choice: 3 },
      logs: ['chose 3 on question 2'],
    },
    {
      command: 'clearChoiceAt',
      arg: 2,
      before: [
        { type: 'focusItem', item: 2 },
        { type: 'choose', number: 1 },
      ],
      answer: { choice: 0 },
      logs: ['cleared the choice on question 2'],
    },
    {
      command: 'acceptRecommendationAt',
      arg: 2,
      before: [],
      answer: { choice: 2 },
      logs: ['accepted the recommendation on question 2'],
    },
    {
      command: 'toggleNotApplicableAt',
      arg: 2,
      before: [],
      answer: { notApplicable: true },
      logs: ['not applicable on question 2'],
    },
    {
      command: 'toggleDontAskAt',
      arg: 2,
      before: [],
      answer: { dontAsk: true },
      logs: ["don't ask on question 2"],
    },
    {
      command: 'focusItem',
      arg: 2,
      before: [],
      answer: { choice: 0, notApplicable: false, dontAsk: false },
      logs: [],
    },
  ])(
    'atCommands_BoxFocusedOnOtherItem_ActOnTheNamedItem: $command',
    ({ command, arg, before, answer, logs: expected }) => {
      const { run, store, round, logs, setActive } = setup();
      for (const action of before) {
        store.dispatch(action);
      }
      store.dispatch({ type: 'focusItem', item: 1 });
      const untouched = round().answers[0];
      setActive(notes1);
      logs.length = 0;

      run(command, { arg });

      expect(round().focus).toBe(2);
      expect(round().answers[1]).toMatchObject(answer);
      expect(round().answers[0]).toBe(untouched);
      expect(logs).toEqual(expected);
    },
  );

  // The commands whose arg is a rail position alone.
  const POSITION_COMMANDS: FormsCommand[] = [
    'clearChoiceAt',
    'acceptRecommendationAt',
    'toggleNotApplicableAt',
    'toggleDontAskAt',
    'focusItem',
    'pickRailItem',
  ];

  it.each<{
    name: string;
    command: FormsCommand;
    arg: unknown;
    before: FormsCommand[];
    hasRound: boolean;
    logs: string[];
  }>([
    ...POSITION_COMMANDS.map((command) => ({
      name: `${command} past the rail`,
      command,
      arg: 7,
      before: [],
      hasRound: true,
      logs: ['no rail item at 7'],
    })),
    {
      name: 'chooseAt past the rail',
      command: 'chooseAt',
      arg: { item: 7, number: 1 },
      before: [],
      hasRound: true,
      logs: ['no rail item at 7'],
    },
    {
      name: 'reviewJumpAt past the rows',
      command: 'reviewJumpAt',
      arg: 5,
      before: ['openReview'],
      hasRound: true,
      logs: ['no review row 5'],
    },
    {
      name: 'chooseAt with no round',
      command: 'chooseAt',
      arg: { item: 1, number: 1 },
      before: [],
      hasRound: false,
      logs: [],
    },
  ])(
    'argCommands_StaleArg_LogAndChangeNothing: $name',
    ({ command, arg, before, hasRound, logs: expected }) => {
      const { run, store, logs, setActive, closeFromMain } = setup();
      store.dispatch({ type: 'focusItem', item: 1 });
      for (const each of before) {
        run(each);
      }
      if (!hasRound) {
        closeFromMain('r1', false);
      }
      setActive(notes2);
      const state = store.get();
      logs.length = 0;

      run(command, { arg });

      expect(store.get()).toBe(state);
      expect(logs).toEqual(expected);
    },
  );

  it('chooseAt_HeldNumber_ClearsAndLogsAsChooseDoes', () => {
    const byKey = setup();
    const byClick = setup();
    byKey.store.dispatch({ type: 'focusItem', item: 2 });

    for (let press = 0; press < 2; press++) {
      byKey.run('choose', { arg: 3 });
      byClick.run('chooseAt', { arg: { item: 2, number: 3 } });
    }

    expect(byClick.logs).toEqual([
      'chose 3 on question 2',
      'cleared the choice on question 2',
    ]);
    expect(byClick.logs).toEqual(byKey.logs);
    expect(byClick.round().answers).toEqual(byKey.round().answers);
  });

  it('toggleDontAskAt_TurnsOn_FocusesReasonBox', () => {
    const { run, focused, setActive } = setup();
    setActive(notes1);

    run('toggleDontAskAt', { arg: 2 });

    expect(focused).toEqual([reason2]);
  });

  // Rail: notice 1 (0), question 1 (1), question 2 (2); question 2 is review
  // row 1.
  it.each<{
    name: string;
    before: (FormsCommand | FormsAction)[];
    position: number;
    view: FormsView;
    focus: number;
    logs: string[];
  }>([
    {
      name: 'the form focuses the item',
      before: [],
      position: 2,
      view: 'forms',
      focus: 2,
      logs: ['jumped to question 2'],
    },
    {
      name: "the review jumps to the item's row",
      before: ['openReview'],
      position: 2,
      view: 'forms',
      focus: 2,
      logs: ['jumped to question 2'],
    },
    {
      name: "the review shows a notice's card",
      before: [{ type: 'focusItem', item: 2 }, 'openReview'],
      position: 0,
      view: 'forms',
      focus: 0,
      logs: ['jumped to notice 1'],
    },
    {
      name: 'the confirm does nothing',
      before: [{ type: 'focusItem', item: 1 }, 'openReview', 'askCancel'],
      position: 2,
      view: 'confirm',
      focus: 1,
      logs: [],
    },
  ])(
    'pickRailItem_EachView_FollowsRailPickAction: $name',
    ({ before, position, view, focus, logs: expected }) => {
      const { run, store, round, logs } = setup();
      for (const each of before) {
        if (typeof each === 'string') {
          run(each);
        } else {
          store.dispatch(each);
        }
      }
      logs.length = 0;

      run('pickRailItem', { arg: position });

      expect(store.get().view).toBe(view);
      expect(round().focus).toBe(focus);
      expect(logs).toEqual(expected);
    },
  );

  it('openPreview_Rejects_ToastsError', async () => {
    const { run, failLayouts, toasts, toastTones, logs } = setup();
    failLayouts(new Error('no preview round'));

    run('openPreview');

    await vi.waitFor(() =>
      expect(toasts).toEqual([expect.stringContaining('no preview round')]),
    );
    expect(toastTones).toEqual(['error']);
    expect(logs).toContainEqual(expect.stringContaining('no preview round'));
  });
});
