import {
  FINDING_ACTIONS,
  FINDING_ORIGINS,
  MAX_ENTRIES,
  SEVERITIES,
  type DefectFinding,
  type Finding,
  type FindingAction,
  type FindingAnswerEntry,
  type FindingCard,
  type FindingChoice,
  type FindingOrigin,
  type FindingResult,
  type MainItemKind,
  RoundError,
  type RoundItemPath,
  type Severity,
} from '../../../contract';
import {
  ACTION_WORDS,
  FINDING_ORIGIN_RULES,
  isFindingOrigin,
} from '../../../finding-origins';
import {
  completeFindingPick,
  findingEntries,
  isFindingAction,
} from '../../../finding-pick';
import { isAnswered } from '../../../item-response';
import { BUILT_IN_KIND_SPECS } from '../../../item-kinds';
import {
  addNotesAndDontAsk,
  answerStatus,
  readAnswerEntry,
  recommendedAnswerEntry,
  withoutDontAsk,
} from '../answer-results';
import {
  fieldsMissing,
  fieldsOutside,
  ITEM_LAYOUT_SCHEMA,
  parseLayoutField,
  parseRecommend,
  quotedList,
  requireText,
} from '../fields';
import type { AnswerSubject } from '../item-format';
import {
  actionLabelsText,
  cardChoicesText,
  cardName,
  choiceCountText,
  orList,
  originCardsText,
  unofferedActionsText,
} from './finding-text';
import { isJsonObject, type JsonObject } from '../../../../../shared/json';

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
  'recommend_action',
];
const SEVERITY_FIELD = 'severity';
const RECOMMEND_FIELD = 'recommend';
const ACTION_REASONS_FIELD = 'action_reasons';
const KNOWN_FIELDS = [
  ...FINDING_FIELDS,
  SEVERITY_FIELD,
  RECOMMEND_FIELD,
  ACTION_REASONS_FIELD,
  'layout',
];
const CHOICE_FIELDS = ['text', 'reason'];
const CHOICE_ACTION_FIELD = 'action';
const KNOWN_CHOICE_FIELDS = [...CHOICE_FIELDS, CHOICE_ACTION_FIELD];

// The action a choice sits under when it names none.
const DEFAULT_CHOICE_ACTION: FindingAction = 'fix_now';

type DeferralAction = keyof Finding['actionReasons'];

// The actions that put a finding off, which action_reasons explains.
const DEFERRAL_ACTIONS = FINDING_ACTIONS.filter(
  (action): action is DeferralAction => action !== DEFAULT_CHOICE_ACTION,
);

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

const SEVERITY_ORIGIN_LIST = FINDING_ORIGINS.filter(isDefectOrigin);

// 'caused or pre_existing'
const SEVERITY_ORIGINS = orList(SEVERITY_ORIGIN_LIST);

// 'a Defect'
const SEVERITY_CARDS = orList([
  ...new Set(SEVERITY_ORIGIN_LIST.map((origin) => `a ${cardName(origin)}`)),
]);

const FINDINGS_DESCRIPTION =
  "Review findings and deferred items that need the user's decision — one " +
  'object per finding. Each draws as its own card before the ' +
  'questions; its origin sets the card and the fields it takes. ' +
  'A finding missing a field its origin requires, or carrying one its ' +
  'origin forbids, fails the call with an error naming each. A finding ' +
  'already fixed or decided goes in notices instead; an open decision that ' +
  'is not a review finding goes in questions.';

const ORIGIN_MEANINGS: Record<FindingOrigin, string> = {
  caused: 'a defect the change under review introduced',
  pre_existing: 'a real defect in code the change read but did not cause',
  design: 'a design call, options to weigh now or in a feature plan',
  nit: 'nothing builds on it, and it cannot be shown happening',
};

const ORIGIN_DESCRIPTION =
  'Sets the card the finding draws as. ' + originCardsText(ORIGIN_MEANINGS);

const PROOF_DESCRIPTION =
  'The evidence, in brief: short bullets naming the file, line, output or ' +
  'behaviour that shows the finding. Titled Context on a Decision and ' +
  "Why it's safe on a Nit. No prose paragraphs. Markdown.";

const CHOICE_TEXT_DESCRIPTION =
  'Opens with one plain sentence saying what the user gets, before any ' +
  'symbol name or term of art. Never opens with an action label. Inline ' +
  'markdown only.';

// What each card's choices are.
const CARD_CHOICES: Record<FindingCard, string> = {
  defect: 'its solutions',
  decision: 'the options a plan would weigh',
  nit: 'the fix',
};

