import {
  FINDING_ACTIONS,
  FINDING_ORIGINS,
  MAX_CHOICES,
  SEVERITIES,
  type DefectFinding,
  type Finding,
  type FindingAction,
  type FindingChoice,
  type FindingOrigin,
  type Severity,
} from '../../../contract';
import {
  ACTION_WORDS,
  FINDING_ORIGIN_RULES,
  isFindingOrigin,
} from '../../../finding-origins';
import { isFindingAction } from '../../../finding-pick';
import { RoundError } from '../../round-error';
import {
  fieldsMissing,
  fieldsOutside,
  isObject,
  parseRecommend,
  quotedList,
  requireText,
  type JsonObject,
} from '../fields';
import type { AnswerableFormat } from '../item-format';

const MAX_FINDINGS = 20;

// The fewest choices any origin takes.
const MIN_SOLUTIONS = Math.min(
  ...FINDING_ORIGINS.map((origin) => FINDING_ORIGIN_RULES[origin].minChoices),
);

// Every finding carries these; severity is the one field an origin decides.
const FINDING_FIELDS = [
  'title',
  'origin',
  'impact',
  'finding',
  'proof',
  'choices',
  'recommend',
  'recommend_action',
];
const SEVERITY_FIELD = 'severity';
const KNOWN_FIELDS = [...FINDING_FIELDS, SEVERITY_FIELD];
const CHOICE_FIELDS = ['text', 'reason'];

type DefectOrigin = DefectFinding['origin'];

// The parts of a finding its origin decides: the origin and, on a Defect,
// its severity.
type OriginFields =
  | { origin: DefectOrigin; severity: Severity }
  | { origin: Exclude<FindingOrigin, DefectOrigin> };

function isDefectOrigin(origin: FindingOrigin): origin is DefectOrigin {
  return FINDING_ORIGIN_RULES[origin].requiresSeverity;
}

function isSeverity(value: unknown): value is Severity {
  return (SEVERITIES as readonly unknown[]).includes(value);
}

// 'caused or pre_existing'
const SEVERITY_ORIGINS = FINDING_ORIGINS.filter(isDefectOrigin).join(' or ');

function capitalised(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

// Each action value with every card's word for it, from the origin table.
function actionLabelsText(): string {
  const cards = [
    ...new Map(
      FINDING_ORIGINS.map((origin) => [
        FINDING_ORIGIN_RULES[origin].card,
        FINDING_ORIGIN_RULES[origin].actions,
      ]),
    ),
  ];
  return FINDING_ACTIONS.map((action) => {
    const labels = cards.flatMap(([card, actions]) => {
      const label = actions[action];
      return label === undefined ? [] : [`${label} (${capitalised(card)})`];
    });
    return `${action}: ${labels.join(', ')}`;
  }).join('; ');
}

const FINDINGS_DESCRIPTION =
  "Review findings and deferred items that need the user's decision — one " +
  'object per finding. Each draws as its own card after the notices and ' +
  'before the questions; its origin sets the card and the fields it takes. ' +
  'A finding missing a field its origin requires, or carrying one its ' +
  'origin forbids, fails the call with an error naming each. A finding ' +
  'already fixed or decided goes in notices instead; an open decision that ' +
  'is not a review finding goes in questions.';

const ORIGIN_DESCRIPTION =
  "Sets the card the finding draws as. 'caused' (Defect): a defect the " +
  "change under review introduced. 'pre_existing' (Defect): a real defect " +
  "in code the change read but did not cause. 'design' (Decision): a " +
  'design call, options to weigh now or in a feature plan. ' +
  "'nit' (Nit): nothing builds on it, and it cannot be shown happening.";

const PROOF_DESCRIPTION =
  'The evidence, in brief: short bullets naming the file, line, output or ' +
  'behaviour that shows the finding. Titled Context on a Decision and ' +
  "Why it's safe on a Nit. No prose paragraphs. Markdown.";

const CHOICE_TEXT_DESCRIPTION =
  'Opens with one plain sentence saying what the user gets, before any ' +
  'symbol name or term of art. Never opens with an action label. Inline ' +
  'markdown only.';

const CHOICES_DESCRIPTION =
  "One object per choice: a Defect's solutions (1 to " +
  `${MAX_CHOICES}), a Decision's options a plan would weigh (2 to ` +
  `${MAX_CHOICES}), a Nit's exactly one, the fix. A choice names a ` +
  'solution only: each card draws its own action control, and a choice ' +
  "whose text opens with an action's label " +
  `(${ACTION_WORDS.join(', ')}) fails the call.`;

const RECOMMEND_ACTION_DESCRIPTION =
  "The recommended action, picked on the card's action control. The values " +
  'are the same three on every card, each card labelling them its own way — ' +
  `${actionLabelsText()}. A Nit offers no follow_up.`;

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
  const actionWord = openingActionWord(text);
  if (actionWord !== null) {
    throw new RoundError(
      `${where}${field}.text opens with "${actionWord}", an action. A ` +
        `choice names a solution; the card draws its own action control.`,
    );
  }
  return { text, reason };
}

