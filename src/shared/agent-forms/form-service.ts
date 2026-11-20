import path from 'node:path';
import {
  type AgentFormAutoAnswer,
  type AgentFormEndKind,
  type AgentFormListener,
  type AgentFormOwner,
  type AgentFormOwnerInfo,
  type AgentFormPresenter,
  type AgentFormService,
  type AgentFormSession,
  type AgentFormType,
  type AgentFormWake,
  HOST_DEADLINE_FIELD,
} from '../../contracts/agent-forms';
import type { Timers } from '../../contracts/ambient';
import {
  type AgentFormStore,
  isFinished,
  type SavedAgentForm,
} from './form-store';

export interface AgentFormServiceDeps<Form, Body, Payload> {
  type: AgentFormType<Form, Body, Payload>;
  presenter: AgentFormPresenter<Form, Body>;
  store: AgentFormStore;
  // Told when the user finishes a form no call will return.
  wake: AgentFormWake;
  // Reads the soft deadline when the host names none, at each use.
  defaultDeadlineSeconds(): number;
  // A plugin's timers cap a long delay at the longest a timer takes, and its stop
  // clears them with no wake, so its part ends each session before they clear.
  timers: Timers;
  // Answers a session's forms with no window while its `isOn` holds; none
  // shows every form.
  autoAnswer?: AgentFormAutoAnswer<Form, Body, Payload>;
}

interface FormFinish<Body> {
  kind: AgentFormEndKind;
  body: Body;
  // The agent queued the type's submit message in its running turn.
  messagePosted: boolean;
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
  messagePosted: boolean;
  fingerprint: string;
  // An open call for another form returned it with `earlier_heading`, so a
  // replay keeps that framing.
  handedBack: boolean;
  // The auto-answer answered it and no form showed, so a replay returns the
  // auto-answer's payload.
  autoAnswered: boolean;
}

// Shared by every session of one service; `detach` sets it at an app quit.
interface DetachState {
  detached: boolean;
}

// One connected session: at most one open form, and the last finished one.
interface SessionContext<Form, Body, Payload> {
  // The app's id for the session, which every form it shows carries.
  sessionId: string;
  info: AgentFormOwnerInfo;
  // The host id the open and last finished forms were made under.
  formsHostId: string | null;
  defaultDeadlineSeconds: () => number;
  type: AgentFormType<Form, Body, Payload>;
  presenter: AgentFormPresenter<Form, Body>;
  store: AgentFormStore;
  wake: AgentFormWake;
  timers: Timers;
  autoAnswer: AgentFormAutoAnswer<Form, Body, Payload> | null;
  open: OpenForm<Form, Body> | null;
  lastFinished: FinishedForm<Form, Body> | null;
  // Settles once every open call already made has returned; null when none
  // is pending.
  askTurn: Promise<void> | null;
  // Settles once the message the user's last submit sent ahead of its
  // answers was queued or given up on; null when none is on its way. Every
  // call starts and returns only after it.
  answersHeld: Promise<void> | null;
  // The relay disconnected; no call opens a form after this.
  ended: boolean;
  // Ids of unreturned saved forms that no longer parse, already reported to
  // a call.
  reportedUnreadable: Set<string>;
  // Ids of the forms this connection showed, which a collect never reopens.
  shownIds: Set<string>;
  detach: DetachState;
  // Every session of the service not yet ended, this one included.
  liveSessions: Set<SessionContext<Form, Body, Payload>>;
}

// The host's soft deadline when its record names a positive number of
// seconds, else `defaultSeconds`.
function deadlineSeconds(
  info: AgentFormOwnerInfo,
  defaultSeconds: number,
): number {
  const hostSeconds = info.host?.[HOST_DEADLINE_FIELD];
  const hostNamedOne =
    typeof hostSeconds === 'number' &&
    Number.isFinite(hostSeconds) &&
    hostSeconds > 0;
  return hostNamedOne ? hostSeconds : defaultSeconds;
}

// The session's soft deadline as its info says now: a relay joining after the
// session started can bring the host's fields.
function sessionDeadlineSeconds<Form, Body, Payload>(
  session: SessionContext<Form, Body, Payload>,
): number {
  return deadlineSeconds(session.info, session.defaultDeadlineSeconds());
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
  return type.payload(
    finished.form,
    finished.outcome,
    finished.body,
    finished.messagePosted,
  );
}

