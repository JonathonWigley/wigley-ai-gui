import { FINDING_ACTIONS, type FindingAction } from './contract';

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
