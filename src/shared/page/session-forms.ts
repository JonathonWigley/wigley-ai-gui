import type {
  AgentFormClosed,
  AgentFormEnd,
  AgentFormEndKind,
} from '../../contracts/agent-forms';
import type { PluginLog } from '../../contracts/log';
import type { Disposable } from '../../contracts/disposable';
import type { ToastTone } from '../../contracts/plugin';
import { errorText } from '../error-text';
import { type DraftRevisions, finishSave, startSave } from './autosave';
import type { ReducerStore } from './reducer-store';

// A finish handed to main and not yet answered by it. `closesSession` marks a
// cancel the close prompt asked, which closes the session once the form
// closes.
export interface FormSend {
  kind: AgentFormEndKind;
  closesSession: boolean;
}

// What the lifecycle reads of one open form; a plugin's form state extends it.
export interface SessionForm extends DraftRevisions {
  formId: string;
  // The session whose tab the form fills.
  sessionId: string;
  label: string;
  // Set from the send until main's close removes the form or the send fails;
  // a form main closes on its own fails its send first.
  sending: FormSend | null;
}

// `FormView` names the view that shows the form itself, e.g. `forms`.
export type SessionFormsView<FormView extends string> =
  | FormView
  | 'review'
  | 'confirm'
  | 'idle';

// The active form is the form of the session the sessions plugin focuses, or
// null when that session has none; keys and `view` act on it alone.
export interface SessionFormsState<
  Form extends SessionForm,
  FormView extends string,
> {
  // In the order they were shown.
  forms: Form[];
  activeFormId: string | null;
  activeSessionId: string | null;
  view: SessionFormsView<FormView>;
  // Where keeping the form from the cancel prompt returns.
  confirmReturnView: FormView | 'review';
  // Whether confirming the cancel prompt also closes the form's session.
  confirmClosesSession: boolean;
}

// `Presented` is the form as main sends it.
export type SessionFormsAction<Presented> =
  | { type: 'formShown'; form: Presented }
  | { type: 'formClosed'; formId: string }
  | { type: 'sessionActivated'; sessionId: string | null }
  // Asks to cancel the active form before its session closes.
  | { type: 'askClose'; sessionId: string }
  | { type: 'closeReview' }
  | { type: 'askCancel' }
  | { type: 'dismissConfirm' }
  // The form's finish went to main; it closes on main's formClosed.
  | { type: 'sendStarted'; formId: string; kind: AgentFormEndKind }
  // The finish never reached the agent: main refused it, or closed the form
  // on its own first.
  | { type: 'sendFailed'; formId: string }
  | { type: 'saveStarted'; formId: string; revision: number }
  // `error` is null for a save that succeeded.
  | {
      type: 'saveFinished';
      formId: string;
      revision: number;
      error: string | null;
    };

// `formView` is the view a shown form opens in; `restore` builds a form from
// what main sent. `applyOwn` applies the plugin's own actions, of which
// `sendingActions` still apply while the active form is sending.
export interface SessionFormsReducerConfig<
  Form extends SessionForm,
  FormView extends string,
  Presented,
  Own extends { type: string },
> {
  formView: FormView;
  restore(presented: Presented): Form;
  sendingActions: ReadonlySet<Own['type']>;
  applyOwn(
    state: SessionFormsState<Form, FormView>,
    action: Own,
  ): SessionFormsState<Form, FormView>;
}

const LIFECYCLE_ACTIONS: ReadonlySet<string> = new Set<
  SessionFormsAction<unknown>['type']
>([
  'formShown',
  'formClosed',
  'sessionActivated',
  'askClose',
  'closeReview',
  'askCancel',
  'dismissConfirm',
  'sendStarted',
  'sendFailed',
  'saveStarted',
  'saveFinished',
]);

// The lifecycle actions that still apply while the active form is sending:
// forms opening and closing, the focused session, saves, and the send's own
// failure.
const SENDING_LIFECYCLE_ACTIONS: ReadonlySet<string> = new Set<
  SessionFormsAction<unknown>['type']
>([
  'formShown',
  'formClosed',
  'sessionActivated',
  'saveStarted',
  'saveFinished',
  'sendFailed',
]);

export function emptySessionForms<
  Form extends SessionForm,
  FormView extends string,
