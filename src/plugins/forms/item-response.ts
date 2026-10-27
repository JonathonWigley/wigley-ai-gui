// What the answered and responded rules read of a question's or a finding's
// answer. `pickIsComplete` is the pick holding one of the item's numbered
// entries: a choice in range on a question, a `findingEntries` entry on a
// finding.
export interface ItemResponse {
  notApplicable: boolean;
  pickIsComplete: boolean;
  notes: string;
}

// The pick alone answers the item, notes aside: the payload's `answered`.
export function isAnswered(
  response: Pick<ItemResponse, 'notApplicable' | 'pickIsComplete'>,
): boolean {
  return !response.notApplicable && response.pickIsComplete;
}

// The item is answered, or its notes hold text: what the page counts toward
// its rail dot, progress, review and jump-to-unanswered.
export function isResponded(response: ItemResponse): boolean {
  const hasText = response.notes.trim() !== '';
  return isAnswered(response) || (!response.notApplicable && hasText);
}
