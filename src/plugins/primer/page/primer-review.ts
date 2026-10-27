import type { CommandId } from '../../../contracts/commands';
import type { Platform } from '../../../contracts/platform';
import { element } from '../../../shared/page/dom';
import { appendKeyHint } from '../../../shared/page/key-hint';
import { type ButtonVariant, textButton } from '../../../shared/page/ui/button';
import { sectionHeader } from '../../../shared/page/ui/section-header';
import { tag, type TagTone } from '../../../shared/page/ui/tag';
import type { PrimerEntry, PrimerItem, PrimerNeed } from '../contract';
import type { KeysPageExports } from '../../keys/contract';
import { type PrimerCommandName, primerCommand, primerScope } from './ids';
import {
  FEATURE_FIELDS,
  type OpenPrimer,
  railRows,
  submitProblems,
} from './primer-state';

export interface ReviewTallies {
  yes: number;
  no: number;
  unclear: number;
  included: number;
  items: number;
}

// `keys` reads the review scope's keys for each footer button; `run` runs a
// button's command.
export interface ReviewDeps {
  keys: Pick<KeysPageExports, 'keysFor'>;
  run(command: CommandId): void;
  platform: Platform;
}

const NEED_TAGS: Record<PrimerNeed, [string, TagTone]> = {
  yes: ['Yes', 'success'],
  no: ['No', 'neutral'],
  unclear: ['Unclear', 'warning'],
};

const FOOTER: [PrimerCommandName, string, ButtonVariant][] = [
  ['closeReview', 'Back', 'ghost'],
  ['askCancel', 'Cancel primer', 'secondary'],
  ['submit', 'Send', 'primary'],
];

// The tag a task's need shows as, in the rail, the card and the review.
export function needTag(need: PrimerNeed): HTMLElement {
  const [text, tone] = NEED_TAGS[need];
  return tag(text, tone);
}

// The task's name as the rail, the card and the review show it; an extra task
// with a blank name reads `Unnamed task`.
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

// `3 needed, 1 not needed, 0 unclear. 9 of 12 items included.`
export function talliesText(tallies: ReviewTallies): string {
  const { yes, no, unclear, included, items } = tallies;
  return `${yes} needed, ${no} not needed, ${unclear} unclear. ${included} of ${items} items included.`;
}

// The review pane: the tallies, what blocks a send, the feature's fields, one
// block per task in rail order, and the Back, Cancel primer and Send buttons,
// each with the review scope's keys for its command.
export function renderReview(
  primer: OpenPrimer,
  deps: ReviewDeps,
): HTMLElement {
  const review = element('div', 'primer-review');
  review.append(
    element('p', 'primer-review-tallies', talliesText(reviewTallies(primer))),
  );
  const problems = submitProblems(primer);
  if (problems.length > 0) {
    review.append(problemList(problems));
  }
  review.append(featureBlock(primer));
  const entries = new Map(primer.entries.map((entry) => [entry.id, entry]));
  for (const row of railRows(primer)) {
    const entry = row.kind === 'task' ? entries.get(row.entryId) : undefined;
    if (entry !== undefined) {
      review.append(taskBlock(entry));
    }
  }
  review.append(footer(deps));
  return review;
}

function problemList(problems: string[]): HTMLElement {
  const block = element('section', 'primer-review-problems');
  const list = element('ul', 'primer-review-problem-list');
  for (const problem of problems) {
    list.append(element('li', 'primer-review-problem', problem));
  }
  block.append(sectionHeader('Before sending'), list);
  return block;
}

function featureBlock(primer: OpenPrimer): HTMLElement {
  const block = element('section', 'primer-review-block');
  block.append(sectionHeader('Feature'));
  const fields = element('dl', 'primer-review-fields');
  for (const [field, label] of FEATURE_FIELDS) {
    fields.append(
      element('dt', 'primer-review-field-label', label),
      element('dd', 'primer-review-field-value', primer.feature[field]),
    );
  }
  block.append(fields);
  return block;
}

// The task's name and need, its included items, then its left-out items each
// tagged, every item with its comment, and the task's comment when not blank.
function taskBlock(entry: PrimerEntry): HTMLElement {
  const block = element('section', 'primer-review-block');
  const head = element('div', 'primer-review-task-head');
  head.append(
    element('span', 'primer-review-task-name', taskName(entry)),
    needTag(entry.need),
  );
  block.append(head);
  const included = entry.items.filter((item) => item.include);
  const leftOut = entry.items.filter((item) => !item.include);
  if (entry.items.length > 0) {
    const list = element('ul', 'primer-review-items');
    list.append(
      ...included.map((item) => reviewItem(item)),
      ...leftOut.map((item) => reviewItem(item)),
    );
    block.append(list);
  }
  if (entry.comment.trim() !== '') {
    block.append(element('p', 'primer-review-comment', entry.comment));
  }
  return block;
}

function reviewItem(item: PrimerItem): HTMLElement {
  const node = element('li', 'primer-review-item');
  const line = element('div', 'primer-review-item-line');
  line.append(element('span', 'primer-review-item-text', item.text));
  if (!item.include) {
    line.append(tag('Left out'));
  }
  node.append(line);
  if (item.comment.trim() !== '') {
    node.append(element('p', 'primer-review-comment', item.comment));
  }
  return node;
}

function footer(deps: ReviewDeps): HTMLElement {
  const actions = element('div', 'primer-review-actions');
  for (const [command, label, variant] of FOOTER) {
    const qualified = primerCommand(command);
    const control = textButton(label, () => deps.run(qualified), { variant });
    appendKeyHint(
      control,
      () => deps.keys.keysFor(qualified, primerScope('review')),
      deps.platform,
    );
    actions.append(control);
  }
  return actions;
}