// `last` holds the user's own submitted answers to the form `formFingerprint`
// names, which a re-send of that form gets back.
function isUserSubmitted<Form, Body>(
  last: FinishedForm<Form, Body>,
  formFingerprint: string,
): boolean {
  return (
    last.fingerprint === formFingerprint &&
    last.outcome === 'submitted' &&
    !last.autoAnswered
  );
}

// The last finished form's answers again, framed as its first return framed
// them: auto-answered, handed back, or plain.
function lastFinishedPayload<Form, Body, Payload>(
  session: SessionContext<Form, Body, Payload>,
  last: FinishedForm<Form, Body>,
): Payload {
  const { autoAnswer } = session;
  if (last.autoAnswered && autoAnswer !== null) {
    return autoAnswer.payload(last.form, last.body);
  }
  return last.handedBack
    ? handedBackFinishedPayload(session.type, last)
    : finishedPayload(session.type, last);
}

function handedBackFinishedPayload<Form, Body, Payload>(
  type: AgentFormType<Form, Body, Payload>,
  finished: FinishedForm<Form, Body>,
): Payload {
  return type.handedBackPayload(
    finished.form,
    finished.outcome,
    finished.body,
    finished.messagePosted,
  );
}

function unreadableFormError<Form, Body, Payload>(
  type: AgentFormType<Form, Body, Payload>,
  record: SavedAgentForm,
  causeText: string,
): Error {
  const { noun, openTool } = type;
  const heading = type.savedHeading(record.args);
  const named =
    heading === null ? `A saved ${noun}` : `The saved ${noun} '${heading}'`;
  const state = isFinished(record)
    ? 'was finished but never returned'
    : 'was left open with no answer';
  return new Error(
    `${named} (file ${record.id}.json) ${state}, and ` +
      `its answers cannot be read: it was saved in a shape this app no longer ` +
      `accepts (${causeText}). Its file is left as it was. Tell the user ` +
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
    const text = session.type.argsErrorText(error);
    if (text !== null) {
      session.reportedUnreadable.add(record.id);
      throw unreadableFormError(session.type, record, text);
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
    messagePosted: end.messagePosted,
    fingerprint: open.record.fingerprint,
    handedBack: false,
    autoAnswered: false,
  };
  session.lastFinished = finished;
  session.open = null;
  session.store.markReturned(open.record);
  return finished;
}

function sessionEndedUnansweredError<Form, Body, Payload>(
  type: AgentFormType<Form, Body, Payload>,
): Error {
  return new Error(
    `The session ended before the ${type.noun} was answered, and it has closed. ` +
      `Send it again with ${type.openTool}: the answers saved so far fill in.`,
  );
}

// A session that ended took its unfinished form out of the window, so a call
// it woke has no draft to report.
function openFormPayload<Form, Body, Payload>(
  session: SessionContext<Form, Body, Payload>,
  open: OpenForm<Form, Body>,
): Payload {
  const end = open.end;
  if (end === null) {
    if (session.ended) {
      throw sessionEndedUnansweredError(session.type);
    }
    return session.type.payload(open.form, 'draft', open.latestBody, false);
  }
  if (session.open === open) {
    settle(session, open, end);
  }
  return session.type.payload(open.form, end.kind, end.body, end.messagePosted);
}

function waitForEndOrDeadline<Form, Body>(
  timers: Timers,
  open: OpenForm<Form, Body>,
  seconds: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve) => {
    const wake = () => {
      timers.clear(timer);
      signal.removeEventListener('abort', wake);
      open.waiters.delete(wake);
      resolve();
    };
    const timer = timers.set(wake, seconds * 1000);
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
// abandons the form, so the session's next form shows. After a detach the
// form stays, since the quit, not the host, ended the call.
function releaseCaller<Form, Body, Payload>(
  session: SessionContext<Form, Body, Payload>,
  open: OpenForm<Form, Body>,
  host: AbortSignal,
): void {
  open.callers -= 1;
  const hostLeftTheForm =
    host.aborted && open.callers === 0 && !session.detach.detached;
  if (hostLeftTheForm) {
    abandonForm(session, open);
  }
}

// A deadline running out is a draft, never a failure: the form stays open
// for the collect tool. The session ending with no answer rejects the call.
// `signal` wakes the wait early; `host` is the caller's own signal, which a
// queued call's deadline leaves alone.
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
  await waitForEndOrDeadline(session.timers, open, seconds, signal);
  try {
    return openFormPayload(session, open);
  } finally {
    releaseCaller(session, open, host);
  }
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
    messagePosted: false,
    fingerprint: record.fingerprint,
    handedBack: false,
    autoAnswered: false,
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

// The message that points the session at the collect tool for a form the
// user finished while no call waited on it.
function formFinishedUnheardText<Form, Body, Payload>(
  type: AgentFormType<Form, Body, Payload>,
  form: Form,
  kind: AgentFormEndKind,
): string {
  return `The user ${kind} the ${type.noun} "${type.heading(form)}" in the forms app. Call ${type.collectTool} for its answers.`;
}

// The type's message for the user's submit, or null for a cancel, a closing
// session's cancel, or a submit the type sends nothing for.
function submitMessageOf<Form, Body, Payload>(
  type: AgentFormType<Form, Body, Payload>,
  form: Form,
  kind: AgentFormEndKind,
  body: Body,
  endedBy: 'user' | 'sessionClose',
): string | null {
  const isUserSubmit = endedBy === 'user' && kind === 'submitted';
  return isUserSubmit ? (type.submitMessage?.(form, body) ?? null) : null;
}

// Measured from write to `queued` in well under a second
// (claude-stream.md § Message lifecycle); past this the answers go without it.
export const MESSAGE_QUEUE_TIMEOUT_MS = 3000;

// Whether the agent queued `message` in its running turn, false once
// `MESSAGE_QUEUE_TIMEOUT_MS` passes first.
function sendAheadOfAnswers<Form, Body, Payload>(
  session: SessionContext<Form, Body, Payload>,
  message: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = session.timers.set(
      () => resolve(false),
      MESSAGE_QUEUE_TIMEOUT_MS,
    );
    void session.wake
      .sendBeforeAnswers(session.sessionId, message)
      .then((isQueued) => {
        session.timers.clear(timer);
        resolve(isQueued);
      });
  });
}

