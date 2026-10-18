import type { CommandId } from '../../contracts/commands';
import type { FocusOptions } from '../../contracts/editor';
import type { RoundEnd } from '../../contracts/forms';
import type { Log } from '../../contracts/log';
import type {
  RendererCommandContext,
  RendererCommands,
} from '../renderer-commands';
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
import type { ToastTone } from './toasts';

export interface FormsCommandDeps {
  store: FormsStore;
  boxes: Pick<EditorBoxes, 'focus' | 'leave' | 'active'>;
  // Hands the finished round to main.
  finish(roundId: string, end: RoundEnd): void;
  toast(text: string, tone: ToastTone): void;
  log: Log;
}

type DescribeChange = (answer: QuestionAnswer, question: number) => string;

// forms.choose1 … forms.choose9; a tenth choice is picked by mouse.
const CHOICE_COMMANDS = 9;

const ANSWER_FIELDS: BoxField[] = ['what', 'comment'];

const APPEND: FocusOptions = { insertAtEnd: true };

// Commands that apply their form-state action and nothing more.
const PLAIN_ACTIONS: [CommandId, FormsAction][] = [
  ['forms.toggleFold', { type: 'toggleFold' }],
  ['forms.unfoldAll', { type: 'unfoldAll' }],
  ['forms.foldAll', { type: 'foldAll' }],
  ['forms.nextRound', { type: 'nextRound' }],
  ['forms.prevRound', { type: 'prevRound' }],
  ['forms.closeReview', { type: 'closeReview' }],
  ['forms.reviewNext', { type: 'reviewNext' }],
  ['forms.reviewPrev', { type: 'reviewPrev' }],
  ['forms.reviewJump', { type: 'reviewJump' }],
  ['forms.askCancel', { type: 'askCancel' }],
  ['forms.dismissConfirm', { type: 'dismissConfirm' }],
  ['help.toggle', { type: 'toggleHelp' }],
  ['help.close', { type: 'closeHelp' }],
];

// Every forms.* and help.* command. A command fired in a box first focuses
// that box's item, so it acts where the user is typing.
export function registerFormsCommands(
  commands: RendererCommands,
  deps: FormsCommandDeps,
) {
  const { store, boxes, log } = deps;

  for (const [command, action] of PLAIN_ACTIONS) {
    commands.register(command, (context) => {
      focusBoxItem(store, context.box);
      store.dispatch(action);
    });
  }
  for (let choice = 1; choice <= CHOICE_COMMANDS; choice++) {
    commands.register(`forms.choose${choice}`, (context) =>
      changeAnswer(deps, context, { type: 'choose', choice }, (answer, n) =>
        answer.choice === choice
          ? `chose ${choice} on question ${n}`
          : `cleared the choice on question ${n}`,
      ),
    );
  }
  commands.register('forms.clearChoice', (context) =>
    changeAnswer(
      deps,
      context,
      { type: 'clearChoice' },
      (_answer, n) => `cleared the choice on question ${n}`,
    ),
  );
  commands.register('forms.toggleNotApplicable', (context) =>
    changeAnswer(deps, context, { type: 'toggleNotApplicable' }, (answer, n) =>
      answer.notApplicable
        ? `not applicable on question ${n}`
        : `applicable again on question ${n}`,
    ),
  );
  commands.register('forms.toggleDontAsk', (context) => {
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
  });
  // As vim's `A`: `a` and `o` start typing after the box's text.
  commands.register('forms.editWhat', () =>
    focusShownBox(deps, ANSWER_FIELDS, APPEND),
  );
  commands.register('forms.editWhy', () => focusShownBox(deps, ['why']));
  commands.register('forms.editNote', () =>
    focusShownBox(deps, ['note'], APPEND),
  );
  commands.register('forms.nextBox', (context) => stepFocus(deps, context, 1));
  commands.register('forms.prevBox', (context) => stepFocus(deps, context, -1));
  commands.register('forms.leaveBox', () => {
    boxes.leave();
    log('forms', 'left the box');
  });
  commands.register('forms.nextItem', (context) =>
    moveItem(deps, context, { type: 'nextItem' }),
  );
  commands.register('forms.prevItem', (context) =>
    moveItem(deps, context, { type: 'prevItem' }),
  );
  commands.register('forms.openReview', (context) => {
    focusBoxItem(store, context.box);
    const wasForms = store.get().view === 'forms';
    store.dispatch({ type: 'openReview' });
    if (wasForms && store.get().view === 'review') {
      log('forms', 'review opened');
    }
  });
  commands.register('forms.submit', () =>
    finishActiveRound(deps, 'review', 'submitted'),
  );
  commands.register('forms.confirmCancel', () =>
    finishActiveRound(deps, 'confirm', 'cancelled'),
  );
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
  context: RendererCommandContext,
  action: FormsAction,
  describe: DescribeChange,
): QuestionAnswer | null {
  focusBoxItem(deps.store, context.box);
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
  context: RendererCommandContext,
  step: number,
) {
  const from = context.box ?? deps.boxes.active();
  const next = stepBox(deps.store.get(), from, step);
  if (next !== null) {
    deps.boxes.focus(next);
  }
}

// From inside a box the user stays typing: the new item's answer box takes
// focus. From the page, focus stays on the page.
function moveItem(
  deps: FormsCommandDeps,
  context: RendererCommandContext,
  action: FormsAction,
) {
  focusBoxItem(deps.store, context.box);
  const before = activeRound(deps.store.get())?.focus;
  deps.store.dispatch(action);
  const after = activeRound(deps.store.get())?.focus;
  if (context.box !== undefined && after !== before) {
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
