import { describe, expect, it } from 'vitest';
import type { CommandId } from '../../contracts/commands';
import type { FocusOptions } from '../../contracts/editor';
import type { RoundEnd } from '../../contracts/forms';
import { CommandRegistry } from '../../shared/command-registry';
import type {
  RendererCommandContext,
  RendererCommands,
} from '../renderer-commands';
import type { BoxRef } from './boxes';
import { activeRound, buildBody, initialState } from './form-state';
import { registerFormsCommands } from './forms-commands';
import { createFormsStore } from './forms-store';
import { notice, presentedRound, question } from './test-rounds';

// The skeleton's renderer command ids, written out independently of the code.
const SKELETON_COMMANDS: CommandId[] = [
  'forms.nextItem',
  'forms.prevItem',
  'forms.choose1',
  'forms.choose2',
  'forms.choose3',
  'forms.choose4',
  'forms.choose5',
  'forms.choose6',
  'forms.choose7',
  'forms.choose8',
  'forms.choose9',
  'forms.clearChoice',
  'forms.toggleNotApplicable',
  'forms.toggleDontAsk',
  'forms.editWhat',
  'forms.editWhy',
  'forms.editNote',
  'forms.nextBox',
  'forms.prevBox',
  'forms.leaveBox',
  'forms.nextRound',
  'forms.prevRound',
  'forms.openReview',
  'forms.closeReview',
  'forms.reviewNext',
  'forms.reviewPrev',
  'forms.reviewJump',
  'forms.submit',
  'forms.askCancel',
  'forms.confirmCancel',
  'forms.dismissConfirm',
  'forms.toggleFold',
  'forms.unfoldAll',
  'forms.foldAll',
  'help.toggle',
  'help.close',
];

// Rail: notice 1 (position 0), question Alpha (1), question Beta (2).
function setup() {
  const store = createFormsStore(
    initialState([
      presentedRound('r1', {
        notices: [notice('Heads up')],
        questions: [question('Alpha'), question('Beta')],
      }),
    ]),
  );
  const focused: BoxRef[] = [];
  const focusOptions: (FocusOptions | undefined)[] = [];
  let active: BoxRef | null = null;
  let leaves = 0;
  const finished: { roundId: string; end: RoundEnd }[] = [];
  const toasts: string[] = [];
  const logs: string[] = [];
  const commands: RendererCommands =
    new CommandRegistry<RendererCommandContext>();
  registerFormsCommands(commands, {
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
    },
    finish: (roundId, end) => finished.push({ roundId, end }),
    toast: (text) => toasts.push(text),
    log: (_source, message) => logs.push(message),
  });
  const run = (command: CommandId, context: RendererCommandContext = {}) =>
    commands.run(command, context);
  const round = () => {
    const current = activeRound(store.get());
    if (current === null) {
      throw new Error('No round is active');
    }
    return current;
  };
  return {
    store,
    commands,
    run,
    round,
    focused,
    focusOptions,
    finished,
    toasts,
    logs,
    leaves: () => leaves,
  };
}

const why2: BoxRef = { roundId: 'r1', target: { field: 'why', question: 2 } };
const what1: BoxRef = { roundId: 'r1', target: { field: 'what', question: 1 } };

