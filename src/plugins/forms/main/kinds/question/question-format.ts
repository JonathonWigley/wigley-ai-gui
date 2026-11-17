import {
  type AnswerEntry,
  type AnswerResult,
  MAX_ENTRIES,
  type MainItemKind,
  type Question,
  RoundError,
  type RoundItemPath,
} from '../../../contract';
import { BUILT_IN_KIND_SPECS } from '../../../item-kinds';
import {
  answerResult,
  readAnswerEntry,
  recommendedAnswerEntry,
  withoutDontAsk,
} from '../answer-results';
import {
  fieldsMissing,
  fieldsOutside,
  ITEM_LAYOUT_SCHEMA,
  MIN_CHOICES,
  parseLayoutField,
  parseRecommend,
  requireText,
} from '../fields';
import type { AnswerSubject } from '../item-format';
import { isJsonObject } from '../../../../../shared/json';

const QUESTION_FIELDS = [
  'title',
  'summary',
  'context',
  'choices',
  'recommend',
  'rationale',
];
// The summary's old name, read so rounds saved before the rename still load.
const LEGACY_SUMMARY_FIELD = 'question';
const QUESTION_KNOWN_FIELDS = [
  ...QUESTION_FIELDS,
  LEGACY_SUMMARY_FIELD,
  'layout',
];

const QUESTIONS_DESCRIPTION =
  'Open decisions that are not review findings — one object per question. ' +
  'Each draws as its own card after the findings and before the notices ' +
  'page: the summary, the context, then the choices with the rationale ' +
  'under the recommended one. The card draws no section labels.';

const QUESTION_SUMMARY_DESCRIPTION =
  'One or two plain sentences: what the user is asked to decide, and why ' +
  "it needs deciding now. It is the card's headline, drawn first, so it " +
  'stands alone; the context does not repeat it. Inline markdown.';

const QUESTION_CONTEXT_DESCRIPTION =
  'The rundown: what the user needs to know to answer, in a few short ' +
  'paragraphs of plain prose with no headings and no labelled parts. Add a ' +
  'visual only when the question is about a shape, such as a flow or a ' +
  'layout. Put the evidence last, in a `:::details Sources` block. A ' +
  'question about concrete changes opens instead with a `:::changes` block ' +
  'for a few changes, or a `:::tree` block when they span several places. ' +
  'Close each block with a line holding only `:::`. Markdown. Wording: ' +
  '~/wigley-agents/forms.md § Questions.';

function parseChoices(raw: unknown, at: RoundItemPath): string[] {
  if (!Array.isArray(raw)) {
    throw new RoundError({
      path: at,
      problem: 'choices must be a list of strings.',
    });
  }
  if (raw.length < MIN_CHOICES) {
    throw new RoundError({
      path: at,
      problem: `has ${raw.length} choice(s).`,
      detail:
        `A question with fewer than ${MIN_CHOICES} is not a question — ` +
        `give at least ${MIN_CHOICES}.`,
    });
  }
  if (raw.length > MAX_ENTRIES) {
    throw new RoundError({
      path: at,
      problem:
        `has ${raw.length} choices; the maximum is ${MAX_ENTRIES}, one per ` +
        `number key.`,
      detail: 'Split it into two questions.',
    });
  }
  return raw.map((choice, i) => requireText(choice, `choices[${i + 1}]`, at));
}

function parseQuestion(item: unknown, at: RoundItemPath): Question {
  if (!isJsonObject(item)) {
    throw new RoundError({
      path: at,
      problem: 'each question must be an object.',
    });
  }
  const hasSummary = Object.hasOwn(item, 'summary');
  const hasLegacySummary = Object.hasOwn(item, LEGACY_SUMMARY_FIELD);
  if (hasSummary && hasLegacySummary) {
    throw new RoundError({
      path: at,
      problem: 'has both summary and question.',
      detail: 'Send summary alone: question is its old name.',
    });
  }
  const missing = fieldsMissing(item, QUESTION_FIELDS).filter(
    (field) => !(field === 'summary' && hasLegacySummary),
  );
  if (missing.length > 0) {
    throw new RoundError({
      path: at,
      problem: `missing ${missing.join(', ')}.`,
      detail:
        'All six fields are required: title, summary, context, choices, ' +
        'recommend, rationale.',
    });
  }
  const extra = fieldsOutside(item, QUESTION_KNOWN_FIELDS);
  if (extra.length > 0) {
    throw new RoundError({
      path: at,
      problem: `unknown field(s) ${extra.join(', ')}.`,
      detail:
        'The form draws the not-applicable control and the Notes box ' +
        'itself; do not describe them.',
    });
  }
  const title = requireText(item.title, 'title', at);
  const summary = requireText(
    hasSummary ? item.summary : item[LEGACY_SUMMARY_FIELD],
    'summary',
    at,
  );
  const context = requireText(item.context, 'context', at);
  const rationale = requireText(item.rationale, 'rationale', at);
  const choices = parseChoices(item.choices, at);
  const recommend = parseRecommend(
    item.recommend,
    title,
    choices.length,
    'choice',
    at,
  );
  const layout = parseLayoutField(item, at);
  return { title, summary, context, choices, recommend, rationale, layout };
}

// What the answer result reads of a question.
export function questionAnswerSubject(question: Question): AnswerSubject {
  return {
    title: question.title,
    choiceTexts: question.choices,
    recommend: question.recommend,
  };
}

export const questionKind: MainItemKind<Question, AnswerEntry, AnswerResult> = {
  spec: BUILT_IN_KIND_SPECS.question,
  noun: 'question',
  describe: () => ({
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      required: [...QUESTION_FIELDS],
      properties: {
        title: {
          type: 'string',
          description:
            "A short name for the decision. It is the item's name in the " +
            'rail, and the card does not draw it.',
        },
        summary: {
          type: 'string',
          description: QUESTION_SUMMARY_DESCRIPTION,
        },
        context: {
          type: 'string',
          description: QUESTION_CONTEXT_DESCRIPTION,
        },
        choices: {
          type: 'array',
          minItems: MIN_CHOICES,
          maxItems: MAX_ENTRIES,
          items: { type: 'string' },
          description:
            `${MIN_CHOICES} to ${MAX_ENTRIES} choices, one per number key. ` +
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
          description:
            'Why the recommended choice, in a sentence or two. It draws ' +
            'under that choice with no label, so it reads on from the ' +
            'choice and does not repeat it.',
        },
        layout: ITEM_LAYOUT_SCHEMA,
      },
    },
    description: QUESTIONS_DESCRIPTION,
  }),
  parse: parseQuestion,
  layout: (question) => question.layout,
  fingerprintContent: (question) => ({
    title: question.title,
    summary: question.summary,
    context: question.context,
    choices: question.choices,
    recommend: question.recommend,
    rationale: question.rationale,
  }),
  readEntry: readAnswerEntry,
  recommendedEntry: (question, index) =>
    recommendedAnswerEntry(index, question.recommend),
  finishedEntry: withoutDontAsk,
  result: (question, entry) =>
    answerResult(questionAnswerSubject(question), entry),
  status: (result) => result.status,
};
