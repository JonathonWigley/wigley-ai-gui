import type { ChatEntry } from '../../../contracts/agent';
import type { Review } from '../contract';

// One sample review per state the verdict draws, in the order the chat
// preview's permission entries take them.
export const PREVIEW_REVIEWS: readonly Review[] = [
  {
    state: 'done',
    summary: 'Edits src/app.ts inside the project folder.',
    verdict: 'approve',
    risk: 'low',
  },
  {
    state: 'done',
    summary: 'Deletes the build folder and everything in it.',
    verdict: 'deny',
    risk: 'high',
  },
  { state: 'reviewing' },
  { state: 'unavailable', reason: 'a sample review that could not run' },
];

// The sample review of each of `entries`' permission entries, by entry id: the
// nth permission entry takes `PREVIEW_REVIEWS`' nth, and those past its end
// take none.
export function previewReviews(
  entries: readonly ChatEntry[],
): Map<string, Review> {
  const permissions = entries.filter((entry) => entry.kind === 'permission');
  return new Map(
    permissions
      .slice(0, PREVIEW_REVIEWS.length)
      .map((entry, index): [string, Review] => [
        entry.id,
        PREVIEW_REVIEWS[index],
      ]),
  );
}
