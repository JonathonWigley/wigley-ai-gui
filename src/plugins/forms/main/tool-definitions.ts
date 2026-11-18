import {
  type OfflineAnswer,
  textResult,
  type ToolDefinition,
} from '../../sessions/contract';
import { MAX_ENTRIES, type MainItemKind } from '../contract';
import { findingOrigins } from '../finding-origins';
import { cardKindsText, findingCardsText } from './kinds/finding/finding-text';
import { ROUND_COLLECT_TOOL, ROUND_OPEN_TOOL } from './mcp-wording';

// The card sentence's proof clause: the cards whose origin requires proof
// also show it; '' when no registered origin requires proof.
function proofClause(): string {
  const specs = findingOrigins.list().filter((spec) => spec.requiresProof);
  return specs.length === 0
    ? ''
    : `, and ${cardKindsText(specs)} also its proof`;
}

// Built on each call, since the card list follows the registered origins.
function askRoundDescription(): string {
  return (
    'Ask the user a whole round of interview questions and review findings in ' +
    'the wigley-ai-gui app and wait for the answers. Send every item whose ' +
    "prerequisites are already settled in one call. How each item's text is " +
    'worded: ~/wigley-agents/forms.md. The app draws the ' +
    "not-applicable control, the Notes box, the round note and the Don't ask " +
    'me this control by itself — do not ' +
    'describe them as questions or choices. Use ' +
    "'findings' for review findings that need the user's decision: a " +
    `finding's origin sets its card — ${findingCardsText()}. A card opens ` +
    'on a verdict: the origin and severity and the impact; then it shows the ' +
    `finding${proofClause()}. Under it the card's actions show in order, ` +
    'each with its ' +
    'choices and their reasons under it; an action with no choices shows as a ' +
    'header the user picks alone, with its action_reasons entry when you sent ' +
    'one. One pick sets the choice and its action. Each choice and header ' +
    `takes a number key, so a finding holds at most ${MAX_ENTRIES} of them ` +
    `together and a question at most ${MAX_ENTRIES} choices; more fails the ` +
    'call. The recommended choice, or ' +
    "the recommended action's header when it has no choices, is badged; the " +
    'user takes it with Accept or picks any other entry. A choice never opens ' +
    "with an action's label. Use 'questions' for any " +
    "other open decision. Pass 'notices' for anything already fixed, " +
    'dispatched, decided by you alone, or otherwise settled before this round ' +
    "opened: each one draws as one line on the round's notices page, after " +
    "every other item, badged 'Applied', 'Dispatched' or 'Decided', " +
    'and opens to its context and one comment box — no choices and nothing to ' +
    'decide. Never bundle a decided ' +
    'fix into a question or a finding. A round and each item may name a ' +
    "layout in 'layout', a folder in the app's forms layouts folder: an " +
    "item's layout draws its card, the round's draws the rest, and the " +
    "user's own layout draws what neither names. A name the folder lacks " +
    'fails the call with the names it holds. For a look no layout has, write ' +
    'a new layout folder, name it in the round, and list each layout file you ' +
    'wrote or changed in a notice on that round. A round needs at least one ' +
    'question, finding or notice, and may carry any mix of the three. ' +
    'Re-sending a round is safe (leave out a layout the folder no longer ' +
    'holds): the same questions, findings and notices re-attach ' +
    'to the round still open, return the answers of the round just ' +
    "submitted, or open pre-filled with the user's saved answers. When the " +
    "result carries 'earlier_heading', those answers belong to an earlier " +
    'round you never received; read them, then send your round again. ' +
    "Answers to questions come back in 'answers' " +
    "and answers to findings in 'findings'. A finding answer's 'action' is " +
    "the picked action and its 'choice' the picked choice's 1-based number in " +
    "'choices', 0 when the user picked an action with no choices. An answer " +
    "may carry 'notes', the " +
    "user's own answer or reasoning, and 'dont_ask' (true), with " +
    "'dont_ask_reason' when the user gave one: the user pressed Don't ask me " +
    'this, so settle that kind of item yourself for the rest of the session ' +
    "and show each such decision as a 'Decided' notice. The choice on that " +
    "answer still counts. Outcome 'needs_manual_open' means the relay " +
    'could not start the app and no round exists: send the same round again ' +
    'with ask_round once, which tries the start again; if it comes back a ' +
    "second time, tell the user the reason in its 'summary' and ask the " +
    "round's questions and findings in your reply. collect_last_round is " +
    'never the answer to it. While the user is still answering another ' +
    'round of this session, ' +
    'an ask_round for a different round waits until the user submits or ' +
    'cancels that round in the app; if its deadline passes first, it returns a ' +
    "'draft' whose 'next' says the round was not opened: send it again with " +
    "ask_round, not collect_last_round. Outcome 'auto_answered' means the " +
    'session is headless: the app showed no form and answered every question ' +
    "and finding with its recommendation; follow its 'next'. A new round " +
    'never closes an unfinished one: the user cancels a round you abandon.'
  );
}

const ROUND_LAYOUT_DESCRIPTION =
  "The layout that draws this round: a folder name in the app's forms " +
  "layouts folder. An item's own layout wins over it, and the user's " +
  'forms.layout setting draws what neither names. A name the folder lacks ' +
  'fails the call with the names it holds.';

const COLLECT_LAST_ROUND_DESCRIPTION =
  'Re-attach to the round already open in the app and wait for the answers, ' +
  "or return the last finished round's answers again. Takes no required " +
  "arguments. Call this after ask_round returns outcome 'draft', and after " +
  'any failure that lost the answers. ' +
  "Outcome 'no_round' means no round is open and no finished answers are " +
  "waiting: send the round again with ask_round, and the user's saved " +
  "answers fill in. After an 'auto_answered' round it returns that result " +
  'again.';

// The two wigley-forms tools as MCP tools/list publishes them. ask_round's item
// lists come from the same kinds parseRound validates with, in their order, so
// the schema and the validator agree, but for one case: the validator still
// reads a question's legacy `question` as its summary.
export function formsTools(kinds: readonly MainItemKind[]): ToolDefinition[] {
  return [
    {
      name: ROUND_OPEN_TOOL,
      description: askRoundDescription(),
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
          layout: { type: 'string', description: ROUND_LAYOUT_DESCRIPTION },
          ...Object.fromEntries(
            kinds.map((kind) => [kind.spec.argsKey, kind.describe()]),
          ),
        },
      },
    },
    {
      name: ROUND_COLLECT_TOOL,
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
}

// ask_round's answer while the app is closed: the agent takes the recommended
// picks, as a headless session does. collect_last_round has none, so it
// answers that it did not run.
export const ASK_ROUND_OFFLINE: OfflineAnswer = {
  result: textResult(
    "The app is closed, so no round was shown. Take each item's recommended pick and list every pick as a Decided notice in your reply.",
  ),
  replay: false,
};
