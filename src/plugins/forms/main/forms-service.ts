import path from 'node:path';
import type { AgentSession, SessionInfo } from '../../sessions/contract';
import type {
  AnswerableKind,
  AnswerEntry,
  AnswersPayload,
  FormBody,
  FormsService,
  FormsSession,
  Round,
  RoundListener,
  RoundPresenter,
} from '../contract';
import {
  answersPayload,
  type FinishedOutcome,
  fingerprint,
  handedBackPayload,
  noRoundPayload,
  parseRound,
  readFormBody,
} from './round';
import { RoundError } from './round-error';
import type { RoundStore, SavedRound } from './round-store';

export interface FormsServiceDeps {
  presenter: RoundPresenter;
  store: RoundStore;
  // The soft deadline when the host names none.
  defaultDeadlineSeconds: number;
}

interface RoundFinish {
  kind: FinishedOutcome;
  body: FormBody;
}

// A round shown in the window that no tool reply has settled yet.
interface OpenRound {
  round: Round;
  record: SavedRound;
  latestBody: FormBody;
  // The user's first submit or cancel; later ones are ignored.
  end: RoundFinish | null;
  // Left the window: the user finished it, its session ended, or the host
  // cancelled the last call waiting for its answers.
  closed: boolean;
  // One per call waiting on this round, woken when it ends or closes.
  waiters: Set<() => void>;
  // The calls waiting for this round's own answers: those waiting on it now,
  // and re-sends of it queued behind an earlier call. A call queued for
  // another round is not one.
  callers: number;
}

// The last round to finish, kept because the reply that carried its answers
// may never have reached the agent.
interface FinishedRound {
  round: Round;
  outcome: FinishedOutcome;
  body: FormBody;
  fingerprint: string;
  // An ask_round for another round returned it with `earlier_heading`, so a
  // replay keeps that framing.
  handedBack: boolean;
}

// One connected session: at most one open round, and the last finished one.
interface SessionContext {
  // The app's id for the session, which every round it shows carries.
  sessionId: string;
  info: SessionInfo;
  deadlineSeconds: number;
  presenter: RoundPresenter;
  store: RoundStore;
  open: OpenRound | null;
  lastFinished: FinishedRound | null;
  // Settles once every ask_round already called has returned; null when none
  // is pending.
  askTurn: Promise<void> | null;
  // The relay disconnected; no call opens a round after this.
  ended: boolean;
  // Ids of unreturned saved rounds that no longer parse, already reported to
  // a call.
  reportedUnreadable: Set<string>;
}

// setTimeout fires at once for a delay above a signed 32-bit millisecond count.
const MAX_TIMER_SECONDS = (2 ** 31 - 1) / 1000;

function deadlineSeconds(info: SessionInfo, defaultSeconds: number): number {
  const hostSeconds = info.deadlineSeconds;
  const hostNamedOne =
    hostSeconds !== null &&
    Number.isFinite(hostSeconds) &&
    hostSeconds > 0 &&
    hostSeconds <= MAX_TIMER_SECONDS;
  return hostNamedOne ? hostSeconds : defaultSeconds;
}

function roundLabel(projectDir: string | null, heading: string): string {
  return projectDir === null
    ? heading
    : `${path.basename(projectDir)} · ${heading}`;
}

function withoutDontAsk<Entry extends AnswerEntry>(answer: Entry): Entry {
  return { ...answer, dont_ask: false, dont_ask_reason: '' };
}

// Each answerable kind's answer list in a body, its Don't ask me this
// presses dropped and its entries keeping their own type.
const ANSWER_LISTS = {
  question: (body) => ({ answers: body.answers.map(withoutDontAsk) }),
  finding: (body) => ({
    finding_answers: body.finding_answers.map(withoutDontAsk),
  }),
} satisfies Record<AnswerableKind, (body: FormBody) => Partial<FormBody>>;