const CHOICES_DESCRIPTION =
  `One object per choice: ${cardChoicesText(CARD_CHOICES)}. The card draws ` +
  'each choice under its action (its action field; fix_now when left out), ' +
  'and an action with no choices as a header the user picks alone. At least ' +
  'one choice is a fix_now choice. The card numbers its choices and headers ' +
  `alike, one number key each, so a finding takes at most ${MAX_ENTRIES} of ` +
  'them together; one past that fails the call. A choice names a solution ' +
  'only: a choice ' +
  "whose text opens with an action's label " +
  `(${ACTION_WORDS.join(', ')}) fails the call.`;

const CHOICE_ACTION_DESCRIPTION =
  "The action this choice sits under on the card, one the finding's origin " +
  `offers; fix_now when left out. ${unofferedActionsText()}`;

const RECOMMEND_DESCRIPTION =
  'The 1-based number, in choices, of the recommended choice: a choice of ' +
  'recommend_action. Leave it out, or send null, only when no choice has ' +
  'recommend_action.';

const RECOMMEND_ACTION_DESCRIPTION =
  'The recommended action. The values are the same three on every card, ' +
  'each card labelling them its own way — ' +
  `${actionLabelsText()}. ${unofferedActionsText()}`.trimEnd();

const ACTION_REASONS_DESCRIPTION =
  "Why to take a deferral action, drawn under that action's header. Only an " +
  'action the origin offers takes an entry. Send the entry for the action ' +
  `you recommend when it is a deferral; null reads as none. ` +
  unofferedActionsText();

// The actions the origin offers, in FINDING_ACTIONS order.
function offeredActions(origin: FindingOrigin): FindingAction[] {
  return FINDING_ACTIONS.filter(
    (action) => FINDING_ORIGIN_RULES[origin].actions[action] !== undefined,
  );
}

// A choice's action: fix_now when absent, else one of the three that the
// origin offers.
function parseChoiceAction(
  raw: JsonObject,
  field: string,
  origin: FindingOrigin,
  at: RoundItemPath,
): FindingAction {
  const action = Object.hasOwn(raw, CHOICE_ACTION_FIELD)
    ? raw.action
    : DEFAULT_CHOICE_ACTION;
  if (!isFindingAction(action)) {
    throw new RoundError({
      path: at,
      problem: `${field}.action must be one of ${quotedList(FINDING_ACTIONS)}.`,
    });
  }
  const offered = offeredActions(origin);
  if (!offered.includes(action)) {
    throw new RoundError({
      path: at,
      problem:
        `${field}.action is ${action}, which a ${origin} finding does not ` +
        `offer; it offers ${offered.join(' or ')}.`,
    });
  }
  return action;
}

function parseChoice(
  raw: unknown,
  number: number,
  origin: FindingOrigin,
  at: RoundItemPath,
): FindingChoice {
  const field = `choices[${number}]`;
  if (!isJsonObject(raw)) {
    throw new RoundError({
      path: at,
      problem: `${field} must be an object with text, reason and an optional action.`,
    });
  }
  const missing = fieldsMissing(raw, CHOICE_FIELDS);
  if (missing.length > 0) {
    throw new RoundError({
      path: at,
      problem: `${field} missing ${missing.join(', ')}.`,
      detail: 'Each choice takes text and reason, and an optional action.',
    });
  }
  const extra = fieldsOutside(raw, KNOWN_CHOICE_FIELDS);
  if (extra.length > 0) {
    throw new RoundError({
      path: at,
      problem: `${field} unknown field(s) ${extra.join(', ')}.`,
      detail: 'Each choice takes text and reason, and an optional action.',
    });
  }
  const text = requireText(raw.text, `${field}.text`, at);
  const reason = requireText(raw.reason, `${field}.reason`, at);
  const actionWord = openingActionWord(text);
  if (actionWord !== null) {
    throw new RoundError({
      path: at,
      problem: `${field}.text opens with "${actionWord}", an action.`,
      detail:
        'A choice names a solution; its action field sets the action it ' +
        'sits under.',
    });
  }
  const action = parseChoiceAction(raw, field, origin, at);
  return { text, reason, action };
}

