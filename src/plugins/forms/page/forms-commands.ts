import type { FocusOptions } from '../../../contracts/editor';
import type { Log } from '../../../contracts/log';
import type {
  PageCommandContext,
  PageStart,
  ToastTone,
} from '../../../contracts/plugin';
import type { RoundEnd } from '../contract';
import type { formsManifest } from '../manifest';
import {
  type BoxField,
  type BoxRef,
  focusActionFor,
  shownBox,
  stepBox,
} from './boxes';
import type { EditorBoxes } from './editor-boxes';
import {
  activeRound,
  buildBody,
  focusedItem,
  type FormsAction,
  type FormsState,
  type FormsView,
  type QuestionAnswer,
} from './form-state';
import type { FormsStore } from './forms-store';

export interface FormsCommandDeps {
  store: FormsStore;
  boxes: Pick<EditorBoxes, 'focus' | 'leave' | 'active' | 'boxOf'>;
  // Hands the finished round to main.
  finish(roundId: string, end: RoundEnd): void;
  toast(text: string, tone: ToastTone): void;
  log: Log;
}

type Handler = (context: PageCommandContext) => void;

type DescribeChange = (answer: QuestionAnswer, question: number) => string;

const ANSWER_FIELDS: BoxField[] = ['what', 'comment'];

const APPEND: FocusOptions = { insertAtEnd: true };

// Every forms command's handler, by short id. A command fired in a box first
// focuses that box's item, so it acts where the user is typing.
export function formsCommandHandlers(
  deps: FormsCommandDeps,
): PageStart<typeof formsManifest>['commands'] {
  const { store, boxes, log } = deps;
  // Applies its form-state action and nothing more.
  const plain =
    (action: FormsAction): Handler =>
    (context) => {
      focusBoxItem(store, boxIn(deps, context));
      store.dispatch(action);
    };
  const choose =
    (choice: number): Handler =>
    (context) =>
      changeAnswer(deps, context, { type: 'choose', choice }, (answer, n) =>
        answer.choice === choice
          ? `chose ${choice} on question ${n}`
          : `cleared the choice on question ${n}`,
      );

  return {
    toggleFold: plain({ type: 'toggleFold' }),
    unfoldAll: plain({ type: 'unfoldAll' }),
    foldAll: plain({ type: 'foldAll' }),
    nextRound: plain({ type: 'nextRound' }),
    prevRound: plain({ type: 'prevRound' }),
    closeReview: plain({ type: 'closeReview' }),
    reviewNext: plain({ type: 'reviewNext' }),
    reviewPrev: plain({ type: 'reviewPrev' }),
    reviewJump: plain({ type: 'reviewJump' }),
    askCancel: plain({ type: 'askCancel' }),
    dismissConfirm: plain({ type: 'dismissConfirm' }),
    toggleHelp: plain({ type: 'toggleHelp' }),
    closeHelp: plain({ type: 'closeHelp' }),
    // A tenth choice is picked by mouse.
    choose1: choose(1),
    choose2: choose(2),
    choose3: choose(3),
    choose4: choose(4),
    choose5: choose(5),
    choose6: choose(6),
    choose7: choose(7),
    choose8: choose(8),
    choose9: choose(9),
    clearChoice: (context) =>
      changeAnswer(
        deps,
        context,
        { type: 'clearChoice' },
        (_answer, n) => `cleared the choice on question ${n}`,
      ),
    toggleNotApplicable: (context) =>
      changeAnswer(
        deps,
        context,
        { type: 'toggleNotApplicable' },
        (answer, n) =>
          answer.notApplicable
            ? `not applicable on question ${n}`
            : `applicable again on question ${n}`,
      ),
    toggleDontAsk: (context) => {
      const answer = changeAnswer(
        deps,
        context,
        { type: 'toggleDontAsk' },
        (changed, n) =>
          changed.dontAsk
            ? `don't ask on question ${n}`
            : `ask again on question ${n}`,
      );
      if (answer?.dontAsk) {
        focusShownBox(deps, ['dontAskReason']);
      }
    },
    // As vim's `A`: `a` and `o` start typing after the box's text.
    editWhat: () => focusShownBox(deps, ANSWER_FIELDS, APPEND),
    editWhy: () => focusShownBox(deps, ['why']),
    editNote: () => focusShownBox(deps, ['note'], APPEND),
    nextBox: (context) => stepFocus(deps, context, 1),
    prevBox: (context) => stepFocus(deps, context, -1),
    leaveBox: () => {
      boxes.leave();
      log('forms', 'left the box');
    },
    nextItem: (context) => moveItem(deps, context, { type: 'nextItem' }),
    prevItem: (context) => moveItem(deps, context, { type: 'prevItem' }),
    openReview: (context) => {
      focusBoxItem(store, boxIn(deps, context));
      const wasForms = store.get().view === 'forms';
      store.dispatch({ type: 'openReview' });
      if (wasForms && store.get().view === 'review') {
        log('forms', 'review opened');
      }
    },
    submit: () => finishActiveRound(deps, 'review', 'submitted'),
    confirmCancel: () => finishActiveRound(deps, 'confirm', 'cancelled'),
  };
}

