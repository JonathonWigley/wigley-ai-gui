import path from 'node:path';
import type {
  AgentFormEndKind,
  AgentFormListener,
  AgentFormOwner,
  AgentFormOwnerInfo,
  AgentFormPresenter,
  AgentFormService,
  AgentFormSession,
  AgentFormType,
} from '../../contracts/agent-forms';
import type { AgentFormStore, SavedAgentForm } from './form-store';

export interface AgentFormServiceDeps<Form, Body, Payload> {
  type: AgentFormType<Form, Body, Payload>;
  presenter: AgentFormPresenter<Form, Body>;
  store: AgentFormStore;
  // Reads the soft deadline when the host names none, once per session.
  defaultDeadlineSeconds(): number;
}

interface FormFinish<Body> {
  kind: AgentFormEndKind;
  body: Body;
}

// A form shown in the window that no tool reply has settled yet.
interface OpenForm<Form, Body> {
  form: Form;
  record: SavedAgentForm;
  latestBody: Body;
  // The user's first submit or cancel; later ones are ignored.
  end: FormFinish<Body> | null;
  // Left the window: the user finished it, its session ended, or the host
  // cancelled the last call waiting for its answers.
  closed: boolean;
  // One per call waiting on this form, woken when it ends or closes.
  waiters: Set<() => void>;
  // The calls waiting for this form's own answers: those waiting on it now,
  // and re-sends of it queued behind an earlier call. A call queued for
  // another form is not one.
  callers: number;
}

// The last form to finish, kept because the reply that carried its answers
// may never have reached the agent.
interface FinishedForm<Form, Body> {
  form: Form;
  outcome: AgentFormEndKind;
  body: Body;
  fingerprint: string;
  // An open call for another form returned it with `earlier_heading`, so a
  // replay keeps that framing.
  handedBack: boolean;
}

// One connected session: at most one open form, and the last finished one.
interface SessionContext<Form, Body, Payload> {
  // The app's id for the session, which every form it shows carries.
  sessionId: string;
  info: AgentFormOwnerInfo;
  // The host id the open and last finished forms were made under.
  formsHostId: string | null;
  deadlineSeconds: number;
  type: AgentFormType<Form, Body, Payload>;
  presenter: AgentFormPresenter<Form, Body>;
  store: AgentFormStore;
  open: OpenForm<Form, Body> | null;
  lastFinished: FinishedForm<Form, Body> | null;
  // Settles once every open call already made has returned; null when none
  // is pending.
  askTurn: Promise<void> | null;
  // The relay disconnected; no call opens a form after this.
  ended: boolean;
  // Ids of unreturned saved forms that no longer parse, already reported to
  // a call.
  reportedUnreadable: Set<string>;
}

// setTimeout fires at once for a delay above a signed 32-bit millisecond count.
const MAX_TIMER_SECONDS = (2 ** 31 - 1) / 1000;

function deadlineSeconds(
  info: AgentFormOwnerInfo,
  defaultSeconds: number,
): number {
  const hostSeconds = info.deadlineSeconds;
  const hostNamedOne =
    hostSeconds !== null &&
    Number.isFinite(hostSeconds) &&
    hostSeconds > 0 &&
    hostSeconds <= MAX_TIMER_SECONDS;
  return hostNamedOne ? hostSeconds : defaultSeconds;
}

function formLabel(projectDir: string | null, heading: string): string {
  return projectDir === null
    ? heading
    : `${path.basename(projectDir)} · ${heading}`;
}

// A new form's draft from the newest save with its fingerprint, which the
// type pre-fills by whether that save finished.
function prefillDraft<Form, Body, Payload>(
  type: AgentFormType<Form, Body, Payload>,
  form: Form,
  saved: SavedAgentForm | null,
): Body | null {
  if (saved === null) {
    return null;
  }
  return type.prefill(
    form,
    type.readBody(form, saved.body),
    saved.outcome !== 'open',
  );
}

function finishedPayload<Form, Body, Payload>(
  type: AgentFormType<Form, Body, Payload>,
  finished: FinishedForm<Form, Body>,
): Payload {
  return type.payload(finished.form, finished.outcome, finished.body);
}

function handedBackFinishedPayload<Form, Body, Payload>(
  type: AgentFormType<Form, Body, Payload>,
  finished: FinishedForm<Form, Body>,
): Payload {
  return type.handedBackPayload(finished.form, finished.outcome, finished.body);
}