>(activeSessionId: string | null): SessionFormsState<Form, FormView> {
  return {
    forms: [],
    activeFormId: null,
    activeSessionId,
    view: 'idle',
    confirmReturnView: 'review',
    confirmClosesSession: false,
  };
}

// The reducer over the lifecycle actions and the plugin's own. It returns
// `state` itself when the action changes nothing; while the active form is
// sending, only the sending lifecycle actions and `sendingActions` apply.
export function createSessionFormsReducer<
  Form extends SessionForm,
  FormView extends string,
  Presented,
  Own extends { type: string },
>(
  config: SessionFormsReducerConfig<Form, FormView, Presented, Own>,
): (
  state: SessionFormsState<Form, FormView>,
  action: SessionFormsAction<Presented> | Own,
) => SessionFormsState<Form, FormView> {
  return (state, action) => {
    const isActiveSending = (activeForm(state)?.sending ?? null) !== null;
    const appliesWhileSending =
      SENDING_LIFECYCLE_ACTIONS.has(action.type) ||
      config.sendingActions.has(action.type);
    if (isActiveSending && !appliesWhileSending) {
      return state;
    }
    return isLifecycleAction<Presented>(action)
      ? applyLifecycle(state, action, config)
      : config.applyOwn(state, action as Own);
  };
}

export function activeForm<Form extends SessionForm>(
  state: SessionFormsState<Form, string>,
): Form | null {
  return state.forms.find((form) => form.formId === state.activeFormId) ?? null;
}

// The session's form; main keeps one open form per session, so the first
// match is the only one.
export function formOfSession<Form extends SessionForm>(
  state: SessionFormsState<Form, string>,
  sessionId: string | null,
): Form | undefined {
  return state.forms.find((form) => form.sessionId === sessionId);
}

export function formById<Form extends SessionForm>(
  state: SessionFormsState<Form, string>,
  formId: string,
): Form | undefined {
  return state.forms.find((form) => form.formId === formId);
}

// The view whose pane shows: under the cancel prompt, the view keeping the
// form returns to.
export function paneView<FormView extends string>(
  state: Pick<
    SessionFormsState<SessionForm, FormView>,
    'view' | 'confirmReturnView'
  >,
): FormView | 'review' | 'idle' {
  const { view } = state;
  return view === 'confirm' ? state.confirmReturnView : view;
}

// The view the session's tab draws its form in, focused or not: the active
// session's in `paneView`, every other session's in `formView`, the view it
// opens in once its session is active; 'idle' for a session with no form.
export function sessionPaneView<FormView extends string>(
  state: SessionFormsState<SessionForm, FormView>,
  sessionId: string,
  formView: FormView,
): FormView | 'review' | 'idle' {
  if (formOfSession(state, sessionId) === undefined) {
    return 'idle';
  }
  return sessionId === state.activeSessionId ? paneView(state) : formView;
}

// Returns `state` itself when `change` returns the form it was given.
export function updateForm<Form extends SessionForm, FormView extends string>(
  state: SessionFormsState<Form, FormView>,
  formId: string | null,
  change: (form: Form) => Form,
): SessionFormsState<Form, FormView> {
  let changed = false;
  const forms = state.forms.map((form) => {
    if (form.formId !== formId) {
      return form;
    }
    const next = change(form);
    changed = changed || next !== form;
    return next;
  });
  return changed ? { ...state, forms } : state;
}

function isLifecycleAction<Presented>(action: {
  type: string;
}): action is SessionFormsAction<Presented> {
  return LIFECYCLE_ACTIONS.has(action.type);
}

function applyLifecycle<
  Form extends SessionForm,
  FormView extends string,
  Presented,
