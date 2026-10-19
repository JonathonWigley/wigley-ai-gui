import {
  FINDING_ORIGINS,
  MAX_CHOICES,
  type FindingAction,
  type FindingCard,
  type FindingOrigin,
} from './contract';

export interface OriginRules {
  card: FindingCard;
  minChoices: number;
  maxChoices: number;
  requiresSeverity: boolean;
  // Each action the card offers, mapped to the card's word for it.
  actions: Partial<Record<FindingAction, string>>;
}

const DEFECT_ACTIONS: Partial<Record<FindingAction, string>> = {
  fix_now: 'Fix now',
  follow_up: 'Follow-up',
  leave_it: 'Leave it',
};

export const FINDING_ORIGIN_RULES: Record<FindingOrigin, OriginRules> = {
  caused: {
    card: 'defect',
    minChoices: 1,
    maxChoices: MAX_CHOICES,
    requiresSeverity: true,
    actions: DEFECT_ACTIONS,
  },
  pre_existing: {
    card: 'defect',
    minChoices: 1,
    maxChoices: MAX_CHOICES,
    requiresSeverity: true,
    actions: DEFECT_ACTIONS,
  },
  design: {
    card: 'decision',
    minChoices: 2,
    maxChoices: MAX_CHOICES,
    requiresSeverity: false,
    actions: {
      fix_now: 'Decide now',
      follow_up: 'Plan it',
      leave_it: 'Drop it',
    },
  },
  nit: {
    card: 'nit',
    minChoices: 1,
    maxChoices: 1,
    requiresSeverity: false,
    actions: { fix_now: 'Fix anyway', leave_it: 'Leave it' },
  },
};

export function isFindingOrigin(value: unknown): value is FindingOrigin {
  return (FINDING_ORIGINS as readonly unknown[]).includes(value);
}

// The card's word for the action, or null when the origin does not offer it.
export function actionLabel(
  origin: FindingOrigin,
  action: FindingAction,
): string | null {
  return FINDING_ORIGIN_RULES[origin].actions[action] ?? null;
}

// Every distinct action word across the origins, in table order.
export const ACTION_WORDS: readonly string[] = [
  ...new Set(
    FINDING_ORIGINS.flatMap((origin) =>
      Object.values(FINDING_ORIGIN_RULES[origin].actions),
    ),
  ),
];