function unreadableFormError<Form, Body, Payload>(
  type: AgentFormType<Form, Body, Payload>,
  record: SavedAgentForm,
  cause: Error,
): Error {
  const { noun, openTool } = type;
  const heading = type.savedHeading(record.args);
  const named =
    heading === null ? `A saved ${noun}` : `The saved ${noun} '${heading}'`;
  return new Error(
    `${named} (file ${record.id}.json) was finished but never returned, and ` +
      `its answers cannot be read: it was saved in a shape this app no longer ` +
      `accepts (${cause.message}). Its file is left as it was. Tell the user ` +
      `its answers were not returned. Later calls in this session pass over ` +
      `it, so send your ${noun} again with ${openTool}.`,
  );
}

// A saved form the current parser rejects stays unreturned on disk and is
// reported to the first call that meets it in this session; later calls pass
// over it, so it never blocks the session's forms.
function formFromRecord<Form, Body, Payload>(
  session: SessionContext<Form, Body, Payload>,
  record: SavedAgentForm,
): Form {
  try {
    return session.type.parse(record.args);
  } catch (error) {
    if (error instanceof Error && error.name === session.type.argsErrorName) {
      session.reportedUnreadable.add(record.id);
      throw unreadableFormError(session.type, record, error);
    }
    throw error;
  }
}

function closeInWindow<Form, Body>(
  open: OpenForm<Form, Body>,
  presenter: AgentFormPresenter<Form, Body>,
): void {
  open.closed = true;
  presenter.close(open.record.id);
}

function wakeWaiters<Form, Body>(open: OpenForm<Form, Body>): void {
  for (const wake of open.waiters) {
    wake();
  }
}

// The open form's answers reach a tool reply: keep them for replay and mark
// the file returned.
function settle<Form, Body, Payload>(
  session: SessionContext<Form, Body, Payload>,
  open: OpenForm<Form, Body>,
  end: FormFinish<Body>,
): FinishedForm<Form, Body> {
  const finished: FinishedForm<Form, Body> = {
    form: open.form,
    outcome: end.kind,
    body: end.body,
    fingerprint: open.record.fingerprint,
    handedBack: false,
  };
  session.lastFinished = finished;
  session.open = null;
  session.store.markReturned(open.record);
  return finished;
}

function openFormPayload<Form, Body, Payload>(
  session: SessionContext<Form, Body, Payload>,
  open: OpenForm<Form, Body>,
): Payload {
  const end = open.end;
  if (end === null) {
    return session.type.payload(open.form, 'draft', open.latestBody);
  }
  if (session.open === open) {
    settle(session, open, end);
  }
  return session.type.payload(open.form, end.kind, end.body);
}

function waitForEndOrDeadline<Form, Body>(
  open: OpenForm<Form, Body>,
  seconds: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve) => {
    const wake = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', wake);
      open.waiters.delete(wake);
      resolve();
    };
    const timer = setTimeout(wake, seconds * 1000);
    signal.addEventListener('abort', wake);
    open.waiters.add(wake);
  });
}

// No call is left to collect the form's answers: it leaves the window as on
// a disconnect, its file still open, so a re-send opens it pre-filled. A form
// the user already finished stays for the next call to collect.
function abandonForm<Form, Body, Payload>(
  session: SessionContext<Form, Body, Payload>,
  open: OpenForm<Form, Body>,
): void {
  const isUnfinishedOpenForm = session.open === open && open.end === null;
  if (isUnfinishedOpenForm) {
    closeOpenForm(session);
  }
}

// A call stops waiting on the open form: the host cancelling the last one
// abandons the form, so the session's next form shows.
function releaseCaller<Form, Body, Payload>(
  session: SessionContext<Form, Body, Payload>,
  open: OpenForm<Form, Body>,
  host: AbortSignal,
): void {
  open.callers -= 1;
  if (host.aborted && open.callers === 0) {
    abandonForm(session, open);
  }
}

// A deadline running out is a draft, never a failure: the form stays open
// for the collect tool. `signal` wakes the wait early; `host` is the
// caller's own signal, which a queued call's deadline leaves alone.
async function presentOpen<Form, Body, Payload>(
  session: SessionContext<Form, Body, Payload>,
  open: OpenForm<Form, Body>,
  seconds: number,
  signal: AbortSignal,
  host: AbortSignal = signal,
): Promise<Payload> {
  const mustWait =
    open.end === null && !open.closed && seconds > 0 && !signal.aborted;
  if (!mustWait) {
    return openFormPayload(session, open);
  }
  open.callers += 1;
  await waitForEndOrDeadline(open, seconds, signal);
  const payload = openFormPayload(session, open);
  releaseCaller(session, open, host);
  return payload;
}

