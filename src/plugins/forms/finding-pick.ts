import { FINDING_ACTIONS, type Finding, type FindingAction } from './contract';
import { actionLabel } from './finding-origins';

export function isFindingAction(value: unknown): value is FindingAction {
  return (FINDING_ACTIONS as readonly unknown[]).includes(value);
}

// Whether a finding's pick holds everything the caller needs to act: an
// action, plus a solution when the action is 'fix_now' or 'follow_up' and
// the finding offers more than one. `choice` is 1-based, 0 for none.
export function findingPickIsComplete(
  solutionCount: number,
  choice: number,
  action: FindingAction | '',
): boolean {
  if (action === '') {
    return false;
  }
  if (action === 'leave_it') {
    return true;
  }
  const choiceIsInRange = choice >= 1 && choice <= solutionCount;
  return solutionCount === 1 || choiceIsInRange;
}

// The 1-based solution the caller gets for a finding's pick: 1 on a
// one-solution finding, whatever `choice` holds; 0 while the pick is
// incomplete or the action is 'leave_it'. Whether the finding applies is the
// caller's to check.
export function findingSolution(
  solutionCount: number,
  choice: number,
  action: FindingAction | '',
): number {
  const hasSolution =
    action !== 'leave_it' &&
    findingPickIsComplete(solutionCount, choice, action);
  if (!hasSolution) {
    return 0;
  }
  return solutionCount === 1 ? 1 : choice;
}

// The finding's pick, or null when `choice` and `action` make none: `choice`
// is a choice's 1-based number, which counts only with the action that choice
// sits under, or 0 for the header of an action that has no choices. The action
// must be one the finding's origin offers.
export function completeFindingPick(
  finding: Finding,
  choice: number,
  action: FindingAction | '',
): { choice: number; action: FindingAction } | null {
  if (action === '' || actionLabel(finding.origin, action) === null) {
    return null;
  }
  if (choice === 0) {
    const actionHasChoices = finding.choices.some(
      (each) => each.action === action,
    );
    return actionHasChoices ? null : { choice: 0, action };
  }
  const choiceSitsUnderAction =
    choice >= 1 &&
    choice <= finding.choices.length &&
    finding.choices[choice - 1].action === action;
  return choiceSitsUnderAction ? { choice, action } : null;
}
