import type {
  AnswersPayload,
  AnswerStatus,
  MainItemKind,
  RoundError,
  RoundErrorPath,
} from '../contract';
import type { RoundReason, RoundResult } from './round';
import { capitalised } from '../../../shared/capitalised';
import { AUTO_ANSWER_GATE_CLAUSE } from '../../chat/contract';

// The round's MCP wording: its tool names, the text of a malformed call, and
// the payload an agent reads for each round result.

export const ROUND_OPEN_TOOL = 'ask_round';
export const ROUND_COLLECT_TOOL = 'collect_last_round';

const NEXT_ON_DRAFT =
  `The user has not submitted yet. Call ${ROUND_COLLECT_TOOL} to keep ` +
  'waiting. Do not re-ask these questions and do not open a second form.';

const NEXT_ON_AUTO_ANSWERED =
  'This session is headless until a tool result says the session is no ' +
  'longer headless: the app showed no form and answered every item with its ' +
  'recommendation. Build no more forms, and list every pick as a Decided ' +
  `notice in your reply. ${AUTO_ANSWER_GATE_CLAUSE}`;

const NEXT_ON_NO_ROUND =
  'No form is open for this session, and no finished answers are waiting ' +
  'for it. If you sent a form whose answers you never received, send the ' +
  `same form again with ${ROUND_OPEN_TOOL}: the user's saved answers fill ` +
  'in. Do not move the questions into the reply.';

// The noun the count names when no answerable kind has items.
const EMPTY_COUNT_NOUN = 'question';

// The item's noun, capitalised; the kind id itself when no registered kind
// has it.
function itemName(kinds: readonly MainItemKind[], id: string): string {
  const kind = kinds.find((each) => each.spec.id === id);
  return kind === undefined ? id : capitalised(kind.noun);
}

// What comes before an error's problem: the call, the round's field, or the
// item. The heading's message has no prefix.
function errorPrefix(
  kinds: readonly MainItemKind[],
  path: RoundErrorPath,
): string {
  switch (path.at) {
    case 'call':
      return `${ROUND_OPEN_TOOL} `;
    case 'field':
      return path.field === 'heading' ? '' : `${ROUND_OPEN_TOOL}'s `;
    case 'item':
      return `${itemName(kinds, path.kind)} ${path.number}: `;
  }
}

// The tool error text of a malformed round call.
export function roundErrorText(
  kinds: readonly MainItemKind[],
  error: RoundError,
): string {
  const text =
    error.detail === '' ? error.problem : `${error.problem} ${error.detail}`;
  return `${errorPrefix(kinds, error.path)}${text}`;
}

function countOf(n: number, noun: string): string {
  return `${n} ${noun}${n !== 1 ? 's' : ''}`;
}

// The kind's results' statuses; a kind with no `status` takes no answer.
function statusesOf(
  kind: MainItemKind,
  results: readonly unknown[],
): AnswerStatus[] {
  const { status } = kind;
  return status === undefined ? [] : results.map((result) => status(result));
}

// Counted from the same statuses the answers carry, so the two never
// disagree; the answerable kinds count in registration order.
function summarise(
  kinds: readonly MainItemKind[],
  result: RoundResult,
  stillOpen: boolean,
): string {
  const answerable = kinds
    .filter((kind) => kind.spec.answerable)
    .map((kind) => ({ kind, results: result.results[kind.spec.id] ?? [] }));
  const parts = answerable
    .filter(({ results }) => results.length > 0)
    .map(({ kind, results }) => countOf(results.length, kind.noun));
  const items =
    parts.length > 0 ? parts.join(', ') : countOf(0, EMPTY_COUNT_NOUN);
  const statuses = answerable.flatMap(({ kind, results }) =>
    statusesOf(kind, results),
  );
  const count = (status: AnswerStatus) =>
    statuses.filter((each) => each === status).length;
  const line =
    `${items}: ${count('answered')} answered, ` +
    `${count('not_applicable')} not applicable, ${count('untouched')} untouched.`;
  return stillOpen ? `${line} The form is still open.` : line;
}

// The form a notShown result waits behind, as its texts name it.
function blockingRound(blockingHeading: string | null): string {
  return blockingHeading === null
    ? 'another form'
    : `the form '${blockingHeading}'`;
}

function summaryOf(
  kinds: readonly MainItemKind[],
  result: RoundResult,
): string {
  const { reason } = result;
  switch (reason.kind) {
    case 'stillOpen':
      return summarise(kinds, result, true);
    case 'finished':
    case 'autoAnswered':
    case 'handedBack':
      return summarise(kinds, result, false);
    case 'notShown':
      return (
        `This form, '${reason.heading}', was not shown: ` +
        `${blockingRound(reason.blockingHeading)} is still open in the app.`
      );
    case 'noRound':
      return 'No form is open.';
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
        `These answers are for an earlier form, '${reason.heading}', that ` +
        `you never received. Read them as that form's answers. The form ` +
        `you just sent was not opened: send it again with ${ROUND_OPEN_TOOL}.`
      );
    case 'notShown': {
      const other = blockingRound(reason.blockingHeading);
      return (
        `The user has not finished ${other} in the app, so this form was ` +
        `not opened and has no answers. Send this form again with ` +
        `${ROUND_OPEN_TOOL}, and again after every draft like this one. ` +
        `Once the user finishes ${other}, a send may return that form's ` +
        `answers instead, marked with earlier_heading: act on them, then ` +
        `send this form again. If ${other} is no longer needed, ask the ` +
        `user to cancel it in the app. Do not call ${ROUND_COLLECT_TOOL} for ` +
        `this form: that returns the other form's answers.`
      );
    }
    case 'noRound':
      return NEXT_ON_NO_ROUND;
  }
}

// The tool result for a round result. Its keys keep this order, since the
// tool text is the payload's JSON: each registered kind's results at its
// resultKey in reverse registration order, so a payload of the built-ins
// alone reads `answers, findings, notices`; `note` only when the user wrote
// one, `earlier_heading` only on an earlier round's answers. The one place
// main builds an AnswersPayload.
export function roundPayload(
  kinds: readonly MainItemKind[],
  result: RoundResult,
): AnswersPayload {
  const payload: Record<string, unknown> = {
    outcome: result.outcome,
    summary: summaryOf(kinds, result),
    next: nextOf(result.reason),
  };
  for (const kind of kinds.toReversed()) {
    payload[kind.spec.resultKey] = result.results[kind.spec.id] ?? [];
  }
  if (result.note !== '') {
    payload.note = result.note;
  }
  if (result.reason.kind === 'handedBack') {
    payload.earlier_heading = result.reason.heading;
  }
  return payload as AnswersPayload;
}