>(
  state: SessionFormsState<Form, FormView>,
  action: SessionFormsAction<Presented>,
  config: Pick<
    SessionFormsReducerConfig<Form, FormView, Presented, never>,
    'formView' | 'restore'
  >,
): SessionFormsState<Form, FormView> {
  switch (action.type) {
    case 'formShown':
      return showForm(state, config.restore(action.form), config.formView);
    case 'formClosed':
      return closeForm(state, action.formId);
    case 'sessionActivated':
      return activateSession(state, action.sessionId, config.formView);
    case 'askClose':
      return askClose(state, action.sessionId, config.formView);
    case 'closeReview':
      return state.view === 'review'
        ? { ...state, view: config.formView }
        : state;
    case 'askCancel':
      return state.view === 'review'
        ? {
            ...state,
            view: 'confirm',
            confirmReturnView: 'review',
            confirmClosesSession: false,
          }
        : state;
    case 'dismissConfirm':
      return state.view === 'confirm'
        ? {
            ...state,
            view: state.confirmReturnView,
            confirmClosesSession: false,
          }
        : state;
    case 'sendStarted':
      return updateForm(state, action.formId, (form: Form) =>
        form.sending === null
          ? {
              ...form,
              sending: {
                kind: action.kind,
                closesSession:
                  action.kind === 'cancelled' && state.confirmClosesSession,
              },
            }
          : form,
      );
    case 'sendFailed':
      return updateForm(state, action.formId, (form: Form) =>
        form.sending === null ? form : { ...form, sending: null },
      );
    case 'saveStarted':
      return updateForm(state, action.formId, (form: Form) =>
        startSave(form, action.revision),
      );
    case 'saveFinished':
      return updateForm(state, action.formId, (form: Form) =>
        finishSave(form, action.revision, action.error),
      );
  }
}

// A form for the focused session becomes active; any other waits in the
// background, drawn in its own tab. A form already open stays as it is.
function showForm<Form extends SessionForm, FormView extends string>(
  state: SessionFormsState<Form, FormView>,
  shown: Form,
  formView: FormView,
): SessionFormsState<Form, FormView> {
  if (formById(state, shown.formId) !== undefined) {
    return state;
  }
  const forms = [...state.forms, shown];
  if (shown.sessionId !== state.activeSessionId) {
    return { ...state, forms };
  }
  return { ...state, forms, activeFormId: shown.formId, view: formView };
}

// The active form closing leaves its session focused with no form.
function closeForm<Form extends SessionForm, FormView extends string>(
  state: SessionFormsState<Form, FormView>,
  formId: string,
): SessionFormsState<Form, FormView> {
  const forms = state.forms.filter((form) => form.formId !== formId);
  if (forms.length === state.forms.length) {
    return state;
  }
  if (formId !== state.activeFormId) {
    return { ...state, forms };
  }
  return {
    ...state,
    forms,
    activeFormId: null,
    view: 'idle',
    confirmClosesSession: false,
  };
}

// Shows the newly active session's form, or the idle view; a pending prompt
// is dismissed.
function activateSession<Form extends SessionForm, FormView extends string>(
  state: SessionFormsState<Form, FormView>,
  sessionId: string | null,
  formView: FormView,
): SessionFormsState<Form, FormView> {
  if (sessionId === state.activeSessionId) {
    return state;
  }
  const form = formOfSession(state, sessionId);
  return {
    ...state,
    activeSessionId: sessionId,
    activeFormId: form?.formId ?? null,
    view: form === undefined ? 'idle' : formView,
    confirmClosesSession: false,
  };
}

// Opens the cancel prompt for the active form of the closing session, from
// its form view or review; keeping the form returns there.
function askClose<Form extends SessionForm, FormView extends string>(
  state: SessionFormsState<Form, FormView>,
  sessionId: string,
  formView: FormView,
): SessionFormsState<Form, FormView> {
  const view = state.view;
  const isFormOfSession = activeForm(state)?.sessionId === sessionId;
  const isAskable = view === formView || view === 'review';
  if (!isFormOfSession || !isAskable) {
    return state;
  }
  return {
    ...state,
    view: 'confirm',
    confirmReturnView: view === 'review' ? 'review' : formView,
    confirmClosesSession: true,
  };
}

// The lifecycle actions the commands below dispatch.
type LifecycleCommand = Extract<
  SessionFormsAction<never>,
  { type: 'askClose' | 'sendStarted' | 'sendFailed' | 'formClosed' }
>;

// The store the commands below read and dispatch to; a plugin's store over
// its SessionFormsState fits.
export interface SessionFormsStore<Form extends SessionForm> {
  get(): SessionFormsState<Form, string>;
  dispatch(action: LifecycleCommand): void;
}

