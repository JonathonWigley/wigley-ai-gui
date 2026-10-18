import path from 'node:path';
import type {
  AnswersPayload,
  FormBody,
  FormsService,
  FormsSession,
  Round,
  RoundListener,
  RoundPresenter,
  SessionInfo,
} from '../../contracts/forms';
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
  // Left the window: the user finished it, a new round replaced it, or its
  // session ended.
  closed: boolean;
  // One per call waiting on this round, woken when it ends or closes.
  waiters: Set<() => void>;
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

// A queued round whose deadline passed while another round was still open,
// and that round.
interface RefusedRound {
  fingerprint: string;
  blocker: OpenRound;
}

// One connected session: at most one open round, and the last finished one.
interface SessionContext {
  info: SessionInfo;
  deadlineSeconds: number;
  presenter: RoundPresenter;
  store: RoundStore;
  open: OpenRound | null;
  lastFinished: FinishedRound | null;
  // Settles once every ask_round already called has returned; null when none
  // is pending.
  askTurn: Promise<void> | null;
  // The last round refused with a not-shown draft; null once its blocker
  // leaves the window or finishes.
  refused: RefusedRound | null;
  // The relay disconnected; no call opens a round after this.
  ended: boolean;
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
  return {
    ...body,
    answers: body.answers.map((answer) => ({
      ...answer,
      dont_ask: false,
      dont_ask_reason: '',
    })),
  };
}

function finishedPayload(finished: FinishedRound): AnswersPayload {
  return answersPayload(finished.round, finished.outcome, finished.body);
}

function handedBackFinishedPayload(finished: FinishedRound): AnswersPayload {
  return handedBackPayload(finished.round, finished.outcome, finished.body);
}

function roundFromRecord(record: SavedRound): Round | null {
  try {
    return parseRound(record.args);
  } catch (error) {
    if (error instanceof RoundError) {
      return null;
    }
    throw error;
  }
}

function closeInWindow(open: OpenRound, presenter: RoundPresenter): void {
  open.closed = true;
  presenter.close(open.record.id);
}