// A run of inline-markdown emphasis or code marks.
const INLINE_MARKS = /^[*_`~]+/;

// The action word the text opens with — the whole text, or the word followed
// by whitespace or punctuation — or null. Inline-markdown marks around the
// word are skipped, since `**Fix now**` renders as the bare word.
function openingActionWord(text: string): string | null {
  const opening = text.trim().replace(INLINE_MARKS, '').toLowerCase();
  const word = ACTION_WORDS.find((candidate) => {
    const lowered = candidate.toLowerCase();
    if (!opening.startsWith(lowered)) {
      return false;
    }
    const next = opening
      .slice(lowered.length)
      .replace(INLINE_MARKS, '')
      .charAt(0);
    return next === '' || /[\s\p{P}]/u.test(next);
  });
  return word ?? null;
}

function parseChoices(
  raw: unknown,
  origin: FindingOrigin,
  at: RoundItemPath,
): FindingChoice[] {
  if (!Array.isArray(raw)) {
    throw new RoundError({
      path: at,
      problem: 'choices must be a list of objects, each with text and reason.',
    });
  }
  const { minChoices, maxChoices } = FINDING_ORIGIN_RULES[origin];
  if (raw.length < minChoices || raw.length > maxChoices) {
    throw new RoundError({
      path: at,
      problem: `a ${origin} finding ${choiceCountText(origin)}.`,
    });
  }
  const choices = raw.map((choice, i) =>
    parseChoice(choice, i + 1, origin, at),
  );
  const hasFixNowChoice = choices.some(
    (choice) => choice.action === DEFAULT_CHOICE_ACTION,
  );
  if (!hasFixNowChoice) {
    throw new RoundError({
      path: at,
      problem: 'no choice has action fix_now.',
      detail:
        'A finding needs at least one fix_now choice; a choice with no ' +
        'action is fix_now.',
    });
  }
  requireEntriesWithinKeys(origin, choices, at);
  return choices;
}

// Each entry the card numbers takes a number key, so a finding with more
// entries than keys is refused.
function requireEntriesWithinKeys(
  origin: FindingOrigin,
  choices: FindingChoice[],
  at: RoundItemPath,
): void {
  const entryCount = findingEntries({ origin, choices }).length;
  if (entryCount > MAX_ENTRIES) {
    throw new RoundError({
      path: at,
      problem:
        `the card would number ${entryCount} entries — its choices plus a ` +
        `header for each action with no choices — and the page has ` +
        `${MAX_ENTRIES} number keys.`,
      detail:
        'Give fewer choices, or move a fix_now choice under an action drawn ' +
        'as a header, which the choice replaces.',
    });
  }
}

function parseOriginFields(item: JsonObject, at: RoundItemPath): OriginFields {
  const origin = item.origin;
  if (!isFindingOrigin(origin)) {
    throw new RoundError({
      path: at,
      problem: `origin must be one of ${quotedList(FINDING_ORIGINS)}.`,
    });
  }
  const hasSeverity = Object.hasOwn(item, SEVERITY_FIELD);
  if (!isDefectOrigin(origin)) {
    if (hasSeverity) {
      throw new RoundError({
        path: at,
        problem: `severity is only for a ${SEVERITY_ORIGINS} finding.`,
      });
    }
    return { origin };
  }
  if (!hasSeverity) {
    throw new RoundError({
      path: at,
      problem: `a ${origin} finding needs severity.`,
    });
  }
  const severity = item.severity;
  if (!isSeverity(severity)) {
    throw new RoundError({
      path: at,
      problem: `severity must be one of ${quotedList(SEVERITIES)}.`,
    });
  }
  return { origin, severity };
}

function parseRecommendAction(
  raw: unknown,
  origin: FindingOrigin,
  at: RoundItemPath,
): FindingAction {
  if (!isFindingAction(raw)) {
    throw new RoundError({
      path: at,
      problem: `recommend_action must be one of ${quotedList(FINDING_ACTIONS)}.`,
    });
  }
  const offered = offeredActions(origin);
  if (!offered.includes(raw)) {
    throw new RoundError({
      path: at,
      problem: `a ${origin} finding offers ${offered.join(' or ')}.`,
    });
  }
  return raw;
}

// Absent or null reads as none. Each entry is for a deferral action the
// origin offers.
function parseActionReasons(
  item: JsonObject,
  origin: FindingOrigin,
  at: RoundItemPath,
): Finding['actionReasons'] {
  const raw = item[ACTION_REASONS_FIELD];
  if (raw === undefined || raw === null) {
    return {};
  }
  if (!isJsonObject(raw)) {
    throw new RoundError({
      path: at,
      problem:
        `action_reasons must be an object with ` +
        `${DEFERRAL_ACTIONS.join(', ')} or both.`,
    });
  }
  const extra = fieldsOutside(raw, DEFERRAL_ACTIONS);
  if (extra.length > 0) {
    throw new RoundError({
      path: at,
      problem: `action_reasons unknown key(s) ${extra.join(', ')}.`,
      detail: `It takes ${DEFERRAL_ACTIONS.join(' and ')}, the deferral actions.`,
    });
  }
  const offered = offeredActions(origin);
  const reasons: Finding['actionReasons'] = {};
  for (const action of DEFERRAL_ACTIONS) {
    if (!Object.hasOwn(raw, action)) {
      continue;
    }
    if (!offered.includes(action)) {
      throw new RoundError({
        path: at,
        problem:
          `action_reasons.${action} is for an action a ${origin} finding ` +
          `does not offer; it offers ${offered.join(' or ')}.`,
      });
    }
    reasons[action] = requireText(raw[action], `action_reasons.${action}`, at);
  }
  return reasons;
}

// The recommended choice, which must sit under recommend_action; null, with
// recommend left out or null, when recommend_action has no choices.
function parseFindingRecommend(
  item: JsonObject,
  title: string,
  choices: FindingChoice[],
  recommendAction: FindingAction,
  at: RoundItemPath,
): number | null {
  const actionHasChoices = choices.some(
    (choice) => choice.action === recommendAction,
  );
  const raw = item[RECOMMEND_FIELD];
  if (raw === undefined || raw === null) {
    if (actionHasChoices) {
      throw new RoundError({
        path: at,
        problem: 'missing recommend.',
        detail:
          `recommend_action is ${recommendAction}, which has choices, so ` +
          `recommend names one of them; leave recommend out only when ` +
          `recommend_action has no choices.`,
      });
    }
    return null;
  }
  if (!actionHasChoices) {
    throw new RoundError({
      path: at,
      problem:
        `recommend names a choice, but no choice has action ` +
        `${recommendAction}, the recommend_action.`,
      detail: 'Leave recommend out when the recommended action has no choices.',
    });
  }
  const recommend = parseRecommend(raw, title, choices.length, 'solution', at);
  const choiceAction = choices[recommend - 1].action;
  if (choiceAction !== recommendAction) {
    throw new RoundError({
      path: at,
      problem:
        `recommend is ${recommend}, a ${choiceAction} choice, but ` +
        `recommend_action is ${recommendAction}.`,
      detail: 'recommend names a choice of the recommended action.',
    });
  }
  return recommend;
}

function parseFinding(item: unknown, at: RoundItemPath): Finding {
  if (!isJsonObject(item)) {
    throw new RoundError({
      path: at,
      problem: 'each finding must be an object.',
    });
  }
  const missing = fieldsMissing(item, FINDING_FIELDS);
  if (missing.length > 0) {
    throw new RoundError({
      path: at,
      problem: `missing ${missing.join(', ')}.`,
      detail:
        `Every finding needs ${FINDING_FIELDS.join(', ')}; a ` +
        `${SEVERITY_ORIGINS} finding also needs severity.`,
    });
  }
  const extra = fieldsOutside(item, KNOWN_FIELDS);
  if (extra.length > 0) {
    throw new RoundError({
      path: at,
      problem: `unknown field(s) ${extra.join(', ')}.`,
      detail:
        'The form draws the not-applicable control and the Notes box ' +
        'itself; do not describe them.',
    });
  }
  const originFields = parseOriginFields(item, at);
  const { origin } = originFields;
  const title = requireText(item.title, 'title', at);
  const impact = requireText(item.impact, 'impact', at);
  const finding = requireText(item.finding, 'finding', at);
  const proof = requireText(item.proof, 'proof', at);
  const choices = parseChoices(item.choices, origin, at);
  const recommend_action = parseRecommendAction(
    item.recommend_action,
    origin,
    at,
  );
  const actionReasons = parseActionReasons(item, origin, at);
  const recommend = parseFindingRecommend(
    item,
    title,
    choices,
    recommend_action,
    at,
  );
  const layout = parseLayoutField(item, at);
  return {
    ...originFields,
    title,
    impact,
    finding,
    proof,
    choices,
    recommend,
    recommend_action,
    actionReasons,
    layout,
  };
}

// The entries a finding's fingerprint holds of its action_reasons, in
// DEFERRAL_ACTIONS order.
function actionReasonsContent(
  reasons: Finding['actionReasons'],
): Record<string, string> {
  const content: Record<string, string> = {};
  for (const action of DEFERRAL_ACTIONS) {
    const reason = reasons[action];
    if (reason !== undefined) {
      content[action] = reason;
    }
  }
  return content;
}

// What the answer result reads of a finding; recommend 0: no recommended
// choice, as when recommend_action has none.
export function findingAnswerSubject(finding: Finding): AnswerSubject {
  return {
    title: finding.title,
    choiceTexts: finding.choices.map((choice) => choice.text),
    recommend: finding.recommend ?? 0,
  };
}

// A saved action outside the three, or none, reads as no action.
function readFindingAnswerEntry(
  index: number,
  saved: Readonly<Record<string, unknown>>,
): FindingAnswerEntry {
  return {
    ...readAnswerEntry(index, saved),
    action: isFindingAction(saved.action) ? saved.action : '',
  };
}

// A finding is answered (`isAnswered`) once its entry holds one of the card's
// numbered picks (`findingEntries`): a choice with the action it sits under,
// or the header of an action with no choices, whose `choice` is 0; notes alone
// leave it untouched. The recommendation is taken whole when the pick is the
// recommended choice, or the recommended header, under recommend_action.
function findingResult(
  finding: Finding,
  entry: FindingAnswerEntry,
): FindingResult {
  const subject = findingAnswerSubject(finding);
  const completePick = completeFindingPick(finding, entry.choice, entry.action);
  const answered = isAnswered({
    notApplicable: entry.not_applicable,
    pickIsComplete: completePick !== null,
  });
  const pick = answered ? completePick : null;
  const choice = pick?.choice ?? 0;
  const tookActionRecommendation =
    pick !== null && pick.action === finding.recommend_action;
  const result: FindingResult = {
    index: entry.index,
    title: subject.title,
    status: answerStatus(entry, answered),
    choice,
    choice_text: choice > 0 ? subject.choiceTexts[choice - 1] : '',
    took_recommendation:
      tookActionRecommendation && pick.choice === subject.recommend,
    action: pick?.action ?? '',
    took_action_recommendation: tookActionRecommendation,
  };
  addNotesAndDontAsk(result, entry);
  return result;
}

export const findingKind: MainItemKind<
  Finding,
  FindingAnswerEntry,
  FindingResult
> = {
  spec: BUILT_IN_KIND_SPECS.finding,
  noun: 'finding',
  describe: () => ({
    type: 'array',
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
          description: `Required on a ${SEVERITY_ORIGINS} finding (${SEVERITY_CARDS}); no other origin accepts it.`,
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
          maxItems: MAX_ENTRIES,
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
              action: {
                type: 'string',
                enum: [...FINDING_ACTIONS],
                default: DEFAULT_CHOICE_ACTION,
                description: CHOICE_ACTION_DESCRIPTION,
              },
            },
          },
          description: CHOICES_DESCRIPTION,
        },
        recommend: {
          type: 'integer',
          minimum: 1,
          description: RECOMMEND_DESCRIPTION,
        },
        recommend_action: {
          type: 'string',
          enum: [...FINDING_ACTIONS],
          description: RECOMMEND_ACTION_DESCRIPTION,
        },
        action_reasons: {
          type: 'object',
          additionalProperties: false,
          properties: {
            follow_up: {
              type: 'string',
              description: 'Drawn under the follow-up action. Markdown.',
            },
            leave_it: {
              type: 'string',
              description: 'Drawn under the leave-it action. Markdown.',
            },
          },
          description: ACTION_REASONS_DESCRIPTION,
        },
        layout: ITEM_LAYOUT_SCHEMA,
      },
    },
    description: FINDINGS_DESCRIPTION,
  }),
  parse: parseFinding,
  layout: (finding) => finding.layout,
  // A fix_now choice action, a null recommend and empty action_reasons stay
  // out, so a finding using none of them hashes as one sent before they
  // existed; the layout never joins.
  fingerprintContent: (finding) => {
    const actionReasons = actionReasonsContent(finding.actionReasons);
    return {
      title: finding.title,
      origin: finding.origin,
      ...('severity' in finding ? { severity: finding.severity } : {}),
      impact: finding.impact,
      finding: finding.finding,
      proof: finding.proof,
      choices: finding.choices.map((choice) => ({
        text: choice.text,
        reason: choice.reason,
        ...(choice.action !== DEFAULT_CHOICE_ACTION
          ? { action: choice.action }
          : {}),
      })),
      ...(finding.recommend !== null ? { recommend: finding.recommend } : {}),
      recommend_action: finding.recommend_action,
      ...(Object.keys(actionReasons).length > 0
        ? { action_reasons: actionReasons }
        : {}),
    };
  },
  readEntry: readFindingAnswerEntry,
  recommendedEntry: (finding, index) => ({
    ...recommendedAnswerEntry(index, finding.recommend ?? 0),
    action: finding.recommend_action,
  }),
  finishedEntry: withoutDontAsk,
  result: findingResult,
  status: (result) => result.status,
};
