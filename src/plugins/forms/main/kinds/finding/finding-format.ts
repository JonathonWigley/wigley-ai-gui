import {
  FINDING_ACTIONS,
  MAX_CHOICES,
  type Finding,
  type FindingAction,
  type FindingChoice,
} from '../../../contract';
import { isFindingAction } from '../../../finding-pick';
import { RoundError } from '../../round-error';
import {
  fieldsMissing,
  fieldsOutside,
  isObject,
  parseRecommend,
  quotedList,
  requireText,
} from '../fields';
import type { AnswerableFormat } from '../item-format';

const MAX_FINDINGS = 20;

// A finding may offer a single solution; the user then picks only the action.
const MIN_SOLUTIONS = 1;

const FINDING_FIELDS = [
  'title',
  'finding',
  'proof',
  'choices',
  'recommend',
  'recommend_action',
];
const CHOICE_FIELDS = ['text', 'reason'];

const FINDINGS_DESCRIPTION =
  "Review findings that need the user's decision — one object per finding. " +
  'Each draws as its own card after the notices and before the questions: ' +
  'the finding, a brief proof, then the solutions, each with its reason ' +
  'under it, and under the solutions the action control — Fix now, ' +
  'Follow-up or Leave it — the form draws itself. A finding already fixed ' +
  'or decided goes in notices instead; an open decision that is not a ' +
  'review finding goes in questions.';

const PROOF_DESCRIPTION =
  'The evidence, in brief: short bullets naming the file, line, output or ' +
  'behaviour that shows the finding. No prose paragraphs. Markdown.';

const CHOICE_TEXT_DESCRIPTION =
  'Opens with one plain sentence saying what the user gets, before any ' +
  'symbol name or term of art. Inline markdown only.';

function parseChoice(
  raw: unknown,
  number: number,
  where: string,
): FindingChoice {
  const field = `choices[${number}]`;
  if (!isObject(raw)) {
    throw new RoundError(
      `${where}${field} must be an object with text and reason.`,
    );
  }
  const missing = fieldsMissing(raw, CHOICE_FIELDS);
  if (missing.length > 0) {
    throw new RoundError(
      `${where}${field} missing ${missing.join(', ')}. Each choice takes ` +
        `exactly text and reason.`,
    );
  }
  const extra = fieldsOutside(raw, CHOICE_FIELDS);
  if (extra.length > 0) {
    throw new RoundError(
      `${where}${field} unknown field(s) ${extra.join(', ')}. Each choice ` +
        `takes exactly text and reason.`,
    );
  }
  const text = requireText(raw.text, `${field}.text`, where);
  const reason = requireText(raw.reason, `${field}.reason`, where);
  return { text, reason };
}

function parseChoices(raw: unknown, where: string): FindingChoice[] {
  if (!Array.isArray(raw)) {
    throw new RoundError(
      `${where}choices must be a list of objects, each with text and reason.`,
    );
  }
  if (raw.length < MIN_SOLUTIONS) {
    throw new RoundError(
      `${where}has ${raw.length} choice(s). A finding needs at least ` +
        `${MIN_SOLUTIONS} solution.`,
    );
  }
  if (raw.length > MAX_CHOICES) {
    throw new RoundError(
      `${where}has ${raw.length} choices; the maximum is ${MAX_CHOICES}. ` +
        `Split it into two findings.`,
    );
  }
  return raw.map((choice, i) => parseChoice(choice, i + 1, where));
}

function parseRecommendAction(raw: unknown, where: string): FindingAction {
  if (!isFindingAction(raw)) {
    throw new RoundError(
      `${where}recommend_action must be one of ${quotedList(FINDING_ACTIONS)}.`,
    );
  }
  return raw;
}

function parseFinding(item: unknown, where: string): Finding {
  if (!isObject(item)) {
    throw new RoundError(`${where}each finding must be an object.`);
  }
  const missing = fieldsMissing(item, FINDING_FIELDS);
  if (missing.length > 0) {
    throw new RoundError(
      `${where}missing ${missing.join(', ')}. All six fields are ` +
        `required: title, finding, proof, choices, recommend, recommend_action.`,
    );
  }
  const extra = fieldsOutside(item, FINDING_FIELDS);
  if (extra.length > 0) {
    throw new RoundError(
      `${where}unknown field(s) ${extra.join(', ')}. The form draws ` +
        `the action control, the not-applicable control and the Notes box ` +
        `itself; do not describe them.`,
    );
  }
  const title = requireText(item.title, 'title', where);
  const finding = requireText(item.finding, 'finding', where);
  const proof = requireText(item.proof, 'proof', where);
  const choices = parseChoices(item.choices, where);
  const recommend = parseRecommend(
    item.recommend,
    title,
    choices.length,
    'solution',
    where,
  );
  const recommend_action = parseRecommendAction(item.recommend_action, where);
  // The six fields parsed carry no origin, severity or impact.
  return {
    title,
    origin: 'caused',
    severity: 'important',
    impact: '',
    finding,
    proof,
    choices,
    recommend,
    recommend_action,
  };
}

export const findingFormat: AnswerableFormat<Finding> = {
  argsKey: 'findings',
  noun: 'finding',
  maxItems: MAX_FINDINGS,
  arraySchema: {
    type: 'array',
    maxItems: MAX_FINDINGS,
    items: {
      type: 'object',
      additionalProperties: false,
      required: [...FINDING_FIELDS],
      properties: {
        title: {
          type: 'string',
          description: 'A short name for the finding.',
        },
        finding: {
          type: 'string',
          description: 'What is wrong, in plain words. Markdown.',
        },
        proof: { type: 'string', description: PROOF_DESCRIPTION },
        choices: {
          type: 'array',
          minItems: MIN_SOLUTIONS,
          maxItems: MAX_CHOICES,
          items: {
            type: 'object',
            additionalProperties: false,
            required: [...CHOICE_FIELDS],
            properties: {
              text: { type: 'string', description: CHOICE_TEXT_DESCRIPTION },
              reason: {
                type: 'string',
                description:
                  'Why one would pick this solution. Shown under it. Markdown.',
              },
            },
          },
          description:
            `The solutions, ${MIN_SOLUTIONS} to ${MAX_CHOICES}, one object per ` +
            'solution, each a way to ' +
            'resolve the finding. What to do with the finding — fix now, ' +
            'follow up or leave it — is the action control, never a choice.',
        },
        recommend: {
          type: 'integer',
          minimum: 1,
          description: 'The 1-based number of the recommended solution.',
        },
        recommend_action: {
          type: 'string',
          enum: [...FINDING_ACTIONS],
          description:
            'The recommended action for the finding, picked on the ' +
            "form's action control.",
        },
      },
    },
    description: FINDINGS_DESCRIPTION,
  },
  parse: parseFinding,
  fingerprintContent: (finding) => ({
    title: finding.title,
    finding: finding.finding,
    proof: finding.proof,
    choices: finding.choices.map((choice) => ({
      text: choice.text,
      reason: choice.reason,
    })),
    recommend: finding.recommend,
    recommend_action: finding.recommend_action,
  }),
  answerSubject: (finding) => ({
    title: finding.title,
    choiceTexts: finding.choices.map((choice) => choice.text),
    recommend: finding.recommend,
  }),
};
