import type { PluginLog } from '../../../contracts/log';
import type {
  Finding,
  FindingChoice,
  ItemAnswer,
  Notice,
  PageKind,
  PresentedRound,
  Question,
  Round,
} from '../contract';
import { BUILT_IN_KIND_SPECS } from '../item-kinds';
import { createFormsState } from './form-state';
import type { FindingAnswer, NoticeAnswer, RoundState } from './round-model';
import { BUILT_IN_PAGE_KINDS } from './kinds/formats';
import { pageKindTable } from './kinds/page-kinds';

export function question(
  title: string,
  overrides: Partial<Question> = {},
): Question {
  return {
    title,
    summary: `${title} summary`,
    context: `${title} context`,
    choices: ['first', 'second', 'third'],
    recommend: 2,
    rationale: `${title} rationale`,
    approves: [],
    layout: null,
    ...overrides,
  };
}

export function notice(title: string): Notice {
  return {
    title,
    context: `${title} context`,
    badge: 'Applied',
    layout: null,
  };
}

function choices(texts: string[]): FindingChoice[] {
  return texts.map((text) => ({
    text,
    reason: `${text} reason`,
    action: 'fix_now',
  }));
}

export function finding(
  title: string,
  overrides: Partial<Finding> = {},
): Finding {
  return {
    title,
    origin: 'caused',
    severity: 'important',
    impact: `${title} impact`,
    finding: `${title} finding`,
    proof: '',
    choices: choices(['first', 'second', 'third']),
    recommend: 2,
    recommend_action: 'fix_now',
    actionReasons: {},
    layout: null,
    ...overrides,
  };
}

export function decision(
  title: string,
  overrides: Partial<Finding> = {},
): Finding {
  return {
    title,
    origin: 'design',
    severity: null,
    impact: `${title} impact`,
    finding: `${title} finding`,
    proof: '',
    choices: choices(['first', 'second']),
    recommend: null,
    recommend_action: 'follow_up',
    actionReasons: { follow_up: `${title} follow-up reason` },
    layout: null,
    ...overrides,
  };
}

export function nit(title: string, overrides: Partial<Finding> = {}): Finding {
  return {
    title,
    origin: 'nit',
    severity: null,
    impact: `${title} impact`,
    finding: `${title} finding`,
    proof: `${title} proof`,
    choices: choices(['first']),
    recommend: 1,
    recommend_action: 'fix_now',
    actionReasons: {},
    layout: null,
    ...overrides,
  };
}

// A round's built-in parts, and any other kind's items by kind id with the
// body key each writes under.
export interface RoundParts {
  questions?: Question[];
  notices?: Notice[];
  findings?: Finding[];
  items?: Record<string, readonly unknown[]>;
  bodyKeys?: Record<string, string>;
}

const BUILT_IN_BODY_KEYS: Record<string, string> = Object.fromEntries(
  Object.values(BUILT_IN_KIND_SPECS).map((spec) => [spec.id, spec.bodyKey]),
);

// The round main presents, with two questions when `parts` names none.
export function roundOf(roundId: string, parts: RoundParts = {}): Round {
  return {
    heading: `${roundId} heading`,
    overview: '',
    layout: null,
    items: {
      question: parts.questions ?? [question('Alpha'), question('Beta')],
      notice: parts.notices ?? [],
      finding: parts.findings ?? [],
      ...parts.items,
    },
    bodyKeys: { ...BUILT_IN_BODY_KEYS, ...parts.bodyKeys },
  };
}

export function presentedRound(
  roundId: string,
  parts: RoundParts = {},
): PresentedRound {
  return {
    roundId,
    sessionId: `${roundId}-session`,
    label: `project · ${roundId}`,
    round: roundOf(roundId, parts),
    draft: null,
  };
}

// A log that drops every line.
export const NO_LOG: PluginLog = () => undefined;

// The forms reducer over the built-in kinds, as tests drive it.
export const { apply, initialState } = createFormsState(
  () => pageKindTable(BUILT_IN_PAGE_KINDS),
  NO_LOG,
);

// The forms reducer over the built-in kinds and `extra`, registered after
// them, logging through `log`.
export function formsWith(extra: readonly PageKind[], log = NO_LOG) {
  return createFormsState(
    () => pageKindTable([...BUILT_IN_PAGE_KINDS, ...extra]),
    log,
  );
}

// The card input of the kind's item `index` (1-based) of `round`.
export function cardInputOf<Item, Input>(
  kind: PageKind<Item, unknown, Input>,
  round: Round,
  index: number,
): Input {
  const item = round.items[kind.spec.id][index - 1] as Item;
  return kind.cardInput.input(item, index, round);
}

// The round's answers of one built-in kind, typed.
export function questionAnswers(round: RoundState): readonly ItemAnswer[] {
  return (round.itemAnswers.question ?? []) as readonly ItemAnswer[];
}

export function findingAnswers(round: RoundState): readonly FindingAnswer[] {
  return (round.itemAnswers.finding ?? []) as readonly FindingAnswer[];
}

export function noticeComments(round: RoundState): string[] {
  return ((round.itemAnswers.notice ?? []) as readonly NoticeAnswer[]).map(
    (answer) => answer.comment,
  );
}
