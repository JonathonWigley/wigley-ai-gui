import { MAX_CHOICES, type Question } from '../../../contract';
import { RoundError } from '../../round-error';
import {
  fieldsMissing,
  fieldsOutside,
  MIN_CHOICES,
  parseRecommend,
  requireText,
} from '../fields';
import type { AnswerableFormat } from '../item-format';
import { isJsonObject } from '../../../../../shared/json';

const MAX_QUESTIONS = 20;

const QUESTION_FIELDS = [
  'title',
  'context',
  'question',
  'choices',
  'recommend',
  'rationale',
];

const QUESTIONS_DESCRIPTION =
  'Open decisions that are not review findings — one object per question. ' +
  'Each draws as its own card after the findings: the question, its ' +
  'context, then the choices, the recommended one with its rationale under ' +
  'it.';

const QUESTION_CONTEXT_DESCRIPTION =
  'Why the question is being asked, and everything the user needs to ' +
  'answer it. Markdown. Open with the quick ' +
  'read: a plain bullet list of the facts the decision rests on. When the ' +
  'question is about concrete changes (a diff to review, edits to approve), ' +
  'open instead with a `:::changes` block (one line per change, starting ' +
  '`+` added, `~` changed or `x` removed) for a few changes, or a `:::tree` ' +
  'block (the same lines, indented two spaces per level, grouped by place) ' +
  'when changes span several places. Put the full text in a `:::details ' +
  'Full text` block. Close each block with a line holding only `:::`. Each ' +
  'line says what the user gets in plain words, never the markup or symbol ' +
  'behind it.';

function parseChoices(raw: unknown, where: string): string[] {
  if (!Array.isArray(raw)) {
    throw new RoundError(`${where}choices must be a list of strings.`);
  }
  if (raw.length < MIN_CHOICES) {
    throw new RoundError(
      `${where}has ${raw.length} choice(s). A question with fewer than ` +
        `${MIN_CHOICES} is not a question — give at least ${MIN_CHOICES}.`,
    );
  }
  if (raw.length > MAX_CHOICES) {
    throw new RoundError(
      `${where}has ${raw.length} choices; the maximum is ${MAX_CHOICES}. ` +
        `Split it into two questions.`,
    );
  }
  return raw.map((choice, i) =>
    requireText(choice, `choices[${i + 1}]`, where),
  );
}

function parseQuestion(item: unknown, where: string): Question {
  if (!isJsonObject(item)) {
    throw new RoundError(`${where}each question must be an object.`);
  }
  const missing = fieldsMissing(item, QUESTION_FIELDS);
  if (missing.length > 0) {
    throw new RoundError(
      `${where}missing ${missing.join(', ')}. All six fields are ` +
        `required: title, context, question, choices, recommend, rationale.`,
    );
  }
  const extra = fieldsOutside(item, QUESTION_FIELDS);
  if (extra.length > 0) {
    throw new RoundError(
      `${where}unknown field(s) ${extra.join(', ')}. The form draws ` +
        `the not-applicable control and the Notes box itself; do not ` +
        `describe them.`,
    );
  }
  const title = requireText(item.title, 'title', where);
  const context = requireText(item.context, 'context', where);
  const question = requireText(item.question, 'question', where);
  const rationale = requireText(item.rationale, 'rationale', where);
  const choices = parseChoices(item.choices, where);
  const recommend = parseRecommend(
    item.recommend,
    title,
    choices.length,
    'choice',
    where,
  );
  return { title, context, question, choices, recommend, rationale };
}

export const questionFormat: AnswerableFormat<Question> = {
  argsKey: 'questions',
  noun: 'question',
  maxItems: MAX_QUESTIONS,
  arraySchema: {
    type: 'array',
    maxItems: MAX_QUESTIONS,
    items: {
      type: 'object',
      additionalProperties: false,
      required: [...QUESTION_FIELDS],
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
          description:
            'What is being decided, in one plain sentence. Markdown.',
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
    description: QUESTIONS_DESCRIPTION,
  },
  parse: parseQuestion,
  fingerprintContent: (question) => ({
    title: question.title,
    context: question.context,
    question: question.question,
    choices: question.choices,
    recommend: question.recommend,
    rationale: question.rationale,
  }),
  answerSubject: (question) => ({
    title: question.title,
    choiceTexts: question.choices,
    recommend: question.recommend,
  }),
};