// Holds every call's return until `sending` settles, unless a later submit's
// send has replaced it.
function holdAnswersUntil<Form, Body, Payload>(
  session: SessionContext<Form, Body, Payload>,
  sending: Promise<void>,
): void {
  const held = sending.then(() => {
    if (session.answersHeld === held) {
      session.answersHeld = null;
    }
  });
  session.answersHeld = held;
}

// The user's submit or cancel, or a cancel for the closing session: the form
// ends with `body`, leaves the window and wakes its waiting calls. A form the
// user finished that no call will return, made under the session's current
// host id, wakes the session; the closing session's cancel wakes none. With a
// call waiting, the type's submit message is sent into the session's running
// turn first, and the waiting calls wake, and every call returns, only once
// the agent queued it or the send gave up; the answers say which. With no call
// waiting it is not sent: a wake runs as a turn of its own, too late to
// approve anything. The store logs a failed finish write rather than
// throwing, so the answers still reach the waiting calls.
function endForm<Form, Body, Payload>(
  session: SessionContext<Form, Body, Payload>,
  open: OpenForm<Form, Body>,
  kind: AgentFormEndKind,
  body: Body,
  endedBy: 'user' | 'sessionClose',
): void {
  const end: FormFinish<Body> = { kind, body, messagePosted: false };
  open.end = end;
  open.latestBody = body;
  session.store.finish(open.record, kind, body);
  closeInWindow(open, session.presenter);
  const noCallWaits = open.callers === 0 && session.askTurn === null;
  const madeUnderCurrentHost = session.formsHostId === session.info.sessionId;
  const message = submitMessageOf(session.type, open.form, kind, body, endedBy);
  if (message !== null && !noCallWaits) {
    holdAnswersUntil(
      session,
      sendAheadOfAnswers(session, message).then((isQueued) => {
        end.messagePosted = isQueued;
        wakeWaiters(open);
      }),
    );
  } else {
    wakeWaiters(open);
  }
  if (noCallWaits && madeUnderCurrentHost && endedBy === 'user') {
    session.wake.formFinishedUnheard(
      session.sessionId,
      formFinishedUnheardText(session.type, open.form, kind),
    );
  }
}

