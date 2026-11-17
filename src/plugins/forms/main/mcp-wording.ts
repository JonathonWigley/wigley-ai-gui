import type {
  AnswerableKind,
  AnswerResult,
  AnswersPayload,
  AnswerStatus,
} from '../contract';
import { ANSWERABLE_KINDS, FORMATS } from './kinds/formats';
import type { RoundReason, RoundResult } from './round';
import type { RoundError, RoundErrorPath } from './round-error';
import { capitalised } from '../../../shared/capitalised';

// The round's MCP wording: its tool names, the text of a malformed call, and
// the payload an agent reads for each round result.

export const ROUND_OPEN_TOOL = 'ask_round';
export const ROUND_COLLECT_TOOL = 'collect_last_round';

const NEXT_ON_DRAFT =
  `The user has not submitted yet. Call ${ROUND_COLLECT_TOOL} to keep ` +
  'waiting. Do not re-ask these questions and do not open a second round.';

const NEXT_ON_AUTO_ANSWERED =
  'This session is headless until a tool result says the session is no ' +
  'longer headless: the app showed no form and answered every item with its ' +
  'recommendation. Build no more rounds, and list every pick as a Decided ' +
  'notice in your reply. An auto-answered pick never approves a hard-gated ' +
  'action (third-party code, destroying user state, a push): name what the ' +
  'gate needs in the reply and end the turn.';

const NEXT_ON_NO_ROUND =
  'No round is open for this session, and no finished answers are waiting ' +
  'for it. If you sent a round whose answers you never received, send the ' +
  `same round again with ${ROUND_OPEN_TOOL}: the user's saved answers fill ` +
  'in. Do not move the questions into the reply.';

// What comes before an error's problem: the call, the round's field, or the
// item. The heading's message has no prefix.
function errorPrefix(path: RoundErrorPath): string {
  switch (path.at) {
    case 'call':
      return `${ROUND_OPEN_TOOL} `;
    case 'field':
      return path.field === 'heading' ? '' : `${ROUND_OPEN_TOOL}'s `;
    case 'item':
      return `${capitalised(FORMATS[path.kind].noun)} ${path.number}: `;
  }
}

// The tool error text of a malformed round call.
export function roundErrorText(error: RoundError): string {
  const text =
    error.detail === '' ? error.problem : `${error.problem} ${error.detail}`;
  return `${errorPrefix(error.path)}${text}`;
}

function countOf(n: number, noun: string): string {
  return `${n} ${noun}${n !== 1 ? 's' : ''}`;
}

// Counted from the same statuses the answers carry, so the two never disagree.
function summarise(
  results: Record<AnswerableKind, AnswerResult[]>,
  stillOpen: boolean,
): string {
  const counted = ANSWERABLE_KINDS.filter((kind) => results[kind].length > 0);
  const parts = counted.map((kind) =>
    countOf(results[kind].length, FORMATS[kind].noun),
  );
  const items =
    parts.length > 0 ? parts.join(', ') : countOf(0, FORMATS.question.noun);
  const statuses = ANSWERABLE_KINDS.flatMap((kind) =>
    results[kind].map((result) => result.status),
  );
  const count = (status: AnswerStatus) =>
    statuses.filter((each) => each === status).length;
  const line =
    `${items}: ${count('answered')} answered, ` +
    `${count('not_applicable')} not applicable, ${count('untouched')} untouched.`;
  return stillOpen ? `${line} The form is still open.` : line;
}

// The round a notShown result waits behind, as its texts name it.
function blockingRound(blockingHeading: string | null): string {
  return blockingHeading === null
    ? 'another round'
    : `the round '${blockingHeading}'`;
}

function summaryOf(result: RoundResult): string {
  const { reason } = result;
  const counts = { finding: result.findings, question: result.answers };
  switch (reason.kind) {
    case 'stillOpen':
      return summarise(counts, true);
    case 'finished':
    case 'autoAnswered':
    case 'handedBack':
      return summarise(counts, false);
    case 'notShown':
      return (
        `This round, '${reason.heading}', was not shown: ` +
        `${blockingRound(reason.blockingHeading)} is still open in the app.`
      );
    case 'noRound':
      return 'No round is open.';
  }
}

function nextOf(reason: RoundReason): string {
  switch (reason.kind) {
    case 'finished':
      return '';
    case 'stillOpen':
      return NEXT_ON_DRAFT;
    case 'autoAnswered':
      return NEXT_ON_AUTO_ANSWERED;
    case 'handedBack':
      return (
        `These answers are for an earlier round, '${reason.heading}', that ` +
        `you never received. Read them as that round's answers. The round ` +
        `you just sent was not opened: send it again with ${ROUND_OPEN_TOOL}.`
      );
    case 'notShown': {
      const other = blockingRound(reason.blockingHeading);
      return (
        `The user has not finished ${other} in the app, so this round was ` +
        `not opened and has no answers. Send this round again with ` +
        `${ROUND_OPEN_TOOL}, and again after every draft like this one. ` +
        `Once the user finishes ${other}, a send may return that round's ` +
        `answers instead, marked with earlier_heading: act on them, then ` +
        `send this round again. If ${other} is no longer needed, ask the ` +
        `user to cancel it in the app. Do not call ${ROUND_COLLECT_TOOL} for ` +
        `this round: that returns the other round's answers.`
      );
    }
    case 'noRound':
      return NEXT_ON_NO_ROUND;
  }
}

// The tool result for a round result. Its keys keep this order, since the
// tool text is the payload's JSON: `note` only when the user wrote one,
// `earlier_heading` only on an earlier round's answers.
export function roundPayload(result: RoundResult): AnswersPayload {
  const payload: AnswersPayload = {
    outcome: result.outcome,
    summary: summaryOf(result),
    next: nextOf(result.reason),
    answers: result.answers,
    findings: result.findings,
    notices: result.notices,
  };
  if (result.note !== '') {
    payload.note = result.note;
  }
  if (result.reason.kind === 'handedBack') {
    payload.earlier_heading = result.reason.heading;
  }
  return payload;
}