// A finished form whose answers no tool reply has carried: the open form,
// when the user finished it after its last reply, or else the newest such
// file this session left on disk before an app restart, passing over the
// files already reported unreadable. Throws when that file no longer parses.
function takeUnreturnedFinished<Form, Body, Payload>(
  session: SessionContext<Form, Body, Payload>,
): FinishedForm<Form, Body> | null {
  const open = session.open;
  if (open !== null) {
    return open.end === null ? null : settle(session, open, open.end);
  }
  const record = session.store.newestUnreturnedFinished(
    session.info,
    session.reportedUnreadable,
  );
  if (record === null) {
    return null;
  }
  const form = formFromRecord(session, record);
  const finished: FinishedForm<Form, Body> = {
    form,
    outcome: record.outcome,
    body: session.type.readBody(form, record.body),
    fingerprint: record.fingerprint,
    handedBack: false,
  };
  session.store.markReturned(record);
  session.lastFinished = finished;
  return finished;
}

function closeOpenForm<Form, Body, Payload>(
  session: SessionContext<Form, Body, Payload>,
): void {
  const open = session.open;
  if (open === null) {
    return;
  }
  if (!open.closed) {
    closeInWindow(open, session.presenter);
  }
  session.open = null;
  wakeWaiters(open);
}

// After the host moves the session to a new id, as `/clear` does, the forms
// made under the old id leave it as on a disconnect: an unfinished one leaves
// the window with its file open, a finished one stays unreturned on disk.
function leaveFormsOfPastHost<Form, Body, Payload>(
  session: SessionContext<Form, Body, Payload>,
): void {
  const hostId = session.info.sessionId;
  if (session.formsHostId === hostId) {
    return;
  }
  session.formsHostId = hostId;
  session.lastFinished = null;
  closeOpenForm(session);
}

function formListener<Form, Body, Payload>(
  session: SessionContext<Form, Body, Payload>,
  open: OpenForm<Form, Body>,
): AgentFormListener<Body> {
  return {
    draft: (body) => {
      if (open.end !== null || open.closed) {
        return;
      }
      open.latestBody = session.type.readBody(open.form, body);
      // Throws when the disk write fails, so the page shows the draft unsaved.
      session.store.saveBody(open.record, open.latestBody);
    },
    // The store logs a failed finish write rather than throwing, so the
    // answers still reach the waiting calls.
    finish: (end) => {
      if (open.end !== null || open.closed) {
        return;
      }
      const body = session.type.readBody(open.form, end.body);
      open.end = { kind: end.kind, body };
      open.latestBody = body;
      session.store.finish(open.record, end.kind, body);
      closeInWindow(open, session.presenter);
      wakeWaiters(open);
    },
  };
}

function openNewForm<Form, Body, Payload>(
  session: SessionContext<Form, Body, Payload>,
  form: Form,
  formFingerprint: string,
  args: unknown,
  toolUseId: string | null,
): OpenForm<Form, Body> {
  const { type } = session;
  const draft = prefillDraft(
    type,
    form,
    session.store.newestFor(formFingerprint),
  );
  const record = session.store.create(
    session.info,
    formFingerprint,
    args,
    draft,
    toolUseId,
  );
  const open: OpenForm<Form, Body> = {
    form,
    record,
    latestBody: draft ?? type.readBody(form, {}),
    end: null,
    closed: false,
    waiters: new Set(),
    callers: 0,
  };
  session.presenter.show(
    {
      formId: record.id,
      sessionId: session.sessionId,
      label: formLabel(session.info.projectDir, type.heading(form)),
      form,
      draft,
    },
    formListener(session, open),
  );
  return open;
}

// The draft a call returns when its form was never shown, so its answers are
// blank; it names the blocking form, when one is open, for the agent to point
// the user at.
function formNotShownPayload<Form, Body, Payload>(
  type: AgentFormType<Form, Body, Payload>,
  form: Form,
  blocking: Form | null,
): Payload {
  return type.notShownPayload(
    form,
    blocking === null ? null : type.heading(blocking),
  );
}

// Rejects a call whose caller is gone, so its form never opens in the window
// with no one to answer it.
function requireLiveCaller<Form, Body, Payload>(
  session: SessionContext<Form, Body, Payload>,
  signal: AbortSignal,
): void {
  const { openTool } = session.type;
  if (session.ended) {
    throw new Error(`The session ended before this ${openTool} ran.`);
  }
  if (signal.aborted) {
    throw new Error(`${openTool} was cancelled before it ran.`);
  }
}

