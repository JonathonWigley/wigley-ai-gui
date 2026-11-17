import type { AgentFormType } from '../../../contracts/agent-forms';
import type {
  AnswerableKind,
  AnswerEntry,
  AnswersPayload,
  FormBody,
  FormsService,
  Round,
} from '../contract';
import {
  ROUND_COLLECT_TOOL,
  ROUND_OPEN_TOOL,
  roundErrorText,
  roundPayload,
} from './mcp-wording';
import {
  answersResult,
  fingerprint,
  handedBackResult,
  noRoundResult,
  notShownResult,
  parseRound,
  readFormBody,
  requireKnownLayouts,
} from './round';
import { RoundError } from './round-error';

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

// Forms' review round as an agent form type, the round logic's results worded
// by the MCP wording: `ROUND_OPEN_TOOL` opens one and `ROUND_COLLECT_TOOL`
// collects it.
export const roundType: AgentFormType<Round, FormBody, AnswersPayload> = {
  openTool: ROUND_OPEN_TOOL,
  collectTool: ROUND_COLLECT_TOOL,
  noun: 'round',
  argsErrorText: (error) =>
    error instanceof RoundError ? roundErrorText(error) : null,
  parse: parseRound,
  fingerprint,
  heading: (round) => round.heading,
  savedHeading,
  readBody: readFormBody,
  prefill: (_round, saved, finished) => prefillDraft(saved, finished),
  payload: (round, outcome, body) =>
    roundPayload(answersResult(round, outcome, body)),
  handedBackPayload: (round, outcome, body) =>
    roundPayload(handedBackResult(round, outcome, body)),
  noFormPayload: () => roundPayload(noRoundResult()),
  notShownPayload: (round, blockingHeading) =>
    roundPayload(notShownResult(round, blockingHeading)),
};

// A round the app answered with `body` and never showed.
export function autoAnsweredPayload(
  round: Round,
  body: FormBody,
): AnswersPayload {
  return roundPayload(answersResult(round, 'auto_answered', body));
}

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
    detach: () => service.detach(),
  };
}