// A press belongs to the round it was made in, so a finished round's copy
// drops it; an open draft's copy keeps it, since retro reads finished rounds only.
function prefillDraft(round: Round, saved: SavedRound | null): FormBody | null {
  if (saved === null) {
    return null;
  }
  const body = readFormBody(round, saved.body);
  if (saved.outcome === 'open') {
    return body;
  }
  const stripped: FormBody = { ...body };
  for (const listWithoutDontAsk of Object.values(ANSWER_LISTS)) {
    Object.assign(stripped, listWithoutDontAsk(body));
  }
  return stripped;
}

function finishedPayload(finished: FinishedRound): AnswersPayload {
  return answersPayload(finished.round, finished.outcome, finished.body);
}

function handedBackFinishedPayload(finished: FinishedRound): AnswersPayload {
  return handedBackPayload(finished.round, finished.outcome, finished.body);
}

function savedHeading(args: unknown): string | null {
  const heading = (args as { heading?: unknown } | null)?.heading;
  return typeof heading === 'string' && heading.trim() !== '' ? heading : null;
}

function unreadableRoundError(record: SavedRound, cause: RoundError): Error {
  const heading = savedHeading(record.args);
  const named =
    heading === null ? 'A saved round' : `The saved round '${heading}'`;
  return new Error(
    `${named} (file ${record.id}.json) was finished but never returned, and ` +
      `its answers cannot be read: it was saved in a shape this app no longer ` +
      `accepts (${cause.message}). Its file is left as it was. Tell the user ` +
      `its answers were not returned. Later calls in this session pass over ` +
      `it, so send your round again with ask_round.`,
  );
}

// A saved round the current parser rejects stays unreturned on disk and is
// reported to the first call that meets it in this session; later calls pass
// over it, so it never blocks the session's rounds.
function roundFromRecord(session: SessionContext, record: SavedRound): Round {
  try {
    return parseRound(record.args);
  } catch (error) {
    if (error instanceof RoundError) {
      session.reportedUnreadable.add(record.id);
      throw unreadableRoundError(record, error);
    }
    throw error;
  }
}

function closeInWindow(open: OpenRound, presenter: RoundPresenter): void {
  open.closed = true;
  presenter.close(open.record.id);
}

function wakeWaiters(open: OpenRound): void {
  for (const wake of open.waiters) {
    wake();
  }
}