// How the log and toasts name a form: `noun` as in `round`, `sent` as the
// toast after a submit, as in `Answers sent`.
export interface SessionFormWords {
  noun: string;
  sent: string;
}

export interface SessionFormCommandDeps<Form extends SessionForm> {
  store: SessionFormsStore<Form>;
  words: SessionFormWords;
  toast(text: string, tone: ToastTone): void;
  log: PluginLog;
}

// Whether a close still waits on the form's cancel prompt: the prompt shows
// for it, asking to close its session, or the cancel it asked is sending.
function isCloseWaiting(
  state: SessionFormsState<SessionForm, string>,
  formId: string,
): boolean {
  const form = formById(state, formId);
  if (form === undefined) {
    return false;
  }
  if (form.sending !== null) {
    return form.sending.closesSession;
  }
  return (
    state.view === 'confirm' &&
    state.confirmClosesSession &&
    state.activeFormId === formId
  );
}

// The answers a form's cancel prompt owes the session closes that opened it,
// by form id. `wait` is the answer for the form's prompt, one promise however
// many closes wait: true once `closing` says the cancel it asked closed the
// form, false once the prompt goes another way (kept, dismissed as the session
// changes, the form closed without it). `dispose` answers every wait false.
export interface SessionCloseAnswers extends Disposable {
  wait(formId: string): Promise<boolean>;
  closing(formId: string): void;
}

export function createSessionCloseAnswers(store: {
  get(): SessionFormsState<SessionForm, string>;
  subscribe(listener: () => void): Disposable;
}): SessionCloseAnswers {
  const waits = new Map<
    string,
    { answer: Promise<boolean>; settle(closes: boolean): void }
  >();
  const settle = (formId: string, closes: boolean) => {
    waits.get(formId)?.settle(closes);
    waits.delete(formId);
  };
  const subscription = store.subscribe(() => {
    for (const formId of waits.keys()) {
      if (!isCloseWaiting(store.get(), formId)) {
        settle(formId, false);
      }
    }
  });
  return {
    wait(formId) {
      const held = waits.get(formId);
      if (held !== undefined) {
        return held.answer;
      }
      let settleWith: (closes: boolean) => void = () => undefined;
      const answer = new Promise<boolean>((resolve) => {
        settleWith = resolve;
      });
      waits.set(formId, { answer, settle: settleWith });
      return answer;
    },
    closing: (formId) => settle(formId, true),
    dispose() {
      subscription.dispose();
      for (const formId of waits.keys()) {
        settle(formId, false);
      }
    },
  };
}

// `showForm` selects the session's form tab; `activate` selects the session;
// `closeAnswers` holds the prompt's answer to the close.
export interface GuardSessionCloseDeps<
  Form extends SessionForm,
> extends SessionFormCommandDeps<Form> {
  showForm(sessionId: string): void;
  activate(sessionId: string): void;
  closeAnswers: Pick<SessionCloseAnswers, 'wait'>;
}

// A session closes only once its form is gone: with its form active it
// selects the session's form tab, so the confirm scope's keys are in force,
// and asks to cancel the form, answering with the prompt's answer: true once
// the confirmed cancel closed the form, false once the user keeps it. A close
// while the prompt already asks waits on the same answer. A form open in the
// background keeps its session with no prompt: the guard logs the refusal,
// toasts why, and selects the session. A form being sent, active or not,
// keeps its session: the guard logs and toasts the send, and selects nothing.
export function guardSessionClose<Form extends SessionForm>(
  deps: GuardSessionCloseDeps<Form>,
  sessionId: string,
): boolean | Promise<boolean> {
  const { store, words } = deps;
  const form = formOfSession(store.get(), sessionId);
  if (form === undefined) {
    return true;
  }
  if (form.sending !== null) {
    deps.log(`session close kept: ${form.label} is sending`);
    deps.toast(`Sending ${form.label}'s ${words.noun}…`, 'info');
    return false;
  }
  if (form.formId !== store.get().activeFormId) {
    deps.log(`session close kept: ${form.label} is open in the background`);
    deps.toast(`Finish or cancel ${form.label}'s ${words.noun} first`, 'info');
    deps.activate(sessionId);
    return false;
  }
  deps.showForm(sessionId);
  const wasWaiting = isCloseWaiting(store.get(), form.formId);
  store.dispatch({ type: 'askClose', sessionId });
  if (!isCloseWaiting(store.get(), form.formId)) {
    return false;
  }
  if (!wasWaiting) {
    deps.log(`closing the session asks to cancel ${form.label}`);
  }
  return deps.closeAnswers.wait(form.formId);
}