// `signal` wakes the call's wait early; `host` is the caller's own signal,
// whose abort may abandon the form.
async function openParsedForm<Form, Body, Payload>(
  session: SessionContext<Form, Body, Payload>,
  form: Form,
  formFingerprint: string,
  args: unknown,
  toolUseId: string | null,
  signal: AbortSignal,
  host: AbortSignal = signal,
): Promise<Payload> {
  requireLiveCaller(session, signal);
  leaveFormsOfPastHost(session);
  const open = session.open;
  if (open !== null && open.record.fingerprint === formFingerprint) {
    return presentOpen(session, open, session.deadlineSeconds, signal, host);
  }
  const last = session.lastFinished;
  // A cancelled form the agent already received opens again, pre-filled.
  const replaysLastSubmitted =
    open === null &&
    last !== null &&
    last.fingerprint === formFingerprint &&
    last.outcome === 'submitted';
  if (replaysLastSubmitted) {
    return finishedPayload(session.type, last);
  }
  const handed = takeUnreturnedFinished(session);
  if (handed !== null) {
    if (handed.fingerprint === formFingerprint) {
      return finishedPayload(session.type, handed);
    }
    handed.handedBack = true;
    return handedBackFinishedPayload(session.type, handed);
  }
  // One open form per session: an unfinished form is never replaced.
  const unfinished = session.open;
  if (unfinished !== null) {
    return formNotShownPayload(session.type, form, unfinished.form);
  }
  session.lastFinished = null;
  const opened = openNewForm(session, form, formFingerprint, args, toolUseId);
  session.open = opened;
  return presentOpen(session, opened, session.deadlineSeconds, signal, host);
}

// The form the user is still answering, when it is not this call's own form.
function otherUnfinishedForm<Form, Body, Payload>(
  session: SessionContext<Form, Body, Payload>,
  formFingerprint: string,
): OpenForm<Form, Body> | null {
  const open = session.open;
  const blocks =
    open !== null &&
    open.end === null &&
    open.record.fingerprint !== formFingerprint;
  return blocks ? open : null;
}

function settledOrAborted(
  earlier: Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const wake = () => {
      signal.removeEventListener('abort', wake);
      resolve();
    };
    signal.addEventListener('abort', wake);
    void earlier.then(wake);
  });
}

// Waits for the earlier calls to return, then for any other form still open
// to finish: the user's submit or cancel, or the session ending.
async function waitForOtherFormToFinish<Form, Body, Payload>(
  session: SessionContext<Form, Body, Payload>,
  earlier: Promise<void>,
  formFingerprint: string,
  signal: AbortSignal,
): Promise<void> {
  await settledOrAborted(earlier, signal);
  let other = otherUnfinishedForm(session, formFingerprint);
  while (other !== null && !signal.aborted && !session.ended) {
    await waitForEndOrDeadline(other, session.deadlineSeconds, signal);
    other = otherUnfinishedForm(session, formFingerprint);
  }
}

// A queued call whose deadline passed before it ran: the open form's answers
// so far when that form is its own, or else a not-shown draft naming the open
// form. Neither waits again.
function queuedDeadlinePayload<Form, Body, Payload>(
  session: SessionContext<Form, Body, Payload>,
  form: Form,
  formFingerprint: string,
): Payload {
  leaveFormsOfPastHost(session);
  const open = session.open;
  if (open !== null && open.record.fingerprint === formFingerprint) {
    return openFormPayload(session, open);
  }
  return formNotShownPayload(session.type, form, open?.form ?? null);
}

// Opens this call's form only once every earlier call has returned and the
// form the user is answering has finished. Its own deadline bounds the whole
// call: passing first returns without opening a form and leaves the open
// form be. A re-send of the open form waits on that form while queued, so
// the host cancelling the call ahead of it leaves the form open.
async function openFormWhenFree<Form, Body, Payload>(
  session: SessionContext<Form, Body, Payload>,
  earlier: Promise<void>,
  form: Form,
  formFingerprint: string,
  args: unknown,
  toolUseId: string | null,
  signal: AbortSignal,
): Promise<Payload> {
  const deadline = new AbortController();
  const timer = setTimeout(
    () => deadline.abort(),
    session.deadlineSeconds * 1000,
  );
  const callSignal = AbortSignal.any([signal, deadline.signal]);
  const resentOpen =
    session.open?.record.fingerprint === formFingerprint ? session.open : null;
  if (resentOpen !== null) {
    resentOpen.callers += 1;
  }
  try {
    await waitForOtherFormToFinish(
      session,
      earlier,
      formFingerprint,
      callSignal,
    );
    if (resentOpen !== null) {
      releaseCaller(session, resentOpen, signal);
    }
    const deadlinePassed =
      deadline.signal.aborted && !signal.aborted && !session.ended;
    if (deadlinePassed) {
      return queuedDeadlinePayload(session, form, formFingerprint);
    }
    return await openParsedForm(
      session,
      form,
      formFingerprint,
      args,
      toolUseId,
      callSignal,
      signal,
    );
  } finally {
    clearTimeout(timer);
  }
}

