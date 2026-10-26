import type { AgentFormType } from '../../../contracts/agent-forms';
import {
  type AnswerableKind,
  type AnswerEntry,
  type AnswersPayload,
  type FormBody,
  type FormsService,
  ROUND_ERROR_NAME,
  type Round,
} from '../contract';
import {
  answersPayload,
  fingerprint,
  handedBackPayload,
  noRoundPayload,
  parseRound,
  readFormBody,
  requireKnownLayouts,
} from './round';

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
function prefillDraft(body: FormBody, finished: boolean): FormBody {
  if (!finished) {
    return body;
  }
  const stripped: FormBody = { ...body };
  for (const listWithoutDontAsk of Object.values(ANSWER_LISTS)) {
    Object.assign(stripped, listWithoutDontAsk(body));
  }
  return stripped;
}

function savedHeading(args: unknown): string | null {
  const heading = (args as { heading?: unknown } | null)?.heading;
  return typeof heading === 'string' && heading.trim() !== '' ? heading : null;
}

// The draft a call returns when its round was never shown, so its answers are
// blank; it names the blocking round, when one is open, for the agent to point
// the user at.
function roundNotShownPayload(
  round: Round,
  blockingHeading: string | null,
): AnswersPayload {
  const other =
    blockingHeading === null
      ? 'another round'
      : `the round '${blockingHeading}'`;
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

// Forms' review round as an agent form type: `ask_round` opens one and
// `collect_last_round` collects it.
export const roundType: AgentFormType<Round, FormBody, AnswersPayload> = {
  openTool: 'ask_round',
  collectTool: 'collect_last_round',
  noun: 'round',
  argsErrorName: ROUND_ERROR_NAME,
  parse: parseRound,
  fingerprint,
  heading: (round) => round.heading,
  savedHeading,
  readBody: readFormBody,
  prefill: (_round, saved, finished) => prefillDraft(saved, finished),
  payload: answersPayload,
  handedBackPayload,
  noFormPayload: noRoundPayload,
  notShownPayload: roundNotShownPayload,
};

// Rejects, before the service sees the call, an open whose round names a layout `layoutNames()` lacks.
export function withKnownLayouts(
  service: FormsService,
  layoutNames: () => readonly string[],
): FormsService {
  return {
    startSession: (owner) => {
      const session = service.startSession(owner);
      return {
        open: (args, toolUseId, signal) => {
          try {
            requireKnownLayouts(parseRound(args), layoutNames());
          } catch (error) {
            return Promise.reject(error);
          }
          return session.open(args, toolUseId, signal);
        },
        collect: (wait, signal) => session.collect(wait, signal),
        end: () => session.end(),
      };
    },
  };
}
