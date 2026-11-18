import type { Finding } from '../../../contract';
import { findingEntries } from '../../../finding-pick';
import type { FindingAnswer } from '../../round-model';

// A finding answer's pick alone.
export type FindingPick = Pick<FindingAnswer, 'choice' | 'action'>;

export const NO_PICK: FindingPick = { choice: 0, action: '' };

// Picks the finding's entry `number` (1-based), choice and action together;
// the held entry again clears to no pick. Locked while not applicable, and a
// number past the last entry changes nothing.
export function chooseEntry(
  answer: FindingAnswer,
  finding: Finding,
  number: number,
): FindingAnswer {
  const entry = findingEntries(finding)[number - 1];
  if (answer.notApplicable || entry === undefined) {
    return answer;
  }
  if (holdsPick(answer, entry)) {
    return { ...answer, ...NO_PICK };
  }
  return { ...answer, choice: entry.choice, action: entry.action };
}

// Locked while not applicable; a no-op on a finding with no pick.
export function clearFindingPick(answer: FindingAnswer): FindingAnswer {
  if (answer.notApplicable || holdsPick(answer, NO_PICK)) {
    return answer;
  }
  return { ...answer, ...NO_PICK };
}

export function holdsPick(answer: FindingAnswer, pick: FindingPick): boolean {
  return answer.choice === pick.choice && answer.action === pick.action;
}
