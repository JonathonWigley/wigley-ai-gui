import type {
  AgentFormClosed,
  AgentFormEnd,
  AgentFormEndKind,
} from '../../contracts/agent-forms';
import type { PluginLog } from '../../contracts/log';
import type { ToastTone } from '../../contracts/plugin';
import { errorText } from '../error-text';
import { type DraftRevisions, finishSave, startSave } from './autosave';
import type { ReducerStore } from './reducer-store';

// A finish handed to main and not yet answered by it.
export interface FormSend {
  kind: AgentFormEndKind;
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
}

// `Presented` is the form as main sends it.
export type SessionFormsAction<Presented> =
  | { type: 'formShown'; form: Presented }
  | { type: 'formClosed'; formId: string }
  | { type: 'sessionActivated'; sessionId: string | null }
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
          }
        : state;
    case 'dismissConfirm':
      return state.view === 'confirm'
        ? { ...state, view: state.confirmReturnView }
        : state;
    case 'sendStarted':
      return updateForm(state, action.formId, (form: Form) =>
        form.sending === null
          ? { ...form, sending: { kind: action.kind } }
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
  };
}

// The lifecycle actions the commands below dispatch.
type LifecycleCommand = Extract<
  SessionFormsAction<never>,
  { type: 'sendStarted' | 'sendFailed' | 'formClosed' }
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

// Whether the close key closes the session at once: it holds a form not
// being sent, which main cancels as the session closes.
export function formClosesAtOnce<Form extends SessionForm>(
  store: Pick<SessionFormsStore<Form>, 'get'>,
  sessionId: string,
): boolean {
  const form = formOfSession(store.get(), sessionId);
  return form !== undefined && form.sending === null;
}

// A form being sent keeps its session, so the answers on their way are not
// cancelled: the tab logs and toasts the send. Any other session may close;
// main's close guard refuses an open form's plain close with its reason.
export function mayCloseSessionForm<Form extends SessionForm>(
  deps: Pick<SessionFormCommandDeps<Form>, 'store' | 'words' | 'toast' | 'log'>,
  sessionId: string,
): boolean {
  const form = formOfSession(deps.store.get(), sessionId);
  if (form === undefined || form.sending === null) {
    return true;
  }
  deps.log(`session close kept: ${form.label} is sending`);
  deps.toast(`Sending ${form.label}'s ${deps.words.noun}…`, 'info');
  return false;
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

// Closes a form main closed. Only a form the page's finish closed logs and
// toasts its send; one main closed on its own stays quiet, since main dropped
// those edits or cancelled them for its closing session, and its send is
// failed first, so its finish event says `closed`.
export function closeFormFromMain<Form extends SessionForm>(
  deps: SessionFormCommandDeps<Form>,
  closed: AgentFormClosed,
): void {
  const { formId } = closed;
  const { words } = deps;
  const form = formById(deps.store.get(), formId);
  const sending = form?.sending ?? null;
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
