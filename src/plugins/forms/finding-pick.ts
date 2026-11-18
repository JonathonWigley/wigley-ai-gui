import { FINDING_ACTIONS, type Finding, type FindingAction } from './contract';
import { actionLabel } from './finding-origins';

export function isFindingAction(value: unknown): value is FindingAction {
  return (FINDING_ACTIONS as readonly unknown[]).includes(value);
}

// One numbered pick on a finding card: a choice with the action it sits
// under, or the header of an action with no choices, whose `choice` is 0.
// `choice` is otherwise the choice's 1-based number in the finding's choices.
export interface FindingEntry {
  action: FindingAction;
  choice: number;
}

// What the entry rules read of a finding.
export type PickableFinding = Pick<Finding, 'origin' | 'choices'>;

// The card's word for an origin's action, or null when the origin does not
// offer it. The rules below read the registered spec (`actionLabel`) unless
// the caller passes the lookup it draws the card with.
export type ActionWord = (
  origin: string,
  action: FindingAction,
) => string | null;

// The finding's entries in card order: each action its origin offers, in
// FINDING_ACTIONS order, then that action's choices in wire order, or its
// header alone when it has none. Entry N is the card's number N, 1-based.
export function findingEntries(
  finding: PickableFinding,
  actionWord: ActionWord = actionLabel,
): FindingEntry[] {
  const entries: FindingEntry[] = [];
  for (const action of FINDING_ACTIONS) {
    if (actionWord(finding.origin, action) === null) {
      continue;
    }
    const before = entries.length;
    finding.choices.forEach((each, index) => {
      if (each.action === action) {
        entries.push({ action, choice: index + 1 });
      }
    });
    if (entries.length === before) {
      entries.push({ action, choice: 0 });
    }
  }
  return entries;
}

// The 1-based card number of the pick `{ choice, action }`, 0 when the pick
// is none of the finding's entries.
export function findingEntryNumber(
  finding: PickableFinding,
  choice: number,
  action: FindingAction | '',
  actionWord: ActionWord = actionLabel,
): number {
  const index = findingEntries(finding, actionWord).findIndex(
    (entry) => entry.choice === choice && entry.action === action,
  );
  return index + 1;
}

// Whether the pick is one of the finding's entries, so it holds everything
// the caller needs to act on.
export function findingPickIsComplete(
  finding: PickableFinding,
  choice: number,
  action: FindingAction | '',
  actionWord: ActionWord = actionLabel,
): boolean {
  return findingEntryNumber(finding, choice, action, actionWord) > 0;
}

// The picked choice's 1-based number when the pick is complete, else 0; a
// header pick gives 0. Whether the finding applies is the caller's to check.
export function findingSolution(
  finding: PickableFinding,
  choice: number,
  action: FindingAction | '',
  actionWord: ActionWord = actionLabel,
): number {
  return findingPickIsComplete(finding, choice, action, actionWord)
    ? choice
    : 0;
}

// The finding's pick, or null when `{ choice, action }` is none of its
// entries.
export function completeFindingPick(
  finding: PickableFinding,
  choice: number,
  action: FindingAction | '',
  actionWord: ActionWord = actionLabel,
): { choice: number; action: FindingAction } | null {
  if (
    action === '' ||
    !findingPickIsComplete(finding, choice, action, actionWord)
  ) {
    return null;
  }
  return { choice, action };
}

// The card's word for the pick when it is one of the finding's entries; ''
// otherwise.
export function findingActionLabel(
  finding: PickableFinding,
  choice: number,
  action: FindingAction | '',
  actionWord: ActionWord = actionLabel,
): string {
  const pick = completeFindingPick(finding, choice, action, actionWord);
  return pick === null ? '' : (actionWord(finding.origin, pick.action) ?? '');
}
