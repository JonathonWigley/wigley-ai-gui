import {
  type AnswerEntry,
  type AnswerResult,
  MAX_ENTRIES,
  type MainItemKind,
  type Question,
  type QuestionApproval,
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
const APPROVES_FIELD = 'approves';
const APPROVAL_FIELDS = ['choice', 'action'];
const QUESTION_KNOWN_FIELDS = [
  ...QUESTION_FIELDS,
  LEGACY_SUMMARY_FIELD,
  APPROVES_FIELD,
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
  'the auri:forms skill.';

const APPROVES_DESCRIPTION =
  'Optional. Tag each choice that approves an action auto mode gates — a ' +
  'push past PR protection, an edit to ' +
  'your settings or hooks, start_session in another project — with that ' +
  'exact action in plain words, such as "push `main` of ' +
  'my-repo to origin past PR protection". When the user ' +
  'submits the round with a tagged choice picked, the app first posts ' +
  '"Approved in form: <action>" into the running turn as the user\'s own ' +
  'message, one line per action, then returns the answers, each tagged ' +
  'pick with approval_posted. True: that message is the yes, so ask for no ' +
  'separate chat yes. False: nothing was posted, so ask for the yes in a ' +
  'one-line chat message before the gated call. One line per action.';

function parseApproval(
  raw: unknown,
  number: number,
  choiceCount: number,
  at: RoundItemPath,
): QuestionApproval {
  const name = `${APPROVES_FIELD}[${number}]`;
  if (!isJsonObject(raw)) {
    throw new RoundError({
      path: at,
      problem: `${name} must be an object with choice and action.`,
    });
  }
  const missing = fieldsMissing(raw, APPROVAL_FIELDS);
  const extra = fieldsOutside(raw, APPROVAL_FIELDS);
  if (missing.length > 0 || extra.length > 0) {
    throw new RoundError({
      path: at,
      problem: `${name} takes exactly choice and action.`,
    });
  }
  const { choice } = raw;
  const isChoiceNumber =
    typeof choice === 'number' &&
    Number.isInteger(choice) &&
    choice >= 1 &&
    choice <= choiceCount;
  if (!isChoiceNumber) {
    throw new RoundError({
      path: at,
      problem:
        `${name}.choice must be the 1-based number of a choice; the ` +
        `question has ${choiceCount} choices, and it was ${JSON.stringify(choice)}.`,
      detail: `Use a number from 1 to ${choiceCount}.`,
    });
  }
  const action = requireText(raw.action, `${name}.action`, at);
  if (/[\r\n]/.test(action)) {
    throw new RoundError({
      path: at,
      problem: `${name}.action must be one line; it holds a line break.`,
      detail: 'Name the action in one line of plain words.',
    });
  }
  return { choice, action };
}

// [] when the question sends no `approves`.
function parseApproves(
  item: Readonly<Record<string, unknown>>,
  choiceCount: number,
  at: RoundItemPath,
): QuestionApproval[] {
  if (!Object.hasOwn(item, APPROVES_FIELD)) {
    return [];
  }
  const raw = item[APPROVES_FIELD];
  if (!Array.isArray(raw)) {
    throw new RoundError({
      path: at,
      problem: `${APPROVES_FIELD} must be a list of objects.`,
    });
  }
  return raw.map((approval, i) =>
    parseApproval(approval, i + 1, choiceCount, at),
  );
}

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
  const approves = parseApproves(item, choices.length, at);
  const layout = parseLayoutField(item, at);
  return {
    title,
    summary,
    context,
    choices,
    recommend,
    rationale,
    approves,
    layout,
  };
}

// The actions the question's tagged choice approves, when the entry answers
// it with that choice.
function questionApprovedActions(
  question: Question,
  entry: AnswerEntry,
): string[] {
  const result = answerResult(questionAnswerSubject(question), entry);
  if (result.status !== 'answered') {
    return [];
  }
  return question.approves
    .filter((approval) => approval.choice === result.choice)
    .map((approval) => approval.action);
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
        approves: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: [...APPROVAL_FIELDS],
            properties: {
              choice: {
                type: 'integer',
                minimum: 1,
                description: 'The 1-based number of the tagged choice.',
              },
              action: {
                type: 'string',
                description:
                  'The exact action picking that choice approves, in plain ' +
                  'words.',
              },
            },
          },
          description: APPROVES_DESCRIPTION,
        },
        layout: ITEM_LAYOUT_SCHEMA,
      },
    },
    description: QUESTIONS_DESCRIPTION,
  }),
  parse: parseQuestion,
  layout: (question) => question.layout,
  // `approves` joins only when sent, so a question without it hashes as it
  // did before the field existed.
  fingerprintContent: (question) => ({
    title: question.title,
    summary: question.summary,
    context: question.context,
    choices: question.choices,
    recommend: question.recommend,
    rationale: question.rationale,
    ...(question.approves.length === 0
      ? {}
      : {
          approves: question.approves.map((approval) => ({
            choice: approval.choice,
            action: approval.action,
          })),
        }),
  }),
  readEntry: readAnswerEntry,
  recommendedEntry: (question, index) =>
    recommendedAnswerEntry(index, question.recommend),
  finishedEntry: withoutDontAsk,
  result: (question, entry) =>
    answerResult(questionAnswerSubject(question), entry),
  status: (result) => result.status,
  approvedActions: questionApprovedActions,
};
