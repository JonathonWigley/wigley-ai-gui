import {
  FINDING_ACTIONS,
  MAX_ENTRIES,
  SEVERITIES,
  type Finding,
  type FindingAction,
  type FindingAnswerEntry,
  type FindingChoice,
  type FindingOriginSpec,
  type FindingResult,
  type MainItemKind,
  RoundError,
  type RoundItemPath,
  type Severity,
} from '../../../contract';
import {
  actionLabel,
  actionWords,
  findingOrigins,
} from '../../../finding-origins';
import {
  completeFindingPick,
  findingActionLabel,
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
  cardKindsText,
  choiceCountText,
  orList,
  originCardsText,
  unofferedActionsText,
} from './finding-text';
import { isJsonObject, type JsonObject } from '../../../../../shared/json';

// Every finding carries these; severity and proof are the fields an origin
// decides.
const FINDING_FIELDS = [
  'title',
  'origin',
  'impact',
  'finding',
  'choices',
  'recommend_action',
];
const SEVERITY_FIELD = 'severity';
const PROOF_FIELD = 'proof';
const RECOMMEND_FIELD = 'recommend';
const ACTION_REASONS_FIELD = 'action_reasons';
const KNOWN_FIELDS = [
  ...FINDING_FIELDS,
  SEVERITY_FIELD,
  PROOF_FIELD,
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

function isSeverity(value: unknown): value is Severity {
  return (SEVERITIES as readonly unknown[]).includes(value);
}

// The fewest choices any registered origin takes.
function minSolutions(): number {
  return Math.min(
    MAX_ENTRIES,
    ...findingOrigins.list().map((spec) => spec.minChoices),
  );
}

function severitySpecs(): FindingOriginSpec[] {
  return findingOrigins.list().filter((spec) => spec.requiresSeverity);
}

function proofSpecs(): FindingOriginSpec[] {
  return findingOrigins.list().filter((spec) => spec.requiresProof);
}

// 'caused or pre_existing'
function originsText(specs: readonly FindingOriginSpec[]): string {
  return orList(specs.map((spec) => spec.id));
}

const FINDINGS_DESCRIPTION =
  "Review findings and deferred items that need the user's decision — one " +
  'object per finding. Each draws as its own card before the ' +
  'questions; its origin sets the card and the fields it takes. ' +
  'A finding missing a field its origin requires, or carrying one its ' +
  'origin forbids, fails the call with an error naming each. A finding ' +
  'already fixed or decided goes in notices instead; an open decision that ' +
  'is not a review finding goes in questions.';

function originDescription(): string {
  return 'Sets the card the finding draws as. ' + originCardsText();
}

// The proof field's description; its first sentence names the origins that
// require proof, and is left out when none does.
function proofDescription(): string {
  const specs = proofSpecs();
  const rest =
    'Short bullets naming the file, line, output or behaviour. No prose ' +
    'paragraphs. Markdown.';
  if (specs.length === 0) {
    return `Optional on every origin, where the default card does not draw it. ${rest}`;
  }
  const titles = orList([...new Set(specs.map((spec) => spec.words.proof))]);
  return (
    `Required on a ${originsText(specs)} finding (${cardKindsText(specs)}): ` +
    `why it cannot happen, shown under its ${titles} title. Optional on every ` +
    `other origin, where the default card does not draw it. ${rest}`
  );
}

function severityDescription(): string {
  const specs = severitySpecs();
  return `Required on a ${originsText(specs)} finding (${cardKindsText(specs)}); no other origin accepts it.`;
}

const CHOICE_TEXT_DESCRIPTION =
  'Opens with one plain sentence saying what the user gets, before any ' +
  'symbol name or term of art. Never opens with an action label. Inline ' +
  'markdown only.';

function choicesDescription(): string {
  return (
    `One object per choice: ${cardChoicesText()}. The card draws ` +
    'each choice under its action (its action field; fix_now when left out), ' +
    'and an action with no choices as a header the user picks alone. At least ' +
    'one choice is a fix_now choice. The card numbers its choices and headers ' +
    `alike, one number key each, so a finding takes at most ${MAX_ENTRIES} of ` +
    'them together; one past that fails the call. A choice names a solution ' +
    'only: a choice ' +
    "whose text opens with an action's label " +
    `(${actionWords().join(', ')}) fails the call.`
  );
}

function choiceActionDescription(): string {
  return (
    "The action this choice sits under on the card, one the finding's origin " +
    `offers; fix_now when left out. ${unofferedActionsText()}`
  );
}

const RECOMMEND_DESCRIPTION =
  'The 1-based number, in choices, of the recommended choice: a choice of ' +
  'recommend_action. Leave it out, or send null, only when no choice has ' +
  'recommend_action.';

function recommendActionDescription(): string {
  return (
    'The recommended action. The values are the same three on every card, ' +
    'each card labelling them its own way — ' +
    `${actionLabelsText()}. ${unofferedActionsText()}`.trimEnd()
  );
}

function actionReasonsDescription(): string {
  return (
    "Why to take a deferral action, drawn under that action's header. Only an " +
    'action the origin offers takes an entry. Send the entry for the action ' +
    `you recommend when it is a deferral; null reads as none. ` +
    unofferedActionsText()
  );
}

// What a finding missing a required field is told it needs.
function missingFieldsDetail(): string {
  const severity = severitySpecs();
  const proof = proofSpecs();
  const alsoNeeds = [
    ...(severity.length > 0
      ? [`a ${originsText(severity)} finding also needs severity`]
      : []),
    ...(proof.length > 0
      ? [`a ${originsText(proof)} finding also needs proof`]
      : []),
  ];
  const needs = `Every finding needs ${FINDING_FIELDS.join(', ')}`;
  return alsoNeeds.length === 0
    ? `${needs}.`
    : `${needs}; ${alsoNeeds.join(', and ')}.`;
}

// The actions the origin offers, in FINDING_ACTIONS order.
function offeredActions(spec: FindingOriginSpec): FindingAction[] {
  return FINDING_ACTIONS.filter((action) => spec.actions[action] !== undefined);
}

// A choice's action: fix_now when absent, else one of the three that the
// origin offers.
function parseChoiceAction(
  raw: JsonObject,
  field: string,
  spec: FindingOriginSpec,
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
  const offered = offeredActions(spec);
  if (!offered.includes(action)) {
    throw new RoundError({
      path: at,
      problem:
        `${field}.action is ${action}, which a ${spec.id} finding does not ` +
        `offer; it offers ${offered.join(' or ')}.`,
    });
  }
  return action;
}

function parseChoice(
  raw: unknown,
  number: number,
  spec: FindingOriginSpec,
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
  const action = parseChoiceAction(raw, field, spec, at);
  return { text, reason, action };
}

// A run of inline-markdown emphasis or code marks.
const INLINE_MARKS = /^[*_`~]+/;

// The action word the text opens with — the whole text, or the word followed
// by whitespace or punctuation — or null. Inline-markdown marks around the
// word are skipped, since `**Fix now**` renders as the bare word.
function openingActionWord(text: string): string | null {
  const opening = text.trim().replace(INLINE_MARKS, '').toLowerCase();
  const word = actionWords().find((candidate) => {
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
  spec: FindingOriginSpec,
  at: RoundItemPath,
): FindingChoice[] {
  if (!Array.isArray(raw)) {
    throw new RoundError({
      path: at,
      problem: 'choices must be a list of objects, each with text and reason.',
    });
  }
  const { minChoices, maxChoices } = spec;
  if (raw.length < minChoices || raw.length > maxChoices) {
    throw new RoundError({
      path: at,
      problem: `a ${spec.id} finding ${choiceCountText(spec.id)}.`,
    });
  }
  const choices = raw.map((choice, i) => parseChoice(choice, i + 1, spec, at));
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
  requireEntriesWithinKeys(spec.id, choices, at);
  return choices;
}

// Each entry the card numbers takes a number key, so a finding with more
// entries than keys is refused.
function requireEntriesWithinKeys(
  origin: string,
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

// The finding's registered origin spec; a retired origin is refused, so a
// new round cannot name it.
function parseOrigin(item: JsonObject, at: RoundItemPath): FindingOriginSpec {
  const registered = findingOrigins.list();
  const spec = registered.find((each) => each.id === item.origin);
  if (spec === undefined) {
    throw new RoundError({
      path: at,
      problem: `origin must be one of ${quotedList(registered.map((each) => each.id))}.`,
    });
  }
  return spec;
}

// The finding's severity: required on an origin whose spec requires it,
// refused on any other, which reads as null.
function parseSeverity(
  item: JsonObject,
  spec: FindingOriginSpec,
  at: RoundItemPath,
): Severity | null {
  const hasSeverity = Object.hasOwn(item, SEVERITY_FIELD);
  if (!spec.requiresSeverity) {
    if (hasSeverity) {
      throw new RoundError({
        path: at,
        problem: `severity is only for a ${originsText(severitySpecs())} finding.`,
      });
    }
    return null;
  }
  if (!hasSeverity) {
    throw new RoundError({
      path: at,
      problem: `a ${spec.id} finding needs severity.`,
    });
  }
  const severity = item.severity;
  if (!isSeverity(severity)) {
    throw new RoundError({
      path: at,
      problem: `severity must be one of ${quotedList(SEVERITIES)}.`,
    });
  }
  return severity;
}

// The finding's proof: non-blank text on an origin whose spec requires it;
// on any other, absent, null or blank reads as '' and other text is kept as
// sent.
function parseProof(
  item: JsonObject,
  spec: FindingOriginSpec,
  at: RoundItemPath,
): string {
  const raw = item[PROOF_FIELD];
  if (spec.requiresProof) {
    if (!Object.hasOwn(item, PROOF_FIELD)) {
      throw new RoundError({
        path: at,
        problem: `a ${spec.id} finding needs proof.`,
      });
    }
    return requireText(raw, PROOF_FIELD, at);
  }
  if (raw === undefined || raw === null) {
    return '';
  }
  if (typeof raw !== 'string') {
    throw new RoundError({ path: at, problem: 'proof must be a string.' });
  }
  return raw.trim() === '' ? '' : raw;
}

function parseRecommendAction(
  raw: unknown,
  spec: FindingOriginSpec,
  at: RoundItemPath,
): FindingAction {
  if (!isFindingAction(raw)) {
    throw new RoundError({
      path: at,
      problem: `recommend_action must be one of ${quotedList(FINDING_ACTIONS)}.`,
    });
  }
  const offered = offeredActions(spec);
  if (!offered.includes(raw)) {
    throw new RoundError({
      path: at,
      problem: `a ${spec.id} finding offers ${offered.join(' or ')}.`,
    });
  }
  return raw;
}

// Absent or null reads as none. Each entry is for a deferral action the
// origin offers.
function parseActionReasons(
  item: JsonObject,
  spec: FindingOriginSpec,
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
  const offered = offeredActions(spec);
  const reasons: Finding['actionReasons'] = {};
  for (const action of DEFERRAL_ACTIONS) {
    if (!Object.hasOwn(raw, action)) {
      continue;
    }
    if (!offered.includes(action)) {
      throw new RoundError({
        path: at,
        problem:
          `action_reasons.${action} is for an action a ${spec.id} finding ` +
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
      detail: missingFieldsDetail(),
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
  const spec = parseOrigin(item, at);
  const severity = parseSeverity(item, spec, at);
  const title = requireText(item.title, 'title', at);
  const impact = requireText(item.impact, 'impact', at);
  const finding = requireText(item.finding, 'finding', at);
  const proof = parseProof(item, spec, at);
  const choices = parseChoices(item.choices, spec, at);
  const recommend_action = parseRecommendAction(
    item.recommend_action,
    spec,
    at,
  );
  const actionReasons = parseActionReasons(item, spec, at);
  const recommend = parseFindingRecommend(
    item,
    title,
    choices,
    recommend_action,
    at,
  );
  const layout = parseLayoutField(item, at);
  return {
    title,
    origin: spec.id,
    severity,
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

// The card's word for the finding's recommended action.
function recommendActionLabel(finding: Finding): string {
  return actionLabel(finding.origin, finding.recommend_action) ?? '';
}

// A saved action outside the three, or none, reads as no action. Both labels
// are computed from the pick and the finding; saved labels are ignored.
function readFindingAnswerEntry(
  index: number,
  saved: Readonly<Record<string, unknown>>,
  finding: Finding,
): FindingAnswerEntry {
  const entry = readAnswerEntry(index, saved);
  const action = isFindingAction(saved.action) ? saved.action : '';
  return {
    ...entry,
    action,
    action_label: findingActionLabel(finding, entry.choice, action),
    recommend_action_label: recommendActionLabel(finding),
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

// The schema and its texts follow the registered origins, read on each call.
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
          enum: findingOrigins.list().map((spec) => spec.id),
          description: originDescription(),
        },
        impact: {
          type: 'string',
          description: 'One plain sentence: what goes wrong, and for whom.',
        },
        severity: {
          type: 'string',
          enum: [...SEVERITIES],
          description: severityDescription(),
        },
        finding: {
          type: 'string',
          description:
            'What is wrong, in plain words; for a Decision, what is to ' +
            'decide. Markdown.',
        },
        proof: { type: 'string', description: proofDescription() },
        choices: {
          type: 'array',
          minItems: minSolutions(),
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
                description: choiceActionDescription(),
              },
            },
          },
          description: choicesDescription(),
        },
        recommend: {
          type: 'integer',
          minimum: 1,
          description: RECOMMEND_DESCRIPTION,
        },
        recommend_action: {
          type: 'string',
          enum: [...FINDING_ACTIONS],
          description: recommendActionDescription(),
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
          description: actionReasonsDescription(),
        },
        layout: ITEM_LAYOUT_SCHEMA,
      },
    },
    description: FINDINGS_DESCRIPTION,
  }),
  parse: parseFinding,
  layout: (finding) => finding.layout,
  // A null severity, an empty proof, a fix_now choice action, a null
  // recommend and empty action_reasons stay out, so a finding using none of
  // them hashes as one sent before they existed; the layout never joins.
  fingerprintContent: (finding) => {
    const actionReasons = actionReasonsContent(finding.actionReasons);
    return {
      title: finding.title,
      origin: finding.origin,
      ...(finding.severity !== null ? { severity: finding.severity } : {}),
      impact: finding.impact,
      finding: finding.finding,
      ...(finding.proof !== '' ? { proof: finding.proof } : {}),
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
    action_label: recommendActionLabel(finding),
    recommend_action_label: recommendActionLabel(finding),
  }),
  finishedEntry: withoutDontAsk,
  result: findingResult,
  status: (result) => result.status,
};