// `finish` hands the finished form to main and rejects with the reason when
// main keeps the form open.
export interface FinishFormDeps<
  Form extends SessionForm,
  Body,
> extends SessionFormCommandDeps<Form> {
  finish(formId: string, end: AgentFormEnd<Body>): Promise<void>;
  bodyOf(form: Form): Body;
}

// Marks the active form sending and hands main its body, when the view is
// `from` and the form is not sending already; main's `formClosed` then closes
// it through closeFormFromMain. A rejected finish clears the mark, keeping
// the form as it was, and toasts the reason.
export function finishActiveForm<Form extends SessionForm, Body>(
  deps: FinishFormDeps<Form, Body>,
  from: string,
  kind: AgentFormEndKind,
): void {
  const { words } = deps;
  const state = deps.store.get();
  const form = activeForm(state);
  if (state.view !== from || form === null || form.sending !== null) {
    return;
  }
  const { formId } = form;
  const body = deps.bodyOf(form);
  deps.store.dispatch({ type: 'sendStarted', formId, kind });
  void deps.finish(formId, { kind, body }).catch((error) => {
    deps.store.dispatch({ type: 'sendFailed', formId });
    deps.log(`${words.noun} ${formId} not finished: ${errorText(error)}`);
    deps.toast(
      `${capitalized(words.noun)} not sent: ${errorText(error)}`,
      'error',
    );
  });
}

export interface CloseFormFromMainDeps<
  Form extends SessionForm,
> extends SessionFormCommandDeps<Form> {
  closeAnswers: Pick<SessionCloseAnswers, 'closing'>;
}

// Closes a form main closed. A form the page was sending answers the close
// that asked its cancel true, whoever closed the form, so that close goes on
// to main. Only a
// form the page's finish closed logs and toasts its send; one main closed on
// its own stays quiet, since main dropped those edits, and its send is failed
// first, so its finish event says `closed`.
export function closeFormFromMain<Form extends SessionForm>(
  deps: CloseFormFromMainDeps<Form>,
  closed: AgentFormClosed,
): void {
  const { formId } = closed;
  const { words } = deps;
  const form = formById(deps.store.get(), formId);
  const sending = form?.sending ?? null;
  if (sending?.closesSession === true) {
    deps.closeAnswers.closing(formId);
  }
  if (!closed.byFinish && sending !== null) {
    deps.store.dispatch({ type: 'sendFailed', formId });
  }
  deps.store.dispatch({ type: 'formClosed', formId });
  if (form === undefined || sending === null) {
    return;
  }
  if (closed.byFinish) {
    const isSubmit = sending.kind === 'submitted';
    deps.log(sending.kind);
    deps.toast(
      isSubmit
        ? `${words.sent}: ${form.label}`
        : `${capitalized(words.noun)} cancelled: ${form.label}`,
      isSubmit ? 'success' : 'info',
    );
  }
}

// Emits the events of each store change, diffed by `eventsBetween` against
// the state the last change left (the store's state at start for the first).
// A change a listener's own dispatch makes is diffed at once but queued, and
// its events go out after the events already queued, in change order, so the
// last event a host hears matches the state.
export function startFormEvents<State, Event>(
  store: Pick<ReducerStore<State, never>, 'get' | 'subscribe'>,
  eventsBetween: (previous: State, next: State) => Event[],
  emit: (event: Event) => void,
): void {
  let previous = store.get();
  const queued: Event[] = [];
  let isEmitting = false;
  store.subscribe(() => {
    const next = store.get();
    queued.push(...eventsBetween(previous, next));
    previous = next;
    if (isEmitting) {
      return;
    }
    isEmitting = true;
    try {
      for (
        let event = queued.shift();
        event !== undefined;
        event = queued.shift()
      ) {
        emit(event);
      }
    } finally {
      queued.length = 0;
      isEmitting = false;
    }
  });
}

function capitalized(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