// The action word the text opens with — the whole text, or the word followed
// by whitespace or punctuation — or null.
function openingActionWord(text: string): string | null {
  const opening = text.trim().toLowerCase();
  const word = ACTION_WORDS.find((candidate) => {
    const lowered = candidate.toLowerCase();
    const next = opening.charAt(lowered.length);
    const endsAtABreak = next === '' || /[\s\p{P}]/u.test(next);
    return opening.startsWith(lowered) && endsAtABreak;
  });
  return word ?? null;
}

function choiceCountText(origin: FindingOrigin): string {
  const { minChoices, maxChoices } = FINDING_ORIGIN_RULES[origin];
  if (minChoices !== maxChoices) {
    return `takes ${minChoices} to ${maxChoices} choices`;
  }
  // A finding's lone choice is its fix.
  const lone = minChoices === 1 ? ' choice: the fix' : ' choices';
  return `takes exactly ${minChoices}${lone}`;
}

function parseChoices(
  raw: unknown,
  origin: FindingOrigin,
  where: string,
): FindingChoice[] {
  if (!Array.isArray(raw)) {
    throw new RoundError(
      `${where}choices must be a list of objects, each with text and reason.`,
    );
  }
  const { minChoices, maxChoices } = FINDING_ORIGIN_RULES[origin];
  if (raw.length < minChoices || raw.length > maxChoices) {
    throw new RoundError(
      `${where}a ${origin} finding ${choiceCountText(origin)}.`,
    );
  }
  return raw.map((choice, i) => parseChoice(choice, i + 1, where));
}

function parseOriginFields(item: JsonObject, where: string): OriginFields {
  const origin = item.origin;
  if (!isFindingOrigin(origin)) {
    throw new RoundError(
      `${where}origin must be one of ${quotedList(FINDING_ORIGINS)}.`,
    );
  }
  const hasSeverity = Object.hasOwn(item, SEVERITY_FIELD);
  if (!isDefectOrigin(origin)) {
    if (hasSeverity) {
      throw new RoundError(
        `${where}severity is only for a ${SEVERITY_ORIGINS} finding.`,
      );
    }
    return { origin };
  }
  if (!hasSeverity) {
    throw new RoundError(`${where}a ${origin} finding needs severity.`);
  }
  const severity = item.severity;
  if (!isSeverity(severity)) {
    throw new RoundError(
      `${where}severity must be one of ${quotedList(SEVERITIES)}.`,
    );
  }
  return { origin, severity };
}

function parseRecommendAction(
  raw: unknown,
  origin: FindingOrigin,
  where: string,
): FindingAction {
  if (!isFindingAction(raw)) {
    throw new RoundError(
      `${where}recommend_action must be one of ${quotedList(FINDING_ACTIONS)}.`,
    );
  }
  const offered = FINDING_ACTIONS.filter(
    (action) => FINDING_ORIGIN_RULES[origin].actions[action] !== undefined,
  );
  if (!offered.includes(raw)) {
    throw new RoundError(
      `${where}a ${origin} finding offers ${offered.join(' or ')}.`,
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
      `${where}missing ${missing.join(', ')}. Every finding needs ` +
        `${FINDING_FIELDS.join(', ')}; a ${SEVERITY_ORIGINS} finding also ` +
        `needs severity.`,
    );
  }
  const extra = fieldsOutside(item, KNOWN_FIELDS);
  if (extra.length > 0) {
    throw new RoundError(
      `${where}unknown field(s) ${extra.join(', ')}. The form draws ` +
        `the action control, the not-applicable control and the Notes box ` +
        `itself; do not describe them.`,
    );
  }
  const originFields = parseOriginFields(item, where);
  const { origin } = originFields;
  const title = requireText(item.title, 'title', where);
  const impact = requireText(item.impact, 'impact', where);
  const finding = requireText(item.finding, 'finding', where);
  const proof = requireText(item.proof, 'proof', where);
  const choices = parseChoices(item.choices, origin, where);
  const recommend = parseRecommend(
    item.recommend,
    title,
    choices.length,
    'solution',
    where,
  );
  const recommend_action = parseRecommendAction(
    item.recommend_action,
    origin,
    where,
  );
  return {
    ...originFields,
    title,
    impact,
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
        origin: {
          type: 'string',
          enum: [...FINDING_ORIGINS],
          description: ORIGIN_DESCRIPTION,
        },
        impact: {
          type: 'string',
          description: 'One plain sentence: what goes wrong, and for whom.',
        },
        severity: {
          type: 'string',
          enum: [...SEVERITIES],
          description: `Required on a ${SEVERITY_ORIGINS} finding (a Defect); no other origin accepts it.`,
        },
        finding: {
          type: 'string',
          description:
            'What is wrong, in plain words; for a Decision, what is to ' +
            'decide. Markdown.',
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
                  'Why one would pick this choice. Shown under it. Markdown.',
              },
            },
          },
          description: CHOICES_DESCRIPTION,
        },
        recommend: {
          type: 'integer',
          minimum: 1,
          description: 'The 1-based number of the recommended choice.',
        },
        recommend_action: {
          type: 'string',
          enum: [...FINDING_ACTIONS],
          description: RECOMMEND_ACTION_DESCRIPTION,
        },
      },
    },
    description: FINDINGS_DESCRIPTION,
  },
  parse: parseFinding,
  fingerprintContent: (finding) => ({
    title: finding.title,
    origin: finding.origin,
    ...('severity' in finding ? { severity: finding.severity } : {}),
    impact: finding.impact,
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