// The open round's answers reach a tool reply: keep them for replay and mark
// the file returned.
function settle(
  session: SessionContext,
  open: OpenRound,
  end: RoundFinish,
): FinishedRound {
  const finished: FinishedRound = {
    round: open.round,
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

function openRoundPayload(
  session: SessionContext,
  open: OpenRound,
): AnswersPayload {
  const end = open.end;
  if (end === null) {
    return answersPayload(open.round, 'draft', open.latestBody);
  }
  if (session.open === open) {
    settle(session, open, end);
  }
  return answersPayload(open.round, end.kind, end.body);
}

function waitForEndOrDeadline(
  open: OpenRound,
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

// No call is left to collect the round's answers: it leaves the window as on
// a disconnect, its file still open, so a re-send opens it pre-filled. A round
// the user already finished stays for the next call to collect.
function abandonRound(session: SessionContext, open: OpenRound): void {
  const isUnfinishedOpenRound = session.open === open && open.end === null;
  if (isUnfinishedOpenRound) {
    closeOpenRound(session);
  }
}

// A call stops waiting on the open round: the host cancelling the last one
// abandons the round, so the session's next round shows.
function releaseCaller(
  session: SessionContext,
  open: OpenRound,
  host: AbortSignal,
): void {
  open.callers -= 1;
  if (host.aborted && open.callers === 0) {
    abandonRound(session, open);
  }
}

// A deadline running out is a draft, never a failure: the round stays open
// for collect_last_round. `signal` wakes the wait early; `host` is the
// caller's own signal, which a queued call's deadline leaves alone.
async function presentOpen(
  session: SessionContext,
  open: OpenRound,
  seconds: number,
  signal: AbortSignal,
  host: AbortSignal = signal,
): Promise<AnswersPayload> {
  const mustWait =
    open.end === null && !open.closed && seconds > 0 && !signal.aborted;
  if (!mustWait) {
    return openRoundPayload(session, open);
  }
  open.callers += 1;
  await waitForEndOrDeadline(open, seconds, signal);
  const payload = openRoundPayload(session, open);
  releaseCaller(session, open, host);
  return payload;
}

// A finished round whose answers no tool reply has carried: the open round,
// when the user finished it after its last reply, or else the newest such
// file this session left on disk before an app restart, passing over the
// files already reported unreadable. Throws when that file no longer parses.
function takeUnreturnedFinished(session: SessionContext): FinishedRound | null {
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
  const round = roundFromRecord(session, record);
  session.store.markReturned(record);
  session.lastFinished = {
    round,
    outcome: record.outcome,
    body: readFormBody(round, record.body),
    fingerprint: record.fingerprint,
    handedBack: false,
  };
  return session.lastFinished;
}

function closeOpenRound(session: SessionContext): void {
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

function roundListener(
  session: SessionContext,
  open: OpenRound,
): RoundListener {
  return {
    draft: (body) => {
      if (open.end !== null || open.closed) {
        return;
      }
      open.latestBody = readFormBody(open.round, body);
      // Throws when the disk write fails, so the page shows the draft unsaved.
      session.store.saveBody(open.record, open.latestBody);
    },
    // The store logs a failed finish write rather than throwing, so the
    // answers still reach the waiting calls.
    finish: (end) => {
      if (open.end !== null || open.closed) {
        return;
      }
      const body = readFormBody(open.round, end.body);
      open.end = { kind: end.kind, body };
      open.latestBody = body;
      session.store.finish(open.record, end.kind, body);
      closeInWindow(open, session.presenter);
      wakeWaiters(open);
    },
  };
}

function openNewRound(
  session: SessionContext,
  round: Round,
  roundFingerprint: string,
  args: unknown,
  toolUseId: string | null,
): OpenRound {
  const draft = prefillDraft(round, session.store.newestFor(roundFingerprint));
  const record = session.store.create(
    session.info,
    roundFingerprint,
    args,
    draft,
    toolUseId,
  );
  const open: OpenRound = {
    round,
    record,
    latestBody: draft ?? readFormBody(round, {}),
    end: null,
    closed: false,
    waiters: new Set(),
    callers: 0,
  };
  session.presenter.show(
    {
      roundId: record.id,
      sessionId: session.sessionId,
      label: roundLabel(session.info.projectDir, round.heading),
      round,
      draft,
    },
    roundListener(session, open),
  );
  return open;
}

// The draft a call returns when its round was never shown, so its answers are
// blank; it names the blocking round, when one is open, for the agent to point
// the user at.
function roundNotShownPayload(
  round: Round,
  blocking: Round | null,
): AnswersPayload {
  const other =
    blocking === null ? 'another round' : `the round '${blocking.heading}'`;
  const payload = answersPayload(round, 'draft', readFormBody(round, {}));
  payload.summary =
    `This round, '${round.heading}', was not shown: ${other} is still open ` +
    `in the app.`;
  payload.next =
    `The user has not finished ${other} in the app, so this round was not ` +
    `opened and has no answers. Send this round again with ask_round, and ` +
    `again after every draft like this one. Once the user finishes ${other}, ` +
    `a send may return that round's answers instead, marked with ` +
    `earlier_heading: act on them, then send this round again. If ${other} ` +
    `is no longer needed, ask the user to cancel it in the app. Do not call ` +
    `collect_last_round for this round: that returns the other round's ` +
    `answers.`;
  return payload;
}

// Rejects a call whose caller is gone, so its round never opens in the window
// with no one to answer it.
function requireLiveCaller(session: SessionContext, signal: AbortSignal): void {
  if (session.ended) {
    throw new Error('The session ended before this ask_round ran.');
  }
  if (signal.aborted) {
    throw new Error('ask_round was cancelled before it ran.');
  }
}

// `signal` wakes the call's wait early; `host` is the caller's own signal,
// whose abort may abandon the round.
async function askParsedRound(
  session: SessionContext,
  round: Round,
  roundFingerprint: string,
  args: unknown,
  toolUseId: string | null,
  signal: AbortSignal,
  host: AbortSignal = signal,
): Promise<AnswersPayload> {
  requireLiveCaller(session, signal);
  const open = session.open;
  if (open !== null && open.record.fingerprint === roundFingerprint) {
    return presentOpen(session, open, session.deadlineSeconds, signal, host);
  }
  const last = session.lastFinished;
  // A cancelled round the agent already received opens again, pre-filled.
  const replaysLastSubmitted =
    open === null &&
    last !== null &&
    last.fingerprint === roundFingerprint &&
    last.outcome === 'submitted';
  if (replaysLastSubmitted) {
    return finishedPayload(last);
  }
  const handed = takeUnreturnedFinished(session);
  if (handed !== null) {
    if (handed.fingerprint === roundFingerprint) {
      return finishedPayload(handed);
    }
    handed.handedBack = true;
    return handedBackFinishedPayload(handed);
  }
  // One open round per session: an unfinished round is never replaced.
  const unfinished = session.open;
  if (unfinished !== null) {
    return roundNotShownPayload(round, unfinished.round);
  }
  session.lastFinished = null;
  const opened = openNewRound(
    session,
    round,
    roundFingerprint,
    args,
    toolUseId,
  );
  session.open = opened;
  return presentOpen(session, opened, session.deadlineSeconds, signal, host);
}

// The round the user is still answering, when it is not this call's own round.
function otherUnfinishedRound(
  session: SessionContext,
  roundFingerprint: string,
): OpenRound | null {
  const open = session.open;
  const blocks =
    open !== null &&
    open.end === null &&
    open.record.fingerprint !== roundFingerprint;
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

// Waits for the earlier calls to return, then for any other round still open
// to finish: the user's submit or cancel, or the session ending.
async function waitForOtherRoundToFinish(
  session: SessionContext,
  earlier: Promise<void>,
  roundFingerprint: string,
  signal: AbortSignal,
): Promise<void> {
  await settledOrAborted(earlier, signal);
  let other = otherUnfinishedRound(session, roundFingerprint);
  while (other !== null && !signal.aborted && !session.ended) {
    await waitForEndOrDeadline(other, session.deadlineSeconds, signal);
    other = otherUnfinishedRound(session, roundFingerprint);
  }
}

// A queued call whose deadline passed before it ran: the open round's answers
// so far when that round is its own, or else a not-shown draft naming the open
// round. Neither waits again.
function queuedDeadlinePayload(
  session: SessionContext,
  round: Round,
  roundFingerprint: string,
): AnswersPayload {
  const open = session.open;
  if (open !== null && open.record.fingerprint === roundFingerprint) {
    return openRoundPayload(session, open);
  }
  return roundNotShownPayload(round, open?.round ?? null);
}

// Opens this call's round only once every earlier call has returned and the
// round the user is answering has finished. Its own deadline bounds the whole
// call: passing first returns without opening a round and leaves the open
// round be. A re-send of the open round waits on that round while queued, so
// the host cancelling the call ahead of it leaves the round open.
async function askRoundWhenFree(
  session: SessionContext,
  earlier: Promise<void>,
  round: Round,
  roundFingerprint: string,
  args: unknown,
  toolUseId: string | null,
  signal: AbortSignal,
): Promise<AnswersPayload> {
  const deadline = new AbortController();
  const timer = setTimeout(
    () => deadline.abort(),
    session.deadlineSeconds * 1000,
  );
  const callSignal = AbortSignal.any([signal, deadline.signal]);
  const resentOpen =
    session.open?.record.fingerprint === roundFingerprint ? session.open : null;
  if (resentOpen !== null) {
    resentOpen.callers += 1;
  }
  try {
    await waitForOtherRoundToFinish(
      session,
      earlier,
      roundFingerprint,
      callSignal,
    );
    if (resentOpen !== null) {
      releaseCaller(session, resentOpen, signal);
    }
    const deadlinePassed =
      deadline.signal.aborted && !signal.aborted && !session.ended;
    if (deadlinePassed) {
      return queuedDeadlinePayload(session, round, roundFingerprint);
    }
    return await askParsedRound(
      session,
      round,
      roundFingerprint,
      args,
      toolUseId,
      callSignal,
      signal,
    );
  } finally {
    clearTimeout(timer);
  }
}

// Runs a call at once only when no earlier call is pending and no other round
// is unfinished; any other call waits for both, so a new round never replaces
// a round the user has not submitted or cancelled.
async function askRoundQueuedOrNow(
  session: SessionContext,
  earlier: Promise<void> | null,
  args: unknown,
  toolUseId: string | null,
  signal: AbortSignal,
): Promise<AnswersPayload> {
  const round = parseRound(args);
  const roundFingerprint = fingerprint(round);
  const runsNow =
    earlier === null &&
    otherUnfinishedRound(session, roundFingerprint) === null;
  if (runsNow) {
    return askParsedRound(
      session,
      round,
      roundFingerprint,
      args,
      toolUseId,
      signal,
    );
  }
  return askRoundWhenFree(
    session,
    earlier ?? Promise.resolve(),
    round,
    roundFingerprint,
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
function askRoundInTurn(
  session: SessionContext,
  args: unknown,
  toolUseId: string | null,
  signal: AbortSignal,
): Promise<AnswersPayload> {
  const earlier = session.askTurn;
  const asking = askRoundQueuedOrNow(session, earlier, args, toolUseId, signal);
  const endTurn = () => {
    if (session.askTurn === turn) {
      session.askTurn = null;
    }
  };
  const turn = endOnceBothSettle(earlier, asking, endTurn);
  session.askTurn = turn;
  return asking;
}

async function collectLastRound(
  session: SessionContext,
  wait: boolean,
  signal: AbortSignal,
): Promise<AnswersPayload> {
  const open = session.open;
  if (open !== null) {
    const seconds = wait ? session.deadlineSeconds : 0;
    return presentOpen(session, open, seconds, signal);
  }
  const last = session.lastFinished;
  if (last !== null) {
    return last.handedBack
      ? handedBackFinishedPayload(last)
      : finishedPayload(last);
  }
  const handed = takeUnreturnedFinished(session);
  return handed === null ? noRoundPayload() : finishedPayload(handed);
}

function startSession(
  agentSession: AgentSession,
  deps: FormsServiceDeps,
): FormsSession {
  const { info } = agentSession;
  const session: SessionContext = {
    sessionId: agentSession.id,
    info,
    deadlineSeconds: deadlineSeconds(info, deps.defaultDeadlineSeconds),
    presenter: deps.presenter,
    store: deps.store,
    open: null,
    lastFinished: null,
    askTurn: null,
    ended: false,
    reportedUnreadable: new Set(),
  };
  return {
    askRound: (args, toolUseId, signal) =>
      askRoundInTurn(session, args, toolUseId, signal),
    collectLastRound: (wait, signal) => collectLastRound(session, wait, signal),
    end: () => {
      session.ended = true;
      closeOpenRound(session);
    },
  };
}

// Round logic every round source reaches: validation, re-send, replay,
// hand-back, pre-fill, the soft deadline and the saved rounds.
export function createFormsService(deps: FormsServiceDeps): FormsService {
  return { startSession: (session) => startSession(session, deps) };
}
