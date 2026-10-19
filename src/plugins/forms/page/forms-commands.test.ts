import { describe, expect, it } from 'vitest';
import type { FocusOptions, TextEditor } from '../../../contracts/editor';
import type { PageCommandContext } from '../../../contracts/plugin';
import type { Finding, RoundEnd } from '../contract';
import type { BoxRef } from './boxes';
import {
  activeRound,
  buildBody,
  focusedItem,
  initialState,
} from './form-state';
import { formsCommandHandlers, guardClose } from './forms-commands';
import { createFormsStore } from './forms-store';
import { finding, notice, presentedRound, question } from './test-rounds';

type FormsCommand = keyof ReturnType<typeof formsCommandHandlers>;

// The editor of each box a test fires a command in.
const boxEditors = new Map<TextEditor, BoxRef>();

function editorOf(box: BoxRef): TextEditor {
  const editor: TextEditor = {
    text: () => '',
    focus: () => undefined,
    blur: () => undefined,
    destroy: () => undefined,
  };
  boxEditors.set(editor, box);
  return editor;
}

// Rail: notice 1 (position 0), then `findings`, then questions Alpha and Beta
// (1 and 2 with no findings).
function setup(findings: Finding[] = []) {
  const store = createFormsStore(
    initialState(
      [
        presentedRound('r1', {
          notices: [notice('Heads up')],
          findings,
          questions: [question('Alpha'), question('Beta')],
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
  const logs: string[] = [];
  // Each closed tab's session, with the rounds the store held at the call.
  const closedTabs: { sessionId: string; roundCount: number }[] = [];
  const log = (_source: string, message: string) => logs.push(message);
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
    finish: (roundId, end) => finished.push({ roundId, end }),
    closeTab: (sessionId) =>
      closedTabs.push({ sessionId, roundCount: store.get().rounds.length }),
    toast: (text) => toasts.push(text),
    log,
  });
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
    logs,
    closedTabs,
    guardClose: (sessionId: string) => guardClose({ store, log }, sessionId),
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
    run('nextItem');

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
    run('nextItem');

    run('choose2');

    expect(round().findingAnswers[0].choice).toBe(2);
    expect(logs).toEqual(['chose 2 on finding 1']);
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
    run('choose1');
    expect(logs).toEqual([]);
  });

  it('toggles not applicable and logs it', () => {
    const { run, round, logs } = setup();
    run('nextItem');

    run('toggleNotApplicable');

    expect(round().answers[0].notApplicable).toBe(true);
    expect(logs).toEqual(['not applicable on question 1']);
  });

  it("focuses the reason box when Don't ask turns on", () => {
    const { run, focused } = setup();
    run('nextItem');

    run('toggleDontAsk');

    expect(focused).toEqual([reason1]);
  });

  it("focuses nothing when Don't ask turns off", () => {
    const { run, focused } = setup();
    run('nextItem');
    run('toggleDontAsk');

    run('toggleDontAsk');

    expect(focused).toHaveLength(1);
  });

  it("focuses a notice's comment box for the notes key", () => {
    const { run, focused } = setup();

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
    run('nextItem');
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
    run('nextItem');
    setActive(notes1);

    run('nextItem', {});

    expect(focused.at(-1)).toEqual(notes2);
  });

  it('jumps to question N and logs it', () => {
    const { run, round, logs, focused } = setup([finding('Leak')]);

    run('jumpTo2');

    expect(round().focus).toBe(3);
    expect(focusedItem(round())).toEqual({ kind: 'question', index: 2 });
    expect(logs).toEqual(['jumped to question 2']);
    expect(focused).toEqual([]);
  });

  it('does nothing for a question the round lacks', () => {
    const { run, store, logs } = setup();
    const before = store.get();

    run('jumpTo3');

    expect(store.get()).toBe(before);
    expect(logs).toEqual([]);
  });

  it("jumps from a box into question N's notes box", () => {
    const { run, focused } = setup();

    run('jumpTo2', { editor: editorOf(notes1) });

    expect(focused.at(-1)).toEqual(notes2);
  });

  it('stays on the focused item when it is the only unanswered one', () => {
    const { run, round, logs } = setup();
    run('jumpTo1');
    run('choose1');
    run('jumpTo2');
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
    const { run, round, logs } = setup([finding('Leak')]);
    run('jumpTo2');
    logs.length = 0;

    run('nextUnanswered');

    expect(focusedItem(round())).toEqual({ kind: 'finding', index: 1 });
    expect(logs).toEqual(['jumped to finding 1']);
  });

  it('logs a jump to the focused question as no move', () => {
    const { run, round, logs } = setup();
    run('jumpTo2');
    logs.length = 0;

    run('jumpTo2');

    expect(focusedItem(round())).toEqual({ kind: 'question', index: 2 });
    expect(logs).toEqual(['already on question 2']);
  });

  it('jumps to the previous unanswered question', () => {
    const { run, round } = setup();
    run('jumpTo2');

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

  it('hands main the body on submit, then closes the round', () => {
    const { run, round, store, finished, toasts, logs } = setup();
    run('nextItem');
    run('choose3');
    run('openReview');
    const body = buildBody(round());

    run('submit');

    expect(finished).toEqual([
      { roundId: 'r1', end: { kind: 'submitted', body } },
    ]);
    expect(store.get().rounds).toEqual([]);
    expect(store.get().view).toBe('idle');
    expect(logs.at(-1)).toBe('submitted');
    expect(toasts).toHaveLength(1);
  });

  it('asks before cancelling, then hands main a cancelled round', () => {
    const { run, store, finished, logs } = setup();
    run('openReview');

    run('askCancel');
    expect(store.get().view).toBe('confirm');
    expect(finished).toEqual([]);
    run('confirmCancel');

    expect(finished.map((entry) => entry.end.kind)).toEqual(['cancelled']);
    expect(store.get().rounds).toEqual([]);
    expect(logs.at(-1)).toBe('cancelled');
  });

  it('keeps the round when the confirmation is dismissed', () => {
    const { run, store, finished, closedTabs } = setup();
    run('openReview');
    run('askCancel');

    run('dismissConfirm');

    expect(store.get().view).toBe('review');
    expect(finished).toEqual([]);
    expect(closedTabs).toEqual([]);
    run('askCancel');
    run('confirmCancel');
    expect(closedTabs).toEqual([]);
  });

  it('the close guard lets a tab with no round close', () => {
    const { store, logs, guardClose } = setup();
    const before = store.get();

    expect(guardClose('other')).toBe(true);

    expect(store.get()).toBe(before);
    expect(logs).toEqual([]);
  });

  it('the close guard opens the prompt and keeps a tab with an open round', () => {
    const { store, logs, guardClose } = setup();

    expect(guardClose('r1-session')).toBe(false);
    expect(store.get().view).toBe('confirm');
    expect(logs).toEqual(['closing the tab asks to cancel project · r1']);
    expect(guardClose('r1-session')).toBe(false);

    expect(logs).toHaveLength(1);
  });

  it("the close guard keeps a background round's tab and logs the refusal", () => {
    const { store, logs, guardClose } = setup();
    store.dispatch({ type: 'roundShown', round: presentedRound('r2') });
    const before = store.get();

    expect(guardClose('r2-session')).toBe(false);

    expect(store.get()).toBe(before);
    expect(logs).toEqual([
      'tab close kept: project · r2 is open in the background',
    ]);
  });

  it('confirming a close prompt cancels the round, then closes its tab', () => {
    const { run, finished, closedTabs, guardClose } = setup();
    guardClose('r1-session');

    run('confirmCancel');

    expect(finished.map((entry) => [entry.roundId, entry.end.kind])).toEqual([
      ['r1', 'cancelled'],
    ]);
    expect(closedTabs).toEqual([{ sessionId: 'r1-session', roundCount: 0 }]);
  });

  it('toggles help over the current view', () => {
    const { run, store } = setup();

    run('toggleHelp');
    expect(store.get().view).toBe('help');
    run('closeHelp');

    expect(store.get().view).toBe('forms');
  });
});
