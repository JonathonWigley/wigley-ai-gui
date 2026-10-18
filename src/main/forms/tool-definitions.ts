import type { ToolDefinition } from '../../contracts/forms';
import {
  DEFAULT_NOTICE_BADGE,
  MAX_CHOICES,
  MAX_NOTICES,
  MAX_QUESTIONS,
  MIN_CHOICES,
  NOTICE_BADGES,
} from './round';

const ASK_ROUND_DESCRIPTION =
  'Ask the user a whole round of interview questions in the wigley-ai-gui ' +
  'app and wait for the answers. Send every question whose prerequisites ' +
  'are already settled in one call. The app draws the not-applicable control, ' +
  "the 'what' and 'why' text boxes, and the note box by itself — do not " +
  "describe them as questions or choices. Pass 'notices' for anything " +
  'already fixed, dispatched, decided by you alone, or otherwise settled ' +
  'before this round opened: each one draws as its own card before the ' +
  "questions, badged 'Applied', 'Dispatched' or 'Decided', with only a " +
  "comment box — no choices and nothing to decide. Use 'questions' for what " +
  "is still open and 'notices' for what is already handled; never bundle a " +
  'decided fix into a question. A round needs at least one question or one ' +
  'notice, and may carry both, or notices alone. Re-sending a round is ' +
  'always safe: the same questions and notices re-attach to the round still ' +
  'open, return the answers of the round just submitted, or open pre-filled ' +
  "with the user's saved answers. When the result carries 'earlier_heading', " +
  'those answers belong to an earlier round you never received; read them, ' +
  "then send your round again. An answer may carry 'dont_ask' (true), with " +
  "'dont_ask_reason' when the user gave one: the user pressed Don't ask me " +
  'this, so settle that kind of question yourself for the rest of the ' +
  "session and show each such decision as a 'Decided' notice. The choice on " +
  "that answer still counts. Outcome 'needs_manual_open' means the relay " +
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

const QUESTION_CONTEXT_DESCRIPTION =
  'What the user needs to know to decide. Markdown. Open with the quick ' +
  'read: a plain bullet list of the facts the decision rests on. When the ' +
  'question is about concrete changes (a diff to review, edits to approve), ' +
  'open instead with a `:::changes` block (one line per change, starting ' +
  '`+` added, `~` changed or `x` removed) for a few changes, or a `:::tree` ' +
  'block (the same lines, indented two spaces per level, grouped by place) ' +
  'when changes span several places. Put the full text in a `:::details ' +
  'Full text` block. Close each block with a line holding only `:::`. Each ' +
  'line says what the user gets in plain words, never the markup or symbol ' +
  'behind it.';

const NOTICE_TITLE_DESCRIPTION =
  'One line saying what changed, in plain words: not a commit ref, not ' +
  '"already done". For a \'Decided\' notice, the decision itself.';

const NOTICE_CONTEXT_DESCRIPTION =
  'What changed, already done; a notice is not a question. Markdown. A ' +
  '`:::tree` block and nothing else: one line per place, then under it ' +
  'indented two spaces one line per change, starting `+` added, `~` changed ' +
  'or `x` removed. Each change line says in plain words what the user now ' +
  'gets, never the markup, symbol or commit behind it. Close the block with ' +
  'a line holding only `:::`. A notice touching one place may use a ' +
  '`:::changes` block instead (the change lines alone). No prose paragraph ' +
  "and no evidence. A 'Decided' notice instead carries one plain line: what " +
  'was decided and why.';

const NOTICE_BADGE_DESCRIPTION =
  "'Applied' (the default) for a fix already landed, 'Dispatched' for one " +
  "still in flight, 'Decided' for a decision you took alone. A comment on a " +
  "'Decided' notice overrides the decision.";

const NOTICES_DESCRIPTION =
  'Findings already fixed, dispatched, decided by you alone, or otherwise ' +
  'settled before this round opened — one object per notice. Each draws as ' +
  "its own card before the questions, badged 'Applied', 'Dispatched' or " +
  "'Decided', with only a comment box: no choices, no recommendation, " +
  'nothing for the user to decide.';

const COLLECT_LAST_ROUND_DESCRIPTION =
  'Re-attach to the round already open in the app and wait for the answers, ' +
  "or return the last finished round's answers again. Takes no required " +
  "arguments. Call this after ask_round returns outcome 'draft', and after " +
  'any failure that lost the answers. ' +
  "Outcome 'no_round' means nothing is open or saved: send the round again " +
  "with ask_round, and the user's saved answers fill in.";

// The two wigley-forms tools as MCP tools/list publishes them; parseRound
// enforces the same limits, so the schema and the validator never disagree.
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
        questions: {
          type: 'array',
          maxItems: MAX_QUESTIONS,
          items: {
            type: 'object',
            additionalProperties: false,
            required: [
              'title',
              'context',
              'question',
              'choices',
              'recommend',
              'rationale',
            ],
            properties: {
              title: {
                type: 'string',
                description: 'A short name for the decision.',
              },
              context: {
                type: 'string',
                description: QUESTION_CONTEXT_DESCRIPTION,
              },
              question: {
                type: 'string',
                description: 'The question itself.',
              },
              choices: {
                type: 'array',
                minItems: MIN_CHOICES,
                maxItems: MAX_CHOICES,
                items: { type: 'string' },
                description:
                  'Each choice opens with one plain sentence saying what the ' +
                  'user would get, before any symbol name or term of art.',
              },
              recommend: {
                type: 'integer',
                minimum: 1,
                description: 'The 1-based number of the recommended choice.',
              },
              rationale: {
                type: 'string',
                description: 'Why that one is recommended.',
              },
            },
          },
        },
        notices: {
          type: 'array',
          maxItems: MAX_NOTICES,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['title', 'context'],
            properties: {
              title: { type: 'string', description: NOTICE_TITLE_DESCRIPTION },
              context: {
                type: 'string',
                description: NOTICE_CONTEXT_DESCRIPTION,
              },
              badge: {
                type: 'string',
                enum: [...NOTICE_BADGES],
                default: DEFAULT_NOTICE_BADGE,
                description: NOTICE_BADGE_DESCRIPTION,
              },
            },
          },
          description: NOTICES_DESCRIPTION,
        },
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
