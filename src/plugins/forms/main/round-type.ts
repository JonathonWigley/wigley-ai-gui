import type { AgentFormType } from '../../../contracts/agent-forms';
import {
  type AnswersPayload,
  type FormBody,
  type FormsService,
  type MainItemKind,
  type Round,
  roundErrorOf,
} from '../contract';
import {
  ROUND_COLLECT_TOOL,
  ROUND_OPEN_TOOL,
  roundErrorText,
  roundPayload,
} from './mcp-wording';
import {
  answersResult,
  approvalMessage,
  bodyEntries,
  fingerprint,
  handedBackResult,
  noRoundResult,
  notShownResult,
  parseRound,
  readFormBody,
  requireKnownLayouts,
} from './round';

// A finished round's copy holds each kind's `finishedEntry` of its entries
// (a press belongs to the round it was made in); an open draft's copy keeps
// them whole, since retro reads finished rounds only.
function prefillDraft(
  kinds: readonly MainItemKind[],
  body: FormBody,
  finished: boolean,
): FormBody {
  if (!finished) {
    return body;
  }
  let prefilled = body;
  for (const kind of kinds) {
    const { finishedEntry } = kind;
    if (finishedEntry !== undefined) {
      prefilled = {
        ...prefilled,
        [kind.spec.bodyKey]: bodyEntries(body, kind).map((entry) =>
          finishedEntry(entry),
        ),
      };
    }
  }
  return prefilled;
}

function savedHeading(args: unknown): string | null {
  const heading = (args as { heading?: unknown } | null)?.heading;
  return typeof heading === 'string' && heading.trim() !== '' ? heading : null;
}

// Forms' review round over the registered kinds as an agent form type, the
// round logic's results worded by the MCP wording: `ROUND_OPEN_TOOL` opens one
// and `ROUND_COLLECT_TOOL` collects it. Each member reads `kinds()` when
// called.
export function createRoundType(
  kinds: () => readonly MainItemKind[],
): AgentFormType<Round, FormBody, AnswersPayload> {
  return {
    openTool: ROUND_OPEN_TOOL,
    collectTool: ROUND_COLLECT_TOOL,
    noun: 'form',
    argsErrorText: (error) => {
      const roundError = roundErrorOf(error);
      return roundError === null ? null : roundErrorText(kinds(), roundError);
    },
    parse: (args) => parseRound(kinds(), args),
    fingerprint: (round) => fingerprint(kinds(), round),
    heading: (round) => round.heading,
    savedHeading,
    readBody: (round, raw) => readFormBody(kinds(), round, raw),
    prefill: (_round, saved, finished) =>
      prefillDraft(kinds(), saved, finished),
    payload: (round, outcome, body, messagePosted) =>
      roundPayload(
        kinds(),
        answersResult(kinds(), round, outcome, body, messagePosted),
      ),
    handedBackPayload: (round, outcome, body, messagePosted) =>
      roundPayload(
        kinds(),
        handedBackResult(kinds(), round, outcome, body, messagePosted),
      ),
    noFormPayload: () => roundPayload(kinds(), noRoundResult(kinds())),
    notShownPayload: (round, blockingHeading) =>
      roundPayload(kinds(), notShownResult(kinds(), round, blockingHeading)),
    submitMessage: (round, body) => approvalMessage(kinds(), round, body),
  };
}

// A round the app answered with `body` and never showed.
export function autoAnsweredPayload(
  kinds: readonly MainItemKind[],
  round: Round,
  body: FormBody,
): AnswersPayload {
  return roundPayload(
    kinds,
    answersResult(kinds, round, 'auto_answered', body, false),
  );
}

// Rejects, before the service sees the call, an open whose round names a
// layout `layoutNames()` lacks.
export function withKnownLayouts(
  service: FormsService,
  kinds: () => readonly MainItemKind[],
  layoutNames: () => readonly string[],
): FormsService {
  return {
    startSession: (owner) => {
      const session = service.startSession(owner);
      return {
        open: (args, toolUseId, signal) => {
          try {
            const known = kinds();
            requireKnownLayouts(known, parseRound(known, args), layoutNames());
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
