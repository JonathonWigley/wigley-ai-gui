import type { ToolDefinition } from '../../sessions/contract';
import { FORMATS, ITEM_KINDS } from './kinds/formats';

const ASK_ROUND_DESCRIPTION =
  'Ask the user a whole round of interview questions and review findings in ' +
  'the wigley-ai-gui app and wait for the answers. Send every item whose ' +
  'prerequisites are already settled in one call. The app draws the ' +
  "not-applicable control, the Notes box, the round note and the Don't ask " +
  'me this control by itself — do not describe them as questions or ' +
  "choices. Use 'findings' for review findings that need the user's " +
  'decision: each draws as a Finding section, a brief Proof section, then ' +
  "its choices, each with its reason under it. Use 'questions' for any " +
  "other open decision. Pass 'notices' for anything already fixed, " +
  'dispatched, decided by you alone, or otherwise settled before this round ' +
  'opened: each one draws as its own card before the findings and ' +
  "questions, badged 'Applied', 'Dispatched' or 'Decided', with only a " +
  'comment box — no choices and nothing to decide. Never bundle a decided ' +
  'fix into a question or a finding. A round needs at least one question, ' +
  'finding or notice, and may carry any mix of the three. Re-sending a ' +
  'round is always safe: the same questions, findings and notices re-attach ' +
  'to the round still open, return the answers of the round just ' +
  "submitted, or open pre-filled with the user's saved answers. When the " +
  "result carries 'earlier_heading', " +
  'those answers belong to an earlier round you never received; read them, ' +
  "then send your round again. Answers to questions come back in 'answers' " +
  "and answers to findings in 'findings'. An answer may carry 'notes', the " +
  "user's own answer or reasoning, and 'dont_ask' (true), with " +
  "'dont_ask_reason' when the user gave one: the user pressed Don't ask me " +
  'this, so settle that kind of item yourself for the rest of the session ' +
  "and show each such decision as a 'Decided' notice. The choice on that " +
  "answer still counts. Outcome 'needs_manual_open' means the relay " +
  'could not start the app and no round exists: send the same round again ' +
  'with ask_round once, which tries the start again; if it comes back a ' +
  "second time, tell the user the reason in its 'summary' and ask the " +
  "round's questions in your reply. collect_last_round is never the answer " +
  'to it. While the user is still answering another round of this session, ' +
  'an ask_round for a different round waits until the user submits or ' +
  'cancels that round in the app; if its deadline passes first, it returns a ' +
  "'draft' whose 'next' says the round was not opened: send it again with " +
  'ask_round, not collect_last_round. A new round never closes an ' +
  'unfinished one: the user cancels a round you abandon.';

const COLLECT_LAST_ROUND_DESCRIPTION =
  'Re-attach to the round already open in the app and wait for the answers, ' +
  "or return the last finished round's answers again. Takes no required " +
  "arguments. Call this after ask_round returns outcome 'draft', and after " +
  'any failure that lost the answers. ' +
  "Outcome 'no_round' means no round is open and no finished answers are " +
  "waiting: send the round again with ask_round, and the user's saved " +
  'answers fill in.';

// The two wigley-forms tools as MCP tools/list publishes them. ask_round's item
// lists come from the same formats parseRound validates with, so the schema
// and the validator never disagree.
export const FORMS_TOOLS: ToolDefinition[] = [
  {
    name: 'ask_round',
    description: ASK_ROUND_DESCRIPTION,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['heading', 'overview'],
      properties: {
        heading: {
          type: 'string',
          description: 'One line naming what this round settles.',
        },
        overview: {
          type: 'string',
          description:
            'One or two short sentences, low detail, shown under the ' +
            'heading: the work underway, then what this round focuses on. ' +
            'Inline markdown only.',
        },
        ...Object.fromEntries(
          ITEM_KINDS.map((kind) => [
            FORMATS[kind].argsKey,
            FORMATS[kind].arraySchema,
          ]),
        ),
      },
    },
  },
  {
    name: 'collect_last_round',
    description: COLLECT_LAST_ROUND_DESCRIPTION,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        wait: {
          type: 'boolean',
          default: true,
          description:
            'false returns the current draft at once instead of waiting.',
        },
      },
    },
  },
];