function formListener<Form, Body, Payload>(
  session: SessionContext<Form, Body, Payload>,
  open: OpenForm<Form, Body>,
): AgentFormListener<Body> {
  return {
    draft: (body) => {
      if (open.end !== null || open.closed) {
        return Promise.resolve();
      }
      open.latestBody = session.type.readBody(open.form, body);
      // Rejects when the disk write fails, so the page shows the draft
      // unsaved; the reply still carries it.
      return session.store.saveBody(open.record, open.latestBody);
    },
    finish: (end) => {
      if (open.end !== null || open.closed) {
        return;
      }
      endForm(
        session,
        open,
        end.kind,
        session.type.readBody(open.form, end.body),
        'user',
      );
    },
    cancel: () => {
      if (open.end !== null || open.closed) {
        return;
      }
      endForm(session, open, 'cancelled', open.latestBody, 'sessionClose');
    },
  };
}

// Shows the form of `record` in the window with `draft`, as the session's.
function showForm<Form, Body, Payload>(
  session: SessionContext<Form, Body, Payload>,
  form: Form,
  record: SavedAgentForm,
  draft: Body | null,
): OpenForm<Form, Body> {
  const { type } = session;
  const open: OpenForm<Form, Body> = {
    form,
    record,
    latestBody: draft ?? type.readBody(form, {}),
    end: null,
    closed: false,
    waiters: new Set(),
    callers: 0,
  };
  session.shownIds.add(record.id);
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

function openNewForm<Form, Body, Payload>(
  session: SessionContext<Form, Body, Payload>,
  form: Form,
  formFingerprint: string,
  args: unknown,
  toolUseId: string | null,
): OpenForm<Form, Body> {
  const draft = prefillDraft(
    session.type,
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
  return showForm(session, form, record, draft);
}

function isOpenInLiveSession<Form, Body, Payload>(
  session: SessionContext<Form, Body, Payload>,
  formId: string,
): boolean {
  return [...session.liveSessions].some(
    (live) => live.open?.record.id === formId,
  );
}

// The session's newest saved form, shown again with its saved answers, when an
// earlier connection left it with no answer and no live session holds it: what
// an app quit leaves for the collect the relay sends again. Throws when that
// form no longer parses.
function reopenFormLeftOpen<Form, Body, Payload>(
  session: SessionContext<Form, Body, Payload>,
): OpenForm<Form, Body> | null {
  const record = session.store.newestOwned(session.info);
  const isLeftOpenEarlier =
    record !== null &&
    record.outcome === 'open' &&
    !session.shownIds.has(record.id) &&
    !session.reportedUnreadable.has(record.id) &&
    !isOpenInLiveSession(session, record.id);
  if (!isLeftOpenEarlier) {
    return null;
  }
  const form = formFromRecord(session, record);
  return showForm(
    session,
    form,
    record,
    session.type.readBody(form, record.body),
  );
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

// Rejects a queued call made under a host id the session has since left, so
// the old conversation's form never opens, or reads a form, under the new id.
function requireCallerHostId<Form, Body, Payload>(
  session: SessionContext<Form, Body, Payload>,
  callerHostId: string | null,
): void {
  if (session.info.sessionId !== callerHostId) {
    throw new Error(
      `The session moved to a new host id before this ${session.type.openTool} ran.`,
    );
  }
}

// The answers of a finished form no reply has carried, which win over the
// call's own form: as its answers when it is the call's form, or else handed
// back so the agent sends its form again.
function unreturnedFinishedPayload<Form, Body, Payload>(
  session: SessionContext<Form, Body, Payload>,
  formFingerprint: string,
): Payload | null {
  const handed = takeUnreturnedFinished(session);
  if (handed === null) {
    return null;
  }
  if (handed.fingerprint === formFingerprint) {
    return finishedPayload(session.type, handed);
  }
  handed.handedBack = true;
  return handedBackFinishedPayload(session.type, handed);
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
    return presentOpen(
      session,
      open,
      sessionDeadlineSeconds(session),
      signal,
      host,
    );
  }
  const last = session.lastFinished;
  // A cancelled form the agent already received opens again, pre-filled, as
  // does an auto-answered one once the auto-answer is off.
  if (
    open === null &&
    last !== null &&
    isUserSubmitted(last, formFingerprint)
  ) {
    return finishedPayload(session.type, last);
  }
  const unreturned = unreturnedFinishedPayload(session, formFingerprint);
  if (unreturned !== null) {
    return unreturned;
  }
  // One open form per session: an unfinished form is never replaced.
  const unfinished = session.open;
  if (unfinished !== null) {
    return formNotShownPayload(session.type, form, unfinished.form);
  }
  session.lastFinished = null;
  const opened = openNewForm(session, form, formFingerprint, args, toolUseId);
  session.open = opened;
  return presentOpen(
    session,
    opened,
    sessionDeadlineSeconds(session),
    signal,
    host,
  );
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
    await waitForEndOrDeadline(
      session.timers,
      other,
      sessionDeadlineSeconds(session),
      signal,
    );
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
  callerHostId: string | null,
  signal: AbortSignal,
): Promise<Payload> {
  const deadline = new AbortController();
  const timer = session.timers.set(
    () => deadline.abort(),
    sessionDeadlineSeconds(session) * 1000,
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
    requireCallerHostId(session, callerHostId);
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
    session.timers.clear(timer);
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
  const callerHostId = session.info.sessionId;
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
    callerHostId,
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
    const seconds = wait ? sessionDeadlineSeconds(session) : 0;
    return presentOpen(session, open, seconds, signal);
  }
  const last = session.lastFinished;
  if (last !== null) {
    return lastFinishedPayload(session, last);
  }
  const handed = takeUnreturnedFinished(session);
  if (handed !== null) {
    return finishedPayload(session.type, handed);
  }
  const reopened = reopenFormLeftOpen(session);
  if (reopened === null) {
    return session.type.noFormPayload();
  }
  session.open = reopened;
  return presentOpen(
    session,
    reopened,
    wait ? sessionDeadlineSeconds(session) : 0,
    signal,
  );
}

// Answers the call's form with `autoAnswer` at once, outside the call queue,
// after the checks every call runs: the args, a live caller, and the host id
// the session's forms were made under. Answers the user gave come first: a
// re-send of the form still unfinished in the window takes the normal path
// and waits on it, a finished form no reply has carried is returned as the
// normal path returns it, and a re-send of the form the user last submitted
// gets those answers again. A form open in the window stays, unless the host
// moved. A re-send of the form last auto-answered returns its answers again;
// any other form, a re-send of one the user cancelled included, is saved
// answered and returned, and shows nowhere.
async function autoAnswerForm<Form, Body, Payload>(
  session: SessionContext<Form, Body, Payload>,
  autoAnswer: AgentFormAutoAnswer<Form, Body, Payload>,
  args: unknown,
  toolUseId: string | null,
  signal: AbortSignal,
): Promise<Payload> {
  const form = session.type.parse(args);
  const formFingerprint = session.type.fingerprint(form);
  requireLiveCaller(session, signal);
  leaveFormsOfPastHost(session);
  const open = session.open;
  const resendsUnfinishedOpen =
    open !== null &&
    open.end === null &&
    open.record.fingerprint === formFingerprint;
  if (resendsUnfinishedOpen) {
    return openFormInTurn(session, args, toolUseId, signal);
  }
  const unreturned = unreturnedFinishedPayload(session, formFingerprint);
  if (unreturned !== null) {
    return unreturned;
  }
  const last = session.lastFinished;
  if (last !== null && isUserSubmitted(last, formFingerprint)) {
    return finishedPayload(session.type, last);
  }
  const replaysLastAutoAnswered =
    last !== null && last.autoAnswered && last.fingerprint === formFingerprint;
  if (replaysLastAutoAnswered) {
    return autoAnswer.payload(last.form, last.body);
  }
  const body = autoAnswer.body(form);
  session.store.createAutoAnswered(
    session.info,
    formFingerprint,
    args,
    body,
    toolUseId,
  );
  session.lastFinished = {
    form,
    outcome: 'submitted',
    body,
    messagePosted: false,
    fingerprint: formFingerprint,
    handedBack: false,
    autoAnswered: true,
  };
  return autoAnswer.payload(form, body);
}

// `call`'s answer, started and returned only while no message a submit sends
// ahead of the answers is on its way.
// With none on its way, `call` starts at once.
async function afterHeldAnswers<Form, Body, Payload>(
  session: SessionContext<Form, Body, Payload>,
  call: () => Promise<Payload>,
): Promise<Payload> {
  const held = session.answersHeld;
  const payload = await (held === null ? call() : held.then(call));
  await session.answersHeld;
  return payload;
}

// After a detach the open form stays as it is, in the window and on disk.
function endSession<Form, Body, Payload>(
  session: SessionContext<Form, Body, Payload>,
): void {
  session.ended = true;
  session.liveSessions.delete(session);
  if (!session.detach.detached) {
    closeOpenForm(session);
  }
}

// The call's answer, or none at all once the service detached: a call made
// after the detach never runs, and one settling after it never settles.
function answerUnlessDetached<Payload>(
  detach: DetachState,
  run: () => Promise<Payload>,
): Promise<Payload> {
  if (detach.detached) {
    return new Promise(() => {});
  }
  const call = run();
  return new Promise((resolve, reject) => {
    call.then(
      (payload) => {
        if (!detach.detached) {
          resolve(payload);
        }
      },
      (error: unknown) => {
        if (!detach.detached) {
          reject(error);
        }
      },
    );
  });
}

function startSession<Form, Body, Payload>(
  owner: AgentFormOwner,
  deps: AgentFormServiceDeps<Form, Body, Payload>,
  detach: DetachState,
  liveSessions: Set<SessionContext<Form, Body, Payload>>,
): AgentFormSession<Payload> {
  const { info } = owner;
  const session: SessionContext<Form, Body, Payload> = {
    sessionId: owner.id,
    info,
    formsHostId: info.sessionId,
    defaultDeadlineSeconds: () => deps.defaultDeadlineSeconds(),
    type: deps.type,
    presenter: deps.presenter,
    store: deps.store,
    wake: deps.wake,
    timers: deps.timers,
    autoAnswer: deps.autoAnswer ?? null,
    open: null,
    lastFinished: null,
    askTurn: null,
    answersHeld: null,
    ended: false,
    reportedUnreadable: new Set(),
    shownIds: new Set(),
    detach,
    liveSessions,
  };
  liveSessions.add(session);
  return {
    open: (args, toolUseId, signal) =>
      answerUnlessDetached(detach, () => {
        const { autoAnswer } = session;
        return afterHeldAnswers(session, () =>
          autoAnswer?.isOn(session.sessionId)
            ? autoAnswerForm(session, autoAnswer, args, toolUseId, signal)
            : openFormInTurn(session, args, toolUseId, signal),
        );
      }),
    collect: (wait, signal) =>
      answerUnlessDetached(detach, () =>
        afterHeldAnswers(session, () => collectLastForm(session, wait, signal)),
      ),
    end: () => endSession(session),
  };
}

// Form logic every form source reaches, for one form type: validation,
// re-send, replay, hand-back, pre-fill, the soft deadline, the saved forms,
// the wake for a form no call will return, the type's submit message sent
// ahead of the answers, the optional auto-answer, and the detach at an app
// quit.
export function createAgentFormService<Form, Body, Payload>(
  deps: AgentFormServiceDeps<Form, Body, Payload>,
): AgentFormService<Payload> {
  const detach: DetachState = { detached: false };
  const liveSessions = new Set<SessionContext<Form, Body, Payload>>();
  return {
    startSession: (owner) => startSession(owner, deps, detach, liveSessions),
    detach: () => {
      detach.detached = true;
    },
  };
}

// `service` whose sessions' `open` and `collect` run once `loaded` settles;
// `end` and `detach` run at once.
export function afterLoad<Payload>(
  loaded: Promise<void>,
  service: AgentFormService<Payload>,
): AgentFormService<Payload> {
  return {
    startSession: (owner) => {
      const session = service.startSession(owner);
      return {
        open: (args, toolUseId, signal) =>
          loaded.then(() => session.open(args, toolUseId, signal)),
        collect: (wait, signal) =>
          loaded.then(() => session.collect(wait, signal)),
        end: () => session.end(),
      };
    },
    detach: () => service.detach(),
  };
}