describe('registerFormsCommands', () => {
  it('registers every forms and help command the keymap may name', () => {
    const { commands } = setup();
    expect(() => commands.requireRegistered(SKELETON_COMMANDS)).not.toThrow();
  });

  it('picks a choice on the focused question, and the same number clears it', () => {
    const { run, round, logs } = setup();
    run('forms.nextItem');

    run('forms.choose2');
    expect(round().answers[0].choice).toBe(2);
    run('forms.choose2');

    expect(round().answers[0].choice).toBe(0);
    expect(logs).toEqual([
      'chose 2 on question 1',
      'cleared the choice on question 1',
    ]);
  });

  it("acts on the box's question when fired in a box", () => {
    const { run, round, logs } = setup();

    run('forms.choose1', { box: why2 });

    expect(round().focus).toBe(2);
    expect(round().answers[1].choice).toBe(1);
    expect(logs).toEqual(['chose 1 on question 2']);
  });

  it('logs nothing when a pick changes nothing', () => {
    const { run, logs } = setup();
    run('forms.choose1');
    expect(logs).toEqual([]);
  });

  it('toggles not applicable and logs it', () => {
    const { run, round, logs } = setup();
    run('forms.nextItem');

    run('forms.toggleNotApplicable');

    expect(round().answers[0].notApplicable).toBe(true);
    expect(logs).toEqual(['not applicable on question 1']);
  });

  it("focuses the reason box when Don't ask turns on", () => {
    const { run, focused } = setup();
    run('forms.nextItem');

    run('forms.toggleDontAsk');

    expect(focused).toEqual([
      { roundId: 'r1', target: { field: 'dontAskReason', question: 1 } },
    ]);
  });

  it("focuses nothing when Don't ask turns off", () => {
    const { run, focused } = setup();
    run('forms.nextItem');
    run('forms.toggleDontAsk');

    run('forms.toggleDontAsk');

    expect(focused).toHaveLength(1);
  });

  it("focuses a notice's comment box for the answer key", () => {
    const { run, focused } = setup();

    run('forms.editWhat');

    expect(focused).toEqual([
      { roundId: 'r1', target: { field: 'comment', notice: 1 } },
    ]);
  });

  it('starts the answer and note boxes typing at the end, as vim A', () => {
    const { run, focusOptions } = setup();

    run('forms.editWhat');
    run('forms.editNote');

    expect(focusOptions).toEqual([
      { insertAtEnd: true },
      { insertAtEnd: true },
    ]);
  });

  it('focuses the why box in the mode it was left in', () => {
    const { run, focused, focusOptions } = setup();
    run('forms.nextItem');

    run('forms.editWhy');

    expect(focused).toEqual([
      { roundId: 'r1', target: { field: 'why', question: 1 } },
    ]);
    expect(focusOptions).toEqual([undefined]);
  });

  it('focuses no why box on a notice', () => {
    const { run, focused } = setup();
    run('forms.editWhy');
    expect(focused).toEqual([]);
  });

  it('steps to the next box from the box it fired in', () => {
    const { run, focused } = setup();
    run('forms.nextItem');

    run('forms.nextBox', { box: what1 });

    expect(focused).toEqual([
      { roundId: 'r1', target: { field: 'why', question: 1 } },
    ]);
  });

  it("focuses the next item's answer box when moving items from a box", () => {
    const { run, round, focused } = setup();

    run('forms.nextItem', {
      box: { roundId: 'r1', target: { field: 'comment', notice: 1 } },
    });

    expect(round().focus).toBe(1);
    expect(focused).toEqual([what1]);
  });

  it('moves items without focusing a box from the page', () => {
    const { run, focused } = setup();
    run('forms.nextItem');
    expect(focused).toEqual([]);
  });

  it('leaves the box and logs it', () => {
    const { run, logs, leaves } = setup();

    run('forms.leaveBox');

    expect(leaves()).toBe(1);
    expect(logs).toEqual(['left the box']);
  });

  it('logs the review opening', () => {
    const { run, store, logs } = setup();

    run('forms.openReview');

    expect(store.get().view).toBe('review');
    expect(logs).toEqual(['review opened']);
  });

  it('submits only from the review', () => {
    const { run, finished } = setup();
    run('forms.submit');
    expect(finished).toEqual([]);
  });

  it('hands main the body on submit, then closes the round', () => {
    const { run, round, store, finished, toasts, logs } = setup();
    run('forms.nextItem');
    run('forms.choose3');
    run('forms.openReview');
    const body = buildBody(round());

    run('forms.submit');

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
    run('forms.openReview');

    run('forms.askCancel');
    expect(store.get().view).toBe('confirm');
    expect(finished).toEqual([]);
    run('forms.confirmCancel');

    expect(finished.map((entry) => entry.end.kind)).toEqual(['cancelled']);
    expect(store.get().rounds).toEqual([]);
    expect(logs.at(-1)).toBe('cancelled');
  });

  it('keeps the round when the confirmation is dismissed', () => {
    const { run, store, finished } = setup();
    run('forms.openReview');
    run('forms.askCancel');

    run('forms.dismissConfirm');

    expect(store.get().view).toBe('review');
    expect(finished).toEqual([]);
  });

  it('toggles help over the current view', () => {
    const { run, store } = setup();

    run('help.toggle');
    expect(store.get().view).toBe('help');
    run('help.close');

    expect(store.get().view).toBe('forms');
  });
});