// Runs a call at once only when no earlier call is pending and no other form
// is unfinished; any other call waits for both, so a new form never replaces
// a form the user has not submitted or cancelled. A call the type cannot
// parse rejects before anything is saved or shown.
async function openFormQueuedOrNow<Form, Body, Payload>(
  session: SessionContext<Form, Body, Payload>,
  earlier: Promise<void> | null,
  args: unknown,
  toolUseId: string | null,
  signal: AbortSignal,
): Promise<Payload> {
  const form = session.type.parse(args);
  const formFingerprint = session.type.fingerprint(form);
  leaveFormsOfPastHost(session);
  const runsNow =
    earlier === null && otherUnfinishedForm(session, formFingerprint) === null;
  if (runsNow) {
    return openParsedForm(
      session,
      form,
      formFingerprint,
      args,
      toolUseId,
      signal,
    );
  }
  return openFormWhenFree(
    session,
    earlier ?? Promise.resolve(),
    form,
    formFingerprint,
    args,
    toolUseId,
    signal,
  );
}

// Runs `end` and resolves once `asking` and `earlier` have both settled, in
// the same tick as the later of the two, so a caller awaiting `asking` sees
// its turn already over.
function endOnceBothSettle(
  earlier: Promise<void> | null,
  asking: Promise<unknown>,
  end: () => void,
): Promise<void> {
  return new Promise((resolve) => {
    let pending = earlier === null ? 1 : 2;
    const settleOne = () => {
      pending -= 1;
      if (pending === 0) {
        end();
        resolve();
      }
    };
    void asking.then(settleOne, settleOne);
    void earlier?.then(settleOne);
  });
}

// Each call's turn ends once it and every earlier call have returned, so at
// most one call is ever past its wait: a call that returns early, aborted or
// not shown, never frees a later call while an earlier one is pending.
function openFormInTurn<Form, Body, Payload>(
  session: SessionContext<Form, Body, Payload>,
  args: unknown,
  toolUseId: string | null,
  signal: AbortSignal,
): Promise<Payload> {
  const earlier = session.askTurn;
  const asking = openFormQueuedOrNow(session, earlier, args, toolUseId, signal);
  const endTurn = () => {
    if (session.askTurn === turn) {
      session.askTurn = null;
    }
  };
  const turn = endOnceBothSettle(earlier, asking, endTurn);
  session.askTurn = turn;
  return asking;
}

async function collectLastForm<Form, Body, Payload>(
  session: SessionContext<Form, Body, Payload>,
  wait: boolean,
  signal: AbortSignal,
): Promise<Payload> {
  leaveFormsOfPastHost(session);
  const open = session.open;
  if (open !== null) {
    const seconds = wait ? session.deadlineSeconds : 0;
    return presentOpen(session, open, seconds, signal);
  }
  const last = session.lastFinished;
  if (last !== null) {
    return last.handedBack
      ? handedBackFinishedPayload(session.type, last)
      : finishedPayload(session.type, last);
  }
  const handed = takeUnreturnedFinished(session);
  return handed === null
    ? session.type.noFormPayload()
    : finishedPayload(session.type, handed);
}

function startSession<Form, Body, Payload>(
  owner: AgentFormOwner,
  deps: AgentFormServiceDeps<Form, Body, Payload>,
): AgentFormSession<Payload> {
  const { info } = owner;
  const session: SessionContext<Form, Body, Payload> = {
    sessionId: owner.id,
    info,
    formsHostId: info.sessionId,
    deadlineSeconds: deadlineSeconds(info, deps.defaultDeadlineSeconds()),
    type: deps.type,
    presenter: deps.presenter,
    store: deps.store,
    open: null,
    lastFinished: null,
    askTurn: null,
    ended: false,
    reportedUnreadable: new Set(),
  };
  return {
    open: (args, toolUseId, signal) =>
      openFormInTurn(session, args, toolUseId, signal),
    collect: (wait, signal) => collectLastForm(session, wait, signal),
    end: () => {
      session.ended = true;
      closeOpenForm(session);
    },
  };
}

// Form logic every form source reaches, for one form type: validation,
// re-send, replay, hand-back, pre-fill, the soft deadline and the saved forms.
export function createAgentFormService<Form, Body, Payload>(
  deps: AgentFormServiceDeps<Form, Body, Payload>,
): AgentFormService<Payload> {
  return { startSession: (owner) => startSession(owner, deps) };
}