// The forms box the command's editor edits; a page key fires in no editor.
function boxIn(
  deps: FormsCommandDeps,
  context: PageCommandContext,
): BoxRef | undefined {
  return context.editor === undefined
    ? undefined
    : deps.boxes.boxOf(context.editor);
}

function focusBoxItem(store: FormsStore, box: BoxRef | undefined) {
  if (box === undefined) {
    return;
  }
  const action = focusActionFor(store.get(), box);
  if (action !== null) {
    store.dispatch(action);
  }
}

function focusedAnswer(
  state: FormsState,
): { question: number; answer: QuestionAnswer } | null {
  const round = activeRound(state);
  const item = round === null ? null : focusedItem(round);
  if (round === null || item === null || item.kind !== 'question') {
    return null;
  }
  return { question: item.index, answer: round.answers[item.index - 1] };
}

// Applies an answer action to the focused question and logs the change;
// returns the changed answer, or null when nothing changed.
function changeAnswer(
  deps: FormsCommandDeps,
  context: PageCommandContext,
  action: FormsAction,
  describe: DescribeChange,
): QuestionAnswer | null {
  focusBoxItem(deps.store, boxIn(deps, context));
  const before = focusedAnswer(deps.store.get());
  deps.store.dispatch(action);
  const after = focusedAnswer(deps.store.get());
  if (before === null || after === null || after.answer === before.answer) {
    return null;
  }
  deps.log('forms', describe(after.answer, after.question));
  return after.answer;
}

function focusShownBox(
  deps: FormsCommandDeps,
  fields: BoxField[],
  options?: FocusOptions,
) {
  const box = shownBox(deps.store.get(), fields);
  if (box !== null) {
    deps.boxes.focus(box, options);
  }
}

function stepFocus(
  deps: FormsCommandDeps,
  context: PageCommandContext,
  step: number,
) {
  const from = boxIn(deps, context) ?? deps.boxes.active();
  const next = stepBox(deps.store.get(), from, step);
  if (next !== null) {
    deps.boxes.focus(next);
  }
}

// From inside a box the user stays typing: the new item's answer box takes
// focus. From the page, focus stays on the page.
function moveItem(
  deps: FormsCommandDeps,
  context: PageCommandContext,
  action: FormsAction,
) {
  const box = boxIn(deps, context);
  focusBoxItem(deps.store, box);
  const before = activeRound(deps.store.get())?.focus;
  deps.store.dispatch(action);
  const after = activeRound(deps.store.get())?.focus;
  if (box !== undefined && after !== before) {
    focusShownBox(deps, ANSWER_FIELDS);
  }
}

// Reads the body before the round leaves the state, hands it to main, then
// closes the round.
function finishActiveRound(
  deps: FormsCommandDeps,
  from: FormsView,
  kind: RoundEnd['kind'],
) {
  const state = deps.store.get();
  const round = activeRound(state);
  if (state.view !== from || round === null) {
    return;
  }
  deps.finish(round.roundId, { kind, body: buildBody(round) });
  const isSubmit = kind === 'submitted';
  deps.store.dispatch(
    isSubmit
      ? { type: 'roundClosed', roundId: round.roundId }
      : { type: 'confirmCancel' },
  );
  deps.log('forms', kind);
  deps.toast(
    isSubmit
      ? `Answers sent: ${round.label}`
      : `Round cancelled: ${round.label}`,
    isSubmit ? 'success' : 'info',
  );
}