function wakeWaiters(open: OpenRound): void {
  for (const wake of [...open.waiters]) {
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

// A deadline running out is a draft, never a failure: the round stays open
// for collect_last_round.
async function presentOpen(
  session: SessionContext,
  open: OpenRound,
  seconds: number,
  signal: AbortSignal,
): Promise<AnswersPayload> {
  const mustWait =
    open.end === null && !open.closed && seconds > 0 && !signal.aborted;
  if (mustWait) {
    await waitForEndOrDeadline(open, seconds, signal);
  }
  return openRoundPayload(session, open);
}

// A finished round whose answers no tool reply has carried: the open round,
// when the user finished it after its last reply, or else the newest such
// file this session left on disk before an app restart.
function takeUnreturnedFinished(session: SessionContext): FinishedRound | null {
  const open = session.open;
  if (open !== null) {
    return open.end === null ? null : settle(session, open, open.end);
  }
  const record = session.store.newestUnreturnedFinished(session.info);
  if (record === null) {
    return null;
  }
  session.store.markReturned(record);
  const round = roundFromRecord(record);
  if (round === null) {
    return null;
  }
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
  };
  session.presenter.show(
    {
      roundId: record.id,
      label: roundLabel(session.info.projectDir, round.heading),
      round,
      draft,
    },
    roundListener(session, open),
  );
  return open;
}

// The draft a queued call returns when its deadline passes while another round
// is still open: its own round was never shown, so its answers are blank.
function roundNotShownPayload(round: Round): AnswersPayload {
  const payload = answersPayload(round, 'draft', readFormBody(round, {}));
  payload.summary =
    `This round, '${round.heading}', was not shown: another round is still ` +
    `open in the app.`;
  payload.next =
    `The user is still answering another round in the app, so this round ` +
    `was not opened and has no answers. Send this round again with ` +
    `ask_round, and again after every draft like this one: it opens once the ` +
    `user finishes the other round. Do not call collect_last_round for it: ` +
    `that returns the other round's answers.`;
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

async function askParsedRound(
  session: SessionContext,
  round: Round,
  roundFingerprint: string,
  args: unknown,
  toolUseId: string | null,
  signal: AbortSignal,
): Promise<AnswersPayload> {
  requireLiveCaller(session, signal);
  const open = session.open;
  if (open !== null && open.record.fingerprint === roundFingerprint) {
    return presentOpen(session, open, session.deadlineSeconds, signal);
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
  closeOpenRound(session);
  session.lastFinished = null;
  session.refused = null;
  const opened = openNewRound(
    session,
    round,
    roundFingerprint,
    args,
    toolUseId,
  );
  session.open = opened;
  return presentOpen(session, opened, session.deadlineSeconds, signal);
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

// True when this round was refused with a not-shown draft and the round that
// blocked it is still open and unfinished; forgets a refusal whose blocker
// finished.
function refusedRoundStillBlocked(
  session: SessionContext,
  roundFingerprint: string,
): boolean {
  const refused = session.refused;
  if (refused === null) {
    return false;
  }
  const blocker = refused.blocker;
  const blockerStillOpen = session.open === blocker && blocker.end === null;
  if (!blockerStillOpen) {
    session.refused = null;
    return false;
  }
  return refused.fingerprint === roundFingerprint;
}

// A queued call opens its round only once the round the user is answering has
// finished. Its own deadline bounds the whole call: passing before its round
// opens returns a draft, leaves the open round be, and records the refusal.
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
  try {
    await waitForOtherRoundToFinish(
      session,
      earlier,
      roundFingerprint,
      callSignal,
    );
    const deadlinePassed =
      deadline.signal.aborted && !signal.aborted && !session.ended;
    if (deadlinePassed) {
      const blocker = otherUnfinishedRound(session, roundFingerprint);
      session.refused =
        blocker === null ? null : { fingerprint: roundFingerprint, blocker };
      return roundNotShownPayload(round);
    }
    return await askParsedRound(
      session,
      round,
      roundFingerprint,
      args,
      toolUseId,
      callSignal,
    );
  } finally {
    clearTimeout(timer);
  }
}

// Queues a call made while another is pending, or a re-send of a round refused
// while the round that blocked it is still unfinished; any other call runs at
// once, and a new round closes an open draft.
async function askRoundQueuedOrNow(
  session: SessionContext,
  earlier: Promise<void> | null,
  args: unknown,
  toolUseId: string | null,
  signal: AbortSignal,
): Promise<AnswersPayload> {
  const round = parseRound(args);
  const roundFingerprint = fingerprint(round);
  const resendsRefusedRound = refusedRoundStillBlocked(
    session,
    roundFingerprint,
  );
  if (earlier === null && !resendsRefusedRound) {
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

// Each call is the turn the next call queues behind until it returns.
function askRoundInTurn(
  session: SessionContext,
  args: unknown,
  toolUseId: string | null,
  signal: AbortSignal,
): Promise<AnswersPayload> {
  const asking = askRoundQueuedOrNow(
    session,
    session.askTurn,
    args,
    toolUseId,
    signal,
  );
  const endTurn = () => {
    if (session.askTurn === turn) {
      session.askTurn = null;
    }
  };
  const turn = asking.then(endTurn, endTurn);
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

function startSession(info: SessionInfo, deps: FormsServiceDeps): FormsSession {
  const session: SessionContext = {
    info,
    deadlineSeconds: deadlineSeconds(info, deps.defaultDeadlineSeconds),
    presenter: deps.presenter,
    store: deps.store,
    open: null,
    lastFinished: null,
    askTurn: null,
    refused: null,
    ended: false,
  };
  return {
    askRound: (args, toolUseId, signal) =>
      askRoundInTurn(session, args, toolUseId, signal),
    collectLastRound: (wait, signal) => collectLastRound(session, wait, signal),
    end: () => {
      session.ended = true;
      session.refused = null;
      closeOpenRound(session);
    },
  };
}

// Round logic every round source reaches: validation, re-send, replay,
// hand-back, pre-fill, the soft deadline and the saved rounds.
export function createFormsService(deps: FormsServiceDeps): FormsService {
  return { startSession: (info) => startSession(info, deps) };
}
