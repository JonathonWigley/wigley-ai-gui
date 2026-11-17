import { tag, type TagTone } from '../../../shared/page/ui/tag';
import type { PrimerEntry, PrimerNeed } from '../contract';
import type { ReviewInput, ReviewTaskInput } from '../layouts/layout';
import {
  FEATURE_FIELDS,
  type OpenPrimer,
  reviewEntries,
  submitProblems,
} from './primer-state';

export interface ReviewTallies {
  yes: number;
  no: number;
  unclear: number;
  included: number;
  items: number;
}

const NEED_TAGS: Record<PrimerNeed, [string, TagTone]> = {
  yes: ['Yes', 'success'],
  no: ['No', 'neutral'],
  unclear: ['Unclear', 'warning'],
};

// The tag a task's need shows as, in the tasks column, the card and the review.
export function needTag(need: PrimerNeed): HTMLElement {
  const [text, tone] = NEED_TAGS[need];
  return tag(text, tone);
}

// The task's name as the tasks column, the card and the review show it; an
// extra task with a blank name reads `Unnamed task`.
export function taskName(entry: PrimerEntry): string {
  const isUnnamed = entry.group === 'extra' && entry.task.trim() === '';
  return isUnnamed ? 'Unnamed task' : entry.task;
}

// Every task's need and every item of the primer.
export function reviewTallies(primer: OpenPrimer): ReviewTallies {
  const tallies: ReviewTallies = {
    yes: 0,
    no: 0,
    unclear: 0,
    included: 0,
    items: 0,
  };
  for (const entry of primer.entries) {
    tallies[entry.need] += 1;
    tallies.items += entry.items.length;
    tallies.included += entry.items.filter((item) => item.include).length;
  }
  return tallies;
}

// The review body's input: the tallies, what blocks a send, the feature's
// fields and the tasks in tasks column order, the review cursor's marked.
export function reviewInput(primer: OpenPrimer): ReviewInput {
  const tasks = reviewEntries(primer).map((entry, row) =>
    reviewTask(entry, row === primer.reviewRow),
  );
  return {
    tallies: reviewTallies(primer),
    problems: submitProblems(primer),
    feature: FEATURE_FIELDS.map(([field, label]) => ({
      label,
      value: primer.feature[field],
    })),
    tasks,
  };
}

function reviewTask(entry: PrimerEntry, isCursor: boolean): ReviewTaskInput {
  return {
    id: entry.id,
    isCursor,
    name: taskName(entry),
    need: entry.need,
    comment: entry.comment,
    items: entry.items.map(({ text, include, comment }) => ({
      text,
      include,
      comment,
    })),
  };
}
